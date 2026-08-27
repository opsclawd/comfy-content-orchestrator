import { describe, expect, it, vi } from "vitest";
import type { JobId, LeaseToken, RenderJob, SceneId } from "@cco/domain";
import {
  InvalidJobCompletionPayloadError,
  StorageAdmissionUnavailableError,
  type JobMutationResult,
  type JobQueuePort,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import { ControlApiConfigError } from "../../runtime-config.js";
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

const defaultDispatchConfig = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

function createFakeJobQueue(overrides?: Partial<JobQueuePort>): JobQueuePort {
  return {
    claim: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    heartbeat: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    complete: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    fail: vi.fn().mockResolvedValue({ outcome: "not_found" } as JobMutationResult),
    ...overrides
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

  it("claim returns an empty 204 when no job is admissible", async () => {
    const queue = createFakeJobQueue({
      claim: vi.fn().mockResolvedValue(undefined)
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
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
    expect(queue.complete).toHaveBeenLastCalledWith(sampleJobId, sampleLeaseToken, undefined);

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
    expect(queue.complete).toHaveBeenLastCalledWith(sampleJobId, sampleLeaseToken, manifest);

    await app.close();
  });

  it("fail delegates the persisted error trace", async () => {
    const queue = createFakeJobQueue({
      fail: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleFailedJob })
    });

    const app = createControlApiApp(
      {
        uow: new FakeUnitOfWork(),
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
      }
    ];

    for (const ep of mutationEndpoints) {
      it(`mutation applied returns 200 for ${ep.name}`, async () => {
        const queue = createFakeJobQueue({
          [ep.mockKey]: vi.fn().mockResolvedValue({ outcome: "applied", job: ep.sampleJob })
        });
        const app = createControlApiApp(
          { uow: new FakeUnitOfWork(), jobQueue: queue },
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
          { uow: new FakeUnitOfWork(), jobQueue: queue },
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
          { uow: new FakeUnitOfWork(), jobQueue: queue },
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
          { uow: new FakeUnitOfWork(), jobQueue: queue },
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
          { uow: new FakeUnitOfWork(), jobQueue: queue },
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
        jobQueue: queue
      });
    }).toThrow(ControlApiConfigError);

    expect(() => {
      createControlApiApp({
        uow: new FakeUnitOfWork(),
        jobQueue: queue
      });
    }).toThrow(
      "Job dispatch timing configuration (options.jobDispatch) is required when jobQueue is supplied"
    );

    expect(() => {
      createControlApiApp(
        {
          uow: new FakeUnitOfWork(),
          jobQueue: queue
        },
        {}
      );
    }).toThrow(ControlApiConfigError);
  });
});
