import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { ControlApiAppOptions, ControlApiContainer } from "../types.js";

export interface ProductionInspectionRoutesOptions {
  readonly container: ControlApiContainer;
  readonly appOptions?: ControlApiAppOptions | undefined;
}

export const productionInspectionParamsSchema = {
  type: "object",
  required: ["sceneId"],
  properties: {
    sceneId: {
      type: "string",
      format: "uuid"
    }
  },
  additionalProperties: false
} as const;

export const productionInspectionQuerystringSchema = {
  type: "object",
  properties: {
    shotPlanId: {
      type: "string",
      format: "uuid"
    }
  },
  additionalProperties: false
} as const;

export const productionInspectionRouteSchema = {
  params: productionInspectionParamsSchema,
  querystring: productionInspectionQuerystringSchema
} as const;

export const productionInspectionRoutes: FastifyPluginAsync<
  ProductionInspectionRoutesOptions
> = async (fastify: FastifyInstance, opts: ProductionInspectionRoutesOptions): Promise<void> => {
  const { container } = opts;

  fastify.get<{
    Params: { sceneId: string };
    Querystring: { shotPlanId?: string };
  }>(
    "/api/scenes/:sceneId/production-inspection",
    { schema: productionInspectionRouteSchema },
    async (request, reply) => {
      const { sceneId } = request.params;
      const { shotPlanId } = request.query;

      const result = await container.useCases.prepareSceneProductionInputs.execute({
        sceneId,
        ...(shotPlanId !== undefined ? { shotPlanId } : {}),
        dryRun: true
      });

      return reply.status(200).send(result.inspection);
    }
  );
};
