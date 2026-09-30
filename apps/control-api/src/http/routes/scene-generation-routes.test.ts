import { describe, expect, it, vi } from "vitest";
import {
  type JobQueuePort,
  type StorageTelemetryPort,
  type TransactionalJobEnqueuer,
  type UnitOfWork,
  type UnitOfWorkContext,
  type SceneRepository,
  type PlanningModelClientPort,
  type PlanningModelOutcome
} from "@cco/application";
import {
  Scene,
  ShotPlan,
  type CampaignId,
  type JobId,
  type RenderJob,
  type SceneId,
  type ShotPlanId
} from "@cco/domain";
import {
  CreateShotPlanVariationResponseSchema,
  GenerationAdmissionResponseSchema
} from "@cco/contracts";
import { createControlApiApp } from "../app.js";

class FakeUnitOfWork implements UnitOfWork {
  private readonly _scenes = new Map<SceneId, Scene>();
  private readonly _shotPlans = new Map<ShotPlanId, ShotPlan>();
  private readonly _savedScenes: Scene[] = [];
  private readonly _savedShotPlans: ShotPlan[] = [];

  constructor(
    seededScenes: Scene[] = [],
    private readonly jobs?: TransactionalJobEnqueuer,
    seededShotPlans: ShotPlan[] = []
  ) {
    for (const s of seededScenes) {
      this._scenes.set(s.id, s);
    }
    for (const p of seededShotPlans) {
      this._shotPlans.set(p.id, p);
    }
  }

  get savedScenes(): readonly Scene[] {
    return this._savedScenes;
  }

  get savedShotPlans(): readonly ShotPlan[] {
    return this._savedShotPlans;
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const scopedScenes = new Map<SceneId, Scene>();
    for (const [id, scene] of this._scenes) {
      scopedScenes.set(id, Scene.reconstitute(scene.snapshot()));
    }
    const scopedShotPlans = new Map<ShotPlanId, ShotPlan>();
    for (const [id, plan] of this._shotPlans) {
      scopedShotPlans.set(id, ShotPlan.reconstitute(plan.snapshot()));
    }
    const stagedScenes: Scene[] = [];
    const stagedShotPlans: ShotPlan[] = [];
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
      shotPlans: {
        findById: async (id: ShotPlanId) =>
          stagedShotPlans.find((p) => p.id === id) ?? scopedShotPlans.get(id),
        save: async (shotPlan: ShotPlan) => {
          stagedShotPlans.push(shotPlan);
        },
        saveMany: async (plans: readonly ShotPlan[]) => {
          stagedShotPlans.push(...plans);
        },
        listBySceneAndRevision: async (sId, rev) =>
          [...scopedShotPlans.values(), ...stagedShotPlans].filter(
            (p) => p.sceneId === sId && p.specRevision === rev
          ),
        listByScene: async (sId) =>
          [...scopedShotPlans.values(), ...stagedShotPlans].filter((p) => p.sceneId === sId),
        listByIdempotencyKey: async (sId, key) =>
          [...scopedShotPlans.values(), ...stagedShotPlans].filter(
            (p) => p.sceneId === sId && p.idempotencyKey === key
          )
      },
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
            enqueue: async (input) => this.jobs!.enqueue(input),
            areAllJobsTerminal: async (sceneId, jobKind) =>
              this.jobs!.areAllJobsTerminal(sceneId, jobKind)
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
    for (const plan of stagedShotPlans) {
      this._shotPlans.set(plan.id, ShotPlan.reconstitute(plan.snapshot()));
      this._savedShotPlans.push(plan);
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
    defer: vi.fn().mockResolvedValue({ outcome: "not_found" }),
    areAllJobsTerminal: vi.fn().mockResolvedValue(false)
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
      defer: vi.fn().mockResolvedValue({ outcome: "not_found" }),
      areAllJobsTerminal: vi.fn().mockResolvedValue(false)
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

describe("POST /api/scenes/:sceneId/shot-plans/variations", () => {
  const validSceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899";
  const validCampaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800";
  const sourceShotPlanId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73810" as ShotPlanId;

  const createDraftScene = (): Scene => {
    return Scene.create({
      id: validSceneId as SceneId,
      campaignId: validCampaignId as CampaignId,
      configuration: {
        prompt: "A cinematic shot of an ancient library",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });
  };

  const createSourcePlan = (): ShotPlan => {
    return ShotPlan.create({
      id: sourceShotPlanId,
      sceneId: validSceneId as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      status: "draft",
      routingMode: "reference_directed",
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "35mm prime",
      cameraPosition: "tripod",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Wide static shot",
      actionSummary: "Ancient library interior",
      lightingStyle: "softbox_studio",
      environmentDescription: "Dusty library",
      colorPalette: ["#111111", "#222222"],
      subjects: [],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Dust motes floating",
          cameraAction: "holds",
          subjectAction: "none"
        }
      ]
    });
  };

  const validVariationProposal = [
    {
      framing: "medium",
      angle: "eye_level",
      cameraMovement: "dolly_in",
      movementSpeed: "slow",
      lensIntent: "50mm prime",
      cameraPosition: "eye level",
      cameraPromptDescription: "Medium push in shot",
      actionSummary: "Closer look at ancient books",
      lightingStyle: "softbox_studio",
      environmentDescription: "Dusty library",
      colorPalette: ["#111111", "#222222"],
      subjects: [],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Camera pushes in slowly",
          cameraAction: "slow push",
          subjectAction: "none"
        }
      ]
    }
  ];

  function createMockPlanningClients(outcome?: PlanningModelOutcome) {
    const primaryComplete = vi.fn().mockResolvedValue(
      outcome ?? {
        kind: "success",
        rawText: JSON.stringify(validVariationProposal)
      }
    );
    const primary: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: primaryComplete
    };
    const fallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: vi.fn().mockResolvedValue({
        kind: "success",
        rawText: JSON.stringify(validVariationProposal)
      })
    };
    return { primary, fallback, primaryComplete };
  }

  it("returns 503 when planning model clients are not configured", async () => {
    const scene = createDraftScene();
    const sourcePlan = createSourcePlan();
    const { queue } = createRecordingJobQueue();
    const uow = new FakeUnitOfWork([scene], queue, [sourcePlan]);
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
      url: `/api/scenes/${validSceneId}/shot-plans/variations`,
      payload: {
        sourceShotPlanId,
        expectedSpecRevision: 1,
        directorGuidance: "Make it a medium shot with slow push in",
        idempotencyKey: "test-var-key-1"
      }
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("CONFIGURATION_ERROR");
  });

  it("returns 200 with new variation ShotPlan and lineage", async () => {
    const scene = createDraftScene();
    const sourcePlan = createSourcePlan();
    const { queue } = createRecordingJobQueue();
    const uow = new FakeUnitOfWork([scene], queue, [sourcePlan]);
    const { primary, fallback } = createMockPlanningClients();
    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue,
        planningModelClients: { primary, fallback }
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/shot-plans/variations`,
      payload: {
        sourceShotPlanId,
        expectedSpecRevision: 1,
        directorGuidance: "Make it a medium shot with slow push in",
        variantCount: 1,
        idempotencyKey: "test-var-key-2",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(CreateShotPlanVariationResponseSchema.parse(body)).toEqual(body);
    expect(body.sceneId).toBe(validSceneId);
    expect(body.sourceShotPlanId).toBe(sourceShotPlanId);
    expect(body.shotPlans).toHaveLength(1);
    expect(body.shotPlans[0].derivedFromShotPlanId).toBe(sourceShotPlanId);
    expect(body.shotPlans[0].variantOrdinal).toBe(2);
    expect(body.shotPlans[0].framing).toBe("medium");
    expect(body.shotPlans[0].cameraMovement).toBe("dolly_in");
  });

  it("returns 404 when source ShotPlan does not exist", async () => {
    const scene = createDraftScene();
    const { queue } = createRecordingJobQueue();
    const uow = new FakeUnitOfWork([scene], queue);
    const { primary, fallback } = createMockPlanningClients();
    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue,
        planningModelClients: { primary, fallback }
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/shot-plans/variations`,
      payload: {
        sourceShotPlanId: "018e69e0-8a6a-72cb-b1b7-999999999999",
        expectedSpecRevision: 1,
        directorGuidance: "Make it a medium shot",
        idempotencyKey: "test-var-key-3",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      }
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns 400 when request body fails validation (missing guidance)", async () => {
    const scene = createDraftScene();
    const sourcePlan = createSourcePlan();
    const { queue } = createRecordingJobQueue();
    const uow = new FakeUnitOfWork([scene], queue, [sourcePlan]);
    const { primary, fallback } = createMockPlanningClients();
    const app = createControlApiApp(
      {
        uow,
        storageTelemetry: createFakeStorageTelemetry(),
        jobQueue: queue,
        planningModelClients: { primary, fallback }
      },
      {
        jobDispatch: defaultDispatchConfig
      }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/scenes/${validSceneId}/shot-plans/variations`,
      payload: {
        sourceShotPlanId,
        expectedSpecRevision: 1,
        idempotencyKey: "test-var-key-4"
        // missing directorGuidance
      }
    });

    expect(res.statusCode).toBe(400);
  });
});
