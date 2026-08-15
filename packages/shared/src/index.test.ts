import { describe, expect, it } from "vitest";
import { errorMessage } from "./index.js";

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error throw rather than losing it", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
