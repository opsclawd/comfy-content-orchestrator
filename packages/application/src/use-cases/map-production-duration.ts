import {
  LTX_FPS,
  LTX_FRAME_QUANTIZATION_TOLERANCE_MS,
  LTX_FRAME_STEP,
  LTX_SUPPORTED_FRAME_RANGE,
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS,
  resolveH3ProfileFrameCapabilities,
  type H3ProfileFrameCapability
} from "@cco/contracts";
import type { H3CandidateRegistryReader } from "../ports/h3-candidate-ports.js";

export type ProductionDurationMappingReason =
  | "out_of_range"
  | "exceeds_quantization_tolerance"
  | "unknown_profile"
  | "profile_mismatch"
  | "invalid_duration"
  | "invalid_tolerance";

export class UnsupportedProductionDurationError extends Error {
  override readonly name = "UnsupportedProductionDurationError";
  readonly durationMs: number;
  readonly reason: ProductionDurationMappingReason;

  constructor(durationMs: number, reason: ProductionDurationMappingReason, message?: string) {
    super(message ?? `Production duration ${durationMs}ms is unsupported: ${reason}`);
    this.durationMs = durationMs;
    this.reason = reason;
  }
}

export type DurationMappingResult =
  | {
      readonly ok: true;
      readonly frameCount: number;
      readonly achievedDurationMs: number;
      readonly requestedDurationMs: number;
      readonly nominalDurationMs: number;
      readonly fps: number;
    }
  | {
      readonly ok: false;
      readonly reason: ProductionDurationMappingReason;
    };

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

  return {
    ok: true,
    frameCount: quantizedFrames,
    achievedDurationMs,
    requestedDurationMs: durationMs,
    nominalDurationMs: achievedDurationMs,
    fps: LTX_FPS
  };
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

export interface MapMiniMaxH3DurationOptions {
  readonly toleranceMs?: number | undefined;
  readonly profileKeyOrId?: string | undefined;
  readonly capability?: H3ProfileFrameCapability | undefined;
  readonly registryReader?: H3CandidateRegistryReader | undefined;
}

/**
 * Maps a target duration in milliseconds to a MiniMax-H3 compliant frame count.
 * MiniMax-H3 frames adhere to (frameCount - 5) % 17 === 0 (e.g. 124 frames).
 */
export function mapDurationMsToMiniMaxH3FrameCount(
  durationMs: number,
  toleranceOrOptions?: number | MapMiniMaxH3DurationOptions | undefined,
  profileKeyOrId?: string | undefined,
  registryReader?: H3CandidateRegistryReader | undefined
): DurationMappingResult {
  const options: MapMiniMaxH3DurationOptions =
    typeof toleranceOrOptions === "object" && toleranceOrOptions !== null
      ? toleranceOrOptions
      : {
          toleranceMs: typeof toleranceOrOptions === "number" ? toleranceOrOptions : undefined,
          profileKeyOrId,
          registryReader
        };

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, reason: "out_of_range" };
  }

  const toleranceMs = options.toleranceMs ?? MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS;
  if (!Number.isFinite(toleranceMs) || toleranceMs < 0 || toleranceMs > 60_000) {
    return { ok: false, reason: "invalid_tolerance" };
  }

  // Resolve capability
  let capability: H3ProfileFrameCapability | undefined = options.capability;
  if (!capability) {
    const rawProfile = options.profileKeyOrId;
    if (rawProfile !== undefined && rawProfile.trim().length > 0) {
      capability = resolveH3ProfileFrameCapabilities(rawProfile.trim(), options.registryReader);
      if (!capability) {
        return { ok: false, reason: "out_of_range" };
      }
    } else {
      capability = resolveH3ProfileFrameCapabilities(
        "MINIMAX_H3_720P_5S_I2V_V1",
        options.registryReader
      );
    }
  }

  if (!capability) {
    return { ok: false, reason: "out_of_range" };
  }

  const allowedFrames = capability.allowedFrameCounts;
  if (!allowedFrames || allowedFrames.length === 0) {
    return { ok: false, reason: "out_of_range" };
  }

  const targetFps = capability.fps || MINIMAX_H3_FPS;
  const targetFrames = (durationMs / 1000) * targetFps;

  const minFrames = Math.min(...allowedFrames);
  const maxFrames = Math.max(...allowedFrames);

  // If target frame count is completely outside the profile's allowed min/max range
  if (
    targetFrames < minFrames - MINIMAX_H3_FRAME_GRID_STEP / 2 ||
    targetFrames > maxFrames + MINIMAX_H3_FRAME_GRID_STEP / 2
  ) {
    return { ok: false, reason: "out_of_range" };
  }

  // Validate allowed frames against MiniMax-H3 temporal grid
  for (const f of allowedFrames) {
    if (
      !Number.isSafeInteger(f) ||
      f <= 0 ||
      (f - MINIMAX_H3_FRAME_GRID_BASE) % MINIMAX_H3_FRAME_GRID_STEP !== 0
    ) {
      return { ok: false, reason: "out_of_range" };
    }
  }

  // Find candidate in allowedFrames with closest nominal duration to target durationMs
  let bestCandidate = allowedFrames[0]!;
  let bestDist = Math.abs((bestCandidate * 1000) / targetFps - durationMs);

  for (let i = 1; i < allowedFrames.length; i++) {
    const f = allowedFrames[i]!;
    const nominalMs = (f * 1000) / targetFps;
    const dist = Math.abs(nominalMs - durationMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestCandidate = f;
    } else if (dist === bestDist) {
      // Tie breaker: bias towards lower frame count
      if (f < bestCandidate) {
        bestCandidate = f;
      }
    }
  }

  const nominalDurationMs = (bestCandidate * 1000) / targetFps;
  const deviationMs = Math.abs(nominalDurationMs - durationMs);

  if (deviationMs > toleranceMs) {
    return {
      ok: false,
      reason: "exceeds_quantization_tolerance"
    };
  }

  return {
    ok: true,
    frameCount: bestCandidate,
    achievedDurationMs: nominalDurationMs,
    requestedDurationMs: durationMs,
    nominalDurationMs,
    fps: targetFps
  };
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
    normalized === "minimax_h3_ref2v" ||
    normalized === "minimax-h3" ||
    normalized === "minimax-h3-i2v" ||
    normalized === "minimax-h3-ref2v" ||
    normalized === "minimax_h3_720p_5s_i2v_v1" ||
    normalized === "minimax-h3-720p-5s-i2v-v1" ||
    normalized === "minimax-h3-720p-124f-i2v" ||
    normalized === "minimax_h3_720p_5s_ref2v_v1" ||
    normalized === "minimax-h3-720p-5s-ref2v-v1" ||
    normalized === "minimax-h3-720p-124f-ref2v" ||
    normalized === "minimax-h3-720p@certified-v1" ||
    normalized.startsWith("h3_candidate_") ||
    normalized.startsWith("h3_release_")
  );
}

export interface MapProductionDurationOptions {
  readonly engine?: string | undefined;
  readonly profile?: string | undefined;
  readonly toleranceMs?: number | undefined;
  readonly capability?: H3ProfileFrameCapability | undefined;
  readonly registryReader?: H3CandidateRegistryReader | undefined;
}

/**
 * Unified production duration mapper supporting both LTX and MiniMax-H3 engines.
 */
export function mapProductionDuration(
  durationMs: number,
  options?: MapProductionDurationOptions
): DurationMappingResult {
  if (
    options?.capability ||
    isMiniMaxEngineOrProfile(options?.engine) ||
    isMiniMaxEngineOrProfile(options?.profile)
  ) {
    return mapDurationMsToMiniMaxH3FrameCount(durationMs, {
      toleranceMs: options?.toleranceMs,
      profileKeyOrId: options?.profile ?? options?.engine,
      capability: options?.capability,
      registryReader: options?.registryReader
    });
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
