import { describe, expect, it } from "vitest";
import {
  CampaignAnimaticReadModelSchema,
  CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE,
  classifyCampaignAnimaticGap,
  compileCampaignAnimaticReadModel,
  computeCampaignAnimaticSnapshotId,
  computeShotLocalTimeMs,
  findActiveCampaignSegment,
  findNextSegmentStartTime,
  findPreviousSegmentStartTime,
  type RawAnimaticSceneInput
} from "./campaign-animatic.js";
import type { ShotPlanDocument } from "./shot-plan.js";

function createMockShotPlanDocument(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 1,
    variantOrdinal: 1,
    status: "draft",
    routingMode: "reference_directed",
    targetDurationMs: 4000,
    targetFrameCount: 96,
    durationToleranceMs: 355,
    fps: 24,
    framing: "medium_close_up",
    angle: "eye_level",
    lensIntent: "50mm prime cinematic",
    cameraPosition: "chest height, facing subject",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    cameraPromptDescription: "Slow push in on the protagonist",
    actionSummary: "Protagonist raises visor and examines glowing data shard",
    lightingStyle: "neon_night",
    environmentDescription: "Rain-slicked alleyway in Neo-Tokyo",
    colorPalette: ["cyan", "magenta"],
    atmosphere: "steamy neon rain haze",
    subjects: [
      {
        subjectId: "hero-1",
        referenceAssetId: "33333333-3333-4333-8333-333333333333",
        role: "subject_identity",
        initialPosition: "screen_center",
        movementTrajectory: "stationary, raises hand",
        interactionSummary: "looks into visor"
      }
    ],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2000,
        description: "Visor lifts",
        cameraAction: "push in",
        subjectAction: "hand lifts visor"
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Shard glows",
        cameraAction: "hold",
        subjectAction: "gaze fixes"
      }
    ],
    dialogue: {
      speaker: "Elena",
      line: "Look at this data shard...",
      voiceoverCue: "The city never sleeps.",
      audioFxPrompt: "Cybernetic servo whir"
    },
    continuity: {
      persistentSubjectIds: ["hero-1"],
      frameAnchorTarget: "none"
    },
    previs: {
      candidateId: "55555555-5555-4555-8555-555555555555",
      storageBucket: "previs-bucket",
      storageObjectKey: "scenes/scene-1/previs.png",
      contentHashSha256: "a".repeat(64),
      modelProfile: "flux-schnell",
      generatedAt: "2026-09-27T12:00:00.000Z",
      reviewNotes: "Neon previs draft"
    },
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

describe("Campaign Animatic Contracts & Deterministic Compiler", () => {
  const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const campaignName = "Cyberpunk Neo-Tokyo Commercial";
  const campaignUpdatedAt = "2026-09-27T12:00:00.000Z";

  it("compiles campaign animatic with canonical scene ordering and exact cumulative offsets", () => {
    const scene1Id = "22222222-2222-4222-8222-222222222221";
    const scene2Id = "22222222-2222-4222-8222-222222222222";
    const scene3Id = "22222222-2222-4222-8222-222222222223";

    const plan1 = createMockShotPlanDocument({
      id: "11111111-1111-4111-8111-111111111111",
      sceneId: scene1Id,
      targetDurationMs: 4000,
      status: "approved"
    });
    const plan2 = createMockShotPlanDocument({
      id: "22222222-2222-4222-8222-222222222222",
      sceneId: scene2Id,
      targetDurationMs: 3000,
      status: "draft"
    });
    const plan3 = createMockShotPlanDocument({
      id: "33333333-3333-4333-8333-333333333333",
      sceneId: scene3Id,
      targetDurationMs: 5000,
      status: "draft"
    });

    // Provide scenes intentionally out of order
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: scene2Id,
        sceneOrder: 2,
        specRevision: 1,
        selectedShotPlanId: plan2.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan2
      },
      {
        sceneId: scene1Id,
        sceneOrder: 1,
        specRevision: 1,
        selectedShotPlanId: plan1.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: plan1.id,
        selectedShotPlan: plan1
      },
      {
        sceneId: scene3Id,
        sceneOrder: 3,
        specRevision: 1,
        selectedShotPlanId: plan3.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan3
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    // Validate with Zod schema
    const parseResult = CampaignAnimaticReadModelSchema.safeParse(model);
    expect(parseResult.success).toBe(true);

    expect(model.campaignId).toBe(campaignId);
    expect(model.campaignName).toBe(campaignName);
    expect(model.totalScenes).toBe(3);
    expect(model.gapCount).toBe(0);
    expect(model.approvedShotCount).toBe(1);
    expect(model.draftShotCount).toBe(2);
    expect(model.nonProductionNotice).toBe(CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE);

    // Exact cumulative offsets:
    // Scene 1: [0, 4000)
    // Scene 2: [4000, 7000)
    // Scene 3: [7000, 12000]
    expect(model.segments).toHaveLength(3);
    expect(model.segments[0]!.sceneOrder).toBe(1);
    expect(model.segments[0]!.startMs).toBe(0);
    expect(model.segments[0]!.endMs).toBe(4000);
    expect(model.segments[0]!.targetDurationMs).toBe(4000);
    if (model.segments[0]!.hasPlan) {
      expect(model.segments[0]!.approvalStatus).toBe("approved");
    }

    expect(model.segments[1]!.sceneOrder).toBe(2);
    expect(model.segments[1]!.startMs).toBe(4000);
    expect(model.segments[1]!.endMs).toBe(7000);
    expect(model.segments[1]!.targetDurationMs).toBe(3000);
    if (model.segments[1]!.hasPlan) {
      expect(model.segments[1]!.approvalStatus).toBe("draft");
    }

    expect(model.segments[2]!.sceneOrder).toBe(3);
    expect(model.segments[2]!.startMs).toBe(7000);
    expect(model.segments[2]!.endMs).toBe(12000);
    expect(model.segments[2]!.targetDurationMs).toBe(5000);

    expect(model.totalDurationMs).toBe(12000);
    expect(model.includedShotPlanDurationMs).toBe(12000);
  });

  it("handles missing plan selection as an explicit gap segment and preserves duration", () => {
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 2,
        durationSeconds: 3.5,
        selectedShotPlanId: null,
        selectedShotPlanRevision: null,
        approvedShotPlanId: null,
        selectedShotPlan: null
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    expect(model.totalScenes).toBe(1);
    expect(model.gapCount).toBe(1);
    expect(model.approvedShotCount).toBe(0);
    expect(model.draftShotCount).toBe(0);
    expect(model.totalDurationMs).toBe(3500);
    expect(model.includedShotPlanDurationMs).toBe(0);

    const segment = model.segments[0]!;
    expect(segment.hasPlan).toBe(false);
    if (!segment.hasPlan) {
      expect(segment.gapReason).toBe("NO_SELECTION");
      expect(segment.gapMessage).toContain("no ShotPlan selected for Revision 2");
      expect(segment.startMs).toBe(0);
      expect(segment.endMs).toBe(3500);
      expect(segment.targetDurationMs).toBe(3500);
    }
  });

  it("never silently substitutes a stale ShotPlan from a previous revision", () => {
    // Scene is Revision 2, but selection still points to Revision 1 plan
    const stalePlan = createMockShotPlanDocument({
      specRevision: 1,
      targetDurationMs: 4000
    });

    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 2,
        durationSeconds: 4,
        selectedShotPlanId: stalePlan.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: stalePlan
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    expect(model.gapCount).toBe(1);
    const segment = model.segments[0]!;
    expect(segment.hasPlan).toBe(false);
    if (!segment.hasPlan) {
      expect(segment.gapReason).toBe("STALE_SELECTION");
      expect(segment.gapMessage).toContain("Revision 1, but current spec is Revision 2");
    }
  });

  it("flags SPEC_REVISION_MISMATCH if plan object revision does not match scene spec revision", () => {
    const mismatchPlan = createMockShotPlanDocument({
      specRevision: 1
    });

    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 2,
        durationSeconds: 4,
        selectedShotPlanId: mismatchPlan.id,
        selectedShotPlanRevision: 2, // claimed revision 2 but plan itself is revision 1
        approvedShotPlanId: null,
        selectedShotPlan: mismatchPlan
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    expect(model.gapCount).toBe(1);
    const segment = model.segments[0]!;
    expect(segment.hasPlan).toBe(false);
    if (!segment.hasPlan) {
      expect(segment.gapReason).toBe("SPEC_REVISION_MISMATCH");
    }
  });

  it("flags SHOT_PLAN_NOT_FOUND if selectedShotPlanId is provided but plan object is missing", () => {
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 1,
        durationSeconds: 4,
        selectedShotPlanId: "11111111-1111-4111-8111-111111111111",
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: null
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    expect(model.gapCount).toBe(1);
    const segment = model.segments[0]!;
    expect(segment.hasPlan).toBe(false);
    if (!segment.hasPlan) {
      expect(segment.gapReason).toBe("SHOT_PLAN_NOT_FOUND");
    }
  });

  it("finds active campaign segment with deterministic cut at boundaries", () => {
    const plan1 = createMockShotPlanDocument({ targetDurationMs: 4000 });
    const plan2 = createMockShotPlanDocument({ targetDurationMs: 4000 });
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 1,
        selectedShotPlanId: plan1.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan1
      },
      {
        sceneId: "scene-2-uuid",
        sceneOrder: 2,
        specRevision: 1,
        selectedShotPlanId: plan2.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan2
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    // Scene 1: [0, 4000)
    // Scene 2: [4000, 8000]

    expect(findActiveCampaignSegment(model, 0)?.sceneOrder).toBe(1);
    expect(findActiveCampaignSegment(model, 2000)?.sceneOrder).toBe(1);
    expect(findActiveCampaignSegment(model, 3999)?.sceneOrder).toBe(1);

    // Hard cut at 4000ms: switches immediately to Scene 2
    expect(findActiveCampaignSegment(model, 4000)?.sceneOrder).toBe(2);
    expect(findActiveCampaignSegment(model, 6000)?.sceneOrder).toBe(2);
    expect(findActiveCampaignSegment(model, 8000)?.sceneOrder).toBe(2);

    // Clamped behavior beyond totalDuration
    expect(findActiveCampaignSegment(model, 9000)?.sceneOrder).toBe(2);
  });

  it("computes shot-local elapsed time accurately", () => {
    const plan = createMockShotPlanDocument({ targetDurationMs: 4000 });
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 1,
        selectedShotPlanId: plan.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan
      },
      {
        sceneId: "scene-2-uuid",
        sceneOrder: 2,
        specRevision: 1,
        selectedShotPlanId: plan.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    const seg2 = model.segments[1]!; // startMs: 4000, endMs: 8000
    expect(computeShotLocalTimeMs(seg2, 4000)).toBe(0);
    expect(computeShotLocalTimeMs(seg2, 5500)).toBe(1500);
    expect(computeShotLocalTimeMs(seg2, 8000)).toBe(4000);
  });

  it("handles next and previous boundary seeking correctly", () => {
    const plan = createMockShotPlanDocument({ targetDurationMs: 4000 });
    const scenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "scene-1-uuid",
        sceneOrder: 1,
        specRevision: 1,
        selectedShotPlanId: plan.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan
      },
      {
        sceneId: "scene-2-uuid",
        sceneOrder: 2,
        specRevision: 1,
        selectedShotPlanId: plan.id,
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null,
        selectedShotPlan: plan
      }
    ];

    const model = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes
    });

    // Next shot seeking
    expect(findNextSegmentStartTime(model, 1500)).toBe(4000);
    expect(findNextSegmentStartTime(model, 4000)).toBe(8000);
    expect(findNextSegmentStartTime(model, 8000)).toBe(8000);

    // Previous shot seeking (>500ms into shot seeks to beginning of current shot)
    expect(findPreviousSegmentStartTime(model, 1500, 500)).toBe(0);
    expect(findPreviousSegmentStartTime(model, 5500, 500)).toBe(4000);

    // Previous shot seeking (<=500ms into shot seeks to previous shot start)
    expect(findPreviousSegmentStartTime(model, 4200, 500)).toBe(0);
  });

  it("derives deterministic snapshot fingerprints sensitive to revisions and selections", () => {
    const sceneInputs1 = [
      {
        sceneId: "scene-1",
        specRevision: 1,
        selectedShotPlanId: "plan-a",
        approvedShotPlanId: null
      }
    ];

    const id1 = computeCampaignAnimaticSnapshotId(campaignId, campaignUpdatedAt, sceneInputs1);
    const id1Repeat = computeCampaignAnimaticSnapshotId(
      campaignId,
      campaignUpdatedAt,
      sceneInputs1
    );
    expect(id1).toBe(id1Repeat);

    // Change plan selection
    const sceneInputs2 = [
      {
        sceneId: "scene-1",
        specRevision: 1,
        selectedShotPlanId: "plan-b",
        approvedShotPlanId: null
      }
    ];
    const id2 = computeCampaignAnimaticSnapshotId(campaignId, campaignUpdatedAt, sceneInputs2);
    expect(id2).not.toBe(id1);

    // Change spec revision
    const sceneInputs3 = [
      {
        sceneId: "scene-1",
        specRevision: 2,
        selectedShotPlanId: "plan-a",
        approvedShotPlanId: null
      }
    ];
    const id3 = computeCampaignAnimaticSnapshotId(campaignId, campaignUpdatedAt, sceneInputs3);
    expect(id3).not.toBe(id1);

    // Change campaign updated at
    const id4 = computeCampaignAnimaticSnapshotId(
      campaignId,
      "2026-09-28T00:00:00.000Z",
      sceneInputs1
    );
    expect(id4).not.toBe(id1);
  });
});

describe("classifyCampaignAnimaticGap", () => {
  it("returns NO_SELECTION when no ShotPlan is selected", () => {
    const gap = classifyCampaignAnimaticGap({
      sceneId: "scene-1",
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: null,
      selectedShotPlanRevision: null
    });
    expect(gap?.reason).toBe("NO_SELECTION");
  });

  it("returns STALE_SELECTION when the selection revision does not match the spec revision", () => {
    const gap = classifyCampaignAnimaticGap({
      sceneId: "scene-1",
      sceneOrder: 1,
      specRevision: 2,
      selectedShotPlanId: "plan-1",
      selectedShotPlanRevision: 1
    });
    expect(gap?.reason).toBe("STALE_SELECTION");
  });

  it("returns SHOT_PLAN_NOT_FOUND when the selected plan cannot be resolved", () => {
    const gap = classifyCampaignAnimaticGap({
      sceneId: "scene-1",
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: "plan-1",
      selectedShotPlanRevision: 1,
      selectedShotPlan: null
    });
    expect(gap?.reason).toBe("SHOT_PLAN_NOT_FOUND");
  });

  it("returns SPEC_REVISION_MISMATCH when the resolved plan's revision disagrees", () => {
    const gap = classifyCampaignAnimaticGap({
      sceneId: "scene-1",
      sceneOrder: 1,
      specRevision: 2,
      selectedShotPlanId: "plan-1",
      selectedShotPlanRevision: 2,
      selectedShotPlan: { specRevision: 1 }
    });
    expect(gap?.reason).toBe("SPEC_REVISION_MISMATCH");
  });

  it("returns null when the selection resolves cleanly at the current revision", () => {
    const gap = classifyCampaignAnimaticGap({
      sceneId: "scene-1",
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: "plan-1",
      selectedShotPlanRevision: 1,
      selectedShotPlan: { specRevision: 1 }
    });
    expect(gap).toBeNull();
  });
});
