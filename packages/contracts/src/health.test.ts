import { describe, expect, it } from "vitest";
import { HealthResponseSchema } from "./health.js";

describe("HealthResponseSchema", () => {
  it("parses valid health response", () => {
    const valid = {
      status: "ok",
      timestamp: "2026-08-20T00:00:00.000Z"
    };
    const parsed = HealthResponseSchema.parse(valid);
    expect(parsed.status).toBe("ok");
    expect(parsed.timestamp).toBe(valid.timestamp);
  });

  it("rejects invalid status", () => {
    const invalid = {
      status: "error",
      timestamp: "2026-08-20T00:00:00.000Z"
    };
    expect(() => HealthResponseSchema.parse(invalid)).toThrow();
  });

  it("rejects non-datetime timestamp format", () => {
    const invalid = {
      status: "ok",
      timestamp: "invalid-date"
    };
    expect(() => HealthResponseSchema.parse(invalid)).toThrow();
  });
});
