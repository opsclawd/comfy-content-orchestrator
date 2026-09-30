import { describe, expect, it } from "vitest";
import { compileShotPlanAnimaticTimeline, ANIMATIC_NON_PRODUCTION_NOTICE } from "@cco/contracts";
import type { ShotPlanDocument, ShotPlanReviewItem } from "@cco/contracts";
import { verifyApprovedVisualProductionInput, MissingCandidateSelectionError } from "@cco/domain";
import type {
  SceneSnapshot,
  StoryboardCandidate,
  SceneId,
  CampaignId,
  CandidateId
} from "@cco/domain";

function createMockShotPlanDocument(): ShotPlanDocument {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 1,
    status: "approved",
    routingMode: "reference_directed",
    targetDurationMs: 4000,
    targetFrameCount: 97,
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
        description: "Visor lifts to reveal cybernetic eye",
        cameraAction: "gentle push in",
        subjectAction: "hand lifts visor"
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
      reviewNotes: "Previs draft"
    },
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z"
  };
}

describe("Animatic Authority and Production Isolation", () => {
  it("compiles pure deterministic animatic timeline without mutating source ShotPlanDocument", () => {
    const originalDoc = createMockShotPlanDocument();
    const docCopy = JSON.parse(JSON.stringify(originalDoc));

    const timeline = compileShotPlanAnimaticTimeline(originalDoc);

    // Source document remains completely unmodified
    expect(originalDoc).toEqual(docCopy);

    // Animatic timeline contains non-production notice
    expect(timeline.nonProductionNotice).toBe(ANIMATIC_NON_PRODUCTION_NOTICE);
    expect(timeline.nonProductionNotice).toContain("NON-PRODUCTION");
  });

  it("verifies previs media and animatic projections are isolated from production visual conditioning", () => {
    const doc = createMockShotPlanDocument();
    const timeline = compileShotPlanAnimaticTimeline(doc);

    // The animatic timeline has a previsMedia reference
    expect(timeline.previsMedia.candidateId).toBe("55555555-5555-4555-8555-555555555555");

    // In domain authority, ApprovedVisualProductionInput requires an authoritative candidate
    // selected on the SceneSnapshot, not an unconfirmed previs candidate or animatic projection
    const unapprovedScene: SceneSnapshot = {
      id: doc.sceneId as SceneId,
      campaignId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as CampaignId,
      status: "director_review",
      specRevision: 2,
      configuration: {
        prompt: "Neo-Tokyo alley",
        referenceIds: [],
        engineProfileId: "minimax-h3",
        durationMs: 4000
      }
    };

    const previsCandidate: StoryboardCandidate = {
      id: doc.previs!.candidateId as CandidateId,
      sceneId: doc.sceneId as SceneId,
      specRevision: 2,
      contentHash: doc.previs!.contentHashSha256,
      variantOrdinal: 1,
      storageBucket: "previs-bucket",
      storageObjectKey: "scenes/scene-1/previs.png",
      generationMetadata: {},
      createdAt: "2026-09-27T12:00:00.000Z"
    };

    // Previs candidate cannot create approved visual production input when not selected on scene
    expect(() =>
      verifyApprovedVisualProductionInput({
        candidate: previsCandidate,
        scene: unapprovedScene
      })
    ).toThrow(MissingCandidateSelectionError);
  });

  it("preserves stale revision fencing in compiled animatic timeline", () => {
    const reviewItem: ShotPlanReviewItem = {
      shotPlanId: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222222",
      specRevision: 1, // Stale revision (current is 2)
      variantOrdinal: 1,
      status: "superseded",
      routingMode: "reference_directed",
      isCurrentRevision: false,
      targetDurationMs: 4000,
      targetFrameCount: 97,
      framing: "medium_close_up",
      angle: "eye_level",
      cameraMovement: "static",
      movementSpeed: "medium",
      lensIntent: "50mm prime",
      cameraPosition: "eye level",
      cameraPromptDescription: "Locked off view",
      actionSummary: "Protagonist stands",
      lightingStyle: "neon_night",
      environmentDescription: "Neo-Tokyo",
      colorPalette: [],
      atmosphere: null,
      subjects: [],
      beats: [],
      dialogue: null,
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none"
      },
      previs: null,
      boundReferences: [],
      createdAt: "2026-09-27T12:00:00.000Z",
      updatedAt: "2026-09-27T12:00:00.000Z"
    };

    const timeline = compileShotPlanAnimaticTimeline(reviewItem);

    // Stale status is preserved, preventing confusion with current production intent
    expect(timeline.isCurrentRevision).toBe(false);
    expect(timeline.status).toBe("superseded");
    expect(timeline.specRevision).toBe(1);
  });
});
