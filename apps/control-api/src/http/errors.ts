import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  CampaignNotFoundError,
  CandidateNotFoundError,
  ClientNotFoundError,
  IdempotencyConflictError,
  JobDispatchUnavailableError,
  PlanningNotAuthorizedError,
  PlanningProviderExhaustedError,
  PlanningProviderNotConfiguredError,
  PlanningSafetyRefusalError,
  SceneCreationModeMismatchError,
  SceneNotFoundError,
  StaleRevisionConflictError
} from "@cco/application";
import type { ReviewErrorResponse } from "@cco/contracts";
import {
  InvalidCandidateError,
  InvalidMutationError,
  InvalidTransitionError,
  TerminalStateError
} from "@cco/domain";

export class ReviewerIdentityUnavailableError extends Error {
  constructor(message = "Reviewer identity could not be established.") {
    super(message);
    this.name = "ReviewerIdentityUnavailableError";
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
    error instanceof PlanningProviderNotConfiguredError
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

  if (error instanceof ReviewerIdentityUnavailableError) {
    return {
      statusCode: 401,
      body: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Reviewer identity could not be established."
      }
    };
  }

  if (
    error instanceof SceneNotFoundError ||
    error instanceof CandidateNotFoundError ||
    error instanceof CampaignNotFoundError ||
    error instanceof ClientNotFoundError
  ) {
    return {
      statusCode: 404,
      body: {
        code: "NOT_FOUND",
        message: error.message
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

  if (
    error instanceof InvalidTransitionError ||
    error instanceof InvalidMutationError ||
    error instanceof InvalidCandidateError ||
    error instanceof TerminalStateError
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
  if (fastifyErr.validation !== undefined || fastifyErr.statusCode === 400) {
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

  const statusCode = typeof fastifyErr.statusCode === "number" ? fastifyErr.statusCode : 500;
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
    request.log.error(error);
  }
  reply.status(statusCode).send(body);
}
