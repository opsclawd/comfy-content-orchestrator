import { describe, expect, it, vi } from "vitest";
import {
  Scene,
  ShotPlan,
  type CampaignId,
  type JobId,
  type RenderJob,
  type SceneId,
  type ShotPlanId
} from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { EnqueueJobInput, TransactionalJobEnqueuer } from "../ports/job-queue-port.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CreateShotPlanVariationUseCase } from "./create-shot-plan-variation.js";
import {
  CrossSceneSourceShotPlanError,
  InvalidSceneStateForVariationError,
  PlanningNotAuthorizedError,
  ShotPlanVariationIdempotencyConflictError,
  SourceShotPlanNotFoundError,
  StaleRevisionConflictError,
  StaleSourceShotPlanRevisionError,
  SupersededSourceShotPlanError
} from "./index.js";

describe("CreateShotPlanVariationUseCase", () => {
  const sceneId = "01928374-abcd-7000-8000-000000000001" as SceneId;
  const otherSceneId = "01928374-abcd-7000-8000-000000000099" as SceneId;
  const campaignId = "01928374-abcd-7000-8000-000000000002" as CampaignId;
  const sourceShotPlanId = "01928374-abcd-7000-8000-000000000010" as ShotPlanId;

  type SceneSnapshot = ReturnType<Scene["snapshot"]>;

  function createTestScene(overrides?: Partial<SceneSnapshot>) {
    const base = Scene.create({
      id: sceneId,
      campaignId,
      configuration: {
        prompt: "A neon-lit cyberpunk alleyway with rain reflections",
        referenceIds: ["01923456-789a-7b3c-9d4e-5f6071829311"],
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4000
      }
    });
    if (overrides) {
      return Scene.reconstitute({
        ...base.snapshot(),
        ...overrides
      });
    }
    return base;
  }

  function createTestSourcePlan(overrides?: Partial<Parameters<typeof ShotPlan.create>[0]>) {
    return ShotPlan.create({
      id: sourceShotPlanId,
      sceneId,
      specRevision: 1,
      variantOrdinal: 1,
      status: "draft",
      routingMode: "reference_directed",
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "35mm prime",
      cameraPosition: "eye level tripod",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Wide static shot of rainy alley",
      actionSummary: "Protagonist stands under neon light",
      lightingStyle: "neon_night",
      environmentDescription: "Rainy alley with puddles",
      colorPalette: ["#ff0055", "#00ffff"],
      subjects: [
        {
          subjectId: "hero-1",
          referenceAssetId: "01923456-789a-7b3c-9d4e-5f6071829311",
          role: "subject_identity",
          initialPosition: "screen_center",
          movementTrajectory: "stationary"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Hero looks up at sky",
          cameraAction: "holds steady",
          subjectAction: "tilts head"
        }
      ],
      ...overrides
    });
  }

  const validVariationProposalJson = [
    {
      framing: "medium_close_up",
      angle: "eye_level",
      cameraMovement: "dolly_in",
      movementSpeed: "slow",
      lensIntent: "50mm prime cinematic",
      cameraPosition: "chest height, facing subject",
      cameraPromptDescription: "Tighter 50mm shot with slow push in",
      actionSummary: "Protagonist examines glowing shard as camera pushes in",
      lightingStyle: "neon_night",
      environmentDescription: "Rainy alley with puddles",
      colorPalette: ["#ff0055", "#00ffff"],
      subjects: [
        {
          subjectId: "hero-1",
          referenceAssetId: "01923456-789a-7b3c-9d4e-5f6071829311",
          role: "subject_identity",
          initialPosition: "screen_center",
          movementTrajectory: "raises hands to inspect shard"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Camera pushes in slowly as shard glows",
          cameraAction: "slow dolly in",
          subjectAction: "inspects glowing shard"
        }
      ]
    }
  ];

  function createMockClients(outcome?: PlanningModelOutcome) {
    const primaryComplete =
      vi.fn<(request: PlanningModelRequest) => Promise<PlanningModelOutcome>>();
    primaryComplete.mockResolvedValue(
      outcome ?? {
        kind: "success",
        rawText: JSON.stringify(validVariationProposalJson)
      }
    );
    const primaryClient: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: primaryComplete
    };

    const fallbackComplete =
      vi.fn<(request: PlanningModelRequest) => Promise<PlanningModelOutcome>>();
    fallbackComplete.mockResolvedValue({
      kind: "success",
      rawText: JSON.stringify(validVariationProposalJson)
    });
    const fallbackClient: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: fallbackComplete
    };

    return { primaryClient, fallbackClient, primaryComplete, fallbackComplete };
  }

  it("creates a directed variation from a preferred ShotPlan with natural language guidance", async () => {
    const scene = createTestScene();
    const sourcePlan = createTestSourcePlan();
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);

    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      sourceShotPlanId: sourcePlan.id,
      expectedSpecRevision: 1,
      directorGuidance: "Keep this composition, make it a tighter 50mm shot with slow dolly in",
      variantCount: 1,
      idempotencyKey: "var-idemp-key-1",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.sceneId).toBe(scene.id);
    expect(result.sourceShotPlanId).toBe(sourcePlan.id);
    expect(result.shotPlans).toHaveLength(1);

    const variation = result.shotPlans[0]!;
    expect(variation.id).not.toBe(sourcePlan.id);
    expect(variation.specRevision).toBe(sourcePlan.specRevision);
    expect(variation.variantOrdinal).toBe(2);
    expect(variation.status).toBe("draft");
    expect(variation.framing).toBe("medium_close_up");
    expect(variation.cameraMovement).toBe("dolly_in");
    expect(variation.lensIntent).toBe("50mm prime cinematic");

    // Lineage & Provenance
    expect(variation.derivedFromShotPlanId).toBe(sourcePlan.id);
    expect(variation.derivation).toBeDefined();
    expect(variation.derivation?.sourceShotPlanId).toBe(sourcePlan.id);
    expect(variation.derivation?.sourceVariantOrdinal).toBe(1);
    expect(variation.derivation?.directorGuidance).toBe(
      "Keep this composition, make it a tighter 50mm shot with slow dolly in"
    );
    expect(variation.derivation?.provider).toBe("Anthropic");
    expect(variation.idempotencyKey).toBe("var-idemp-key-1");
    expect(variation.requestHashSha256).toMatch(/^[0-9a-f]{64}$/);

    // Source ShotPlan remains byte/logically untouched
    await uow.execute(async (ctx) => {
      expect(ctx.shotPlans).toBeDefined();
      const storedSource = await ctx.shotPlans!.findById(sourcePlan.id);
      expect(storedSource?.snapshot()).toEqual(sourcePlan.snapshot());
      const storedScene = await ctx.scenes.findById(scene.id);
      expect(storedScene?.specRevision).toBe(1);
    });

    // Verify planner request received source structured JSON and director guidance
    expect(primaryComplete).toHaveBeenCalledTimes(1);
    const sentRequest = primaryComplete.mock.calls[0]![0];
    expect(sentRequest.userPrompt).toContain(
      "Keep this composition, make it a tighter 50mm shot with slow dolly in"
    );
    expect(sentRequest.userPrompt).toContain("Source ShotPlan (Structured Intent to Refine):");
    expect(sentRequest.userPrompt).toContain('"framing": "wide"');
  });

  it("fails with SourceShotPlanNotFoundError when source ShotPlan does not exist", async () => {
    const scene = createTestScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: "01928374-abcd-7000-8000-999999999999" as ShotPlanId,
        expectedSpecRevision: 1,
        directorGuidance: "Make it tighter",
        idempotencyKey: "test-key-2",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(SourceShotPlanNotFoundError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("fails with CrossSceneSourceShotPlanError when source belongs to a different scene", async () => {
    const scene = createTestScene();
    const otherSourcePlan = createTestSourcePlan({ sceneId: otherSceneId });
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(otherSourcePlan);
    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: otherSourcePlan.id,
        expectedSpecRevision: 1,
        directorGuidance: "Make it tighter",
        idempotencyKey: "test-key-3",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(CrossSceneSourceShotPlanError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("fails with StaleRevisionConflictError when expectedSpecRevision does not match current scene revision", async () => {
    const scene = createTestScene({ specRevision: 2 });
    const sourcePlan = createTestSourcePlan({ specRevision: 2 });
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);
    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: sourcePlan.id,
        expectedSpecRevision: 1, // Stale
        directorGuidance: "Make it tighter",
        idempotencyKey: "test-key-4",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(StaleRevisionConflictError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("fails with StaleSourceShotPlanRevisionError when source ShotPlan belongs to an earlier revision", async () => {
    const scene = createTestScene({ specRevision: 2 });
    const staleSourcePlan = createTestSourcePlan({ specRevision: 1 });
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(staleSourcePlan);
    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: staleSourcePlan.id,
        expectedSpecRevision: 2,
        directorGuidance: "Make it tighter",
        idempotencyKey: "test-key-5",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(StaleSourceShotPlanRevisionError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("fails with SupersededSourceShotPlanError when source ShotPlan is superseded", async () => {
    const scene = createTestScene();
    const supersededSourcePlan = createTestSourcePlan({ status: "superseded" });
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(supersededSourcePlan);
    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: supersededSourcePlan.id,
        expectedSpecRevision: 1,
        directorGuidance: "Make it tighter",
        idempotencyKey: "test-key-6",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(SupersededSourceShotPlanError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("fails with InvalidSceneStateForVariationError when scene is in a post-production state", async () => {
    const scene = createTestScene({ status: "approved" });
    const sourcePlan = createTestSourcePlan();
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);
    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: sourcePlan.id,
        expectedSpecRevision: 1,
        directorGuidance: "Make it tighter",
        idempotencyKey: "test-key-7",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(InvalidSceneStateForVariationError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("replays idempotently when identical request is submitted with same key", async () => {
    const scene = createTestScene();
    const sourcePlan = createTestSourcePlan();
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);

    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    const request = {
      sceneId: scene.id,
      sourceShotPlanId: sourcePlan.id,
      expectedSpecRevision: 1,
      directorGuidance: "Make it a tighter 50mm shot with slow dolly in",
      variantCount: 1,
      idempotencyKey: "idemp-replay-key",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    };

    const first = await useCase.execute(request);
    expect(first.isIdempotentReplay).toBe(false);
    expect(first.shotPlans).toHaveLength(1);
    expect(primaryComplete).toHaveBeenCalledTimes(1);

    // Replay identical request with same key
    const replay = await useCase.execute(request);
    expect(replay.isIdempotentReplay).toBe(true);
    expect(replay.shotPlans[0]!.id).toBe(first.shotPlans[0]!.id);
    expect(primaryComplete).toHaveBeenCalledTimes(1); // No second planner call
  });

  it("fails with ShotPlanVariationIdempotencyConflictError when different request is submitted with same key", async () => {
    const scene = createTestScene();
    const sourcePlan = createTestSourcePlan();
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);

    const { primaryClient, fallbackClient } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await useCase.execute({
      sceneId: scene.id,
      sourceShotPlanId: sourcePlan.id,
      expectedSpecRevision: 1,
      directorGuidance: "Make it a tighter 50mm shot",
      variantCount: 1,
      idempotencyKey: "conflict-key",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    // Materially different guidance under same idempotency key
    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: sourcePlan.id,
        expectedSpecRevision: 1,
        directorGuidance: "Make it a wide shot from crane high above",
        variantCount: 1,
        idempotencyKey: "conflict-key",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow(ShotPlanVariationIdempotencyConflictError);
  });

  it("enforces reference asset integrity by rejecting hallucinated asset IDs and triggering corrective retry", async () => {
    const scene = createTestScene();
    const sourcePlan = createTestSourcePlan();
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);

    // First proposal returns hallucinated reference asset ID
    const hallucinatedProposal = [
      {
        ...validVariationProposalJson[0]!,
        subjects: [
          {
            subjectId: "hero-1",
            referenceAssetId: "01923456-789a-7b3c-9d4e-999999999999", // Unbound!
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "stationary"
          }
        ]
      }
    ];

    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    // 1st attempt: invalid reference ID, 2nd attempt: corrected valid proposal
    primaryComplete
      .mockResolvedValueOnce({
        kind: "success",
        rawText: JSON.stringify(hallucinatedProposal)
      })
      .mockResolvedValueOnce({
        kind: "success",
        rawText: JSON.stringify(validVariationProposalJson)
      });

    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      sourceShotPlanId: sourcePlan.id,
      expectedSpecRevision: 1,
      directorGuidance: "Make it tighter",
      idempotencyKey: "ref-retry-key",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.shotPlans).toHaveLength(1);
    expect(primaryComplete).toHaveBeenCalledTimes(2);
    // Second call must have received corrective feedback
    expect(primaryComplete.mock.calls[1]![0].userPrompt).toContain(
      "references unbound asset ID '01923456-789a-7b3c-9d4e-999999999999'"
    );
  });

  it("fails with PlanningNotAuthorizedError when cloud planning is disabled", async () => {
    const scene = createTestScene();
    const sourcePlan = createTestSourcePlan();
    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan);

    const { primaryClient, fallbackClient, primaryComplete } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        sourceShotPlanId: sourcePlan.id,
        expectedSpecRevision: 1,
        directorGuidance: "Make it tighter",
        idempotencyKey: "unauth-key",
        externalProcessingPolicy: {
          allowCloudPlanning: false
        }
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(primaryComplete).not.toHaveBeenCalled();
  });

  it("enqueues candidate previs jobs for created variation by default", async () => {
    const scene = createTestScene();
    const sourcePlan = createTestSourcePlan();
    const enqueuedJobs: EnqueueJobInput[] = [];
    const jobEnqueuer: TransactionalJobEnqueuer = {
      enqueue: async (input: EnqueueJobInput): Promise<RenderJob> => {
        enqueuedJobs.push(input);
        const now = new Date();
        return {
          jobId: `job-${enqueuedJobs.length}` as JobId,
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
      },
      areAllJobsTerminal: async () => true
    };

    const uow = new InMemorySceneUnitOfWork([scene]).seedShotPlan(sourcePlan).withJobs(jobEnqueuer);

    const { primaryClient, fallbackClient } = createMockClients();
    const useCase = new CreateShotPlanVariationUseCase({
      uow,
      primaryClient,
      fallbackClient
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      sourceShotPlanId: sourcePlan.id,
      expectedSpecRevision: 1,
      directorGuidance: "Make it tighter 50mm",
      idempotencyKey: "previs-job-key",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.shotPlans).toHaveLength(1);
    expect(enqueuedJobs).toHaveLength(1);
    expect(enqueuedJobs[0]!.jobKind).toBe("candidate");
    expect(enqueuedJobs[0]!.workflowTemplate).toBe("flux_schnell_storyboard_v1");
  });
});
