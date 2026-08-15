import { describe, expect, it } from "vitest";
import {
  InvalidMutationError,
  InvalidTransitionError,
  SCENE_STATUSES,
  Scene,
  TerminalStateError,
  type CampaignId,
  type SceneId
} from "./index.js";

describe("Scene domain contracts", () => {
  it("exports canonical status tuple matching PRD order", () => {
    expect(SCENE_STATUSES).toEqual([
      "draft_pending",
      "generating_candidates",
      "director_review",
      "approved",
      "queued",
      "rendering",
      "qa",
      "completed",
      "failed",
      "cancelled"
    ]);
  });

  it("creates a draft scene at revision one with an immutable configuration snapshot", () => {
    const referenceIds = ["asset-a"];
    const scene = Scene.create({
      id: "scene-1" as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A product reveal",
        referenceIds,
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4_000
      }
    });

    expect(scene.id).toBe("scene-1");
    expect(scene.campaignId).toBe("campaign-1");
    expect(scene.status).toBe("draft_pending");

    referenceIds.push("asset-b");
    const snapshot = scene.snapshot();
    expect(snapshot).toMatchObject({
      status: "draft_pending",
      specRevision: 1,
      configuration: { referenceIds: ["asset-a"] }
    });
    expect(snapshot.approval).toBeUndefined();
    expect(snapshot.failedFrom).toBeUndefined();
    expect("approval" in snapshot).toBe(false);
    expect("failedFrom" in snapshot).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.configuration.referenceIds)).toBe(true);

    // Compile-time type assertion: CampaignId cannot occupy SceneId position
    Scene.create({
      // @ts-expect-error CampaignId cannot be assigned to SceneId
      id: "campaign-1" as CampaignId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "Test",
        referenceIds: [],
        engineProfileId: "engine-1",
        durationMs: 1000
      }
    });

    // Compile-time and runtime type assertion: status is readonly
    expect(() => {
      // @ts-expect-error status is readonly and has no setter
      scene.status = "approved";
    }).toThrow(TypeError);

    // Compile-time and runtime type assertion: id is readonly
    expect(() => {
      // @ts-expect-error id is readonly and has no setter
      scene.id = "scene-2" as SceneId;
    }).toThrow(TypeError);

    // Compile-time and runtime type assertion: campaignId is readonly
    expect(() => {
      // @ts-expect-error campaignId is readonly and has no setter
      scene.campaignId = "campaign-2" as CampaignId;
    }).toThrow(TypeError);
  });

  describe("typed domain errors", () => {
    it("instantiates InvalidTransitionError with default and custom messages", () => {
      const err = new InvalidTransitionError(
        "scene-1" as SceneId,
        "draft_pending",
        "start_rendering"
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidTransitionError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.currentStatus).toBe("draft_pending");
      expect(err.attemptedAction).toBe("start_rendering");
      expect(err.message).toBe(
        "Cannot perform 'start_rendering' on scene 'scene-1' with status 'draft_pending'."
      );

      const customErr = new InvalidTransitionError(
        "scene-1" as SceneId,
        "draft_pending",
        "start_rendering",
        "Custom transition failure"
      );
      expect(customErr.message).toBe("Custom transition failure");
    });

    it("instantiates InvalidMutationError with default and custom messages", () => {
      const err = new InvalidMutationError(
        "scene-1" as SceneId,
        "rendering",
        "prompt"
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidMutationError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.currentStatus).toBe("rendering");
      expect(err.field).toBe("prompt");
      expect(err.message).toBe(
        "Cannot mutate 'prompt' on scene 'scene-1' in status 'rendering'."
      );

      const customErr = new InvalidMutationError(
        "scene-1" as SceneId,
        "rendering",
        "prompt",
        "Custom mutation failure"
      );
      expect(customErr.message).toBe("Custom mutation failure");
    });

    it("instantiates TerminalStateError with default and custom messages", () => {
      const err = new TerminalStateError(
        "scene-1" as SceneId,
        "completed",
        "cancel"
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("TerminalStateError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.terminalStatus).toBe("completed");
      expect(err.attemptedAction).toBe("cancel");
      expect(err.message).toBe(
        "Cannot perform 'cancel' on scene 'scene-1' in terminal state 'completed'."
      );

      const customErr = new TerminalStateError(
        "scene-1" as SceneId,
        "completed",
        "cancel",
        "Custom terminal failure"
      );
      expect(customErr.message).toBe("Custom terminal failure");
    });
  });
});

