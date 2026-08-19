import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import type { CampaignId, SceneId } from "@cco/domain";
import type { ControlApiAppOptions, ControlApiContainer } from "../types.js";

export interface ReviewReadRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
}

export const campaignReviewSummarySchema = {
  params: {
    type: "object",
    required: ["campaignId"],
    properties: {
      campaignId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const sceneReviewDetailSchema = {
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

export const reviewReadRoutes: FastifyPluginAsync<ReviewReadRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: ReviewReadRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/review-summary",
    { schema: campaignReviewSummarySchema },
    async (request, reply) => {
      const { campaignId } = request.params;
      const queries = container.queries.sceneReview;

      const summary = queries
        ? await queries.getCampaignReviewSummary(campaignId as CampaignId)
        : undefined;
      if (!summary) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: `Campaign '${campaignId}' review summary was not found.`
        });
      }

      return reply.status(200).send(summary);
    }
  );

  fastify.get<{ Params: { sceneId: string } }>(
    "/api/scenes/:sceneId/review",
    { schema: sceneReviewDetailSchema },
    async (request, reply) => {
      const { sceneId } = request.params;
      const queries = container.queries.sceneReview;

      const detail = queries ? await queries.getSceneReviewDetail(sceneId as SceneId) : undefined;
      if (!detail) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: `Scene '${sceneId}' review detail was not found.`
        });
      }

      const readModel: SceneReviewDetailReadModel = {
        sceneId: detail.sceneId,
        campaignId: detail.campaignId,
        status: detail.status,
        specRevision: detail.specRevision,
        configuration: {
          prompt: detail.configuration.prompt,
          referenceIds: [...detail.configuration.referenceIds],
          engineProfileId: detail.configuration.engineProfileId,
          durationMs: detail.configuration.durationMs,
          ...(detail.configuration.loraConfigurationId !== undefined
            ? { loraConfigurationId: detail.configuration.loraConfigurationId }
            : {})
        },
        ...(detail.selectedCandidateId ? { selectedCandidateId: detail.selectedCandidateId } : {}),
        ...(detail.selectedCandidateRevision !== undefined
          ? { selectedCandidateRevision: detail.selectedCandidateRevision }
          : {}),
        ...(detail.approval ? { approval: detail.approval } : {}),
        candidatesByRevision: detail.candidatesByRevision.map((group) => ({
          specRevision: group.specRevision,
          candidates: group.candidates.map((c) => ({
            candidateId: c.id,
            sceneId: c.sceneId,
            specRevision: c.specRevision,
            variantOrdinal: c.variantOrdinal,
            contentHash: c.contentHash,
            // TODO: Translate candidate locator to presigned/accessible media URL when storage/media service is wired
            media: { available: false },
            ...(c.generationMetadata ? { generationMetadata: c.generationMetadata } : {}),
            createdAt: c.createdAt
          }))
        })),
        allowedActions: [...detail.allowedActions]
      };

      return reply.status(200).send(readModel);
    }
  );
};
