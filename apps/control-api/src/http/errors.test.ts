import { describe, expect, it } from "vitest";
import {
  CampaignBeatSheetValidationError,
  IdempotencyConflictError,
  PlanningNotAuthorizedError,
  PlanningProviderExhaustedError,
  PlanningProviderNotConfiguredError,
  PlanningSafetyRefusalError,
  SceneConfigurationValidationError,
  SceneCreationModeMismatchError,
  StaleRevisionConflictError
} from "@cco/application";
import { ReviewerIdentityUnavailableError, formatReviewError } from "./errors.js";

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
