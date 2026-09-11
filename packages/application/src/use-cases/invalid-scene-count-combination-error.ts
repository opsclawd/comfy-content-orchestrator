export interface InvalidSceneCountCombinationDetails {
  readonly targetTotalDurationMs: number;
  readonly sceneCountOverride?: number | undefined;
  readonly resolvedSceneCount: number;
}

export class InvalidSceneCountCombinationError extends Error {
  override readonly name = "InvalidSceneCountCombinationError";
  readonly targetTotalDurationMs: number;
  readonly sceneCountOverride: number | undefined;
  readonly resolvedSceneCount: number;

  constructor(details: InvalidSceneCountCombinationDetails) {
    super(
      `Invalid scene-count/duration combination: targetTotalDurationMs '${details.targetTotalDurationMs}' with ` +
        (details.sceneCountOverride !== undefined
          ? `sceneCountOverride '${details.sceneCountOverride}'`
          : `derived scene count '${details.resolvedSceneCount}'`) +
        ` violates per-scene duration bounds [1000ms, 15000ms].`
    );
    this.targetTotalDurationMs = details.targetTotalDurationMs;
    this.sceneCountOverride = details.sceneCountOverride;
    this.resolvedSceneCount = details.resolvedSceneCount;
  }
}
