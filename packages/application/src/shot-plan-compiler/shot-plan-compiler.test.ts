import { describe, expect, it } from "vitest";
import type { ShotPlanDocument } from "@cco/contracts";
import type { CanonicalReferenceEntry } from "./canonicalize-reference-bindings.js";
import { compileShotPlan, ShotPlanCompilerError } from "./shot-plan-compiler.js";

function makeApprovedShotPlan(overrides: Partial<ShotPlanDocument> = {}): ShotPlanDocument {
  return {
    id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    sceneId: "d3b07384-d113-46fb-a0ff-c96767ad58ff",
    specRevision: 2,
    variantOrdinal: 1,
    status: "approved",
    routingMode: "reference_directed",
    targetDurationMs: 5167,
    targetFrameCount: 124,
    durationToleranceMs: 355,
    fps: 24,
    framing: "medium_wide",
    angle: "eye_level",
    lensIntent: "35mm prime cinematic",
    cameraPosition: "standing eye height 1.6m",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    cameraPromptDescription: "Slow cinematic push-in focusing on subject expression",
    subjects: [
      {
        subjectId: "character_hero",
        role: "subject_identity",
        initialPosition: "screen_center",
        movementTrajectory: "stationary turning head right",
        interactionSummary: "looking up at falling snow",
        referenceAssetId: "11111111-1111-1111-1111-111111111111"
      }
    ],
    actionSummary: "Hero stands in the snowstorm, holding the glowing device.",
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2500,
        description: "Initial discovery",
        cameraAction: "Slow push",
        subjectAction: "Turns head"
      },
      {
        beatIndex: 2,
        startMs: 2500,
        endMs: 5000,
        description: "Device activation",
        cameraAction: "Tightens on face",
        subjectAction: "Raises device"
      }
    ],
    lightingStyle: "natural_golden_hour",
    environmentDescription: "Snowy forest clearing at dusk",
    colorPalette: ["#1B263B", "#E0E1DD", "#DDA15E"],
    atmosphere: "Quiet, mystical, cold wind",
    dialogue: {
      speaker: "Hero",
      line: "It is finally beginning.",
      deliveryEmotion: "whispered with awe"
    },
    continuity: {
      incomingContinuityFromSceneId: null,
      persistentSubjectIds: ["character_hero"],
      lightingContinuityNote: "Matches twilight from previous scene",
      frameAnchorTarget: "none",
      anchorCandidateId: null,
      anchorMediaHashSha256: null
    },
    previs: null,
    machineModel: null,
    createdAt: "2026-09-25T12:00:00.000Z",
    updatedAt: "2026-09-25T12:05:00.000Z",
    ...overrides
  };
}

const mockReferences: readonly CanonicalReferenceEntry[] = [
  {
    slotIndex: 1,
    promptTag: "<Picture 1>",
    role: "subject_identity",
    referenceAssetId: "11111111-1111-1111-1111-111111111111",
    contentHashSha256: "a".repeat(64),
    asset: {
      id: "11111111-1111-1111-1111-111111111111",
      clientId: "client-001",
      storageBucket: "cco-test",
      storageObjectKey: "refs/hero.png",
      contentHashSha256: "a".repeat(64),
      mimeType: "image/png"
    }
  }
];

describe("compileShotPlan", () => {
  it("compiles approved ShotPlan into deterministic instruction surface", () => {
    const shotPlan = makeApprovedShotPlan();
    const result = compileShotPlan({
      shotPlan,
      references: mockReferences,
      routingMode: "reference_directed",
      sceneSpec: { revision: 2, actionContext: "Hero enters the forgotten shrine." }
    });

    expect(result.instructionText).toContain("[Scene Context]: Hero enters the forgotten shrine.");
    expect(result.instructionText).toContain("[Camera]: Framing: medium_wide");
    expect(result.instructionText).toContain("[Subjects]: character_hero (subject_identity)");
    expect(result.instructionText).toContain("(visual reference: <Picture 1>)");
    expect(result.instructionText).toContain("[Action Summary]: Hero stands in the snowstorm");
    expect(result.instructionText).toContain("[Temporal Beats]:");
    expect(result.instructionText).toContain("Beat 1 [0ms-2500ms): Initial discovery");
    expect(result.instructionText).toContain("Beat 2 [2500ms-5000ms): Device activation");
    expect(result.instructionText).toContain("[Continuity]: Persistent Subjects: character_hero");
    expect(result.instructionText).toContain("[Dialogue]: Speaker: Hero");
    expect(result.instructionText).toContain(
      "[Reference Visuals]:\n<Picture 1> represents subject identity"
    );

    // Deterministic hash & bytes check
    expect(result.instructionHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.instructionBytes).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result.instructionBytes).toString("utf-8")).toBe(result.instructionText);
  });

  it("throws SHOT_PLAN_NOT_APPROVED when status is not approved", () => {
    const unapproved = makeApprovedShotPlan({ status: "draft" });
    expect(() =>
      compileShotPlan({
        shotPlan: unapproved
      })
    ).toThrow(ShotPlanCompilerError);

    try {
      compileShotPlan({ shotPlan: unapproved });
    } catch (err) {
      expect((err as ShotPlanCompilerError).code).toBe("SHOT_PLAN_NOT_APPROVED");
    }
  });

  it("throws ROUTING_MODE_MISMATCH when shotPlan routingMode diverges", () => {
    const shotPlan = makeApprovedShotPlan({ routingMode: "frame_anchored" });
    expect(() =>
      compileShotPlan({
        shotPlan,
        routingMode: "reference_directed"
      })
    ).toThrow(ShotPlanCompilerError);

    try {
      compileShotPlan({ shotPlan, routingMode: "reference_directed" });
    } catch (err) {
      expect((err as ShotPlanCompilerError).code).toBe("ROUTING_MODE_MISMATCH");
    }
  });

  it("throws SPEC_REVISION_MISMATCH when sceneSpec revision does not match ShotPlan specRevision", () => {
    const shotPlan = makeApprovedShotPlan({ specRevision: 3 });
    expect(() =>
      compileShotPlan({
        shotPlan,
        sceneSpec: { revision: 2 }
      })
    ).toThrow(ShotPlanCompilerError);

    try {
      compileShotPlan({ shotPlan, sceneSpec: { revision: 2 } });
    } catch (err) {
      expect((err as ShotPlanCompilerError).code).toBe("SPEC_REVISION_MISMATCH");
    }
  });

  it("throws DUPLICATE_BEAT_INDEX when duplicate beatIndex is present", () => {
    const shotPlan = makeApprovedShotPlan({
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 1000,
          description: "b1",
          cameraAction: "c1",
          subjectAction: "s1"
        },
        {
          beatIndex: 1,
          startMs: 1000,
          endMs: 2000,
          description: "b2",
          cameraAction: "c2",
          subjectAction: "s2"
        }
      ]
    });

    expect(() => compileShotPlan({ shotPlan })).toThrow(ShotPlanCompilerError);
    try {
      compileShotPlan({ shotPlan });
    } catch (err) {
      expect((err as ShotPlanCompilerError).code).toBe("DUPLICATE_BEAT_INDEX");
    }
  });

  it("throws BEAT_RANGE_OUT_OF_BOUNDS when beat interval violates duration window", () => {
    const shotPlan = makeApprovedShotPlan({
      targetDurationMs: 3000,
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000, // exceeds 3000ms
          description: "overflow",
          cameraAction: "c",
          subjectAction: "s"
        }
      ]
    });

    expect(() => compileShotPlan({ shotPlan, configuredDurationMs: 3000 })).toThrow(
      ShotPlanCompilerError
    );
    try {
      compileShotPlan({ shotPlan, configuredDurationMs: 3000 });
    } catch (err) {
      expect((err as ShotPlanCompilerError).code).toBe("BEAT_RANGE_OUT_OF_BOUNDS");
    }
  });

  it("throws REFERENCE_TAG_BIJECTION_FAILED when text references unprovided tag", () => {
    const shotPlan = makeApprovedShotPlan({
      actionSummary: "Subject holds <Picture 2> which glows bright."
    });

    // We only provide <Picture 1> in references
    expect(() =>
      compileShotPlan({
        shotPlan,
        references: mockReferences
      })
    ).toThrow(ShotPlanCompilerError);
    try {
      compileShotPlan({ shotPlan, references: mockReferences });
    } catch (err) {
      expect((err as ShotPlanCompilerError).code).toBe("ORPHAN_PICTURE_TAG");
    }
  });

  it("normalizes CRLF to LF and strips disallowed control characters", () => {
    const shotPlan = makeApprovedShotPlan({
      actionSummary: "Line 1\r\nLine 2\x07with bell",
      subjects: []
    });

    const result = compileShotPlan({
      shotPlan,
      references: []
    });

    expect(result.instructionText).not.toContain("\r");
    expect(result.instructionText).not.toContain("\x07");
    expect(result.instructionText).toContain("Line 1\nLine 2 with bell");
  });
});
