import { describe, expect, it, vi } from "vitest";
import {
  Scene,
  type CampaignId,
  type JobId,
  type ReferenceAsset,
  type ReferenceAssetId,
  type RenderJob,
  type SceneId,
  type SceneReferenceBinding
} from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest
} from "../ports/planning-model-client-port.js";
import type { ObjectStoragePort, StoredObject } from "../ports/object-storage-port.js";
import type { EnqueueJobInput, TransactionalJobEnqueuer } from "../ports/job-queue-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { MAX_REFERENCE_IMAGE_BYTES, PlanShotPlansUseCase } from "./plan-shot-plans.js";
import {
  InvalidShotPlanVariantCountError,
  ReferenceAssetDescriptionGenerationError,
  CampaignReferenceBibleRoleConflictError,
  StaleBibleBindingMismatchError
} from "./plan-shot-plans-errors.js";
import { PlanningNotAuthorizedError } from "./plan-scene-configuration-errors.js";

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
    outcomes: PlanningModelOutcome[],
    options?: { readonly imageCapability?: boolean }
  ): PlanningModelClientPort & { calls: PlanningModelRequest[] } {
    let callIndex = 0;
    const calls: PlanningModelRequest[] = [];
    return {
      providerName,
      imageCapability: options?.imageCapability,
      supportsImages: options?.imageCapability,
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
        workflowTemplate: "flux_schnell_storyboard_v1",
        injectedPayload: expect.objectContaining({
          shotPlanId: v1.id,
          variantOrdinal: 1,
          specRevision: scene.specRevision,
          prompt: expect.stringContaining("Professional advertising storyboard illustration"),
          negativePrompt: expect.stringContaining("photorealistic")
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

  function createTestAsset(overrides: Partial<ReferenceAsset> = {}): ReferenceAsset {
    const id = (overrides.id ?? "01928374-abcd-7000-8000-000000000010") as ReferenceAssetId;
    return Object.freeze({
      id,
      clientId: "01928374-abcd-7000-8000-000000000000",
      storageBucket: "godzspeed-reference",
      storageObjectKey: `clients/01928374-abcd-7000-8000-000000000000/references/${overrides.contentHashSha256 ?? "hash-1"}`,
      contentHashSha256: "hash-1",
      mimeType: "image/png",
      displayName: "Reference Asset",
      description: null,
      libraryRole: "subject_identity",
      archivedAt: null,
      ...overrides
    });
  }

  function createTestBinding(
    bindingSceneId: SceneId,
    overrides: Partial<SceneReferenceBinding> = {}
  ): SceneReferenceBinding {
    return Object.freeze({
      sceneId: bindingSceneId,
      specRevision: 1,
      referenceAssetId: "01928374-abcd-7000-8000-000000000010" as ReferenceAssetId,
      role: "subject_identity",
      weight: 1,
      hints: null,
      archivedAt: null,
      ...overrides
    });
  }

  function createMockStorage(
    contents: Record<string, Uint8Array> = {},
    customGetObject?: (
      options: { bucket: string; key: string },
      execOptions?: { signal?: AbortSignal; maxBytes?: number }
    ) => Promise<StoredObject | undefined>
  ): ObjectStoragePort & { getCalls: Array<{ bucket: string; key: string }> } {
    const getCalls: Array<{ bucket: string; key: string }> = [];
    return {
      getCalls,
      putObject: vi.fn(),
      copyObject: vi.fn(),
      getObject: vi.fn(
        customGetObject ??
          (async (
            options: { bucket: string; key: string },
            execOptions?: { signal?: AbortSignal; maxBytes?: number }
          ) => {
            if (execOptions?.signal?.aborted) {
              throw execOptions.signal.reason ?? new Error("Aborted");
            }
            getCalls.push(options);
            const body = contents[options.key] ?? Buffer.from("mock image bytes");
            if (execOptions?.maxBytes !== undefined && body.byteLength > execOptions.maxBytes) {
              throw new Error(
                `Object ${options.bucket}/${options.key} byteLength (${body.byteLength}) exceeds maxBytes limit (${execOptions.maxBytes})`
              );
            }
            return {
              bucket: options.bucket,
              key: options.key,
              body
            };
          })
      )
    };
  }

  function createFlexibleMockClient(
    providerName: "Anthropic" | "OpenAI",
    handler: (req: PlanningModelRequest) => PlanningModelOutcome | Promise<PlanningModelOutcome>,
    options?: { readonly imageCapability?: boolean }
  ): PlanningModelClientPort & { calls: PlanningModelRequest[] } {
    const calls: PlanningModelRequest[] = [];
    return {
      providerName,
      imageCapability: options?.imageCapability,
      supportsImages: options?.imageCapability,
      calls,
      complete: vi.fn(async (req: PlanningModelRequest): Promise<PlanningModelOutcome> => {
        calls.push(req);
        return await handler(req);
      })
    };
  }

  const coupleAndPoolHouseVariantJson = [
    {
      framing: "wide",
      angle: "eye_level",
      cameraMovement: "tracking",
      movementSpeed: "slow",
      lensIntent: "35mm anamorphic",
      cameraPosition: "eye level dolly",
      cameraPromptDescription: "Couple walking towards pool house",
      actionSummary: "A smiling couple walks by the glass-walled pool house",
      lightingStyle: "golden_hour",
      environmentDescription: "Modern pool house with glass walls and stone patio",
      colorPalette: ["#336699", "#aabbcc"],
      subjects: [
        {
          subjectId: "couple-1",
          role: "subject_identity",
          initialPosition: "patio edge",
          movementTrajectory: "approaches pool house"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Smiling couple reaches the pool house lounge",
          cameraAction: "slow track right",
          subjectAction: "couple steps onto stone patio"
        }
      ]
    }
  ];

  it("AC-1: prompt receives canonical tags, binding roles, and non-empty descriptions in text-only request", async () => {
    const scene = createTestScene();
    const asset1 = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000011" as ReferenceAssetId,
      contentHashSha256: "hash-couple",
      storageObjectKey: "refs/couple.jpg",
      mimeType: "image/jpeg"
    });
    const asset2 = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000012" as ReferenceAssetId,
      contentHashSha256: "hash-pool",
      storageObjectKey: "refs/poolhouse.png",
      mimeType: "image/png"
    });

    const binding1 = createTestBinding(scene.id, {
      referenceAssetId: asset1.id,
      role: "subject_identity"
    });
    const binding2 = createTestBinding(scene.id, {
      referenceAssetId: asset2.id,
      role: "location"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset1);
    uow.seedReferenceAsset(asset2);
    uow.seedSceneBinding(binding1);
    uow.seedSceneBinding(binding2);

    const storage = createMockStorage();

    const primaryClient = createFlexibleMockClient("Anthropic", (_req) => {
      return { kind: "success", rawText: JSON.stringify(validVariantJson) };
    });

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      (req) => {
        if (req.images && req.images.length > 0) {
          if (req.userPrompt.includes("subject_identity")) {
            return {
              kind: "success",
              rawText: "A smiling couple in casual clothing outdoors."
            };
          }
          if (req.userPrompt.includes("location")) {
            return {
              kind: "success",
              rawText: "A modern pool house with glass walls and a stone patio."
            };
          }
          return { kind: "success", rawText: "Generic visual description." };
        }
        return { kind: "success", rawText: JSON.stringify(validVariantJson) };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
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

    // 2 description calls on image-capable fallbackClient + 1 text-only shot-plan call on primaryClient
    expect(fallbackClient.calls).toHaveLength(2);
    expect(fallbackClient.calls[0]!.images).toHaveLength(1);
    expect(fallbackClient.calls[1]!.images).toHaveLength(1);

    expect(primaryClient.calls).toHaveLength(1);
    const shotPlanCall = primaryClient.calls[0];
    expect(shotPlanCall).toBeDefined();
    expect(shotPlanCall!.images).toBeUndefined();

    // Verify user prompt contains formatted lines
    expect(shotPlanCall!.userPrompt).toContain("Bound Reference Assets:");
    expect(shotPlanCall!.userPrompt).toContain(
      "<Picture 1> | subject_identity | A smiling couple in casual clothing outdoors."
    );
    expect(shotPlanCall!.userPrompt).toContain(
      "<Picture 2> | location | A modern pool house with glass walls and a stone patio."
    );

    // Verify system prompt contains reference directives
    expect(shotPlanCall!.systemPrompt).toContain("Reference Asset Directives:");
    expect(shotPlanCall!.systemPrompt).toContain("authoritative reference constraints");
    expect(shotPlanCall!.systemPrompt).toContain(
      "- For 'subject_identity': The character or subject identity must strictly follow the described appearance and characteristics."
    );
    expect(shotPlanCall!.systemPrompt).toContain(
      "- For 'location': The scene setting, architecture, and physical environment must strictly match the described location."
    );
  });

  it("AC-2 sequential: generates description at most once per content hash and reuses across plans", async () => {
    const scene1 = Scene.create({
      id: "01928374-abcd-7000-8000-000000000001" as SceneId,
      campaignId,
      configuration: {
        prompt: "Scene 1 description",
        referenceIds: [],
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4000
      }
    });
    const scene2 = Scene.create({
      id: "01928374-abcd-7000-8000-000000000002" as SceneId,
      campaignId,
      configuration: {
        prompt: "Scene 2 description",
        referenceIds: [],
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4000
      }
    });

    const sharedHash = "hash-reusable-shared-99999999999999999999";
    const asset1 = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000011" as ReferenceAssetId,
      contentHashSha256: sharedHash,
      storageObjectKey: "refs/couple1.jpg"
    });
    const asset2 = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000012" as ReferenceAssetId,
      contentHashSha256: sharedHash,
      storageObjectKey: "refs/couple2.jpg"
    });

    const binding1 = createTestBinding(scene1.id, {
      referenceAssetId: asset1.id,
      role: "subject_identity"
    });
    const binding2 = createTestBinding(scene2.id, {
      referenceAssetId: asset2.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene1, scene2]);
    uow.seedReferenceAsset(asset1);
    uow.seedReferenceAsset(asset2);
    uow.seedSceneBinding(binding1);
    uow.seedSceneBinding(binding2);

    const storage = createMockStorage();
    let descriptionGenerationCount = 0;

    const primaryClient = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validVariantJson) },
      { kind: "success", rawText: JSON.stringify(validVariantJson) }
    ]);

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      (req) => {
        if (req.images && req.images.length > 0) {
          descriptionGenerationCount++;
          return {
            kind: "success",
            rawText: "A smiling couple in casual clothing outdoors."
          };
        }
        return { kind: "success", rawText: JSON.stringify(validVariantJson) };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const policy = {
      allowCloudPlanning: true,
      allowedProviders: ["Anthropic", "OpenAI"]
    };

    // Plan scene 1
    const result1 = await useCase.execute({
      sceneId: scene1.id,
      variantCount: 1,
      externalProcessingPolicy: policy
    });
    expect(result1.shotPlans).toHaveLength(1);
    expect(descriptionGenerationCount).toBe(1);

    // Plan scene 2 - should reuse description cached by contentHashSha256!
    const result2 = await useCase.execute({
      sceneId: scene2.id,
      variantCount: 1,
      externalProcessingPolicy: policy
    });
    expect(result2.shotPlans).toHaveLength(1);

    // Description generation call count remains 1!
    expect(descriptionGenerationCount).toBe(1);

    // Verify scene 2 prompt had the cached description
    const scene2ShotPlanCall = primaryClient.calls[1];
    expect(scene2ShotPlanCall).toBeDefined();
    expect(scene2ShotPlanCall!.userPrompt).toContain(
      "<Picture 1> | subject_identity | A smiling couple in casual clothing outdoors."
    );
  });

  it("AC-2 duplicate/concurrent: deduplicates same-hash bindings and serializes concurrent preparation", async () => {
    const scene = createTestScene();
    const sharedHash = "hash-concurrent-shared-12345678901234567890";
    const asset1 = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000011" as ReferenceAssetId,
      contentHashSha256: sharedHash,
      storageObjectKey: "refs/couple1.jpg"
    });
    const asset2 = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000012" as ReferenceAssetId,
      contentHashSha256: sharedHash,
      storageObjectKey: "refs/couple2.jpg"
    });

    // Scene binds both assets with same hash under different roles
    const binding1 = createTestBinding(scene.id, {
      referenceAssetId: asset1.id,
      role: "subject_identity"
    });
    const binding2 = createTestBinding(scene.id, {
      referenceAssetId: asset2.id,
      role: "style"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset1);
    uow.seedReferenceAsset(asset2);
    uow.seedSceneBinding(binding1);
    uow.seedSceneBinding(binding2);

    const storage = createMockStorage();
    let descriptionGenerationCount = 0;

    const primaryClient = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validVariantJson) }
    ]);

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      async (req) => {
        if (req.images && req.images.length > 0) {
          descriptionGenerationCount++;
          // Small delay to simulate network latency
          await new Promise((resolve) => setTimeout(resolve, 10));
          return {
            kind: "success",
            rawText: "A smiling couple with natural warm cinematic tones."
          };
        }
        return { kind: "success", rawText: JSON.stringify(validVariantJson) };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.shotPlans).toHaveLength(1);
    // At most once per content hash
    expect(descriptionGenerationCount).toBe(1);
  });

  it("AC-3: planning a scene with couple-photo subject and pool-house location yields structured plan naming both", async () => {
    const scene = createTestScene();
    const assetCouple = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000021" as ReferenceAssetId,
      contentHashSha256: "hash-couple-ac3",
      storageObjectKey: "refs/couple.jpg"
    });
    const assetPoolHouse = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000022" as ReferenceAssetId,
      contentHashSha256: "hash-poolhouse-ac3",
      storageObjectKey: "refs/poolhouse.png"
    });

    const bindingCouple = createTestBinding(scene.id, {
      referenceAssetId: assetCouple.id,
      role: "subject_identity"
    });
    const bindingPoolHouse = createTestBinding(scene.id, {
      referenceAssetId: assetPoolHouse.id,
      role: "location"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(assetCouple);
    uow.seedReferenceAsset(assetPoolHouse);
    uow.seedSceneBinding(bindingCouple);
    uow.seedSceneBinding(bindingPoolHouse);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", [
      {
        kind: "success",
        rawText: JSON.stringify(coupleAndPoolHouseVariantJson)
      }
    ]);

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      (req) => {
        if (req.images && req.images.length > 0) {
          if (req.userPrompt.includes("subject_identity")) {
            return {
              kind: "success",
              rawText: "A smiling couple in casual clothing outdoors."
            };
          }
          if (req.userPrompt.includes("location")) {
            return {
              kind: "success",
              rawText: "A modern pool house with glass walls and a stone patio."
            };
          }
        }
        return { kind: "success", rawText: "Generic visual description." };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const result = await useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.shotPlans).toHaveLength(1);
    const plan = result.shotPlans[0]!;
    expect(plan.environmentDescription).toContain(
      "Modern pool house with glass walls and stone patio"
    );
    expect(plan.actionSummary).toContain("A smiling couple walks by the glass-walled pool house");
    expect(plan.subjects).toHaveLength(1);
    expect(plan.subjects[0]!.subjectId).toBe("couple-1");
  });

  it("AC-4: fails closed with asset ID on missing storage object", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000031" as ReferenceAssetId,
      contentHashSha256: "hash-missing-obj",
      storageObjectKey: "refs/missing.jpg"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage({}, async () => {
      throw new Error("NoSuchKey: The specified key does not exist.");
    });

    const primaryClient = createMockClient("Anthropic", []);
    const fallbackClient = createMockClient("OpenAI", [], { imageCapability: true });

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const promise = useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    await expect(promise).rejects.toThrow(ReferenceAssetDescriptionGenerationError);
    await expect(promise).rejects.toMatchObject({
      assetId: asset.id
    });
  });

  it("AC-4: fails closed with asset ID on model failure", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000032" as ReferenceAssetId,
      contentHashSha256: "hash-model-fail",
      storageObjectKey: "refs/fail.jpg"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", []);

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      (req) => {
        if (req.images && req.images.length > 0) {
          return {
            kind: "permanent_failure",
            httpStatus: 400,
            message: "Unprocessable image"
          };
        }
        return { kind: "success", rawText: JSON.stringify(validVariantJson) };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const promise = useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    await expect(promise).rejects.toThrow(ReferenceAssetDescriptionGenerationError);
    await expect(promise).rejects.toMatchObject({
      assetId: asset.id
    });
  });

  it("AC-4: fails closed with asset ID on blank model output", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000033" as ReferenceAssetId,
      contentHashSha256: "hash-blank-desc",
      storageObjectKey: "refs/blank.jpg"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", []);

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      (req) => {
        if (req.images && req.images.length > 0) {
          return {
            kind: "success",
            rawText: "   \n\t  "
          };
        }
        return { kind: "success", rawText: JSON.stringify(validVariantJson) };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const promise = useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    await expect(promise).rejects.toThrow(ReferenceAssetDescriptionGenerationError);
    await expect(promise).rejects.toMatchObject({
      assetId: asset.id
    });
  });

  it("AC-4: fails closed with asset ID when active bound asset cannot be resolved", async () => {
    const scene = createTestScene();
    const unresolvableId = "01928374-abcd-7000-8000-000000000099" as ReferenceAssetId;
    const binding = createTestBinding(scene.id, {
      referenceAssetId: unresolvableId,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    // Do not seed the asset into uow
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();
    const primaryClient = createMockClient("Anthropic", []);
    const fallbackClient = createMockClient("OpenAI", []);

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    const promise = useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    await expect(promise).rejects.toThrow(ReferenceAssetDescriptionGenerationError);
    await expect(promise).rejects.toMatchObject({
      assetId: unresolvableId
    });
  });

  it("immutability: preserves frozen ReferenceAsset entity without in-place mutation", async () => {
    const scene = createTestScene();
    const frozenAsset = Object.freeze(
      createTestAsset({
        id: "01928374-abcd-7000-8000-000000000041" as ReferenceAssetId,
        contentHashSha256: "hash-frozen",
        description: null
      })
    );

    const binding = createTestBinding(scene.id, {
      referenceAssetId: frozenAsset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(frozenAsset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", [
      { kind: "success", rawText: JSON.stringify(validVariantJson) }
    ]);

    const fallbackClient = createFlexibleMockClient(
      "OpenAI",
      (req) => {
        if (req.images && req.images.length > 0) {
          return {
            kind: "success",
            rawText: "A frozen reference asset description."
          };
        }
        return { kind: "success", rawText: JSON.stringify(validVariantJson) };
      },
      { imageCapability: true }
    );

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    // Must succeed without throwing "Cannot assign to read only property 'description'"
    const result = await useCase.execute({
      sceneId: scene.id,
      variantCount: 1,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });

    expect(result.shotPlans).toHaveLength(1);
    // The original frozen asset entity was not mutated
    expect(frozenAsset.description).toBeNull();

    // The shot-plan prompt received the generated description
    const shotPlanCall = primaryClient.calls.find((c) => !c.images || c.images.length === 0);
    expect(shotPlanCall?.userPrompt).toContain(
      "<Picture 1> | subject_identity | A frozen reference asset description."
    );
  });

  it("deadline: aborted signal during preparation halts before building shot-plan request", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000051" as ReferenceAssetId,
      contentHashSha256: "hash-timeout"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage(
      {},
      async (_opts: { bucket: string; key: string }, _execOptions?: { signal?: AbortSignal }) => {
        // Simulate timeout/abort during storage retrieval
        const abortErr = new Error("Overall planning deadline of 50ms exceeded");
        abortErr.name = "AbortError";
        throw abortErr;
      }
    );

    let shotPlanCallAttempted = false;
    const primaryClient = createFlexibleMockClient("Anthropic", (req) => {
      if (!req.images || req.images.length === 0) {
        shotPlanCallAttempted = true;
      }
      return { kind: "success", rawText: "description" };
    });

    const fallbackClient = createMockClient("OpenAI", [], { imageCapability: true });

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage,
      overallTimeoutMs: 50
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrow();

    // Shot-plan request was never attempted
    expect(shotPlanCallAttempted).toBe(false);
  });

  it("fails closed with ReferenceAssetDescriptionGenerationError when no image-capable client is configured", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000091" as ReferenceAssetId,
      contentHashSha256: "hash-no-image-client"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", [], { imageCapability: false });
    const fallbackClient = createMockClient("OpenAI", [], { imageCapability: false });

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "ReferenceAssetDescriptionGenerationError",
        referenceAssetId: asset.id
      })
    );
  });

  it("fails closed with PlanningNotAuthorizedError when image-capable client is not authorized by policy", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000092" as ReferenceAssetId,
      contentHashSha256: "hash-unauthorized-image-client"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "location"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", [], { imageCapability: false });
    const fallbackClient = createMockClient("OpenAI", [], { imageCapability: true });

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "PlanningNotAuthorizedError"
      })
    );
  });

  it("fails closed with ReferenceAssetDescriptionGenerationError when context.referenceAssets lacks required cache or locking methods", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000093" as ReferenceAssetId,
      contentHashSha256: "hash-missing-methods"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "subject_identity"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const storage = createMockStorage();

    const primaryClient = createMockClient("Anthropic", [], { imageCapability: false });
    const fallbackClient = createMockClient("OpenAI", [], { imageCapability: true });

    const fakeUow: UnitOfWork = {
      execute: async <T>(fn: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T> => {
        return await uow.execute(async (realCtx) => {
          const brokenCtx: UnitOfWorkContext = {
            ...realCtx,
            referenceAssets: {
              ...realCtx.referenceAssets,
              findDescriptionByContentHash: undefined,
              updateDescriptionByContentHash: undefined,
              withLock: undefined
            } as unknown as typeof realCtx.referenceAssets
          };
          return await fn(brokenCtx);
        });
      }
    };

    const useCase = new PlanShotPlansUseCase({
      uow: fakeUow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "ReferenceAssetDescriptionGenerationError",
        referenceAssetId: asset.id
      })
    );
  });

  it("fails closed with ReferenceAssetDescriptionGenerationError when reference image exceeds MAX_REFERENCE_IMAGE_BYTES", async () => {
    const scene = createTestScene();
    const asset = createTestAsset({
      id: "01928374-abcd-7000-8000-000000000094" as ReferenceAssetId,
      contentHashSha256: "hash-oversized-image"
    });
    const binding = createTestBinding(scene.id, {
      referenceAssetId: asset.id,
      role: "product"
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedReferenceAsset(asset);
    uow.seedSceneBinding(binding);

    const oversizedBytes = new Uint8Array(MAX_REFERENCE_IMAGE_BYTES + 1024);
    const storage = createMockStorage({
      [asset.storageObjectKey]: oversizedBytes
    });

    const primaryClient = createMockClient("Anthropic", [], { imageCapability: false });
    const fallbackClient = createMockClient("OpenAI", [], { imageCapability: true });

    const useCase = new PlanShotPlansUseCase({
      uow,
      primaryClient,
      fallbackClient,
      objectStorage: storage
    });

    await expect(
      useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "ReferenceAssetDescriptionGenerationError",
        referenceAssetId: asset.id
      })
    );
  });

  describe("Campaign Reference Bible", () => {
    it("creates campaign bible once and shares identical subject and location descriptions across scenes in the campaign", async () => {
      const scene1 = Scene.create({
        id: "01928374-abcd-7000-8000-000000000101" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene 1: Bride walks along the beach",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });
      const scene2 = Scene.create({
        id: "01928374-abcd-7000-8000-000000000102" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene 2: Bride sits by the shoreline",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });

      const brideAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000201" as ReferenceAssetId,
        contentHashSha256: "hash-bride",
        description: "A serene bride wearing an ivory lace gown with delicate embroidery"
      });
      const beachAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000202" as ReferenceAssetId,
        contentHashSha256: "hash-beach",
        description: "A secluded tropical beach with white sand and calm turquoise waters"
      });

      const binding1Bride = createTestBinding(scene1.id, {
        referenceAssetId: brideAsset.id,
        role: "subject_identity"
      });
      const binding1Beach = createTestBinding(scene1.id, {
        referenceAssetId: beachAsset.id,
        role: "location"
      });

      const binding2Bride = createTestBinding(scene2.id, {
        referenceAssetId: brideAsset.id,
        role: "subject_identity"
      });
      const binding2Beach = createTestBinding(scene2.id, {
        referenceAssetId: beachAsset.id,
        role: "location"
      });

      const uow = new InMemorySceneUnitOfWork([scene1, scene2]);
      uow.seedReferenceAsset(brideAsset);
      uow.seedReferenceAsset(beachAsset);
      uow.seedSceneBinding(binding1Bride);
      uow.seedSceneBinding(binding1Beach);
      uow.seedSceneBinding(binding2Bride);
      uow.seedSceneBinding(binding2Beach);

      const promptsReceived: string[] = [];
      const primaryClient: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: vi.fn().mockImplementation(async (req: PlanningModelRequest) => {
          promptsReceived.push(req.userPrompt);
          return {
            kind: "success",
            rawText: JSON.stringify(validVariantJson)
          };
        })
      };
      const fallbackClient = createMockClient("OpenAI", []);

      const useCase = new PlanShotPlansUseCase({
        uow,
        primaryClient,
        fallbackClient
      });

      // 1. Plan scene 1
      const res1 = await useCase.execute({
        sceneId: scene1.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      });
      expect(res1.shotPlans.length).toBe(1);

      // Verify campaign bible snapshot in UOW
      const bibleEntries = await uow.execute(async (ctx) =>
        ctx.campaignReferenceBible!.findByCampaignId(campaignId)
      );
      expect(bibleEntries.length).toBe(2);
      expect(bibleEntries[0]!.referenceAssetId).toBe(brideAsset.id);
      expect(bibleEntries[0]!.role).toBe("subject_identity");
      expect(bibleEntries[0]!.biblePromptTag).toBe("<Picture 1>");
      expect(bibleEntries[0]!.description).toBe(brideAsset.description);
      expect(bibleEntries[1]!.referenceAssetId).toBe(beachAsset.id);
      expect(bibleEntries[1]!.role).toBe("location");
      expect(bibleEntries[1]!.biblePromptTag).toBe("<Picture 2>");
      expect(bibleEntries[1]!.description).toBe(beachAsset.description);

      // 2. Plan scene 2
      const res2 = await useCase.execute({
        sceneId: scene2.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      });
      expect(res2.shotPlans.length).toBe(1);

      // Verify that both scene 1 and scene 2 planning prompts received identical descriptions from the bible
      expect(promptsReceived.length).toBe(2);
      expect(promptsReceived[0]).toContain(brideAsset.description);
      expect(promptsReceived[0]).toContain(beachAsset.description);
      expect(promptsReceived[1]).toContain(brideAsset.description);
      expect(promptsReceived[1]).toContain(beachAsset.description);

      // Verify the bible was not modified or changed
      const changes = await uow.execute(async (ctx) =>
        ctx.campaignReferenceBible!.listChanges(campaignId)
      );
      expect(changes.length).toBe(0);
    });

    it("handles a scene with no bound subject or location without error", async () => {
      const emptyScene = Scene.create({
        id: "01928374-abcd-7000-8000-000000000103" as SceneId,
        campaignId,
        configuration: {
          prompt: "A landscape scene with no subjects",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });

      const uow = new InMemorySceneUnitOfWork([emptyScene]);
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
        sceneId: emptyScene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      });

      expect(result.shotPlans.length).toBe(1);
      const bibleEntries = await uow.execute(async (ctx) =>
        ctx.campaignReferenceBible!.findByCampaignId(campaignId)
      );
      expect(bibleEntries.length).toBe(0);
    });

    it("rejects with CampaignReferenceBibleRoleConflictError when an asset is bound with conflicting roles across campaign scenes", async () => {
      const sceneA = Scene.create({
        id: "01928374-abcd-7000-8000-000000000104" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene A",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });
      const sceneB = Scene.create({
        id: "01928374-abcd-7000-8000-000000000105" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene B",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });

      const sharedAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000203" as ReferenceAssetId,
        contentHashSha256: "hash-shared",
        description: "Shared asset"
      });

      // Conflicting roles: subject_identity in Scene A vs location in Scene B
      const bindingA = createTestBinding(sceneA.id, {
        referenceAssetId: sharedAsset.id,
        role: "subject_identity"
      });
      const bindingB = createTestBinding(sceneB.id, {
        referenceAssetId: sharedAsset.id,
        role: "location"
      });

      const uow = new InMemorySceneUnitOfWork([sceneA, sceneB]);
      uow.seedReferenceAsset(sharedAsset);
      uow.seedSceneBinding(bindingA);
      uow.seedSceneBinding(bindingB);

      const primaryClient = createMockClient("Anthropic", []);
      const fallbackClient = createMockClient("OpenAI", []);

      const useCase = new PlanShotPlansUseCase({
        uow,
        primaryClient,
        fallbackClient
      });

      await expect(
        useCase.execute({
          sceneId: sceneA.id,
          variantCount: 1,
          externalProcessingPolicy: {
            allowCloudPlanning: true,
            allowedProviders: ["Anthropic"]
          }
        })
      ).rejects.toThrowError(CampaignReferenceBibleRoleConflictError);
    });

    it("rejects with StaleBibleBindingMismatchError when scene bindings do not match existing campaign bible", async () => {
      const scene1 = Scene.create({
        id: "01928374-abcd-7000-8000-000000000106" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene 1",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });
      const scene2 = Scene.create({
        id: "01928374-abcd-7000-8000-000000000107" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene 2",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });

      const asset1 = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000204" as ReferenceAssetId,
        contentHashSha256: "hash-asset1",
        description: "Asset 1"
      });
      const unrecordedAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000205" as ReferenceAssetId,
        contentHashSha256: "hash-unrecorded",
        description: "Unrecorded Asset"
      });

      const binding1 = createTestBinding(scene1.id, {
        referenceAssetId: asset1.id,
        role: "subject_identity"
      });

      const uow = new InMemorySceneUnitOfWork([scene1, scene2]);
      uow.seedReferenceAsset(asset1);
      uow.seedReferenceAsset(unrecordedAsset);
      uow.seedSceneBinding(binding1);

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

      // 1. Plan scene 1 successfully -> initializes bible with asset1
      await useCase.execute({
        sceneId: scene1.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      });

      // 2. Now scene 2 has unrecordedAsset bound without audited reconciliation
      const binding2 = createTestBinding(scene2.id, {
        referenceAssetId: unrecordedAsset.id,
        role: "subject_identity"
      });
      uow.seedSceneBinding(binding2);

      // Planning scene 2 must throw StaleBibleBindingMismatchError
      await expect(
        useCase.execute({
          sceneId: scene2.id,
          variantCount: 1,
          externalProcessingPolicy: {
            allowCloudPlanning: true,
            allowedProviders: ["Anthropic"]
          }
        })
      ).rejects.toThrowError(StaleBibleBindingMismatchError);
    });

    it("rejects invalid persistentSubjectIds in proposal and triggers corrective retry", async () => {
      const scene = Scene.create({
        id: "01928374-abcd-7000-8000-000000000108" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene with subject and location",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });

      const subjectAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000206" as ReferenceAssetId,
        contentHashSha256: "hash-subject",
        description: "Valid subject"
      });
      const locationAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000207" as ReferenceAssetId,
        contentHashSha256: "hash-location",
        description: "Valid location"
      });

      const bindingSubject = createTestBinding(scene.id, {
        referenceAssetId: subjectAsset.id,
        role: "subject_identity"
      });
      const bindingLocation = createTestBinding(scene.id, {
        referenceAssetId: locationAsset.id,
        role: "location"
      });

      const uow = new InMemorySceneUnitOfWork([scene]);
      uow.seedReferenceAsset(subjectAsset);
      uow.seedReferenceAsset(locationAsset);
      uow.seedSceneBinding(bindingSubject);
      uow.seedSceneBinding(bindingLocation);

      // Proposal 1: improperly lists locationAsset in persistentSubjectIds
      const invalidProposalLocationAsSubject = [
        {
          ...validVariantJson[0],
          continuity: {
            persistentSubjectIds: [locationAsset.id],
            frameAnchorTarget: "none"
          }
        }
      ];

      // Proposal 2: corrected proposal with subjectAsset in persistentSubjectIds
      const correctedProposal = [
        {
          ...validVariantJson[0],
          continuity: {
            persistentSubjectIds: [subjectAsset.id],
            frameAnchorTarget: "none"
          }
        }
      ];

      const calls: PlanningModelRequest[] = [];
      const primaryClient: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: vi.fn().mockImplementation(async (req: PlanningModelRequest) => {
          calls.push(req);
          if (calls.length === 1) {
            return {
              kind: "success",
              rawText: JSON.stringify(invalidProposalLocationAsSubject)
            };
          }
          return {
            kind: "success",
            rawText: JSON.stringify(correctedProposal)
          };
        })
      };
      const fallbackClient = createMockClient("OpenAI", []);

      const useCase = new PlanShotPlansUseCase({
        uow,
        primaryClient,
        fallbackClient
      });

      const result = await useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic"]
        }
      });

      expect(result.shotPlans.length).toBe(1);
      expect(calls.length).toBe(2);
      // Corrective feedback was included in the retry prompt
      expect(calls[1]!.userPrompt).toContain(locationAsset.id);
      expect(calls[1]!.userPrompt).toContain("references a location asset");
    });

    it("satisfies DESIGN-2 by ensuring planner prompts are purely textual with no image bytes, respecting external policy and content-hash caching", async () => {
      const scene = Scene.create({
        id: "01928374-abcd-7000-8000-000000000109" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene testing design 2 policy and text prompt integrity",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });
      const heroAsset = createTestAsset({
        id: "01928374-abcd-7000-8000-000000000099" as ReferenceAssetId,
        contentHashSha256: "hash-design-2-check"
      });
      const scene2 = Scene.create({
        id: "01928374-abcd-7000-8000-000000000110" as SceneId,
        campaignId,
        configuration: {
          prompt: "Scene 2 testing cache reuse",
          referenceIds: [],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4000
        }
      });
      const binding = createTestBinding(scene.id, {
        referenceAssetId: heroAsset.id,
        role: "subject_identity"
      });
      const binding2 = createTestBinding(scene2.id, {
        referenceAssetId: heroAsset.id,
        role: "subject_identity"
      });

      const uow = new InMemorySceneUnitOfWork([scene, scene2]);
      uow.seedReferenceAsset(heroAsset);
      uow.seedSceneBinding(binding);
      uow.seedSceneBinding(binding2);

      let imageClientCalls = 0;
      const storage = createMockStorage({
        [heroAsset.storageObjectKey]: Buffer.from("fake-image-bytes")
      });

      const capturedPlannerRequests: PlanningModelRequest[] = [];
      const primaryClient: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: vi.fn().mockImplementation(async (req: PlanningModelRequest) => {
          capturedPlannerRequests.push(req);
          return {
            kind: "success",
            rawText: JSON.stringify(validVariantJson)
          };
        })
      };

      const fallbackClient: PlanningModelClientPort = {
        providerName: "OpenAI",
        imageCapability: true,
        complete: vi.fn().mockImplementation(async (req: PlanningModelRequest) => {
          if (req.images && req.images.length > 0) {
            imageClientCalls++;
            return {
              kind: "success",
              rawText: "A determined explorer in orange parka"
            };
          }
          return {
            kind: "fallback_exhausted",
            error: "Unused"
          };
        })
      };

      const useCase = new PlanShotPlansUseCase({
        uow,
        primaryClient,
        fallbackClient,
        objectStorage: storage
      });

      const result = await useCase.execute({
        sceneId: scene.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      });

      expect(result.shotPlans).toHaveLength(1);
      expect(imageClientCalls).toBe(1);
      expect(capturedPlannerRequests).toHaveLength(1);

      // Verify planner prompt contains textual descriptions and tags ONLY, never raw image bytes or data URLs
      const plannerPrompt = capturedPlannerRequests[0]!.userPrompt;
      expect(plannerPrompt).toContain("A determined explorer in orange parka");
      expect(plannerPrompt).toContain("<Picture 1>");
      expect(plannerPrompt).not.toContain("data:image/");
      expect(plannerPrompt).not.toContain("fake-image-bytes");
      expect(capturedPlannerRequests[0]!.images).toBeUndefined();

      // Second planning run with same hash reuses content-hash cache without calling describeReferenceImage again

      const result2 = await useCase.execute({
        sceneId: scene2.id,
        variantCount: 1,
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowedProviders: ["Anthropic", "OpenAI"]
        }
      });
      expect(result2.shotPlans).toHaveLength(1);
      expect(imageClientCalls).toBe(1); // Cached! No additional image-description call
    });
  });
});
