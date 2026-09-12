import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { CurrentProductionAttemptReadModel } from "@cco/contracts";
import type { CampaignId, SceneId } from "@cco/domain";
import { StaleRevisionConflictError } from "@cco/application";
import type { ControlApiAppOptions, ControlApiContainer } from "../types.js";

export interface ProductionReviewReadRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
}

export const productionAttemptParamsSchema = {
  type: "object",
  required: ["campaignId", "runId", "sceneId"],
  properties: {
    campaignId: {
      type: "string",
      format: "uuid"
    },
    runId: {
      type: "string",
      format: "uuid"
    },
    sceneId: {
      type: "string",
      format: "uuid"
    }
  },
  additionalProperties: false
} as const;

export const productionAttemptQuerystringSchema = {
  type: "object",
  properties: {
    specRevision: {
      anyOf: [
        {
          type: "integer",
          minimum: 1
        },
        {
          type: "string",
          pattern: "^[1-9][0-9]*$"
        }
      ]
    }
  },
  additionalProperties: false
} as const;

export const productionAttemptRouteSchema = {
  params: productionAttemptParamsSchema,
  querystring: productionAttemptQuerystringSchema
} as const;

export const productionReviewReadRoutes: FastifyPluginAsync<
  ProductionReviewReadRoutesOptions
> = async (fastify: FastifyInstance, opts: ProductionReviewReadRoutesOptions): Promise<void> => {
  const { container } = opts;

  fastify.get<{
    Params: { campaignId: string; runId: string; sceneId: string };
    Querystring: { specRevision?: number | string };
  }>(
    "/api/campaigns/:campaignId/runs/:runId/scenes/:sceneId/production-attempt",
    { schema: productionAttemptRouteSchema },
    async (request, reply) => {
      const { campaignId, runId, sceneId } = request.params;
      const rawRevision = request.query.specRevision;
      const specRevision =
        rawRevision !== undefined
          ? typeof rawRevision === "number"
            ? rawRevision
            : Number.parseInt(rawRevision, 10)
          : undefined;
      const queries = container.queries.currentProductionAttempt;
      const mediaDelivery = container.dependencies.reviewMediaDelivery;

      const attempt = queries
        ? await queries.getCurrentProductionAttempt({
            campaignId: campaignId as CampaignId,
            runId,
            sceneId: sceneId as SceneId
          })
        : undefined;

      if (!attempt) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: `Production attempt for campaign '${campaignId}', run '${runId}', scene '${sceneId}' was not found.`
        });
      }

      if (specRevision !== undefined && specRevision !== attempt.specRevision) {
        throw new StaleRevisionConflictError(sceneId, specRevision, attempt.specRevision);
      }

      if (attempt.availability !== "available" || !attempt.media) {
        const readModel: CurrentProductionAttemptReadModel = {
          runId: attempt.runId,
          sceneId: attempt.sceneId,
          specRevision: attempt.specRevision,
          attemptOrdinal: attempt.attemptOrdinal,
          ...(attempt.productionJobId ? { productionJobId: attempt.productionJobId } : {}),
          technicalState: attempt.technicalState,
          reviewReady: attempt.reviewReady,
          availability: attempt.availability
        };
        return reply.status(200).send(readModel);
      }

      if (!mediaDelivery) {
        const readModel: CurrentProductionAttemptReadModel = {
          runId: attempt.runId,
          sceneId: attempt.sceneId,
          specRevision: attempt.specRevision,
          attemptOrdinal: attempt.attemptOrdinal,
          ...(attempt.productionJobId ? { productionJobId: attempt.productionJobId } : {}),
          technicalState: attempt.technicalState,
          reviewReady: attempt.reviewReady,
          availability: "unavailable"
        };
        return reply.status(200).send(readModel);
      }

      try {
        const url = await mediaDelivery.generatePresignedReadUrl({
          bucket: attempt.media.ref.bucket,
          key: attempt.media.ref.key,
          contentHash: attempt.media.ref.sha256
        });

        if (!url) {
          const readModel: CurrentProductionAttemptReadModel = {
            runId: attempt.runId,
            sceneId: attempt.sceneId,
            specRevision: attempt.specRevision,
            attemptOrdinal: attempt.attemptOrdinal,
            ...(attempt.productionJobId ? { productionJobId: attempt.productionJobId } : {}),
            technicalState: attempt.technicalState,
            reviewReady: attempt.reviewReady,
            availability: "inconsistent"
          };
          return reply.status(200).send(readModel);
        }

        const readModel: CurrentProductionAttemptReadModel = {
          runId: attempt.runId,
          sceneId: attempt.sceneId,
          specRevision: attempt.specRevision,
          attemptOrdinal: attempt.attemptOrdinal,
          ...(attempt.productionJobId ? { productionJobId: attempt.productionJobId } : {}),
          technicalState: attempt.technicalState,
          reviewReady: attempt.reviewReady,
          availability: "available",
          media: {
            url,
            generationManifestId: attempt.media.generationManifestId
          }
        };
        return reply.status(200).send(readModel);
      } catch {
        const readModel: CurrentProductionAttemptReadModel = {
          runId: attempt.runId,
          sceneId: attempt.sceneId,
          specRevision: attempt.specRevision,
          attemptOrdinal: attempt.attemptOrdinal,
          ...(attempt.productionJobId ? { productionJobId: attempt.productionJobId } : {}),
          technicalState: attempt.technicalState,
          reviewReady: attempt.reviewReady,
          availability: "inconsistent"
        };
        return reply.status(200).send(readModel);
      }
    }
  );
};
