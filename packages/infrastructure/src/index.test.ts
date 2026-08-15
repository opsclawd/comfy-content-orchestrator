import { describe, it, expect } from "vitest";
import { infrastructureName } from "./index.js";

describe("infrastructure skeleton", () => {
  it("should load", () => {
    expect(infrastructureName).toBe("infrastructure");
  });
});
