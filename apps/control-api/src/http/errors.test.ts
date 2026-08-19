import { describe, expect, it } from "vitest";
import { formatReviewError } from "./errors.js";

describe("formatReviewError", () => {
  it("formatReviewError maps Postgres 23505 to 409 IDEMPOTENCY_CONFLICT", () => {
    const pgUniqueError = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      {
        code: "23505"
      }
    );
    const result = formatReviewError(pgUniqueError);
    expect(result.statusCode).toBe(409);
    expect(result.body).toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      message: "Unique constraint violation"
    });

    const plainPgError = { code: "23505" };
    const plainResult = formatReviewError(plainPgError);
    expect(plainResult.statusCode).toBe(409);
    expect(plainResult.body).toEqual({
      code: "IDEMPOTENCY_CONFLICT",
      message: "Unique constraint violation"
    });
  });

  it("passes through unhandled generic errors as 500", () => {
    const genericErr = formatReviewError(new Error("Unexpected DB crash"));
    expect(genericErr.statusCode).toBe(500);
    expect(genericErr.body).toEqual({ message: "Internal Server Error" });
  });
});
