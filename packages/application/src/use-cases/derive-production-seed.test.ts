import { describe, expect, it } from "vitest";
import { deriveProductionSeed } from "./derive-production-seed.js";

describe("deriveProductionSeed", () => {
  it("returns identical seed for identical sceneId and specRevision", () => {
    const seed1 = deriveProductionSeed("scene-123", 1);
    const seed2 = deriveProductionSeed("scene-123", 1);
    expect(seed1).toBe(seed2);
  });

  it("returns different seeds for different revisions of same scene", () => {
    const seedRev1 = deriveProductionSeed("scene-123", 1);
    const seedRev2 = deriveProductionSeed("scene-123", 2);
    expect(seedRev1).not.toBe(seedRev2);
  });

  it("returns different seeds for different scenes with same revision", () => {
    const seedSceneA = deriveProductionSeed("scene-123", 1);
    const seedSceneB = deriveProductionSeed("scene-456", 1);
    expect(seedSceneA).not.toBe(seedSceneB);
  });

  it("always produces a non-negative JS safe integer", () => {
    for (let revision = 1; revision <= 20; revision++) {
      const seed = deriveProductionSeed(`scene-test-${revision}`, revision);
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });
});
