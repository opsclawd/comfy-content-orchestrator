import type { SceneId, ShotPlanId } from "@cco/domain";
import {
  compileStoryboardPrevisPrompt,
  STORYBOARD_PREVIS_WORKFLOW_TEMPLATE
} from "../shot-plan-compiler/index.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
import { ShotPlanNotFoundError } from "./plan-shot-plans-errors.js";
import { deriveStoryboardPrevisRerollSeed } from "./plan-shot-plans.js";

export class PrevisBeatNotFoundError extends Error {
  override readonly name = "PrevisBeatNotFoundError";

  constructor(
    readonly shotPlanId: string,
    readonly beatIndex: number
  ) {
    super(`Beat ${beatIndex} was not found on ShotPlan '${shotPlanId}'.`);
  }
}

export class StalePrevisCandidateConflictError extends Error {
  override readonly name = "StalePrevisCandidateConflictError";

  constructor(
    readonly shotPlanId: string,
    readonly beatIndex: number,
    readonly expectedCandidateId: string,
    readonly currentCandidateId: string | undefined
  ) {
    super(
      `Previs for beat ${beatIndex} of ShotPlan '${shotPlanId}' is no longer candidate '${expectedCandidateId}'.`
    );
  }
}

export class InvalidSceneStateForPrevisRerollError extends Error {
  override readonly name = "InvalidSceneStateForPrevisRerollError";

  constructor(
    readonly sceneId: string,
    readonly status: string
  ) {
    super(`Cannot re-roll previs for scene '${sceneId}' in status '${status}'.`);
  }
}

const NON_REROLLABLE_SCENE_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "cancelled",
  "failed"
]);

export interface RerollPrevisBeatInput {
  readonly sceneId: SceneId | string;
  readonly shotPlanId: ShotPlanId | string;
  readonly beatIndex: number;
  readonly expectedCandidateId: string;
}

export interface RerollPrevisBeatResult {
  readonly jobId: string;
  readonly sceneId: string;
  readonly shotPlanId: string;
  readonly beatIndex: number;
  readonly seed: number;
}

/**
 * Enqueues one fresh previs render for a single beat, using the unchanged previs prompt
 * and a new deterministic seed. Does not transition the scene or modify the shot plan.
 */
export class RerollPrevisBeatUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: RerollPrevisBeatInput): Promise<RerollPrevisBeatResult> {
    return await this.uow.execute(async (context) => {
      if (!context.shotPlans || !context.jobs) {
        throw new Error("UnitOfWorkContext.shotPlans and jobs must be configured.");
      }

      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (!scene) {
        throw new SceneNotFoundError(String(input.sceneId));
      }
      if (NON_REROLLABLE_SCENE_STATUSES.has(scene.status)) {
        throw new InvalidSceneStateForPrevisRerollError(scene.id, scene.status);
      }

      const plan = await context.shotPlans.findById(input.shotPlanId as ShotPlanId);
      if (!plan || plan.sceneId !== scene.id) {
        throw new ShotPlanNotFoundError(String(input.shotPlanId));
      }
      if (plan.specRevision !== scene.specRevision) {
        throw new StaleRevisionConflictError(scene.id, plan.specRevision, scene.specRevision);
      }

      const beats = plan.beats ?? [];
      const beatPosition = beats.findIndex((b) => b.beatIndex === input.beatIndex);
      if (beatPosition < 0) {
        throw new PrevisBeatNotFoundError(plan.id, input.beatIndex);
      }
      const beat = beats[beatPosition]!;

      const currentAssociation = plan.previsAssociations.find(
        (a) => a.beatIndex === input.beatIndex
      );
      if (currentAssociation?.candidateId !== input.expectedCandidateId) {
        throw new StalePrevisCandidateConflictError(
          plan.id,
          input.beatIndex,
          input.expectedCandidateId,
          currentAssociation?.candidateId
        );
      }

      const candidates = await context.candidates.listBySceneAndRevision(
        scene.id,
        scene.specRevision
      );
      const rerollOrdinal = candidates.filter(
        (c) => c.variantOrdinal === plan.variantOrdinal && (c.beatIndex ?? 1) === input.beatIndex
      ).length;
      const seed = deriveStoryboardPrevisRerollSeed(
        plan.variantOrdinal,
        beatPosition,
        Math.max(1, rerollOrdinal)
      );

      const previsPrompt = compileStoryboardPrevisPrompt(plan, beat);
      const job = await context.jobs.enqueue({
        sceneId: scene.id,
        jobKind: "candidate",
        workflowTemplate: STORYBOARD_PREVIS_WORKFLOW_TEMPLATE,
        injectedPayload: {
          prompt: previsPrompt.prompt,
          negativePrompt: previsPrompt.negativePrompt,
          seed,
          variantOrdinal: plan.variantOrdinal,
          shotPlanId: plan.id,
          specRevision: plan.specRevision,
          beatIndex: beat.beatIndex
        }
      });

      return {
        jobId: String(job.jobId),
        sceneId: scene.id,
        shotPlanId: plan.id,
        beatIndex: beat.beatIndex,
        seed
      };
    });
  }
}
