import { describe, expect, it } from "vitest";
import {
  MIN_TARGET_DURATION_MS as CONTRACT_MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS as CONTRACT_MAX_TARGET_DURATION_MS,
  MIN_SCENE_COUNT as CONTRACT_MIN_SCENE_COUNT,
  MAX_SCENE_COUNT as CONTRACT_MAX_SCENE_COUNT,
  MIN_SCENE_DURATION_MS as CONTRACT_MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS as CONTRACT_MAX_SCENE_DURATION_MS
} from "@cco/contracts";
import {
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  TARGET_SECONDS_PER_SCENE,
  MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS,
  resolveSceneCount
} from "./scene-count-policy.js";
import { InvalidTargetDurationError } from "./invalid-target-duration-error.js";
import { InvalidSceneCountError } from "./invalid-scene-count-error.js";
import { InvalidSceneCountCombinationError } from "./invalid-scene-count-combination-error.js";

describe("scene-count-policy", () => {
  it("matches constants defined in @cco/contracts", () => {
    expect(MIN_TARGET_DURATION_MS).toBe(CONTRACT_MIN_TARGET_DURATION_MS);
    expect(MAX_TARGET_DURATION_MS).toBe(CONTRACT_MAX_TARGET_DURATION_MS);
    expect(MIN_SCENE_COUNT).toBe(CONTRACT_MIN_SCENE_COUNT);
    expect(MAX_SCENE_COUNT).toBe(CONTRACT_MAX_SCENE_COUNT);
    expect(MIN_SCENE_DURATION_MS).toBe(CONTRACT_MIN_SCENE_DURATION_MS);
    expect(MAX_SCENE_DURATION_MS).toBe(CONTRACT_MAX_SCENE_DURATION_MS);
    expect(TARGET_SECONDS_PER_SCENE).toBe(5);
  });

  describe("duration validation", () => {
    it("rejects duration below MIN_TARGET_DURATION_MS (5_000)", () => {
      expect(() => resolveSceneCount({ targetTotalDurationMs: 4_999 })).toThrow(
        InvalidTargetDurationError
      );
      expect(() => resolveSceneCount({ targetTotalDurationMs: 0 })).toThrow(
        InvalidTargetDurationError
      );
      expect(() => resolveSceneCount({ targetTotalDurationMs: -5_000 })).toThrow(
        InvalidTargetDurationError
      );
    });

    it("rejects duration above MAX_TARGET_DURATION_MS (300_000)", () => {
      expect(() => resolveSceneCount({ targetTotalDurationMs: 300_001 })).toThrow(
        InvalidTargetDurationError
      );
    });

    it("rejects non-integer duration", () => {
      expect(() => resolveSceneCount({ targetTotalDurationMs: 15_000.5 })).toThrow(
        InvalidTargetDurationError
      );
    });

    it("validates duration even when valid sceneCountOverride is provided", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 4_000, sceneCountOverride: 2 })
      ).toThrow(InvalidTargetDurationError);

      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 350_000, sceneCountOverride: 30 })
      ).toThrow(InvalidTargetDurationError);
    });
  });

  describe("sceneCountOverride validation", () => {
    it("rejects override below MIN_SCENE_COUNT (1)", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 15_000, sceneCountOverride: 0 })
      ).toThrow(InvalidSceneCountError);
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 15_000, sceneCountOverride: -2 })
      ).toThrow(InvalidSceneCountError);
    });

    it("rejects override above MAX_SCENE_COUNT (60)", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 150_000, sceneCountOverride: 61 })
      ).toThrow(InvalidSceneCountError);
    });

    it("rejects non-integer override", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 15_000, sceneCountOverride: 3.5 })
      ).toThrow(InvalidSceneCountError);
    });
  });

  describe("no-override derivation", () => {
    it("derives N = 1 for 5_000ms", () => {
      expect(resolveSceneCount({ targetTotalDurationMs: 5_000 })).toBe(1);
    });

    it("rounds down below half: 7_499ms -> round(1.4998) -> 1", () => {
      expect(resolveSceneCount({ targetTotalDurationMs: 7_499 })).toBe(1);
    });

    it("breaks ties with round-half-up: 7_500ms -> round(1.5) -> 2", () => {
      expect(resolveSceneCount({ targetTotalDurationMs: 7_500 })).toBe(2);
    });

    it("breaks ties with round-half-up: 12_500ms -> round(2.5) -> 3", () => {
      expect(resolveSceneCount({ targetTotalDurationMs: 12_500 })).toBe(3);
    });

    it("derives N = 3 for 15_000ms", () => {
      expect(resolveSceneCount({ targetTotalDurationMs: 15_000 })).toBe(3);
    });

    it("derives N = 60 for 300_000ms", () => {
      expect(resolveSceneCount({ targetTotalDurationMs: 300_000 })).toBe(60);
    });
  });

  describe("override precedence", () => {
    it("takes valid override over derived value", () => {
      // 15_000ms would derive 3, but override specifies 2
      expect(resolveSceneCount({ targetTotalDurationMs: 15_000, sceneCountOverride: 2 })).toBe(2);

      // 15_000ms override 5
      expect(resolveSceneCount({ targetTotalDurationMs: 15_000, sceneCountOverride: 5 })).toBe(5);
    });
  });

  describe("combination validation (AC-4)", () => {
    it("rejects reviewer witness scenario: 5_000ms with sceneCountOverride: 60 (implied 83ms/scene)", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 5_000, sceneCountOverride: 60 })
      ).toThrow(InvalidSceneCountCombinationError);

      try {
        resolveSceneCount({ targetTotalDurationMs: 5_000, sceneCountOverride: 60 });
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidSceneCountCombinationError);
        const comboErr = err as InvalidSceneCountCombinationError;
        expect(comboErr.targetTotalDurationMs).toBe(5_000);
        expect(comboErr.sceneCountOverride).toBe(60);
        expect(comboErr.resolvedSceneCount).toBe(60);
      }
    });

    it("rejects symmetric extreme: 300_000ms with sceneCountOverride: 1 (implied 300s/scene)", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 300_000, sceneCountOverride: 1 })
      ).toThrow(InvalidSceneCountCombinationError);
    });

    it("rejects combination below MIN_SCENE_DURATION_MS (5_000ms / 6 scenes = 833ms)", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 5_000, sceneCountOverride: 6 })
      ).toThrow(InvalidSceneCountCombinationError);
    });

    it("rejects combination above MAX_SCENE_DURATION_MS (16_000ms / 1 scene = 16_000ms)", () => {
      expect(() =>
        resolveSceneCount({ targetTotalDurationMs: 16_000, sceneCountOverride: 1 })
      ).toThrow(InvalidSceneCountCombinationError);
    });

    it("accepts valid combinations at exact per-scene duration boundaries", () => {
      // 5_000ms / 5 scenes = 1_000ms (MIN_SCENE_DURATION_MS)
      expect(resolveSceneCount({ targetTotalDurationMs: 5_000, sceneCountOverride: 5 })).toBe(5);

      // 15_000ms / 1 scene = 15_000ms (MAX_SCENE_DURATION_MS)
      expect(resolveSceneCount({ targetTotalDurationMs: 15_000, sceneCountOverride: 1 })).toBe(1);

      // 60_000ms / 60 scenes = 1_000ms (MIN_SCENE_DURATION_MS)
      expect(resolveSceneCount({ targetTotalDurationMs: 60_000, sceneCountOverride: 60 })).toBe(60);

      // 300_000ms / 20 scenes = 15_000ms (MAX_SCENE_DURATION_MS)
      expect(resolveSceneCount({ targetTotalDurationMs: 300_000, sceneCountOverride: 20 })).toBe(
        20
      );
    });

    it("verifies no-override derivation self-consistency across entire duration range [5_000, 300_000]", () => {
      // Sweep every 500ms
      for (let ms = MIN_TARGET_DURATION_MS; ms <= MAX_TARGET_DURATION_MS; ms += 500) {
        const n = resolveSceneCount({ targetTotalDurationMs: ms });
        expect(n).toBeGreaterThanOrEqual(MIN_SCENE_COUNT);
        expect(n).toBeLessThanOrEqual(MAX_SCENE_COUNT);
        const perScene = ms / n;
        expect(perScene).toBeGreaterThanOrEqual(MIN_SCENE_DURATION_MS);
        expect(perScene).toBeLessThanOrEqual(MAX_SCENE_DURATION_MS);
      }
    });
  });
});
