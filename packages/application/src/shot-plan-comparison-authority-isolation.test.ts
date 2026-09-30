import { describe, expect, it } from "vitest";
import { computeShotPlanSemanticDiff, SHOT_PLAN_DIFF_READ_ONLY_NOTICE } from "@cco/contracts";
import type { ShotPlanDocument } from "@cco/contracts";
import { verifyApprovedVisualProductionInput, MissingCandidateSelectionError } from "@cco/domain";
import type {
  SceneSnapshot,
  StoryboardCandidate,
  SceneId,
  CampaignId,
  CandidateId
} from "@cco/domain";

function createShotPlanDocument(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
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
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

describe("ShotPlan comparison authority and production isolation", () => {
  it("computes a diff without mutating either source or target ShotPlan", () => {
    const source = createShotPlanDocument();
    const target = createShotPlanDocument({
      id: "44444444-4444-4444-8444-444444444444",
      variantOrdinal: 4,
      framing: "close_up",
      derivedFromShotPlanId: source.id
    });

    const sourceCopy = JSON.parse(JSON.stringify(source));
    const targetCopy = JSON.parse(JSON.stringify(target));

    computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 2 });

    expect(source).toEqual(sourceCopy);
    expect(target).toEqual(targetCopy);
  });

  it("carries a read-only notice and no approval/selection field", () => {
    const source = createShotPlanDocument();
    const target = createShotPlanDocument({
      id: "44444444-4444-4444-8444-444444444444",
      variantOrdinal: 4
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 2 });

    expect(diff.readOnlyNotice).toBe(SHOT_PLAN_DIFF_READ_ONLY_NOTICE);
    expect(diff).not.toHaveProperty("approved");
    expect(diff).not.toHaveProperty("selected");
    expect(diff).not.toHaveProperty("approval");
  });

  it("preserves stale fencing: historical scope and per-side revision/status are intact", () => {
    const source = createShotPlanDocument({ specRevision: 1, status: "superseded" });
    const target = createShotPlanDocument({
      id: "44444444-4444-4444-8444-444444444444",
      variantOrdinal: 4,
      specRevision: 2
    });

    const diff = computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 2 });

    expect(diff.comparisonScope).toBe("historical");
    expect(diff.source.specRevision).toBe(1);
    expect(diff.source.status).toBe("superseded");
    expect(diff.target.specRevision).toBe(2);
  });

  it("confers no production visual authority: an unselected previs candidate still throws MissingCandidateSelectionError after a diff is computed", () => {
    const source = createShotPlanDocument();
    const target = createShotPlanDocument({
      id: "44444444-4444-4444-8444-444444444444",
      variantOrdinal: 4
    });

    // Compute a diff over the plan that carries a previs candidate.
    computeShotPlanSemanticDiff(source, target, { currentSpecRevision: 2 });

    const unapprovedScene: SceneSnapshot = {
      id: source.sceneId as SceneId,
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
      id: source.previs!.candidateId as CandidateId,
      sceneId: source.sceneId as SceneId,
      specRevision: 2,
      contentHash: source.previs!.contentHashSha256,
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
});
