import { describe, it, expect } from "vitest";
import { applicationName } from "./index.js";

describe("application skeleton", () => {
  it("should load", () => {
    expect(applicationName).toBe("application");
  });
});
