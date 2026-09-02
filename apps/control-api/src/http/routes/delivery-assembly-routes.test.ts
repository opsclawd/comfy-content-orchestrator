import { describe, expect, it, vi } from "vitest";
import type { AssemblySpec } from "@cco/contracts";
import type { CampaignId, DeliveryAssemblyJob, JobId, LeaseToken } from "@cco/domain";
import type { DeliveryAssemblyJobQueuePort, UnitOfWork, UnitOfWorkContext } from "@cco/application";
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

const sampleJobId = "11111111-1111-4111-8111-111111111111" as JobId;
const sampleCampaignId = "22222222-2222-4222-8222-222222222222" as CampaignId;
const sampleLeaseToken = "33333333-3333-4333-8333-333333333333" as LeaseToken;

const sampleAssemblySpec: AssemblySpec = {
  campaignId: sampleCampaignId,
  assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
  expectedTotalDurationMs: 5000,
  videoStems: [
    {
      order: 0,
      sceneId: "44444444-4444-4444-8444-444444444444",
      generationManifestId: "55555555-5555-4555-8555-555555555555",
      expectedDurationMs: 5000,
      media: {
        bucket: "godzspeed-delivery",
        key: `campaigns/${sampleCampaignId}/scenes/scene-1/output.mp4`,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        contentType: "video/mp4"
      }
    }
  ]
} as unknown as AssemblySpec;

const sampleQueuedJob: DeliveryAssemblyJob<AssemblySpec> = {
  jobId: sampleJobId,
  campaignId: sampleCampaignId,
  assemblySpec: sampleAssemblySpec,
  status: "queued",
  workerId: null,
  leaseToken: null,
  leaseExpiresAt: null,
  retryCount: 0,
  maxRetries: 3,
  errorTrace: null,
  createdAt: new Date("2026-08-27T08:00:00.000Z"),
  updatedAt: new Date("2026-08-27T08:00:00.000Z")
};

const sampleLeasedJob: DeliveryAssemblyJob<AssemblySpec> = {
  ...sampleQueuedJob,
  status: "leased",
  workerId: "assembler-1",
  leaseToken: sampleLeaseToken,
  leaseExpiresAt: new Date("2026-08-27T08:05:00.000Z"),
  updatedAt: new Date("2026-08-27T08:01:00.000Z")
};

describe("Delivery Assembly routes", () => {
  it("enqueues a job successfully", async () => {
    const queue: DeliveryAssemblyJobQueuePort = {
      enqueue: vi.fn().mockResolvedValue(sampleQueuedJob),
      claim: vi.fn(),
      start: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      deliveryAssemblyJobQueue: queue
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs",
      headers: { "Content-Type": "application/json" },
      payload: {
        campaignId: sampleCampaignId,
        assemblySpec: sampleAssemblySpec
      }
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().jobId).toBe(sampleJobId);
    expect(queue.enqueue).toHaveBeenCalledWith({
      campaignId: sampleCampaignId,
      assemblySpec: expect.objectContaining({ campaignId: sampleCampaignId })
    });
  });

  it("returns 400 when enqueue payload has invalid AssemblySpec", async () => {
    const queue: DeliveryAssemblyJobQueuePort = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      start: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      deliveryAssemblyJobQueue: queue
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs",
      headers: { "Content-Type": "application/json" },
      payload: {
        campaignId: sampleCampaignId,
        assemblySpec: { invalid: "spec" }
      }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILURE");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("returns 400 when request campaignId does not match assemblySpec.campaignId", async () => {
    const queue: DeliveryAssemblyJobQueuePort = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      start: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      deliveryAssemblyJobQueue: queue
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs",
      headers: { "Content-Type": "application/json" },
      payload: {
        campaignId: "99999999-9999-4999-8999-999999999999",
        assemblySpec: sampleAssemblySpec
      }
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILURE");
    expect(res.json().message).toContain("Mismatched campaignId");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("claims a job returning 200 or 204", async () => {
    const queue: DeliveryAssemblyJobQueuePort = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValueOnce(sampleLeasedJob).mockResolvedValueOnce(undefined),
      start: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      deliveryAssemblyJobQueue: queue
    });

    const res1 = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs/claim",
      headers: { "Content-Type": "application/json" },
      payload: { workerId: "assembler-1" }
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().jobId).toBe(sampleJobId);

    const res2 = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs/claim",
      headers: { "Content-Type": "application/json" },
      payload: { workerId: "assembler-1" }
    });
    expect(res2.statusCode).toBe(204);
  });

  it("starts a job returning 200, 409 or 404", async () => {
    const queue: DeliveryAssemblyJobQueuePort = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      start: vi
        .fn()
        .mockResolvedValueOnce({ outcome: "applied", job: sampleLeasedJob })
        .mockResolvedValueOnce({ outcome: "superseded" })
        .mockResolvedValueOnce({ outcome: "not_found" }),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      deliveryAssemblyJobQueue: queue
    });

    const res1 = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/start`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken }
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().outcome).toBe("applied");

    const res2 = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/start`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken }
    });
    expect(res2.statusCode).toBe(409);

    const res3 = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/start`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken }
    });
    expect(res3.statusCode).toBe(404);
  });

  it("handles heartbeat, complete, fail, and defer endpoints", async () => {
    const queue: DeliveryAssemblyJobQueuePort = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      start: vi.fn(),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      fail: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      defer: vi.fn().mockResolvedValue({ outcome: "deferred", job: sampleQueuedJob }),
      getJob: vi.fn().mockResolvedValue(sampleLeasedJob)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      deliveryAssemblyJobQueue: queue
    });

    const hbRes = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/heartbeat`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken }
    });
    expect(hbRes.statusCode).toBe(200);

    const compRes = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/complete`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken }
    });
    expect(compRes.statusCode).toBe(200);

    const failRes = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/fail`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken, errorTrace: "something bad" }
    });
    expect(failRes.statusCode).toBe(200);

    const deferRes = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${sampleJobId}/defer`,
      headers: { "Content-Type": "application/json" },
      payload: { leaseToken: sampleLeaseToken, reason: "cooling down" }
    });
    expect(deferRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: "GET",
      url: `/api/delivery-assembly-jobs/${sampleJobId}`
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().jobId).toBe(sampleJobId);
  });
});
