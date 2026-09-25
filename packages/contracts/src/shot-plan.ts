import { z } from "zod";
import { sha256HashSchema } from "./persistent-media.js";
import { MINIMAX_H3_FPS } from "./render-profile.js";

// ============================================================================
// H3 Quantization Constants & Timing Parameters
// ============================================================================

export const MINIMAX_H3_GRID_OFFSET = 5 as const;
export const MINIMAX_H3_GRID_STEP = 17 as const;

/**
 * Quantization tolerance window in milliseconds.
 * Equal to ceil((17 / 2 / 24) * 1000) = 355 ms (half a temporal grid step).
 */
export const H3_DURATION_TOLERANCE_MS = 355 as const;

/**
 * Maximum reference asset count allowed in reference_directed mode.
 * Enforced by the MiniMaxH3ReferenceToVideo node capacity (up to 9 ref_images).
 */
export const MINIMAX_H3_MAX_REFERENCES = 9 as const;

// ============================================================================
// Enums and Literal Sets
// ============================================================================

export const SHOT_PLAN_ROUTING_MODES = ["reference_directed", "frame_anchored"] as const;
export const ShotPlanRoutingModeSchema = z.enum(SHOT_PLAN_ROUTING_MODES);
export type ShotPlanRoutingMode = z.infer<typeof ShotPlanRoutingModeSchema>;

export const SHOT_PLAN_STATUSES = ["draft", "approved", "superseded", "rejected"] as const;
export const ShotPlanStatusSchema = z.enum(SHOT_PLAN_STATUSES);
export type ShotPlanStatus = z.infer<typeof ShotPlanStatusSchema>;

export const SHOT_FRAMINGS = [
  "extreme_wide",
  "wide",
  "full_shot",
  "medium_wide",
  "medium",
  "medium_close_up",
  "close_up",
  "extreme_close_up"
] as const;
export const ShotFramingSchema = z.enum(SHOT_FRAMINGS);
export type ShotFraming = z.infer<typeof ShotFramingSchema>;

export const CAMERA_ANGLES = [
  "eye_level",
  "low_angle",
  "high_angle",
  "bird_eye",
  "worm_eye",
  "dutch_angle",
  "over_the_shoulder"
] as const;
export const CameraAngleSchema = z.enum(CAMERA_ANGLES);
export type CameraAngle = z.infer<typeof CameraAngleSchema>;

export const CAMERA_MOVEMENTS = [
  "static",
  "pan_left",
  "pan_right",
  "tilt_up",
  "tilt_down",
  "dolly_in",
  "dolly_out",
  "tracking",
  "pedestal_up",
  "pedestal_down",
  "crane",
  "arc",
  "orbit",
  "whip_pan"
] as const;
export const CameraMovementSchema = z.enum(CAMERA_MOVEMENTS);
export type CameraMovement = z.infer<typeof CameraMovementSchema>;

export const MOVEMENT_SPEEDS = ["slow", "medium", "fast", "variable"] as const;
export const MovementSpeedSchema = z.enum(MOVEMENT_SPEEDS);
export type MovementSpeed = z.infer<typeof MovementSpeedSchema>;

export const LIGHTING_STYLES = [
  "natural_golden_hour",
  "high_key_commercial",
  "low_key_dramatic",
  "chiaroscuro",
  "softbox_studio",
  "neon_night",
  "overcast_diffused",
  "practical_interior"
] as const;
export const LightingStyleSchema = z.enum(LIGHTING_STYLES);
export type LightingStyle = z.infer<typeof LightingStyleSchema>;

export const BLOCKING_INITIAL_POSITIONS = [
  "screen_left",
  "screen_center",
  "screen_right",
  "foreground_left",
  "foreground_center",
  "foreground_right",
  "background_center"
] as const;
export const BlockingInitialPositionSchema = z.enum(BLOCKING_INITIAL_POSITIONS);
export type BlockingInitialPosition = z.infer<typeof BlockingInitialPositionSchema>;

export const FRAME_ANCHOR_TARGETS = ["none", "first_frame", "last_frame", "both"] as const;
export const FrameAnchorTargetSchema = z.enum(FRAME_ANCHOR_TARGETS);
export type FrameAnchorTarget = z.infer<typeof FrameAnchorTargetSchema>;

export const BLOCKING_ROLES = ["subject_identity", "product"] as const;
export const BlockingRoleSchema = z.enum(BLOCKING_ROLES);
export type BlockingRole = z.infer<typeof BlockingRoleSchema>;

// ============================================================================
// Sub-schemas
// ============================================================================

export const ShotPlanSubjectBlockingSchema = z.object({
  subjectId: z.string().min(1, "subjectId must not be empty"),
  referenceAssetId: z.string().uuid("referenceAssetId must be a valid UUID").nullable().optional(),
  role: BlockingRoleSchema,
  initialPosition: BlockingInitialPositionSchema,
  movementTrajectory: z.string().min(1, "movementTrajectory must not be empty"),
  interactionSummary: z.string().nullable().optional()
});
export type ShotPlanSubjectBlocking = z.infer<typeof ShotPlanSubjectBlockingSchema>;

export const ShotPlanTemporalBeatSchema = z
  .object({
    beatIndex: z.number().int().positive("beatIndex must be a positive integer"),
    startMs: z.number().int().nonnegative("startMs must be non-negative"),
    endMs: z.number().int().positive("endMs must be a positive integer"),
    description: z.string().min(1, "description must not be empty"),
    cameraAction: z.string().min(1, "cameraAction must not be empty"),
    subjectAction: z.string().min(1, "subjectAction must not be empty")
  })
  .refine((data) => data.endMs > data.startMs, {
    message: "endMs must be strictly greater than startMs",
    path: ["endMs"]
  });
export type ShotPlanTemporalBeat = z.infer<typeof ShotPlanTemporalBeatSchema>;

export const ShotPlanDialogueIntentSchema = z.object({
  speaker: z.string().nullable().optional(),
  line: z.string().nullable().optional(),
  audioFxPrompt: z.string().nullable().optional(),
  voiceoverCue: z.string().nullable().optional(),
  deliveryEmotion: z.string().nullable().optional()
});
export type ShotPlanDialogueIntent = z.infer<typeof ShotPlanDialogueIntentSchema>;

export const ShotPlanContinuityConstraintsSchema = z
  .object({
    incomingContinuityFromSceneId: z
      .string()
      .uuid("incomingContinuityFromSceneId must be a valid UUID")
      .nullable()
      .optional(),
    persistentSubjectIds: z.array(z.string().min(1)).default([]),
    lightingContinuityNote: z.string().nullable().optional(),
    frameAnchorTarget: FrameAnchorTargetSchema.default("none"),
    anchorCandidateId: z
      .string()
      .uuid("anchorCandidateId must be a valid UUID")
      .nullable()
      .optional(),
    anchorMediaHashSha256: sha256HashSchema.nullable().optional()
  })
  .superRefine((data, ctx) => {
    if (
      data.frameAnchorTarget !== "none" &&
      !data.anchorCandidateId &&
      !data.anchorMediaHashSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "anchorCandidateId or anchorMediaHashSha256 must be provided when frameAnchorTarget is not 'none'",
        path: ["anchorCandidateId"]
      });
    }
  });
export type ShotPlanContinuityConstraints = z.infer<typeof ShotPlanContinuityConstraintsSchema>;

export const ShotPlanPrevisAssociationSchema = z.object({
  candidateId: z.string().uuid("candidateId must be a valid UUID"),
  storageBucket: z.string().min(1, "storageBucket must not be empty"),
  storageObjectKey: z.string().min(1, "storageObjectKey must not be empty"),
  contentHashSha256: sha256HashSchema,
  modelProfile: z.string().min(1, "modelProfile must not be empty"),
  generatedAt: z.string().datetime({ message: "generatedAt must be a valid ISO 8601 datetime" }),
  reviewNotes: z.string().nullable().optional()
});
export type ShotPlanPrevisAssociation = z.infer<typeof ShotPlanPrevisAssociationSchema>;

// ============================================================================
// Canonical ShotPlan Document Schema
// ============================================================================

export const ShotPlanDocumentSchema = z.object({
  id: z.string().uuid("id must be a valid UUID"),
  sceneId: z.string().uuid("sceneId must be a valid UUID"),
  specRevision: z.number().int().positive("specRevision must be a positive integer"),
  variantOrdinal: z.number().int().positive("variantOrdinal must be a positive integer").default(1),
  status: ShotPlanStatusSchema.default("draft"),
  routingMode: ShotPlanRoutingModeSchema.default("reference_directed"),

  // Timing & Frame Quantification
  targetDurationMs: z.number().int().positive("targetDurationMs must be positive"),
  targetFrameCount: z.number().int().positive("targetFrameCount must be positive"),
  durationToleranceMs: z.number().int().nonnegative().default(H3_DURATION_TOLERANCE_MS),
  fps: z.literal(24).default(24),

  // Visual Framing & Camera Intent
  framing: ShotFramingSchema,
  angle: CameraAngleSchema,
  lensIntent: z.string().min(1, "lensIntent must not be empty"),
  cameraPosition: z.string().min(1, "cameraPosition must not be empty"),
  cameraMovement: CameraMovementSchema,
  movementSpeed: MovementSpeedSchema,
  cameraPromptDescription: z.string().min(1, "cameraPromptDescription must not be empty"),

  // Staging & Blocking
  subjects: z.array(ShotPlanSubjectBlockingSchema).default([]),
  actionSummary: z.string().min(1, "actionSummary must not be empty"),
  beats: z.array(ShotPlanTemporalBeatSchema).default([]),

  // Environment & Lighting
  lightingStyle: LightingStyleSchema,
  environmentDescription: z.string().min(1, "environmentDescription must not be empty"),
  colorPalette: z.array(z.string().min(1)).default([]),
  atmosphere: z.string().nullable().optional(),

  // Optional Dialogue & Performance
  dialogue: ShotPlanDialogueIntentSchema.nullable().optional(),

  // Explicit Continuity Fencing
  continuity: ShotPlanContinuityConstraintsSchema.default({
    incomingContinuityFromSceneId: null,
    persistentSubjectIds: [],
    lightingContinuityNote: null,
    frameAnchorTarget: "none",
    anchorCandidateId: null,
    anchorMediaHashSha256: null
  }),

  // Optional Previs Association
  previs: ShotPlanPrevisAssociationSchema.nullable().optional(),

  // Metadata & Timestamps
  machineModel: z.string().nullable().optional(),
  createdAt: z.string().datetime({ message: "createdAt must be a valid ISO 8601 datetime" }),
  updatedAt: z.string().datetime({ message: "updatedAt must be a valid ISO 8601 datetime" })
});
export type ShotPlanDocument = z.infer<typeof ShotPlanDocumentSchema>;

// ============================================================================
// Input & Creation Schemas
// ============================================================================

export const ShotPlanCreateInputSchema = z.object({
  sceneId: z.string().uuid("sceneId must be a valid UUID"),
  specRevision: z.number().int().positive("specRevision must be a positive integer"),
  variantOrdinal: z.number().int().positive("variantOrdinal must be a positive integer").optional(),
  routingMode: ShotPlanRoutingModeSchema.optional().default("reference_directed"),

  targetDurationMs: z.number().int().positive("targetDurationMs must be positive"),
  targetFrameCount: z.number().int().positive().optional(),
  durationToleranceMs: z.number().int().nonnegative().optional(),
  fps: z.literal(24).optional().default(24),

  framing: ShotFramingSchema,
  angle: CameraAngleSchema,
  lensIntent: z.string().min(1, "lensIntent must not be empty"),
  cameraPosition: z.string().min(1, "cameraPosition must not be empty"),
  cameraMovement: CameraMovementSchema,
  movementSpeed: MovementSpeedSchema,
  cameraPromptDescription: z.string().min(1, "cameraPromptDescription must not be empty"),

  subjects: z.array(ShotPlanSubjectBlockingSchema).optional().default([]),
  actionSummary: z.string().min(1, "actionSummary must not be empty"),
  beats: z.array(ShotPlanTemporalBeatSchema).optional().default([]),

  lightingStyle: LightingStyleSchema,
  environmentDescription: z.string().min(1, "environmentDescription must not be empty"),
  colorPalette: z.array(z.string().min(1)).optional().default([]),
  atmosphere: z.string().nullable().optional(),

  dialogue: ShotPlanDialogueIntentSchema.nullable().optional(),
  continuity: ShotPlanContinuityConstraintsSchema.optional().default({
    incomingContinuityFromSceneId: null,
    persistentSubjectIds: [],
    lightingContinuityNote: null,
    frameAnchorTarget: "none",
    anchorCandidateId: null,
    anchorMediaHashSha256: null
  }),
  previs: ShotPlanPrevisAssociationSchema.nullable().optional(),
  machineModel: z.string().nullable().optional()
});
export type ShotPlanCreateInput = z.infer<typeof ShotPlanCreateInputSchema>;

// ============================================================================
// Timing & Quantization Helper Functions
// ============================================================================

/**
 * Computes the nearest H3-quantized frame count (frames = 5 + 17k) for a given duration in ms at 24 FPS.
 */
export function computeH3FrameCount(targetDurationMs: number): number {
  if (targetDurationMs <= 0 || !Number.isFinite(targetDurationMs)) {
    throw new RangeError("targetDurationMs must be a positive finite number");
  }
  const estimatedFrames = (targetDurationMs * MINIMAX_H3_FPS) / 1000;
  const k = Math.max(
    0,
    Math.round((estimatedFrames - MINIMAX_H3_GRID_OFFSET) / MINIMAX_H3_GRID_STEP)
  );
  return MINIMAX_H3_GRID_OFFSET + k * MINIMAX_H3_GRID_STEP;
}

/**
 * Computes the nominal duration in milliseconds for an H3 frame count at 24 FPS.
 */
export function computeH3DurationMs(frameCount: number): number {
  if (frameCount <= 0 || !Number.isFinite(frameCount)) {
    throw new RangeError("frameCount must be a positive finite number");
  }
  return Math.round((frameCount / MINIMAX_H3_FPS) * 1000);
}

/**
 * Computes the acceptable duration window for an H3 frame count.
 */
export function getH3DurationWindow(
  frameCount: number,
  toleranceMs: number = H3_DURATION_TOLERANCE_MS
): { minMs: number; nominalMs: number; maxMs: number } {
  const nominalMs = computeH3DurationMs(frameCount);
  return {
    minMs: Math.max(0, nominalMs - toleranceMs),
    nominalMs,
    maxMs: nominalMs + toleranceMs
  };
}

/**
 * Validates whether a target duration in ms and target frame count adhere to H3 quantization rules.
 * Frame count must equal 5 + 17k (k >= 0), and duration must be within tolerance of the nominal frame duration.
 */
export function validateShotPlanDuration(
  targetDurationMs: number,
  targetFrameCount: number,
  toleranceMs: number = H3_DURATION_TOLERANCE_MS
): boolean {
  if (targetDurationMs <= 0 || targetFrameCount < MINIMAX_H3_GRID_OFFSET) {
    return false;
  }
  const k = (targetFrameCount - MINIMAX_H3_GRID_OFFSET) / MINIMAX_H3_GRID_STEP;
  if (!Number.isInteger(k) || k < 0) {
    return false;
  }
  const nominalMs = computeH3DurationMs(targetFrameCount);
  return Math.abs(targetDurationMs - nominalMs) <= toleranceMs;
}
