import { describe, expect, it } from "vitest";
import { errorMessage, STORAGE_WATERMARK_STATES } from "./index.js";

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error throw rather than losing it", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("STORAGE_WATERMARK_STATES", () => {
  it("defines standard watermark state literals", () => {
    expect(STORAGE_WATERMARK_STATES).toEqual(["normal", "warning", "degraded", "critical"]);
  });
});
