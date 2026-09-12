import { describe, expect, it, vi } from "vitest";
import type {
  CurrentProductionAttempt,
  CurrentProductionAttemptQueries,
  ReviewMediaDeliveryPort,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import { CurrentProductionAttemptReadModelSchema } from "@cco/contracts";
import type { SceneId } from "@cco/domain";
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

describe("ProductionReviewReadRoutes", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
  const runId = "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000003";
  const jobId = "01950c46-9e90-7d3d-82d2-8f1d3c000004";
  const manifestId = "01950c46-9e90-7d3d-82d2-8f1d3c000005";
  const validSha = "b".repeat(64);

  const availableAttempt: CurrentProductionAttempt = {
    runId,
    sceneId: sceneId as SceneId,
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
        key: "renders/scene-3.mp4",
        sha256: validSha,
        contentType: "video/mp4"
      }
    }
  };

  it("returns 200 with presigned URL and attempt metadata on happy path", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => availableAttempt)
    };

    const mockDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(
        async () => "https://s3.example.com/renders/scene-3.mp4?signature=xyz"
      )
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries,
      reviewMediaDelivery: mockDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(mockDelivery.generatePresignedReadUrl).toHaveBeenCalledWith({
      bucket: "renders-bucket",
      key: "renders/scene-3.mp4",
      contentHash: validSha
    });

    expect(body).toEqual({
      runId,
      sceneId,
      specRevision: 2,
      attemptOrdinal: 1,
      productionJobId: jobId,
      technicalState: "completed",
      reviewReady: true,
      availability: "available",
      media: {
        url: "https://s3.example.com/renders/scene-3.mp4?signature=xyz",
        generationManifestId: manifestId
      }
    });

    // Validate contract compliance
    expect(() => CurrentProductionAttemptReadModelSchema.parse(body)).not.toThrow();
  });

  it("returns 404 when production attempt is not found", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => undefined)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain("was not found");
  });

  it("returns 409 STALE_REVISION_CONFLICT when specRevision query param does not match", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => availableAttempt)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt?specRevision=1`
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.code).toBe("STALE_REVISION_CONFLICT");
    expect(body.details).toEqual({
      expectedRevision: 1,
      currentRevision: 2
    });
  });

  it("returns 200 when specRevision matches expected revision", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => availableAttempt)
    };

    const mockDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(async () => "https://s3.example.com/renders/scene-3.mp4")
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries,
      reviewMediaDelivery: mockDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt?specRevision=2`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.availability).toBe("available");
  });

  it("returns 200 with missing_manifest availability and no media property", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => ({
        runId,
        sceneId: sceneId as SceneId,
        specRevision: 1,
        attemptOrdinal: 1,
        productionJobId: jobId,
        technicalState: "completed" as const,
        reviewReady: false,
        availability: "missing_manifest" as const
      }))
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      runId,
      sceneId,
      specRevision: 1,
      attemptOrdinal: 1,
      productionJobId: jobId,
      technicalState: "completed",
      reviewReady: false,
      availability: "missing_manifest"
    });
    expect(body.media).toBeUndefined();
    expect(() => CurrentProductionAttemptReadModelSchema.parse(body)).not.toThrow();
  });

  it("returns 200 with unavailable availability for in-flight render", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => ({
        runId,
        sceneId: sceneId as SceneId,
        specRevision: 1,
        attemptOrdinal: 1,
        productionJobId: jobId,
        technicalState: "rendering" as const,
        reviewReady: false,
        availability: "unavailable" as const
      }))
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.availability).toBe("unavailable");
    expect(body.technicalState).toBe("rendering");
    expect(body.media).toBeUndefined();
    expect(() => CurrentProductionAttemptReadModelSchema.parse(body)).not.toThrow();
  });

  it("degrades to inconsistent when generatePresignedReadUrl throws", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => availableAttempt)
    };

    const mockDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(async () => {
        throw new Error("S3 connection timeout");
      })
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries,
      reviewMediaDelivery: mockDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    // Never return 500 for presigning failure; report explicit inconsistent availability
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.availability).toBe("inconsistent");
    expect(body.media).toBeUndefined();
    expect(() => CurrentProductionAttemptReadModelSchema.parse(body)).not.toThrow();
  });

  it("degrades to inconsistent when generatePresignedReadUrl returns empty string", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => availableAttempt)
    };

    const mockDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(async () => "")
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries,
      reviewMediaDelivery: mockDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.availability).toBe("inconsistent");
    expect(body.media).toBeUndefined();
  });

  it("returns unavailable when reviewMediaDelivery is not configured", async () => {
    const mockQueries: CurrentProductionAttemptQueries = {
      getCurrentProductionAttempt: vi.fn(async () => availableAttempt)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: mockQueries
      // reviewMediaDelivery omitted
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.availability).toBe("unavailable");
    expect(body.media).toBeUndefined();
  });

  it("returns 400 for invalid UUID path parameter", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      currentProductionAttemptQueries: {
        getCurrentProductionAttempt: vi.fn()
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/not-a-uuid/runs/${runId}/scenes/${sceneId}/production-attempt`
    });

    expect(response.statusCode).toBe(400);
  });
});
