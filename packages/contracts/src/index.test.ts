import { describe, it, expect } from "vitest";
import { contractsName } from "./index.js";

describe("contracts skeleton", () => {
  it("should load", () => {
    expect(contractsName).toBe("contracts");
  });
});
