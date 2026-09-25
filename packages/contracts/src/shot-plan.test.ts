import { describe, it, expect } from "vitest";
import {
  MINIMAX_H3_FPS,
  MINIMAX_H3_GRID_OFFSET,
  MINIMAX_H3_GRID_STEP,
  H3_DURATION_TOLERANCE_MS,
  MINIMAX_H3_MAX_REFERENCES,
  SHOT_PLAN_ROUTING_MODES,
  ShotPlanRoutingModeSchema,
  SHOT_PLAN_STATUSES,
  ShotPlanStatusSchema,
  SHOT_FRAMINGS,
  ShotFramingSchema,
  CAMERA_ANGLES,
  CameraAngleSchema,
  CAMERA_MOVEMENTS,
  CameraMovementSchema,
  MOVEMENT_SPEEDS,
  MovementSpeedSchema,
  LIGHTING_STYLES,
  LightingStyleSchema,
  BLOCKING_INITIAL_POSITIONS,
  BlockingInitialPositionSchema,
  FRAME_ANCHOR_TARGETS,
  FrameAnchorTargetSchema,
  BLOCKING_ROLES,
  BlockingRoleSchema,
  ShotPlanSubjectBlockingSchema,
  ShotPlanTemporalBeatSchema,
  ShotPlanDialogueIntentSchema,
  ShotPlanContinuityConstraintsSchema,
  ShotPlanPrevisAssociationSchema,
  ShotPlanDocumentSchema,
  ShotPlanCreateInputSchema,
  computeH3FrameCount,
  computeH3DurationMs,
  getH3DurationWindow,
  validateShotPlanDuration
} from "./index.js";

describe("ShotPlan Contracts & Schemas", () => {
  const validSha256 = "8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b";
  const validCandidateSha = "3a4f89b0123456789abcdef0123456789abcdef0123456789abcdef012345678";

  describe("Enums & Literals", () => {
    it("accepts all canonical routing modes", () => {
      for (const mode of SHOT_PLAN_ROUTING_MODES) {
        expect(ShotPlanRoutingModeSchema.parse(mode)).toBe(mode);
      }
      expect(() => ShotPlanRoutingModeSchema.parse("unsupported")).toThrow();
    });

    it("accepts all canonical statuses", () => {
      for (const status of SHOT_PLAN_STATUSES) {
        expect(ShotPlanStatusSchema.parse(status)).toBe(status);
      }
      expect(() => ShotPlanStatusSchema.parse("deleted")).toThrow();
    });

    it("accepts all canonical shot framings", () => {
      for (const framing of SHOT_FRAMINGS) {
        expect(ShotFramingSchema.parse(framing)).toBe(framing);
      }
      expect(() => ShotFramingSchema.parse("aerial")).toThrow();
    });

    it("accepts all canonical camera angles", () => {
      for (const angle of CAMERA_ANGLES) {
        expect(CameraAngleSchema.parse(angle)).toBe(angle);
      }
      expect(() => CameraAngleSchema.parse("cantilever")).toThrow();
    });

    it("accepts all canonical camera movements", () => {
      for (const movement of CAMERA_MOVEMENTS) {
        expect(CameraMovementSchema.parse(movement)).toBe(movement);
      }
      expect(() => CameraMovementSchema.parse("flythrough")).toThrow();
    });

    it("accepts all canonical movement speeds", () => {
      for (const speed of MOVEMENT_SPEEDS) {
        expect(MovementSpeedSchema.parse(speed)).toBe(speed);
      }
      expect(() => MovementSpeedSchema.parse("ultra_fast")).toThrow();
    });

    it("accepts all canonical lighting styles", () => {
      for (const style of LIGHTING_STYLES) {
        expect(LightingStyleSchema.parse(style)).toBe(style);
      }
      expect(() => LightingStyleSchema.parse("disco_strobe")).toThrow();
    });

    it("accepts all canonical blocking positions and roles", () => {
      for (const pos of BLOCKING_INITIAL_POSITIONS) {
        expect(BlockingInitialPositionSchema.parse(pos)).toBe(pos);
      }
      for (const role of BLOCKING_ROLES) {
        expect(BlockingRoleSchema.parse(role)).toBe(role);
      }
      expect(() => BlockingInitialPositionSchema.parse("offscreen_top")).toThrow();
      expect(() => BlockingRoleSchema.parse("location")).toThrow();
    });

    it("accepts all frame anchor targets", () => {
      for (const target of FRAME_ANCHOR_TARGETS) {
        expect(FrameAnchorTargetSchema.parse(target)).toBe(target);
      }
      expect(() => FrameAnchorTargetSchema.parse("middle_frame")).toThrow();
    });
  });

  describe("Sub-schemas", () => {
    describe("ShotPlanSubjectBlockingSchema", () => {
      it("parses valid subject blocking", () => {
        const parsed = ShotPlanSubjectBlockingSchema.parse({
          subjectId: "elena_hero",
          referenceAssetId: "01923456-789a-7b3c-9d4e-5f6071829311",
          role: "subject_identity",
          initialPosition: "screen_center",
          movementTrajectory: "Static seated posture, slowly turning head towards camera",
          interactionSummary: "Holding coffee mug"
        });
        expect(parsed.subjectId).toBe("elena_hero");
        expect(parsed.role).toBe("subject_identity");
      });

      it("allows null/omitted referenceAssetId and interactionSummary", () => {
        const parsed = ShotPlanSubjectBlockingSchema.parse({
          subjectId: "background_prop",
          role: "product",
          initialPosition: "foreground_left",
          movementTrajectory: "Resting stationary on table"
        });
        expect(parsed.referenceAssetId).toBeUndefined();
        expect(parsed.interactionSummary).toBeUndefined();
      });

      it("rejects non-uuid referenceAssetId", () => {
        expect(() =>
          ShotPlanSubjectBlockingSchema.parse({
            subjectId: "elena",
            referenceAssetId: "invalid-uuid",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "Walk forward"
          })
        ).toThrow();
      });
    });

    describe("ShotPlanTemporalBeatSchema", () => {
      it("parses valid temporal beat", () => {
        const beat = {
          beatIndex: 1,
          startMs: 0,
          endMs: 1800,
          description: "Elena rests hands around warm ceramic mug",
          cameraAction: "Slow forward dolly push",
          subjectAction: "Looks down thoughtfully"
        };
        const parsed = ShotPlanTemporalBeatSchema.parse(beat);
        expect(parsed.beatIndex).toBe(1);
        expect(parsed.endMs).toBe(1800);
      });

      it("rejects beat where endMs <= startMs", () => {
        expect(() =>
          ShotPlanTemporalBeatSchema.parse({
            beatIndex: 1,
            startMs: 2000,
            endMs: 1500,
            description: "Invalid beat",
            cameraAction: "Static",
            subjectAction: "Still"
          })
        ).toThrow("endMs must be strictly greater than startMs");

        expect(() =>
          ShotPlanTemporalBeatSchema.parse({
            beatIndex: 1,
            startMs: 1000,
            endMs: 1000,
            description: "Zero duration beat",
            cameraAction: "Static",
            subjectAction: "Still"
          })
        ).toThrow("endMs must be strictly greater than startMs");
      });

      it("rejects negative startMs", () => {
        expect(() =>
          ShotPlanTemporalBeatSchema.parse({
            beatIndex: 1,
            startMs: -100,
            endMs: 1000,
            description: "Negative start",
            cameraAction: "Static",
            subjectAction: "Still"
          })
        ).toThrow();
      });
    });

    describe("ShotPlanDialogueIntentSchema", () => {
      it("parses complete dialogue intent", () => {
        const parsed = ShotPlanDialogueIntentSchema.parse({
          speaker: "Elena",
          line: "Morning begins when you choose to pause.",
          audioFxPrompt: "Gentle ceramic cup clink",
          voiceoverCue: "Cue at T+0.5s",
          deliveryEmotion: "Intimate, warm, grounded"
        });
        expect(parsed.speaker).toBe("Elena");
        expect(parsed.deliveryEmotion).toBe("Intimate, warm, grounded");
      });

      it("allows empty or nullable dialogue", () => {
        const parsed = ShotPlanDialogueIntentSchema.parse({});
        expect(parsed.speaker).toBeUndefined();
      });
    });

    describe("ShotPlanContinuityConstraintsSchema", () => {
      it("parses default continuity with 'none' anchor", () => {
        const parsed = ShotPlanContinuityConstraintsSchema.parse({
          persistentSubjectIds: ["elena_hero"]
        });
        expect(parsed.frameAnchorTarget).toBe("none");
        expect(parsed.persistentSubjectIds).toEqual(["elena_hero"]);
      });

      it("requires anchorCandidateId or anchorMediaHashSha256 when anchor target is set", () => {
        expect(() =>
          ShotPlanContinuityConstraintsSchema.parse({
            frameAnchorTarget: "first_frame"
          })
        ).toThrow("anchorCandidateId or anchorMediaHashSha256 must be provided");

        const validAnchor = ShotPlanContinuityConstraintsSchema.parse({
          frameAnchorTarget: "first_frame",
          anchorCandidateId: "01923456-789a-7b3c-9d4e-5f6071829399"
        });
        expect(validAnchor.frameAnchorTarget).toBe("first_frame");
        expect(validAnchor.anchorCandidateId).toBe("01923456-789a-7b3c-9d4e-5f6071829399");
      });
    });

    describe("ShotPlanPrevisAssociationSchema", () => {
      it("parses valid previs association", () => {
        const parsed = ShotPlanPrevisAssociationSchema.parse({
          candidateId: "01923456-789a-7b3c-9d4e-5f6071829399",
          storageBucket: "cco-previs",
          storageObjectKey: "previs/campaign-1/scene-1-cand-1.png",
          contentHashSha256: validCandidateSha,
          modelProfile: "FLUX_SCHNELL_DRAFT_V1",
          generatedAt: "2026-09-25T10:15:30.000Z",
          reviewNotes: "Composition approved by Director"
        });
        expect(parsed.candidateId).toBe("01923456-789a-7b3c-9d4e-5f6071829399");
        expect(parsed.contentHashSha256).toBe(validCandidateSha);
      });

      it("rejects invalid hash or datetime", () => {
        expect(() =>
          ShotPlanPrevisAssociationSchema.parse({
            candidateId: "01923456-789a-7b3c-9d4e-5f6071829399",
            storageBucket: "cco-previs",
            storageObjectKey: "previs/scene.png",
            contentHashSha256: "not-a-sha256",
            modelProfile: "FLUX_SCHNELL_DRAFT_V1",
            generatedAt: "invalid-date"
          })
        ).toThrow();
      });
    });
  });

  describe("ShotPlanDocumentSchema", () => {
    const fullShotPlanDoc = {
      id: "01923456-789a-7b3c-9d4e-5f60718293a1",
      sceneId: "01923456-789a-7b3c-9d4e-5f6071829300",
      specRevision: 3,
      variantOrdinal: 1,
      status: "approved" as const,
      routingMode: "reference_directed" as const,
      targetDurationMs: 5167,
      targetFrameCount: 124,
      durationToleranceMs: 355,
      fps: 24 as const,
      framing: "medium_close_up" as const,
      angle: "eye_level" as const,
      lensIntent: "50mm anamorphic prime lens, creamy bokeh, shallow depth of field",
      cameraPosition: "eye level, tripod-mounted fluid head",
      cameraMovement: "dolly_in" as const,
      movementSpeed: "slow" as const,
      cameraPromptDescription:
        "Cinematic 50mm anamorphic shot, slow smooth dolly in towards subject",
      subjects: [
        {
          subjectId: "elena_hero",
          referenceAssetId: "01923456-789a-7b3c-9d4e-5f6071829311",
          role: "subject_identity" as const,
          initialPosition: "screen_center" as const,
          movementTrajectory: "Static seated posture, slowly turning head towards camera",
          interactionSummary: "Holding coffee mug with both hands"
        }
      ],
      actionSummary: "Elena sits in a sunlit kitchen and lifts the ceramic coffee mug.",
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 5167,
          description: "Elena rests hands around warm ceramic mug and looks up.",
          cameraAction: "Slow dolly in.",
          subjectAction: "Gentle smile."
        }
      ],
      lightingStyle: "natural_golden_hour" as const,
      environmentDescription: "Warm minimalist Scandinavian kitchen, pale oak table.",
      colorPalette: ["warm amber", "matte cream", "pale oak"],
      atmosphere: "Steam gently rising from coffee",
      dialogue: {
        speaker: "Elena",
        line: "Morning begins when you pause.",
        deliveryEmotion: "Warm and intimate"
      },
      continuity: {
        frameAnchorTarget: "none" as const,
        persistentSubjectIds: ["elena_hero"]
      },
      previs: {
        candidateId: "01923456-789a-7b3c-9d4e-5f6071829399",
        storageBucket: "cco-previs",
        storageObjectKey: "previs/campaign-1/scene-1-cand-1.png",
        contentHashSha256: validSha256,
        modelProfile: "FLUX_SCHNELL_DRAFT_V1",
        generatedAt: "2026-09-25T10:15:30.000Z",
        reviewNotes: "Composition approved by Director."
      },
      machineModel: "anthropic/claude-3-5-sonnet",
      createdAt: "2026-09-25T10:20:00.000Z",
      updatedAt: "2026-09-25T10:45:00.000Z"
    };

    it("parses complete canonical ShotPlan document", () => {
      const parsed = ShotPlanDocumentSchema.parse(fullShotPlanDoc);
      expect(parsed.id).toBe(fullShotPlanDoc.id);
      expect(parsed.routingMode).toBe("reference_directed");
      expect(parsed.targetFrameCount).toBe(124);
      expect(parsed.fps).toBe(24);
      expect(parsed.subjects).toHaveLength(1);
      expect(parsed.beats).toHaveLength(1);
      expect(parsed.previs?.contentHashSha256).toBe(validSha256);
    });

    it("applies defaults for variantOrdinal, status, routingMode, durationToleranceMs, and fps", () => {
      const minimalDoc = {
        id: "01923456-789a-7b3c-9d4e-5f60718293a1",
        sceneId: "01923456-789a-7b3c-9d4e-5f6071829300",
        specRevision: 1,
        targetDurationMs: 5167,
        targetFrameCount: 124,
        framing: "wide",
        angle: "low_angle",
        lensIntent: "24mm wide angle",
        cameraPosition: "low to the floor",
        cameraMovement: "static",
        movementSpeed: "medium",
        cameraPromptDescription: "Static wide low angle view of lobby",
        actionSummary: "Character enters lobby",
        lightingStyle: "high_key_commercial",
        environmentDescription: "Modern corporate atrium",
        createdAt: "2026-09-25T10:20:00.000Z",
        updatedAt: "2026-09-25T10:20:00.000Z"
      };

      const parsed = ShotPlanDocumentSchema.parse(minimalDoc);
      expect(parsed.variantOrdinal).toBe(1);
      expect(parsed.status).toBe("draft");
      expect(parsed.routingMode).toBe("reference_directed");
      expect(parsed.durationToleranceMs).toBe(H3_DURATION_TOLERANCE_MS);
      expect(parsed.fps).toBe(24);
      expect(parsed.subjects).toEqual([]);
      expect(parsed.beats).toEqual([]);
      expect(parsed.colorPalette).toEqual([]);
      expect(parsed.continuity.frameAnchorTarget).toBe("none");
      expect(parsed.previs).toBeUndefined();
    });

    it("rejects non-uuid id or sceneId", () => {
      expect(() =>
        ShotPlanDocumentSchema.parse({
          ...fullShotPlanDoc,
          id: "not-a-uuid"
        })
      ).toThrow();
    });

    it("rejects non-positive specRevision", () => {
      expect(() =>
        ShotPlanDocumentSchema.parse({
          ...fullShotPlanDoc,
          specRevision: 0
        })
      ).toThrow();
    });
  });

  describe("ShotPlanCreateInputSchema", () => {
    it("parses valid creation input and applies defaults", () => {
      const input = {
        sceneId: "01923456-789a-7b3c-9d4e-5f6071829300",
        specRevision: 1,
        targetDurationMs: 5167,
        framing: "medium",
        angle: "eye_level",
        lensIntent: "35mm prime",
        cameraPosition: "eye level",
        cameraMovement: "pan_right",
        movementSpeed: "slow",
        cameraPromptDescription: "Smooth pan right following the subject",
        actionSummary: "Subject walks across kitchen",
        lightingStyle: "natural_golden_hour",
        environmentDescription: "Warm sunlit kitchen"
      };

      const parsed = ShotPlanCreateInputSchema.parse(input);
      expect(parsed.sceneId).toBe(input.sceneId);
      expect(parsed.routingMode).toBe("reference_directed");
      expect(parsed.fps).toBe(24);
      expect(parsed.subjects).toEqual([]);
      expect(parsed.beats).toEqual([]);
    });
  });

  describe("Quantization and Timing Helper Functions", () => {
    it("verifies H3 constants match specification", () => {
      expect(MINIMAX_H3_FPS).toBe(24);
      expect(MINIMAX_H3_GRID_OFFSET).toBe(5);
      expect(MINIMAX_H3_GRID_STEP).toBe(17);
      expect(H3_DURATION_TOLERANCE_MS).toBe(355);
      expect(MINIMAX_H3_MAX_REFERENCES).toBe(9);
    });

    describe("computeH3FrameCount", () => {
      it("computes 124 frames (k=7) for standard ~5s commercial duration", () => {
        expect(computeH3FrameCount(5167)).toBe(124);
        expect(computeH3FrameCount(5000)).toBe(124);
      });

      it("computes 5 frames (k=0) for minimum duration (~208ms)", () => {
        expect(computeH3FrameCount(208)).toBe(5);
        expect(computeH3FrameCount(100)).toBe(5);
      });

      it("computes 22 frames (k=1) for ~917ms", () => {
        expect(computeH3FrameCount(917)).toBe(22);
      });

      it("throws RangeError for non-positive or non-finite inputs", () => {
        expect(() => computeH3FrameCount(0)).toThrow(RangeError);
        expect(() => computeH3FrameCount(-500)).toThrow(RangeError);
        expect(() => computeH3FrameCount(NaN)).toThrow(RangeError);
        expect(() => computeH3FrameCount(Infinity)).toThrow(RangeError);
      });
    });

    describe("computeH3DurationMs", () => {
      it("computes exact nominal ms for given frame count", () => {
        // 124 / 24 * 1000 = 5166.666... -> 5167 ms
        expect(computeH3DurationMs(124)).toBe(5167);
        // 5 / 24 * 1000 = 208.333... -> 208 ms
        expect(computeH3DurationMs(5)).toBe(208);
      });

      it("throws RangeError for non-positive or non-finite inputs", () => {
        expect(() => computeH3DurationMs(0)).toThrow(RangeError);
        expect(() => computeH3DurationMs(-10)).toThrow(RangeError);
        expect(() => computeH3DurationMs(NaN)).toThrow(RangeError);
      });
    });

    describe("getH3DurationWindow", () => {
      it("calculates nominal and boundary tolerance window for 124 frames", () => {
        const window = getH3DurationWindow(124);
        expect(window.nominalMs).toBe(5167);
        expect(window.minMs).toBe(5167 - 355); // 4812
        expect(window.maxMs).toBe(5167 + 355); // 5522
      });
    });

    describe("validateShotPlanDuration", () => {
      it("accepts durations within tolerance of a valid H3 grid frame count", () => {
        expect(validateShotPlanDuration(5167, 124)).toBe(true);
        expect(validateShotPlanDuration(4812, 124)).toBe(true); // lower bound
        expect(validateShotPlanDuration(5522, 124)).toBe(true); // upper bound
        expect(validateShotPlanDuration(5000, 124)).toBe(true);
      });

      it("rejects durations outside tolerance of the specified frame count", () => {
        expect(validateShotPlanDuration(4811, 124)).toBe(false); // below lower bound
        expect(validateShotPlanDuration(5523, 124)).toBe(false); // above upper bound
        expect(validateShotPlanDuration(3000, 124)).toBe(false);
      });

      it("rejects frame counts that do not lie on the H3 grid (5 + 17k)", () => {
        expect(validateShotPlanDuration(5167, 120)).toBe(false); // 120 is not 5 + 17k
        expect(validateShotPlanDuration(4000, 96)).toBe(false);
        expect(validateShotPlanDuration(208, 4)).toBe(false); // less than 5
      });

      it("rejects non-positive durations or frame counts", () => {
        expect(validateShotPlanDuration(0, 124)).toBe(false);
        expect(validateShotPlanDuration(-100, 124)).toBe(false);
        expect(validateShotPlanDuration(5167, 0)).toBe(false);
        expect(validateShotPlanDuration(5167, -5)).toBe(false);
      });
    });
  });
});
