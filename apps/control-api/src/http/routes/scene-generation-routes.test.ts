import { describe, expect, it, vi } from "vitest";
import {
  type JobQueuePort,
  type StorageTelemetryPort,
  type TransactionalJobEnqueuer,
  type UnitOfWork,
  type UnitOfWorkContext,
  type SceneRepository
} from "@cco/application";
import { Scene, type CampaignId, type JobId, type RenderJob, type SceneId } from "@cco/domain";
import { GenerationAdmissionResponseSchema } from "@cco/contracts";
import { createControlApiApp } from "../app.js";

class FakeUnitOfWork implements UnitOfWork {
  private readonly _scenes = new Map<SceneId, Scene>();
  private readonly _savedScenes: Scene[] = [];

  constructor(
    seededScenes: Scene[] = [],
    private readonly jobs?: TransactionalJobEnqueuer
  ) {
    for (const s of seededScenes) {
      this._scenes.set(s.id, s);
    }
  }

  get savedScenes(): readonly Scene[] {
    return this._savedScenes;
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const scopedScenes = new Map<SceneId, Scene>();
    for (const [id, scene] of this._scenes) {
      scopedScenes.set(id, Scene.reconstitute(scene.snapshot()));
    }
    const stagedScenes: Scene[] = [];
    const initialQueueJobs =
      this.jobs && "__enqueuedJobs" in this.jobs
        ? (this.jobs as TransactionalJobEnqueuer & { __enqueuedJobs: RenderJob[] }).__enqueuedJobs
            .length
        : undefined;
    const context: UnitOfWorkContext = {
      scenes: {
        findById: async (id: SceneId) =>
          stagedScenes.find((scene) => scene.id === id) ?? scopedScenes.get(id),
        save: async (scene: Scene) => {
          stagedScenes.push(scene);
        }
      } as SceneRepository,
      reviewEvents: {
        findById: async () => undefined,
        append: async () => {}
      },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      },
      jobs: this.jobs
        ? {
            enqueue: async (input) => this.jobs!.enqueue(input)
          }
        : undefined
    };

    let result: TResult;
    try {
      result = await work(context);
    } catch (error) {
      if (initialQueueJobs !== undefined) {
        const queueJobs = (this.jobs as TransactionalJobEnqueuer & { __enqueuedJobs: RenderJob[] })
          .__enqueuedJobs;
        queueJobs.length = initialQueueJobs;
      }
      throw error;
    }

    for (const scene of stagedScenes) {
      this._scenes.set(scene.id, Scene.reconstitute(scene.snapshot()));
      this._savedScenes.push(scene);
    }

    return result;
  }
}

function createFakeStorageTelemetry(): StorageTelemetryPort {
  return {
    getStorageTelemetry: vi.fn().mockResolvedValue({
      totalBytes: 1_000_000,
      usedBytes: 500_000,
      freeBytes: 500_000,
      buckets: [],
      measuredAt: "2026-09-01T00:00:00.000Z"
    })
  };
}

const defaultDispatchConfig = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

function createRecordingJobQueue(): {
  queue: JobQueuePort;
  enqueuedInputs: unknown[];
  enqueuedJobs: RenderJob[];
} {
  const enqueuedInputs: unknown[] = [];
  const enqueuedJobs: RenderJob[] = [];
  let nextId = 1;

  const queue: JobQueuePort & { __enqueuedJobs: RenderJob[] } = {
    __enqueuedJobs: enqueuedJobs,
    enqueue: vi.fn().mockImplementation(async (input) => {
      enqueuedInputs.push(input);
      const now = new Date();
      const job: RenderJob = {
        jobId: `018e69e0-8a6a-72cb-b1b7-${String(nextId++).padStart(12, "0")}` as JobId,
        sceneId: input.sceneId,
        jobKind: input.jobKind,
        status: "queued",
        workflowTemplate: input.workflowTemplate,
        injectedPayload: input.injectedPayload,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        retryCount: 0,
        maxRetries: input.maxRetries ?? 3,
        errorTrace: null,
        createdAt: now,
        updatedAt: now
      };
      enqueuedJobs.push(job);
      return job;
    }),
    claim: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    heartbeat: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    complete: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    fail: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    defer: vi.fn().mockResolvedValue({ outcome: "not_found" })
  };

  return { queue, enqueuedInputs, enqueuedJobs };
}

describe("POST /api/scenes/:sceneId/generation-admission", () => {
  const validSceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899";
  const validCampaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800";

  const createDraftScene = (id: string = validSceneId): Scene => {
    return Scene.create({
      id: id as SceneId,
      campaignId: validCampaignId as CampaignId,
      configuration: {
        prompt: "A cinematic shot of an ancient library",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });
  };

  it("successfully admits a draft_pending scene and returns 200 with 3 enqueued job IDs", async () => {
    const scene = createDraftScene();
    const { queue, enqueuedJobs } = createRecordingJobQueue();
    const uow = new FakeUnitOfWork([scene], queue);

    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/generation-admission`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Validates against GenerationAdmissionResponseSchema
    expect(GenerationAdmissionResponseSchema.parse(body)).toEqual(body);
    expect(body.sceneId).toBe(validSceneId);
    expect(body.status).toBe("generating_candidates");
    expect(body.specRevision).toBe(1);
    expect(body.enqueuedJobIds).toHaveLength(3);
    expect(body.enqueuedJobIds).toEqual(enqueuedJobs.map((j) => j.jobId));

    // Ensure response does not expose internal RenderJob fields or media properties
    expect(body).not.toHaveProperty("workerId");
    expect(body).not.toHaveProperty("leaseToken");
    expect(body).not.toHaveProperty("injectedPayload");
    expect(body).not.toHaveProperty("retryCount");
    expect(body).not.toHaveProperty("media");

    // Verify scene state in repository
    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.savedScenes[0]!.status).toBe("generating_candidates");
    expect(uow.savedScenes[0]!.snapshot().specRevision).toBe(1);

    // Verify queue called 3 times
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid UUID route parameter with 400 VALIDATION_FAILURE", async () => {
    const { queue } = createRecordingJobQueue();
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

    const res = await app.inject({
      method: "POST",
      url: "/api/scenes/invalid-uuid/generation-admission"
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND when scene does not exist", async () => {
    const nonExistentSceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73000";
    const { queue } = createRecordingJobQueue();
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

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${nonExistentSceneId}/generation-admission`
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(`Scene '${nonExistentSceneId}' was not found.`);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("returns 422 INVALID_DOMAIN_TRANSITION on repeated admission (already generating_candidates)", async () => {
    const scene = createDraftScene();
    scene.beginCandidateGeneration(); // already transitioned
    const uow = new FakeUnitOfWork([scene]);
    const { queue } = createRecordingJobQueue();

    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/generation-admission`
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("INVALID_DOMAIN_TRANSITION");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("propagates queue enqueue failure as 500 error", async () => {
    const scene = createDraftScene();
    const enqueuedJobs: RenderJob[] = [];
    const failingQueue: JobQueuePort & { __enqueuedJobs: RenderJob[] } = {
      __enqueuedJobs: enqueuedJobs,
      enqueue: vi
        .fn()
        .mockImplementationOnce(async () => {
          const job = { jobId: "018e69e0-8a6a-72cb-b1b7-000000000001" as JobId } as RenderJob;
          enqueuedJobs.push(job);
          return job;
        })
        .mockRejectedValue(new Error("Queue persistence failure")),
      claim: vi.fn().mockResolvedValue(undefined),
      start: vi.fn().mockResolvedValue({ outcome: "not_found" }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "not_found" }),
      complete: vi.fn().mockResolvedValue({ outcome: "not_found" }),
      fail: vi.fn().mockResolvedValue({ outcome: "not_found" }),
      defer: vi.fn().mockResolvedValue({ outcome: "not_found" })
    };
    const uow = new FakeUnitOfWork([scene], failingQueue);

    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: failingQueue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/generation-admission`
    });

    expect(res.statusCode).toBe(500);
    expect(uow.savedScenes).toHaveLength(0);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("rejects director_review admission without enqueueing a reroll", async () => {
    const scene = createDraftScene();
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    const uow = new FakeUnitOfWork([scene]);
    const { queue } = createRecordingJobQueue();
    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/generation-admission`
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_DOMAIN_TRANSITION");
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("returns 404 route not found when jobQueue is not supplied to app", async () => {
    const scene = createDraftScene();
    const uow = new FakeUnitOfWork([scene]);

    // App constructed without jobQueue: route should not even be registered
    const app = createControlApiApp({ uow });

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/generation-admission`
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain("not found");
  });
});
