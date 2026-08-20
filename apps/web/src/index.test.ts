import { describe, it, expect } from "vitest";
import { webName, createApiClient, getHealth } from "./index.js";

describe("web package exports", () => {
  it("should export webName and api client helpers", () => {
    expect(webName).toBe("web");
    expect(createApiClient).toBeDefined();
    expect(getHealth).toBeDefined();
  });
});
