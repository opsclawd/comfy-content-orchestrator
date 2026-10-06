import { describe, expect, it } from "vitest";
import { BLOCKING_INITIAL_POSITIONS } from "@cco/domain";
import { parseShotPlanResponse } from "./shot-plan-response-parser.js";

function rawShotPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    framing: "medium",
    angle: "eye_level",
    cameraMovement: "static",
    movementSpeed: "medium",
    lensIntent: "50mm",
    cameraPosition: "eye-level, 3 meters from subject",
    cameraPromptDescription: "medium shot, static, eye level",
    actionSummary: "Subject walks forward.",
    beats: [],
    lightingStyle: "natural_golden_hour",
    environmentDescription: "Outdoor plaza",
    colorPalette: [],
    subjects: [{ subjectId: "subject-1", role: "subject_identity" }],
    ...overrides
  };
}

describe("parseShotPlanResponse", () => {
  it("normalizes a free-text initialPosition into the controlled vocabulary instead of persisting it unchecked", () => {
    const raw = rawShotPlan({
      subjects: [
        {
          subjectId: "subject-1",
          role: "subject_identity",
          initialPosition: "center-left of frame, walking forward toward camera"
        }
      ]
    });

    const proposal = parseShotPlanResponse(JSON.stringify([raw]))[0]!;

    expect(BLOCKING_INITIAL_POSITIONS).toContain(proposal.subjects[0]!.initialPosition);
    expect(proposal.subjects[0]!.initialPosition).toBe("screen_left");
  });

  it("falls back to screen_center when initialPosition cannot be mapped to any known position", () => {
    const raw = rawShotPlan({
      subjects: [
        { subjectId: "subject-1", role: "subject_identity", initialPosition: "somewhere unusual" }
      ]
    });

    const proposal = parseShotPlanResponse(JSON.stringify([raw]))[0]!;

    expect(proposal.subjects[0]!.initialPosition).toBe("screen_center");
  });

  it("numbers beats by position so model-supplied duplicate or zero-based beatIndex values cannot break validation", () => {
    const raw = rawShotPlan({
      beats: [
        { beatIndex: 0, startMs: 0, endMs: 2000, description: "a", subjectAction: "x" },
        { beatIndex: 1, startMs: 2000, endMs: 4000, description: "b", subjectAction: "y" }
      ]
    });

    const [proposal] = parseShotPlanResponse(JSON.stringify([raw]));

    expect(proposal!.beats.map((b) => b.beatIndex)).toEqual([1, 2]);
  });

  it("passes through an already-valid enum value unchanged", () => {
    const raw = rawShotPlan({
      subjects: [
        { subjectId: "subject-1", role: "subject_identity", initialPosition: "background_center" }
      ]
    });

    const proposal = parseShotPlanResponse(JSON.stringify([raw]))[0]!;

    expect(proposal.subjects[0]!.initialPosition).toBe("background_center");
  });
});
