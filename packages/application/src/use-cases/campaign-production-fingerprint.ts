import { createHash } from "node:crypto";

export interface FingerprintSceneEntry {
  readonly sceneId: string;
  readonly specRevision: number;
  readonly sequenceIndex: number;
}

/**
 * Computes deterministic SHA-256 fingerprint from campaignId and ordered scene-spec-revision entries.
 */
export function computeCampaignProductionRunFingerprint(
  campaignId: string,
  orderedEntries: readonly FingerprintSceneEntry[]
): string {
  const sorted = [...orderedEntries].sort((a, b) => {
    if (a.sequenceIndex !== b.sequenceIndex) {
      return a.sequenceIndex - b.sequenceIndex;
    }
    return a.sceneId.localeCompare(b.sceneId);
  });
  const serialized = `${campaignId}:${sorted
    .map((e) => `${e.sceneId}:${e.specRevision}:${e.sequenceIndex}`)
    .join(",")}`;
  return createHash("sha256").update(serialized).digest("hex");
}
