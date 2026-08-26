import { describe, expect, it } from "vitest";
import { IdempotencyConflictError, StaleRevisionConflictError } from "@cco/application";
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

  it("passes through unhandled generic errors as 500", () => {
    const genericErr = formatReviewError(new Error("Unexpected DB crash"));
    expect(genericErr.statusCode).toBe(500);
    expect(genericErr.body).toEqual({ message: "Internal Server Error" });
  });
});
