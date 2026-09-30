import { describe, expect, it } from "vitest";
import {
  compileCampaignAnimaticReadModel,
  CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE,
  type RawAnimaticSceneInput
} from "@cco/contracts";
import { verifyApprovedVisualProductionInput, MissingCandidateSelectionError } from "@cco/domain";
import type {
  SceneSnapshot,
  StoryboardCandidate,
  SceneId,
  CampaignId,
  CandidateId
} from "@cco/domain";

describe("Campaign Animatic Authority Isolation & Non-Production Invariants", () => {
  const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const campaignName = "Authority Isolation Test Commercial";
  const campaignUpdatedAt = "2026-09-27T12:00:00.000Z";

  it("embeds immutable non-production notice watermark on compiled campaign animatic", () => {
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "22222222-2222-4222-8222-222222222221",
        sceneOrder: 1,
        specRevision: 1,
        durationSeconds: 4,
        selectedShotPlanId: null,
        selectedShotPlanRevision: null,
        approvedShotPlanId: null
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    expect(model.nonProductionNotice).toBe(CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE);
    expect(model.nonProductionNotice).toContain("NON-PRODUCTION");
  });

  it("proves animatic previs media is isolated from production diffusion admission", () => {
    // An animatic shot segment may display previs media, but that previs candidate
    // can never be used as approved visual production input without formal approval.
    const sceneId = "22222222-2222-4222-8222-222222222221" as SceneId;
    const unapprovedScene: SceneSnapshot = {
      id: sceneId,
      campaignId: campaignId as CampaignId,
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "Neo-Tokyo street",
        referenceIds: [],
        engineProfileId: "minimax-h3",
        durationMs: 4000
      }
    };

    const previsCandidate: StoryboardCandidate = {
      id: "55555555-5555-4555-8555-555555555555" as CandidateId,
      sceneId,
      specRevision: 1,
      contentHash: "a".repeat(64),
      variantOrdinal: 1,
      storageBucket: "previs-bucket",
      storageObjectKey: "scenes/scene-1/previs.png",
      generationMetadata: {},
      createdAt: "2026-09-27T12:00:00.000Z"
    };

    expect(() =>
      verifyApprovedVisualProductionInput({
        candidate: previsCandidate,
        scene: unapprovedScene
      })
    ).toThrow(MissingCandidateSelectionError);
  });

  it("proves unselected scenes remain explicit gap segments that block production", () => {
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "22222222-2222-4222-8222-222222222221",
        sceneOrder: 1,
        specRevision: 2,
        durationSeconds: 4,
        selectedShotPlanId: null, // missing selection
        selectedShotPlanRevision: null,
        approvedShotPlanId: null
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    expect(model.gapCount).toBe(1);
    expect(model.approvedShotCount).toBe(0);
    const gap = model.segments[0]!;
    expect(gap.hasPlan).toBe(false);
    if (!gap.hasPlan) {
      expect(gap.gapReason).toBe("NO_SELECTION");
    }
  });
});
