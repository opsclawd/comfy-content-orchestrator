import { describe, expect, it, vi } from "vitest";
import type {
  CampaignDeliveryReelQueries,
  ObjectLocator,
  ObjectStoragePort,
  PersistentObjectLocator,
  ReviewMediaDeliveryPort,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import {
  computeAssemblyId,
  createAssemblyManifest,
  NO_SUBTITLE_CUES_SHA256,
  type AssemblyExecutionResult,
  type AssemblySpec
} from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import { BUCKETS } from "@cco/shared";
import { createControlApiApp } from "../app.js";

class FakeUnitOfWork implements UnitOfWork {
  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({
      scenes: { findById: async () => undefined, save: async () => {} },
      reviewEvents: { findById: async () => undefined, append: async () => {} },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      }
    });
  }
}

describe("DeliveryReelRoutes", () => {
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
    headResult?: { bucket: string; key: string; checksumSha256?: string } | null;
  }): ObjectStoragePort => {
    const manifestJson = JSON.stringify(sampleManifest);
    const body =
      overrides?.manifestBody !== undefined
        ? overrides.manifestBody
        : new TextEncoder().encode(manifestJson);

    return {
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn(async (locator: ObjectLocator) => {
        if (body === null) return undefined;
        return {
          bucket: locator.bucket,
          key: locator.key,
          body
        };
      }),
      headObject: vi.fn(async (locator: ObjectLocator) => {
        if (overrides?.headResult === null) return undefined;
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

  const createMockMediaDelivery = (): ReviewMediaDeliveryPort => ({
    generatePresignedReadUrl: vi.fn(
      async (locator: PersistentObjectLocator) =>
        `https://delivery.example.com/${locator.bucket}/${locator.key}?sig=test`
    )
  });

  it("returns 400 VALIDATION_FAILURE when campaignId is not a valid UUID", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/campaigns/not-a-uuid/delivery-reel"
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 400 VALIDATION_FAILURE on alias route when campaignId is not a valid UUID", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/campaigns/not-a-uuid/delivery"
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 404 NOT_FOUND when campaign does not exist", async () => {
    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async () => undefined)
    };
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: createMockStorage(),
      reviewMediaDelivery: createMockMediaDelivery()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(campaignId);
  });

  it("returns 200 with not-started state when no assembly has been enqueued", async () => {
    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async () => ({
        campaignExists: true,
        status: "not-started" as const,
        updatedAt: "2026-09-13T10:00:00.000Z"
      }))
    };
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: createMockStorage(),
      reviewMediaDelivery: createMockMediaDelivery()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("not-started");
    expect(body.state).toBe("not-started");
    expect(body.campaignId).toBe(campaignId);
    expect(body.media).toBeUndefined();
    expect(body.manifest).toBeUndefined();
  });

  it("returns 200 with assembling state when assembly is in progress", async () => {
    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async () => ({
        campaignExists: true,
        status: "assembling" as const,
        runId,
        assemblyJobId,
        updatedAt: "2026-09-13T10:30:00.000Z"
      }))
    };
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: createMockStorage(),
      reviewMediaDelivery: createMockMediaDelivery()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("assembling");
    expect(body.state).toBe("assembling");
    expect(body.runId).toBe(runId);
    expect(body.assemblyJobId).toBe(assemblyJobId);
  });

  it("returns 200 with failed state when assembly failed", async () => {
    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async () => ({
        campaignExists: true,
        status: "failed" as const,
        runId,
        assemblyJobId,
        errorTrace: "FFmpeg exited with error",
        updatedAt: "2026-09-13T10:45:00.000Z"
      }))
    };
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: createMockStorage(),
      reviewMediaDelivery: createMockMediaDelivery()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("failed");
    expect(body.state).toBe("failed");
    expect(body.runId).toBe(runId);
    expect(body.assemblyJobId).toBe(assemblyJobId);
    expect(body.error).toBe("FFmpeg exited with error");
  });

  it("returns 200 with completed state, canonical manifest, and fresh presigned URL on happy path", async () => {
    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async () => ({
        campaignExists: true,
        status: "completed" as const,
        runId,
        assemblyJobId,
        assemblySpec: sampleSpec,
        updatedAt: "2026-09-13T11:00:00.000Z"
      }))
    };
    const mockDelivery = createMockMediaDelivery();
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: createMockStorage(),
      reviewMediaDelivery: mockDelivery
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("completed");
    expect(body.state).toBe("completed");
    expect(body.assemblyId).toBe(expectedAssemblyId);
    expect(body.runId).toBe(runId);
    expect(body.assemblyJobId).toBe(assemblyJobId);
    expect(body.manifest).toBeDefined();
    expect(body.manifest.assemblyId).toBe(expectedAssemblyId);
    expect(body.media).toBeDefined();
    expect(body.media.url).toContain("https://delivery.example.com/");
    expect(body.media.sha256).toBe(mediaSha);
    expect(body.media.width).toBe(1080);
    expect(body.media.height).toBe(1920);

    // Verify alias route returns identical response
    const aliasRes = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery`
    });
    expect(aliasRes.statusCode).toBe(200);
    expect(JSON.parse(aliasRes.body)).toEqual(body);
  });

  it("returns 200 with unavailable-artifact state when media is missing from storage", async () => {
    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async () => ({
        campaignExists: true,
        status: "completed" as const,
        runId,
        assemblyJobId,
        assemblySpec: sampleSpec,
        updatedAt: "2026-09-13T11:00:00.000Z"
      }))
    };
    const storage = createMockStorage({ headResult: null });
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: storage,
      reviewMediaDelivery: createMockMediaDelivery()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("unavailable-artifact");
    expect(body.state).toBe("unavailable-artifact");
    expect(body.reason).toContain("output media object was not found in storage");
  });

  it("enforces campaign isolation across requests", async () => {
    const campaignA = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
    const campaignB = "01950c46-9e90-7d3d-82d2-8f1d3c000099";

    const mockQueries: CampaignDeliveryReelQueries = {
      findCanonicalDeliveryAssembly: vi.fn(async (cId: CampaignId) => {
        if (cId === campaignA) {
          return {
            campaignExists: true,
            status: "completed" as const,
            runId,
            assemblyJobId,
            assemblySpec: sampleSpec
          };
        }
        return {
          campaignExists: true,
          status: "not-started" as const
        };
      })
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignDeliveryReelQueries: mockQueries,
      objectStorage: createMockStorage(),
      reviewMediaDelivery: createMockMediaDelivery()
    });

    // Campaign A returns completed
    const resA = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignA}/delivery-reel`
    });
    expect(resA.statusCode).toBe(200);
    expect(JSON.parse(resA.body).status).toBe("completed");

    // Campaign B returns not-started
    const resB = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignB}/delivery-reel`
    });
    expect(resB.statusCode).toBe(200);
    expect(JSON.parse(resB.body).status).toBe("not-started");
  });
});
