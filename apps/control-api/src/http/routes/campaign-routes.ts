import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import {
  CampaignResponseSchema,
  CreateCampaignRequestSchema,
  CreateSceneRequestSchema,
  SceneCreateResponseSchema,
  isCreateSceneBriefRequest
} from "@cco/contracts";
import type { ReferenceAssetId } from "@cco/domain";
import type { ControlApiContainer } from "../types.js";

export interface CampaignRoutesOptions {
  readonly container: ControlApiContainer;
}

export const campaignSceneRouteSchema = {
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

export const campaignRoutes: FastifyPluginAsync<CampaignRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: CampaignRoutesOptions
): Promise<void> => {
  const { container } = opts;

  fastify.post("/api/campaigns", async (request, reply) => {
    if (!container.useCases.createCampaign) {
      throw new Error("CreateCampaignUseCase is not configured on container.");
    }
    const body = CreateCampaignRequestSchema.parse(request.body);

    const campaign = await container.useCases.createCampaign.execute({
      clientId: body.clientId,
      title: body.title,
      targetPlatform: body.targetPlatform,
      totalScenes: body.totalScenes
    });

    const response = CampaignResponseSchema.parse({
      campaignId: campaign.id,
      clientId: campaign.clientId,
      title: campaign.title,
      targetPlatform: campaign.targetPlatform,
      status: campaign.status,
      totalScenes: campaign.totalScenes,
      approvedScenes: campaign.approvedScenes,
      createdAt: campaign.createdAt
    });

    return reply.status(201).send(response);
  });

  fastify.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/scenes",
    { schema: campaignSceneRouteSchema },
    async (request, reply) => {
      if (!container.useCases.submitSceneCreation) {
        throw new Error("SubmitSceneCreationUseCase is not configured on container.");
      }
      const body = CreateSceneRequestSchema.parse(request.body);

      const sceneInput = isCreateSceneBriefRequest(body)
        ? {
            campaignId: request.params.campaignId,
            kind: "brief" as const,
            brief: body.brief,
            ...(body.candidateReferenceAssetIds !== undefined
              ? {
                  candidateReferenceAssetIds:
                    body.candidateReferenceAssetIds as unknown as readonly ReferenceAssetId[]
                }
              : {}),
            ...(body.maxDurationMs !== undefined ? { maxDurationMs: body.maxDurationMs } : {})
          }
        : {
            campaignId: request.params.campaignId,
            kind: "manual" as const,
            configuration: {
              prompt: body.configuration.prompt,
              referenceIds: body.configuration.referenceIds,
              engineProfileId: body.configuration.engineProfileId,
              durationMs: body.configuration.durationMs,
              ...(body.configuration.loraConfigurationId !== undefined
                ? { loraConfigurationId: body.configuration.loraConfigurationId }
                : {})
            }
          };

      const scene = await container.useCases.submitSceneCreation.execute(sceneInput);

      const snapshot = scene.snapshot();
      const response = SceneCreateResponseSchema.parse({
        sceneId: snapshot.id,
        campaignId: snapshot.campaignId,
        status: snapshot.status,
        specRevision: snapshot.specRevision,
        configuration: snapshot.configuration
      });

      return reply.status(201).send(response);
    }
  );
};
