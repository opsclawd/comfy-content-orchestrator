import {
  CAMERA_ANGLES,
  CAMERA_MOVEMENTS,
  LIGHTING_STYLES,
  MOVEMENT_SPEEDS,
  SHOT_FRAMINGS,
  type CameraAngle,
  type CameraMovement,
  type LightingStyle,
  type MovementSpeed,
  type ShotFraming,
  type ShotPlanContinuityConstraints,
  type ShotPlanDialogueIntent,
  type ShotPlanSubjectBlocking,
  type ShotPlanTemporalBeat
} from "@cco/domain";
import { parsePlanningResponse } from "./planning-response-parser.js";
import { ShotPlanValidationError } from "./plan-shot-plans-errors.js";

export interface ShotPlanProposal {
  readonly framing: ShotFraming;
  readonly angle: CameraAngle;
  readonly cameraMovement: CameraMovement;
  readonly movementSpeed: MovementSpeed;
  readonly lensIntent: string;
  readonly cameraPosition: string;
  readonly cameraPromptDescription: string;
  readonly actionSummary: string;
  readonly beats: readonly ShotPlanTemporalBeat[];
  readonly lightingStyle: LightingStyle;
  readonly environmentDescription: string;
  readonly colorPalette: readonly string[];
  readonly atmosphere?: string | null;
  readonly subjects: readonly ShotPlanSubjectBlocking[];
  readonly dialogue?: ShotPlanDialogueIntent | null;
  readonly continuity?: ShotPlanContinuityConstraints | null;
}

export function parseShotPlanResponse(rawText: string): readonly ShotPlanProposal[] {
  const parsed = parsePlanningResponse(rawText);
  if (!parsed.ok) {
    throw new ShotPlanValidationError(parsed.reason);
  }

  const raw = parsed.value;
  let items: unknown[];

  if (Array.isArray(raw)) {
    items = raw;
  } else if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.variants)) {
      items = obj.variants;
    } else if (Array.isArray(obj.shotPlans)) {
      items = obj.shotPlans;
    } else if (Array.isArray(obj.shots)) {
      items = obj.shots;
    } else {
      throw new ShotPlanValidationError(
        "Expected response to be an array of shot plans or an object with 'variants' or 'shotPlans' array."
      );
    }
  } else {
    throw new ShotPlanValidationError("Expected JSON response to be an array or object.");
  }

  if (items.length === 0) {
    throw new ShotPlanValidationError("Shot plan response contained 0 variants.");
  }

  return items.map((item, index) => validateShotPlanProposal(item, index + 1));
}

function normalizeFraming(value: unknown): ShotFraming | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase().replace(/-/g, "_");
  if (SHOT_FRAMINGS.includes(s as ShotFraming)) return s as ShotFraming;
  if (s === "wide_shot") return "wide";
  if (s === "medium_shot") return "medium";
  if (s === "close" || s === "closeup") return "close_up";
  return undefined;
}

function normalizeAngle(value: unknown): CameraAngle | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase().replace(/-/g, "_");
  if (CAMERA_ANGLES.includes(s as CameraAngle)) return s as CameraAngle;
  if (s === "eye" || s === "neutral") return "eye_level";
  if (s === "low") return "low_angle";
  if (s === "high") return "high_angle";
  if (s === "dutch") return "dutch_angle";
  return undefined;
}

function normalizeCameraMovement(value: unknown): CameraMovement | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase().replace(/-/g, "_");
  if (CAMERA_MOVEMENTS.includes(s as CameraMovement)) return s as CameraMovement;
  if (s === "track") return "tracking";
  if (s === "pan") return "pan_right";
  if (s === "push_in" || s === "zoom_in" || s === "dolly") return "dolly_in";
  if (s === "pull_out" || s === "zoom_out") return "dolly_out";
  if (s === "tilt") return "tilt_up";
  if (s === "pedestal") return "pedestal_up";
  return undefined;
}

function normalizeMovementSpeed(value: unknown): MovementSpeed | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase();
  if (MOVEMENT_SPEEDS.includes(s as MovementSpeed)) return s as MovementSpeed;
  if (s === "normal" || s === "moderate" || s === "standard" || s === "static") return "medium";
  return undefined;
}

function normalizeLightingStyle(value: unknown): LightingStyle | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase().replace(/-/g, "_");
  if (LIGHTING_STYLES.includes(s as LightingStyle)) return s as LightingStyle;
  if (s === "natural" || s === "golden_hour") return "natural_golden_hour";
  if (s === "high_key") return "high_key_commercial";
  if (s === "low_key" || s === "dramatic") return "low_key_dramatic";
  if (s === "neon") return "neon_night";
  if (s === "studio" || s === "softbox") return "softbox_studio";
  if (s === "diffused" || s === "overcast") return "overcast_diffused";
  if (s === "interior" || s === "practical") return "practical_interior";
  return undefined;
}

function validateShotPlanProposal(item: unknown, variantOrdinal: number): ShotPlanProposal {
  if (typeof item !== "object" || item === null) {
    throw new ShotPlanValidationError(`Variant ${variantOrdinal} must be a JSON object.`);
  }

  const raw = item as Record<string, unknown>;

  const framing = normalizeFraming(raw.framing ?? "medium");
  if (!framing) {
    throw new ShotPlanValidationError(
      `Variant ${variantOrdinal} has invalid framing '${raw.framing}'. Must be one of: ${SHOT_FRAMINGS.join(", ")}`
    );
  }

  const angle = normalizeAngle(raw.angle ?? raw.cameraAngle ?? "eye_level");
  if (!angle) {
    throw new ShotPlanValidationError(
      `Variant ${variantOrdinal} has invalid angle '${raw.angle ?? raw.cameraAngle}'. Must be one of: ${CAMERA_ANGLES.join(", ")}`
    );
  }

  const cameraMovement = normalizeCameraMovement(raw.cameraMovement ?? "static");
  if (!cameraMovement) {
    throw new ShotPlanValidationError(
      `Variant ${variantOrdinal} has invalid cameraMovement '${raw.cameraMovement}'. Must be one of: ${CAMERA_MOVEMENTS.join(", ")}`
    );
  }

  const movementSpeed = normalizeMovementSpeed(raw.movementSpeed ?? "medium");
  if (!movementSpeed) {
    throw new ShotPlanValidationError(
      `Variant ${variantOrdinal} has invalid movementSpeed '${raw.movementSpeed}'. Must be one of: ${MOVEMENT_SPEEDS.join(", ")}`
    );
  }

  const lightingStyle = normalizeLightingStyle(raw.lightingStyle ?? "high_key_daylight");
  if (!lightingStyle) {
    throw new ShotPlanValidationError(
      `Variant ${variantOrdinal} has invalid lightingStyle '${raw.lightingStyle}'. Must be one of: ${LIGHTING_STYLES.join(", ")}`
    );
  }

  const lensIntent =
    typeof raw.lensIntent === "string" && raw.lensIntent.trim().length > 0
      ? raw.lensIntent.trim()
      : "35mm standard";

  const cameraPosition =
    typeof raw.cameraPosition === "string" && raw.cameraPosition.trim().length > 0
      ? raw.cameraPosition.trim()
      : "eye_level";

  const cameraPromptDescription =
    typeof raw.cameraPromptDescription === "string" && raw.cameraPromptDescription.trim().length > 0
      ? raw.cameraPromptDescription.trim()
      : typeof raw.actionSummary === "string"
        ? raw.actionSummary.trim()
        : "Cinematic shot";

  const actionSummary =
    typeof raw.actionSummary === "string" && raw.actionSummary.trim().length > 0
      ? raw.actionSummary.trim()
      : cameraPromptDescription;

  const environmentDescription =
    typeof raw.environmentDescription === "string" && raw.environmentDescription.trim().length > 0
      ? raw.environmentDescription.trim()
      : "Standard production set";

  const colorPalette: string[] = Array.isArray(raw.colorPalette)
    ? raw.colorPalette.filter((c): c is string => typeof c === "string")
    : [];

  const atmosphere = typeof raw.atmosphere === "string" ? raw.atmosphere : null;

  const subjects: ShotPlanSubjectBlocking[] = [];
  if (Array.isArray(raw.subjects)) {
    for (const sub of raw.subjects) {
      if (typeof sub === "object" && sub !== null) {
        const s = sub as Record<string, unknown>;
        subjects.push({
          subjectId: String(s.subjectId ?? `subject-${subjects.length + 1}`),
          ...(s.referenceAssetId ? { referenceAssetId: String(s.referenceAssetId) } : {}),
          role: s.role === "product" ? "product" : "subject_identity",
          initialPosition:
            typeof s.initialPosition === "string"
              ? (s.initialPosition as ShotPlanSubjectBlocking["initialPosition"])
              : "screen_center",
          movementTrajectory: String(s.movementTrajectory ?? "stationary"),
          ...(s.interactionSummary ? { interactionSummary: String(s.interactionSummary) } : {})
        });
      }
    }
  }

  const beats: ShotPlanTemporalBeat[] = [];
  if (Array.isArray(raw.beats)) {
    for (let i = 0; i < raw.beats.length; i++) {
      const b = raw.beats[i];
      if (typeof b === "object" && b !== null) {
        const beatObj = b as Record<string, unknown>;
        beats.push({
          beatIndex: Number(beatObj.beatIndex ?? i + 1),
          startMs: Number(beatObj.startMs ?? 0),
          endMs: Number(beatObj.endMs ?? 0),
          description: String(beatObj.description ?? `Beat ${i + 1}`),
          cameraAction: String(beatObj.cameraAction ?? "holds framing"),
          subjectAction: String(beatObj.subjectAction ?? "performs action")
        });
      }
    }
  }

  const dialogue: ShotPlanDialogueIntent | null =
    typeof raw.dialogue === "object" && raw.dialogue !== null
      ? (raw.dialogue as ShotPlanDialogueIntent)
      : null;

  const continuity: ShotPlanContinuityConstraints = {
    persistentSubjectIds: Array.isArray(
      (raw.continuity as Record<string, unknown> | undefined)?.persistentSubjectIds
    )
      ? ((raw.continuity as Record<string, unknown>).persistentSubjectIds as string[])
      : [],
    frameAnchorTarget: "none"
  };

  return {
    framing,
    angle,
    cameraMovement,
    movementSpeed,
    lensIntent,
    cameraPosition,
    cameraPromptDescription,
    actionSummary,
    beats,
    lightingStyle,
    environmentDescription,
    colorPalette,
    ...(atmosphere !== null ? { atmosphere } : {}),
    subjects,
    ...(dialogue !== null ? { dialogue } : {}),
    continuity
  };
}
