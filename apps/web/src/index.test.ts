import { describe, it, expect } from "vitest";
import { webName } from "./index.js";

describe("web skeleton", () => {
  it("should load", () => {
    expect(webName).toBe("web");
  });
});
