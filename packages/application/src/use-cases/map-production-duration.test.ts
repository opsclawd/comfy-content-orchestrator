import { describe, expect, it } from "vitest";
import {
  mapDurationMsToLtxFrameCount,
  UnsupportedProductionDurationError
} from "./map-production-duration.js";
import { LTX_FRAME_QUANTIZATION_TOLERANCE_MS } from "@cco/contracts";

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
});
