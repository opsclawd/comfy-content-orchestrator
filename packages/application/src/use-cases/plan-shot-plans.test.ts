import { describe, expect, it, vi } from "vitest";
import { Scene, type CampaignId, type JobId, type RenderJob, type SceneId } from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { EnqueueJobInput, TransactionalJobEnqueuer } from "../ports/job-queue-port.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { PlanShotPlansUseCase } from "./plan-shot-plans.js";
import { InvalidShotPlanVariantCountError, PlanningNotAuthorizedError } from "./index.js";

describe("PlanShotPlansUseCase", () => {
  const sceneId = "01928374-abcd-7000-8000-000000000001" as SceneId;
  const campaignId = "01928374-abcd-7000-8000-000000000002" as CampaignId;

  function createTestScene() {
    return Scene.create({
      id: sceneId,
      campaignId,
      configuration: {
        prompt: "A neon-lit cyberpunk alleyway with rain reflections",
        referenceIds: [],
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4000
      }
    });
  }

  const validVariantJson = [
    {
      framing: "wide",
      angle: "low_angle",
      cameraMovement: "tracking",
      movementSpeed: "slow",
      lensIntent: "24mm wide",
      cameraPosition: "ground tripod",
      cameraPromptDescription: "Low angle wide shot of rainy neon alleyway",
      actionSummary: "Protagonist walks into frame through mist",
      lightingStyle: "neon_night",
      environmentDescription: "Damp alley with glowing holographic billboards",
      colorPalette: ["#ff0055", "#00ffff"],
      subjects: [
        {
          subjectId: "hero-1",
          role: "subject_identity",
          initialPosition: "background_center",
          movementTrajectory: "approaches camera"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 2000,
          description: "Hero steps into alley",
          cameraAction: "slow track forward",
          subjectAction: "steps over puddle"
        },
        {
          beatIndex: 2,
          startMs: 2000,
          endMs: 4000,
          description: "Hero stops and looks at camera",
          cameraAction: "holds framing",
          subjectAction: "glances toward viewer"
        }
      ]
    },
    {
      framing: "medium",
      angle: "eye_level",
      cameraMovement: "pan_right",
      movementSpeed: "medium",
      lensIntent: "50mm prime",
      cameraPosition: "eye level hand-held",
      cameraPromptDescription: "Medium eye-level shot of hero looking around",
      actionSummary: "Camera pans with hero as they survey the street",
      lightingStyle: "neon_night",
      environmentDescription: "Busy market alleyway",
      colorPalette: ["#ffaa00", "#112233"],
      subjects: [],
      beats: []
    },
    {
      framing: "close_up",
      angle: "dutch_angle",
      cameraMovement: "dolly_in",
      movementSpeed: "fast",
      lensIntent: "85mm telephoto",
      cameraPosition: "tight angle",
      cameraPromptDescription: "Dramatic dutch angle close-up on cybernetic eye",
      actionSummary: "Camera pushes in tight as HUD glints in hero's eye",
      lightingStyle: "neon_night",
      environmentDescription: "Atmospheric shadow",
      colorPalette: ["#00ff00"],
      subjects: [],
      beats: []
    }
  ];

  function createMockClient(
    providerName: "Anthropic" | "OpenAI",
    outcomes: PlanningModelOutcome[]
  ): PlanningModelClientPort & { calls: PlanningModelRequest[] } {
    let callIndex = 0;
    const calls: PlanningModelRequest[] = [];
    return {
      providerName,
      calls,
      complete: vi.fn(async (req: PlanningModelRequest): Promise<PlanningModelOutcome> => {
        calls.push(req);
        const outcome = outcomes[callIndex] ?? outcomes[outcomes.length - 1];
        callIndex++;
        if (!outcome) {
          throw new Error("No outcome mock provided");
        }
        return outcome;
      })
    };
  }

  function createMockJob(input: EnqueueJobInput): RenderJob {
    const now = new Date();
    return {
      jobId: `job-${Math.random()}` as JobId,
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
  }

  it("plans 3 ShotPlan variants successfully with candidate previs jobs enqueued", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const mockJobs: TransactionalJobEnqueuer = {
      enqueue: vi.fn(async (input: EnqueueJobInput) => createMockJob(input)),
      areAllJobsTerminal: vi.fn(async () => false)
    };
    uow.withJobs(mockJobs);

    const primaryClient = createMockClient("Anthropic", [
      {
        kind: "success",
        rawText: JSON.stringify(validVariantJson)
      }
    ]);
    const fallbackClient = createMockClient("OpenAI", []);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      variantCount: 3,
      externalProcessingPolicy: { allowCloudPlanning: true, allowedProviders: ["Anthropic"] }
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.shotPlans).toHaveLength(3);

    const v1 = result.shotPlans[0]!;
    const v2 = result.shotPlans[1]!;
    const v3 = result.shotPlans[2]!;
    expect(v1.variantOrdinal).toBe(1);
    expect(v1.framing).toBe("wide");
    expect(v1.routingMode).toBe("reference_directed");
    expect(v1.status).toBe("draft");

    expect(v2.variantOrdinal).toBe(2);
    expect(v2.framing).toBe("medium");

    expect(v3.variantOrdinal).toBe(3);
    expect(v3.framing).toBe("close_up");

    // Previs candidate render jobs enqueued
    expect(mockJobs.enqueue).toHaveBeenCalledTimes(3);
    expect(mockJobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneId: scene.id,
        jobKind: "candidate",
        injectedPayload: expect.objectContaining({
          shotPlanId: v1.id,
          variantOrdinal: 1,
          specRevision: scene.specRevision
        })
      })
    );

    // Persisted in repository
    expect(uow.savedShotPlans).toHaveLength(3);
  });

  it("replays existing variants deterministically without invoking model or re-enqueueing jobs", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const mockJobs: TransactionalJobEnqueuer = {
      enqueue: vi.fn(async (input: EnqueueJobInput) => createMockJob(input)),
      areAllJobsTerminal: vi.fn(async () => false)
    };
    uow.withJobs(mockJobs);

    const primaryClient = createMockClient("Anthropic", [
      {
        kind: "success",
        rawText: JSON.stringify(validVariantJson)
      }
    ]);
    const fallbackClient = createMockClient("OpenAI", []);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    // First call plans
    const firstResult = await useCase.execute({
      sceneId: scene.id,
      variantCount: 3,
      externalProcessingPolicy: { allowCloudPlanning: true, allowedProviders: ["Anthropic"] }
    });
    expect(firstResult.isIdempotentReplay).toBe(false);
    expect(primaryClient.calls).toHaveLength(1);
    expect(mockJobs.enqueue).toHaveBeenCalledTimes(3);

    // Second call replays
    const secondResult = await useCase.execute({
      sceneId: scene.id,
      variantCount: 3,
      externalProcessingPolicy: { allowCloudPlanning: true, allowedProviders: ["Anthropic"] }
    });
    expect(secondResult.isIdempotentReplay).toBe(true);
    expect(secondResult.shotPlans).toHaveLength(3);
    expect(primaryClient.calls).toHaveLength(1); // Model not called again
    expect(mockJobs.enqueue).toHaveBeenCalledTimes(3); // Jobs not enqueued again
  });

  it("handles reroll by superseding previous draft plans and generating new variants", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);

    const primaryClient = createMockClient("Anthropic", [
      {
        kind: "success",
        rawText: JSON.stringify(validVariantJson)
      },
      {
        kind: "success",
        rawText: JSON.stringify(validVariantJson)
      }
    ]);
    const fallbackClient = createMockClient("OpenAI", []);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    // Initial plan
    await useCase.execute({
      sceneId: scene.id,
      variantCount: 3,
      externalProcessingPolicy: { allowCloudPlanning: true, allowedProviders: ["Anthropic"] }
    });

    // Reroll
    const rerollResult = await useCase.execute({
      sceneId: scene.id,
      variantCount: 3,
      reroll: true,
      externalProcessingPolicy: { allowCloudPlanning: true, allowedProviders: ["Anthropic"] }
    });

    expect(rerollResult.isIdempotentReplay).toBe(false);
    expect(rerollResult.shotPlans).toHaveLength(3);
    expect(primaryClient.calls).toHaveLength(2);
  });

  it("falls back to secondary provider on retryable failure", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);

    const primaryClient = createMockClient("Anthropic", [
      { kind: "retryable_failure", message: "Rate limit exceeded" },
      { kind: "retryable_failure", message: "Rate limit exceeded again" }
    ]);
    const fallbackClient = createMockClient("OpenAI", [
      { kind: "success", rawText: JSON.stringify(validVariantJson) }
    ]);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      variantCount: 3,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.shotPlans).toHaveLength(3);
    expect(fallbackClient.calls).toHaveLength(1);
  });

  it("rejects unauthorized cloud planning", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const primaryClient = createMockClient("Anthropic", []);
    const fallbackClient = createMockClient("OpenAI", []);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        externalProcessingPolicy: { allowCloudPlanning: false }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);
  });

  it("validates bounded variant count (1 to 5)", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const primaryClient = createMockClient("Anthropic", []);
    const fallbackClient = createMockClient("OpenAI", []);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 0
      })
    ).rejects.toThrow(InvalidShotPlanVariantCountError);

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 6
      })
    ).rejects.toThrow(InvalidShotPlanVariantCountError);
  });
});
