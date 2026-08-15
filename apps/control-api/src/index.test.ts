import { describe, it, expect } from "vitest";
import { controlApiName } from "./index.js";

describe("control-api skeleton", () => {
  it("should load", () => {
    expect(controlApiName).toBe("control-api");
  });
});
