import { describe, expect, it, vi } from "vitest";
import type { CampaignId, SceneId } from "@cco/domain";
import type { GenerationManifestRepository } from "@cco/application";
import { PostgresCurrentProductionAttemptQueries } from "./postgres-current-production-attempt-queries.js";

function fakePool(rows: unknown[]) {
  return {
    query: vi.fn(async (_sql: string, _params: unknown[]) => ({ rows }))
  };
}

describe("PostgresCurrentProductionAttemptQueries Unit Tests", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as CampaignId;
  const runId = "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000003" as SceneId;
  const jobId = "01950c46-9e90-7d3d-82d2-8f1d3c000004";
  const manifestId = "01950c46-9e90-7d3d-82d2-8f1d3c000005";

  it("returns available and reviewReady when job completed, manifest resolvable, and scene in qa", async () => {
    const pool = fakePool([
      {
        run_id: runId,
        scene_id: sceneId,
        spec_revision: 2,
        production_job_id: jobId,
        job_status: "completed",
        retry_count: 0,
        scene_status: "qa"
      }
    ]);

    const mockManifests: GenerationManifestRepository = {
      getComponentIdentityById: vi.fn(),
      findVideoStemSourceByJobId: vi.fn(async () => ({
        generationManifestId: manifestId,
        media: {
          bucket: "renders-bucket",
          key: "renders/s1.mp4",
          sha256: "a".repeat(64),
          contentType: "video/mp4"
        },
        renderAttempt: 1
      }))
    };

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, mockManifests);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result).toEqual({
      runId,
      sceneId,
      specRevision: 2,
      attemptOrdinal: 1,
      productionJobId: jobId,
      technicalState: "completed",
      reviewReady: true,
      availability: "available",
      media: {
        generationManifestId: manifestId,
        ref: {
          bucket: "renders-bucket",
          key: "renders/s1.mp4",
          sha256: "a".repeat(64),
          contentType: "video/mp4"
        }
      }
    });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("campaign_production_run_scenes"),
      [runId, sceneId, campaignId]
    );
  });

  it("returns available with reviewReady: false when scene is not yet in qa", async () => {
    const pool = fakePool([
      {
        run_id: runId,
        scene_id: sceneId,
        spec_revision: 1,
        production_job_id: jobId,
        job_status: "completed",
        retry_count: 1,
        scene_status: "rendering"
      }
    ]);

    const mockManifests: GenerationManifestRepository = {
      getComponentIdentityById: vi.fn(),
      findVideoStemSourceByJobId: vi.fn(async () => ({
        generationManifestId: manifestId,
        media: {
          bucket: "renders-bucket",
          key: "renders/s1.mp4",
          sha256: "a".repeat(64),
          contentType: "video/mp4"
        },
        renderAttempt: 2
      }))
    };

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, mockManifests);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result?.availability).toBe("available");
    expect(result?.reviewReady).toBe(false);
    expect(result?.attemptOrdinal).toBe(2);
    expect(result?.media).toBeDefined();
  });

  it("returns unavailable when job is still rendering", async () => {
    const pool = fakePool([
      {
        run_id: runId,
        scene_id: sceneId,
        spec_revision: 1,
        production_job_id: jobId,
        job_status: "rendering",
        retry_count: 0,
        scene_status: "rendering"
      }
    ]);

    const mockManifests: GenerationManifestRepository = {
      getComponentIdentityById: vi.fn(),
      findVideoStemSourceByJobId: vi.fn()
    };

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, mockManifests);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result).toEqual({
      runId,
      sceneId,
      specRevision: 1,
      attemptOrdinal: 1,
      productionJobId: jobId,
      technicalState: "rendering",
      reviewReady: false,
      availability: "unavailable"
    });
    expect(mockManifests.findVideoStemSourceByJobId).not.toHaveBeenCalled();
  });

  it("returns unavailable when production_job_id is null", async () => {
    const pool = fakePool([
      {
        run_id: runId,
        scene_id: sceneId,
        spec_revision: 1,
        production_job_id: null,
        job_status: null,
        retry_count: null,
        scene_status: "draft_pending"
      }
    ]);

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, {} as never);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result).toEqual({
      runId,
      sceneId,
      specRevision: 1,
      attemptOrdinal: 1,
      technicalState: "queued",
      reviewReady: false,
      availability: "unavailable"
    });
  });

  it("returns missing_manifest when completed job has no manifest", async () => {
    const pool = fakePool([
      {
        run_id: runId,
        scene_id: sceneId,
        spec_revision: 1,
        production_job_id: jobId,
        job_status: "completed",
        retry_count: 0,
        scene_status: "qa"
      }
    ]);

    const mockManifests: GenerationManifestRepository = {
      getComponentIdentityById: vi.fn(),
      findVideoStemSourceByJobId: vi.fn(async () => undefined)
    };

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, mockManifests);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result).toEqual({
      runId,
      sceneId,
      specRevision: 1,
      attemptOrdinal: 1,
      productionJobId: jobId,
      technicalState: "completed",
      reviewReady: false,
      availability: "missing_manifest"
    });
  });

  it("returns inconsistent when manifest resolution throws", async () => {
    const pool = fakePool([
      {
        run_id: runId,
        scene_id: sceneId,
        spec_revision: 1,
        production_job_id: jobId,
        job_status: "completed",
        retry_count: 0,
        scene_status: "qa"
      }
    ]);

    const mockManifests: GenerationManifestRepository = {
      getComponentIdentityById: vi.fn(),
      findVideoStemSourceByJobId: vi.fn(async () => {
        throw new Error("Outputs malformed");
      })
    };

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, mockManifests);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result).toEqual({
      runId,
      sceneId,
      specRevision: 1,
      attemptOrdinal: 1,
      productionJobId: jobId,
      technicalState: "completed",
      reviewReady: false,
      availability: "inconsistent"
    });
  });

  it("returns undefined when no row found (wrong run/scene/campaign)", async () => {
    const pool = fakePool([]);

    const queries = new PostgresCurrentProductionAttemptQueries(pool as never, {} as never);
    const result = await queries.getCurrentProductionAttempt({ campaignId, runId, sceneId });

    expect(result).toBeUndefined();
  });
});
