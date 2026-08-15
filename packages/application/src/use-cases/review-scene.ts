import { ReviewEventSchema, type ReviewAction } from "@cco/contracts";
import type { Scene, SceneId, SceneTransition } from "@cco/domain";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export interface ReviewAuditInput {
  readonly sceneId: string;
  readonly eventId: string;
  readonly reviewerName: string;
  readonly occurredAt: string;
  readonly directorNotes?: string;
}

export type ApproveSceneInput = ReviewAuditInput;
export type RequestRerollInput = ReviewAuditInput;
export type AcceptQASceneInput = ReviewAuditInput;
export type RejectQASceneInput = ReviewAuditInput;
export type CancelSceneInput = ReviewAuditInput;

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

export class ReviewSceneUseCases {
  constructor(private readonly uow: UnitOfWork) {}

  async approve(input: ApproveSceneInput): Promise<void> {
    await this.executeReviewAction(input, "approve", {}, (scene) =>
      scene.approve({
        approvedBy: input.reviewerName,
        approvedAt: input.occurredAt
      })
    );
  }

  async requestReroll(input: RequestRerollInput): Promise<void> {
    await this.executeReviewAction(input, "reroll", {}, (scene) => scene.requestReroll());
  }

  async updatePrompt(input: UpdatePromptInput): Promise<void> {
    await this.executeReviewAction(input, "prompt_edit", { prompt: input.prompt }, (scene) =>
      scene.updatePrompt(input.prompt)
    );
  }

  async updateReferences(input: UpdateReferencesInput): Promise<void> {
    await this.executeReviewAction(
      input,
      "reference_change",
      { referenceIds: input.referenceIds },
      (scene) => scene.updateReferences(input.referenceIds)
    );
  }

  async updateEngine(input: UpdateEngineInput): Promise<void> {
    await this.executeReviewAction(
      input,
      "engine_change",
      { engineProfileId: input.engineProfileId },
      (scene) => scene.updateEngine(input.engineProfileId)
    );
  }

  async updateDuration(input: UpdateDurationInput): Promise<void> {
    await this.executeReviewAction(
      input,
      "duration_change",
      { durationMs: input.durationMs },
      (scene) => scene.updateDuration(input.durationMs)
    );
  }

  async updateLora(input: UpdateLoraInput): Promise<void> {
    await this.executeReviewAction(
      input,
      "lora_tune",
      { loraConfigurationId: input.loraConfigurationId },
      (scene) =>
        scene.updateLora(input.loraConfigurationId === null ? undefined : input.loraConfigurationId)
    );
  }

  async acceptQA(input: AcceptQASceneInput): Promise<void> {
    await this.executeReviewAction(input, "approve", {}, (scene) => scene.acceptQA());
  }

  async rejectQA(input: RejectQASceneInput): Promise<void> {
    await this.executeReviewAction(input, "reject", {}, (scene) => scene.rejectQA());
  }

  async cancel(input: CancelSceneInput): Promise<void> {
    await this.executeReviewAction(input, "cancel", {}, (scene) => scene.cancel());
  }

  private async executeReviewAction(
    input: ReviewAuditInput,
    action: ReviewAction,
    payload: Record<string, unknown>,
    apply: (scene: Scene) => SceneTransition
  ): Promise<void> {
    await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
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
        occurredAt: input.occurredAt
      });
      await context.reviewEvents.append(event);
      await context.scenes.save(scene);
    });
  }
}
