import { describe, it, expect } from "vitest";
import { domainName } from "./index.js";

describe("domain skeleton", () => {
  it("should load", () => {
    expect(domainName).toBe("domain");
  });
});
