import { randomUUID } from "node:crypto";
import { ShotPlan, type SceneId, type ShotPlanId } from "@cco/domain";
import { hashShotPlanVariationRequest } from "@cco/contracts";
import type { PlanningModelClientPort } from "../ports/planning-model-client-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { CANDIDATE_BASE_SEED } from "./progress-scene-production.js";
import {
  compileStoryboardPrevisPrompt,
  STORYBOARD_PREVIS_WORKFLOW_TEMPLATE
} from "../shot-plan-compiler/index.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
import {
  decodePlanningAuthorizationPolicy,
  PlanningOrchestrationKernel,
  type PlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import { buildShotPlanVariationPrompt } from "./shot-plan-prompt.js";
import { parseShotPlanResponse, type ShotPlanProposal } from "./shot-plan-response-parser.js";
import {
  CrossSceneSourceShotPlanError,
  InvalidSceneStateForVariationError,
  InvalidShotPlanVariantCountError,
  ShotPlanValidationError,
  ShotPlanVariationIdempotencyConflictError,
  SourceShotPlanNotFoundError,
  StaleSourceShotPlanRevisionError,
  SupersededSourceShotPlanError
} from "./plan-shot-plans-errors.js";
import { DEFAULT_EXTERNAL_PROCESSING_POLICY } from "./create-client.js";

export interface CreateShotPlanVariationDeps {
  readonly uow: UnitOfWork;
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
  readonly overallTimeoutMs?: number | undefined;
  readonly kernel?: PlanningOrchestrationKernel | undefined;
}

export interface CreateShotPlanVariationInput {
  readonly sceneId: SceneId | string;
  readonly sourceShotPlanId: ShotPlanId | string;
  readonly expectedSpecRevision: number;
  readonly directorGuidance: string;
  readonly variantCount?: number | undefined;
  readonly idempotencyKey: string;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
  readonly overallTimeoutMs?: number | undefined;
  readonly enqueuePrevisJobs?: boolean | undefined;
}

export interface CreateShotPlanVariationResult {
  readonly sceneId: string;
  readonly sourceShotPlanId: string;
  readonly shotPlans: readonly ShotPlan[];
  readonly isIdempotentReplay: boolean;
}

export class CreateShotPlanVariationUseCase {
  private readonly kernel: PlanningOrchestrationKernel;

  constructor(private readonly deps: CreateShotPlanVariationDeps) {
    this.kernel =
      deps.kernel ??
      new PlanningOrchestrationKernel({
        primaryClient: deps.primaryClient,
        fallbackClient: deps.fallbackClient,
        ...(deps.overallTimeoutMs !== undefined ? { overallTimeoutMs: deps.overallTimeoutMs } : {})
      });
  }

  async execute(input: CreateShotPlanVariationInput): Promise<CreateShotPlanVariationResult> {
    const variantCount = input.variantCount ?? 1;
    if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 3) {
      throw new InvalidShotPlanVariantCountError(
        variantCount,
        `ShotPlan variation count must be between 1 and 3, received ${variantCount}.`
      );
    }

    const trimmedGuidance = input.directorGuidance ? input.directorGuidance.trim() : "";
    if (trimmedGuidance.length === 0) {
      throw new ShotPlanValidationError("directorGuidance must not be empty.");
    }

    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw new ShotPlanValidationError("idempotencyKey must not be empty.");
    }

    const requestHashSha256 = await hashShotPlanVariationRequest({
      sceneId: String(input.sceneId),
      sourceShotPlanId: String(input.sourceShotPlanId),
      expectedSpecRevision: input.expectedSpecRevision,
      directorGuidance: trimmedGuidance,
      variantCount
    });

    return await this.deps.uow.execute((context) =>
      this.executeWithContext(context, {
        ...input,
        directorGuidance: trimmedGuidance,
        variantCount,
        requestHashSha256
      })
    );
  }

  private async executeWithContext(
    context: UnitOfWorkContext,
    input: CreateShotPlanVariationInput & {
      readonly variantCount: number;
      readonly requestHashSha256: string;
    }
  ): Promise<CreateShotPlanVariationResult> {
    if (!context.shotPlans) {
      throw new Error("UnitOfWorkContext.shotPlans is not configured.");
    }

    const scene = await context.scenes.findById(input.sceneId as SceneId);
    if (!scene) {
      throw new SceneNotFoundError(input.sceneId);
    }

    // Spec revision fencing
    if (scene.specRevision !== input.expectedSpecRevision) {
      throw new StaleRevisionConflictError(
        scene.id,
        input.expectedSpecRevision,
        scene.specRevision
      );
    }

    // Idempotency check before planning
    const existingByIdempotency = await context.shotPlans.listByIdempotencyKey(
      scene.id,
      input.idempotencyKey
    );
    if (existingByIdempotency.length > 0) {
      const allMatch = existingByIdempotency.every(
        (p) => p.requestHashSha256 === input.requestHashSha256
      );
      if (allMatch) {
        return {
          sceneId: scene.id,
          sourceShotPlanId: String(input.sourceShotPlanId),
          shotPlans: existingByIdempotency,
          isIdempotentReplay: true
        };
      }
      throw new ShotPlanVariationIdempotencyConflictError(input.idempotencyKey);
    }

    // Source ShotPlan validation
    const sourceShotPlan = await context.shotPlans.findById(input.sourceShotPlanId as ShotPlanId);
    if (!sourceShotPlan) {
      throw new SourceShotPlanNotFoundError(String(input.sourceShotPlanId));
    }

    if (sourceShotPlan.sceneId !== scene.id) {
      throw new CrossSceneSourceShotPlanError(sourceShotPlan.id, sourceShotPlan.sceneId, scene.id);
    }

    if (sourceShotPlan.specRevision !== scene.specRevision) {
      throw new StaleSourceShotPlanRevisionError(
        sourceShotPlan.id,
        sourceShotPlan.specRevision,
        scene.specRevision
      );
    }

    if (sourceShotPlan.status === "superseded") {
      throw new SupersededSourceShotPlanError(sourceShotPlan.id, sourceShotPlan.status);
    }

    // Lifecycle state gating
    if (scene.status !== "draft_pending" && scene.status !== "director_review") {
      throw new InvalidSceneStateForVariationError(scene.id, scene.status);
    }

    // Resolve client external processing policy
    let rawPolicy = input.externalProcessingPolicy;
    if (!rawPolicy && context.campaigns && context.clients) {
      const campaign = await context.campaigns.findById(scene.campaignId);
      if (campaign) {
        const client = await context.clients.findById(campaign.clientId);
        if (client) {
          rawPolicy = client.externalProcessingPolicy;
        }
      }
    }

    const policy: PlanningAuthorizationPolicy = decodePlanningAuthorizationPolicy(
      rawPolicy ?? DEFAULT_EXTERNAL_PROCESSING_POLICY
    );

    const targetDurationMs = scene.configuration.durationMs;
    const targetFrameCount = Math.round((targetDurationMs / 1000) * 24);
    const sourceSnapshot = sourceShotPlan.snapshot();
    const boundReferenceIds = new Set(scene.configuration.referenceIds ?? []);

    const proposals = await this.kernel.run({
      policy,
      overallTimeoutMs: input.overallTimeoutMs,
      prepare: async (_signal: AbortSignal) => {
        return {
          buildRequest: (correctiveFeedback?: string) =>
            buildShotPlanVariationPrompt({
              scenePrompt: scene.configuration.prompt,
              sceneDurationMs: targetDurationMs,
              engineProfileId: scene.configuration.engineProfileId,
              sourceShotPlan: sourceSnapshot,
              directorGuidance: input.directorGuidance,
              variantCount: input.variantCount,
              referenceAssetIds: scene.configuration.referenceIds,
              correctiveFeedback
            }),
          parseAndValidate: (rawText: string): readonly ShotPlanProposal[] => {
            const parsed = parseShotPlanResponse(rawText);
            const selected = parsed.slice(0, input.variantCount);
            if (selected.length === 0) {
              throw new ShotPlanValidationError("No valid shot plan proposals found in response.");
            }

            for (let i = 0; i < selected.length; i++) {
              const proposal = selected[i]!;
              if (proposal.beats.length > 0) {
                for (const beat of proposal.beats) {
                  if (
                    beat.startMs < 0 ||
                    beat.endMs > targetDurationMs ||
                    beat.startMs > beat.endMs
                  ) {
                    throw new ShotPlanValidationError(
                      `Variant ${i + 1} beat ${beat.beatIndex} has invalid timing [${beat.startMs}, ${beat.endMs}] for duration ${targetDurationMs}ms.`
                    );
                  }
                }
              }

              if (proposal.subjects.length > 0) {
                for (const subject of proposal.subjects) {
                  if (
                    subject.referenceAssetId &&
                    !boundReferenceIds.has(subject.referenceAssetId)
                  ) {
                    throw new ShotPlanValidationError(
                      `Variant ${i + 1} subject '${subject.subjectId}' references unbound asset ID '${subject.referenceAssetId}'.`
                    );
                  }
                }
              }
            }

            return selected;
          }
        };
      }
    });

    const existingPlans = await context.shotPlans.listBySceneAndRevision(
      scene.id,
      scene.specRevision
    );
    const existingCandidates = context.candidates
      ? await context.candidates.listBySceneAndRevision(scene.id, scene.specRevision)
      : [];
    const maxExistingPlanOrdinal = existingPlans.reduce(
      (max, p) => Math.max(max, p.variantOrdinal),
      0
    );
    const maxExistingCandidateOrdinal = existingCandidates.reduce(
      (max, c) => Math.max(max, c.variantOrdinal),
      0
    );
    const maxExistingOrdinal = Math.max(maxExistingPlanOrdinal, maxExistingCandidateOrdinal);

    const requestedAt = new Date().toISOString();
    const shotPlans: ShotPlan[] = proposals.map((proposal, idx) => {
      const beats =
        proposal.beats.length > 0
          ? proposal.beats
          : [
              {
                beatIndex: 1,
                startMs: 0,
                endMs: targetDurationMs,
                description: proposal.actionSummary,
                cameraAction: proposal.cameraMovement,
                subjectAction: proposal.actionSummary
              }
            ];

      return ShotPlan.create({
        id: randomUUID() as ShotPlanId,
        sceneId: scene.id,
        specRevision: scene.specRevision,
        variantOrdinal: maxExistingOrdinal + idx + 1,
        status: "draft",
        routingMode: sourceShotPlan.routingMode,
        targetDurationMs,
        targetFrameCount,
        framing: proposal.framing,
        angle: proposal.angle,
        lensIntent: proposal.lensIntent,
        cameraPosition: proposal.cameraPosition,
        cameraMovement: proposal.cameraMovement,
        movementSpeed: proposal.movementSpeed,
        cameraPromptDescription: proposal.cameraPromptDescription,
        subjects: proposal.subjects,
        actionSummary: proposal.actionSummary,
        beats,
        lightingStyle: proposal.lightingStyle,
        environmentDescription: proposal.environmentDescription,
        colorPalette: proposal.colorPalette,
        ...(proposal.atmosphere ? { atmosphere: proposal.atmosphere } : {}),
        ...(proposal.dialogue ? { dialogue: proposal.dialogue } : {}),
        continuity: proposal.continuity ?? {
          persistentSubjectIds: [],
          frameAnchorTarget: "none"
        },
        derivedFromShotPlanId: sourceShotPlan.id,
        derivation: {
          sourceShotPlanId: sourceShotPlan.id,
          sourceVariantOrdinal: sourceShotPlan.variantOrdinal,
          directorGuidance: input.directorGuidance,
          machineModel: null,
          provider: this.deps.primaryClient.providerName,
          requestedAt,
          idempotencyKey: input.idempotencyKey,
          requestHashSha256: input.requestHashSha256
        },
        idempotencyKey: input.idempotencyKey,
        requestHashSha256: input.requestHashSha256
      });
    });

    try {
      await context.shotPlans.saveMany(shotPlans);
    } catch (err) {
      // Concurrency race recovery: if concurrent request with same key completed
      const recovery = await context.shotPlans.listByIdempotencyKey(scene.id, input.idempotencyKey);
      if (
        recovery.length > 0 &&
        recovery.every((p) => p.requestHashSha256 === input.requestHashSha256)
      ) {
        return {
          sceneId: scene.id,
          sourceShotPlanId: String(input.sourceShotPlanId),
          shotPlans: recovery,
          isIdempotentReplay: true
        };
      }
      throw err;
    }

    if (input.enqueuePrevisJobs !== false && context.jobs !== undefined) {
      if (scene.status === "draft_pending") {
        scene.beginCandidateGeneration();
        await context.scenes.save(scene);
      }
      for (const plan of shotPlans) {
        const previsPrompt = compileStoryboardPrevisPrompt(plan);
        await context.jobs.enqueue({
          sceneId: scene.id,
          jobKind: "candidate",
          workflowTemplate: STORYBOARD_PREVIS_WORKFLOW_TEMPLATE,
          injectedPayload: {
            prompt: previsPrompt.prompt,
            negativePrompt: previsPrompt.negativePrompt,
            seed: CANDIDATE_BASE_SEED + plan.variantOrdinal,
            variantOrdinal: plan.variantOrdinal,
            shotPlanId: plan.id,
            specRevision: plan.specRevision
          }
        });
      }
    }

    return {
      sceneId: scene.id,
      sourceShotPlanId: String(input.sourceShotPlanId),
      shotPlans,
      isIdempotentReplay: false
    };
  }
}
