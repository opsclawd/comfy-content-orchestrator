import { describe, expect, it } from "vitest";
import { CampaignDurationPlanningError } from "@cco/contracts";
import {
  AcceptedAttemptIdentityMismatchError,
  AcceptedAttemptOrdinalMismatchError,
  AcceptedAttemptRecordMissingError,
  AcceptedAttemptRevisionMismatchError,
  AcceptedAttemptSceneOrRunMismatchError,
  AssemblyDurationMismatchError,
  MissingAcceptedProductionManifestError,
  type CampaignId,
  type CampaignProductionRunRecord,
  type CampaignProductionRunSceneRecord,
  type SceneId
} from "@cco/domain";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import {
  attemptEnqueueAssemblyForAcceptedRun,
  StagingRenderIneligibleForAssemblyError
} from "./enqueue-delivery-assembly-for-accepted-run.js";

describe("attemptEnqueueAssemblyForAcceptedRun", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as CampaignId;
  const runId = "run-001";
  const validSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  function createBaseRun(
    overrides: Partial<CampaignProductionRunRecord> = {}
  ): CampaignProductionRunRecord {
    return {
      id: runId,
      campaignId,
      fingerprint: "fp-001",
      status: "production_review",
      expectedTotalDurationMs: 8000,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      ...overrides
    };
  }

  function createTwoScenes(): readonly [
    CampaignProductionRunSceneRecord,
    CampaignProductionRunSceneRecord
  ] {
    const scene1: CampaignProductionRunSceneRecord = {
      runId,
      sceneId: "scene-1" as SceneId,
      specRevision: 1,
      sequenceIndex: 1,
      expectedDurationMs: 4000,
      productionJobId: "job-1",
      currentAttemptId: "attempt-1",
      currentAttemptOrdinal: 1,
      acceptedAttemptId: "attempt-1",
      acceptedProductionJobId: "job-1",
      acceptedAttemptOrdinal: 1
    };
    const scene2: CampaignProductionRunSceneRecord = {
      runId,
      sceneId: "scene-2" as SceneId,
      specRevision: 1,
      sequenceIndex: 2,
      expectedDurationMs: 4000,
      productionJobId: "job-2",
      currentAttemptId: "attempt-2",
      currentAttemptOrdinal: 1,
      acceptedAttemptId: "attempt-2",
      acceptedProductionJobId: "job-2",
      acceptedAttemptOrdinal: 1
    };
    return [scene1, scene2];
  }

  it("returns enqueued: false when run status is not dispatched or production_review", async () => {
    const run = createBaseRun({ status: "assembling" });
    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result).toEqual({ enqueued: false });
    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("boundary guard: returns enqueued: false when run has zero scenes", async () => {
    const run = createBaseRun();
    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result).toEqual({ enqueued: false });
    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("returns enqueued: false when only a subset of required scenes are accepted", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();
    // scene2 is unaccepted
    const unacceptedScene2: CampaignProductionRunSceneRecord = {
      ...scene2,
      acceptedAttemptId: undefined,
      acceptedProductionJobId: undefined,
      acceptedAttemptOrdinal: undefined
    };

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, unacceptedScene2]);

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result).toEqual({ enqueued: false });
    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("happy path: enqueues assembly when all scenes are accepted and consistent", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result.enqueued).toBe(true);
    expect(result.assemblyJobId).toBeDefined();

    const enqueued = uow.enqueuedAssemblyJobs();
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.campaignId).toBe(campaignId);

    const spec = enqueued[0]!.assemblySpec;
    expect(spec.campaignId).toBe(campaignId);
    expect(spec.expectedTotalDurationMs).toBe(8000);
    expect(spec.videoStems).toHaveLength(2);

    // Canonical order preserved: scene1 is 0, scene2 is 1
    expect(spec.videoStems[0]!.sceneId).toBe("scene-1");
    expect(spec.videoStems[0]!.order).toBe(0);
    expect(spec.videoStems[0]!.generationManifestId).toBe("manifest-1");
    expect(spec.videoStems[1]!.sceneId).toBe("scene-2");
    expect(spec.videoStems[1]!.order).toBe(1);
    expect(spec.videoStems[1]!.generationManifestId).toBe("manifest-2");

    // Check run transitioned to assembling and stamped assemblyJobId
    const updatedRun = await uow.campaignProductionRuns.findById(runId);
    expect(updatedRun?.status).toBe("assembling");
    expect(updatedRun?.assemblyJobId).toBe(result.assemblyJobId);
  });

  it("canonical ordering is preserved even if run scenes are stored out of order", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    // Seed scene 2 before scene 1
    uow.seedCampaignProductionRunScenes([scene2, scene1]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result.enqueued).toBe(true);
    const spec = uow.enqueuedAssemblyJobs()[0]!.assemblySpec;
    expect(spec.videoStems[0]!.sceneId).toBe("scene-1");
    expect(spec.videoStems[0]!.order).toBe(0);
    expect(spec.videoStems[1]!.sceneId).toBe("scene-2");
    expect(spec.videoStems[1]!.order).toBe(1);
  });

  it("fails closed with AcceptedAttemptRecordMissingError when attempt record is missing", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);
    // Do not seed attempt for job-1

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AcceptedAttemptRecordMissingError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AcceptedAttemptIdentityMismatchError when attemptId disagrees", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-different",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AcceptedAttemptIdentityMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AcceptedAttemptSceneOrRunMismatchError on cross-scene or cross-run mismatch", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    // Attempt belongs to wrong scene
    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: "different-scene" as SceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AcceptedAttemptSceneOrRunMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AcceptedAttemptRevisionMismatchError when specRevision is stale", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    // Attempt has specRevision 2 while scene has 1
    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 2,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AcceptedAttemptRevisionMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AcceptedAttemptOrdinalMismatchError when ordinal disagrees", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    // Attempt has ordinal 2 while runScene has acceptedAttemptOrdinal 1
    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 2,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AcceptedAttemptOrdinalMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with MissingAcceptedProductionManifestError when manifest source is missing", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    // Seed only job-1, omit job-2 manifest
    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(MissingAcceptedProductionManifestError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AssemblyDurationMismatchError when total duration does not equal stem sum", async () => {
    // Run says expectedTotalDurationMs is 9000, but two scenes are 4000 each (sum 8000)
    const run = createBaseRun({ expectedTotalDurationMs: 9000 });
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AssemblyDurationMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with StagingRenderIneligibleForAssemblyError when stem has executionScope 'staging'", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      executionScope: "staging",
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      executionScope: "production",
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(StagingRenderIneligibleForAssemblyError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AssemblyDurationMismatchError when stem measured duration diverges from scene duration beyond tolerance", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      executionScope: "production",
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      },
      measuredMedia: {
        outputKey: "stems/scene-1.mp4",
        checksumSha256: validSha256,
        container: "ffprobe",
        dimensions: { width: 1344, height: 768 },
        frameCount: 124,
        fps: 24,
        durationMs: 5600, // expected 5000ms -> diff is 600ms > 355ms
        formatDurationMs: 5600,
        measurement: "source_bytes"
      }
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      executionScope: "production",
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AssemblyDurationMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with AssemblyDurationMismatchError when aggregate measured duration diverges from total duration beyond tolerance", async () => {
    const run = createBaseRun();
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      executionScope: "production",
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      },
      measuredMedia: {
        outputKey: "stems/scene-1.mp4",
        checksumSha256: validSha256,
        container: "ffprobe",
        dimensions: { width: 1344, height: 768 },
        frameCount: 124,
        fps: 24,
        durationMs: 5200, // +200ms
        formatDurationMs: 5200,
        measurement: "source_bytes"
      }
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      executionScope: "production",
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      },
      measuredMedia: {
        outputKey: "stems/scene-2.mp4",
        checksumSha256: validSha256,
        container: "ffprobe",
        dimensions: { width: 1344, height: 768 },
        frameCount: 124,
        fps: 24,
        durationMs: 5200, // +200ms -> aggregate is 10400ms vs expected 10000ms -> 400ms > 355ms
        formatDurationMs: 5200,
        measurement: "source_bytes"
      }
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(AssemblyDurationMismatchError);

    expect(uow.enqueuedAssemblyJobs()).toHaveLength(0);
  });

  it("fails closed with observation_authority_invalid when stem has missing realm or origin", async () => {
    const run = createBaseRun({ expectedTotalDurationMs: 8000 });
    const [scene1, scene2] = createTwoScenes();

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes([scene1, scene2]);

    uow.seedProductionAttempt({
      attemptId: "attempt-1",
      sceneId: scene1.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-1",
      specRevision: 1,
      seed: 123,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });
    uow.seedProductionAttempt({
      attemptId: "attempt-2",
      sceneId: scene2.sceneId,
      runId,
      ordinal: 1,
      productionJobId: "job-2",
      specRevision: 1,
      seed: 456,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-01T00:00:00.000Z"
    });

    uow.seedVideoStemSource("job-1", {
      generationManifestId: "manifest-1",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-1.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      },
      realm: undefined,
      evidenceOrigin: undefined
    });
    uow.seedVideoStemSource("job-2", {
      generationManifestId: "manifest-2",
      renderAttempt: 1,
      media: {
        bucket: "delivery-bucket",
        key: "stems/scene-2.mp4",
        sha256: validSha256,
        contentType: "video/mp4"
      }
    });

    await expect(
      uow.execute(async (ctx) => {
        return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
      })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  it("ordinary certified witness: 3-stem legacy H3 run with 15,501ms expected and truthful 124f (15,500ms) observations passes admission and enqueues assembly", async () => {
    const run: CampaignProductionRunRecord = {
      id: "run-3stem",
      campaignId: "campaign-3stem" as CampaignId,
      fingerprint: "fp-3stem",
      status: "production_review",
      expectedTotalDurationMs: 15_501,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };

    const scenes: CampaignProductionRunSceneRecord[] = [1, 2, 3].map((idx) => ({
      runId: "run-3stem",
      sceneId: `scene-${idx}` as SceneId,
      specRevision: 1,
      sequenceIndex: idx,
      expectedDurationMs: 5_167,
      productionJobId: `job-${idx}`,
      currentAttemptId: `attempt-${idx}`,
      currentAttemptOrdinal: 1,
      acceptedAttemptId: `attempt-${idx}`,
      acceptedProductionJobId: `job-${idx}`,
      acceptedAttemptOrdinal: 1
    }));

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes(scenes);

    for (let idx = 1; idx <= 3; idx++) {
      uow.seedProductionAttempt({
        attemptId: `attempt-${idx}`,
        sceneId: `scene-${idx}` as SceneId,
        runId: "run-3stem",
        ordinal: 1,
        productionJobId: `job-${idx}`,
        specRevision: 1,
        seed: 100 * idx,
        createdReason: "initial_dispatch",
        ownerKind: "production_run",
        createdAt: "2026-09-01T00:00:00.000Z"
      });

      uow.seedVideoStemSource(`job-${idx}`, {
        generationManifestId: `manifest-${idx}`,
        renderAttempt: 1,
        media: {
          bucket: "delivery-bucket",
          key: `stems/scene-${idx}.mp4`,
          sha256: validSha256,
          contentType: "video/mp4"
        },
        executionScope: "production",
        ownerKind: "production_run",
        realm: { kind: "deployed", deploymentId: "default" },
        evidenceOrigin: "live_execution",
        measuredMedia: {
          measurement: "source_bytes",
          outputKey: "video",
          container: "ffprobe",
          durationMs: (124 / 24) * 1000,
          formatDurationMs: (124 / 24) * 1000,
          frameCount: 124,
          fps: 24,
          dimensions: {
            width: 1344,
            height: 768
          },
          video: {
            codecName: "h264",
            pixelFormat: "yuv420p"
          },
          checksumSha256: validSha256
        }
      });
    }

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result.enqueued).toBe(true);
    expect(uow.enqueuedAssemblyJobs()).toHaveLength(1);
    const job = uow.enqueuedAssemblyJobs()[0]!;
    expect(job.assemblySpec.videoStems).toHaveLength(3);
    expect(job.assemblySpec.expectedTotalDurationMs).toBe(15_501);
  });

  it("ordinary certified witness: 6-stem legacy H3 run with 31,002ms expected and truthful 124f (31,000ms) observations passes admission and enqueues assembly", async () => {
    const run: CampaignProductionRunRecord = {
      id: "run-6stem",
      campaignId: "campaign-6stem" as CampaignId,
      fingerprint: "fp-6stem",
      status: "production_review",
      expectedTotalDurationMs: 31_002,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z"
    };

    const scenes: CampaignProductionRunSceneRecord[] = [1, 2, 3, 4, 5, 6].map((idx) => ({
      runId: "run-6stem",
      sceneId: `scene-${idx}` as SceneId,
      specRevision: 1,
      sequenceIndex: idx,
      expectedDurationMs: 5_167,
      productionJobId: `job-${idx}`,
      currentAttemptId: `attempt-${idx}`,
      currentAttemptOrdinal: 1,
      acceptedAttemptId: `attempt-${idx}`,
      acceptedProductionJobId: `job-${idx}`,
      acceptedAttemptOrdinal: 1
    }));

    const uow = new InMemorySceneUnitOfWork();
    uow.seedCampaignProductionRun(run);
    uow.seedCampaignProductionRunScenes(scenes);

    for (let idx = 1; idx <= 6; idx++) {
      uow.seedProductionAttempt({
        attemptId: `attempt-${idx}`,
        sceneId: `scene-${idx}` as SceneId,
        runId: "run-6stem",
        ordinal: 1,
        productionJobId: `job-${idx}`,
        specRevision: 1,
        seed: 100 * idx,
        createdReason: "initial_dispatch",
        ownerKind: "production_run",
        createdAt: "2026-09-01T00:00:00.000Z"
      });

      uow.seedVideoStemSource(`job-${idx}`, {
        generationManifestId: `manifest-${idx}`,
        renderAttempt: 1,
        media: {
          bucket: "delivery-bucket",
          key: `stems/scene-${idx}.mp4`,
          sha256: validSha256,
          contentType: "video/mp4"
        },
        executionScope: "production",
        ownerKind: "production_run",
        realm: { kind: "deployed", deploymentId: "default" },
        evidenceOrigin: "live_execution",
        measuredMedia: {
          measurement: "source_bytes",
          outputKey: "video",
          container: "ffprobe",
          durationMs: (124 / 24) * 1000,
          formatDurationMs: (124 / 24) * 1000,
          frameCount: 124,
          fps: 24,
          dimensions: {
            width: 1344,
            height: 768
          },
          video: {
            codecName: "h264",
            pixelFormat: "yuv420p"
          },
          checksumSha256: validSha256
        }
      });
    }

    const result = await uow.execute(async (ctx) => {
      return attemptEnqueueAssemblyForAcceptedRun(ctx, run);
    });

    expect(result.enqueued).toBe(true);
    expect(uow.enqueuedAssemblyJobs()).toHaveLength(1);
    const job = uow.enqueuedAssemblyJobs()[0]!;
    expect(job.assemblySpec.videoStems).toHaveLength(6);
    expect(job.assemblySpec.expectedTotalDurationMs).toBe(31_002);
  });
});
