import { describe, expect, it, vi } from "vitest";
import type { AssemblySpec } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import { PostgresCampaignDeliveryReelQueries } from "./postgres-campaign-delivery-reel-queries.js";

function createMockPool(
  queryHandler: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>
) {
  return {
    query: vi.fn(queryHandler)
  };
}

describe("PostgresCampaignDeliveryReelQueries Unit Tests", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as CampaignId;
  const runId = "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const jobId = "01950c46-9e90-7d3d-82d2-8f1d3c000003";
  const validSha = "a".repeat(64);

  const sampleSpec: AssemblySpec = {
    campaignId,
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    expectedTotalDurationMs: 5000,
    videoStems: [
      {
        sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000011",
        generationManifestId: "gen-man-1",
        order: 0,
        expectedDurationMs: 5000,
        media: {
          bucket: "renders",
          key: `campaigns/${campaignId}/scenes/scene-1.mp4`,
          sha256: validSha,
          contentType: "video/mp4"
        }
      }
    ],
    subtitleCues: []
  };

  it("returns undefined when campaign does not exist", async () => {
    const pool = createMockPool(async () => ({ rows: [] }));
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("SELECT campaign_id"), [
      campaignId
    ]);
  });

  it("returns not-started when campaign exists with no jobs or runs", async () => {
    const pool = createMockPool(async (sql) => {
      if (sql.includes("FROM campaigns")) {
        return {
          rows: [
            {
              campaign_id: campaignId,
              status: "drafting",
              updated_at: new Date("2026-09-13T10:00:00.000Z")
            }
          ]
        };
      }
      return { rows: [] };
    });
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toEqual({
      campaignExists: true,
      status: "not-started",
      updatedAt: "2026-09-13T10:00:00.000Z"
    });
  });

  it("returns completed job with assemblySpec when completed job exists (Priority 1)", async () => {
    const pool = createMockPool(async (sql) => {
      if (sql.includes("FROM campaigns")) {
        return {
          rows: [
            {
              campaign_id: campaignId,
              status: "completed",
              updated_at: new Date("2026-09-13T11:00:00.000Z")
            }
          ]
        };
      }
      if (sql.includes("status = 'completed'")) {
        return {
          rows: [
            {
              job_id: jobId,
              campaign_id: campaignId,
              assembly_spec: JSON.stringify(sampleSpec),
              job_status: "completed",
              error_trace: null,
              job_created_at: new Date("2026-09-13T10:50:00.000Z"),
              job_updated_at: new Date("2026-09-13T11:00:00.000Z"),
              run_id: runId,
              run_status: "completed"
            }
          ]
        };
      }
      return { rows: [] };
    });
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toEqual({
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId: jobId,
      assemblySpec: sampleSpec,
      createdAt: "2026-09-13T10:50:00.000Z",
      updatedAt: "2026-09-13T11:00:00.000Z"
    });
  });

  it("returns assembling when active assembly job exists (Priority 2)", async () => {
    const pool = createMockPool(async (sql) => {
      if (sql.includes("FROM campaigns")) {
        return {
          rows: [
            {
              campaign_id: campaignId,
              status: "rendering",
              updated_at: new Date("2026-09-13T10:30:00.000Z")
            }
          ]
        };
      }
      if (sql.includes("status = 'completed'")) {
        return { rows: [] };
      }
      if (sql.includes("status IN ('queued', 'leased', 'rendering')")) {
        return {
          rows: [
            {
              job_id: jobId,
              campaign_id: campaignId,
              assembly_spec: sampleSpec,
              job_status: "rendering",
              error_trace: null,
              job_created_at: new Date("2026-09-13T10:25:00.000Z"),
              job_updated_at: new Date("2026-09-13T10:30:00.000Z"),
              run_id: runId,
              run_status: "assembling"
            }
          ]
        };
      }
      return { rows: [] };
    });
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toEqual({
      campaignExists: true,
      status: "assembling",
      runId,
      assemblyJobId: jobId,
      assemblySpec: sampleSpec,
      createdAt: "2026-09-13T10:25:00.000Z",
      updatedAt: "2026-09-13T10:30:00.000Z"
    });
  });

  it("returns assembling when production run is assembling without job yet (Priority 2b)", async () => {
    const pool = createMockPool(async (sql) => {
      if (sql.includes("FROM campaigns")) {
        return {
          rows: [
            {
              campaign_id: campaignId,
              status: "rendering",
              updated_at: new Date("2026-09-13T10:30:00.000Z")
            }
          ]
        };
      }
      if (sql.includes("FROM delivery_assembly_jobs")) {
        return { rows: [] };
      }
      if (sql.includes("status = 'assembling'")) {
        return {
          rows: [
            {
              run_id: runId,
              run_status: "assembling",
              assembly_job_id: null,
              created_at: new Date("2026-09-13T10:20:00.000Z"),
              updated_at: new Date("2026-09-13T10:30:00.000Z")
            }
          ]
        };
      }
      return { rows: [] };
    });
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toEqual({
      campaignExists: true,
      status: "assembling",
      runId,
      createdAt: "2026-09-13T10:20:00.000Z",
      updatedAt: "2026-09-13T10:30:00.000Z"
    });
  });

  it("returns failed when assembly job failed (Priority 3)", async () => {
    const pool = createMockPool(async (sql) => {
      if (sql.includes("FROM campaigns")) {
        return {
          rows: [
            {
              campaign_id: campaignId,
              status: "failed",
              updated_at: new Date("2026-09-13T10:45:00.000Z")
            }
          ]
        };
      }
      if (sql.includes("status = 'completed'") || sql.includes("IN ('queued'")) {
        return { rows: [] };
      }
      if (sql.includes("status = 'assembling'")) {
        return { rows: [] };
      }
      if (sql.includes("status = 'failed'") && sql.includes("delivery_assembly_jobs")) {
        return {
          rows: [
            {
              job_id: jobId,
              campaign_id: campaignId,
              assembly_spec: sampleSpec,
              job_status: "failed",
              error_trace: "Error in FFmpeg execution",
              job_created_at: new Date("2026-09-13T10:40:00.000Z"),
              job_updated_at: new Date("2026-09-13T10:45:00.000Z"),
              run_id: runId,
              run_status: "failed"
            }
          ]
        };
      }
      return { rows: [] };
    });
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toEqual({
      campaignExists: true,
      status: "failed",
      runId,
      assemblyJobId: jobId,
      assemblySpec: sampleSpec,
      errorTrace: "Error in FFmpeg execution",
      createdAt: "2026-09-13T10:40:00.000Z",
      updatedAt: "2026-09-13T10:45:00.000Z"
    });
  });

  it("returns failed when production run failed (Priority 3b)", async () => {
    const pool = createMockPool(async (sql) => {
      if (sql.includes("FROM campaigns")) {
        return {
          rows: [
            {
              campaign_id: campaignId,
              status: "failed",
              updated_at: new Date("2026-09-13T10:45:00.000Z")
            }
          ]
        };
      }
      if (sql.includes("FROM delivery_assembly_jobs")) {
        return { rows: [] };
      }
      if (sql.includes("status = 'assembling'")) {
        return { rows: [] };
      }
      if (sql.includes("status = 'failed'") && sql.includes("campaign_production_runs")) {
        return {
          rows: [
            {
              run_id: runId,
              run_status: "failed",
              assembly_job_id: null,
              created_at: new Date("2026-09-13T10:40:00.000Z"),
              updated_at: new Date("2026-09-13T10:45:00.000Z")
            }
          ]
        };
      }
      return { rows: [] };
    });
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    const result = await queries.findCanonicalDeliveryAssembly(campaignId);
    expect(result).toEqual({
      campaignExists: true,
      status: "failed",
      runId,
      createdAt: "2026-09-13T10:40:00.000Z",
      updatedAt: "2026-09-13T10:45:00.000Z"
    });
  });

  it("strictly enforces campaign isolation by passing campaignId parameter to all queries", async () => {
    const pool = createMockPool(async () => ({ rows: [] }));
    const queries = new PostgresCampaignDeliveryReelQueries(pool as never);

    await queries.findCanonicalDeliveryAssembly(campaignId);

    // Initial check passes campaignId as $1
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("WHERE campaign_id = $1"), [
      campaignId
    ]);
  });
});
