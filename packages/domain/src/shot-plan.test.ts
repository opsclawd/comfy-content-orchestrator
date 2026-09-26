import { describe, expect, it } from "vitest";
import { ShotPlan, type ShotPlanId, type SceneId } from "./index.js";

describe("ShotPlan domain model", () => {
  const baseInput = {
    id: "01928374-abcd-7000-8000-000000000001" as ShotPlanId,
    sceneId: "01928374-abcd-7000-8000-000000000002" as SceneId,
    specRevision: 1,
    variantOrdinal: 1,
    targetDurationMs: 4000,
    targetFrameCount: 96,
    framing: "medium" as const,
    angle: "eye_level" as const,
    lensIntent: "35mm prime",
    cameraPosition: "eye_level tripod",
    cameraMovement: "pan_right" as const,
    movementSpeed: "slow" as const,
    cameraPromptDescription: "A detective inspects clues under warm lamplight",
    actionSummary: "Detective turns slowly to face camera",
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2000,
        description: "Detective examines desk",
        cameraAction: "holds medium shot",
        subjectAction: "picks up magnifying glass"
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Detective looks up",
        cameraAction: "slow pan left",
        subjectAction: "makes eye contact with doorway"
      }
    ],
    lightingStyle: "low_key_dramatic" as const,
    environmentDescription: "Dimly lit study with antique mahogany furniture",
    colorPalette: ["#1a1008", "#d4af37"],
    subjects: [
      {
        subjectId: "detective-1",
        role: "subject_identity" as const,
        initialPosition: "screen_center" as const,
        movementTrajectory: "turns 45 degrees left"
      }
    ],
    continuity: {
      persistentSubjectIds: ["detective-1"],
      frameAnchorTarget: "none" as const
    }
  };

  it("creates a draft shot plan with defaults", () => {
    const plan = ShotPlan.create(baseInput);

    expect(plan.id).toBe(baseInput.id);
    expect(plan.sceneId).toBe(baseInput.sceneId);
    expect(plan.specRevision).toBe(1);
    expect(plan.variantOrdinal).toBe(1);
    expect(plan.status).toBe("draft");
    expect(plan.routingMode).toBe("reference_directed");
    expect(plan.targetDurationMs).toBe(4000);
    expect(plan.targetFrameCount).toBe(96);
    expect(plan.framing).toBe("medium");
    expect(plan.angle).toBe("eye_level");
    expect(plan.previs).toBeNull();

    const snapshot = plan.snapshot();
    expect(snapshot.status).toBe("draft");
    expect(snapshot.beats).toHaveLength(2);
  });

  it("validates that temporal beats do not exceed duration", () => {
    expect(() =>
      ShotPlan.create({
        ...baseInput,
        beats: [
          {
            beatIndex: 1,
            startMs: 0,
            endMs: 5000, // exceeds 4000ms
            description: "Overrun",
            cameraAction: "none",
            subjectAction: "none"
          }
        ]
      })
    ).toThrow(/exceeds targetDurationMs/);
  });

  it("validates that temporal beat start is not after end", () => {
    expect(() =>
      ShotPlan.create({
        ...baseInput,
        beats: [
          {
            beatIndex: 1,
            startMs: 3000,
            endMs: 2000,
            description: "Inverted",
            cameraAction: "none",
            subjectAction: "none"
          }
        ]
      })
    ).toThrow(/must be strictly greater than startMs/);
  });

  it("transitions from draft to approved, superseded, and rejected", () => {
    const plan1 = ShotPlan.create(baseInput);
    plan1.approve();
    expect(plan1.status).toBe("approved");

    const plan2 = ShotPlan.create(baseInput);
    plan2.supersede();
    expect(plan2.status).toBe("superseded");

    const plan3 = ShotPlan.create(baseInput);
    plan3.reject();
    expect(plan3.status).toBe("rejected");
  });

  it("prevents invalid transitions from rejected or superseded states", () => {
    const plan = ShotPlan.create(baseInput);
    plan.reject();
    expect(() => plan.approve()).toThrow(
      /Cannot transition ShotPlan from 'rejected' to 'approved'/
    );

    const plan2 = ShotPlan.create(baseInput);
    plan2.supersede();
    expect(() => plan2.approve()).toThrow(
      /Cannot transition ShotPlan from 'superseded' to 'approved'/
    );
  });

  it("attaches non-authoritative previs media without invalidating approved status", () => {
    const plan = ShotPlan.create(baseInput);
    plan.approve();
    expect(plan.status).toBe("approved");

    plan.attachPrevis({
      candidateId: "01928374-abcd-7000-8000-000000000099",
      storageBucket: "previs-bucket",
      storageObjectKey: "scenes/scene-1/rev-1/previs-1.png",
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      modelProfile: "sdxl-storyboard-fast",
      generatedAt: new Date().toISOString(),
      reviewNotes: "Framing is accurate to medium angle"
    });

    expect(plan.status).toBe("approved");
    expect(plan.previs).not.toBeNull();
    expect(plan.previs?.candidateId).toBe("01928374-abcd-7000-8000-000000000099");
    expect(plan.previs?.storageBucket).toBe("previs-bucket");
  });

  it("reconstitutes from snapshot immutably", () => {
    const plan = ShotPlan.create(baseInput);
    const snapshot = plan.snapshot();
    const reconstituted = ShotPlan.reconstitute(snapshot);

    expect(reconstituted.snapshot()).toEqual(snapshot);
  });
});
