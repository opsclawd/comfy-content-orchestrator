import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import { AssemblySpecSchema } from "@cco/contracts";
import type { DeliveryAssemblyJobMutationResult } from "@cco/application";
import type { ControlApiContainer } from "../types.js";

export interface DeliveryAssemblyRoutesOptions {
  readonly container: ControlApiContainer;
  readonly dispatchConfig: {
    readonly leaseDurationMs: number;
    readonly heartbeatIntervalMs: number;
  };
}

export const enqueueDeliveryAssemblyJobSchema = {
  body: {
    type: "object",
    required: ["campaignId", "assemblySpec"],
    properties: {
      campaignId: {
        type: "string",
        format: "uuid"
      },
      assemblySpec: {
        type: "object"
      },
      maxRetries: {
        type: "integer",
        minimum: 0
      }
    },
    additionalProperties: false
  }
} as const;

export const claimDeliveryAssemblyJobSchema = {
  body: {
    type: "object",
    required: ["workerId"],
    properties: {
      workerId: {
        type: "string",
        minLength: 1,
        pattern: "\\S"
      }
    },
    additionalProperties: false
  }
} as const;

export const startDeliveryAssemblyJobSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  },
  body: {
    type: "object",
    required: ["leaseToken"],
    properties: {
      leaseToken: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const heartbeatDeliveryAssemblyJobSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  },
  body: {
    type: "object",
    required: ["leaseToken"],
    properties: {
      leaseToken: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const completeDeliveryAssemblyJobSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  },
  body: {
    type: "object",
    required: ["leaseToken"],
    properties: {
      leaseToken: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

export const failDeliveryAssemblyJobSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  },
  body: {
    type: "object",
    required: ["leaseToken", "errorTrace"],
    properties: {
      leaseToken: {
        type: "string",
        format: "uuid"
      },
      errorTrace: {
        type: "string",
        minLength: 1,
        pattern: "\\S"
      }
    },
    additionalProperties: false
  }
} as const;

export const deferDeliveryAssemblyJobSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  },
  body: {
    type: "object",
    required: ["leaseToken", "reason"],
    properties: {
      leaseToken: {
        type: "string",
        format: "uuid"
      },
      reason: {
        type: "string",
        minLength: 1,
        pattern: "\\S"
      }
    },
    additionalProperties: false
  }
} as const;

export const getDeliveryAssemblyJobSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: {
        type: "string",
        format: "uuid"
      }
    },
    additionalProperties: false
  }
} as const;

function translateMutationResult(
  result: DeliveryAssemblyJobMutationResult,
  reply: FastifyReply
): FastifyReply {
  switch (result.outcome) {
    case "deferred":
    case "applied":
    case "already_applied":
      return reply.status(200).send(result);
    case "superseded":
      return reply.status(409).send({
        code: "LEASE_SUPERSEDED",
        message: "The job lease has been superseded."
      });
    case "not_found":
      return reply.status(404).send({
        code: "NOT_FOUND",
        message: "Job not found."
      });
    default: {
      const _exhaustive: never = result;
      throw new Error(`Unhandled mutation outcome: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export const deliveryAssemblyRoutes: FastifyPluginAsync<DeliveryAssemblyRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: DeliveryAssemblyRoutesOptions
): Promise<void> => {
  const { container, dispatchConfig } = opts;
  const queue = container.dependencies.deliveryAssemblyJobQueue;
  if (!queue) {
    throw new Error("DeliveryAssemblyJobQueuePort is required for delivery assembly routes");
  }

  fastify.post<{
    Body: {
      campaignId: string;
      assemblySpec: unknown;
      maxRetries?: number;
    };
  }>(
    "/api/delivery-assembly-jobs",
    { schema: enqueueDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const parseResult = AssemblySpecSchema.safeParse(request.body.assemblySpec);
      if (!parseResult.success) {
        return reply.status(400).send({
          code: "VALIDATION_FAILURE",
          message: `Invalid AssemblySpec: ${parseResult.error.message}`
        });
      }

      if (request.body.campaignId !== parseResult.data.campaignId) {
        return reply.status(400).send({
          code: "VALIDATION_FAILURE",
          message: `Mismatched campaignId: body.campaignId (${request.body.campaignId}) does not match assemblySpec.campaignId (${parseResult.data.campaignId})`
        });
      }

      const job = await queue.enqueue({
        campaignId: request.body.campaignId,
        assemblySpec: parseResult.data,
        ...(request.body.maxRetries !== undefined ? { maxRetries: request.body.maxRetries } : {})
      });

      return reply.status(201).send(job);
    }
  );

  fastify.post<{
    Body: {
      workerId: string;
    };
  }>(
    "/api/delivery-assembly-jobs/claim",
    { schema: claimDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const job = await queue.claim({
        workerId: request.body.workerId,
        leaseDurationMs: dispatchConfig.leaseDurationMs
      });

      if (!job) {
        return reply.status(204).send();
      }

      return reply.status(200).send(job);
    }
  );

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>(
    "/api/delivery-assembly-jobs/:jobId/start",
    { schema: startDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const result = await queue.start(request.params.jobId, request.body.leaseToken);
      return translateMutationResult(result, reply);
    }
  );

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>(
    "/api/delivery-assembly-jobs/:jobId/heartbeat",
    { schema: heartbeatDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const result = await queue.heartbeat(
        request.params.jobId,
        request.body.leaseToken,
        dispatchConfig.leaseDurationMs
      );
      return translateMutationResult(result, reply);
    }
  );

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>(
    "/api/delivery-assembly-jobs/:jobId/complete",
    { schema: completeDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const result = await queue.complete(request.params.jobId, request.body.leaseToken);
      return translateMutationResult(result, reply);
    }
  );

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string; errorTrace: string };
  }>(
    "/api/delivery-assembly-jobs/:jobId/fail",
    { schema: failDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const result = await queue.fail(
        request.params.jobId,
        request.body.leaseToken,
        request.body.errorTrace
      );
      return translateMutationResult(result, reply);
    }
  );

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string; reason: string };
  }>(
    "/api/delivery-assembly-jobs/:jobId/defer",
    { schema: deferDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const result = await queue.defer(
        request.params.jobId,
        request.body.leaseToken,
        request.body.reason
      );
      return translateMutationResult(result, reply);
    }
  );

  fastify.get<{
    Params: { jobId: string };
  }>(
    "/api/delivery-assembly-jobs/:jobId",
    { schema: getDeliveryAssemblyJobSchema },
    async (request, reply) => {
      const job = await queue.getJob(request.params.jobId);
      if (!job) {
        return reply.status(404).send({
          code: "NOT_FOUND",
          message: "Delivery assembly job not found."
        });
      }
      return reply.status(200).send(job);
    }
  );
};
