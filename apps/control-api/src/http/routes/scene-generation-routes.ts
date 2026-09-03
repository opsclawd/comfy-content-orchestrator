import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { GenerationAdmissionResponseSchema } from "@cco/contracts";
import type { ControlApiContainer } from "../types.js";

export interface SceneGenerationRoutesOptions {
  readonly container: ControlApiContainer;
}

export const sceneGenerationRouteSchema = {
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

export const sceneGenerationRoutes: FastifyPluginAsync<SceneGenerationRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: SceneGenerationRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.post<{ Params: { sceneId: string } }>(
    "/api/scenes/:sceneId/generation-admission",
    { schema: sceneGenerationRouteSchema },
    async (request, reply) => {
      const result = await container.useCases.progressSceneProduction.beginCandidateGeneration({
        sceneId: request.params.sceneId
      });

      const response = GenerationAdmissionResponseSchema.parse({
        sceneId: result.scene.id,
        status: result.scene.status,
        specRevision: result.scene.specRevision,
        enqueuedJobIds: result.enqueuedJobs.map((job) => job.jobId)
      });

      return reply.status(200).send(response);
    }
  );
};
