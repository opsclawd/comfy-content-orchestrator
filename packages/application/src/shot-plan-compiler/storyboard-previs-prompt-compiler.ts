import type { CameraAngle } from "@cco/contracts";

export interface StoryboardShotPlanSubject {
  readonly subjectId: string;
  readonly role?: string | undefined;
  readonly referenceAssetId?: string | null | undefined;
  readonly initialPosition: string;
  readonly movementTrajectory: string;
  readonly interactionSummary?: string | null | undefined;
}

export interface StoryboardShotPlanBeat {
  readonly beatIndex?: number | undefined;
  readonly startMs?: number | undefined;
  readonly endMs?: number | undefined;
  readonly description: string;
  readonly cameraAction?: string | undefined;
  readonly subjectAction: string;
}

export interface StoryboardShotPlanContinuity {
  readonly persistentSubjectIds?: readonly string[] | undefined;
  readonly lightingContinuityNote?: string | null | undefined;
  readonly frameAnchorTarget?: string | null | undefined;
}

export interface StoryboardPrevisShotPlanInput {
  readonly id?: string | undefined;
  readonly sceneId?: string | undefined;
  readonly specRevision?: number | undefined;
  readonly variantOrdinal?: number | undefined;
  readonly status?: string | undefined;
  readonly routingMode?: string | undefined;
  readonly targetDurationMs?: number | undefined;
  readonly targetFrameCount?: number | undefined;
  readonly durationToleranceMs?: number | undefined;
  readonly fps?: number | undefined;
  readonly framing: string;
  readonly angle: string;
  readonly cameraPosition: string;
  readonly lensIntent: string;
  readonly cameraMovement?: string | null | undefined;
  readonly movementSpeed?: string | null | undefined;
  readonly cameraPromptDescription?: string | null | undefined;
  readonly subjects?: readonly StoryboardShotPlanSubject[] | null | undefined;
  readonly actionSummary: string;
  readonly beats?: readonly StoryboardShotPlanBeat[] | null | undefined;
  readonly lightingStyle: string;
  readonly environmentDescription: string;
  readonly colorPalette?: readonly string[] | null | undefined;
  readonly atmosphere?: string | null | undefined;
  readonly continuity?: StoryboardShotPlanContinuity | null | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export const STORYBOARD_PREVIS_PROFILE_ID = "flux_schnell_storyboard_v1" as const;
export const STORYBOARD_PREVIS_RENDER_PROFILE_KEY = "FLUX_SCHNELL_STORYBOARD_V1" as const;
export const STORYBOARD_PREVIS_WORKFLOW_TEMPLATE = "flux_schnell_storyboard_v1" as const;

export const STORYBOARD_STYLE_HEADER =
  "Professional advertising storyboard illustration, production agency board sketch, hand-drawn black pencil and ink linework with restrained monochrome marker wash. Visible construction lines, clear subject silhouettes, simplified facial features, distinct foreground midground and background depth separation, impressionistic studio lighting.";

export const STORYBOARD_CLEAN_PANEL_DIRECTIVE =
  "Clean storyboard frame artwork, no text, no labels, no speech bubbles, no arrows, no UI watermarks, no camera annotations.";

export const STORYBOARD_NEGATIVE_PROMPT =
  "photorealistic, photograph, 3d render, CGI, octane render, movie still, film frame, hyperrealistic, glossy skin, detailed skin pores, realistic human eyes, DSLR photo, camera annotations, on-screen text, typography, subtitles, speech bubble, arrows, frame labels, watermark, logo";

export interface StoryboardPrevisPromptResult {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly profileId: typeof STORYBOARD_PREVIS_PROFILE_ID;
  readonly renderProfileKey: typeof STORYBOARD_PREVIS_RENDER_PROFILE_KEY;
  readonly version: 1;
}

const FRAMING_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  extreme_wide: "extreme wide shot framing",
  wide: "wide shot framing",
  full_shot: "full shot framing",
  medium_wide: "medium wide shot framing",
  medium: "medium shot framing",
  medium_close_up: "medium close-up shot framing",
  close_up: "close-up shot framing",
  extreme_close_up: "extreme close-up shot framing"
});

function describeFraming(framing: string): string {
  return FRAMING_DESCRIPTIONS[framing] ?? `${framing.replace(/_/g, " ")} shot framing`;
}

const ANGLE_DESCRIPTIONS: Readonly<Record<CameraAngle, string>> = Object.freeze({
  eye_level: "Eye-level shot; camera at subject eye height, level horizontal viewpoint.",
  low_angle:
    "LOW ANGLE SHOT, shot from below. Camera placed near ground level, tilted sharply upward at the subjects. Subjects loom tall and dominant above the lens, exaggerated upward foreshortening, converging vertical lines, open sky or ceiling visible behind their heads, viewer looking up from a crouched vantage point.",
  high_angle:
    "HIGH ANGLE SHOT, shot from above. Pronounced high-angle shot; camera above the subjects looking downward at an oblique angle, elevated overhead vantage point, ground and subjects' heads/shoulders prominent, downward foreshortening.",
  bird_eye:
    "Bird's-eye overhead shot; camera directly above, looking vertically downward, top-down layout.",
  worm_eye:
    "Extreme worm's-eye shot; camera at ground level looking steeply upward, exaggerated upward foreshortening.",
  dutch_angle: "Dutch-angle shot; visibly tilted camera and diagonal horizon, canted composition.",
  over_the_shoulder:
    "Over-the-shoulder shot; camera behind a subject, foreground shoulder framing the subject or action beyond."
});

function describeAngle(angle: string): string {
  const known = ANGLE_DESCRIPTIONS[angle as CameraAngle];
  if (known) {
    return known;
  }
  const normalized = angle.replace(/_/g, " ");
  return `${normalized} camera angle; camera positioned for ${normalized} viewpoint.`;
}

const ANGLE_KEYWORD_LABELS: Readonly<Record<CameraAngle, string>> = Object.freeze({
  eye_level: "EYE LEVEL",
  low_angle: "LOW ANGLE",
  high_angle: "HIGH ANGLE",
  bird_eye: "BIRD'S EYE",
  worm_eye: "WORM'S EYE",
  dutch_angle: "DUTCH ANGLE",
  over_the_shoulder: "OVER THE SHOULDER"
});

function describeAngleKeyword(angle: string): string {
  return ANGLE_KEYWORD_LABELS[angle as CameraAngle] ?? angle.replace(/_/g, " ").toUpperCase();
}

const BLOCKING_EMPHASIS_KEYWORDS: ReadonlyArray<{ pattern: RegExp; phrase: string }> = [
  {
    pattern: /side[- ]by[- ]side/i,
    phrase: "standing directly side-by-side in a straight horizontal line"
  },
  {
    pattern: /facing forward|facing camera|facing the camera/i,
    phrase: "both facing forward toward the camera, not turned toward each other"
  },
  { pattern: /arms linked|linked arms/i, phrase: "with arms visibly linked together" },
  { pattern: /back[- ]to[- ]back/i, phrase: "standing back-to-back" },
  {
    pattern: /facing away|back to camera|backs to camera/i,
    phrase: "with backs turned to the camera"
  }
];

function describeBlockingEmphasis(subjects: readonly StoryboardShotPlanSubject[]): string | null {
  if (subjects.length < 2) {
    return null;
  }
  const combinedText = subjects
    .map((s) => `${s.movementTrajectory} ${s.interactionSummary ?? ""}`)
    .join(" ");
  const matched = BLOCKING_EMPHASIS_KEYWORDS.filter((k) => k.pattern.test(combinedText)).map(
    (k) => k.phrase
  );
  if (matched.length === 0) {
    return null;
  }
  return `Blocking emphasis: the ${subjects.length} subjects are staged ${matched.join(", ")}.`;
}

function describeCameraMovement(
  cameraMovement?: string | null,
  movementSpeed?: string | null,
  beatCameraAction?: string | null
): string {
  const speed = movementSpeed && movementSpeed.trim().length > 0 ? movementSpeed.trim() : "steady";
  let motionDesc: string;

  if (!cameraMovement || cameraMovement === "static") {
    motionDesc = "Static camera.";
  } else if (cameraMovement === "arc") {
    motionDesc = `Camera motion: ${speed} arc; single moment along a curved camera path around the subjects, with spatial depth and foreground-background separation while preserving stated camera position and subject orientations.`;
  } else {
    motionDesc = `Camera motion: ${speed} ${cameraMovement.replace(/_/g, " ")}.`;
  }

  if (beatCameraAction && beatCameraAction.trim().length > 0) {
    const cleanCamera = beatCameraAction.trim().replace(/\.+$/, "");
    motionDesc += ` Beat camera: ${cleanCamera}.`;
  }

  return motionDesc;
}

const LIGHTING_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  natural_golden_hour: "natural golden hour warm lighting",
  high_key_commercial: "clean high-key commercial lighting",
  low_key_dramatic: "low-key dramatic lighting with deep shadow contrast",
  chiaroscuro: "chiaroscuro lighting with bold shadow contrast",
  softbox_studio: "softbox studio diffused lighting",
  neon_night: "neon night lighting with colored rim accents",
  overcast_diffused: "overcast diffused flat lighting",
  practical_interior: "practical interior ambient lighting"
});

function describeLighting(lighting: string): string {
  return LIGHTING_DESCRIPTIONS[lighting] ?? `${lighting.replace(/_/g, " ")} lighting`;
}

export function compileStoryboardPrevisPrompt(
  shotPlan: StoryboardPrevisShotPlanInput,
  beat?: StoryboardShotPlanBeat
): StoryboardPrevisPromptResult {
  const sections: string[] = [];

  // 1. Camera & Framing (Leading camera section with angle, framing, position, lens, motion)
  const angleKeyword = describeAngleKeyword(shotPlan.angle);
  const angleDesc = describeAngle(shotPlan.angle);
  const framingDesc = describeFraming(shotPlan.framing);
  const motionDesc = describeCameraMovement(
    shotPlan.cameraMovement,
    shotPlan.movementSpeed,
    beat?.cameraAction
  );

  sections.push(
    `${angleKeyword}. Camera: ${angleDesc} Framing: ${framingDesc}. Position: ${shotPlan.cameraPosition}. Lens: ${shotPlan.lensIntent}. ${motionDesc}`
  );

  // 2. Subjects, Blocking & Screen/Depth Positions
  const subjects = shotPlan.subjects ?? [];
  const characterCount = subjects.filter((s) => s.role === "subject_identity").length;
  const productCount = subjects.filter((s) => s.role === "product").length;

  if (subjects.length > 0) {
    const subjectBreakdown = `${subjects.length} subject(s) (${characterCount} character(s), ${productCount} product(s))`;
    const subjectClauses: string[] = [];

    for (const s of subjects) {
      const pos = s.initialPosition.replace(/_/g, " ");
      const rolePrefix = s.role === "product" ? "Product/prop" : "Character";
      let clause = `${rolePrefix} [${s.subjectId}] staged at ${pos}; blocking: ${s.movementTrajectory}.`;
      if (s.interactionSummary && s.interactionSummary.trim().length > 0) {
        clause += ` Interaction: ${s.interactionSummary.trim()}.`;
      }
      subjectClauses.push(clause);
    }

    const blockingEmphasis = describeBlockingEmphasis(subjects);
    sections.push(
      `Staging: ${subjectBreakdown}; subject positions and facing directions follow the supplied blocking. ${subjectClauses.join(" ")}${blockingEmphasis ? ` ${blockingEmphasis}` : ""}`
    );
  } else {
    sections.push("Staging: Solo scene without distinct character blocking.");
  }

  // 3. Action & Staging
  if (beat) {
    const beatIndexPrefix = beat.beatIndex !== undefined ? `Beat ${beat.beatIndex}` : "Beat";
    const timingClause =
      beat.startMs !== undefined && beat.endMs !== undefined
        ? ` [${beat.startMs}ms-${beat.endMs}ms]`
        : "";
    const cleanAction = beat.subjectAction.trim().replace(/\.+$/, "");
    const cleanDesc =
      beat.description && beat.description.trim().length > 0
        ? beat.description.trim().replace(/\.+$/, "")
        : "";
    const descClause = cleanDesc.length > 0 ? ` (${cleanDesc})` : "";
    sections.push(`Action: ${beatIndexPrefix}${timingClause}: ${cleanAction}${descClause}.`);
  } else {
    let actionText = `Action: ${shotPlan.actionSummary}.`;
    if (shotPlan.beats && shotPlan.beats.length > 0) {
      const firstBeat = shotPlan.beats[0]!;
      actionText += ` Primary staging: ${firstBeat.subjectAction} (beat 1: ${firstBeat.description}).`;
    }
    sections.push(actionText);
  }

  // 4. Storyboard Illustration Style (follows early camera and blocking content)
  sections.push(STORYBOARD_STYLE_HEADER);

  // 5. Environment & Atmosphere
  let envText = `Setting: ${shotPlan.environmentDescription}.`;
  if (shotPlan.atmosphere && shotPlan.atmosphere.trim().length > 0) {
    envText += ` Atmosphere: ${shotPlan.atmosphere.trim()}.`;
  }
  sections.push(envText);

  // 6. Impressionistic Lighting Intent
  const lightingDesc = describeLighting(shotPlan.lightingStyle);
  let lightingText = `Lighting: Impressionistic ${lightingDesc} with marker wash tone shading.`;
  if (shotPlan.colorPalette && shotPlan.colorPalette.length > 0) {
    lightingText += ` Restrained marker tone palette: ${shotPlan.colorPalette.join(", ")}.`;
  }
  sections.push(lightingText);

  // 7. Continuity Cues
  const continuityClauses: string[] = [];
  if (shotPlan.continuity) {
    if (
      shotPlan.continuity.persistentSubjectIds &&
      shotPlan.continuity.persistentSubjectIds.length > 0
    ) {
      continuityClauses.push(
        `Persistent subject(s) [${shotPlan.continuity.persistentSubjectIds.join(", ")}].`
      );
    }
    if (
      shotPlan.continuity.lightingContinuityNote &&
      shotPlan.continuity.lightingContinuityNote.trim().length > 0
    ) {
      continuityClauses.push(
        `Lighting continuity note: ${shotPlan.continuity.lightingContinuityNote.trim()}.`
      );
    }
    if (shotPlan.continuity.frameAnchorTarget && shotPlan.continuity.frameAnchorTarget !== "none") {
      continuityClauses.push(
        `Frame anchor: match cut anchor for ${shotPlan.continuity.frameAnchorTarget.replace(/_/g, " ")}.`
      );
    }
  }
  if (continuityClauses.length > 0) {
    sections.push(`Continuity: ${continuityClauses.join(" ")}`);
  }

  // 8. Clean Panel Directive
  sections.push(STORYBOARD_CLEAN_PANEL_DIRECTIVE);

  return {
    prompt: sections.join("\n\n"),
    negativePrompt: STORYBOARD_NEGATIVE_PROMPT,
    profileId: STORYBOARD_PREVIS_PROFILE_ID,
    renderProfileKey: STORYBOARD_PREVIS_RENDER_PROFILE_KEY,
    version: 1
  };
}
