import { describe, it, expect } from "vitest";
import { renderWorkerName } from "./index.js";

describe("render-worker skeleton", () => {
  it("should load", () => {
    expect(renderWorkerName).toBe("render-worker");
  });
});
