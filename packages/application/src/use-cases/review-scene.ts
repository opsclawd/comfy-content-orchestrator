import { ReviewEventSchema, type ReviewAction } from "@cco/contracts";
import {
  assertReferenceAssetSelectable,
  InvalidShotPlanError,
  InvalidTransitionError,
  ReferenceAssetNotFoundError,
  type CandidateId,
  type ReferenceAssetId,
  type Scene,
  type SceneId,
  type SceneReferenceBinding,
  type SceneSnapshot,
  type SceneTransition,
  type ShotPlanId
} from "@cco/domain";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { CandidateNotFoundError } from "./candidate-not-found-error.js";
import { IdempotencyConflictError } from "./idempotency-conflict-error.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
import { ShotPlanNotFoundError } from "./plan-shot-plans-errors.js";
import type { PlanShotPlansUseCase } from "./plan-shot-plans.js";
import { PlanningProviderNotConfiguredError } from "./scene-creation-errors.js";
import {
  CANDIDATE_BASE_SEED,
  CANDIDATE_BATCH_SIZE,
  CANDIDATE_WORKFLOW_TEMPLATE
} from "./progress-scene-production.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";

export interface ReviewAuditInput {
  readonly sceneId: string;
  readonly eventId: string;
  readonly reviewerName: string;
  readonly occurredAt: string;
  readonly directorNotes?: string;
  readonly expectedSpecRevision?: number;
  readonly resultingSpecRevision?: number;
  readonly requestHashSha256?: string;
}

export type ApproveSceneInput = ReviewAuditInput;
export type RequestRerollInput = ReviewAuditInput;
export type AcceptQASceneInput = ReviewAuditInput;
export type RejectQASceneInput = ReviewAuditInput;
export type CancelSceneInput = ReviewAuditInput;

export interface SelectCandidateInput extends ReviewAuditInput {
  readonly candidateId: CandidateId;
  readonly candidateRevision?: number;
}

export interface SelectShotPlanInput extends ReviewAuditInput {
  readonly shotPlanId: ShotPlanId;
}

export interface ApproveShotPlanInput extends ReviewAuditInput {
  readonly shotPlanId: ShotPlanId;
}

export type RerollShotPlanInput = ReviewAuditInput;

export interface UpdatePromptInput extends ReviewAuditInput {
  readonly prompt: string;
}

export interface UpdateReferencesInput extends ReviewAuditInput {
  readonly referenceIds?: readonly string[] | undefined;
  readonly referenceBindings?: readonly SceneReferenceBinding[] | undefined;
}

export interface UpdateEngineInput extends ReviewAuditInput {
  readonly engineProfileId: string;
}

export interface UpdateDurationInput extends ReviewAuditInput {
  readonly durationMs: number;
}

export interface UpdateLoraInput extends ReviewAuditInput {
  readonly loraConfigurationId: string | null;
}

export interface ReviewExecutionResult {
  readonly isIdempotentReplay: boolean;
  readonly scene: SceneSnapshot;
  readonly acceptedAttemptOrdinal?: number;
}

export async function applySceneApprovalToScene(
  context: UnitOfWorkContext,
  scene: Scene,
  input: ApproveSceneInput
): Promise<{ readonly isIdempotentReplay: boolean; readonly scene: Scene }> {
  const existingEvent = await context.reviewEvents.findById(input.eventId);
  if (existingEvent !== undefined) {
    if (existingEvent.sceneId !== input.sceneId) {
      throw new IdempotencyConflictError(input.eventId);
    }

    if (
      (input.requestHashSha256 !== undefined || existingEvent.requestHashSha256 !== undefined) &&
      input.requestHashSha256 !== existingEvent.requestHashSha256
    ) {
      throw new IdempotencyConflictError(input.eventId);
    }

    return {
      isIdempotentReplay: true,
      scene
    };
  }

  if (
    input.expectedSpecRevision !== undefined &&
    scene.snapshot().specRevision !== input.expectedSpecRevision
  ) {
    throw new StaleRevisionConflictError(
      input.sceneId,
      input.expectedSpecRevision,
      scene.snapshot().specRevision
    );
  }

  const priorSceneStatus = scene.status;
  const transition = scene.approve({
    approvedBy: input.reviewerName,
    approvedAt: input.occurredAt
  });

  const event = ReviewEventSchema.parse({
    eventId: input.eventId,
    sceneId: input.sceneId,
    reviewerName: input.reviewerName,
    action: "approve",
    ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
    mutationPayload: {},
    priorSceneStatus,
    resultingSceneStatus: transition.to,
    ...(input.expectedSpecRevision !== undefined
      ? { expectedSpecRevision: input.expectedSpecRevision }
      : {}),
    ...(input.resultingSpecRevision !== undefined
      ? { resultingSpecRevision: input.resultingSpecRevision }
      : {}),
    ...(input.requestHashSha256 !== undefined
      ? { requestHashSha256: input.requestHashSha256 }
      : {}),
    occurredAt: input.occurredAt
  });

  await context.reviewEvents.append(event);
  await context.scenes.save(scene);

  return {
    isIdempotentReplay: false,
    scene
  };
}

export async function prepareReviewExecution(
  context: UnitOfWorkContext,
  input: ReviewAuditInput
): Promise<
  | { readonly isIdempotentReplay: true; readonly scene: Scene }
  | { readonly isIdempotentReplay: false; readonly scene: Scene }
> {
  // Scene mutations must serialize on the scene row before any other repository
  // operation. PostgresSceneRepository applies FOR UPDATE for this lookup.
  const scene = await context.scenes.findById(input.sceneId as SceneId);
  if (scene === undefined) {
    throw new SceneNotFoundError(input.sceneId);
  }

  const existingEvent = await context.reviewEvents.findById(input.eventId);
  if (existingEvent !== undefined) {
    if (existingEvent.sceneId !== input.sceneId) {
      throw new IdempotencyConflictError(input.eventId);
    }

    if (
      (input.requestHashSha256 !== undefined || existingEvent.requestHashSha256 !== undefined) &&
      input.requestHashSha256 !== existingEvent.requestHashSha256
    ) {
      throw new IdempotencyConflictError(input.eventId);
    }

    return {
      isIdempotentReplay: true,
      scene
    };
  }

  if (
    input.expectedSpecRevision !== undefined &&
    scene.snapshot().specRevision !== input.expectedSpecRevision
  ) {
    throw new StaleRevisionConflictError(
      input.sceneId,
      input.expectedSpecRevision,
      scene.snapshot().specRevision
    );
  }

  return {
    isIdempotentReplay: false,
    scene
  };
}

export class ReviewSceneUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly planShotPlans?: PlanShotPlansUseCase | undefined
  ) {}

  async selectCandidate(input: SelectCandidateInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot()
        };
      }

      const scene = prepared.scene;
      const candidate = await context.candidates.findById(input.candidateId);
      if (candidate === undefined) {
        throw new CandidateNotFoundError(input.candidateId);
      }

      const priorSceneStatus = scene.status;
      const transition = scene.selectCandidate(
        candidate.id,
        candidate.specRevision,
        candidate.sceneId
      );

      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action: "candidate_select",
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: {
          candidateId: candidate.id,
          candidateRevision: candidate.specRevision
        },
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        ...(input.expectedSpecRevision !== undefined
          ? { expectedSpecRevision: input.expectedSpecRevision }
          : {}),
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });

      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot()
      };
    });
  }

  async selectShotPlan(input: SelectShotPlanInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot()
        };
      }

      const scene = prepared.scene;
      if (!context.shotPlans) {
        throw new Error("UnitOfWorkContext.shotPlans is not configured.");
      }

      const shotPlan = await context.shotPlans.findById(input.shotPlanId);
      if (shotPlan === undefined) {
        throw new ShotPlanNotFoundError(input.shotPlanId);
      }

      if (shotPlan.sceneId !== scene.id) {
        throw new InvalidShotPlanError(
          scene.id,
          shotPlan.id,
          "ShotPlan belongs to a different scene"
        );
      }

      if (shotPlan.specRevision !== scene.snapshot().specRevision) {
        throw new InvalidShotPlanError(
          scene.id,
          shotPlan.id,
          "ShotPlan revision does not match current scene revision"
        );
      }

      if (shotPlan.status !== "draft") {
        throw new InvalidShotPlanError(
          scene.id,
          shotPlan.id,
          `ShotPlan status must be 'draft' to select, but was '${shotPlan.status}'`
        );
      }

      const priorSceneStatus = scene.status;
      const transition = scene.selectShotPlan(shotPlan.id, shotPlan.specRevision, shotPlan.sceneId);

      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action: "select_shotplan",
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: {
          shotPlanId: shotPlan.id,
          shotPlanRevision: shotPlan.specRevision
        },
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        ...(input.expectedSpecRevision !== undefined
          ? { expectedSpecRevision: input.expectedSpecRevision }
          : {}),
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });

      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot()
      };
    });
  }

  async approveShotPlan(input: ApproveShotPlanInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot()
        };
      }

      const scene = prepared.scene;
      if (!context.shotPlans) {
        throw new Error("UnitOfWorkContext.shotPlans is not configured.");
      }

      const shotPlan = await context.shotPlans.findById(input.shotPlanId);
      if (shotPlan === undefined) {
        throw new ShotPlanNotFoundError(input.shotPlanId);
      }

      if (shotPlan.sceneId !== scene.id) {
        throw new InvalidShotPlanError(
          scene.id,
          shotPlan.id,
          "ShotPlan belongs to a different scene"
        );
      }

      if (shotPlan.specRevision !== scene.snapshot().specRevision) {
        throw new InvalidShotPlanError(
          scene.id,
          shotPlan.id,
          "ShotPlan revision does not match current scene revision"
        );
      }

      if (shotPlan.status !== "draft") {
        throw new InvalidShotPlanError(
          scene.id,
          shotPlan.id,
          `ShotPlan status must be 'draft' to approve, but was '${shotPlan.status}'`
        );
      }

      const snapshot = scene.snapshot();
      if (snapshot.selectedShotPlanId === undefined) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          "approveShotPlan",
          "Approval requires an active ShotPlan selection."
        );
      }

      if (snapshot.selectedShotPlanId !== shotPlan.id) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          "approveShotPlan",
          `Requested ShotPlan '${shotPlan.id}' does not match currently selected ShotPlan '${snapshot.selectedShotPlanId}'.`
        );
      }

      const priorSceneStatus = scene.status;

      const transition = scene.approveShotPlan({
        shotPlanId: shotPlan.id,
        shotPlanRevision: shotPlan.specRevision,
        shotPlanSceneId: shotPlan.sceneId,
        approvedBy: input.reviewerName,
        approvedAt: input.occurredAt
      });

      shotPlan.approve();
      await context.shotPlans.save(shotPlan);

      const allPlans = await context.shotPlans.listBySceneAndRevision(scene.id, scene.specRevision);
      for (const other of allPlans) {
        if (other.id !== shotPlan.id && other.status === "draft") {
          other.supersede();
          await context.shotPlans.save(other);
        }
      }

      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action: "approve_shotplan",
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: {
          shotPlanId: shotPlan.id,
          shotPlanRevision: shotPlan.specRevision
        },
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        ...(input.expectedSpecRevision !== undefined
          ? { expectedSpecRevision: input.expectedSpecRevision }
          : {}),
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });

      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot()
      };
    });
  }

  async rerollShotPlan(input: RerollShotPlanInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot()
        };
      }

      const scene = prepared.scene;
      const priorSceneStatus = scene.status;

      const transition = scene.rerollShotPlan();

      if (!this.planShotPlans) {
        throw new PlanningProviderNotConfiguredError(
          "Shot plan planning is not available; planning model clients are not configured."
        );
      }

      await this.planShotPlans.executeWithContext(context, {
        sceneId: scene.id,
        reroll: true,
        variantCount: CANDIDATE_BATCH_SIZE,
        enqueuePrevisJobs: true
      });

      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action: "reroll_shotplan",
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: {},
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        ...(input.expectedSpecRevision !== undefined
          ? { expectedSpecRevision: input.expectedSpecRevision }
          : {}),
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });

      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot()
      };
    });
  }

  async approve(input: ApproveSceneInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
      }
      const result = await applySceneApprovalToScene(context, scene, input);
      return {
        isIdempotentReplay: result.isIdempotentReplay,
        scene: result.scene.snapshot()
      };
    });
  }

  async requestReroll(input: RequestRerollInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(
      input,
      "reroll",
      {},
      (scene) => scene.requestReroll(),
      true
    );
  }

  async updatePrompt(input: UpdatePromptInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "prompt_edit", { prompt: input.prompt }, (scene) =>
      scene.updatePrompt(input.prompt)
    );
  }

  async updateReferences(input: UpdateReferencesInput): Promise<ReviewExecutionResult> {
    const effectiveReferenceIds =
      input.referenceIds ??
      (input.referenceBindings
        ? Array.from(new Set(input.referenceBindings.map((b) => b.referenceAssetId)))
        : []);
    return await this.executeReviewAction(
      input,
      "reference_change",
      {
        referenceIds: effectiveReferenceIds,
        ...(input.referenceBindings !== undefined
          ? { referenceBindings: input.referenceBindings }
          : {})
      },
      (scene) => scene.updateReferences(effectiveReferenceIds, input.referenceBindings)
    );
  }

  async updateEngine(input: UpdateEngineInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(
      input,
      "engine_change",
      { engineProfileId: input.engineProfileId },
      (scene) => scene.updateEngine(input.engineProfileId)
    );
  }

  async updateDuration(input: UpdateDurationInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(
      input,
      "duration_change",
      { durationMs: input.durationMs },
      (scene) => scene.updateDuration(input.durationMs)
    );
  }

  async updateLora(input: UpdateLoraInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(
      input,
      "lora_tune",
      { loraConfigurationId: input.loraConfigurationId },
      (scene) =>
        scene.updateLora(input.loraConfigurationId === null ? undefined : input.loraConfigurationId)
    );
  }

  async acceptQA(input: AcceptQASceneInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "approve", {}, (scene) => scene.acceptQA());
  }

  async rejectQA(input: RejectQASceneInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "reject", {}, (scene) => scene.rejectQA());
  }

  async cancel(input: CancelSceneInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "cancel", {}, (scene) => scene.cancel());
  }

  private async executeReviewAction(
    input: ReviewAuditInput,
    action: ReviewAction,
    payload: Record<string, unknown>,
    apply: (scene: Scene) => SceneTransition,
    enqueueCandidates = false
  ): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot()
        };
      }

      const scene = prepared.scene;
      const priorSceneStatus = scene.status;

      const transition = apply(scene);

      if (action === "reference_change" && context.referenceAssets !== undefined) {
        const refIds = (payload as { referenceIds?: readonly string[] }).referenceIds ?? [];
        const bindings =
          (payload as { referenceBindings?: readonly SceneReferenceBinding[] }).referenceBindings ??
          [];
        const allRefIds = [...new Set([...refIds, ...bindings.map((b) => b.referenceAssetId)])];
        if (allRefIds.length > 0 && context.campaigns !== undefined) {
          const campaign = await context.campaigns.findById(scene.campaignId);
          if (campaign !== undefined) {
            const assets =
              typeof context.referenceAssets.findByIdsGlobal === "function"
                ? await context.referenceAssets.findByIdsGlobal(
                    allRefIds as unknown as readonly ReferenceAssetId[],
                    { includeArchived: true }
                  )
                : await context.referenceAssets.findByIds(
                    campaign.clientId,
                    allRefIds as unknown as readonly ReferenceAssetId[],
                    { includeArchived: true }
                  );
            const assetMap = new Map(assets.map((a) => [a.id as string, a]));
            for (const refId of allRefIds) {
              const asset = assetMap.get(refId);
              if (!asset) {
                throw new ReferenceAssetNotFoundError(refId);
              }
              assertReferenceAssetSelectable(asset, campaign.clientId);
            }
          }
        }
      }
      if (enqueueCandidates) {
        if (context.jobs === undefined) {
          throw new TransactionalJobEnqueuerUnavailableError();
        }
        const snapshot = scene.snapshot();
        for (let variantOrdinal = 1; variantOrdinal <= CANDIDATE_BATCH_SIZE; variantOrdinal++) {
          await context.jobs.enqueue({
            sceneId: snapshot.id,
            jobKind: "candidate",
            workflowTemplate: CANDIDATE_WORKFLOW_TEMPLATE,
            injectedPayload: {
              prompt: snapshot.configuration.prompt,
              seed: CANDIDATE_BASE_SEED + variantOrdinal,
              variantOrdinal
            }
          });
        }
      }
      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action,
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: payload,
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        ...(input.expectedSpecRevision !== undefined
          ? { expectedSpecRevision: input.expectedSpecRevision }
          : {}),
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });
      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot()
      };
    });
  }
}
