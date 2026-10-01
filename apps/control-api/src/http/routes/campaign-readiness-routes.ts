import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ControlApiContainer } from "../types.js";

export interface CampaignReadinessRoutesOptions {
  readonly container: ControlApiContainer;
}

export const campaignReadinessParamsSchema = {
  type: "object",
  required: ["campaignId"],
  properties: {
    campaignId: {
      type: "string",
      format: "uuid"
    }
  },
  additionalProperties: false
} as const;

export const campaignReadinessRouteSchema = {
  params: campaignReadinessParamsSchema
} as const;

export const campaignReadinessRoutes: FastifyPluginAsync<CampaignReadinessRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: CampaignReadinessRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/pre-production-readiness",
    { schema: campaignReadinessRouteSchema },
    async (
      request: FastifyRequest<{ Params: { campaignId: string } }>,
      reply: FastifyReply
    ): Promise<void> => {
      const { campaignId } = request.params;
      const useCase = container.useCases.resolveCampaignPreProductionReadiness;

      if (!useCase) {
        return reply.status(500).send({
          code: "CONFIGURATION_ERROR",
          message: "ResolveCampaignPreProductionReadinessUseCase is not configured."
        });
      }

      try {
        const readModel = await useCase.execute(campaignId);
        return reply.status(200).send(readModel);
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "name" in err &&
          err.name === "CampaignNotFoundError"
        ) {
          return reply.status(404).send({
            code: "NOT_FOUND",
            message: (err as Error).message
          });
        }
        throw err;
      }
    }
  );
};
