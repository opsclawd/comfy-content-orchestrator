import { describe, expect, it, vi } from "vitest";
import {
  CampaignBeatSheetValidationError,
  IdempotencyConflictError,
  PlanningNotAuthorizedError,
  PlanningProviderExhaustedError,
  PlanningProviderNotConfiguredError,
  PlanningSafetyRefusalError,
  SceneConfigurationValidationError,
  SceneCreationModeMismatchError,
  SceneNotFoundError,
  StaleRevisionConflictError,
  UnsupportedProductionDurationError
} from "@cco/application";
import {
  ReviewerIdentityUnavailableError,
  formatReviewError,
  handleReviewError
} from "./errors.js";

describe("formatReviewError", () => {
  it("maps ReviewerIdentityUnavailableError to 401 AUTHENTICATION_REQUIRED with non-sensitive message", () => {
    expect(formatReviewError(new ReviewerIdentityUnavailableError())).toEqual({
      statusCode: 401,
      body: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Reviewer identity could not be established."
      }
    });
  });

  it("includes expected and current revisions in stale conflict details", () => {
    const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3e000001";
    expect(formatReviewError(new StaleRevisionConflictError(sceneId, 4, 5))).toEqual({
      statusCode: 409,
      body: {
        code: "STALE_REVISION_CONFLICT",
        message: expect.any(String),
        details: { expectedRevision: 4, currentRevision: 5 }
      }
    });
  });

  it("includes the action ID in idempotency conflict details", () => {
    const actionId = "01950c46-9e90-7d3d-82d2-8f1d3e000002";
    expect(formatReviewError(new IdempotencyConflictError(actionId))).toEqual({
      statusCode: 409,
      body: {
        code: "IDEMPOTENCY_CONFLICT",
        message: expect.any(String),
        details: { actionId }
      }
    });
  });

  it("maps PlanningNotAuthorizedError to 403 CLOUD_PLANNING_NOT_AUTHORIZED", () => {
    expect(
      formatReviewError(new PlanningNotAuthorizedError("Cloud planning not permitted"))
    ).toEqual({
      statusCode: 403,
      body: {
        code: "CLOUD_PLANNING_NOT_AUTHORIZED",
        message: "Cloud planning not permitted"
      }
    });
  });

  it("maps PlanningSafetyRefusalError to 422 PLANNING_SAFETY_REFUSAL with provider details", () => {
    const err = new PlanningSafetyRefusalError("Safety refusal triggered", {
      provider: "Anthropic"
    });
    expect(formatReviewError(err)).toEqual({
      statusCode: 422,
      body: {
        code: "PLANNING_SAFETY_REFUSAL",
        message: "Safety refusal triggered",
        details: { provider: "Anthropic" }
      }
    });
  });

  it("maps PlanningProviderExhaustedError to 502 PLANNING_PROVIDER_EXHAUSTED with attempts details", () => {
    const attempts = [
      { provider: "Anthropic" as const, failureReason: "Timeout" },
      { provider: "OpenAI" as const, failureReason: "Validation failed" }
    ];
    const err = new PlanningProviderExhaustedError("All providers exhausted", attempts);
    expect(formatReviewError(err)).toEqual({
      statusCode: 502,
      body: {
        code: "PLANNING_PROVIDER_EXHAUSTED",
        message: "All providers exhausted",
        details: { attempts }
      }
    });
  });

  it("maps SceneCreationModeMismatchError to 400 SCENE_CREATION_MODE_MISMATCH", () => {
    const err = new SceneCreationModeMismatchError("Submit creative brief instead");
    expect(formatReviewError(err)).toEqual({
      statusCode: 400,
      body: {
        code: "SCENE_CREATION_MODE_MISMATCH",
        message: "Submit creative brief instead"
      }
    });
  });

  it("maps SceneConfigurationValidationError to 400 VALIDATION_FAILURE", () => {
    const err = new SceneConfigurationValidationError(
      "targetDurationMs cannot exceed maxDurationMs"
    );
    expect(formatReviewError(err)).toEqual({
      statusCode: 400,
      body: {
        code: "VALIDATION_FAILURE",
        message: "targetDurationMs cannot exceed maxDurationMs"
      }
    });
  });

  it("maps CampaignBeatSheetValidationError to 400 VALIDATION_FAILURE", () => {
    const err = new CampaignBeatSheetValidationError(
      "targetTotalDurationMs cannot be less than totalScenes"
    );
    expect(formatReviewError(err)).toEqual({
      statusCode: 400,
      body: {
        code: "VALIDATION_FAILURE",
        message: "targetTotalDurationMs cannot be less than totalScenes"
      }
    });
  });

  it("maps PlanningProviderNotConfiguredError to 500 CONFIGURATION_ERROR", () => {
    const err = new PlanningProviderNotConfiguredError("No provider configured");
    expect(formatReviewError(err)).toEqual({
      statusCode: 500,
      body: {
        code: "CONFIGURATION_ERROR",
        message: "No provider configured"
      }
    });
  });

  it("passes through unhandled generic errors as 500", () => {
    const genericErr = formatReviewError(new Error("Unexpected DB crash"));
    expect(genericErr.statusCode).toBe(500);
    expect(genericErr.body).toEqual({ message: "Internal Server Error" });
  });
});

describe("handleReviewError", () => {
  function createMockHttp() {
    const errorSpy = vi.fn();
    const request = {
      log: {
        error: errorSpy
      }
    } as unknown as Parameters<typeof handleReviewError>[1];

    const sendSpy = vi.fn();
    const statusSpy = vi.fn().mockReturnValue({ send: sendSpy });
    const reply = {
      status: statusSpy
    } as unknown as Parameters<typeof handleReviewError>[2];

    return { request, reply, errorSpy, statusSpy, sendSpy };
  }

  it("logs redacted-but-real diagnostic projection for typed domain error (issue reproduction)", () => {
    const { request, reply, errorSpy, statusSpy, sendSpy } = createMockHttp();
    const err = new UnsupportedProductionDurationError(5000, "out_of_range");

    handleReviewError(err, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(sendSpy).toHaveBeenCalledWith({ message: "Internal Server Error" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "UnsupportedProductionDurationError",
        safeMessage: expect.stringContaining(
          "Production duration 5000ms is unsupported: out_of_range"
        )
      }),
      "control-api request failed with 5xx"
    );
  });

  it("logs full unchanged message for unhandled plain infrastructure error without secrets", () => {
    const { request, reply, errorSpy, statusSpy, sendSpy } = createMockHttp();
    const err = new Error("Simulated database failure before transaction commit");

    handleReviewError(err, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(sendSpy).toHaveBeenCalledWith({ message: "Internal Server Error" });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        errorType: "Error",
        safeMessage: "Simulated database failure before transaction commit"
      }),
      "control-api request failed with 5xx"
    );
  });

  it("redacts credentials from untyped infra error containing embedded @ password", () => {
    const { request, reply, errorSpy, statusSpy } = createMockHttp();
    const err = new Error(
      "database connection timeout: could not authenticate to postgresql://ctrlapi:P@ssw0rd1@db-internal:5432/cco"
    );

    handleReviewError(err, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const loggedPayload = errorSpy.mock.calls[0]?.[0];
    expect(loggedPayload.safeMessage).toContain("postgresql://[REDACTED]@db-internal:5432/cco");
    expect(loggedPayload.safeMessage).not.toContain("P@ssw0rd1");
    expect(loggedPayload.safeMessage).not.toContain("ssw0rd1");
    expect(loggedPayload.safeMessage).not.toContain("ctrlapi");
  });

  it("redacts escaped JSON secret values without leaking suffix", () => {
    const { request, reply, errorSpy, statusSpy } = createMockHttp();
    const err = new Error('{"secret_token": "abc\\"def"}');

    handleReviewError(err, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const loggedPayload = errorSpy.mock.calls[0]?.[0];
    expect(loggedPayload.safeMessage).toBe('{"secret_token": "[REDACTED]"}');
    expect(loggedPayload.safeMessage).not.toContain("abc");
    expect(loggedPayload.safeMessage).not.toContain("def");
  });

  it("redacts lowercase auth scheme headers", () => {
    const { request, reply, errorSpy, statusSpy } = createMockHttp();
    const err = new Error("authorization: bearer sk-12345");

    handleReviewError(err, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const loggedPayload = errorSpy.mock.calls[0]?.[0];
    expect(loggedPayload.safeMessage).toBe("authorization: bearer [REDACTED]");
    expect(loggedPayload.safeMessage).not.toContain("sk-12345");
  });

  it("recursively projects and redacts nested cause", () => {
    const { request, reply, errorSpy, statusSpy } = createMockHttp();
    const inner = new Error("database connection failure with password secretpass123");
    const outer = new Error("request processing failed", { cause: inner });

    handleReviewError(outer, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const loggedPayload = errorSpy.mock.calls[0]?.[0];
    expect(loggedPayload.safeMessage).toBe("request processing failed");
    expect(loggedPayload.cause).toBeDefined();
    expect(loggedPayload.cause.safeMessage).toContain("password [REDACTED]");
    expect(loggedPayload.cause.safeMessage).not.toContain("secretpass123");
  });

  it("does not log error when status code is 4xx", () => {
    const { request, reply, errorSpy, statusSpy, sendSpy } = createMockHttp();
    const err = new SceneNotFoundError("scene-123");

    handleReviewError(err, request, reply);

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "NOT_FOUND"
      })
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
