import { describe, expect, it } from "vitest";
import {
  computeCampaignProductionRunFingerprint,
  type FingerprintSceneEntry
} from "./campaign-production-fingerprint.js";

describe("computeCampaignProductionRunFingerprint", () => {
  it("produces deterministic fingerprints for the same entries in different input order", () => {
    const campaignId = "campaign-123";
    const entries1: FingerprintSceneEntry[] = [
      { sceneId: "scene-1", specRevision: 2, sequenceIndex: 1 },
      { sceneId: "scene-2", specRevision: 1, sequenceIndex: 2 },
      { sceneId: "scene-3", specRevision: 1, sequenceIndex: 3 }
    ];
    const entries2: FingerprintSceneEntry[] = [
      { sceneId: "scene-3", specRevision: 1, sequenceIndex: 3 },
      { sceneId: "scene-1", specRevision: 2, sequenceIndex: 1 },
      { sceneId: "scene-2", specRevision: 1, sequenceIndex: 2 }
    ];

    const fp1 = computeCampaignProductionRunFingerprint(campaignId, entries1);
    const fp2 = computeCampaignProductionRunFingerprint(campaignId, entries2);

    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes fingerprint when specRevision changes", () => {
    const campaignId = "campaign-123";
    const entries1: FingerprintSceneEntry[] = [
      { sceneId: "scene-1", specRevision: 1, sequenceIndex: 1 }
    ];
    const entries2: FingerprintSceneEntry[] = [
      { sceneId: "scene-1", specRevision: 2, sequenceIndex: 1 }
    ];

    expect(computeCampaignProductionRunFingerprint(campaignId, entries1)).not.toBe(
      computeCampaignProductionRunFingerprint(campaignId, entries2)
    );
  });

  it("changes fingerprint when sequenceIndex changes", () => {
    const campaignId = "campaign-123";
    const entries1: FingerprintSceneEntry[] = [
      { sceneId: "scene-1", specRevision: 1, sequenceIndex: 1 },
      { sceneId: "scene-2", specRevision: 1, sequenceIndex: 2 }
    ];
    const entries2: FingerprintSceneEntry[] = [
      { sceneId: "scene-1", specRevision: 1, sequenceIndex: 2 },
      { sceneId: "scene-2", specRevision: 1, sequenceIndex: 1 }
    ];

    expect(computeCampaignProductionRunFingerprint(campaignId, entries1)).not.toBe(
      computeCampaignProductionRunFingerprint(campaignId, entries2)
    );
  });
});
