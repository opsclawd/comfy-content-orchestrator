import { randomUUID } from "node:crypto";
import { ShotPlan, type SceneId, type ShotPlanId } from "@cco/domain";
import type { PlanningModelClientPort } from "../ports/planning-model-client-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { CANDIDATE_BASE_SEED, CANDIDATE_WORKFLOW_TEMPLATE } from "./progress-scene-production.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import {
  decodePlanningAuthorizationPolicy,
  PlanningOrchestrationKernel,
  type PlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import { buildShotPlanPrompt } from "./shot-plan-prompt.js";
import { parseShotPlanResponse, type ShotPlanProposal } from "./shot-plan-response-parser.js";
import {
  InvalidShotPlanVariantCountError,
  ShotPlanValidationError
} from "./plan-shot-plans-errors.js";
import { DEFAULT_EXTERNAL_PROCESSING_POLICY } from "./create-client.js";

export interface PlanShotPlansDeps {
  readonly uow: UnitOfWork;
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
  readonly overallTimeoutMs?: number | undefined;
  readonly kernel?: PlanningOrchestrationKernel | undefined;
}

export interface PlanShotPlansInput {
  readonly sceneId: SceneId | string;
  readonly variantCount?: number | undefined;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
  readonly overallTimeoutMs?: number | undefined;
  readonly enqueuePrevisJobs?: boolean | undefined;
  readonly reroll?: boolean | undefined;
}

export interface PlanShotPlansResult {
  readonly shotPlans: readonly ShotPlan[];
  readonly isIdempotentReplay: boolean;
}

export class PlanShotPlansUseCase {
  private readonly kernel: PlanningOrchestrationKernel;

  constructor(private readonly deps: PlanShotPlansDeps) {
    this.kernel =
      deps.kernel ??
      new PlanningOrchestrationKernel({
        primaryClient: deps.primaryClient,
        fallbackClient: deps.fallbackClient,
        ...(deps.overallTimeoutMs !== undefined ? { overallTimeoutMs: deps.overallTimeoutMs } : {})
      });
  }

  async execute(input: PlanShotPlansInput): Promise<PlanShotPlansResult> {
    const variantCount = input.variantCount ?? 3;
    if (!Number.isInteger(variantCount) || variantCount < 1 || variantCount > 5) {
      throw new InvalidShotPlanVariantCountError(variantCount);
    }

    return await this.deps.uow.execute((context) =>
      this.executeWithContext(context, { ...input, variantCount })
    );
  }

  async executeWithContext(
    context: UnitOfWorkContext,
    input: PlanShotPlansInput & { readonly variantCount: number }
  ): Promise<PlanShotPlansResult> {
    const scene = await context.scenes.findById(input.sceneId as SceneId);
    if (!scene) {
      throw new SceneNotFoundError(input.sceneId);
    }

    if (!context.shotPlans) {
      throw new Error("UnitOfWorkContext.shotPlans is not configured.");
    }

    const existing = await context.shotPlans.listBySceneAndRevision(scene.id, scene.specRevision);
    if (existing.length > 0 && !input.reroll) {
      return {
        shotPlans: existing,
        isIdempotentReplay: true
      };
    }

    if (input.reroll) {
      for (const p of existing) {
        if (p.status === "draft") {
          p.supersede();
          await context.shotPlans.save(p);
        }
      }
    }

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

    const proposals = await this.kernel.run({
      policy,
      overallTimeoutMs: input.overallTimeoutMs,
      prepare: async (_signal: AbortSignal) => {
        return {
          buildRequest: (correctiveFeedback?: string) =>
            buildShotPlanPrompt({
              scenePrompt: scene.configuration.prompt,
              sceneDurationMs: targetDurationMs,
              engineProfileId: scene.configuration.engineProfileId,
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
            }

            return selected;
          }
        };
      }
    });

    const existingCandidates = context.candidates
      ? await context.candidates.listBySceneAndRevision(scene.id, scene.specRevision)
      : [];
    const maxExistingPlanOrdinal = existing.reduce((max, p) => Math.max(max, p.variantOrdinal), 0);
    const maxExistingCandidateOrdinal = existingCandidates.reduce(
      (max, c) => Math.max(max, c.variantOrdinal),
      0
    );
    const maxExistingOrdinal = Math.max(maxExistingPlanOrdinal, maxExistingCandidateOrdinal);

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
        routingMode: "reference_directed",
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
        }
      });
    });

    await context.shotPlans.saveMany(shotPlans);

    if (input.enqueuePrevisJobs !== false && context.jobs !== undefined) {
      if (scene.status === "draft_pending") {
        scene.beginCandidateGeneration();
        await context.scenes.save(scene);
      }
      for (const plan of shotPlans) {
        await context.jobs.enqueue({
          sceneId: scene.id,
          jobKind: "candidate",
          workflowTemplate: CANDIDATE_WORKFLOW_TEMPLATE,
          injectedPayload: {
            prompt: plan.cameraPromptDescription || scene.configuration.prompt,
            seed: CANDIDATE_BASE_SEED + plan.variantOrdinal,
            variantOrdinal: plan.variantOrdinal,
            shotPlanId: plan.id,
            specRevision: plan.specRevision
          }
        });
      }
    }

    return {
      shotPlans,
      isIdempotentReplay: false
    };
  }
}
