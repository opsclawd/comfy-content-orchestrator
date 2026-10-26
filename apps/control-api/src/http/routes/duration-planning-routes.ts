import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ControlApiContainer, ReviewerIdentityResolver } from "../types.js";
import type { ClientContextResolver } from "@cco/application";
import {
  ReplanCampaignPreviewRequestSchema,
  ReplanCampaignPreviewResponseSchema,
  ReplanCampaignCommitRequestSchema,
  ReplanCampaignCommitResponseSchema,
  BeginOperatorAcceptanceRunRequestSchema,
  BeginOperatorAcceptanceRunResponseSchema,
  AcceptAcceptanceSceneRequestSchema,
  AssembleOperatorAcceptanceRunRequestSchema,
  AssembleOperatorAcceptanceRunResponseSchema,
  AcceptanceRunReelReadModelSchema
} from "@cco/contracts";

export interface DurationPlanningRoutesOptions {
  readonly container: ControlApiContainer;
  readonly reviewerIdentityResolver?: ReviewerIdentityResolver | undefined;
  readonly clientContextResolver?: ClientContextResolver<FastifyRequest> | undefined;
}

export const campaignIdParamsSchema = {
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

export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: DurationPlanningRoutesOptions
): Promise<void> => {
  const { container } = opts;
  const reviewerIdentityResolver = opts.reviewerIdentityResolver;
  const getReviewerIdentity = async (request: FastifyRequest): Promise<string> => {
    if (!reviewerIdentityResolver) {
      return "operator";
    }
    return await reviewerIdentityResolver.resolve(request);
  };

  const checkReviewerAuthorization = async (reviewerName: string): Promise<boolean> => {
    return Boolean(
      reviewerName &&
      reviewerName.trim().length > 0 &&
      reviewerName.trim().toLowerCase() !== "anonymous"
    );
  };

  // 1. Get current campaign duration plan
  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/duration-plan",
    { schema: { params: campaignIdParamsSchema } },
    async (request, reply) => {
      const { campaignId } = request.params;
      const plan = await container.dependencies.uow.execute(async (ctx) => {
        if (!ctx.durationPlans) return undefined;
        return ctx.durationPlans.findCurrentPlanByCampaignId(campaignId);
      });

      if (!plan) {
        return reply.status(404).send({
          code: "PLAN_NOT_FOUND",
          message: `No duration plan found for campaign '${campaignId}'.`
        });
      }

      return reply.status(200).send(plan);
    }
  );

  // 2. Get bindings for campaign duration plan
  fastify.get<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/duration-plan/bindings",
    { schema: { params: campaignIdParamsSchema } },
    async (request, reply) => {
      const { campaignId } = request.params;
      const bindings = await container.dependencies.uow.execute(async (ctx) => {
        if (!ctx.durationPlans) return [];
        const plan = await ctx.durationPlans.findCurrentPlanByCampaignId(campaignId);
        if (!plan) return [];
        return ctx.durationPlans.findBindingsByPlanId(plan.planId);
      });

      return reply.status(200).send({ campaignId, bindings });
    }
  );

  // 3. Replan preview
  fastify.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/replan/preview",
    { schema: { params: campaignIdParamsSchema } },
    async (request, reply) => {
      if (!container.useCases.previewCampaignReplan) {
        throw new Error("PreviewCampaignReplanUseCase is not configured on container.");
      }

      const reviewerName = await getReviewerIdentity(request);
      const authorized = await checkReviewerAuthorization(reviewerName);
      if (!authorized) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Reviewer '${reviewerName}' is not authorized to preview campaign replans`
        });
      }

      const body = ReplanCampaignPreviewRequestSchema.parse({
        ...(request.body as Record<string, unknown>),
        campaignId: request.params.campaignId,
        principal: reviewerName
      });

      const result = await container.useCases.previewCampaignReplan.execute(body);
      const response = ReplanCampaignPreviewResponseSchema.parse(result);
      if (!response.feasible) {
        return reply.status(422).send(response);
      }
      return reply.status(200).send(response);
    }
  );

  // 4. Replan commit
  fastify.post<{ Params: { campaignId: string } }>(
    "/api/campaigns/:campaignId/replan/commit",
    { schema: { params: campaignIdParamsSchema } },
    async (request, reply) => {
      if (!container.useCases.commitCampaignReplan) {
        throw new Error("CommitCampaignReplanUseCase is not configured on container.");
      }

      const reviewerName = await getReviewerIdentity(request);
      const authorized = await checkReviewerAuthorization(reviewerName);
      if (!authorized) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Reviewer '${reviewerName}' is not authorized to commit campaign replans`
        });
      }

      const body = ReplanCampaignCommitRequestSchema.parse({
        ...(request.body as Record<string, unknown>),
        campaignId: request.params.campaignId,
        principal: reviewerName
      });

      const result = await container.useCases.commitCampaignReplan.execute(body);
      const response = ReplanCampaignCommitResponseSchema.parse(result);
      return reply.status(200).send(response);
    }
  );

  // 5. Begin operator acceptance run
  fastify.post("/api/operator-acceptance/runs", async (request, reply) => {
    if (!container.useCases.beginOperatorAcceptanceRun) {
      throw new Error("BeginOperatorAcceptanceRunUseCase is not configured on container.");
    }

    const reviewerName = await getReviewerIdentity(request);
    const authorized = await checkReviewerAuthorization(reviewerName);
    if (!authorized) {
      return reply.status(403).send({
        code: "FORBIDDEN",
        message: `Reviewer '${reviewerName}' is not authorized to begin operator acceptance runs`
      });
    }

    const body = BeginOperatorAcceptanceRunRequestSchema.parse(request.body);
    if (body.requestedBy && body.requestedBy !== reviewerName) {
      return reply.status(403).send({
        code: "FORBIDDEN",
        message: `Client requestedBy '${body.requestedBy}' does not match authenticated identity '${reviewerName}'`
      });
    }

    const result = await container.useCases.beginOperatorAcceptanceRun.execute({
      ...body,
      requestedBy: reviewerName
    });
    const response = BeginOperatorAcceptanceRunResponseSchema.parse(result);
    return reply.status(201).send(response);
  });

  // 6. Get operator acceptance run
  fastify.get<{ Params: { acceptanceRunId: string } }>(
    "/api/operator-acceptance/runs/:acceptanceRunId",
    async (request, reply) => {
      const { acceptanceRunId } = request.params;
      const reviewerName = await getReviewerIdentity(request);
      const authorized = await checkReviewerAuthorization(reviewerName);
      if (!authorized) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Reviewer '${reviewerName}' is not authorized to view operator acceptance runs`
        });
      }

      const data = await container.dependencies.uow.execute(async (ctx) => {
        if (!ctx.operatorAcceptanceRuns) return undefined;
        const run = await ctx.operatorAcceptanceRuns.findRunById(acceptanceRunId);
        if (!run) return undefined;
        const scenes = await ctx.operatorAcceptanceRuns.findRunScenes(acceptanceRunId);
        return { run, scenes };
      });

      if (!data) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: `Operator acceptance run '${acceptanceRunId}' was not found.`
        });
      }

      return reply.status(200).send(data);
    }
  );

  // 7. Accept operator acceptance scene
  fastify.post<{ Params: { acceptanceRunId: string; sceneId: string } }>(
    "/api/operator-acceptance/runs/:acceptanceRunId/scenes/:sceneId/accept",
    async (request, reply) => {
      if (!container.useCases.acceptOperatorAcceptanceScene) {
        throw new Error("AcceptOperatorAcceptanceSceneUseCase is not configured on container.");
      }

      const reviewerName = await getReviewerIdentity(request);
      const authorized = await checkReviewerAuthorization(reviewerName);
      if (!authorized) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Reviewer '${reviewerName}' is not authorized to accept operator acceptance scenes`
        });
      }

      const body = AcceptAcceptanceSceneRequestSchema.parse(request.body);
      if (body.acceptedBy && body.acceptedBy !== reviewerName) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Client acceptedBy '${body.acceptedBy}' does not match authenticated identity '${reviewerName}'`
        });
      }

      const result = await container.useCases.acceptOperatorAcceptanceScene.execute({
        acceptanceRunId: request.params.acceptanceRunId,
        sceneId: request.params.sceneId,
        actionId: body.actionId,
        expectedAttemptOrdinal: body.expectedAttemptOrdinal,
        acceptedBy: reviewerName
      });

      return reply.status(200).send(result);
    }
  );

  // 8. Assemble operator acceptance run
  fastify.post<{ Params: { acceptanceRunId: string } }>(
    "/api/operator-acceptance/runs/:acceptanceRunId/assemble",
    async (request, reply) => {
      if (!container.useCases.assembleOperatorAcceptanceRun) {
        throw new Error("AssembleOperatorAcceptanceRunUseCase is not configured on container.");
      }

      const reviewerName = await getReviewerIdentity(request);
      const authorized = await checkReviewerAuthorization(reviewerName);
      if (!authorized) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Reviewer '${reviewerName}' is not authorized to assemble operator acceptance runs`
        });
      }

      const body = AssembleOperatorAcceptanceRunRequestSchema.parse(request.body);
      if (body.requestedBy && body.requestedBy !== reviewerName) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Client requestedBy '${body.requestedBy}' does not match authenticated identity '${reviewerName}'`
        });
      }

      const result = await container.useCases.assembleOperatorAcceptanceRun.execute({
        ...body,
        acceptanceRunId: request.params.acceptanceRunId,
        requestedBy: reviewerName
      });

      const response = AssembleOperatorAcceptanceRunResponseSchema.parse(result);
      return reply.status(200).send(response);
    }
  );

  // 9. Resolve operator acceptance run reel
  fastify.get<{ Params: { acceptanceRunId: string } }>(
    "/api/operator-acceptance/runs/:acceptanceRunId/reel",
    async (request, reply) => {
      if (!container.useCases.resolveOperatorAcceptanceReel) {
        throw new Error("ResolveOperatorAcceptanceReelUseCase is not configured on container.");
      }

      const reviewerName = await getReviewerIdentity(request);
      const authorized = await checkReviewerAuthorization(reviewerName);
      if (!authorized) {
        return reply.status(403).send({
          code: "FORBIDDEN",
          message: `Reviewer '${reviewerName}' is not authorized to resolve operator acceptance run reel`
        });
      }

      let clientId: string | undefined;
      const clientResolver = opts.clientContextResolver;
      if (clientResolver) {
        try {
          const resolved = await clientResolver.resolve(request);
          if (resolved) {
            clientId = resolved;
          }
        } catch {
          // No client context
        }
      }

      const result = await container.useCases.resolveOperatorAcceptanceReel.execute({
        acceptanceRunId: request.params.acceptanceRunId,
        reviewerName,
        clientId
      });

      const response = AcceptanceRunReelReadModelSchema.parse(result);
      return reply.status(200).send(response);
    }
  );
};
