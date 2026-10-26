import { describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  createAssemblyManifest,
  OperatorAcceptanceRunNotFoundError,
  CampaignDurationPlanningError,
  type AcceptanceAssemblyManifest,
  type AssemblyExecutionResult
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import type { CampaignId } from "@cco/domain";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { ResolveOperatorAcceptanceReelUseCase } from "./resolve-operator-acceptance-reel.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { ReviewMediaDeliveryPort } from "../ports/review-media-delivery-port.js";

describe("ResolveOperatorAcceptanceReelUseCase", () => {
  const dummySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const dummyRealm = {
    kind: "isolated_test" as const,
    testRealmId: "test",
    isolationDescriptorDigest: "0".repeat(64)
  };

  const defaultMockStorage: ObjectStoragePort = {
    getObject: vi.fn(async () => undefined),
    putObject: vi.fn(),
    copyObject: vi.fn()
  };

  const defaultMockDelivery: ReviewMediaDeliveryPort = {
    generatePresignedReadUrl: vi.fn(
      async ({ bucket, key }) => `https://signed.example.com/${bucket}/${key}`
    )
  };

  const dummyExecutionResult: AssemblyExecutionResult = {
    assemblyId: "test-assembly-123",
    campaignId: "campaign-123",
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    executedInputs: {
      videoStems: [
        {
          sceneId: "11111111-1111-4111-8111-111111111111",
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
    timeline: {
      totalDurationMs: 5000,
      stemDurationsMs: [5000]
    },
    layout: {
      mode: "fit_blurred_fill"
    },
    subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    ffmpeg: {
      executable: "/usr/bin/ffmpeg",
      version: "7.0.2",
      buildInfo: "ffmpeg version 7.0.2"
    },
    commandFingerprint: "0".repeat(64),
    encoding: {
      video: {
        codec: "libx264",
        pixelFormat: "yuv420p",
        crf: 23,
        preset: "veryfast"
      }
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
        key: "acceptance-runs/test/reel.mp4",
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

  it("throws OperatorAcceptanceRunNotFoundError when run does not exist", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: defaultMockStorage,
      mediaDelivery: defaultMockDelivery
    });

    await expect(
      useCase.execute({ acceptanceRunId: randomUUID(), reviewerName: "operator-primary" })
    ).rejects.toThrow(OperatorAcceptanceRunNotFoundError);
  });

  it("returns pending status when run is dispatched", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
    });

    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: defaultMockStorage,
      mediaDelivery: defaultMockDelivery
    });
    const result = await useCase.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary"
    });

    expect(result.status).toBe("pending");
    expect(result.acceptanceRunId).toBe(runId);
    expect(result.campaignId).toBe(campaignId);
  });

  it("returns assembling status when run is assembling", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;
    const jobId = randomUUID();

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
      await ctx.operatorAcceptanceRuns!.updateRunStatus(runId, "assembling", jobId, "action-2");
    });

    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: defaultMockStorage,
      mediaDelivery: defaultMockDelivery
    });
    const result = await useCase.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary"
    });

    expect(result.status).toBe("assembling");
    expect(result.acceptanceRunId).toBe(runId);
    if (result.status === "assembling") {
      expect(result.assemblyJobId).toBe(jobId);
    }
  });

  it("returns unavailable when manifest is missing for completed run", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;
    const jobId = randomUUID();

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
      await ctx.operatorAcceptanceRuns!.updateRunStatus(runId, "completed", jobId, "action-3");
    });

    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: defaultMockStorage,
      mediaDelivery: defaultMockDelivery
    });
    const result = await useCase.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary"
    });

    expect(result.status).toBe("unavailable");
  });

  it("returns unavailable when storage object is missing or sha256 mismatches", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;
    const jobId = randomUUID();
    const manifestId = randomUUID();

    const manifestRecord: AcceptanceAssemblyManifest = {
      manifestId,
      jobId,
      acceptanceRunId: runId,
      campaignId,
      realm: dummyRealm,
      evidenceOrigin: "simulated_test",
      planId: randomUUID(),
      acceptedAttemptIds: [randomUUID()],
      storageBucket: BUCKETS.CANDIDATES,
      storageKey: `acceptance-runs/${runId}/reel.mp4`,
      storageSha256: dummySha256,
      manifestStorageBucket: BUCKETS.CANDIDATES,
      manifestStorageKey: `acceptance-runs/${runId}/manifest.json`,
      manifestStorageSha256: dummySha256,
      manifest: createAssemblyManifest({
        executionResult: { ...dummyExecutionResult, campaignId },
        governanceDecisionId: "gov-1"
      }),
      createdAt: new Date().toISOString()
    };

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
      await ctx.operatorAcceptanceRuns!.updateRunStatus(runId, "completed", jobId, "action-3");
      await ctx.acceptanceAssemblyJobs!.enqueue({
        jobId,
        acceptanceRunId: runId,
        campaignId,
        realm: dummyRealm,
        evidenceOrigin: "simulated_test",
        assemblySpec: {
          campaignId,
          assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
          expectedTotalDurationMs: 5000,
          videoStems: [],
          subtitleCues: []
        }
      });
      await ctx.acceptanceAssemblyJobs!.complete(jobId, manifestId);
      await ctx.acceptanceAssemblyManifests!.saveManifest(manifestRecord);
    });

    const mockStorageMissing: ObjectStoragePort = {
      getObject: vi.fn(async () => undefined),
      putObject: vi.fn(),
      copyObject: vi.fn()
    };

    const useCaseMissing = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: mockStorageMissing,
      mediaDelivery: defaultMockDelivery
    });
    const resultMissing = await useCaseMissing.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary"
    });
    expect(resultMissing.status).toBe("unavailable");

    const mockStorageCorrupted: ObjectStoragePort = {
      getObject: vi.fn(async () => ({
        body: Buffer.from("bad"),
        bucket: BUCKETS.CANDIDATES,
        key: `acceptance-runs/${runId}/reel.mp4`,
        checksumSha256: "0".repeat(64),
        contentLength: 3,
        contentType: "video/mp4"
      })),
      putObject: vi.fn(),
      copyObject: vi.fn()
    };

    const useCaseCorrupted = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: mockStorageCorrupted,
      mediaDelivery: defaultMockDelivery
    });
    const resultCorrupted = await useCaseCorrupted.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary"
    });
    expect(resultCorrupted.status).toBe("unavailable");
  });

  it("returns completed with verified playback url and stem lineage when everything matches", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;
    const jobId = randomUUID();
    const manifestId = randomUUID();
    const sceneId = "11111111-1111-4111-8111-111111111111";
    const attemptId = randomUUID();
    const videoContent = Buffer.from("video content");
    const videoSha256 = createHash("sha256").update(videoContent).digest("hex");

    const manifestObject = createAssemblyManifest({
      executionResult: { ...dummyExecutionResult, campaignId },
      governanceDecisionId: "gov-1"
    });
    const manifestJson = JSON.stringify(manifestObject);
    const manifestBytes = Buffer.from(manifestJson, "utf8");
    const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");

    const manifestRecord: AcceptanceAssemblyManifest = {
      manifestId,
      jobId,
      acceptanceRunId: runId,
      campaignId,
      realm: dummyRealm,
      evidenceOrigin: "simulated_test",
      planId: randomUUID(),
      acceptedAttemptIds: [attemptId],
      storageBucket: BUCKETS.CANDIDATES,
      storageKey: `acceptance-runs/${runId}/reel.mp4`,
      storageSha256: videoSha256,
      manifestStorageBucket: BUCKETS.CANDIDATES,
      manifestStorageKey: `acceptance-runs/${runId}/manifest.json`,
      manifestStorageSha256: manifestSha256,
      manifest: manifestObject,
      createdAt: new Date().toISOString()
    };

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        [
          {
            acceptanceRunId: runId,
            sceneId,
            allocationId: randomUUID(),
            specRevision: 1,
            sequenceIndex: 0,
            profileKey: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
            frames: 120,
            fps: 24,
            expectedDurationMs: 5000,
            currentAttemptOrdinal: 1,
            currentAttemptId: attemptId,
            acceptedAttemptId: attemptId,
            acceptedStagingJobId: "staging-job-1"
          }
        ]
      );
      await ctx.operatorAcceptanceRuns!.updateRunStatus(runId, "completed", jobId, "action-3");
      await ctx.acceptanceAssemblyJobs!.enqueue({
        jobId,
        acceptanceRunId: runId,
        campaignId,
        realm: dummyRealm,
        evidenceOrigin: "simulated_test",
        assemblySpec: {
          campaignId,
          assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
          expectedTotalDurationMs: 5000,
          videoStems: [],
          subtitleCues: []
        }
      });
      await ctx.acceptanceAssemblyJobs!.complete(jobId, manifestId);
      await ctx.acceptanceAssemblyManifests!.saveManifest(manifestRecord);
    });

    const mockStorage: ObjectStoragePort = {
      getObject: vi.fn(async (locator) => {
        if (locator.key.endsWith("manifest.json")) {
          return {
            body: manifestBytes,
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: manifestSha256,
            contentLength: manifestBytes.length,
            contentType: "application/json"
          };
        }
        return {
          body: videoContent,
          bucket: BUCKETS.CANDIDATES,
          key: `acceptance-runs/${runId}/reel.mp4`,
          checksumSha256: videoSha256,
          contentLength: videoContent.length,
          contentType: "video/mp4"
        };
      }),
      putObject: vi.fn(),
      copyObject: vi.fn()
    };

    const mockDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(async () => "https://s3.example.com/signed/reel.mp4")
    };

    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: mockStorage,
      mediaDelivery: mockDelivery
    });

    const result = await useCase.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary"
    });

    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.acceptanceRunId).toBe(runId);
      expect(result.campaignId).toBe(campaignId);
      expect(result.assemblyJobId).toBe(jobId);
      expect(result.manifestId).toBe(manifestId);
      expect(result.storageBucket).toBe(BUCKETS.CANDIDATES);
      expect(result.storageKey).toBe(`acceptance-runs/${runId}/reel.mp4`);
      expect(result.storageSha256).toBe(videoSha256);
      expect(result.durationMs).toBe(5000);
      expect(result.frameCount).toBe(150);
      expect(result.fps).toBe(30);
      expect(result.resolution).toEqual({ width: 1080, height: 1920 });
      expect(result.url).toBe("https://s3.example.com/signed/reel.mp4");
      expect(result.stemLineage).toHaveLength(1);
      expect(result.stemLineage![0]!.sceneId).toBe(sceneId);
      expect(result.stemLineage![0]!.attemptId).toBe(attemptId);
      expect(result.stemLineage![0]!.storageKey).toBe("scene-1.mp4");
      expect(result.stemLineage![0]!.sha256).toBe("a".repeat(64));
    }
  });

  it("rejects when reviewer identity is missing, empty, or anonymous", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;

    await uow.execute(async (ctx) => {
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
    });

    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: defaultMockStorage,
      mediaDelivery: defaultMockDelivery
    });

    await expect(useCase.execute({ acceptanceRunId: runId, reviewerName: "" })).rejects.toThrow(
      CampaignDurationPlanningError
    );

    await expect(useCase.execute({ acceptanceRunId: runId, reviewerName: "   " })).rejects.toThrow(
      CampaignDurationPlanningError
    );

    await expect(
      useCase.execute({ acceptanceRunId: runId, reviewerName: "anonymous" })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  it("rejects cross-client access when campaign client ID does not match request client ID", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const runId = randomUUID();
    const campaignId = randomUUID() as CampaignId;

    await uow.execute(async (ctx) => {
      await ctx.campaigns!.save({
        id: campaignId,
        clientId: "client-authorized",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "planning",
        totalScenes: 1,
        targetTotalDurationMs: 5000,
        approvedScenes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await ctx.operatorAcceptanceRuns!.createRun(
        {
          acceptanceRunId: runId,
          campaignId,
          status: "dispatched",
          realm: dummyRealm,
          evidenceOrigin: "simulated_test",
          planId: randomUUID(),
          expectedTotalDurationMs: 5000,
          actionReceiptId: "action-1",
          createdBy: "tester",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        []
      );
    });

    const useCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage: defaultMockStorage,
      mediaDelivery: defaultMockDelivery
    });

    await expect(
      useCase.execute({
        acceptanceRunId: runId,
        reviewerName: "operator-primary",
        clientId: "client-intruder"
      })
    ).rejects.toThrow(CampaignDurationPlanningError);

    const authorizedResult = await useCase.execute({
      acceptanceRunId: runId,
      reviewerName: "operator-primary",
      clientId: "client-authorized"
    });
    expect(authorizedResult.status).toBe("pending");
  });
});
