import { describe, expect, it } from "vitest";
import { IdempotencyConflictError } from "@cco/application";
import { formatReviewError } from "./errors.js";

describe("formatReviewError", () => {
  it("maps IdempotencyConflictError to 409 IDEMPOTENCY_CONFLICT", () => {
    const error = new IdempotencyConflictError("01950c46-9e90-7d3d-82d2-8f1d3e000001");
    const result = formatReviewError(error);
    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      message: error.message
    });
  });

  it("passes through unhandled generic errors as 500", () => {
    const genericErr = formatReviewError(new Error("Unexpected DB crash"));
    expect(genericErr.statusCode).toBe(500);
    expect(genericErr.body).toEqual({ message: "Internal Server Error" });
  });
});
