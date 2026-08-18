import { ReviewEventSchema, type ReviewAction } from "@cco/contracts";
import type { CandidateId, Scene, SceneId, SceneSnapshot, SceneTransition } from "@cco/domain";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { CandidateNotFoundError } from "./candidate-not-found-error.js";
import { IdempotencyConflictError } from "./idempotency-conflict-error.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";

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

export interface UpdatePromptInput extends ReviewAuditInput {
  readonly prompt: string;
}

export interface UpdateReferencesInput extends ReviewAuditInput {
  readonly referenceIds: readonly string[];
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
}

export class ReviewSceneUseCases {
  constructor(private readonly uow: UnitOfWork) {}

  async selectCandidate(input: SelectCandidateInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const existingEvent = await context.reviewEvents.findById(input.eventId);
      if (existingEvent !== undefined) {
        const scene = await context.scenes.findById(input.sceneId as SceneId);
        if (scene === undefined) {
          throw new SceneNotFoundError(input.sceneId);
        }

        if (
          input.requestHashSha256 !== undefined &&
          existingEvent.requestHashSha256 !== undefined &&
          input.requestHashSha256 !== existingEvent.requestHashSha256
        ) {
          throw new IdempotencyConflictError(input.eventId);
        }

        return {
          isIdempotentReplay: true,
          scene: scene.snapshot()
        };
      }

      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
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

  async approve(input: ApproveSceneInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "approve", {}, (scene) =>
      scene.approve({
        approvedBy: input.reviewerName,
        approvedAt: input.occurredAt
      })
    );
  }

  async requestReroll(input: RequestRerollInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "reroll", {}, (scene) => scene.requestReroll());
  }

  async updatePrompt(input: UpdatePromptInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(input, "prompt_edit", { prompt: input.prompt }, (scene) =>
      scene.updatePrompt(input.prompt)
    );
  }

  async updateReferences(input: UpdateReferencesInput): Promise<ReviewExecutionResult> {
    return await this.executeReviewAction(
      input,
      "reference_change",
      { referenceIds: input.referenceIds },
      (scene) => scene.updateReferences(input.referenceIds)
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
    apply: (scene: Scene) => SceneTransition
  ): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const existingEvent = await context.reviewEvents.findById(input.eventId);
      if (existingEvent !== undefined) {
        const scene = await context.scenes.findById(input.sceneId as SceneId);
        if (scene === undefined) {
          throw new SceneNotFoundError(input.sceneId);
        }

        if (
          input.requestHashSha256 !== undefined &&
          existingEvent.requestHashSha256 !== undefined &&
          input.requestHashSha256 !== existingEvent.requestHashSha256
        ) {
          throw new IdempotencyConflictError(input.eventId);
        }

        return {
          isIdempotentReplay: true,
          scene: scene.snapshot()
        };
      }

      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
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
      const transition = apply(scene);
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
