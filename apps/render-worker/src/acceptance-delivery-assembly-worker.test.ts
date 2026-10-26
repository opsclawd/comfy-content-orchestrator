import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { BUCKETS } from "@cco/shared";
import type {
  AcceptanceAssemblyJob,
  AssemblyExecutionResult,
  AssemblyManifest
} from "@cco/contracts";
import { InMemorySceneUnitOfWork } from "../../../packages/application/src/test-support/in-memory-scene-unit-of-work.js";
import {
  AcceptanceDeliveryAssemblyWorker,
  type AcceptanceAssemblyJobExecutor
} from "./acceptance-delivery-assembly-worker.js";

describe("AcceptanceDeliveryAssemblyWorker", () => {
  const dummySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const dummyRealm = {
    kind: "isolated_test" as const,
    testRealmId: "test",
    isolationDescriptorDigest: "0".repeat(64)
  };

  const dummyJob: AcceptanceAssemblyJob = {
    jobId: randomUUID(),
    acceptanceRunId: randomUUID(),
    campaignId: randomUUID(),
    status: "queued",
    realm: dummyRealm,
    evidenceOrigin: "simulated_test",
    assemblySpec: {
      campaignId: "campaign-1",
      assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
      expectedTotalDurationMs: 5000,
      videoStems: [],
      subtitleCues: []
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const dummyManifest: AssemblyManifest = {
    assemblyId: "test-assembly-1",
    createdAt: new Date().toISOString(),
    campaignId: dummyJob.campaignId,
    assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
    generationManifestIds: ["gen-1"],
    inputs: {
      videoStems: [
        {
          sceneId: randomUUID(),
          generationManifestId: "gen-1",
          order: 0,
          media: {
            bucket: "godzspeed-review",
            key: "scene-1.mp4",
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          },
          actualDurationMs: 5000
        }
      ]
    },
    timeline: { totalDurationMs: 5000, stemDurationsMs: [5000] },
    subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    layout: { mode: "fit_blurred_fill" },
    ffmpeg: { executable: "ffmpeg", version: "7.0.2", buildInfo: "" },
    commandFingerprint: "0".repeat(64),
    encoding: {
      video: { codec: "libx264", pixelFormat: "yuv420p", crf: 23, preset: "veryfast" }
    },
    streams: {
      video: {
        codecName: "h264",
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        frameRate: 30,
        durationMs: 5000
      }
    },
    output: {
      media: {
        bucket: BUCKETS.CANDIDATES,
        key: `acceptance-runs/${dummyJob.acceptanceRunId}/reel.mp4`,
        sha256: dummySha256,
        contentType: "video/mp4"
      },
      durationMs: 5000,
      width: 1080,
      height: 1920
    },
    measuredFrameRate: 30,
    executionDurationMs: 1200,
    governanceDecisionId: "gov-1"
  };

  const dummyExecutionResult: AssemblyExecutionResult = {
    assemblyId: "test-assembly-1",
    campaignId: dummyJob.campaignId,
    assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
    executedInputs: dummyManifest.inputs,
    timeline: { totalDurationMs: 5000, stemDurationsMs: [5000] },
    layout: { mode: "fit_blurred_fill" },
    subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    ffmpeg: { executable: "ffmpeg", version: "7.0.2", buildInfo: "" },
    commandFingerprint: "0".repeat(64),
    encoding: {
      video: { codec: "libx264", pixelFormat: "yuv420p", crf: 23, preset: "veryfast" }
    },
    streams: {
      video: {
        codecName: "h264",
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        frameRate: 30,
        durationMs: 5000
      }
    },
    output: {
      media: {
        bucket: BUCKETS.CANDIDATES,
        key: `acceptance-runs/${dummyJob.acceptanceRunId}/reel.mp4`,
        sha256: dummySha256,
        contentType: "video/mp4"
      },
      durationMs: 5000,
      width: 1080,
      height: 1920
    },
    measuredFrameRate: 30,
    executionDurationMs: 1200
  };

  it("returns undefined when no job is in queue", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const mockExecutor: AcceptanceAssemblyJobExecutor = vi.fn();
    const worker = new AcceptanceDeliveryAssemblyWorker(
      { uow, assembleDeliveryReel: mockExecutor },
      { workerId: "test-worker-1" }
    );

    const result = await worker.processNextJob();
    expect(result).toBeUndefined();
    expect(mockExecutor).not.toHaveBeenCalled();
  });

  it("claims, executes with BUCKETS.CANDIDATES, saves manifest, and marks completed", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const mockExecutor: AcceptanceAssemblyJobExecutor = vi.fn(async ({ spec, targetBucket }) => {
      expect(targetBucket).toBe(BUCKETS.CANDIDATES);
      expect(spec).toEqual(dummyJob.assemblySpec);
      return { manifest: dummyManifest, executionResult: dummyExecutionResult };
    });

    const testPlanId = randomUUID();
    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: dummyJob.acceptanceRunId,
          campaignId: dummyJob.campaignId,
          status: "assembling",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: testPlanId,
          expectedTotalDurationMs: 5000,
          assemblyJobId: dummyJob.jobId,
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
      await ctx.acceptanceAssemblyJobs!.enqueue(dummyJob);
    });

    const worker = new AcceptanceDeliveryAssemblyWorker(
      { uow, assembleDeliveryReel: mockExecutor },
      { workerId: "test-worker-1" }
    );

    const manifestRecord = await worker.processNextJob();
    expect(manifestRecord).toBeDefined();
    expect(manifestRecord!.jobId).toBe(dummyJob.jobId);
    expect(manifestRecord!.acceptanceRunId).toBe(dummyJob.acceptanceRunId);
    expect(manifestRecord!.planId).toBe(testPlanId);
    expect(manifestRecord!.storageBucket).toBe(BUCKETS.CANDIDATES);
    expect(manifestRecord!.storageKey).toBe(`acceptance-runs/${dummyJob.acceptanceRunId}/reel.mp4`);
    expect(manifestRecord!.storageSha256).toBe(dummySha256);

    await uow.execute(async (ctx) => {
      const savedJob = await ctx.acceptanceAssemblyJobs!.findById(dummyJob.jobId);
      expect(savedJob?.status).toBe("completed");

      const run = await ctx.operatorAcceptanceRuns!.findRunById(dummyJob.acceptanceRunId);
      expect(run?.status).toBe("completed");

      const savedManifest = await ctx.acceptanceAssemblyManifests!.findByRunId(
        dummyJob.acceptanceRunId
      );
      expect(savedManifest).toBeDefined();
      expect(savedManifest?.manifestId).toBe(manifestRecord!.manifestId);
      expect(savedManifest?.planId).toBe(testPlanId);
    });
  });

  it("marks job and run failed when assembleDeliveryReel throws standard error", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const mockExecutor: AcceptanceAssemblyJobExecutor = vi.fn(async () => {
      throw new Error("FFmpeg encode failed: test failure");
    });

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: dummyJob.acceptanceRunId,
          campaignId: dummyJob.campaignId,
          status: "assembling",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          assemblyJobId: dummyJob.jobId,
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
      await ctx.acceptanceAssemblyJobs!.enqueue(dummyJob);
    });

    const worker = new AcceptanceDeliveryAssemblyWorker(
      { uow, assembleDeliveryReel: mockExecutor },
      { workerId: "test-worker-1" }
    );

    await expect(worker.processNextJob()).rejects.toThrow("FFmpeg encode failed: test failure");

    await uow.execute(async (ctx) => {
      const savedJob = await ctx.acceptanceAssemblyJobs!.findById(dummyJob.jobId);
      expect(savedJob?.status).toBe("failed");
      expect(savedJob?.failureReason).toContain("FFmpeg encode failed");

      const run = await ctx.operatorAcceptanceRuns!.findRunById(dummyJob.acceptanceRunId);
      expect(run?.status).toBe("failed");
    });
  });

  it("does not overwrite run status to failed if error is lease fencing/expiry", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const mockExecutor: AcceptanceAssemblyJobExecutor = vi.fn(async () => {
      throw new Error("Worker lease expired: job stolen by another worker");
    });

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: dummyJob.acceptanceRunId,
          campaignId: dummyJob.campaignId,
          status: "assembling",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          assemblyJobId: dummyJob.jobId,
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
      await ctx.acceptanceAssemblyJobs!.enqueue(dummyJob);
    });

    const worker = new AcceptanceDeliveryAssemblyWorker(
      { uow, assembleDeliveryReel: mockExecutor },
      { workerId: "test-worker-1" }
    );

    await expect(worker.processNextJob()).rejects.toThrow("Worker lease expired");

    await uow.execute(async (ctx) => {
      const run = await ctx.operatorAcceptanceRuns!.findRunById(dummyJob.acceptanceRunId);
      // Run status should still be "assembling", not overwritten to "failed"
      expect(run?.status).toBe("assembling");
    });
  });
});
