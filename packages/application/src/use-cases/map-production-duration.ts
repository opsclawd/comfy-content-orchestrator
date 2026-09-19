import {
  LTX_FPS,
  LTX_FRAME_QUANTIZATION_TOLERANCE_MS,
  LTX_FRAME_STEP,
  LTX_SUPPORTED_FRAME_RANGE,
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS,
  MINIMAX_H3_SUPPORTED_FRAME_RANGE
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

/**
 * Canonical duration in milliseconds for certified LTX engine profiles (97 frames at 24fps = ~4.04s, nominal 4000ms).
 */
export const LTX_CANONICAL_DURATION_MS = 4_000;

/**
 * Checks whether a given durationMs is within certified LTX production frame range and quantization tolerance.
 */
export function isLtxRenderableDuration(
  durationMs: number,
  toleranceMs: number = LTX_FRAME_QUANTIZATION_TOLERANCE_MS
): boolean {
  return mapDurationMsToLtxFrameCount(durationMs, toleranceMs).ok;
}

/**
 * Snaps a durationMs to a certified renderable duration for LTX.
 * If the duration is already renderable within quantization tolerance, it is preserved.
 * Otherwise, it snaps to LTX_CANONICAL_DURATION_MS (4000ms).
 */
export function snapToRenderableLtxDurationMs(
  durationMs: number,
  toleranceMs: number = LTX_FRAME_QUANTIZATION_TOLERANCE_MS
): number {
  if (isLtxRenderableDuration(durationMs, toleranceMs)) {
    return durationMs;
  }
  return LTX_CANONICAL_DURATION_MS;
}

/**
 * Canonical duration in milliseconds for certified MiniMax-H3 engine profiles (124 frames at 24fps = ~5.17s / 25fps = ~4.96s, nominal 5000ms).
 */
export const MINIMAX_H3_CANONICAL_DURATION_MS = 5_000;

/**
 * Maps a target duration in milliseconds to a MiniMax-H3 compliant frame count.
 * MiniMax-H3 frames adhere to (frameCount - 5) % 17 === 0 (e.g. 124 frames).
 */
export function mapDurationMsToMiniMaxH3FrameCount(
  durationMs: number,
  toleranceMs: number = MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS
): DurationMappingResult {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, reason: "out_of_range" };
  }

  const targetFrames = (durationMs / 1000) * MINIMAX_H3_FPS;

  const nLow = Math.floor((targetFrames - MINIMAX_H3_FRAME_GRID_BASE) / MINIMAX_H3_FRAME_GRID_STEP);
  const nHigh = nLow + 1;
  const candidateLow = MINIMAX_H3_FRAME_GRID_STEP * nLow + MINIMAX_H3_FRAME_GRID_BASE;
  const candidateHigh = MINIMAX_H3_FRAME_GRID_STEP * nHigh + MINIMAX_H3_FRAME_GRID_BASE;
  const distLow = Math.abs(targetFrames - candidateLow);
  const distHigh = Math.abs(targetFrames - candidateHigh);
  const quantizedFrames = distHigh < distLow ? candidateHigh : candidateLow;

  const achievedDurationMs = (quantizedFrames / MINIMAX_H3_FPS) * 1000;
  const deviationMs = Math.abs(achievedDurationMs - durationMs);

  if (
    quantizedFrames < MINIMAX_H3_SUPPORTED_FRAME_RANGE[0] ||
    quantizedFrames > MINIMAX_H3_SUPPORTED_FRAME_RANGE[1]
  ) {
    return { ok: false, reason: "out_of_range" };
  }
  if (deviationMs > toleranceMs) {
    return { ok: false, reason: "exceeds_quantization_tolerance" };
  }

  return { ok: true, frameCount: quantizedFrames, achievedDurationMs };
}

/**
 * Checks whether a given durationMs is within certified MiniMax-H3 production frame range and quantization tolerance.
 */
export function isMiniMaxH3RenderableDuration(
  durationMs: number,
  toleranceMs: number = MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS
): boolean {
  return mapDurationMsToMiniMaxH3FrameCount(durationMs, toleranceMs).ok;
}

/**
 * Snaps a durationMs to a certified renderable duration for MiniMax-H3.
 * If the duration is already renderable within quantization tolerance, it is preserved.
 * Otherwise, it snaps to MINIMAX_H3_CANONICAL_DURATION_MS (5000ms).
 */
export function snapToRenderableMiniMaxH3DurationMs(
  durationMs: number,
  toleranceMs: number = MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS
): number {
  if (isMiniMaxH3RenderableDuration(durationMs, toleranceMs)) {
    return durationMs;
  }
  return MINIMAX_H3_CANONICAL_DURATION_MS;
}

/**
 * Determines whether the given engine or profile string refers to MiniMax-H3.
 */
export function isMiniMaxEngineOrProfile(engineOrProfile?: string | undefined): boolean {
  if (!engineOrProfile) return false;
  const normalized = engineOrProfile.toLowerCase().trim();
  return (
    normalized === "minimax_h3" ||
    normalized === "minimax_h3_i2v" ||
    normalized === "minimax-h3" ||
    normalized === "minimax-h3-i2v" ||
    normalized === "minimax_h3_720p_5s_i2v_v1" ||
    normalized === "minimax-h3-720p-5s-i2v-v1" ||
    normalized === "minimax-h3-720p-124f-i2v"
  );
}

export interface MapProductionDurationOptions {
  readonly engine?: string | undefined;
  readonly profile?: string | undefined;
  readonly toleranceMs?: number | undefined;
}

/**
 * Unified production duration mapper supporting both LTX and MiniMax-H3 engines.
 */
export function mapProductionDuration(
  durationMs: number,
  options?: MapProductionDurationOptions
): DurationMappingResult {
  if (isMiniMaxEngineOrProfile(options?.engine) || isMiniMaxEngineOrProfile(options?.profile)) {
    return mapDurationMsToMiniMaxH3FrameCount(durationMs, options?.toleranceMs);
  }
  return mapDurationMsToLtxFrameCount(durationMs, options?.toleranceMs);
}

/**
 * Unified renderable duration predicate supporting both LTX and MiniMax-H3 engines.
 */
export function isRenderableProductionDuration(
  durationMs: number,
  options?: MapProductionDurationOptions
): boolean {
  return mapProductionDuration(durationMs, options).ok;
}

/**
 * Snaps a durationMs to a certified renderable duration for the configured engine/profile.
 */
export function snapToRenderableProductionDurationMs(
  durationMs: number,
  options?: MapProductionDurationOptions
): number {
  if (isRenderableProductionDuration(durationMs, options)) {
    return durationMs;
  }
  if (isMiniMaxEngineOrProfile(options?.engine) || isMiniMaxEngineOrProfile(options?.profile)) {
    return MINIMAX_H3_CANONICAL_DURATION_MS;
  }
  return LTX_CANONICAL_DURATION_MS;
}
