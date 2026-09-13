import { describe, expect, it, vi } from "vitest";
import {
  computeAssemblyId,
  createAssemblyManifest,
  NO_SUBTITLE_CUES_SHA256,
  type AssemblyExecutionResult,
  type AssemblySpec
} from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import { BUCKETS } from "@cco/shared";
import type {
  CampaignDeliveryReelQueries,
  CanonicalDeliveryAssemblyRecord,
  ObjectLocator,
  ObjectStoragePort,
  PersistentObjectLocator,
  ReviewMediaDeliveryPort,
  StoredObject
} from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import {
  buildCampaignDeliveryReelReadModel,
  ResolveCampaignDeliveryReelUseCase
} from "./resolve-campaign-delivery-reel.js";

describe("ResolveCampaignDeliveryReelUseCase and buildCampaignDeliveryReelReadModel", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
  const runId = "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const assemblyJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000003";
  const validSha = "a".repeat(64);
  const mediaSha = "b".repeat(64);

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

  const expectedAssemblyId = computeAssemblyId(sampleSpec);

  const sampleExecutionResult: AssemblyExecutionResult = {
    assemblyId: expectedAssemblyId,
    campaignId,
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    executedInputs: {
      videoStems: [
        {
          sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000011",
          generationManifestId: "gen-man-1",
          order: 0,
          actualDurationMs: 5000,
          media: {
            bucket: "renders",
            key: `campaigns/${campaignId}/scenes/scene-1.mp4`,
            sha256: validSha,
            contentType: "video/mp4"
          }
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
    subtitleCuesSha256: NO_SUBTITLE_CUES_SHA256,
    ffmpeg: {
      executable: "ffmpeg",
      version: "7.0.2-static",
      buildInfo: "gcc 13"
    },
    commandFingerprint: "c".repeat(64),
    encoding: {
      video: {
        codec: "libx264",
        pixelFormat: "yuv420p"
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
      durationMs: 5000,
      width: 1080,
      height: 1920,
      media: {
        bucket: BUCKETS.DELIVERY,
        key: `campaigns/${campaignId}/assemblies/${expectedAssemblyId}/output.mp4`,
        sha256: mediaSha,
        contentType: "video/mp4"
      }
    },
    measuredFrameRate: 30,
    executionDurationMs: 2500
  };

  const sampleManifest = createAssemblyManifest({
    executionResult: sampleExecutionResult,
    governanceDecisionId: "gov-dec-1"
  });

  const createMockStorage = (overrides?: {
    manifestBody?: Uint8Array | null;
    manifestError?: Error;
    headResult?: { bucket: string; key: string; checksumSha256?: string } | null;
    headError?: Error;
  }): ObjectStoragePort => {
    const manifestJson = JSON.stringify(sampleManifest);
    const body =
      overrides?.manifestBody !== undefined
        ? overrides.manifestBody
        : new TextEncoder().encode(manifestJson);

    return {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn(async (locator: ObjectLocator): Promise<StoredObject | undefined> => {
        if (overrides?.manifestError) {
          throw overrides.manifestError;
        }
        if (body === null) {
          return undefined;
        }
        return {
          bucket: locator.bucket,
          key: locator.key,
          body
        };
      }),
      headObject: vi.fn(async (locator: ObjectLocator) => {
        if (overrides?.headError) {
          throw overrides.headError;
        }
        if (overrides?.headResult === null) {
          return undefined;
        }
        return (
          overrides?.headResult ?? {
            bucket: locator.bucket,
            key: locator.key,
            checksumSha256: mediaSha
          }
        );
      })
    };
  };

  const createMockMediaDelivery = (overrides?: {
    url?: string;
    error?: Error;
  }): ReviewMediaDeliveryPort => ({
    generatePresignedReadUrl: vi.fn(async (locator: PersistentObjectLocator) => {
      if (overrides?.error) {
        throw overrides.error;
      }
      return (
        overrides?.url ??
        `https://delivery.example.com/${locator.bucket}/${locator.key}?sig=presigned`
      );
    })
  });

  it("resolves not-started state when no assembly has been dispatched", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "not-started",
      updatedAt: "2026-09-13T10:00:00.000Z"
    };
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record
    });

    expect(result.status).toBe("not-started");
    expect(result.state).toBe("not-started");
    expect(result.campaignId).toBe(campaignId);
    expect(result.media).toBeUndefined();
    expect(result.manifest).toBeUndefined();
    expect(result.updatedAt).toBe("2026-09-13T10:00:00.000Z");
  });

  it("resolves assembling state when assembly job is in-flight", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "assembling",
      runId,
      assemblyJobId,
      updatedAt: "2026-09-13T10:30:00.000Z"
    };
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record
    });

    expect(result.status).toBe("assembling");
    expect(result.state).toBe("assembling");
    expect(result.campaignId).toBe(campaignId);
    expect(result.runId).toBe(runId);
    expect(result.assemblyJobId).toBe(assemblyJobId);
  });

  it("resolves failed state when assembly failed", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "failed",
      runId,
      assemblyJobId,
      errorTrace: "Media assembler exited with non-zero code",
      updatedAt: "2026-09-13T10:45:00.000Z"
    };
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record
    });

    expect(result.status).toBe("failed");
    expect(result.state).toBe("failed");
    expect(result.campaignId).toBe(campaignId);
    expect(result.runId).toBe(runId);
    expect(result.assemblyJobId).toBe(assemblyJobId);
    expect(result.error).toBe("Media assembler exited with non-zero code");
  });

  it("resolves completed state with presigned URL on happy path", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec,
      updatedAt: "2026-09-13T11:00:00.000Z"
    };
    const storage = createMockStorage();
    const mediaDelivery = createMockMediaDelivery();

    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery
    });

    expect(result.status).toBe("completed");
    expect(result.state).toBe("completed");
    expect(result.campaignId).toBe(campaignId);
    expect(result.assemblyId).toBe(expectedAssemblyId);
    expect(result.runId).toBe(runId);
    expect(result.assemblyJobId).toBe(assemblyJobId);
    expect(result.manifest).toBeDefined();
    expect(result.manifest?.assemblyId).toBe(expectedAssemblyId);
    expect(result.media).toBeDefined();
    expect(result.media?.url).toContain("https://delivery.example.com/");
    expect(result.media?.sha256).toBe(mediaSha);
    expect(result.media?.durationMs).toBe(5000);
    expect(result.media?.width).toBe(1080);
    expect(result.media?.height).toBe(1920);

    expect(mediaDelivery.generatePresignedReadUrl).toHaveBeenCalledWith(
      {
        bucket: BUCKETS.DELIVERY,
        key: `campaigns/${campaignId}/assemblies/${expectedAssemblyId}/output.mp4`,
        contentHash: mediaSha
      },
      300
    );
  });

  it("fails closed to unavailable-artifact when assemblySpec is missing on completed job", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId
    };
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: createMockStorage(),
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("missing assemblySpec");
  });

  it("fails closed to unavailable-artifact when spec campaignId disagrees with requested campaign (isolation)", async () => {
    const otherCampaign = "01950c46-9e90-7d3d-82d2-8f1d3c000099";
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: {
        ...sampleSpec,
        campaignId: otherCampaign
      }
    };
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: createMockStorage(),
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("campaignId does not match requested campaign");
  });

  it("fails closed to unavailable-artifact when manifest missing in storage", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage({ manifestBody: null });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("manifest object was not found in storage");
  });

  it("fails closed to unavailable-artifact when manifest JSON is corrupt", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage({
      manifestBody: new TextEncoder().encode("not-valid-json{")
    });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("manifest is corrupt or invalid");
  });

  it("fails closed to unavailable-artifact when manifest campaignId belongs to another campaign (isolation)", async () => {
    const otherCampaign = "01950c46-9e90-7d3d-82d2-8f1d3c000099";
    const foreignExecutionResult: AssemblyExecutionResult = {
      ...sampleExecutionResult,
      campaignId: otherCampaign
    };
    const foreignManifest = createAssemblyManifest({
      executionResult: foreignExecutionResult,
      governanceDecisionId: "gov-foreign"
    });

    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage({
      manifestBody: new TextEncoder().encode(JSON.stringify(foreignManifest))
    });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("Manifest campaignId does not match");
  });

  it("fails closed to unavailable-artifact when output media key is outside campaign namespace", async () => {
    const tamperedManifest = {
      ...sampleManifest,
      output: {
        ...sampleManifest.output,
        media: {
          ...sampleManifest.output.media,
          key: "campaigns/other-campaign/assemblies/asm-1/output.mp4"
        }
      }
    };
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage({
      manifestBody: new TextEncoder().encode(JSON.stringify(tamperedManifest))
    });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("does not belong to requested campaign namespace");
  });

  it("fails closed to unavailable-artifact when output media object is missing in storage", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage({ headResult: null });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("output media object was not found in storage");
  });

  it("fails closed to unavailable-artifact when storage checksum disagrees with manifest", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage({
      headResult: {
        bucket: BUCKETS.DELIVERY,
        key: `campaigns/${campaignId}/assemblies/${expectedAssemblyId}/output.mp4`,
        checksumSha256: "f".repeat(64)
      }
    });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery: createMockMediaDelivery()
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("Output media checksum mismatch");
  });

  it("fails closed to unavailable-artifact when presigned URL generation throws", async () => {
    const record: CanonicalDeliveryAssemblyRecord = {
      campaignExists: true,
      status: "completed",
      runId,
      assemblyJobId,
      assemblySpec: sampleSpec
    };
    const storage = createMockStorage();
    const mediaDelivery = createMockMediaDelivery({
      error: new Error("S3 signing client error")
    });
    const result = await buildCampaignDeliveryReelReadModel({
      campaignId,
      record,
      objectStorage: storage,
      mediaDelivery
    });

    expect(result.status).toBe("unavailable-artifact");
    expect(result.reason).toContain("Failed to generate presigned URL");
  });

  describe("ResolveCampaignDeliveryReelUseCase", () => {
    it("throws CampaignNotFoundError when campaign does not exist in queries", async () => {
      const mockQueries: CampaignDeliveryReelQueries = {
        findCanonicalDeliveryAssembly: vi.fn(async () => undefined)
      };
      const useCase = new ResolveCampaignDeliveryReelUseCase({
        queries: mockQueries,
        objectStorage: createMockStorage(),
        mediaDelivery: createMockMediaDelivery()
      });

      await expect(useCase.execute(campaignId as CampaignId)).rejects.toThrow(
        CampaignNotFoundError
      );
    });

    it("throws CampaignNotFoundError when campaignExists is false", async () => {
      const mockQueries: CampaignDeliveryReelQueries = {
        findCanonicalDeliveryAssembly: vi.fn(async () => ({
          campaignExists: false,
          status: "not-started" as const
        }))
      };
      const useCase = new ResolveCampaignDeliveryReelUseCase({
        queries: mockQueries,
        objectStorage: createMockStorage(),
        mediaDelivery: createMockMediaDelivery()
      });

      await expect(useCase.execute(campaignId as CampaignId)).rejects.toThrow(
        CampaignNotFoundError
      );
    });

    it("executes successfully and delegates to buildCampaignDeliveryReelReadModel", async () => {
      const mockQueries: CampaignDeliveryReelQueries = {
        findCanonicalDeliveryAssembly: vi.fn(async () => ({
          campaignExists: true,
          status: "not-started" as const,
          updatedAt: "2026-09-13T10:00:00.000Z"
        }))
      };
      const useCase = new ResolveCampaignDeliveryReelUseCase({
        queries: mockQueries,
        objectStorage: createMockStorage(),
        mediaDelivery: createMockMediaDelivery()
      });

      const result = await useCase.execute(campaignId as CampaignId);
      expect(result.status).toBe("not-started");
      expect(result.state).toBe("not-started");
    });
  });
});
