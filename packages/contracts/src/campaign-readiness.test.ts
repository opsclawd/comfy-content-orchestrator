import { describe, expect, it } from "vitest";
import {
  compileCampaignPreProductionReadiness,
  CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE,
  type RawReadinessSceneInput
} from "./campaign-readiness.js";

const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignName = "Readiness Test Commercial";
const campaignUpdatedAt = "2026-09-27T12:00:00.000Z";

function sceneId(n: number): string {
  return `22222222-2222-4222-8222-2222222222${n.toString().padStart(2, "0")}`;
}

function planId(n: number): string {
  return `33333333-3333-4333-8333-3333333333${n.toString().padStart(2, "0")}`;
}

function fullyReadyScene(overrides: Partial<RawReadinessSceneInput> = {}): RawReadinessSceneInput {
  return {
    sceneId: sceneId(1),
    sceneOrder: 1,
    specRevision: 1,
    sceneUpdatedAt: "2026-09-27T10:00:00.000Z",
    routingMode: "reference_directed",
    selectedShotPlanId: planId(1),
    selectedShotPlanRevision: 1,
    approvedShotPlanId: planId(1),
    approvedShotPlanRevision: 1,
    selectedCandidateId: null,
    selectedCandidateRevision: null,
    selectedShotPlanSpecRevision: 1,
    selectedShotPlanStatus: "approved",
    selectedShotPlanPrevisCandidateId: null,
    currentRevisionShotPlanCount: 2,
    supersededShotPlanCount: 0,
    lastPlannedSpecRevision: 1,
    currentRevisionBindingCount: 2,
    currentRevisionBindingRoles: ["subject_identity", "style"],
    hasArchivedBinding: false,
    hasCrossClientBinding: false,
    currentRevisionPrevisAvailable: true,
    currentRevisionPrevisCandidateId: "44444444-4444-4444-8444-444444444444",
    ...overrides
  };
}

function compile(scenes: RawReadinessSceneInput[]) {
  return compileCampaignPreProductionReadiness({
    campaignId,
    campaignName,
    campaignUpdatedAt,
    scenes,
    computedAt: "2026-09-27T12:00:00.000Z"
  });
}

describe("compileCampaignPreProductionReadiness", () => {
  it("reports a fully prepared campaign as all planning-ready", () => {
    const model = compile([fullyReadyScene()]);
    expect(model.readinessStatus).toBe("planning_ready");
    expect(model.aggregates.planningReadyCount).toBe(1);
    expect(model.aggregates.totalScenes).toBe(1);
    expect(model.scenes[0]!.blockers).toHaveLength(0);
    expect(model.planningOnlyNotice).toBe(CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE);
    expect(JSON.stringify(model)).not.toContain("ready_to_dispatch");
  });

  it("flags missing ShotPlan selection as an actionable blocker", () => {
    const scene = fullyReadyScene({
      selectedShotPlanId: null,
      selectedShotPlanRevision: null,
      selectedShotPlanSpecRevision: null,
      approvedShotPlanId: null,
      approvedShotPlanRevision: null
    });
    const model = compile([scene]);
    const codes = model.scenes[0]!.blockers.map((b) => b.code);
    expect(codes).toContain("NO_SHOT_PLAN_SELECTED");
    expect(model.scenes[0]!.status).toBe("needs_attention");
  });

  it("marks a scene stale after a reference change until replanned/reselected", () => {
    const scene = fullyReadyScene({
      specRevision: 2,
      selectedShotPlanId: null,
      selectedShotPlanRevision: null,
      selectedShotPlanSpecRevision: null,
      approvedShotPlanId: null,
      approvedShotPlanRevision: null,
      lastPlannedSpecRevision: 1,
      currentRevisionShotPlanCount: 0,
      supersededShotPlanCount: 1
    });
    const model = compile([scene]);
    const projection = model.scenes[0]!;
    expect(projection.staleness.isStaleAfterRevisionChange).toBe(true);
    const blocker = projection.blockers.find((b) => b.code === "SHOT_PLAN_SELECTION_STALE");
    expect(blocker).toBeDefined();
    expect(blocker!.message).toContain("References changed");
    expect(model.aggregates.staleSceneCount).toBe(1);
    expect(projection.status).not.toBe("planning_ready");
  });

  it("never credits historical/superseded ShotPlans toward current readiness", () => {
    const scene = fullyReadyScene({
      specRevision: 3,
      currentRevisionShotPlanCount: 0,
      supersededShotPlanCount: 2,
      lastPlannedSpecRevision: 2,
      selectedShotPlanId: null,
      selectedShotPlanRevision: null,
      selectedShotPlanSpecRevision: null,
      approvedShotPlanId: null,
      approvedShotPlanRevision: null
    });
    const model = compile([scene]);
    const projection = model.scenes[0]!;
    expect(projection.blockers.map((b) => b.code)).toContain("NO_CURRENT_SHOT_PLANS");
    expect(projection.shotPlans.supersededCount).toBe(2);
    expect(projection.status).toBe("blocked_for_planning");
  });

  it("reports missing previs as an advisory, not a blocker, in reference_directed mode", () => {
    const scene = fullyReadyScene({
      currentRevisionPrevisAvailable: false,
      currentRevisionPrevisCandidateId: null
    });
    const model = compile([scene]);
    const projection = model.scenes[0]!;
    expect(projection.advisories.map((a) => a.code)).toContain("NO_PREVIS_AVAILABLE");
    expect(projection.blockers.map((b) => b.code)).not.toContain("NO_PREVIS_AVAILABLE");
    expect(projection.status).toBe("planning_ready");
  });

  it("blocks on a missing frame anchor in frame_anchored mode", () => {
    const scene = fullyReadyScene({
      routingMode: "frame_anchored",
      selectedCandidateId: null,
      selectedCandidateRevision: null
    });
    const model = compile([scene]);
    const codes = model.scenes[0]!.blockers.map((b) => b.code);
    expect(codes).toContain("MISSING_FRAME_ANCHOR");
  });

  it("surfaces campaign animatic gaps consistently as NOT_IN_CAMPAIGN_ANIMATIC", () => {
    const scene = fullyReadyScene({
      selectedShotPlanId: null,
      selectedShotPlanRevision: null,
      selectedShotPlanSpecRevision: null,
      approvedShotPlanId: null,
      approvedShotPlanRevision: null
    });
    const model = compile([scene]);
    const projection = model.scenes[0]!;
    expect(projection.animatic.included).toBe(false);
    expect(projection.blockers.map((b) => b.code)).toContain("NOT_IN_CAMPAIGN_ANIMATIC");
    expect(model.aggregates.scenesInCampaignAnimaticCount).toBe(0);
  });

  it("flips a scene from needs_attention to planning_ready on approval", () => {
    const unapproved = fullyReadyScene({
      approvedShotPlanId: null,
      approvedShotPlanRevision: null
    });
    const unapprovedModel = compile([unapproved]);
    expect(unapprovedModel.scenes[0]!.status).toBe("needs_attention");

    const approved = fullyReadyScene();
    const approvedModel = compile([approved]);
    expect(approvedModel.scenes[0]!.status).toBe("planning_ready");
  });

  it("computes aggregates as an exact fold over per-scene projections", () => {
    const scenes = [
      fullyReadyScene({ sceneId: sceneId(1), sceneOrder: 1 }),
      fullyReadyScene({
        sceneId: sceneId(2),
        sceneOrder: 2,
        approvedShotPlanId: null,
        approvedShotPlanRevision: null
      }),
      fullyReadyScene({
        sceneId: sceneId(3),
        sceneOrder: 3,
        currentRevisionBindingCount: 0,
        currentRevisionBindingRoles: []
      })
    ];
    const model = compile(scenes);

    const recomputed = {
      totalScenes: model.scenes.length,
      planningReadyCount: model.scenes.filter((s) => s.status === "planning_ready").length,
      needsAttentionCount: model.scenes.filter((s) => s.status === "needs_attention").length,
      blockedForPlanningCount: model.scenes.filter((s) => s.status === "blocked_for_planning")
        .length,
      currentReferenceSceneCount: model.scenes.filter((s) => s.referenceBindings.allCurrent).length,
      scenesWithCurrentShotPlansCount: model.scenes.filter(
        (s) => s.shotPlans.currentRevisionCount > 0
      ).length,
      scenesWithSelectionCount: model.scenes.filter((s) => s.shotPlans.selectedIsCurrentRevision)
        .length,
      approvedSceneCount: model.scenes.filter((s) => s.shotPlans.hasApprovedCurrentRevision).length,
      scenesWithPrevisCount: model.scenes.filter((s) => s.previs.available).length,
      scenesInCampaignAnimaticCount: model.scenes.filter((s) => s.animatic.included).length,
      staleSceneCount: model.scenes.filter((s) => s.staleness.isStaleAfterRevisionChange).length
    };

    expect(model.aggregates).toEqual(recomputed);
  });

  it("is deterministic: identical inputs produce identical models and fingerprints", () => {
    const scenes = [fullyReadyScene()];
    const first = compile(scenes);
    const second = compile(scenes);
    expect(first).toEqual(second);
    expect(first.readSnapshotId).toBe(second.readSnapshotId);
  });

  it("changes the fingerprint when a tracked field mutates", () => {
    const base = compile([fullyReadyScene()]);
    const mutated = compile([
      fullyReadyScene({ approvedShotPlanId: null, approvedShotPlanRevision: null })
    ]);
    expect(base.readSnapshotId).not.toBe(mutated.readSnapshotId);
  });

  it("does not depend on input array order", () => {
    const a = fullyReadyScene({ sceneId: sceneId(1), sceneOrder: 1 });
    const b = fullyReadyScene({ sceneId: sceneId(2), sceneOrder: 2 });
    const forward = compile([a, b]);
    const reversed = compile([b, a]);
    expect(forward).toEqual(reversed);
  });

  it("projects an empty campaign as blocked_for_planning with zero scenes", () => {
    const model = compile([]);
    expect(model.aggregates.totalScenes).toBe(0);
    expect(model.readinessStatus).toBe("blocked_for_planning");
    expect(model.scenes).toHaveLength(0);
  });
});
