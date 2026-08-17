import { describe, expect, it } from "vitest";
import {
  REVIEW_ACTIONS,
  ReviewActionSchema,
  ReviewEventSchema,
  SCENE_STATUSES,
  SceneStatusSchema
} from "./scene-review.js";

describe("scene-review contracts", () => {
  it("accepts every canonical scene status and review action", () => {
    for (const status of SCENE_STATUSES) {
      expect(SceneStatusSchema.parse(status)).toBe(status);
    }

    for (const action of REVIEW_ACTIONS) {
      expect(ReviewActionSchema.parse(action)).toBe(action);
    }
  });

  it("rejects review events whose prior or resulting status is not canonical", () => {
    const validEvent = {
      eventId: "evt-001",
      sceneId: "scene-123",
      reviewerName: "Director Alice",
      action: "approve",
      directorNotes: "Looks great",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "approved",
      occurredAt: "2026-08-15T00:00:00.000Z"
    };

    expect(ReviewEventSchema.parse(validEvent)).toEqual(validEvent);

    const withInvalidPrior = {
      ...validEvent,
      priorSceneStatus: "non_canonical_status"
    };
    expect(ReviewEventSchema.safeParse(withInvalidPrior).success).toBe(false);

    const withInvalidResulting = {
      ...validEvent,
      resultingSceneStatus: "non_canonical_status"
    };
    expect(ReviewEventSchema.safeParse(withInvalidResulting).success).toBe(false);
  });

  it("accepts candidate_select as a canonical review action", () => {
    expect(ReviewActionSchema.parse("candidate_select")).toBe("candidate_select");

    const event = {
      eventId: "evt-002",
      sceneId: "scene-123",
      reviewerName: "Director Alice",
      action: "candidate_select",
      mutationPayload: { candidateId: "cand-1", candidateRevision: 1 },
      priorSceneStatus: "director_review",
      resultingSceneStatus: "director_review",
      occurredAt: "2026-08-15T00:00:00.000Z"
    };
    expect(ReviewEventSchema.parse(event)).toEqual(event);
  });
});
