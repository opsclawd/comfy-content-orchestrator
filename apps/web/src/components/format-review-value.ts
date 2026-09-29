import type {
  SceneStatus,
  ReviewAction,
  ShotFraming,
  CameraAngle,
  CameraMovement,
  MovementSpeed,
  BlockingInitialPosition,
  LightingStyle
} from "@cco/contracts";

const SCENE_STATUS_LABELS: Record<SceneStatus, string> = {
  draft_pending: "Draft Pending",
  generating_candidates: "Generating Candidates",
  director_review: "Director Review",
  approved: "Approved",
  queued: "Queued",
  rendering: "Rendering",
  qa: "QA",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};

const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  approve: "Approve",
  reject: "Reject",
  reroll: "Reroll",
  prompt_edit: "Edit Prompt",
  reference_change: "Change References",
  engine_change: "Change Engine",
  duration_change: "Change Duration",
  lora_tune: "Tune LoRA",
  reorder: "Reorder",
  duplicate: "Duplicate",
  cancel: "Cancel",
  candidate_select: "Select Candidate",
  production_accept: "Accept Production",
  production_rerender: "Re-render Production",
  select_shotplan: "Select Shot Plan",
  approve_shotplan: "Approve Shot Plan",
  reroll_shotplan: "Reroll Shot Plans"
};

export function formatSceneStatus(status: SceneStatus): string {
  return SCENE_STATUS_LABELS[status] ?? status;
}

export function formatReviewAction(action: ReviewAction): string {
  return REVIEW_ACTION_LABELS[action] ?? action;
}

export function formatDurationMs(durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return `${durationMs} ms (${seconds}s)`;
}

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short"
});

export function formatDateTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    return DATE_TIME_FORMATTER.format(date);
  } catch {
    return isoString;
  }
}

export function formatShotFraming(framing: ShotFraming | string): string {
  const map: Record<string, string> = {
    extreme_wide: "Extreme Wide",
    wide: "Wide",
    full_shot: "Full Shot",
    medium_wide: "Medium Wide",
    medium: "Medium",
    medium_close_up: "Medium Close-up",
    close_up: "Close-up",
    extreme_close_up: "Extreme Close-up"
  };
  return map[framing] ?? framing.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCameraAngle(angle: CameraAngle | string): string {
  const map: Record<string, string> = {
    eye_level: "Eye Level",
    low_angle: "Low Angle",
    high_angle: "High Angle",
    bird_eye: "Bird's Eye",
    worm_eye: "Worm's Eye",
    dutch_angle: "Dutch Angle",
    over_the_shoulder: "Over The Shoulder"
  };
  return map[angle] ?? angle.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatCameraMovement(movement: CameraMovement | string): string {
  const map: Record<string, string> = {
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
  return map[movement] ?? movement.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatMovementSpeed(speed: MovementSpeed | string): string {
  const map: Record<string, string> = {
    slow: "Slow",
    medium: "Medium",
    fast: "Fast",
    variable: "Variable"
  };
  return map[speed] ?? speed.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatBlockingPosition(position: BlockingInitialPosition | string): string {
  const map: Record<string, string> = {
    screen_left: "screen left",
    screen_center: "screen center",
    screen_right: "screen right",
    foreground_left: "foreground left",
    foreground_center: "foreground center",
    foreground_right: "foreground right",
    background_center: "background center"
  };
  return map[position] ?? position.replace(/_/g, " ");
}

export function formatLightingStyle(style: LightingStyle | string): string {
  const map: Record<string, string> = {
    natural_golden_hour: "Natural Golden Hour",
    high_key_commercial: "High Key Commercial",
    low_key_dramatic: "Low Key Dramatic",
    chiaroscuro: "Chiaroscuro",
    softbox_studio: "Softbox Studio",
    neon_night: "Neon Night",
    overcast_diffused: "Overcast Diffused",
    practical_interior: "Practical Interior"
  };
  return map[style] ?? style.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatSceneSlug(sceneId?: string): string {
  if (!sceneId) return "01";
  const trimmed = sceneId.trim();
  const match = /^scene[-_\s]*(.+)$/i.exec(trimmed);
  if (match && match[1]) {
    return match[1].toUpperCase();
  }
  return trimmed.slice(0, 8).toUpperCase();
}

export function formatDurationSeconds(durationMs: number): string {
  const seconds = (durationMs / 1000).toFixed(2);
  return `${seconds} sec`;
}
