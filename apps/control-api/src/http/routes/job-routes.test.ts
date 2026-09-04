import { describe, expect, it, vi } from "vitest";
import type { JobId, LeaseToken, RenderJob, SceneId } from "@cco/domain";
import {
  InvalidJobCompletionPayloadError,
  StorageAdmissionUnavailableError,
  type JobMutationResult,
  type JobQueuePort,
  type StorageTelemetryPort,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import { ControlApiConfigError } from "../../runtime-config.js";
import { createControlApiApp } from "../app.js";
import { createControlApiContainer } from "../types.js";

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
const sampleSceneId = "22222222-2222-4222-8222-222222222222" as SceneId;
const sampleLeaseToken = "33333333-3333-4333-8333-333333333333" as LeaseToken;

const sampleLeasedJob: RenderJob = {
  jobId: sampleJobId,
  sceneId: sampleSceneId,
  jobKind: "candidate",
  status: "leased",
  workflowTemplate: "candidate-preview",
  injectedPayload: { prompt: "a cinematic render" },
  workerId: "worker-alpha",
  leaseToken: sampleLeaseToken,
  leaseExpiresAt: new Date("2026-08-27T09:00:00.000Z"),
  retryCount: 0,
  maxRetries: 3,
  errorTrace: null,
  createdAt: new Date("2026-08-27T08:00:00.000Z"),
  updatedAt: new Date("2026-08-27T08:05:00.000Z")
};

const sampleRenderingJob: RenderJob = {
  ...sampleLeasedJob,
  status: "rendering",
  updatedAt: new Date("2026-08-27T08:06:00.000Z")
};

const sampleCompletedJob: RenderJob = {
  ...sampleLeasedJob,
  status: "completed",
  updatedAt: new Date("2026-08-27T08:07:00.000Z")
};

const sampleFailedJob: RenderJob = {
  ...sampleLeasedJob,
  status: "failed",
  errorTrace: "CUDA out of memory",
  updatedAt: new Date("2026-08-27T08:08:00.000Z")
};

const sampleDeferredJob: RenderJob = {
  ...sampleLeasedJob,
  status: "queued",
  workerId: null,
  leaseExpiresAt: null,
  errorTrace: "Worker requested defer",
  updatedAt: new Date("2026-08-27T08:09:00.000Z")
};

const defaultDispatchConfig = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

function createFakeJobQueue(overrides?: Partial<JobQueuePort>): JobQueuePort {
  return {
    enqueue: vi.fn().mockResolvedValue(sampleDeferredJob),
    claim: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    heartbeat: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    complete: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    fail: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    defer: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    areAllJobsTerminal: vi.fn().mockResolvedValue(false),
    ...overrides
  };
}

function createFakeStorageTelemetry(
  usedBytes: number = 50,
  totalBytes: number = 100
): StorageTelemetryPort {
  return {
    getStorageTelemetry: vi.fn().mockResolvedValue({
      totalBytes,
      usedBytes,
      freeBytes: totalBytes - usedBytes,
      buckets: [],
      measuredAt: "2026-08-27T00:00:00.000Z"
    })
  };
}

describe("Job Dispatch Routes", () => {
  it("claim delegates the configured lease and returns the leased job", async () => {
    const queue = createFakeJobQueue({
      claim: vi.fn().mockResolvedValue(sampleLeasedJob)
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: {
        workerId: "worker-alpha"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queue.claim).toHaveBeenCalledTimes(1);
    expect(queue.claim).toHaveBeenCalledWith({
      workerId: "worker-alpha",
      leaseDurationMs: 300_000
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        (queue.claim as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
        "allowedJobKinds"
      )
    ).toBe(false);

    const body = response.json();
    expect(body).toEqual({
      jobId: sampleJobId,
      sceneId: sampleSceneId,
      jobKind: "candidate",
      status: "leased",
      workflowTemplate: "candidate-preview",
      injectedPayload: { prompt: "a cinematic render" },
      workerId: "worker-alpha",
      leaseToken: sampleLeaseToken,
      leaseExpiresAt: "2026-08-27T09:00:00.000Z",
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      createdAt: "2026-08-27T08:00:00.000Z",
      updatedAt: "2026-08-27T08:05:00.000Z"
    });
    expect(body.leaseToken).toBe(sampleLeaseToken);

    await app.close();
  });

  it("claim delegates allowedJobKinds unchanged when provided", async () => {
    const queue = createFakeJobQueue({
      claim: vi.fn().mockResolvedValue(sampleLeasedJob)
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const responseSingle = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: {
        workerId: "worker-alpha",
        allowedJobKinds: ["candidate"]
      }
    });

    expect(responseSingle.statusCode).toBe(200);
    expect(queue.claim).toHaveBeenLastCalledWith({
      workerId: "worker-alpha",
      leaseDurationMs: 300_000,
      allowedJobKinds: ["candidate"]
    });

    const responseMultiple = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: {
        workerId: "worker-alpha",
        allowedJobKinds: ["candidate", "production"]
      }
    });

    expect(responseMultiple.statusCode).toBe(200);
    expect(queue.claim).toHaveBeenLastCalledWith({
      workerId: "worker-alpha",
      leaseDurationMs: 300_000,
      allowedJobKinds: ["candidate", "production"]
    });

    await app.close();
  });

  it("claim returns an empty 204 when no job is admissible", async () => {
    const queue = createFakeJobQueue({
      claim: vi.fn().mockResolvedValue(undefined)
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: {
        workerId: "worker-alpha"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(queue.claim).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("claim returns 503 only for typed storage telemetry unavailability", async () => {
    const queueUnavailable = createFakeJobQueue({
      claim: vi
        .fn()
        .mockRejectedValue(
          new StorageAdmissionUnavailableError({ cause: new Error("Telemetry offline") })
        )
    });

    const appUnavailable = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queueUnavailable
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const responseUnavailable = await appUnavailable.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: {
        workerId: "worker-alpha"
      }
    });

    expect(responseUnavailable.statusCode).toBe(503);
    expect(responseUnavailable.json()).toEqual({
      code: "STORAGE_TELEMETRY_UNAVAILABLE",
      message: "Storage telemetry is unavailable."
    });
    await appUnavailable.close();

    const queueArbitrary = createFakeJobQueue({
      claim: vi.fn().mockRejectedValue(new Error("database connection timeout"))
    });

    const appArbitrary = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queueArbitrary
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const responseArbitrary = await appArbitrary.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: {
        workerId: "worker-alpha"
      }
    });

    expect(responseArbitrary.statusCode).toBe(500);
    expect(responseArbitrary.json()).toEqual({
      message: "Internal Server Error"
    });
    await appArbitrary.close();
  });

  it("start delegates the branded path id and lease token", async () => {
    const queue = createFakeJobQueue({
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleRenderingJob })
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/start`,
      payload: {
        leaseToken: sampleLeaseToken
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queue.start).toHaveBeenCalledTimes(1);
    expect(queue.start).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken);
    expect(response.json()).toEqual({
      outcome: "applied",
      job: expect.objectContaining({
        jobId: sampleJobId,
        status: "rendering"
      })
    });

    await app.close();
  });

  it("heartbeat delegates the configured lease renewal", async () => {
    const queue = createFakeJobQueue({
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob })
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/heartbeat`,
      payload: {
        leaseToken: sampleLeaseToken
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queue.heartbeat).toHaveBeenCalledTimes(1);
    expect(queue.heartbeat).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken, 300_000);
    expect(response.json()).toEqual({
      outcome: "applied",
      job: expect.objectContaining({
        jobId: sampleJobId,
        leaseToken: sampleLeaseToken
      })
    });

    await app.close();
  });

  it("complete delegates the optional manifest unchanged", async () => {
    const queue = createFakeJobQueue({
      complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleCompletedJob })
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    // Case 1: without manifestPayload
    const responseWithout = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken
      }
    });

    expect(responseWithout.statusCode).toBe(200);
    expect(queue.complete).toHaveBeenCalledTimes(1);
    expect(queue.complete).toHaveBeenLastCalledWith(
      sampleJobId,
      sampleLeaseToken,
      undefined,
      undefined
    );

    // Case 2: with manifestPayload object
    const manifest = { promptIdComfy: "comfy-task-42", outputCount: 1 };
    const responseWith = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: manifest
      }
    });

    expect(responseWith.statusCode).toBe(200);
    expect(queue.complete).toHaveBeenCalledTimes(2);
    expect(queue.complete).toHaveBeenLastCalledWith(
      sampleJobId,
      sampleLeaseToken,
      manifest,
      undefined
    );

    await app.close();
  });

  it("fail delegates the persisted error trace", async () => {
    const queue = createFakeJobQueue({
      fail: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleFailedJob })
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const errorTrace = "RuntimeError: CUDA out of memory\n  at execute (/worker/render.py:100)";
    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/fail`,
      payload: {
        leaseToken: sampleLeaseToken,
        errorTrace
      }
    });

    expect(response.statusCode).toBe(200);
    expect(queue.fail).toHaveBeenCalledTimes(1);
    expect(queue.fail).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken, errorTrace);
    expect(response.json()).toEqual({
      outcome: "applied",
      job: expect.objectContaining({
        jobId: sampleJobId,
        status: "failed",
        errorTrace: "CUDA out of memory"
      })
    });

    await app.close();
  });

  describe("POST /api/jobs/:jobId/defer", () => {
    it("defer delegates the branded id token and reason", async () => {
      const queue = createFakeJobQueue({
        defer: vi.fn().mockResolvedValue({ outcome: "deferred", job: sampleDeferredJob })
      });

      const app = createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );

      const reason = "Worker needs warm model checkpoint";
      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: {
          leaseToken: sampleLeaseToken,
          reason
        }
      });

      expect(response.statusCode).toBe(200);
      expect(queue.defer).toHaveBeenCalledTimes(1);
      expect(queue.defer).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken, reason);
      expect(response.json()).toEqual({
        outcome: "deferred",
        job: expect.objectContaining({
          jobId: sampleJobId,
          status: "queued",
          workerId: null,
          errorTrace: "Worker requested defer"
        })
      });

      await app.close();
    });

    it("defer replay returns already applied", async () => {
      const queue = createFakeJobQueue({
        defer: vi.fn().mockResolvedValue({ outcome: "already_applied", job: sampleDeferredJob })
      });

      const app = createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: {
          leaseToken: sampleLeaseToken,
          reason: "Worker requested defer"
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        outcome: "already_applied",
        job: expect.objectContaining({
          jobId: sampleJobId
        })
      });

      await app.close();
    });

    it("defer after reclaim returns lease superseded", async () => {
      const queue = createFakeJobQueue({
        defer: vi.fn().mockResolvedValue({ outcome: "superseded" })
      });

      const app = createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: {
          leaseToken: sampleLeaseToken,
          reason: "Worker requested defer"
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: "LEASE_SUPERSEDED",
        message: "The job lease has been superseded."
      });

      await app.close();
    });

    it("defer reports missing jobs", async () => {
      const queue = createFakeJobQueue({
        defer: vi.fn().mockResolvedValue({ outcome: "not_found" })
      });

      const app = createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: {
          leaseToken: sampleLeaseToken,
          reason: "Worker requested defer"
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: "NOT_FOUND",
        message: "Job not found."
      });

      await app.close();
    });

    it("defer rejects malformed transport input without calling the queue", async () => {
      const queue = createFakeJobQueue();
      const app = createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );

      const invalidRequests = [
        // invalid UUID in path
        {
          method: "POST" as const,
          url: "/api/jobs/not-a-uuid/defer",
          payload: { leaseToken: sampleLeaseToken, reason: "reason" }
        },
        // missing reason
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { leaseToken: sampleLeaseToken }
        },
        // empty reason
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { leaseToken: sampleLeaseToken, reason: "" }
        },
        // whitespace reason
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { leaseToken: sampleLeaseToken, reason: "   \t\n" }
        },
        // non-string reason
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { leaseToken: sampleLeaseToken, reason: 999 }
        },
        // missing leaseToken
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { reason: "reason" }
        },
        // invalid UUID in leaseToken
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { leaseToken: "not-a-uuid", reason: "reason" }
        },
        // extra property
        {
          method: "POST" as const,
          url: `/api/jobs/${sampleJobId}/defer`,
          payload: { leaseToken: sampleLeaseToken, reason: "reason", extraProp: 123 }
        }
      ];

      for (const req of invalidRequests) {
        const response = await app.inject(req);
        expect(
          response.statusCode,
          `Expected 400 for ${req.method} ${req.url} with ${JSON.stringify(req.payload)}`
        ).toBe(400);
        expect(response.json()).toEqual(
          expect.objectContaining({
            code: "VALIDATION_FAILURE"
          })
        );
      }

      expect(queue.defer).not.toHaveBeenCalled();
      await app.close();
    });

    it("deferred is translated as a successful mutation outcome", async () => {
      const queue = createFakeJobQueue({
        defer: vi.fn().mockResolvedValue({ outcome: "deferred", job: sampleDeferredJob })
      });

      const app = createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: {
          leaseToken: sampleLeaseToken,
          reason: "defer reason"
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        outcome: "deferred",
        job: expect.objectContaining({
          jobId: sampleJobId,
          status: "queued"
        })
      });

      await app.close();
    });
  });

  describe("Shared mutation outcomes", () => {
    const mutationEndpoints = [
      {
        name: "start",
        path: `/api/jobs/${sampleJobId}/start`,
        payload: { leaseToken: sampleLeaseToken },
        mockKey: "start" as const,
        sampleJob: sampleRenderingJob
      },
      {
        name: "heartbeat",
        path: `/api/jobs/${sampleJobId}/heartbeat`,
        payload: { leaseToken: sampleLeaseToken },
        mockKey: "heartbeat" as const,
        sampleJob: sampleLeasedJob
      },
      {
        name: "complete",
        path: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken, manifestPayload: { promptIdComfy: "123" } },
        mockKey: "complete" as const,
        sampleJob: sampleCompletedJob
      },
      {
        name: "fail",
        path: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "something failed" },
        mockKey: "fail" as const,
        sampleJob: sampleFailedJob
      },
      {
        name: "defer",
        path: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken, reason: "defer reason" },
        mockKey: "defer" as const,
        sampleJob: sampleDeferredJob
      }
    ];

    for (const ep of mutationEndpoints) {
      it(`mutation applied returns 200 for ${ep.name}`, async () => {
        const queue = createFakeJobQueue({
          [ep.mockKey]: vi.fn().mockResolvedValue({ outcome: "applied", job: ep.sampleJob })
        });
        const app = createControlApiApp(
          {
            uow: new FakeUnitOfWork(),
            storageTelemetry: createFakeStorageTelemetry(),
            jobQueue: queue
          },
          { jobDispatch: defaultDispatchConfig }
        );

        const response = await app.inject({
          method: "POST",
          url: ep.path,
          payload: ep.payload
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          outcome: "applied",
          job: expect.objectContaining({
            jobId: sampleJobId
          })
        });
        await app.close();
      });

      it(`mutation already applied returns 200 for ${ep.name}`, async () => {
        const queue = createFakeJobQueue({
          [ep.mockKey]: vi.fn().mockResolvedValue({ outcome: "already_applied", job: ep.sampleJob })
        });
        const app = createControlApiApp(
          {
            uow: new FakeUnitOfWork(),
            storageTelemetry: createFakeStorageTelemetry(),
            jobQueue: queue
          },
          { jobDispatch: defaultDispatchConfig }
        );

        const response = await app.inject({
          method: "POST",
          url: ep.path,
          payload: ep.payload
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          outcome: "already_applied",
          job: expect.objectContaining({
            jobId: sampleJobId
          })
        });
        await app.close();
      });

      it(`mutation superseded returns 409 for ${ep.name}`, async () => {
        const queue = createFakeJobQueue({
          [ep.mockKey]: vi.fn().mockResolvedValue({ outcome: "superseded" })
        });
        const app = createControlApiApp(
          {
            uow: new FakeUnitOfWork(),
            storageTelemetry: createFakeStorageTelemetry(),
            jobQueue: queue
          },
          { jobDispatch: defaultDispatchConfig }
        );

        const response = await app.inject({
          method: "POST",
          url: ep.path,
          payload: ep.payload
        });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({
          code: "LEASE_SUPERSEDED",
          message: "The job lease has been superseded."
        });
        await app.close();
      });

      it(`mutation not found returns 404 for ${ep.name}`, async () => {
        const queue = createFakeJobQueue({
          [ep.mockKey]: vi.fn().mockResolvedValue({ outcome: "not_found" })
        });
        const app = createControlApiApp(
          {
            uow: new FakeUnitOfWork(),
            storageTelemetry: createFakeStorageTelemetry(),
            jobQueue: queue
          },
          { jobDispatch: defaultDispatchConfig }
        );

        const response = await app.inject({
          method: "POST",
          url: ep.path,
          payload: ep.payload
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          code: "NOT_FOUND",
          message: "Job not found."
        });
        await app.close();
      });

      it(`mutation unexpected error returns 500 for ${ep.name}`, async () => {
        const queue = createFakeJobQueue({
          [ep.mockKey]: vi.fn().mockRejectedValue(new Error("unexpected DB crash"))
        });
        const app = createControlApiApp(
          {
            uow: new FakeUnitOfWork(),
            storageTelemetry: createFakeStorageTelemetry(),
            jobQueue: queue
          },
          { jobDispatch: defaultDispatchConfig }
        );

        const response = await app.inject({
          method: "POST",
          url: ep.path,
          payload: ep.payload
        });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({
          message: "Internal Server Error"
        });
        await app.close();
      });
    }
  });

  it("invalid completion payload returns 400", async () => {
    const queue = createFakeJobQueue({
      complete: vi
        .fn()
        .mockRejectedValue(
          new InvalidJobCompletionPayloadError("Candidate jobs do not accept a manifest payload")
        )
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: { promptIdComfy: "candidate-invalid-manifest" }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: "VALIDATION_FAILURE",
      message: "Candidate jobs do not accept a manifest payload"
    });

    await app.close();
  });

  it("malformed transport input never reaches the queue", async () => {
    const queue = createFakeJobQueue();
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const testRequests = [
      // Claim: missing workerId
      { method: "POST" as const, url: "/api/jobs/claim", payload: {} },
      // Claim: empty workerId
      { method: "POST" as const, url: "/api/jobs/claim", payload: { workerId: "" } },
      // Claim: whitespace workerId
      { method: "POST" as const, url: "/api/jobs/claim", payload: { workerId: "   \t\n" } },
      // Claim: non-string workerId
      { method: "POST" as const, url: "/api/jobs/claim", payload: { workerId: 123 } },
      // Claim: extra property
      {
        method: "POST" as const,
        url: "/api/jobs/claim",
        payload: { workerId: "worker-1", extraProp: "forbidden" }
      },
      // Claim: empty allowedJobKinds
      {
        method: "POST" as const,
        url: "/api/jobs/claim",
        payload: { workerId: "worker-1", allowedJobKinds: [] }
      },
      // Claim: non-enum allowedJobKinds item
      {
        method: "POST" as const,
        url: "/api/jobs/claim",
        payload: { workerId: "worker-1", allowedJobKinds: ["invalid-kind"] }
      },
      // Claim: duplicate allowedJobKinds items
      {
        method: "POST" as const,
        url: "/api/jobs/claim",
        payload: { workerId: "worker-1", allowedJobKinds: ["candidate", "candidate"] }
      },
      // Claim: non-array allowedJobKinds
      {
        method: "POST" as const,
        url: "/api/jobs/claim",
        payload: { workerId: "worker-1", allowedJobKinds: "candidate" }
      },
      // Claim: non-string allowedJobKinds items
      {
        method: "POST" as const,
        url: "/api/jobs/claim",
        payload: { workerId: "worker-1", allowedJobKinds: [123] }
      },

      // Start: invalid UUID in path
      {
        method: "POST" as const,
        url: "/api/jobs/not-a-uuid/start",
        payload: { leaseToken: sampleLeaseToken }
      },
      // Start: missing leaseToken
      { method: "POST" as const, url: `/api/jobs/${sampleJobId}/start`, payload: {} },
      // Start: invalid UUID in leaseToken
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/start`,
        payload: { leaseToken: "not-a-uuid" }
      },
      // Start: extra property
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/start`,
        payload: { leaseToken: sampleLeaseToken, extraProp: 123 }
      },

      // Heartbeat: invalid UUID in path
      {
        method: "POST" as const,
        url: "/api/jobs/not-a-uuid/heartbeat",
        payload: { leaseToken: sampleLeaseToken }
      },
      // Heartbeat: missing leaseToken
      { method: "POST" as const, url: `/api/jobs/${sampleJobId}/heartbeat`, payload: {} },
      // Heartbeat: invalid UUID in leaseToken
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/heartbeat`,
        payload: { leaseToken: "not-a-uuid" }
      },

      // Complete: invalid UUID in path
      {
        method: "POST" as const,
        url: "/api/jobs/not-a-uuid/complete",
        payload: { leaseToken: sampleLeaseToken }
      },
      // Complete: non-object manifestPayload (array)
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken, manifestPayload: [1, 2, 3] }
      },
      // Complete: non-object manifestPayload (string)
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken, manifestPayload: "invalid-string" }
      },
      // Complete: extra property
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken, extra: true }
      },

      // Fail: invalid UUID in path
      {
        method: "POST" as const,
        url: "/api/jobs/not-a-uuid/fail",
        payload: { leaseToken: sampleLeaseToken, errorTrace: "err" }
      },
      // Fail: missing errorTrace
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken }
      },
      // Fail: empty errorTrace
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "" }
      },
      // Fail: whitespace errorTrace
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "   \t\n" }
      },
      // Fail: non-string errorTrace
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: 999 }
      },

      // Defer: invalid UUID in path
      {
        method: "POST" as const,
        url: "/api/jobs/not-a-uuid/defer",
        payload: { leaseToken: sampleLeaseToken, reason: "reason" }
      },
      // Defer: missing reason
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken }
      },
      // Defer: empty reason
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken, reason: "" }
      },
      // Defer: whitespace reason
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken, reason: "   \t\n" }
      },
      // Defer: non-string reason
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken, reason: 999 }
      },
      // Defer: missing leaseToken
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { reason: "reason" }
      },
      // Defer: invalid UUID in leaseToken
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: "not-a-uuid", reason: "reason" }
      },
      // Defer: extra property
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken, reason: "reason", extraProp: 123 }
      }
    ];

    for (const req of testRequests) {
      const response = await app.inject(req);
      expect(
        response.statusCode,
        `Expected 400 for ${req.method} ${req.url} with ${JSON.stringify(req.payload)}`
      ).toBe(400);
      expect(response.json()).toEqual(
        expect.objectContaining({
          code: "VALIDATION_FAILURE"
        })
      );
    }

    // Also test malformed JSON body
    const malformedResponse = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      headers: { "content-type": "application/json" },
      payload: "invalid json string {"
    });
    expect(malformedResponse.statusCode).toBe(400);
    expect(malformedResponse.json()).toEqual(
      expect.objectContaining({
        code: "VALIDATION_FAILURE"
      })
    );

    // Verify no queue method was ever called
    expect(queue.claim).not.toHaveBeenCalled();
    expect(queue.start).not.toHaveBeenCalled();
    expect(queue.heartbeat).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
    expect(queue.defer).not.toHaveBeenCalled();

    await app.close();
  });

  it("job routes remain absent without a queue dependency", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const routes = [
      { method: "POST" as const, url: "/api/jobs/claim", payload: { workerId: "worker-1" } },
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/start`,
        payload: { leaseToken: sampleLeaseToken }
      },
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/heartbeat`,
        payload: { leaseToken: sampleLeaseToken }
      },
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken }
      },
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "err" }
      },
      {
        method: "POST" as const,
        url: `/api/jobs/${sampleJobId}/defer`,
        payload: { leaseToken: sampleLeaseToken, reason: "err" }
      }
    ];

    for (const route of routes) {
      const response = await app.inject(route);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: "NOT_FOUND",
        message: `Route ${route.method} ${route.url} not found.`
      });
    }

    await app.close();
  });

  it("fails app construction when job queue is supplied without dispatch timing configuration", () => {
    const queue = createFakeJobQueue();

    expect(() => {
      createControlApiApp({
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      });
    }).toThrow(ControlApiConfigError);

    expect(() => {
      createControlApiApp({
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      });
    }).toThrow(
      "Job dispatch timing configuration (options.jobDispatch) is required when jobQueue is supplied"
    );

    expect(() => {
      createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          storageTelemetry: createFakeStorageTelemetry(),
          jobQueue: queue
        },
        {}
      );
    }).toThrow(ControlApiConfigError);
  });

  it("job routes require storage admission wiring", () => {
    const queue = createFakeJobQueue();

    expect(() => {
      createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          jobQueue: queue
        },
        {
          jobDispatch: defaultDispatchConfig
        }
      );
    }).toThrow(ControlApiConfigError);

    // review-only apps remain constructible
    const reviewApp = createControlApiApp({
      uow: new FakeUnitOfWork()
    });
    expect(reviewApp).toBeDefined();
  });

  it("candidate completion at degraded returns typed 507 without queue write", async () => {
    const queue = createFakeJobQueue();
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(85, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "godzspeed-temp",
          storageObjectKey: `candidates/${sampleJobId}/rev_1_var_1.webp`,
          contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        }
      }
    });

    expect(response.statusCode).toBe(507);
    expect(response.json()).toEqual({
      code: "STORAGE_ADMISSION_DENIED",
      message:
        'Storage admission denied for operation "candidate_upload": watermark state is "degraded" (85.0% disk usage)',
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.85,
      totalBytes: 100,
      freeBytes: 15
    });
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  it("production completion at degraded remains permitted", async () => {
    const queue = createFakeJobQueue({
      complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleCompletedJob })
    });
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(85, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: { promptIdComfy: "123" }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      outcome: "applied",
      job: expect.objectContaining({
        jobId: sampleJobId,
        status: "completed"
      })
    });
    expect(queue.complete).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("production completion at critical returns typed 507 without queue write", async () => {
    const queue = createFakeJobQueue();
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(93, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: { promptIdComfy: "123" }
      }
    });

    expect(response.statusCode).toBe(507);
    expect(response.json()).toEqual({
      code: "STORAGE_ADMISSION_DENIED",
      message:
        'Storage admission denied for operation "delivery_write": watermark state is "critical" (93.0% disk usage)',
      operationClass: "delivery_write",
      watermarkState: "critical",
      usedRatio: 0.93,
      totalBytes: 100,
      freeBytes: 7
    });
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  it("normal completion preserves both payload branches", async () => {
    const queue = createFakeJobQueue({
      complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleCompletedJob })
    });
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(50, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    // Candidate branch
    const candidatePayload = {
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sampleJobId}/rev_1_var_1.webp`,
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      generationPayload: { promptIdComfy: "prompt-cand-1" }
    };
    const candResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        candidatePayload
      }
    });

    expect(candResponse.statusCode).toBe(200);
    expect(queue.complete).toHaveBeenCalledTimes(1);
    expect(queue.complete).toHaveBeenLastCalledWith(
      sampleJobId,
      sampleLeaseToken,
      undefined,
      candidatePayload
    );

    // Production branch
    const manifestPayload = { promptIdComfy: "prompt-1", outputCount: 1 };
    const prodResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload
      }
    });

    expect(prodResponse.statusCode).toBe(200);
    expect(queue.complete).toHaveBeenCalledTimes(2);
    expect(queue.complete).toHaveBeenLastCalledWith(
      sampleJobId,
      sampleLeaseToken,
      manifestPayload,
      undefined
    );

    await app.close();
  });

  it("rejects completion that supplies both manifest and candidate payloads", async () => {
    const queue = createFakeJobQueue();
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(50, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: { promptIdComfy: "p" },
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "b",
          storageObjectKey: "k",
          contentHashSha256: "h"
        }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects candidate completion missing required candidate payload fields", async () => {
    const queue = createFakeJobQueue();
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(50, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        candidatePayload: { variantOrdinal: 1 }
      }
    });

    expect(response.statusCode).toBe(400);
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  it("complete returns 503 when storage telemetry is unavailable", async () => {
    const queue = createFakeJobQueue();
    const failingTelemetry: StorageTelemetryPort = {
      getStorageTelemetry: vi.fn().mockRejectedValue(new Error("disk telemetry read error"))
    };
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: failingTelemetry,
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: { promptIdComfy: "123" }
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: "STORAGE_TELEMETRY_UNAVAILABLE",
      message: "Storage telemetry is unavailable."
    });
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  it("complete returns 503 when storage telemetry throws StorageAdmissionUnavailableError", async () => {
    const queue = createFakeJobQueue();
    const failingTelemetry: StorageTelemetryPort = {
      getStorageTelemetry: vi
        .fn()
        .mockRejectedValue(
          new StorageAdmissionUnavailableError({ cause: new Error("Telemetry offline") })
        )
    };
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: failingTelemetry,
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "godzspeed-temp",
          storageObjectKey: `candidates/${sampleJobId}/rev_1_var_1.webp`,
          contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        }
      }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: "STORAGE_TELEMETRY_UNAVAILABLE",
      message: "Storage telemetry is unavailable."
    });
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  it("completion replay is conservatively checked before mutation classification", async () => {
    const queue = createFakeJobQueue({
      complete: vi.fn().mockResolvedValue({ outcome: "already_applied", job: sampleCompletedJob })
    });
    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(93, 100),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${sampleJobId}/complete`,
      payload: {
        leaseToken: sampleLeaseToken,
        manifestPayload: { promptIdComfy: "123" }
      }
    });

    expect(response.statusCode).toBe(507);
    expect(response.json()).toEqual({
      code: "STORAGE_ADMISSION_DENIED",
      message:
        'Storage admission denied for operation "delivery_write": watermark state is "critical" (93.0% disk usage)',
      operationClass: "delivery_write",
      watermarkState: "critical",
      usedRatio: 0.93,
      totalBytes: 100,
      freeBytes: 7
    });
    expect(queue.complete).not.toHaveBeenCalled();

    await app.close();
  });

  describe("Candidate batch review transition trigger on job complete and fail", () => {
    function createAppWithSpiedProgress(
      queue: JobQueuePort,
      spy: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)
    ) {
      const container = createControlApiContainer({
        uow: new FakeUnitOfWork(),
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      });
      vi.spyOn(
        container.useCases.progressSceneProduction,
        "submitCandidatesForReviewIfBatchComplete"
      ).mockImplementation(spy);
      const app = createControlApiApp(container, {
        jobDispatch: defaultDispatchConfig
      });
      return { app, spy };
    }

    it("triggers submitCandidatesForReviewIfBatchComplete on /complete with outcome applied and candidate job", async () => {
      const queue = createFakeJobQueue({
        complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleCompletedJob })
      });
      const { app, spy } = createAppWithSpiedProgress(queue);

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken }
      });

      expect(response.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(sampleCompletedJob.sceneId);
      await app.close();
    });

    it("triggers submitCandidatesForReviewIfBatchComplete on /complete with outcome already_applied (worker retry)", async () => {
      const queue = createFakeJobQueue({
        complete: vi.fn().mockResolvedValue({ outcome: "already_applied", job: sampleCompletedJob })
      });
      const { app, spy } = createAppWithSpiedProgress(queue);

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken }
      });

      expect(response.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(sampleCompletedJob.sceneId);
      await app.close();
    });

    it("does not trigger on /fail when outcome is applied but job status is queued (retry remaining)", async () => {
      const requeuedJob: RenderJob = {
        ...sampleLeasedJob,
        status: "queued"
      };
      const queue = createFakeJobQueue({
        fail: vi.fn().mockResolvedValue({ outcome: "applied", job: requeuedJob })
      });
      const { app, spy } = createAppWithSpiedProgress(queue);

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "retrying" }
      });

      expect(response.statusCode).toBe(200);
      expect(spy).not.toHaveBeenCalled();
      await app.close();
    });

    it("triggers submitCandidatesForReviewIfBatchComplete on /fail when retries exhausted (status failed)", async () => {
      const failedJob: RenderJob = {
        ...sampleLeasedJob,
        status: "failed"
      };
      const queue = createFakeJobQueue({
        fail: vi.fn().mockResolvedValue({ outcome: "applied", job: failedJob })
      });
      const { app, spy } = createAppWithSpiedProgress(queue);

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "retries exhausted" }
      });

      expect(response.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(failedJob.sceneId);
      await app.close();
    });

    it("triggers submitCandidatesForReviewIfBatchComplete on /fail with already_applied and status failed (worker retry)", async () => {
      const failedJob: RenderJob = {
        ...sampleLeasedJob,
        status: "failed"
      };
      const queue = createFakeJobQueue({
        fail: vi.fn().mockResolvedValue({ outcome: "already_applied", job: failedJob })
      });
      const { app, spy } = createAppWithSpiedProgress(queue);

      const response = await app.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "retry after timeout" }
      });

      expect(response.statusCode).toBe(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(failedJob.sceneId);
      await app.close();
    });

    it("does not trigger on /complete or /fail when jobKind is production", async () => {
      const productionCompletedJob: RenderJob = {
        ...sampleCompletedJob,
        jobKind: "production"
      };
      const queueComplete = createFakeJobQueue({
        complete: vi.fn().mockResolvedValue({ outcome: "applied", job: productionCompletedJob })
      });
      const { app: appComplete, spy: spyComplete } = createAppWithSpiedProgress(queueComplete);

      await appComplete.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken }
      });
      expect(spyComplete).not.toHaveBeenCalled();
      await appComplete.close();

      const productionFailedJob: RenderJob = {
        ...sampleCompletedJob,
        jobKind: "production",
        status: "failed"
      };
      const queueFail = createFakeJobQueue({
        fail: vi.fn().mockResolvedValue({ outcome: "applied", job: productionFailedJob })
      });
      const { app: appFail, spy: spyFail } = createAppWithSpiedProgress(queueFail);

      await appFail.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "error" }
      });
      expect(spyFail).not.toHaveBeenCalled();
      await appFail.close();
    });

    it("propagates unswallowed error from submitCandidatesForReviewIfBatchComplete as 500 on /complete and /fail", async () => {
      const queueComplete = createFakeJobQueue({
        complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleCompletedJob })
      });
      const { app: appComplete } = createAppWithSpiedProgress(
        queueComplete,
        vi.fn().mockRejectedValue(new Error("Simulated UoW failure in batch complete"))
      );

      const completeRes = await appComplete.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/complete`,
        payload: { leaseToken: sampleLeaseToken }
      });
      expect(completeRes.statusCode).toBe(500);
      await appComplete.close();

      const failedJob: RenderJob = { ...sampleLeasedJob, status: "failed" };
      const queueFail = createFakeJobQueue({
        fail: vi.fn().mockResolvedValue({ outcome: "applied", job: failedJob })
      });
      const { app: appFail } = createAppWithSpiedProgress(
        queueFail,
        vi.fn().mockRejectedValue(new Error("Simulated UoW failure in batch complete"))
      );

      const failRes = await appFail.inject({
        method: "POST",
        url: `/api/jobs/${sampleJobId}/fail`,
        payload: { leaseToken: sampleLeaseToken, errorTrace: "err" }
      });
      expect(failRes.statusCode).toBe(500);
      await appFail.close();
    });
  });
});
