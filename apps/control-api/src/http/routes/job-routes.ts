import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import type { JobId, LeaseToken } from "@cco/domain";
import {
  InvalidJobCompletionPayloadError,
  StorageAdmissionError,
  StorageAdmissionUnavailableError,
  type JobMutationResult
} from "@cco/application";
import type { ControlApiContainer } from "../types.js";

export interface JobRoutesOptions {
  readonly container: ControlApiContainer;
  readonly dispatchConfig: {
    readonly leaseDurationMs: number;
    readonly heartbeatIntervalMs: number;
  };
}

export const claimJobSchema = {
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

export const startJobSchema = {
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

export const heartbeatJobSchema = {
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

export const completeJobSchema = {
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
      },
      manifestPayload: {
        type: "object"
      },
      candidatePayload: {
        type: "object"
      }
    },
    additionalProperties: false
  }
} as const;

export const failJobSchema = {
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

export const deferJobSchema = {
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

function translateMutationResult(result: JobMutationResult, reply: FastifyReply): FastifyReply {
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

export const jobRoutes: FastifyPluginAsync<JobRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: JobRoutesOptions
): Promise<void> => {
  const { container, dispatchConfig } = opts;
  const queue = container.dependencies.jobQueue;
  if (!queue) {
    throw new Error("JobQueuePort is required for job routes");
  }
  const enforceStorageAdmission = container.useCases.enforceStorageAdmission;
  if (!enforceStorageAdmission) {
    throw new Error("EnforceStorageAdmission use case is required for job routes");
  }

  fastify.post<{ Body: { workerId: string } }>(
    "/api/jobs/claim",
    { schema: claimJobSchema },
    async (request, reply) => {
      try {
        const job = await queue.claim({
          workerId: request.body.workerId,
          leaseDurationMs: dispatchConfig.leaseDurationMs
        });

        if (!job) {
          return reply.status(204).send();
        }

        return reply.status(200).send(job);
      } catch (error) {
        if (error instanceof StorageAdmissionUnavailableError) {
          return reply.status(503).send({
            code: "STORAGE_TELEMETRY_UNAVAILABLE",
            message: "Storage telemetry is unavailable."
          });
        }
        throw error;
      }
    }
  );

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>("/api/jobs/:jobId/start", { schema: startJobSchema }, async (request, reply) => {
    const result = await queue.start(
      request.params.jobId as JobId,
      request.body.leaseToken as LeaseToken
    );
    return translateMutationResult(result, reply);
  });

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>("/api/jobs/:jobId/heartbeat", { schema: heartbeatJobSchema }, async (request, reply) => {
    const result = await queue.heartbeat(
      request.params.jobId as JobId,
      request.body.leaseToken as LeaseToken,
      dispatchConfig.leaseDurationMs
    );
    return translateMutationResult(result, reply);
  });

  fastify.post<{
    Params: { jobId: string };
    Body: {
      leaseToken: string;
      manifestPayload?: Record<string, unknown>;
      candidatePayload?: Record<string, unknown>;
    };
  }>("/api/jobs/:jobId/complete", { schema: completeJobSchema }, async (request, reply) => {
    try {
      const operation =
        request.body.candidatePayload !== undefined ? "candidate_upload" : "delivery_write";

      try {
        await enforceStorageAdmission.execute(operation);
      } catch (error) {
        if (error instanceof StorageAdmissionError) {
          throw error;
        }
        if (error instanceof StorageAdmissionUnavailableError) {
          throw error;
        }
        throw new StorageAdmissionUnavailableError({ cause: error });
      }

      const result = await queue.complete(
        request.params.jobId as JobId,
        request.body.leaseToken as LeaseToken,
        request.body.manifestPayload
      );
      return translateMutationResult(result, reply);
    } catch (error) {
      if (error instanceof StorageAdmissionUnavailableError) {
        return reply.status(503).send({
          code: "STORAGE_TELEMETRY_UNAVAILABLE",
          message: "Storage telemetry is unavailable."
        });
      }
      if (error instanceof StorageAdmissionError) {
        return reply.status(507).send({
          code: "STORAGE_ADMISSION_DENIED",
          message: error.message,
          operationClass: error.operationClass,
          watermarkState: error.watermarkState,
          usedRatio: error.usedRatio,
          totalBytes: error.totalBytes,
          freeBytes: error.freeBytes
        });
      }
      if (error instanceof InvalidJobCompletionPayloadError) {
        return reply.status(400).send({
          code: "VALIDATION_FAILURE",
          message: error.message
        });
      }
      throw error;
    }
  });

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string; errorTrace: string };
  }>("/api/jobs/:jobId/fail", { schema: failJobSchema }, async (request, reply) => {
    const result = await queue.fail(
      request.params.jobId as JobId,
      request.body.leaseToken as LeaseToken,
      request.body.errorTrace
    );
    return translateMutationResult(result, reply);
  });

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string; reason: string };
  }>("/api/jobs/:jobId/defer", { schema: deferJobSchema }, async (request, reply) => {
    const result = await queue.defer(
      request.params.jobId as JobId,
      request.body.leaseToken as LeaseToken,
      request.body.reason
    );
    return translateMutationResult(result, reply);
  });
};
