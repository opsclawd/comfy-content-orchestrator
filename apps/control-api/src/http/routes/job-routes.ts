import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify";
import {
  EXECUTION_SCOPES,
  JOB_KINDS,
  type ExecutionScope,
  type JobId,
  type JobKind,
  type LeaseToken
} from "@cco/domain";
import {
  InvalidJobCompletionPayloadError,
  StorageAdmissionError,
  StorageAdmissionUnavailableError,
  createDeployedLiveRealmContext,
  type CandidateCompletionPayload,
  type JobMutationResult
} from "@cco/application";
import type { ControlApiContainer } from "../types.js";

export interface JobRoutesOptions {
  readonly container: ControlApiContainer;
  readonly dispatchConfig: {
    readonly leaseDurationMs: number;
    readonly heartbeatIntervalMs: number;
    readonly allowedExecutionScopes?: readonly ExecutionScope[] | undefined;
    readonly resolveWorkerExecutionScopes?:
      ((workerId: string) => readonly ExecutionScope[]) | undefined;
    // Returns the shared secret a worker must present (via the x-worker-staging-token header)
    // to actually be granted any non-"production" scope resolved for its workerId. workerId in
    // the request body is a self-reported label, not an authenticated identity, so any scope
    // elevation beyond the safe "production" default MUST be gated on proof of this secret -
    // otherwise a caller can claim staging-scope work merely by naming a trusted workerId.
    readonly resolveWorkerStagingToken?: ((workerId: string) => string | undefined) | undefined;
  };
}

function timingSafeTokenMatch(expected: string, actual: string | undefined): boolean {
  if (!actual) {
    return false;
  }
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length) {
    // Still run a constant-time comparison against a same-length buffer so this branch's
    // timing doesn't leak the expected length to a network attacker.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
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
      },
      allowedJobKinds: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: JOB_KINDS
        }
      },
      allowedExecutionScopes: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: EXECUTION_SCOPES
        }
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
        type: "object",
        required: ["variantOrdinal", "storageBucket", "storageObjectKey", "contentHashSha256"],
        properties: {
          variantOrdinal: {
            type: "integer",
            minimum: 1
          },
          beatIndex: {
            type: "integer",
            minimum: 1
          },
          storageBucket: {
            type: "string",
            minLength: 1,
            pattern: "\\S"
          },
          storageObjectKey: {
            type: "string",
            minLength: 1,
            pattern: "\\S"
          },
          contentHashSha256: {
            type: "string",
            minLength: 64,
            maxLength: 64,
            pattern: "^[0-9a-fA-F]+$"
          },
          shotPlanId: {
            type: "string",
            format: "uuid"
          },
          specRevision: {
            type: "integer",
            minimum: 1
          },
          generationPayload: {
            type: "object"
          }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false,
    anyOf: [
      { required: ["manifestPayload"], not: { required: ["candidatePayload"] } },
      { required: ["candidatePayload"], not: { required: ["manifestPayload"] } },
      { not: { anyOf: [{ required: ["manifestPayload"] }, { required: ["candidatePayload"] }] } }
    ]
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
  const progressSceneProduction = container.useCases.progressSceneProduction;

  fastify.post<{
    Body: {
      workerId: string;
      allowedJobKinds?: readonly JobKind[];
      allowedExecutionScopes?: readonly ExecutionScope[];
    };
  }>("/api/jobs/claim", { schema: claimJobSchema }, async (request, reply) => {
    try {
      const resolvedScopes =
        dispatchConfig.resolveWorkerExecutionScopes?.(request.body.workerId) ??
        dispatchConfig.allowedExecutionScopes ??
        (["production"] as readonly ExecutionScope[]);

      // workerId is a self-reported request body field, not an authenticated identity. Any
      // scope beyond "production" (e.g. "staging") must be proven with a shared secret before
      // it is actually granted; otherwise claiming to be a trusted workerId is sufficient to
      // impersonate it and pull staging-scoped work.
      const expectedStagingToken = dispatchConfig.resolveWorkerStagingToken?.(
        request.body.workerId
      );
      const presentedStagingToken = request.headers["x-worker-staging-token"];
      const stagingTokenVerified =
        expectedStagingToken !== undefined &&
        timingSafeTokenMatch(
          expectedStagingToken,
          typeof presentedStagingToken === "string" ? presentedStagingToken : undefined
        );
      const serverPermittedScopes = stagingTokenVerified
        ? resolvedScopes
        : resolvedScopes.filter((scope) => scope === "production");

      if (request.body.allowedExecutionScopes) {
        const unauthorizedScopes = request.body.allowedExecutionScopes.filter(
          (scope) => !serverPermittedScopes.includes(scope)
        );
        if (unauthorizedScopes.length > 0) {
          return reply.status(403).send({
            code: "UNAUTHORIZED_EXECUTION_SCOPE",
            message: `Worker "${request.body.workerId}" is not authorized for requested execution scope(s): ${unauthorizedScopes.join(", ")}`
          });
        }
      }

      const effectiveScopes = request.body.allowedExecutionScopes
        ? request.body.allowedExecutionScopes.filter((scope) =>
            serverPermittedScopes.includes(scope)
          )
        : serverPermittedScopes;

      const claimInput = {
        workerId: request.body.workerId,
        leaseDurationMs: dispatchConfig.leaseDurationMs,
        ...(request.body.allowedJobKinds ? { allowedJobKinds: request.body.allowedJobKinds } : {}),
        allowedExecutionScopes: effectiveScopes
      };
      const job = await queue.claim(claimInput);

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
  });

  fastify.post<{
    Params: { jobId: string };
    Body: { leaseToken: string };
  }>("/api/jobs/:jobId/start", { schema: startJobSchema }, async (request, reply) => {
    const result = await queue.start(
      request.params.jobId as JobId,
      request.body.leaseToken as LeaseToken
    );
    if (
      (result.outcome === "applied" || result.outcome === "already_applied") &&
      result.job.jobKind === "production"
    ) {
      await progressSceneProduction.markProductionRenderingStartedIfQueued(
        result.job.sceneId,
        result.job.jobId
      );
      await container.useCases.completeCampaignProductionRun.onProductionJobStarted(
        result.job.jobId
      );
    }
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
      candidatePayload?: Record<string, unknown> & {
        beatIndex?: number;
      };
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

      const manifestPayload = request.body.manifestPayload;
      let finalManifestPayload: Readonly<Record<string, unknown>> | undefined = manifestPayload as
        Readonly<Record<string, unknown>> | undefined;
      if (
        manifestPayload &&
        typeof manifestPayload === "object" &&
        !Array.isArray(manifestPayload)
      ) {
        const payloadObj = manifestPayload as Record<string, unknown>;
        const realmContext =
          container.dependencies.realmAdmissionContext ?? createDeployedLiveRealmContext("default");

        if (payloadObj.realm !== undefined || payloadObj.evidenceOrigin !== undefined) {
          if (!payloadObj.realm || !payloadObj.evidenceOrigin) {
            throw new InvalidJobCompletionPayloadError(
              "manifestPayload must include both realm and evidenceOrigin if execution provenance is specified"
            );
          }
          const realmKind = (payloadObj.realm as { kind?: unknown })?.kind;
          if (realmContext.realm.kind === "deployed") {
            if (realmKind !== "deployed" || payloadObj.evidenceOrigin !== "live_execution") {
              throw new InvalidJobCompletionPayloadError(
                "Deployed execution context rejects non-live or simulated execution provenance"
              );
            }
            if (
              (payloadObj.realm as { deploymentId?: unknown }).deploymentId !==
              realmContext.realm.deploymentId
            ) {
              throw new InvalidJobCompletionPayloadError(
                "Deployment ID mismatch in manifest payload realm"
              );
            }
          } else if (realmContext.realm.kind === "isolated_test") {
            if (realmKind !== "isolated_test" || payloadObj.evidenceOrigin !== "simulated_test") {
              throw new InvalidJobCompletionPayloadError(
                "Isolated test realm rejects non-simulated execution provenance"
              );
            }
            const payloadRealm = payloadObj.realm as {
              testRealmId?: unknown;
              isolationDescriptorDigest?: unknown;
            };
            if (
              payloadRealm.testRealmId !== realmContext.realm.testRealmId ||
              payloadRealm.isolationDescriptorDigest !==
                realmContext.realm.isolationDescriptorDigest
            ) {
              throw new InvalidJobCompletionPayloadError(
                "Isolated test realm payload must match this request's bound testRealmId and isolationDescriptorDigest"
              );
            }
          }
        }

        finalManifestPayload = {
          ...payloadObj,
          realm: payloadObj.realm ?? realmContext.realm,
          evidenceOrigin:
            payloadObj.evidenceOrigin ??
            (realmContext.realm.kind === "isolated_test" ? "simulated_test" : "live_execution")
        };
      }

      const result = await queue.complete(
        request.params.jobId as JobId,
        request.body.leaseToken as LeaseToken,
        finalManifestPayload,
        request.body.candidatePayload as CandidateCompletionPayload | undefined
      );
      if (
        (result.outcome === "applied" || result.outcome === "already_applied") &&
        result.job.jobKind === "candidate"
      ) {
        await progressSceneProduction.submitCandidatesForReviewIfBatchComplete(result.job.sceneId);
      } else if (
        (result.outcome === "applied" || result.outcome === "already_applied") &&
        result.job.jobKind === "production"
      ) {
        await progressSceneProduction.submitProductionForQAIfRendering(
          result.job.sceneId,
          result.job.jobId
        );
        await container.useCases.completeCampaignProductionRun.onProductionJobCompleted(
          result.job.jobId
        );
      }
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
    if (
      (result.outcome === "applied" || result.outcome === "already_applied") &&
      result.job.status === "failed"
    ) {
      if (result.job.jobKind === "candidate") {
        await progressSceneProduction.submitCandidatesForReviewIfBatchComplete(result.job.sceneId);
      } else if (result.job.jobKind === "production") {
        await progressSceneProduction.failProductionIfActive(result.job.sceneId, result.job.jobId);
        await container.useCases.completeCampaignProductionRun.onProductionJobFailed(
          result.job.jobId
        );
      }
    }
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
