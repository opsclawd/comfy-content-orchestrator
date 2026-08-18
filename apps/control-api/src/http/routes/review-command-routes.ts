import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { ReviewCommandSchema, hashReviewCommand, type ReviewCommandResponse } from "@cco/contracts";
import type { CandidateId } from "@cco/domain";
import type { ReviewExecutionResult } from "@cco/application";
import {
  defaultClock,
  defaultReviewerIdentityResolver,
  type ControlApiAppOptions,
  type ControlApiContainer
} from "../types.js";

export interface ReviewCommandRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
}

export const reviewCommandRouteSchema = {
  params: {
    type: "object",
    required: ["sceneId"],
    properties: {
      sceneId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const reviewCommandRoutes: FastifyPluginAsync<ReviewCommandRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: ReviewCommandRoutesOptions
): Promise<void> => {
  const { container, appOptions } = opts;
  const reviewerIdentityResolver =
    appOptions?.reviewerIdentityResolver ?? defaultReviewerIdentityResolver;
  const clock = appOptions?.clock ?? defaultClock;

  fastify.post<{ Params: { sceneId: string } }>(
    "/api/scenes/:sceneId/review-command",
    { schema: reviewCommandRouteSchema },
    async (request, reply) => {
      const body = ReviewCommandSchema.parse(request.body);

      if (request.params.sceneId !== body.sceneId) {
        return reply.status(400).send({
          code: "VALIDATION_FAILURE",
          message: `Mismatched sceneId in route parameter ('${request.params.sceneId}') and request body ('${body.sceneId}').`
        });
      }

      const reviewerName = await reviewerIdentityResolver.resolve(request);
      const occurredAt = clock.now();

      const requestHashSha256 = await hashReviewCommand({
        sceneId: body.sceneId,
        expectedSpecRevision: body.expectedSpecRevision,
        action: body.action,
        payload: body.payload,
        ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {})
      });

      let result: ReviewExecutionResult;

      switch (body.action) {
        case "candidate_select":
          result = await container.useCases.reviewScene.selectCandidate({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256,
            candidateId: body.payload.candidateId as CandidateId
          });
          break;

        case "approve":
          result = await container.useCases.reviewScene.approve({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256
          });
          break;

        case "reroll":
          result = await container.useCases.reviewScene.requestReroll({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256
          });
          break;

        case "prompt_edit":
          result = await container.useCases.reviewScene.updatePrompt({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256,
            prompt: body.payload.prompt
          });
          break;

        case "reference_change":
          result = await container.useCases.reviewScene.updateReferences({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256,
            referenceIds: body.payload.referenceIds
          });
          break;

        case "engine_change":
          result = await container.useCases.reviewScene.updateEngine({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256,
            engineProfileId: body.payload.engineProfileId
          });
          break;

        case "duration_change":
          result = await container.useCases.reviewScene.updateDuration({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256,
            durationMs: body.payload.durationMs
          });
          break;

        case "lora_tune":
          result = await container.useCases.reviewScene.updateLora({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256,
            loraConfigurationId: body.payload.loraConfigurationId ?? null
          });
          break;

        case "cancel":
          result = await container.useCases.reviewScene.cancel({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256
          });
          break;

        case "reject":
          result = await container.useCases.reviewScene.rejectQA({
            sceneId: body.sceneId,
            eventId: body.actionId,
            reviewerName,
            occurredAt,
            ...(body.directorNotes !== undefined ? { directorNotes: body.directorNotes } : {}),
            expectedSpecRevision: body.expectedSpecRevision,
            requestHashSha256
          });
          break;

        default: {
          const _exhaustive: never = body;
          throw new Error(`Unhandled action: ${(_exhaustive as { action: string }).action}`);
        }
      }

      const response: ReviewCommandResponse = {
        sceneId: result.scene.id,
        status: result.scene.status,
        specRevision: result.scene.specRevision,
        ...(result.scene.selectedCandidateId !== undefined
          ? { selectedCandidateId: result.scene.selectedCandidateId }
          : {}),
        ...(result.scene.approval !== undefined ? { approval: result.scene.approval } : {}),
        isIdempotentReplay: result.isIdempotentReplay
      };

      return reply.status(200).send(response);
    }
  );
};
