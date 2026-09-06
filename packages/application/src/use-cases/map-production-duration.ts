import {
  LTX_FPS,
  LTX_FRAME_QUANTIZATION_TOLERANCE_MS,
  LTX_FRAME_STEP,
  LTX_SUPPORTED_FRAME_RANGE
} from "@cco/contracts";

export class UnsupportedProductionDurationError extends Error {
  override readonly name = "UnsupportedProductionDurationError";
  readonly durationMs: number;
  readonly reason: "out_of_range" | "exceeds_quantization_tolerance";

  constructor(
    durationMs: number,
    reason: "out_of_range" | "exceeds_quantization_tolerance",
    message?: string
  ) {
    super(message ?? `Production duration ${durationMs}ms is unsupported: ${reason}`);
    this.durationMs = durationMs;
    this.reason = reason;
  }
}

export type DurationMappingResult =
  | { readonly ok: true; readonly frameCount: number; readonly achievedDurationMs: number }
  | { readonly ok: false; readonly reason: "out_of_range" | "exceeds_quantization_tolerance" };

export function mapDurationMsToLtxFrameCount(
  durationMs: number,
  toleranceMs: number = LTX_FRAME_QUANTIZATION_TOLERANCE_MS
): DurationMappingResult {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, reason: "out_of_range" };
  }

  const targetFrames = (durationMs / 1000) * LTX_FPS;

  // Nearest value of form 8n+1. On an exact tie (targetFrames equidistant
  // between two 8n+1 candidates), round DOWN to the lower frame count —
  // deterministic, and biases toward the cheaper/faster render.
  const nLow = Math.floor((targetFrames - 1) / LTX_FRAME_STEP);
  const nHigh = nLow + 1;
  const candidateLow = LTX_FRAME_STEP * nLow + 1;
  const candidateHigh = LTX_FRAME_STEP * nHigh + 1;
  const distLow = Math.abs(targetFrames - candidateLow);
  const distHigh = Math.abs(targetFrames - candidateHigh);
  const quantizedFrames = distHigh < distLow ? candidateHigh : candidateLow;

  const achievedDurationMs = (quantizedFrames / LTX_FPS) * 1000;
  const deviationMs = Math.abs(achievedDurationMs - durationMs);

  if (
    quantizedFrames < LTX_SUPPORTED_FRAME_RANGE[0] ||
    quantizedFrames > LTX_SUPPORTED_FRAME_RANGE[1]
  ) {
    return { ok: false, reason: "out_of_range" };
  }
  if (deviationMs > toleranceMs) {
    return { ok: false, reason: "exceeds_quantization_tolerance" };
  }

  return { ok: true, frameCount: quantizedFrames, achievedDurationMs };
}
