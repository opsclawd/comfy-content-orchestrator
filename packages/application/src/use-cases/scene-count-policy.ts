import { InvalidTargetDurationError } from "./invalid-target-duration-error.js";
import { InvalidSceneCountError } from "./invalid-scene-count-error.js";
import { InvalidSceneCountCombinationError } from "./invalid-scene-count-combination-error.js";

// Source of truth for scene-count admission policy constants.
// Kept in sync with packages/contracts/src/campaign.ts via cross-package unit tests.
export const MIN_TARGET_DURATION_MS = 5_000;
export const MAX_TARGET_DURATION_MS = 300_000;
export const MIN_SCENE_COUNT = 1;
export const MAX_SCENE_COUNT = 60;
export const TARGET_SECONDS_PER_SCENE = 5;
export const MIN_SCENE_DURATION_MS = 1_000;
export const MAX_SCENE_DURATION_MS = 15_000;

export interface ResolveSceneCountInput {
  readonly targetTotalDurationMs: number;
  readonly sceneCountOverride?: number | undefined;
}

/**
 * Resolves the authoritative scene count N for a campaign shell.
 *
 * Policy:
 * 1. targetTotalDurationMs must be an integer within [5_000, 300_000] ms.
 * 2. If sceneCountOverride is provided, it must be an integer within [1, 60].
 * 3. Without override, N is derived as round(targetTotalDurationMs / (TARGET_SECONDS_PER_SCENE * 1000)),
 *    clamped to [1, 60], using round-half-up for tie-breaks.
 * 4. Authoritative combination check: the implied per-scene duration (targetTotalDurationMs / N)
 *    must satisfy MIN_SCENE_DURATION_MS (1_000ms) <= duration <= MAX_SCENE_DURATION_MS (15_000ms).
 */
export function resolveSceneCount(input: ResolveSceneCountInput): number {
  const duration = input.targetTotalDurationMs;
  if (
    !Number.isInteger(duration) ||
    duration < MIN_TARGET_DURATION_MS ||
    duration > MAX_TARGET_DURATION_MS
  ) {
    throw new InvalidTargetDurationError(duration);
  }

  let resolvedN: number;
  if (input.sceneCountOverride !== undefined) {
    const override = input.sceneCountOverride;
    if (!Number.isInteger(override) || override < MIN_SCENE_COUNT || override > MAX_SCENE_COUNT) {
      throw new InvalidSceneCountError(override);
    }
    resolvedN = override;
  } else {
    const derived = Math.round(duration / (TARGET_SECONDS_PER_SCENE * 1000));
    resolvedN = Math.min(Math.max(derived, MIN_SCENE_COUNT), MAX_SCENE_COUNT);
  }

  // Authoritative combination validation
  const minAllowedDuration = resolvedN * MIN_SCENE_DURATION_MS;
  const maxAllowedDuration = resolvedN * MAX_SCENE_DURATION_MS;

  if (duration < minAllowedDuration || duration > maxAllowedDuration) {
    throw new InvalidSceneCountCombinationError({
      targetTotalDurationMs: duration,
      sceneCountOverride: input.sceneCountOverride,
      resolvedSceneCount: resolvedN
    });
  }

  return resolvedN;
}
