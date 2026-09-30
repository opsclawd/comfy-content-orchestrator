import { z } from "zod";
import {
  CameraMovementSchema,
  MovementSpeedSchema,
  BlockingInitialPositionSchema,
  BlockingRoleSchema,
  ShotPlanStatusSchema,
  ShotPlanRoutingModeSchema
} from "./shot-plan.js";
import type {
  CameraMovement,
  MovementSpeed,
  BlockingInitialPosition,
  ShotPlanDocument,
  ShotPlanTemporalBeat
} from "./shot-plan.js";
import type { ShotPlanReviewItem } from "./scene-review.js";

// ============================================================================
// Schemas for Deterministic ShotPlan Animatic Timeline
// ============================================================================

export const CameraTransformStateSchema = z.object({
  scale: z.number().positive(),
  translateXPercent: z.number(),
  translateYPercent: z.number(),
  rotateDeg: z.number()
});
export type CameraTransformState = z.infer<typeof CameraTransformStateSchema>;

export const CameraEasingConfigSchema = z.object({
  speed: MovementSpeedSchema,
  cssTimingFunction: z.string().min(1),
  description: z.string().min(1)
});
export type CameraEasingConfig = z.infer<typeof CameraEasingConfigSchema>;

export const CameraMotionPlanSchema = z.object({
  movement: CameraMovementSchema,
  speed: MovementSpeedSchema,
  easing: CameraEasingConfigSchema,
  startTransform: CameraTransformStateSchema,
  endTransform: CameraTransformStateSchema,
  motionLabel: z.string().min(1),
  motionAnnotation: z.string().min(1),
  visualVector: z.object({
    dx: z.number(),
    dy: z.number(),
    type: z.enum(["pan", "tilt", "dolly", "pedestal", "dynamic", "none"])
  })
});
export type CameraMotionPlan = z.infer<typeof CameraMotionPlanSchema>;

export const AnimaticTemporalBeatCueSchema = z.object({
  beatIndex: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  description: z.string().min(1),
  cameraAction: z.string().min(1),
  subjectAction: z.string().min(1)
});
export type AnimaticTemporalBeatCue = z.infer<typeof AnimaticTemporalBeatCueSchema>;

export const AnimaticDialogueCueSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  speaker: z.string().nullable(),
  line: z.string().nullable(),
  voiceoverCue: z.string().nullable(),
  audioFxPrompt: z.string().nullable()
});
export type AnimaticDialogueCue = z.infer<typeof AnimaticDialogueCueSchema>;

export const AnimaticSubjectBlockingVisualSchema = z.object({
  subjectId: z.string().min(1),
  role: BlockingRoleSchema,
  initialPosition: BlockingInitialPositionSchema,
  anchorCoord: z.object({
    xPercent: z.number().min(0).max(100),
    yPercent: z.number().min(0).max(100)
  }),
  movementTrajectory: z.string().min(1),
  interactionSummary: z.string().nullable()
});
export type AnimaticSubjectBlockingVisual = z.infer<typeof AnimaticSubjectBlockingVisualSchema>;

export const ShotPlanAnimaticTimelineSchema = z.object({
  timelineId: z.string().min(1),
  shotPlanId: z.string().uuid(),
  sceneId: z.string().uuid(),
  specRevision: z.number().int().positive(),
  variantOrdinal: z.number().int().positive(),
  isCurrentRevision: z.boolean(),
  status: ShotPlanStatusSchema,
  routingMode: ShotPlanRoutingModeSchema,

  // Exact Timing
  totalDurationMs: z.number().int().positive(),
  targetFrameCount: z.number().int().positive(),
  fps: z.literal(24),

  // Motion & Cues
  camera: CameraMotionPlanSchema,
  beats: z.array(AnimaticTemporalBeatCueSchema),
  dialogue: AnimaticDialogueCueSchema.nullable(),
  blockingVisuals: z.array(AnimaticSubjectBlockingVisualSchema),

  // Previs Media Reference
  previsMedia: z.object({
    available: z.boolean(),
    url: z.string().nullable(),
    candidateId: z.string().nullable(),
    reviewNotes: z.string().nullable()
  }),

  nonProductionNotice: z.string().min(1),
  compiledAt: z.string()
});
export type ShotPlanAnimaticTimeline = z.infer<typeof ShotPlanAnimaticTimelineSchema>;

// ============================================================================
// Constants and Mappings
// ============================================================================

export const ANIMATIC_NON_PRODUCTION_NOTICE =
  "STORYBOARD ANIMATIC — NON-PRODUCTION PLANNING PREVIEW" as const;

export const SPEED_EASING_DEFINITIONS: Record<
  MovementSpeed,
  {
    readonly cssTimingFunction: string;
    readonly description: string;
    readonly bezier: readonly [number, number, number, number];
  }
> = {
  slow: {
    cssTimingFunction: "cubic-bezier(0.25, 0.1, 0.25, 1.0)",
    description: "Gradual ramp & smooth deceleration (contemplative pacing)",
    bezier: [0.25, 0.1, 0.25, 1.0]
  },
  medium: {
    cssTimingFunction: "cubic-bezier(0.42, 0.0, 0.58, 1.0)",
    description: "Symmetric standard cinematic ease (narrative pacing)",
    bezier: [0.42, 0.0, 0.58, 1.0]
  },
  fast: {
    cssTimingFunction: "cubic-bezier(0.1, 0.9, 0.2, 1.0)",
    description: "Immediate steep acceleration (dynamic action pacing)",
    bezier: [0.1, 0.9, 0.2, 1.0]
  },
  variable: {
    cssTimingFunction: "cubic-bezier(0.65, 0.0, 0.35, 1.0)",
    description: "S-curve with mid-shot inflection (beat-responsive tempo transition)",
    bezier: [0.65, 0.0, 0.35, 1.0]
  }
};

export const BLOCKING_POSITION_COORDINATES: Record<
  BlockingInitialPosition,
  { readonly xPercent: number; readonly yPercent: number }
> = {
  screen_left: { xPercent: 20, yPercent: 50 },
  screen_center: { xPercent: 50, yPercent: 50 },
  screen_right: { xPercent: 80, yPercent: 50 },
  foreground_left: { xPercent: 20, yPercent: 75 },
  foreground_center: { xPercent: 50, yPercent: 75 },
  foreground_right: { xPercent: 80, yPercent: 75 },
  background_center: { xPercent: 50, yPercent: 25 }
};

interface MotionMappingDefinition {
  readonly startTransform: CameraTransformState;
  readonly endTransform: CameraTransformState;
  readonly motionLabel: string;
  readonly motionAnnotation: string;
  readonly visualVector: {
    readonly dx: number;
    readonly dy: number;
    readonly type: "pan" | "tilt" | "dolly" | "pedestal" | "dynamic" | "none";
  };
}

export const CAMERA_MOTION_DEFINITIONS: Record<CameraMovement, MotionMappingDefinition> = {
  static: {
    startTransform: { scale: 1.0, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.0, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Static / Locked-off",
    motionAnnotation: "Locked-off tripod shot; spatially stable viewport. Zero transform drift.",
    visualVector: { dx: 0, dy: 0, type: "none" }
  },
  pan_left: {
    startTransform: { scale: 1.1, translateXPercent: -6, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: 6, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Pan Left",
    motionAnnotation:
      "Horizontal camera swivel scanning left, revealing the left side of the scene (content translates left-to-right as the viewport moves left).",
    visualVector: { dx: -1, dy: 0, type: "pan" }
  },
  pan_right: {
    startTransform: { scale: 1.1, translateXPercent: 6, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: -6, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Pan Right",
    motionAnnotation:
      "Horizontal camera swivel scanning right, revealing the right side of the scene (content translates right-to-left as the viewport moves right).",
    visualVector: { dx: 1, dy: 0, type: "pan" }
  },
  tilt_up: {
    startTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: -6, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: 6, rotateDeg: 0 },
    motionLabel: "Tilt Up",
    motionAnnotation:
      "Vertical camera tilt scanning upward, revealing the upper field of view (content translates upward as the viewport tilts up).",
    visualVector: { dx: 0, dy: -1, type: "tilt" }
  },
  tilt_down: {
    startTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: 6, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: -6, rotateDeg: 0 },
    motionLabel: "Tilt Down",
    motionAnnotation:
      "Vertical camera tilt scanning downward, revealing the lower field of view (content translates downward as the viewport tilts down).",
    visualVector: { dx: 0, dy: 1, type: "tilt" }
  },
  dolly_in: {
    startTransform: { scale: 1.0, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.25, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Dolly In / Push In",
    motionAnnotation: "Controlled axial zoom/push-in toward subject focal point.",
    visualVector: { dx: 0, dy: 0, type: "dolly" }
  },
  dolly_out: {
    startTransform: { scale: 1.25, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.0, translateXPercent: 0, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Dolly Out / Pull Out",
    motionAnnotation: "Controlled axial pull-out widening to reveal surrounding environment.",
    visualVector: { dx: 0, dy: 0, type: "dolly" }
  },
  tracking: {
    startTransform: { scale: 1.15, translateXPercent: -8, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.15, translateXPercent: 8, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Tracking Shot",
    motionAnnotation: "Lateral tracking movement following subject trajectory across frame.",
    visualVector: { dx: 1, dy: 0, type: "pan" }
  },
  pedestal_up: {
    startTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: 8, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: -8, rotateDeg: 0 },
    motionLabel: "Pedestal Up",
    motionAnnotation: "Vertical camera pedestal elevating physical viewpoint upward.",
    visualVector: { dx: 0, dy: 1, type: "pedestal" }
  },
  pedestal_down: {
    startTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: -8, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: 0, translateYPercent: 8, rotateDeg: 0 },
    motionLabel: "Pedestal Down",
    motionAnnotation: "Vertical camera pedestal descending physical viewpoint downward.",
    visualVector: { dx: 0, dy: -1, type: "pedestal" }
  },
  crane: {
    startTransform: { scale: 1.05, translateXPercent: 0, translateYPercent: 8, rotateDeg: 0 },
    endTransform: { scale: 1.2, translateXPercent: 0, translateYPercent: -8, rotateDeg: 0 },
    motionLabel: "Crane / Jib Shot",
    motionAnnotation: "Compound jib/crane motion combining vertical lift with depth shift.",
    visualVector: { dx: 0, dy: 1, type: "dynamic" }
  },
  arc: {
    startTransform: { scale: 1.12, translateXPercent: -6, translateYPercent: 2, rotateDeg: -2 },
    endTransform: { scale: 1.12, translateXPercent: 6, translateYPercent: -2, rotateDeg: 2 },
    motionLabel: "Arc Shot",
    motionAnnotation: "Curved arc tracking with subtle perspective rotation around focal center.",
    visualVector: { dx: 1, dy: 0, type: "dynamic" }
  },
  orbit: {
    startTransform: { scale: 1.15, translateXPercent: -8, translateYPercent: 0, rotateDeg: -3 },
    endTransform: { scale: 1.15, translateXPercent: 8, translateYPercent: 0, rotateDeg: 3 },
    motionLabel: "Orbit / 360 Sweep",
    motionAnnotation: "Rotational sweep around subject center with angular rotational cue.",
    visualVector: { dx: 1, dy: 0, type: "dynamic" }
  },
  whip_pan: {
    startTransform: { scale: 1.1, translateXPercent: -12, translateYPercent: 0, rotateDeg: 0 },
    endTransform: { scale: 1.1, translateXPercent: 12, translateYPercent: 0, rotateDeg: 0 },
    motionLabel: "Whip Pan",
    motionAnnotation: "High-velocity snap pan with aggressive acceleration.",
    visualVector: { dx: 1, dy: 0, type: "pan" }
  }
};

// ============================================================================
// Pure Mathematics & Cubic Bezier Solvers
// ============================================================================

/**
 * Solve cubic bezier parameter u for a given normalized time t in [0, 1].
 */
export function solveCubicBezierU(x1: number, x2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  // Newton-Raphson iterations
  let u = t;
  for (let i = 0; i < 8; i++) {
    const currentX = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    const diff = currentX - t;
    if (Math.abs(diff) < 1e-6) {
      return u;
    }
    const dX = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);
    if (Math.abs(dX) < 1e-6) {
      break;
    }
    u = u - diff / dX;
    u = Math.max(0, Math.min(1, u));
  }

  // Bisection fallback
  let low = 0;
  let high = 1;
  u = t;
  while (high - low > 1e-6) {
    const currentX = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    if (Math.abs(currentX - t) < 1e-6) {
      return u;
    }
    if (currentX < t) {
      low = u;
    } else {
      high = u;
    }
    u = (low + high) / 2;
  }
  return u;
}

/**
 * Evaluate cubic bezier output y for normalized input t in [0, 1].
 */
export function evaluateCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number
): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = solveCubicBezierU(x1, x2, t);
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
}

/**
 * Evaluates the deterministic progress easing for a given movement speed.
 */
export function evaluateEasing(speed: MovementSpeed, progress: number): number {
  const config = SPEED_EASING_DEFINITIONS[speed] ?? SPEED_EASING_DEFINITIONS.medium;
  const [x1, y1, x2, y2] = config.bezier;
  return evaluateCubicBezier(x1, y1, x2, y2, Math.max(0, Math.min(1, progress)));
}

// ============================================================================
// Compiler Functions
// ============================================================================

export function mapCameraMovementToMotionPlan(
  movement: CameraMovement,
  speed: MovementSpeed
): CameraMotionPlan {
  const motionDef = CAMERA_MOTION_DEFINITIONS[movement] ?? CAMERA_MOTION_DEFINITIONS.static;
  const easingDef = SPEED_EASING_DEFINITIONS[speed] ?? SPEED_EASING_DEFINITIONS.medium;

  return {
    movement,
    speed,
    easing: {
      speed,
      cssTimingFunction: easingDef.cssTimingFunction,
      description: easingDef.description
    },
    startTransform: { ...motionDef.startTransform },
    endTransform: { ...motionDef.endTransform },
    motionLabel: motionDef.motionLabel,
    motionAnnotation: motionDef.motionAnnotation,
    visualVector: { ...motionDef.visualVector }
  };
}

export interface CompileAnimaticOptions {
  readonly isCurrentRevision?: boolean;
}

/**
 * Pure deterministic compiler that converts a ShotPlanDocument or ShotPlanReviewItem
 * into an immutable ShotPlanAnimaticTimeline.
 */
export function compileShotPlanAnimaticTimeline(
  plan: ShotPlanDocument | ShotPlanReviewItem,
  options?: CompileAnimaticOptions
): ShotPlanAnimaticTimeline {
  const shotPlanId =
    "shotPlanId" in plan && typeof plan.shotPlanId === "string"
      ? plan.shotPlanId
      : (plan as ShotPlanDocument).id;

  const isCurrentRevision =
    "isCurrentRevision" in plan && typeof plan.isCurrentRevision === "boolean"
      ? plan.isCurrentRevision
      : (options?.isCurrentRevision ?? true);

  const compiledAt = plan.updatedAt ?? plan.createdAt;

  const camera = mapCameraMovementToMotionPlan(plan.cameraMovement, plan.movementSpeed);

  const beats: AnimaticTemporalBeatCue[] = (plan.beats ?? []).map((beat: ShotPlanTemporalBeat) => ({
    beatIndex: beat.beatIndex,
    startMs: beat.startMs,
    endMs: beat.endMs,
    description: beat.description,
    cameraAction: beat.cameraAction,
    subjectAction: beat.subjectAction
  }));

  let dialogue: AnimaticDialogueCue | null = null;
  if (
    plan.dialogue &&
    (plan.dialogue.speaker ||
      plan.dialogue.line ||
      plan.dialogue.voiceoverCue ||
      plan.dialogue.audioFxPrompt)
  ) {
    dialogue = {
      startMs: 0,
      endMs: plan.targetDurationMs,
      speaker: plan.dialogue.speaker ?? null,
      line: plan.dialogue.line ?? null,
      voiceoverCue: plan.dialogue.voiceoverCue ?? null,
      audioFxPrompt: plan.dialogue.audioFxPrompt ?? null
    };
  }

  const blockingVisuals: AnimaticSubjectBlockingVisual[] = (plan.subjects ?? []).map((sub) => {
    const coords =
      BLOCKING_POSITION_COORDINATES[sub.initialPosition] ??
      BLOCKING_POSITION_COORDINATES.screen_center;
    return {
      subjectId: sub.subjectId,
      role: sub.role,
      initialPosition: sub.initialPosition,
      anchorCoord: { xPercent: coords.xPercent, yPercent: coords.yPercent },
      movementTrajectory: sub.movementTrajectory,
      interactionSummary: sub.interactionSummary ?? null
    };
  });

  let previsMedia = {
    available: false,
    url: null as string | null,
    candidateId: null as string | null,
    reviewNotes: null as string | null
  };

  if (plan.previs) {
    const p = plan.previs as Record<string, unknown>;
    const candidateId = (p.candidateId as string | undefined) ?? null;
    const reviewNotes = (p.reviewNotes as string | undefined) ?? null;

    if (p.media && typeof p.media === "object") {
      const media = p.media as { available?: boolean; url?: string };
      const available = Boolean(media.available && media.url);
      previsMedia = {
        available,
        url: available ? (media.url ?? null) : null,
        candidateId,
        reviewNotes
      };
    } else {
      previsMedia = {
        available: false,
        url: null,
        candidateId,
        reviewNotes
      };
    }
  }

  return {
    timelineId: `animatic:${shotPlanId}:${plan.specRevision}`,
    shotPlanId,
    sceneId: plan.sceneId,
    specRevision: plan.specRevision,
    variantOrdinal: plan.variantOrdinal ?? 1,
    isCurrentRevision,
    status: plan.status,
    routingMode: plan.routingMode,
    totalDurationMs: plan.targetDurationMs,
    targetFrameCount: plan.targetFrameCount,
    fps: 24,
    camera,
    beats,
    dialogue,
    blockingVisuals,
    previsMedia,
    nonProductionNotice: ANIMATIC_NON_PRODUCTION_NOTICE,
    compiledAt
  };
}

/**
 * Computes the interpolated camera transform for a given millisecond timestamp.
 */
export function computeCameraTransformAtTime(
  timeline: ShotPlanAnimaticTimeline,
  currentMs: number,
  reducedMotion: boolean = false
): CameraTransformState {
  if (reducedMotion) {
    return {
      scale: 1.0,
      translateXPercent: 0,
      translateYPercent: 0,
      rotateDeg: 0
    };
  }

  const duration = Math.max(1, timeline.totalDurationMs);
  const normalized = Math.max(0, Math.min(1, currentMs / duration));
  const eased = evaluateEasing(timeline.camera.speed, normalized);

  const start = timeline.camera.startTransform;
  const end = timeline.camera.endTransform;

  return {
    scale: Number((start.scale + eased * (end.scale - start.scale)).toFixed(4)),
    translateXPercent: Number(
      (start.translateXPercent + eased * (end.translateXPercent - start.translateXPercent)).toFixed(
        4
      )
    ),
    translateYPercent: Number(
      (start.translateYPercent + eased * (end.translateYPercent - start.translateYPercent)).toFixed(
        4
      )
    ),
    rotateDeg: Number((start.rotateDeg + eased * (end.rotateDeg - start.rotateDeg)).toFixed(4))
  };
}

/**
 * Returns the currently active temporal beat cue at the specified timestamp.
 */
export function getActiveBeatCue(
  timeline: ShotPlanAnimaticTimeline,
  currentMs: number
): AnimaticTemporalBeatCue | null {
  const atEnd = currentMs >= timeline.totalDurationMs;
  for (const beat of timeline.beats) {
    if (currentMs >= beat.startMs && (atEnd ? currentMs <= beat.endMs : currentMs < beat.endMs)) {
      return beat;
    }
  }
  return null;
}

/**
 * Returns the active dialogue cue at the specified timestamp.
 */
export function getActiveDialogueCue(
  timeline: ShotPlanAnimaticTimeline,
  currentMs: number
): AnimaticDialogueCue | null {
  if (!timeline.dialogue) {
    return null;
  }
  if (currentMs >= timeline.dialogue.startMs && currentMs <= timeline.dialogue.endMs) {
    return timeline.dialogue;
  }
  return null;
}
