import { describe, expect, it } from "vitest";
import {
  compileShotPlanAnimaticTimeline,
  computeCameraTransformAtTime,
  evaluateEasing,
  getActiveBeatCue,
  getActiveDialogueCue,
  mapCameraMovementToMotionPlan,
  ANIMATIC_NON_PRODUCTION_NOTICE,
  ShotPlanAnimaticTimelineSchema
} from "./shot-plan-animatic.js";
import { CAMERA_MOVEMENTS, MOVEMENT_SPEEDS, BLOCKING_INITIAL_POSITIONS } from "./shot-plan.js";
import type { ShotPlanDocument } from "./shot-plan.js";
import type { ShotPlanReviewItem } from "./scene-review.js";

function createMockShotPlanDocument(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 1,
    status: "draft",
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
      },
      {
        subjectId: "product-can",
        referenceAssetId: "44444444-4444-4444-8444-444444444444",
        role: "product",
        initialPosition: "foreground_right",
        movementTrajectory: "rests on crate",
        interactionSummary: "subtle neon glint"
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
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Shard glows brighter",
        cameraAction: "hold close framing",
        subjectAction: "gaze fixes on glowing data"
      }
    ],
    dialogue: {
      speaker: "Elena",
      line: "Look at this data shard...",
      voiceoverCue: "The city never sleeps.",
      audioFxPrompt: "Cybernetic servo whir",
      deliveryEmotion: "whisper"
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
      reviewNotes: "High-contrast neon previs draft"
    },
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

function createMockShotPlanReviewItem(overrides?: Partial<ShotPlanReviewItem>): ShotPlanReviewItem {
  return {
    shotPlanId: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 1,
    status: "draft",
    routingMode: "reference_directed",
    isCurrentRevision: true,
    targetDurationMs: 4000,
    targetFrameCount: 97,
    framing: "medium_close_up",
    angle: "eye_level",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    lensIntent: "50mm prime cinematic",
    cameraPosition: "chest height, facing subject",
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
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Shard glows brighter",
        cameraAction: "hold close framing",
        subjectAction: "gaze fixes on glowing data"
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
      media: {
        available: true,
        url: "https://media.example.com/previs-1.jpg"
      },
      reviewNotes: "Previs draft"
    },
    boundReferences: [],
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

describe("ShotPlan Animatic Contracts & Deterministic Compiler", () => {
  it("maps all 14 camera movement enums to deterministic motion plans", () => {
    expect(CAMERA_MOVEMENTS).toHaveLength(14);

    for (const movement of CAMERA_MOVEMENTS) {
      const plan = mapCameraMovementToMotionPlan(movement, "medium");
      expect(plan.movement).toBe(movement);
      expect(plan.speed).toBe("medium");
      expect(plan.motionLabel.length).toBeGreaterThan(0);
      expect(plan.motionAnnotation.length).toBeGreaterThan(0);
      expect(plan.startTransform.scale).toBeGreaterThan(0);
      expect(plan.endTransform.scale).toBeGreaterThan(0);
      expect(typeof plan.visualVector.dx).toBe("number");
      expect(typeof plan.visualVector.dy).toBe("number");
      expect(plan.visualVector.type).toMatch(/^(pan|tilt|dolly|pedestal|dynamic|none)$/);
    }
  });

  it("verifies static shots maintain spatial stability across time", () => {
    const doc = createMockShotPlanDocument({ cameraMovement: "static" });
    const timeline = compileShotPlanAnimaticTimeline(doc);

    expect(timeline.camera.movement).toBe("static");
    expect(timeline.camera.startTransform).toEqual({
      scale: 1.0,
      translateXPercent: 0,
      translateYPercent: 0,
      rotateDeg: 0
    });
    expect(timeline.camera.endTransform).toEqual({
      scale: 1.0,
      translateXPercent: 0,
      translateYPercent: 0,
      rotateDeg: 0
    });

    // Check timestamps across duration: 0, 1000, 2000, 3000, 4000
    for (const t of [0, 1000, 2000, 3000, 4000]) {
      const transform = computeCameraTransformAtTime(timeline, t);
      expect(transform).toEqual({
        scale: 1.0,
        translateXPercent: 0,
        translateYPercent: 0,
        rotateDeg: 0
      });
    }
  });

  it("verifies all 4 movement speeds produce distinct cubic-bezier timing functions", () => {
    expect(MOVEMENT_SPEEDS).toHaveLength(4);

    const timingFunctions = new Set<string>();
    for (const speed of MOVEMENT_SPEEDS) {
      const plan = mapCameraMovementToMotionPlan("dolly_in", speed);
      expect(plan.easing.cssTimingFunction).toMatch(/^cubic-bezier\(/);
      timingFunctions.add(plan.easing.cssTimingFunction);
    }

    expect(timingFunctions.size).toBe(4);
  });

  it("verifies movement speed affects numerical easing progression", () => {
    const fastProgressAtQuarter = evaluateEasing("fast", 0.25);
    const slowProgressAtQuarter = evaluateEasing("slow", 0.25);

    // Fast movement accelerates immediately; slow movement eases in gently
    expect(fastProgressAtQuarter).toBeGreaterThan(slowProgressAtQuarter);
  });

  it("compiles ShotPlanDocument deterministically with exact match on repeat", () => {
    const doc = createMockShotPlanDocument();

    const timeline1 = compileShotPlanAnimaticTimeline(doc);
    const timeline2 = compileShotPlanAnimaticTimeline(doc);

    expect(timeline1).toEqual(timeline2);
    expect(timeline1.timelineId).toBe(`animatic:${doc.id}:${doc.specRevision}`);
    expect(timeline1.totalDurationMs).toBe(doc.targetDurationMs);
    expect(timeline1.targetFrameCount).toBe(doc.targetFrameCount);
    expect(timeline1.nonProductionNotice).toBe(ANIMATIC_NON_PRODUCTION_NOTICE);
    expect(timeline1.compiledAt).toBe(doc.updatedAt);

    // Validate schema
    const parseResult = ShotPlanAnimaticTimelineSchema.safeParse(timeline1);
    expect(parseResult.success).toBe(true);
  });

  it("compiles ShotPlanReviewItem with previs media and current revision status", () => {
    const item = createMockShotPlanReviewItem({
      isCurrentRevision: false
    });

    const timeline = compileShotPlanAnimaticTimeline(item);
    expect(timeline.isCurrentRevision).toBe(false);
    expect(timeline.previsMedia.available).toBe(true);
    expect(timeline.previsMedia.url).toBe("https://media.example.com/previs-1.jpg");
    expect(timeline.previsMedia.reviewNotes).toBe("Previs draft");
  });

  it("maps initial positions to 2D percentage coordinates without inventing arbitrary coordinates", () => {
    const doc = createMockShotPlanDocument();
    const timeline = compileShotPlanAnimaticTimeline(doc);

    expect(timeline.blockingVisuals).toHaveLength(2);

    // hero-1 at screen_center -> (50, 50)
    expect(timeline.blockingVisuals[0]).toEqual({
      subjectId: "hero-1",
      role: "subject_identity",
      initialPosition: "screen_center",
      anchorCoord: { xPercent: 50, yPercent: 50 },
      movementTrajectory: "stationary, raises hand",
      interactionSummary: "looks into visor"
    });

    // product-can at foreground_right -> (80, 75)
    expect(timeline.blockingVisuals[1]).toEqual({
      subjectId: "product-can",
      role: "product",
      initialPosition: "foreground_right",
      anchorCoord: { xPercent: 80, yPercent: 75 },
      movementTrajectory: "rests on crate",
      interactionSummary: "subtle neon glint"
    });

    // Check all blocking positions have defined coordinates
    for (const pos of BLOCKING_INITIAL_POSITIONS) {
      const singleSubDoc = createMockShotPlanDocument({
        subjects: [
          {
            subjectId: "test-sub",
            role: "subject_identity",
            initialPosition: pos,
            movementTrajectory: "moves"
          }
        ]
      });
      const t = compileShotPlanAnimaticTimeline(singleSubDoc);
      const visual = t.blockingVisuals[0]!;
      expect(visual.anchorCoord.xPercent).toBeGreaterThanOrEqual(0);
      expect(visual.anchorCoord.xPercent).toBeLessThanOrEqual(100);
      expect(visual.anchorCoord.yPercent).toBeGreaterThanOrEqual(0);
      expect(visual.anchorCoord.yPercent).toBeLessThanOrEqual(100);
    }
  });

  it("activates temporal beats exactly at their boundaries", () => {
    const doc = createMockShotPlanDocument();
    const timeline = compileShotPlanAnimaticTimeline(doc);

    // Beat 1: [0, 2000)
    expect(getActiveBeatCue(timeline, 0)?.beatIndex).toBe(1);
    expect(getActiveBeatCue(timeline, 1000)?.beatIndex).toBe(1);
    expect(getActiveBeatCue(timeline, 1999)?.beatIndex).toBe(1);

    // Beat 2: [2000, 4000]
    expect(getActiveBeatCue(timeline, 2000)?.beatIndex).toBe(2);
    expect(getActiveBeatCue(timeline, 3000)?.beatIndex).toBe(2);
    expect(getActiveBeatCue(timeline, 4000)?.beatIndex).toBe(2);

    // Out of bounds
    expect(getActiveBeatCue(timeline, 4001)).toBeNull();
  });

  it("extracts dialogue intent covering the full shot duration", () => {
    const doc = createMockShotPlanDocument();
    const timeline = compileShotPlanAnimaticTimeline(doc);

    expect(timeline.dialogue).not.toBeNull();
    expect(timeline.dialogue?.speaker).toBe("Elena");
    expect(timeline.dialogue?.line).toBe("Look at this data shard...");
    expect(timeline.dialogue?.voiceoverCue).toBe("The city never sleeps.");
    expect(timeline.dialogue?.audioFxPrompt).toBe("Cybernetic servo whir");
    expect(timeline.dialogue?.startMs).toBe(0);
    expect(timeline.dialogue?.endMs).toBe(4000);

    expect(getActiveDialogueCue(timeline, 0)?.speaker).toBe("Elena");
    expect(getActiveDialogueCue(timeline, 2000)?.speaker).toBe("Elena");
    expect(getActiveDialogueCue(timeline, 4000)?.speaker).toBe("Elena");
    expect(getActiveDialogueCue(timeline, 4001)).toBeNull();
  });

  it("computes reduced motion as identity transform across all timestamps", () => {
    const doc = createMockShotPlanDocument({ cameraMovement: "whip_pan" });
    const timeline = compileShotPlanAnimaticTimeline(doc);

    for (const t of [0, 1000, 2000, 3000, 4000]) {
      const transform = computeCameraTransformAtTime(timeline, t, true);
      expect(transform).toEqual({
        scale: 1.0,
        translateXPercent: 0,
        translateYPercent: 0,
        rotateDeg: 0
      });
    }
  });

  it("interpolates transforms smoothly between start and end", () => {
    const doc = createMockShotPlanDocument({
      cameraMovement: "dolly_in", // scale: 1.0 -> 1.25
      movementSpeed: "medium"
    });
    const timeline = compileShotPlanAnimaticTimeline(doc);

    const start = computeCameraTransformAtTime(timeline, 0);
    const mid = computeCameraTransformAtTime(timeline, 2000);
    const end = computeCameraTransformAtTime(timeline, 4000);

    expect(start.scale).toBe(1.0);
    expect(mid.scale).toBeGreaterThan(1.0);
    expect(mid.scale).toBeLessThan(1.25);
    expect(end.scale).toBe(1.25);
  });
});
