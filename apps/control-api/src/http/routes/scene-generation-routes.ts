import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  CreateShotPlanVariationRequestSchema,
  CreateShotPlanVariationResponseSchema,
  GenerationAdmissionResponseSchema
} from "@cco/contracts";
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

export const createShotPlanVariationRouteSchema = {
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
  },
  body: {
    type: "object",
    required: ["sourceShotPlanId", "expectedSpecRevision", "directorGuidance", "idempotencyKey"],
    properties: {
      sourceShotPlanId: {
        type: "string",
        format: "uuid"
      },
      expectedSpecRevision: {
        type: "integer",
        minimum: 1
      },
      directorGuidance: {
        type: "string",
        minLength: 1
      },
      variantCount: {
        type: "integer",
        minimum: 1,
        maximum: 3
      },
      idempotencyKey: {
        type: "string",
        minLength: 1
      },
      externalProcessingPolicy: {
        type: "object"
      },
      overallTimeoutMs: {
        type: "integer",
        minimum: 1
      },
      enqueuePrevisJobs: {
        type: "boolean"
      }
    },
    additionalProperties: false
  }
} as const;

export const planShotPlansRouteSchema = {
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
  },
  body: {
    type: "object",
    properties: {
      variantCount: {
        type: "integer",
        minimum: 1,
        maximum: 5
      },
      externalProcessingPolicy: {
        type: "object"
      },
      overallTimeoutMs: {
        type: "integer",
        minimum: 1
      },
      enqueuePrevisJobs: {
        type: "boolean"
      },
      reroll: {
        type: "boolean"
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

  const handlePlanShotPlans = async (
    request: FastifyRequest<{
      Params: { sceneId: string };
      Body?: {
        variantCount?: number;
        externalProcessingPolicy?: Record<string, unknown>;
        overallTimeoutMs?: number;
        enqueuePrevisJobs?: boolean;
        reroll?: boolean;
      };
    }>,
    reply: FastifyReply
  ) => {
    if (!container.useCases.planShotPlans) {
      return reply.status(503).send({
        code: "CONFIGURATION_ERROR",
        message: "Shot plan planning is not available; planning model clients are not configured."
      });
    }

    const result = await container.useCases.planShotPlans.execute({
      sceneId: request.params.sceneId,
      variantCount: request.body?.variantCount,
      externalProcessingPolicy: request.body?.externalProcessingPolicy,
      overallTimeoutMs: request.body?.overallTimeoutMs,
      enqueuePrevisJobs: request.body?.enqueuePrevisJobs,
      reroll: request.body?.reroll
    });

    return reply.status(200).send({
      sceneId: request.params.sceneId,
      shotPlans: result.shotPlans.map((p) => p.snapshot()),
      isIdempotentReplay: result.isIdempotentReplay
    });
  };

  fastify.post<{
    Params: { sceneId: string };
    Body?: {
      variantCount?: number;
      externalProcessingPolicy?: Record<string, unknown>;
      overallTimeoutMs?: number;
      enqueuePrevisJobs?: boolean;
      reroll?: boolean;
    };
  }>("/api/scenes/:sceneId/shot-plans", { schema: planShotPlansRouteSchema }, handlePlanShotPlans);

  fastify.post<{
    Params: { sceneId: string };
    Body?: {
      variantCount?: number;
      externalProcessingPolicy?: Record<string, unknown>;
      overallTimeoutMs?: number;
      enqueuePrevisJobs?: boolean;
      reroll?: boolean;
    };
  }>(
    "/api/scenes/:sceneId/plan-shot-plans",
    { schema: planShotPlansRouteSchema },
    handlePlanShotPlans
  );

  fastify.post<{
    Params: { sceneId: string };
    Body: {
      sourceShotPlanId: string;
      expectedSpecRevision: number;
      directorGuidance: string;
      variantCount?: number;
      idempotencyKey: string;
      externalProcessingPolicy?: Record<string, unknown>;
      overallTimeoutMs?: number;
      enqueuePrevisJobs?: boolean;
    };
  }>(
    "/api/scenes/:sceneId/shot-plans/variations",
    { schema: createShotPlanVariationRouteSchema },
    async (
      request: FastifyRequest<{
        Params: { sceneId: string };
        Body: {
          sourceShotPlanId: string;
          expectedSpecRevision: number;
          directorGuidance: string;
          variantCount?: number;
          idempotencyKey: string;
          externalProcessingPolicy?: Record<string, unknown>;
          overallTimeoutMs?: number;
          enqueuePrevisJobs?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      if (!container.useCases.createShotPlanVariation) {
        return reply.status(503).send({
          code: "CONFIGURATION_ERROR",
          message:
            "Shot plan variation is not available; planning model clients are not configured."
        });
      }

      const parsedBody = CreateShotPlanVariationRequestSchema.parse(request.body);

      const result = await container.useCases.createShotPlanVariation.execute({
        sceneId: request.params.sceneId,
        ...parsedBody
      });

      const response = CreateShotPlanVariationResponseSchema.parse({
        sceneId: result.sceneId,
        sourceShotPlanId: result.sourceShotPlanId,
        shotPlans: result.shotPlans.map((p) => p.snapshot()),
        isIdempotentReplay: result.isIdempotentReplay
      });

      return reply.status(200).send(response);
    }
  );
};
