import { describe, expect, it } from "vitest";
import {
  InvalidShotPlanError,
  InvalidTransitionError,
  Scene,
  type CampaignId,
  type SceneId,
  type ShotPlanId
} from "./index.js";

describe("Scene ShotPlan selection, approval, and revision fencing", () => {
  function createReviewScene() {
    const scene = Scene.create({
      id: "01928374-abcd-7000-8000-000000000010" as SceneId,
      campaignId: "01928374-abcd-7000-8000-000000000020" as CampaignId,
      configuration: {
        prompt: "A cinematic shot of a cafe exterior",
        referenceIds: [],
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 5000
      }
    });

    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    return scene;
  }

  const validShotPlanId = "01928374-abcd-7000-8000-000000000099" as ShotPlanId;
  const foreignSceneId = "01928374-abcd-7000-8000-000000000088" as SceneId;

  it("selects a ShotPlan matching scene and revision in director_review", () => {
    const scene = createReviewScene();
    const transition = scene.selectShotPlan(validShotPlanId, scene.specRevision, scene.id);

    expect(transition.reason).toBe("shot_plan_selected");
    expect(transition.from).toBe("director_review");
    expect(transition.to).toBe("director_review");

    const snapshot = scene.snapshot();
    expect(snapshot.selectedShotPlanId).toBe(validShotPlanId);
    expect(snapshot.selectedShotPlanRevision).toBe(scene.specRevision);
  });

  it("fails closed when selecting a ShotPlan belonging to a foreign scene", () => {
    const scene = createReviewScene();

    expect(() => scene.selectShotPlan(validShotPlanId, scene.specRevision, foreignSceneId)).toThrow(
      InvalidShotPlanError
    );
  });

  it("fails closed when selecting a ShotPlan from a stale revision", () => {
    const scene = createReviewScene();
    const staleRevision = scene.specRevision + 1;

    expect(() => scene.selectShotPlan(validShotPlanId, staleRevision, scene.id)).toThrow(
      InvalidShotPlanError
    );
  });

  it("approves a scene with a ShotPlan selection", () => {
    const scene = createReviewScene();
    scene.selectShotPlan(validShotPlanId, scene.specRevision, scene.id);

    const transition = scene.approveShotPlan({
      shotPlanId: validShotPlanId,
      shotPlanRevision: scene.specRevision,
      approvedBy: "director-alice",
      approvedAt: new Date().toISOString()
    });

    expect(transition.reason).toBe("approved");
    expect(transition.to).toBe("approved");

    const snapshot = scene.snapshot();
    expect(snapshot.status).toBe("approved");
    expect(snapshot.approvedShotPlanId).toBe(validShotPlanId);
    expect(snapshot.approvedShotPlanRevision).toBe(scene.specRevision);
    expect(snapshot.approval?.approvedBy).toBe("director-alice");
  });

  it("approves a scene referencing previously selected ShotPlan implicitly", () => {
    const scene = createReviewScene();
    scene.selectShotPlan(validShotPlanId, scene.specRevision, scene.id);

    const transition = scene.approveShotPlan({
      approvedBy: "director-alice",
      approvedAt: new Date().toISOString()
    });

    expect(transition.to).toBe("approved");
    expect(scene.snapshot().approvedShotPlanId).toBe(validShotPlanId);
  });

  it("fails approval if no ShotPlan is selected or provided", () => {
    const scene = createReviewScene();

    expect(() =>
      scene.approveShotPlan({
        approvedBy: "director-alice",
        approvedAt: new Date().toISOString()
      })
    ).toThrow(InvalidTransitionError);
  });

  it("fences stale ShotPlans when a spec mutation bumps revision", () => {
    const scene = createReviewScene();
    scene.selectShotPlan(validShotPlanId, scene.specRevision, scene.id);
    expect(scene.snapshot().selectedShotPlanId).toBe(validShotPlanId);

    // Bump revision via prompt edit
    scene.updatePrompt("An updated prompt for the scene");

    const mutatedSnapshot = scene.snapshot();
    expect(mutatedSnapshot.specRevision).toBe(2);
    expect(mutatedSnapshot.selectedShotPlanId).toBeUndefined();
    expect(mutatedSnapshot.selectedShotPlanRevision).toBeUndefined();
    expect(mutatedSnapshot.approvedShotPlanId).toBeUndefined();
    expect(mutatedSnapshot.approvedShotPlanRevision).toBeUndefined();

    // Prior revision ShotPlan is now rejected as stale
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    expect(() => scene.selectShotPlan(validShotPlanId, 1, scene.id)).toThrow(InvalidShotPlanError);
  });

  it("clears ShotPlan selection and approval pointers on requestReroll", () => {
    const scene = createReviewScene();
    scene.selectShotPlan(validShotPlanId, scene.specRevision, scene.id);

    scene.requestReroll();

    const snapshot = scene.snapshot();
    expect(snapshot.status).toBe("generating_candidates");
    expect(snapshot.selectedShotPlanId).toBeUndefined();
    expect(snapshot.selectedShotPlanRevision).toBeUndefined();
    expect(snapshot.approvedShotPlanId).toBeUndefined();
    expect(snapshot.approvedShotPlanRevision).toBeUndefined();
  });
});
