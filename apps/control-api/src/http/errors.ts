import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  CandidateNotFoundError,
  IdempotencyConflictError,
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

export function formatReviewError(error: unknown): {
  statusCode: number;
  body: ReviewErrorResponse | { message: string };
} {
  if (error instanceof SceneNotFoundError || error instanceof CandidateNotFoundError) {
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
        message: error.message
      }
    };
  }

  if (error instanceof IdempotencyConflictError) {
    return {
      statusCode: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: error.message
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
