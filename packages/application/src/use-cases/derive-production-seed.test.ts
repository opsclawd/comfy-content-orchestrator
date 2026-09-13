import { describe, expect, it } from "vitest";
import { deriveProductionSeed } from "./derive-production-seed.js";

describe("deriveProductionSeed", () => {
  it("returns identical seed for identical sceneId, specRevision, and attemptOrdinal", () => {
    const seed1 = deriveProductionSeed("scene-123", 1, 1);
    const seed2 = deriveProductionSeed("scene-123", 1, 1);
    expect(seed1).toBe(seed2);
  });

  it("returns different seeds for different revisions of same scene", () => {
    const seedRev1 = deriveProductionSeed("scene-123", 1, 1);
    const seedRev2 = deriveProductionSeed("scene-123", 2, 1);
    expect(seedRev1).not.toBe(seedRev2);
  });

  it("returns different seeds for different scenes with same revision", () => {
    const seedSceneA = deriveProductionSeed("scene-123", 1, 1);
    const seedSceneB = deriveProductionSeed("scene-456", 1, 1);
    expect(seedSceneA).not.toBe(seedSceneB);
  });

  it("returns different seeds for different attempt ordinals with same scene and revision", () => {
    const seedAttempt1 = deriveProductionSeed("scene-123", 1, 1);
    const seedAttempt2 = deriveProductionSeed("scene-123", 1, 2);
    expect(seedAttempt1).not.toBe(seedAttempt2);
  });

  it("always produces a non-negative JS safe integer", () => {
    for (let revision = 1; revision <= 20; revision++) {
      const seed = deriveProductionSeed(`scene-test-${revision}`, revision, 1);
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });
});
