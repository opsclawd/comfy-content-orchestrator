import { describe, expect, it } from "vitest";
import {
  mapDurationMsToLtxFrameCount,
  mapDurationMsToMiniMaxH3FrameCount,
  UnsupportedProductionDurationError,
  LTX_CANONICAL_DURATION_MS,
  MINIMAX_H3_CANONICAL_DURATION_MS,
  isLtxRenderableDuration,
  isMiniMaxH3RenderableDuration,
  snapToRenderableLtxDurationMs,
  snapToRenderableMiniMaxH3DurationMs,
  isMiniMaxEngineOrProfile,
  mapProductionDuration,
  isRenderableProductionDuration,
  snapToRenderableProductionDurationMs
} from "./map-production-duration.js";
import {
  LTX_FRAME_QUANTIZATION_TOLERANCE_MS,
  MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS
} from "@cco/contracts";

describe("mapDurationMsToLtxFrameCount", () => {
  it("maps 4041.67ms (97 frames at 24fps) to 97 frames successfully", () => {
    const durationMs = (97 / 24) * 1000;
    const result = mapDurationMsToLtxFrameCount(durationMs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frameCount).toBe(97);
      expect(result.achievedDurationMs).toBeCloseTo(4041.67, 1);
      expect(Math.abs(result.achievedDurationMs - durationMs)).toBeCloseTo(0, 5);
    }
  });

  it("resolves exact tie at targetFrames=101 to lower candidate (97 frames)", () => {
    // 101 frames at 24fps is exactly (101 / 24) * 1000 ms = 4208.333333333333 ms
    // Candidate low: 97 frames (dist = 4 frames)
    // Candidate high: 105 frames (dist = 4 frames)
    // On exact tie, rounds DOWN to 97 frames.
    const tieDurationMs = (101 / 24) * 1000;
    const result = mapDurationMsToLtxFrameCount(tieDurationMs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frameCount).toBe(97);
      expect(result.achievedDurationMs).toBeCloseTo(4041.67, 1);
      const deviation = Math.abs(result.achievedDurationMs - tieDurationMs);
      expect(deviation).toBeCloseTo(166.67, 1);
      expect(deviation).toBeLessThanOrEqual(LTX_FRAME_QUANTIZATION_TOLERANCE_MS);
    }
  });

  it("picks candidateLow (97) when targetFrames is just before the tie", () => {
    // targetFrames = 100.9 -> candidateLow (97) has distance 3.9 < 4.1
    const beforeTieDurationMs = (100.9 / 24) * 1000;
    const result = mapDurationMsToLtxFrameCount(beforeTieDurationMs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frameCount).toBe(97);
    }
  });

  it("fails with 'out_of_range' for duration mapping past tie to 105 frames (outside validated range [97, 97])", () => {
    // targetFrames = 101.1 -> candidateHigh is 105, which is outside validated [97, 97]
    const pastTieDurationMs = (101.1 / 24) * 1000;
    const result = mapDurationMsToLtxFrameCount(pastTieDurationMs);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("out_of_range");
    }
  });

  it("fails with 'out_of_range' for uncertified durations (2500ms, 3500ms, 5000ms)", () => {
    // 2500ms quantizes to 57, 3500ms to 81, 5000ms to 121 — all uncertified outside [97, 97]
    expect(mapDurationMsToLtxFrameCount(2500)).toEqual({ ok: false, reason: "out_of_range" });
    expect(mapDurationMsToLtxFrameCount(3500)).toEqual({ ok: false, reason: "out_of_range" });
    expect(mapDurationMsToLtxFrameCount(5000)).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("fails with 'out_of_range' for duration mapping below 97 frames", () => {
    const result = mapDurationMsToLtxFrameCount(300);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("out_of_range");
    }
  });

  it("fails with 'out_of_range' for duration mapping above 97 frames", () => {
    const result = mapDurationMsToLtxFrameCount(6000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("out_of_range");
    }
  });

  it("fails with 'exceeds_quantization_tolerance' when deviation exceeds tolerance threshold", () => {
    // tieDurationMs has deviation ~166.67ms. With tight tolerance (50ms), it fails tolerance check
    const tieDurationMs = (101 / 24) * 1000;
    const result = mapDurationMsToLtxFrameCount(tieDurationMs, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("exceeds_quantization_tolerance");
    }
  });

  it("fails closed with 'out_of_range' on negative, zero, or non-finite duration", () => {
    expect(mapDurationMsToLtxFrameCount(0)).toEqual({ ok: false, reason: "out_of_range" });
    expect(mapDurationMsToLtxFrameCount(-1000)).toEqual({ ok: false, reason: "out_of_range" });
    expect(mapDurationMsToLtxFrameCount(Number.NaN)).toEqual({ ok: false, reason: "out_of_range" });
    expect(mapDurationMsToLtxFrameCount(Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: "out_of_range"
    });
  });

  it("UnsupportedProductionDurationError formats descriptive error message", () => {
    const errorRange = new UnsupportedProductionDurationError(6000, "out_of_range");
    expect(errorRange.message).toBe("Production duration 6000ms is unsupported: out_of_range");
    expect(errorRange.durationMs).toBe(6000);
    expect(errorRange.reason).toBe("out_of_range");

    const errorTolerance = new UnsupportedProductionDurationError(
      2500,
      "exceeds_quantization_tolerance"
    );
    expect(errorTolerance.message).toBe(
      "Production duration 2500ms is unsupported: exceeds_quantization_tolerance"
    );
    expect(errorTolerance.durationMs).toBe(2500);
    expect(errorTolerance.reason).toBe("exceeds_quantization_tolerance");
  });

  describe("LTX duration helpers", () => {
    it("exports LTX_CANONICAL_DURATION_MS as 4000", () => {
      expect(LTX_CANONICAL_DURATION_MS).toBe(4000);
    });

    it("isLtxRenderableDuration correctly identifies renderable durations", () => {
      expect(isLtxRenderableDuration(4000)).toBe(true);
      expect(isLtxRenderableDuration(4041.67)).toBe(true);
      expect(isLtxRenderableDuration(3900)).toBe(true);
      expect(isLtxRenderableDuration(4200)).toBe(true);
      expect(isLtxRenderableDuration(5000)).toBe(false);
      expect(isLtxRenderableDuration(2500)).toBe(false);
      expect(isLtxRenderableDuration(0)).toBe(false);
    });

    it("snapToRenderableLtxDurationMs preserves valid durations and snaps invalid durations to 4000", () => {
      expect(snapToRenderableLtxDurationMs(4000)).toBe(4000);
      expect(snapToRenderableLtxDurationMs(4042)).toBe(4042);
      expect(snapToRenderableLtxDurationMs(3950)).toBe(3950);
      // Unrenderable durations snap to canonical 4000ms
      expect(snapToRenderableLtxDurationMs(5000)).toBe(4000);
      expect(snapToRenderableLtxDurationMs(2500)).toBe(4000);
      expect(snapToRenderableLtxDurationMs(3500)).toBe(4000);
      expect(snapToRenderableLtxDurationMs(0)).toBe(4000);
      expect(snapToRenderableLtxDurationMs(-100)).toBe(4000);
    });
  });

  describe("mapDurationMsToMiniMaxH3FrameCount", () => {
    it("maps 5166.67ms (124 frames at 24fps) to 124 frames successfully", () => {
      const durationMs = (124 / 24) * 1000;
      const result = mapDurationMsToMiniMaxH3FrameCount(durationMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.frameCount).toBe(124);
        expect(result.achievedDurationMs).toBeCloseTo(5166.67, 1);
        expect(Math.abs(result.achievedDurationMs - durationMs)).toBeCloseTo(0, 5);
      }
    });

    it("maps canonical 5000ms target to 124 frames within quantization tolerance", () => {
      const result = mapDurationMsToMiniMaxH3FrameCount(5000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.frameCount).toBe(124);
        expect(result.achievedDurationMs).toBeCloseTo(5166.67, 1);
        const deviation = Math.abs(result.achievedDurationMs - 5000);
        expect(deviation).toBeCloseTo(166.67, 1);
        expect(deviation).toBeLessThanOrEqual(MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS);
      }
    });

    it("fails with 'out_of_range' for uncertified durations outside [124, 124]", () => {
      expect(mapDurationMsToMiniMaxH3FrameCount(2500)).toEqual({
        ok: false,
        reason: "out_of_range"
      });
      expect(mapDurationMsToMiniMaxH3FrameCount(4000)).toEqual({
        ok: false,
        reason: "out_of_range"
      });
      expect(mapDurationMsToMiniMaxH3FrameCount(6000)).toEqual({
        ok: false,
        reason: "out_of_range"
      });
    });

    it("fails closed with 'out_of_range' on negative, zero, or non-finite duration", () => {
      expect(mapDurationMsToMiniMaxH3FrameCount(0)).toEqual({ ok: false, reason: "out_of_range" });
      expect(mapDurationMsToMiniMaxH3FrameCount(-1000)).toEqual({
        ok: false,
        reason: "out_of_range"
      });
      expect(mapDurationMsToMiniMaxH3FrameCount(Number.NaN)).toEqual({
        ok: false,
        reason: "out_of_range"
      });
      expect(mapDurationMsToMiniMaxH3FrameCount(Number.POSITIVE_INFINITY)).toEqual({
        ok: false,
        reason: "out_of_range"
      });
    });

    it("fails with 'exceeds_quantization_tolerance' when deviation exceeds custom tight tolerance", () => {
      // 5000ms has ~166.67ms deviation from 5166.67ms. With 50ms tolerance, it fails
      const result = mapDurationMsToMiniMaxH3FrameCount(5000, 50);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("exceeds_quantization_tolerance");
      }
    });
  });

  describe("MiniMax-H3 duration helpers", () => {
    it("exports MINIMAX_H3_CANONICAL_DURATION_MS as 5000", () => {
      expect(MINIMAX_H3_CANONICAL_DURATION_MS).toBe(5000);
    });

    it("isMiniMaxH3RenderableDuration correctly identifies renderable durations", () => {
      expect(isMiniMaxH3RenderableDuration(5000)).toBe(true);
      expect(isMiniMaxH3RenderableDuration(5166.67)).toBe(true);
      expect(isMiniMaxH3RenderableDuration(4900)).toBe(true);
      expect(isMiniMaxH3RenderableDuration(4000)).toBe(false);
      expect(isMiniMaxH3RenderableDuration(2500)).toBe(false);
      expect(isMiniMaxH3RenderableDuration(0)).toBe(false);
    });

    it("snapToRenderableMiniMaxH3DurationMs preserves valid durations and snaps invalid durations to 5000", () => {
      expect(snapToRenderableMiniMaxH3DurationMs(5000)).toBe(5000);
      expect(snapToRenderableMiniMaxH3DurationMs(5167)).toBe(5167);
      expect(snapToRenderableMiniMaxH3DurationMs(4900)).toBe(4900);
      // Unrenderable durations snap to canonical 5000ms
      expect(snapToRenderableMiniMaxH3DurationMs(4000)).toBe(5000);
      expect(snapToRenderableMiniMaxH3DurationMs(2500)).toBe(5000);
      expect(snapToRenderableMiniMaxH3DurationMs(0)).toBe(5000);
      expect(snapToRenderableMiniMaxH3DurationMs(-100)).toBe(5000);
    });
  });

  describe("Unified duration mapper and predicates", () => {
    it("isMiniMaxEngineOrProfile identifies MiniMax-H3 engine/profile variants", () => {
      expect(isMiniMaxEngineOrProfile("minimax_h3")).toBe(true);
      expect(isMiniMaxEngineOrProfile("minimax_h3_i2v")).toBe(true);
      expect(isMiniMaxEngineOrProfile("MINIMAX_H3_720P_5S_I2V_V1")).toBe(true);
      expect(isMiniMaxEngineOrProfile("minimax-h3-720p-124f-i2v")).toBe(true);
      expect(isMiniMaxEngineOrProfile("minimax-h3-720p-5s-i2v-v1")).toBe(true);

      expect(isMiniMaxEngineOrProfile("ltx_25")).toBe(false);
      expect(isMiniMaxEngineOrProfile("LTX_25_720P_5S_I2V_V1")).toBe(false);
      expect(isMiniMaxEngineOrProfile(undefined)).toBe(false);
    });

    it("mapProductionDuration routes to correct engine mapper", () => {
      // MiniMax engine routing
      const minimaxResult = mapProductionDuration(5000, { engine: "minimax_h3_i2v" });
      expect(minimaxResult.ok).toBe(true);
      if (minimaxResult.ok) {
        expect(minimaxResult.frameCount).toBe(124);
      }

      // LTX engine routing (default)
      const ltxResult = mapProductionDuration(4000);
      expect(ltxResult.ok).toBe(true);
      if (ltxResult.ok) {
        expect(ltxResult.frameCount).toBe(97);
      }
    });

    it("isRenderableProductionDuration correctly validates duration per engine", () => {
      expect(isRenderableProductionDuration(5000, { engine: "minimax_h3_i2v" })).toBe(true);
      expect(isRenderableProductionDuration(4000, { engine: "minimax_h3_i2v" })).toBe(false);

      expect(isRenderableProductionDuration(4000, { engine: "ltx_25_i2v" })).toBe(true);
      expect(isRenderableProductionDuration(5000, { engine: "ltx_25_i2v" })).toBe(false);
    });

    it("snapToRenderableProductionDurationMs snaps to respective canonical duration", () => {
      expect(snapToRenderableProductionDurationMs(2000, { engine: "minimax_h3_i2v" })).toBe(5000);
      expect(snapToRenderableProductionDurationMs(2000, { engine: "ltx_25_i2v" })).toBe(4000);
    });
  });
});
