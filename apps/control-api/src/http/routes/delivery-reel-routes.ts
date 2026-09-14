import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ControlApiContainer } from "../types.js";

export interface DeliveryReelRoutesOptions {
  readonly container: ControlApiContainer;
}

export const deliveryReelParamsSchema = {
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

export const deliveryReelRouteSchema = {
  params: deliveryReelParamsSchema
} as const;

export const deliveryReelRoutes: FastifyPluginAsync<DeliveryReelRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: DeliveryReelRoutesOptions
): Promise<void> => {
  const { container } = opts;

  const getDeliveryReelHandler = async (
    request: FastifyRequest<{ Params: { campaignId: string } }>,
    reply: FastifyReply
  ): Promise<void> => {
    const { campaignId } = request.params;
    const useCase = container.useCases.resolveCampaignDeliveryReel;

    if (!useCase) {
      return reply.status(500).send({
        code: "CONFIGURATION_ERROR",
        message: "ResolveCampaignDeliveryReelUseCase is not configured."
      });
    }

    const readModel = await useCase.execute(campaignId);
    return reply.status(200).send(readModel);
  };

  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/delivery-reel",
    { schema: deliveryReelRouteSchema },
    getDeliveryReelHandler
  );

  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/delivery",
    { schema: deliveryReelRouteSchema },
    getDeliveryReelHandler
  );
};
