import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { projectErrorForLogging } from "@cco/shared";
import { ZodError } from "zod";
import {
  CampaignBeatSheetValidationError,
  CampaignIdempotencyConflictError,
  CampaignNotFoundError,
  CandidateNotFoundError,
  ClientNotFoundError,
  IdempotencyConflictError,
  ImageValidationError,
  InvalidSceneCountCombinationError,
  InvalidSceneCountError,
  InvalidSceneOrdinalSequenceError,
  InvalidTargetDurationError,
  JobDispatchUnavailableError,
  PlanningNotAuthorizedError,
  PlanningProviderExhaustedError,
  PlanningProviderNotConfiguredError,
  PlanningSafetyRefusalError,
  ReferenceCanonicalizationError,
  SceneConfigurationCountMismatchError,
  SceneConfigurationValidationError,
  SceneCreationModeMismatchError,
  SceneNotFoundError,
  SceneNotInProductionRunError,
  ShotPlanNotFoundError,
  ShotPlanValidationError,
  InvalidShotPlanVariantCountError,
  CrossSceneSourceShotPlanError,
  InvalidSceneStateForVariationError,
  ShotPlanVariationIdempotencyConflictError,
  SourceShotPlanNotFoundError,
  StaleSourceShotPlanRevisionError,
  SupersededSourceShotPlanError,
  StaleProductionAttemptConflictError,
  StaleRevisionConflictError,
  StoryboardMaterializationConflictError,
  StoryboardPartiallyMaterializedError,
  TransactionalJobEnqueuerUnavailableError,
  UnsupportedProductionDurationError,
  ProductionInputFingerprintMismatchError,
  CampaignReplanRequiredError
} from "@cco/application";
import type { ProductEvidenceHttpErrorResponse, ReviewErrorResponse } from "@cco/contracts";
import {
  mapZodErrorToValidationIssues,
  CampaignDurationPlanningError,
  OperatorAcceptanceRunNotFoundError,
  OperatorAcceptanceSceneNotFoundError,
  OperatorAcceptanceOrdinalMismatchError,
  OperatorAcceptanceInvalidStatusError,
  OperatorAcceptanceSceneNotAcceptedError,
  OperatorAcceptanceIdempotencyConflictError
} from "@cco/contracts";
import {
  AlreadyAcceptedProductionAttemptError,
  ArchivedReferenceBindingError,
  ContradictoryReferencePayloadError,
  CrossClientReferenceBindingError,
  InvalidCandidateError,
  InvalidMutationError,
  InvalidShotPlanError,
  InvalidTransitionError,
  ReferenceAssetNotFoundError,
  TerminalStateError,
  ProductEvidenceDomainError,
  ProductValidationError,
  NotFoundError,
  AccessDeniedError,
  DuplicateSkuError,
  DuplicateLotError,
  StaleRevisionConflictError as DomainStaleRevisionConflictError,
  NonMonotonicRevisionError,
  IdempotencyConflictError as DomainIdempotencyConflictError,
  ConcurrencyConflictError,
  SourceIntegrityMismatchError,
  MimeConflictError,
  SourceSupersededError,
  QuotaExceededError,
  ReportDisputedError,
  ClaimSupportRequiredError,
  CrossBatchSourceError,
  CrossClientViolationError
} from "@cco/domain";

export class ReviewerIdentityUnavailableError extends Error {
  constructor(message = "Reviewer identity could not be established.") {
    super(message);
    this.name = "ReviewerIdentityUnavailableError";
  }
}

export class ClientAuthenticationRequiredError extends Error {
  constructor(message = "Client authentication required.") {
    super(message);
    this.name = "ClientAuthenticationRequiredError";
  }
}

export class ClientForbiddenError extends Error {
  constructor(message = "Access to requested client resource is forbidden.") {
    super(message);
    this.name = "ClientForbiddenError";
  }
}

export function formatReviewError(error: unknown): {
  statusCode: number;
  body:
    | ReviewErrorResponse
    | { message: string }
    | { code: string; message: string; details?: Record<string, unknown> };
} {
  if (
    error instanceof JobDispatchUnavailableError ||
    error instanceof PlanningProviderNotConfiguredError ||
    error instanceof TransactionalJobEnqueuerUnavailableError
  ) {
    return {
      statusCode: 500,
      body: {
        code: "CONFIGURATION_ERROR",
        message: error.message
      }
    };
  }

  if (error instanceof PlanningNotAuthorizedError) {
    return {
      statusCode: 403,
      body: {
        code: "CLOUD_PLANNING_NOT_AUTHORIZED",
        message: error.message
      }
    };
  }

  if (error instanceof PlanningSafetyRefusalError) {
    return {
      statusCode: 422,
      body: {
        code: "PLANNING_SAFETY_REFUSAL",
        message: error.message,
        details: {
          provider: error.provider
        }
      }
    };
  }

  if (error instanceof PlanningProviderExhaustedError) {
    return {
      statusCode: 502,
      body: {
        code: "PLANNING_PROVIDER_EXHAUSTED",
        message: error.message,
        details: {
          attempts: error.attempts as unknown as Record<string, unknown>
        }
      }
    };
  }

  if (error instanceof SceneCreationModeMismatchError) {
    return {
      statusCode: 400,
      body: {
        code: "SCENE_CREATION_MODE_MISMATCH",
        message: error.message
      }
    };
  }

  if (
    error instanceof SceneConfigurationValidationError ||
    error instanceof ShotPlanValidationError ||
    error instanceof InvalidShotPlanVariantCountError ||
    error instanceof CampaignBeatSheetValidationError ||
    error instanceof InvalidSceneCountCombinationError ||
    error instanceof InvalidSceneCountError ||
    error instanceof InvalidTargetDurationError ||
    error instanceof ImageValidationError ||
    error instanceof ContradictoryReferencePayloadError ||
    error instanceof ReferenceCanonicalizationError ||
    error instanceof CrossSceneSourceShotPlanError
  ) {
    return {
      statusCode: 400,
      body: {
        code: "VALIDATION_FAILURE",
        message: error.message
      }
    };
  }

  if (error instanceof UnsupportedProductionDurationError) {
    return {
      statusCode: 400,
      body: {
        code: "UNSUPPORTED_PRODUCTION_DURATION",
        message: error.message,
        details: {
          durationMs: error.durationMs,
          reason: error.reason
        }
      }
    };
  }

  if (
    error instanceof SceneConfigurationCountMismatchError ||
    error instanceof InvalidSceneOrdinalSequenceError
  ) {
    return {
      statusCode: 500,
      body: {
        code: "INTERNAL_INVARIANT_VIOLATION",
        message: error.message
      }
    };
  }

  if (
    error instanceof ReviewerIdentityUnavailableError ||
    error instanceof ClientAuthenticationRequiredError
  ) {
    return {
      statusCode: 401,
      body: {
        code: "AUTHENTICATION_REQUIRED",
        message: error.message
      }
    };
  }

  if (error instanceof ClientForbiddenError || error instanceof CrossClientReferenceBindingError) {
    return {
      statusCode: 403,
      body: {
        code: "FORBIDDEN",
        message: error.message
      }
    };
  }

  if (
    error instanceof SceneNotFoundError ||
    error instanceof CandidateNotFoundError ||
    error instanceof ShotPlanNotFoundError ||
    error instanceof CampaignNotFoundError ||
    error instanceof ClientNotFoundError ||
    error instanceof ReferenceAssetNotFoundError ||
    error instanceof SourceShotPlanNotFoundError
  ) {
    return {
      statusCode: 404,
      body: {
        code: "NOT_FOUND",
        message: error.message
      }
    };
  }

  if (error instanceof StaleSourceShotPlanRevisionError) {
    return {
      statusCode: 409,
      body: {
        code: "STALE_REVISION_CONFLICT",
        message: error.message,
        details: {
          sourceShotPlanId: error.sourceShotPlanId,
          sourceRevision: error.sourceRevision,
          currentSceneRevision: error.currentRevision
        }
      }
    };
  }

  if (error instanceof SupersededSourceShotPlanError) {
    return {
      statusCode: 409,
      body: {
        code: "SUPERSEDED_SOURCE_SHOT_PLAN",
        message: error.message,
        details: {
          sourceShotPlanId: error.sourceShotPlanId,
          status: error.status
        }
      }
    };
  }

  if (error instanceof InvalidSceneStateForVariationError) {
    return {
      statusCode: 409,
      body: {
        code: "INVALID_SCENE_STATE",
        message: error.message,
        details: {
          sceneId: error.sceneId,
          currentStatus: error.status
        }
      }
    };
  }

  if (error instanceof StaleRevisionConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "STALE_REVISION_CONFLICT",
        message: error.message,
        details: {
          expectedRevision: error.expectedRevision,
          currentRevision: error.actualRevision
        }
      }
    };
  }

  if (error instanceof ProductionInputFingerprintMismatchError) {
    return {
      statusCode: 409,
      body: {
        code: "PRODUCTION_INPUT_FINGERPRINT_MISMATCH",
        message: error.message,
        details: {
          sceneId: error.sceneId,
          expectedFingerprint: error.expectedFingerprint,
          actualFingerprint: error.actualFingerprint
        }
      }
    };
  }

  if (error instanceof StaleProductionAttemptConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "STALE_PRODUCTION_ATTEMPT_CONFLICT",
        message: error.message,
        details: {
          sceneId: error.sceneId,
          expectedProductionJobId: error.expectedProductionJobId,
          ...(error.actualProductionJobId !== undefined
            ? { actualProductionJobId: error.actualProductionJobId }
            : {})
        }
      }
    };
  }

  if (error instanceof SceneNotInProductionRunError) {
    return {
      statusCode: 422,
      body: {
        code: "SCENE_NOT_IN_PRODUCTION_RUN",
        message: error.message,
        details: {
          sceneId: error.sceneId
        }
      }
    };
  }

  if (error instanceof IdempotencyConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: error.message,
        details: {
          actionId: error.eventId
        }
      }
    };
  }

  if (error instanceof CampaignIdempotencyConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: error.message,
        details: {
          idempotencyKey: error.idempotencyKey
        }
      }
    };
  }

  if (error instanceof ShotPlanVariationIdempotencyConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: error.message,
        details: {
          idempotencyKey: error.idempotencyKey
        }
      }
    };
  }

  if (error instanceof StoryboardPartiallyMaterializedError) {
    return {
      statusCode: 409,
      body: {
        code: "STORYBOARD_PARTIALLY_MATERIALIZED",
        message: error.message,
        details: {
          campaignId: error.campaignId,
          expectedCount: error.expectedCount,
          actualCount: error.actualCount
        }
      }
    };
  }

  if (
    error instanceof CampaignDurationPlanningError ||
    (error instanceof Error && error.name === "CampaignDurationPlanningError") ||
    (typeof error === "object" &&
      error !== null &&
      (error as { name?: string }).name === "CampaignDurationPlanningError")
  ) {
    const err = error as CampaignDurationPlanningError;
    const statusCode =
      typeof err.statusCode === "number"
        ? err.statusCode
        : typeof err.httpStatusCode === "number"
          ? err.httpStatusCode
          : 422;
    const reason = typeof err.reason === "string" ? err.reason : "unknown_planning_error";
    return {
      statusCode,
      body: {
        code: reason.toUpperCase(),
        message: err.message,
        details: {
          reason,
          ...(err.details !== undefined ? { details: err.details } : {})
        }
      }
    };
  }

  if (error instanceof CampaignReplanRequiredError) {
    return {
      statusCode: 409,
      body: {
        code: "CAMPAIGN_REPLAN_REQUIRED",
        message: error.message,
        ...(error.sceneId !== undefined ? { sceneId: error.sceneId } : {})
      }
    };
  }

  if (
    error instanceof OperatorAcceptanceRunNotFoundError ||
    error instanceof OperatorAcceptanceSceneNotFoundError
  ) {
    return {
      statusCode: 404,
      body: {
        code: "NOT_FOUND",
        message: error.message
      }
    };
  }

  if (error instanceof OperatorAcceptanceOrdinalMismatchError) {
    return {
      statusCode: 409,
      body: {
        code: "ORDINAL_MISMATCH",
        message: error.message
      }
    };
  }

  if (
    error instanceof OperatorAcceptanceIdempotencyConflictError ||
    (error instanceof Error && error.name === "OperatorAcceptanceIdempotencyConflictError") ||
    (error as { code?: string })?.code === "IDEMPOTENCY_CONFLICT"
  ) {
    return {
      statusCode: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: (error as Error).message
      }
    };
  }

  if (
    error instanceof OperatorAcceptanceInvalidStatusError ||
    error instanceof OperatorAcceptanceSceneNotAcceptedError
  ) {
    return {
      statusCode: 422,
      body: {
        code: "INVALID_DOMAIN_TRANSITION",
        message: error.message
      }
    };
  }

  if (error instanceof StoryboardMaterializationConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "STORYBOARD_MATERIALIZATION_CONFLICT",
        message: error.message,
        details: {
          campaignId: error.campaignId,
          reason: error.reason
        }
      }
    };
  }

  if (
    error instanceof InvalidTransitionError ||
    error instanceof InvalidMutationError ||
    error instanceof InvalidCandidateError ||
    error instanceof InvalidShotPlanError ||
    error instanceof TerminalStateError ||
    error instanceof AlreadyAcceptedProductionAttemptError ||
    error instanceof ArchivedReferenceBindingError
  ) {
    return {
      statusCode: 422,
      body: {
        code: "INVALID_DOMAIN_TRANSITION",
        message: error.message
      }
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        code: "VALIDATION_FAILURE",
        message:
          "Validation failed: " +
          error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        details: error.issues
      }
    };
  }

  const fastifyErr = error as Partial<FastifyError>;
  if (
    fastifyErr.code === "FST_ERR_CTP_BODY_TOO_LARGE" ||
    fastifyErr.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ||
    fastifyErr.code === "FST_ERR_CTP_EMPTY_TYPE" ||
    fastifyErr.code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH" ||
    fastifyErr.statusCode === 413 ||
    fastifyErr.statusCode === 415 ||
    fastifyErr.validation !== undefined ||
    fastifyErr.statusCode === 400
  ) {
    return {
      statusCode: 400,
      body: {
        code: "VALIDATION_FAILURE",
        message: fastifyErr.message ?? "Validation failed",
        ...(fastifyErr.validation ? { details: fastifyErr.validation } : {})
      }
    };
  }

  if (fastifyErr.statusCode === 404) {
    return {
      statusCode: 404,
      body: {
        code: "NOT_FOUND",
        message: fastifyErr.message ?? "Resource not found"
      }
    };
  }

  const statusCode =
    typeof fastifyErr.statusCode === "number"
      ? fastifyErr.statusCode
      : typeof (error as { httpStatusCode?: unknown })?.httpStatusCode === "number"
        ? (error as { httpStatusCode: number }).httpStatusCode
        : 500;
  const errMessage =
    statusCode >= 500
      ? "Internal Server Error"
      : error instanceof Error
        ? error.message
        : "Internal Server Error";
  return {
    statusCode,
    body: {
      message: errMessage
    }
  };
}

export function handleReviewError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const { statusCode, body } = formatReviewError(error);
  if (statusCode >= 500) {
    const projection = projectErrorForLogging(error);
    request.log.error(
      {
        errorType: projection.errorType,
        safeMessage: projection.safeMessage,
        ...(projection.safeStack !== undefined ? { safeStack: projection.safeStack } : {}),
        ...(projection.cause !== undefined ? { cause: projection.cause } : {})
      },
      "control-api request failed with 5xx"
    );
  }
  reply.status(statusCode).send(body);
}

export function formatProductEvidenceError(error: unknown): {
  statusCode: number;
  body: ProductEvidenceHttpErrorResponse;
} {
  if (error instanceof ProductValidationError) {
    return {
      statusCode: 400,
      body: {
        error: "VALIDATION_ERROR",
        issues: error.issues.map((i) => ({
          code: i.code,
          path: [...i.path],
          message: i.message
        }))
      }
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: "VALIDATION_ERROR",
        issues: mapZodErrorToValidationIssues(error).map((i) => ({
          code: i.code,
          path: [...i.path],
          message: i.message
        }))
      }
    };
  }

  if (
    error instanceof ReviewerIdentityUnavailableError ||
    error instanceof ClientAuthenticationRequiredError
  ) {
    return {
      statusCode: 401,
      body: {
        error: "AUTHENTICATION_REQUIRED",
        message: error.message
      }
    };
  }

  if (error instanceof ClientForbiddenError) {
    return {
      statusCode: 403,
      body: {
        error: "FORBIDDEN",
        message: "Access denied."
      }
    };
  }

  if (error instanceof AccessDeniedError) {
    const reason = (error.details as Record<string, unknown> | undefined)?.reason;
    if (reason === "SELF_APPROVAL_FORBIDDEN" || /self-approval forbidden/i.test(error.message)) {
      return {
        statusCode: 403,
        body: {
          error: "SELF_APPROVAL_FORBIDDEN",
          message: "The actor is not authorized to approve their own submission."
        }
      };
    }
    if (
      reason === "COA_REPORT_ARCHIVED" ||
      /archived coa report|coa report is already archived/i.test(error.message)
    ) {
      return {
        statusCode: 403,
        body: {
          error: "COA_REPORT_ARCHIVED",
          message: "The CoA report is archived."
        }
      };
    }
    if (reason === "EVIDENCE_ARCHIVED" || /archived evidence asset/i.test(error.message)) {
      return {
        statusCode: 403,
        body: {
          error: "EVIDENCE_ARCHIVED",
          message: "The evidence asset is archived."
        }
      };
    }
    return {
      statusCode: 403,
      body: {
        error: "ACCESS_DENIED",
        message: "The requested operation is not authorized."
      }
    };
  }

  if (error instanceof NotFoundError) {
    const isInternalBlob =
      error.message.includes("SourceObjectBlob") ||
      error.message.includes("SourceObject") ||
      error.message.includes("Blob") ||
      error.message.includes("storage") ||
      error.message.includes("Storage") ||
      error.message.includes("clients/") ||
      error.message.includes("originals/") ||
      error.message.includes("/");
    return {
      statusCode: 404,
      body: {
        error: "NOT_FOUND",
        message: isInternalBlob
          ? "The requested evidence storage object was not found."
          : error.message
      }
    };
  }

  if (error instanceof DuplicateSkuError) {
    return {
      statusCode: 409,
      body: {
        error: "DUPLICATE_SKU",
        message: "A product SKU with this canonical identifier already exists."
      }
    };
  }

  if (error instanceof DuplicateLotError) {
    return {
      statusCode: 409,
      body: {
        error: "DUPLICATE_LOT",
        message: "A batch with this lot identifier already exists for the SKU."
      }
    };
  }

  if (error instanceof DomainStaleRevisionConflictError) {
    return {
      statusCode: 409,
      body: {
        error: "STALE_REVISION_CONFLICT",
        message: "Stale revision conflict detected."
      }
    };
  }

  if (error instanceof NonMonotonicRevisionError) {
    return {
      statusCode: 409,
      body: {
        error: "NON_MONOTONIC_REVISION",
        message: "Non-monotonic revision progression detected."
      }
    };
  }

  if (error instanceof DomainIdempotencyConflictError) {
    return {
      statusCode: 409,
      body: {
        error: "IDEMPOTENCY_CONFLICT",
        message: "Idempotent mutation conflict detected."
      }
    };
  }

  if (error instanceof ConcurrencyConflictError) {
    return {
      statusCode: 409,
      body: {
        error: "CONCURRENCY_CONFLICT",
        message: "Concurrent mutation conflict detected."
      }
    };
  }

  if (error instanceof SourceSupersededError) {
    return {
      statusCode: 409,
      body: {
        error: "SOURCE_SUPERSEDED",
        message: "Target source has already been superseded."
      }
    };
  }

  if (error instanceof CrossBatchSourceError) {
    return {
      statusCode: 409,
      body: {
        error: "CROSS_BATCH_SOURCE",
        message: "Source asset does not belong to the target batch."
      }
    };
  }

  if (error instanceof ReportDisputedError) {
    return {
      statusCode: 409,
      body: {
        error: "REPORT_DISPUTED",
        message: "The referenced report is disputed."
      }
    };
  }

  if (error instanceof MimeConflictError) {
    return {
      statusCode: 415,
      body: {
        error: "MIME_CONFLICT",
        message: "The declared MIME type does not match the inspected content."
      }
    };
  }

  if (error instanceof CrossClientViolationError) {
    return {
      statusCode: 403,
      body: {
        error: "CROSS_CLIENT_VIOLATION",
        message: "Access denied."
      }
    };
  }

  if (error instanceof SourceIntegrityMismatchError) {
    return {
      statusCode: 409,
      body: {
        error: "SOURCE_INTEGRITY_MISMATCH",
        message: "Source object integrity verification failed."
      }
    };
  }

  if (error instanceof ClaimSupportRequiredError) {
    return {
      statusCode: 422,
      body: {
        error: "CLAIM_SUPPORT_REQUIRED",
        message: "Claim requires valid evidence support."
      }
    };
  }

  if (error instanceof QuotaExceededError) {
    return {
      statusCode: 429,
      body: {
        error: "QUOTA_EXCEEDED",
        message: "Evidence storage quota exceeded."
      }
    };
  }

  if (error instanceof ProductEvidenceDomainError) {
    return {
      statusCode: 400,
      body: {
        error: error.code,
        message: "Validation or domain precondition failed."
      }
    };
  }

  const fastifyErr = error as Partial<FastifyError>;
  if (
    fastifyErr.code === "FST_ERR_CTP_BODY_TOO_LARGE" ||
    fastifyErr.code === "FST_FILES_LIMIT" ||
    fastifyErr.code === "FST_ERR_MULTIPART_FILE_TOO_LARGE" ||
    fastifyErr.statusCode === 413
  ) {
    return {
      statusCode: 413,
      body: {
        error: "PAYLOAD_TOO_LARGE",
        message: "Payload exceeds allowed size limit."
      }
    };
  }

  if (fastifyErr.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || fastifyErr.statusCode === 415) {
    return {
      statusCode: 415,
      body: {
        error: "UNSUPPORTED_MEDIA_TYPE",
        message: "Unsupported media type."
      }
    };
  }

  if (fastifyErr.statusCode === 404) {
    return {
      statusCode: 404,
      body: {
        error: "NOT_FOUND",
        message: "Resource not found."
      }
    };
  }

  if (fastifyErr.validation !== undefined || fastifyErr.statusCode === 400) {
    return {
      statusCode: 400,
      body: {
        error: "VALIDATION_ERROR",
        issues: [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: [],
            message: "Request validation failed."
          }
        ]
      }
    };
  }

  const statusCode =
    typeof fastifyErr.statusCode === "number" &&
    fastifyErr.statusCode >= 400 &&
    fastifyErr.statusCode < 600
      ? fastifyErr.statusCode
      : 500;

  return {
    statusCode,
    body: {
      error: "INTERNAL_ERROR",
      message: "Internal Server Error"
    }
  };
}

export function handleProductEvidenceError(
  error: FastifyError | Error | unknown,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const { statusCode, body } = formatProductEvidenceError(error);
  if (statusCode >= 500) {
    const params = (request.params as Record<string, string> | undefined) ?? {};
    request.log.error(
      {
        error: "INTERNAL_ERROR",
        route: request.routeOptions?.url ?? request.url,
        method: request.method,
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(params.batchId ? { batchId: params.batchId } : {})
      },
      "product-evidence request failed with 5xx"
    );
  }
  reply.status(statusCode).send(body);
}
