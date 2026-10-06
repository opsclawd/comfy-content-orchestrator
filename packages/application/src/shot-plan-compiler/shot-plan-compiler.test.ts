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
    bindingId: "binding-1",
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
    expect(result.instructionText).toContain(
      "[Subjects]: <Picture 1> (subject_identity): Initial: screen_center, Path: stationary turning head right, Interaction: looking up at falling snow"
    );
    expect(result.instructionText).not.toContain("character_hero");
    expect(result.instructionText).toContain("[Action Summary]: Hero stands in the snowstorm");
    expect(result.instructionText).toContain("[Temporal Beats]:");
    expect(result.instructionText).toContain("Beat 1 [0ms-2500ms): Initial discovery");
    expect(result.instructionText).toContain("Beat 2 [2500ms-5000ms): Device activation");
    expect(result.instructionText).toContain("[Continuity]: Persistent Subjects: <Picture 1>");
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

  it("allows compiling unapproved shotPlan when allowUnapproved is true", () => {
    const unapproved = makeApprovedShotPlan({ status: "draft" });
    const result = compileShotPlan({
      shotPlan: unapproved,
      allowUnapproved: true
    });
    expect(result.instructionText).toContain("[Scene Context]");
    expect(result.instructionHashSha256).toMatch(/^[0-9a-f]{64}$/);
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

  describe("reference-grounded prompt clauses", () => {
    it("compiles subject-only binding: subject clause includes description and tag; planner subject identity wording is absent", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "planner_character_hero",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "walk forward slowly",
            interactionSummary: "looking up at the stars",
            referenceAssetId: "sub-ref-001"
          }
        ],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["planner_character_hero"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        environmentDescription: "Snowy forest clearing at dusk"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "binding-sub",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "sub-ref-001",
          contentHashSha256: "b".repeat(64),
          asset: {
            id: "sub-ref-001",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/couple.png",
            contentHashSha256: "b".repeat(64),
            mimeType: "image/png",
            displayName: "wedding_photo.png",
            description: "East Asian couple in elegant wedding attire"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // Subject clause present with tag and bound description
      expect(result.instructionText).toContain(
        "[Subject Identity]: <Picture 1>: East Asian couple in elegant wedding attire"
      );
      // Blocking uses reference tag, preserving spatial kinematics
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_center, Path: walk forward slowly, Interaction: looking up at the stars"
      );
      expect(result.instructionText).toContain("[Continuity]: Persistent Subjects: <Picture 1>");
      // Planner-authored subject identity wording is absent
      expect(result.instructionText).not.toContain("planner_character_hero");
      // Location clause is not emitted and environment description is retained
      expect(result.instructionText).not.toContain("[Location]");
      expect(result.instructionText).toContain(
        "[Environment & Lighting]: Style: natural_golden_hour | Environment: Snowy forest clearing at dusk"
      );
    });

    it("compiles location-only binding: location clause includes description and tag; planner location wording is absent", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "character_hero",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "stationary",
            interactionSummary: null
          }
        ],
        environmentDescription: "Tobago beach with turquoise water and palm trees"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "binding-loc",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "location",
          referenceAssetId: "loc-ref-001",
          contentHashSha256: "c".repeat(64),
          asset: {
            id: "loc-ref-001",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/poolhouse.png",
            contentHashSha256: "c".repeat(64),
            mimeType: "image/png",
            displayName: "poolhouse.png",
            description: "Modern minimalist pool house with blue mosaic tiles"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // Location clause present with tag and bound description
      expect(result.instructionText).toContain(
        "[Location]: <Picture 1>: Modern minimalist pool house with blue mosaic tiles"
      );
      // Planner location wording is absent from prompt
      expect(result.instructionText).not.toContain("Tobago beach");
      expect(result.instructionText).not.toContain("turquoise water");
      // Environment & Lighting style retained without planner environment prose
      expect(result.instructionText).toContain(
        "[Environment & Lighting]: Style: natural_golden_hour"
      );
      expect(result.instructionText).not.toContain("Environment: Tobago beach");
      // Subject Identity clause is not emitted since no subject_identity reference exists
      expect(result.instructionText).not.toContain("[Subject Identity]");
      expect(result.instructionText).toContain("character_hero (subject_identity)");
    });

    it("compiles both-role bindings: both clauses present with descriptions and tags; planner prose suppressed", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "groom_with_warm_brown_skin",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "turning towards camera",
            interactionSummary: "smiling at partner",
            referenceAssetId: "sub-ref-001"
          }
        ],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["groom_with_warm_brown_skin"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        environmentDescription: "Tobago tropical beach at sunset"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "binding-sub",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "sub-ref-001",
          contentHashSha256: "b".repeat(64),
          asset: {
            id: "sub-ref-001",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/couple.png",
            contentHashSha256: "b".repeat(64),
            mimeType: "image/png",
            description: "East Asian couple in formal wedding attire"
          }
        },
        {
          bindingId: "binding-loc",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "location",
          referenceAssetId: "loc-ref-002",
          contentHashSha256: "c".repeat(64),
          asset: {
            id: "loc-ref-002",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/poolhouse.png",
            contentHashSha256: "c".repeat(64),
            mimeType: "image/png",
            description: "Mid-century modern pool house with glass walls"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // Both clauses present
      expect(result.instructionText).toContain(
        "[Subject Identity]: <Picture 1>: East Asian couple in formal wedding attire"
      );
      expect(result.instructionText).toContain(
        "[Location]: <Picture 2>: Mid-century modern pool house with glass walls"
      );

      // Planner subject and location wording absent
      expect(result.instructionText).not.toContain("groom_with_warm_brown_skin");
      expect(result.instructionText).not.toContain("Tobago tropical beach");

      // Blocking and continuity use tags
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_center, Path: turning towards camera, Interaction: smiling at partner"
      );
      expect(result.instructionText).toContain("[Continuity]: Persistent Subjects: <Picture 1>");

      // Reference Visuals section still lists both
      expect(result.instructionText).toContain("<Picture 1> represents subject identity");
      expect(result.instructionText).toContain("<Picture 2> represents location");
    });

    it("correctly maps non-contiguous and non-default slot positions", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "scientist_lead",
            role: "subject_identity",
            initialPosition: "foreground_left",
            movementTrajectory: "operating control terminal",
            referenceAssetId: "sub-7"
          }
        ],
        environmentDescription: "Cyberpunk laboratory basement"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "binding-loc",
          slotIndex: 3,
          promptTag: "<Picture 3>",
          role: "location",
          referenceAssetId: "loc-3",
          contentHashSha256: "3".repeat(64),
          asset: {
            id: "loc-3",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/observatory.png",
            contentHashSha256: "3".repeat(64),
            mimeType: "image/png",
            description: "Mountaintop optical observatory with copper dome"
          }
        },
        {
          bindingId: "binding-sub",
          slotIndex: 7,
          promptTag: "<Picture 7>",
          role: "subject_identity",
          referenceAssetId: "sub-7",
          contentHashSha256: "7".repeat(64),
          asset: {
            id: "sub-7",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/scientist.png",
            contentHashSha256: "7".repeat(64),
            mimeType: "image/png",
            description: "Elderly astronomer with white hair and round glasses"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // Clauses reflect the actual non-default slot tags
      expect(result.instructionText).toContain(
        "[Subject Identity]: <Picture 7>: Elderly astronomer with white hair and round glasses"
      );
      expect(result.instructionText).toContain(
        "[Location]: <Picture 3>: Mountaintop optical observatory with copper dome"
      );
      expect(result.instructionText).toContain(
        "<Picture 7> (subject_identity): Initial: foreground_left, Path: operating control terminal"
      );
      expect(result.instructionText).not.toContain("scientist_lead");
      expect(result.instructionText).not.toContain("Cyberpunk laboratory basement");
    });

    it("directs unlinked subjects by role correlation when referenceAssetId is omitted in ShotPlan", () => {
      // Simulates Campaign 8f366d09 scene 2 where ShotPlan subjects lacked referenceAssetId link
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "groom with warm brown skin",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "standing stationary"
          }
        ],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["groom with warm brown skin"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        environmentDescription: "Tobago beach resort"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "binding-sub",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "24372271-27f0-4995-b237-282c183b8c09",
          contentHashSha256: "4".repeat(64),
          asset: {
            id: "24372271-27f0-4995-b237-282c183b8c09",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/couple.png",
            contentHashSha256: "4".repeat(64),
            mimeType: "image/png",
            description: "East Asian wedding couple standing close"
          }
        },
        {
          bindingId: "binding-loc",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "location",
          referenceAssetId: "pool-house-asset-id",
          contentHashSha256: "5".repeat(64),
          asset: {
            id: "pool-house-asset-id",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/poolhouse.png",
            contentHashSha256: "5".repeat(64),
            mimeType: "image/png",
            description: "Bound pool house patio with sun umbrellas"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      expect(result.instructionText).toContain(
        "[Subject Identity]: <Picture 1>: East Asian wedding couple standing close"
      );
      expect(result.instructionText).toContain(
        "[Location]: <Picture 2>: Bound pool house patio with sun umbrellas"
      );
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_center, Path: standing stationary"
      );
      expect(result.instructionText).toContain("[Continuity]: Persistent Subjects: <Picture 1>");
      expect(result.instructionText).not.toContain("groom with warm brown skin");
      expect(result.instructionText).not.toContain("Tobago beach resort");
    });

    it("formats multiple references sharing the same role deterministically", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "bride",
            role: "subject_identity",
            initialPosition: "screen_left",
            movementTrajectory: "turns left",
            referenceAssetId: "sub-1"
          },
          {
            subjectId: "groom",
            role: "subject_identity",
            initialPosition: "screen_right",
            movementTrajectory: "turns right",
            referenceAssetId: "sub-2"
          }
        ],
        environmentDescription: "Grand ballroom and terrace"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "b-1",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "sub-1",
          contentHashSha256: "1".repeat(64),
          asset: {
            id: "sub-1",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/bride.png",
            contentHashSha256: "1".repeat(64),
            mimeType: "image/png",
            description: "East Asian bride in white gown"
          }
        },
        {
          bindingId: "b-2",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "subject_identity",
          referenceAssetId: "sub-2",
          contentHashSha256: "2".repeat(64),
          asset: {
            id: "sub-2",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/groom.png",
            contentHashSha256: "2".repeat(64),
            mimeType: "image/png",
            description: "East Asian groom in navy tuxedo"
          }
        },
        {
          bindingId: "b-3",
          slotIndex: 3,
          promptTag: "<Picture 3>",
          role: "location",
          referenceAssetId: "loc-1",
          contentHashSha256: "3".repeat(64),
          asset: {
            id: "loc-1",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/ballroom.png",
            contentHashSha256: "3".repeat(64),
            mimeType: "image/png",
            description: "Crystal chandelier ballroom"
          }
        },
        {
          bindingId: "b-4",
          slotIndex: 4,
          promptTag: "<Picture 4>",
          role: "location",
          referenceAssetId: "loc-2",
          contentHashSha256: "4".repeat(64),
          asset: {
            id: "loc-2",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/terrace.png",
            contentHashSha256: "4".repeat(64),
            mimeType: "image/png",
            description: "Marble terrace overlooking illuminated fountains"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      expect(result.instructionText).toContain(
        "[Subject Identity]: <Picture 1>: East Asian bride in white gown; <Picture 2>: East Asian groom in navy tuxedo"
      );
      expect(result.instructionText).toContain(
        "[Location]: <Picture 3>: Crystal chandelier ballroom; <Picture 4>: Marble terrace overlooking illuminated fountains"
      );
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_left"
      );
      expect(result.instructionText).toContain(
        "<Picture 2> (subject_identity): Initial: screen_right"
      );
      expect(result.instructionText).not.toContain("Grand ballroom and terrace");
    });

    it("falls back gracefully when reference description is missing or blank without inventing text", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "character_hero",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "standing",
            referenceAssetId: "sub-ref"
          }
        ],
        environmentDescription: "Snowy forest clearing at dusk"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "b-1",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "sub-ref",
          contentHashSha256: "1".repeat(64),
          asset: {
            id: "sub-ref",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/hero.png",
            contentHashSha256: "1".repeat(64),
            mimeType: "image/png",
            description: "   " // blank whitespace
          }
        },
        {
          bindingId: "b-2",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "location",
          referenceAssetId: "loc-ref",
          contentHashSha256: "2".repeat(64),
          asset: {
            id: "loc-ref",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/loc.png",
            contentHashSha256: "2".repeat(64),
            mimeType: "image/png",
            description: null // null description
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // No clauses emitted for missing/blank descriptions
      expect(result.instructionText).not.toContain("[Subject Identity]");
      expect(result.instructionText).not.toContain("[Location]");

      // Suppresses planner identity and location prose whenever the corresponding role is bound
      expect(result.instructionText).not.toContain("character_hero");
      expect(result.instructionText).not.toContain("Snowy forest clearing at dusk");

      // Picture-tag direction with neutral blocking mechanics retained
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_center, Path: standing"
      );
      expect(result.instructionText).toContain(
        "[Environment & Lighting]: Style: natural_golden_hour"
      );
      expect(result.instructionText).not.toContain("Environment: Snowy forest clearing at dusk");

      // Bijection satisfied via Reference Visuals declarations
      expect(result.instructionText).toContain("<Picture 1> represents subject identity");
      expect(result.instructionText).toContain("<Picture 2> represents location");
    });

    it("suppresses planner wording for unlinked subject when bound reference description is blank", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "unlinked_planner_subject_name",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "standing stationary"
          }
        ],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["unlinked_planner_subject_name"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        environmentDescription: "Planner mountain landscape"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "b-sub-blank",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "ref-sub-blank",
          contentHashSha256: "9".repeat(64),
          asset: {
            id: "ref-sub-blank",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/sub.png",
            contentHashSha256: "9".repeat(64),
            mimeType: "image/png",
            description: ""
          }
        },
        {
          bindingId: "b-loc-blank",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "location",
          referenceAssetId: "ref-loc-blank",
          contentHashSha256: "8".repeat(64),
          asset: {
            id: "ref-loc-blank",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/loc.png",
            contentHashSha256: "8".repeat(64),
            mimeType: "image/png",
            description: "   "
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      expect(result.instructionText).not.toContain("[Subject Identity]");
      expect(result.instructionText).not.toContain("[Location]");
      expect(result.instructionText).not.toContain("unlinked_planner_subject_name");
      expect(result.instructionText).not.toContain("Planner mountain landscape");
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_center, Path: standing stationary"
      );
      expect(result.instructionText).toContain("[Continuity]: Persistent Subjects: <Picture 1>");
    });

    it("does not leak planner subject IDs in continuity when multiple bound subject identity references exist", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["ghost_planner_subject"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        }
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "b-1",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "ref-1",
          contentHashSha256: "1".repeat(64),
          asset: {
            id: "ref-1",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/1.png",
            contentHashSha256: "1".repeat(64),
            mimeType: "image/png",
            description: "First subject"
          }
        },
        {
          bindingId: "b-2",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "subject_identity",
          referenceAssetId: "ref-2",
          contentHashSha256: "2".repeat(64),
          asset: {
            id: "ref-2",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/2.png",
            contentHashSha256: "2".repeat(64),
            mimeType: "image/png",
            description: "Second subject"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      expect(result.instructionText).not.toContain("ghost_planner_subject");
      expect(result.instructionText).toContain(
        "[Continuity]: Persistent Subjects: unspecified_subject"
      );
    });

    it("preserves explicit link to blank-description reference without substituting a second described reference", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "planner_sub_blank",
            role: "subject_identity",
            initialPosition: "screen_left",
            movementTrajectory: "standing still",
            interactionSummary: "looking down",
            referenceAssetId: "ref-blank-id"
          },
          {
            subjectId: "planner_sub_described",
            role: "subject_identity",
            initialPosition: "screen_right",
            movementTrajectory: "walking forward",
            interactionSummary: "smiling",
            referenceAssetId: "ref-desc-id"
          }
        ],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["planner_sub_blank", "planner_sub_described"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        }
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "b-1",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "subject_identity",
          referenceAssetId: "ref-blank-id",
          contentHashSha256: "1".repeat(64),
          asset: {
            id: "ref-blank-id",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/blank.png",
            contentHashSha256: "1".repeat(64),
            mimeType: "image/png",
            description: "   " // blank description
          }
        },
        {
          bindingId: "b-2",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "subject_identity",
          referenceAssetId: "ref-desc-id",
          contentHashSha256: "2".repeat(64),
          asset: {
            id: "ref-desc-id",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/desc.png",
            contentHashSha256: "2".repeat(64),
            mimeType: "image/png",
            description: "Described bride in silk wedding dress"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // Subject Identity clause contains only the described reference
      expect(result.instructionText).toContain(
        "[Subject Identity]: <Picture 2>: Described bride in silk wedding dress"
      );
      expect(result.instructionText).not.toContain("<Picture 1>:");

      // Subjects section: each subject links to its own explicitly bound reference tag
      expect(result.instructionText).toContain(
        "<Picture 1> (subject_identity): Initial: screen_left, Path: standing still, Interaction: looking down"
      );
      expect(result.instructionText).toContain(
        "<Picture 2> (subject_identity): Initial: screen_right, Path: walking forward, Interaction: smiling"
      );

      // Verify <Picture 1> was not substituted by <Picture 2> for the blank-description subject
      expect(result.instructionText).not.toContain(
        "<Picture 2> (subject_identity): Initial: screen_left"
      );

      // Planner subject wording is suppressed
      expect(result.instructionText).not.toContain("planner_sub_blank");
      expect(result.instructionText).not.toContain("planner_sub_described");

      // Continuity preserves both respective tags without unsafe substitution
      expect(result.instructionText).toContain(
        "[Continuity]: Persistent Subjects: <Picture 1>, <Picture 2>"
      );
    });

    it("leaves other reference roles (product, style, composition) and non-role prose unaffected", () => {
      const shotPlan = makeApprovedShotPlan({
        subjects: [
          {
            subjectId: "product_perfume",
            role: "product",
            initialPosition: "foreground_center",
            movementTrajectory: "rotating slowly on turntable",
            referenceAssetId: "prod-ref"
          }
        ],
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["product_perfume"],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        environmentDescription: "Glossy black reflection surface"
      });

      const references: readonly CanonicalReferenceEntry[] = [
        {
          bindingId: "b-prod",
          slotIndex: 1,
          promptTag: "<Picture 1>",
          role: "product",
          referenceAssetId: "prod-ref",
          contentHashSha256: "a".repeat(64),
          asset: {
            id: "prod-ref",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/bottle.png",
            contentHashSha256: "a".repeat(64),
            mimeType: "image/png",
            description: "Crystal flacon with gold emblem"
          }
        },
        {
          bindingId: "b-style",
          slotIndex: 2,
          promptTag: "<Picture 2>",
          role: "style",
          referenceAssetId: "style-ref",
          contentHashSha256: "b".repeat(64),
          asset: {
            id: "style-ref",
            clientId: "client-001",
            storageBucket: "cco-test",
            storageObjectKey: "refs/style.png",
            contentHashSha256: "b".repeat(64),
            mimeType: "image/png",
            description: "Commercial perfume cinematic grading"
          }
        }
      ];

      const result = compileShotPlan({ shotPlan, references });

      // No subject_identity or location clauses
      expect(result.instructionText).not.toContain("[Subject Identity]");
      expect(result.instructionText).not.toContain("[Location]");

      // Product and environment preserved as-is
      expect(result.instructionText).toContain(
        "product_perfume (product): Initial: foreground_center, Path: rotating slowly on turntable (visual reference: <Picture 1>)"
      );
      expect(result.instructionText).toContain(
        "[Environment & Lighting]: Style: natural_golden_hour | Environment: Glossy black reflection surface"
      );
      expect(result.instructionText).toContain(
        "[Continuity]: Persistent Subjects: product_perfume"
      );

      expect(result.instructionText).toContain("<Picture 1> represents product");
      expect(result.instructionText).toContain("<Picture 2> represents style");
    });
  });
});
