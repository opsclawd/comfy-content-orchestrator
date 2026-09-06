import type { CampaignId, SceneId } from "./scene.js";

export const CAMPAIGN_PRODUCTION_RUN_STATUSES = [
  "dispatched",
  "assembling",
  "completed",
  "failed"
] as const;

export type CampaignProductionRunStatus = (typeof CAMPAIGN_PRODUCTION_RUN_STATUSES)[number];

export interface CampaignProductionRunRecord {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly fingerprint: string;
  readonly status: CampaignProductionRunStatus;
  readonly expectedTotalDurationMs: number;
  readonly assemblyJobId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CampaignProductionRunSceneRecord {
  readonly runId: string;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  /**
   * 1-based persistent scene sequence index (mirrors storyboard_scenes.scene_order).
   */
  readonly sequenceIndex: number;
  readonly expectedDurationMs: number;
  readonly productionJobId?: string | undefined;
}

/**
 * Maps 1-based persistent sequenceIndex entries to 0-based wire indices for AssemblySpec.
 * Sorts by sequenceIndex ascending and maps each scene to its 0-based position (0..n-1).
 */
export function toVideoStemOrder(
  runScenes: readonly { readonly sceneId: string; readonly sequenceIndex: number }[]
): Map<string, number> {
  const sorted = [...runScenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const mapping = new Map<string, number>();
  sorted.forEach((item, index) => {
    mapping.set(item.sceneId, index);
  });
  return mapping;
}
