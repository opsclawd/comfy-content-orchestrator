import type {
  ShotFraming,
  CameraAngle,
  CameraMovement,
  MovementSpeed,
  BlockingInitialPosition,
  LightingStyle,
  BlockingRole,
  ShotPlanRoutingMode,
  FrameAnchorTarget,
  ShotPlanStatus
} from "./shot-plan.js";

// ============================================================================
// Canonical ShotPlan enum -> human label vocabulary.
//
// This is the single source of truth for ShotPlan enum display labels.
// apps/web/src/components/format-review-value.ts delegates to these
// accessors rather than maintaining a second copy of the same maps.
// ============================================================================

/**
 * Deterministic snake_case -> Title Case fallback for enum tokens that are
 * not present in a label map (e.g. defaulted or out-of-enum values persisted
 * by older data, see shot-plan-semantic-diff.ts R1).
 */
export function humanizeToken(token: string): string {
  return token.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const SHOT_FRAMING_LABELS: Record<ShotFraming, string> = {
  extreme_wide: "Extreme Wide",
  wide: "Wide",
  full_shot: "Full Shot",
  medium_wide: "Medium Wide",
  medium: "Medium",
  medium_close_up: "Medium Close-up",
  close_up: "Close-up",
  extreme_close_up: "Extreme Close-up"
};

export function shotFramingLabel(framing: ShotFraming | string): string {
  return SHOT_FRAMING_LABELS[framing as ShotFraming] ?? humanizeToken(framing);
}

const CAMERA_ANGLE_LABELS: Record<CameraAngle, string> = {
  eye_level: "Eye Level",
  low_angle: "Low Angle",
  high_angle: "High Angle",
  bird_eye: "Bird's Eye",
  worm_eye: "Worm's Eye",
  dutch_angle: "Dutch Angle",
  over_the_shoulder: "Over The Shoulder"
};

export function cameraAngleLabel(angle: CameraAngle | string): string {
  return CAMERA_ANGLE_LABELS[angle as CameraAngle] ?? humanizeToken(angle);
}

const CAMERA_MOVEMENT_LABELS: Record<CameraMovement, string> = {
  static: "Static",
  pan_left: "Pan Left",
  pan_right: "Pan Right",
  tilt_up: "Tilt Up",
  tilt_down: "Tilt Down",
  dolly_in: "Dolly In",
  dolly_out: "Dolly Out",
  tracking: "Tracking",
  pedestal_up: "Pedestal Up",
  pedestal_down: "Pedestal Down",
  crane: "Crane",
  arc: "Arc",
  orbit: "Orbit",
  whip_pan: "Whip Pan"
};

export function cameraMovementLabel(movement: CameraMovement | string): string {
  return CAMERA_MOVEMENT_LABELS[movement as CameraMovement] ?? humanizeToken(movement);
}

const MOVEMENT_SPEED_LABELS: Record<MovementSpeed, string> = {
  slow: "Slow",
  medium: "Medium",
  fast: "Fast",
  variable: "Variable"
};

export function movementSpeedLabel(speed: MovementSpeed | string): string {
  return MOVEMENT_SPEED_LABELS[speed as MovementSpeed] ?? humanizeToken(speed);
}

const BLOCKING_POSITION_LABELS: Record<BlockingInitialPosition, string> = {
  screen_left: "screen left",
  screen_center: "screen center",
  screen_right: "screen right",
  foreground_left: "foreground left",
  foreground_center: "foreground center",
  foreground_right: "foreground right",
  background_center: "background center"
};

export function blockingPositionLabel(position: BlockingInitialPosition | string): string {
  return (
    BLOCKING_POSITION_LABELS[position as BlockingInitialPosition] ?? position.replace(/_/g, " ")
  );
}

const LIGHTING_STYLE_LABELS: Record<LightingStyle, string> = {
  natural_golden_hour: "Natural Golden Hour",
  high_key_commercial: "High Key Commercial",
  low_key_dramatic: "Low Key Dramatic",
  chiaroscuro: "Chiaroscuro",
  softbox_studio: "Softbox Studio",
  neon_night: "Neon Night",
  overcast_diffused: "Overcast Diffused",
  practical_interior: "Practical Interior"
};

export function lightingStyleLabel(style: LightingStyle | string): string {
  return LIGHTING_STYLE_LABELS[style as LightingStyle] ?? humanizeToken(style);
}

const BLOCKING_ROLE_LABELS: Record<BlockingRole, string> = {
  subject_identity: "Subject",
  product: "Product"
};

export function blockingRoleLabel(role: BlockingRole | string): string {
  return BLOCKING_ROLE_LABELS[role as BlockingRole] ?? humanizeToken(role);
}

const ROUTING_MODE_LABELS: Record<ShotPlanRoutingMode, string> = {
  reference_directed: "Reference Directed",
  frame_anchored: "Frame Anchored"
};

export function routingModeLabel(mode: ShotPlanRoutingMode | string): string {
  return ROUTING_MODE_LABELS[mode as ShotPlanRoutingMode] ?? humanizeToken(mode);
}

const FRAME_ANCHOR_TARGET_LABELS: Record<FrameAnchorTarget, string> = {
  none: "None",
  first_frame: "First Frame",
  last_frame: "Last Frame",
  both: "Both"
};

export function frameAnchorTargetLabel(target: FrameAnchorTarget | string): string {
  return FRAME_ANCHOR_TARGET_LABELS[target as FrameAnchorTarget] ?? humanizeToken(target);
}

const SHOT_PLAN_STATUS_LABELS: Record<ShotPlanStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  superseded: "Superseded",
  rejected: "Rejected"
};

export function shotPlanStatusLabel(status: ShotPlanStatus | string): string {
  return SHOT_PLAN_STATUS_LABELS[status as ShotPlanStatus] ?? humanizeToken(status);
}

/**
 * Formats a millisecond duration as a fixed "X.XX sec" label, matching the
 * issue's mock-up (e.g. "5.17 sec").
 */
export function formatDurationSecondsLabel(durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return `${seconds} sec`;
}
