import {
  CAMERA_ANGLES,
  CAMERA_MOVEMENTS,
  LIGHTING_STYLES,
  MOVEMENT_SPEEDS,
  SHOT_FRAMINGS,
  type ReferenceRole,
  type ShotPlanSnapshot
} from "@cco/domain";
import type { PlanningModelRequest } from "../ports/planning-model-client-port.js";

export interface BoundReferencePromptInput {
  readonly promptTag: string;
  readonly role: ReferenceRole;
  readonly description: string;
}

export interface BuildShotPlanPromptInput {
  readonly scenePrompt: string;
  readonly sceneDurationMs: number;
  readonly engineProfileId: string;
  readonly variantCount: number;
  readonly boundReferences?: readonly BoundReferencePromptInput[] | undefined;
  readonly referenceAssetIds?: readonly string[] | undefined;
  readonly correctiveFeedback?: string | undefined;
}

export function buildShotPlanPrompt(input: BuildShotPlanPromptInput): PlanningModelRequest {
  const hasBoundReferences =
    input.boundReferences !== undefined && input.boundReferences.length > 0;

  const systemPrompt = [
    "You are a specialized cinematography director and storyboard planning assistant for AI video synthesis.",
    `Your goal is to propose ${input.variantCount} distinct, structured ShotPlan variants for a scene based on the scene visual description and duration.`,
    "Each variant should offer a distinct creative interpretation (different framings, camera angles, movements, lighting styles, or blocking).",
    "Respond with a single JSON array of shot plan objects. Do not include markdown preamble or conversational text.",
    "",
    "Allowed field values:",
    `- framing: ${JSON.stringify(SHOT_FRAMINGS)}`,
    `- angle: ${JSON.stringify(CAMERA_ANGLES)}`,
    `- cameraMovement: ${JSON.stringify(CAMERA_MOVEMENTS)}`,
    `- movementSpeed: ${JSON.stringify(MOVEMENT_SPEEDS)}`,
    `- lightingStyle: ${JSON.stringify(LIGHTING_STYLES)}`,
    "",
    "Each shot plan object must contain:",
    "- framing: string from allowed framing list",
    "- angle: string from allowed camera angle list",
    "- cameraMovement: string from allowed camera movement list",
    "- movementSpeed: string from allowed movement speed list",
    "- lensIntent: string (e.g. '35mm anamorphic', '50mm prime', '24mm wide')",
    "- cameraPosition: string (e.g. 'eye_level seated', 'low tripod', 'high crane')",
    "- cameraPromptDescription: string concise prompt suitable for generating a previs keyframe",
    "- actionSummary: string concise summary of character and camera action",
    "- lightingStyle: string from allowed lighting style list",
    "- environmentDescription: string describing set, backdrop, and atmosphere",
    "- colorPalette: array of strings describing dominant colors",
    "- subjects: array of objects with { subjectId, role ('subject_identity'|'product'), initialPosition, movementTrajectory }",
    "- beats: array of temporal beats covering the duration, each with { beatIndex, startMs, endMs, description, cameraAction, subjectAction }",
    `  NOTE: The beats must partition the scene duration (total ${input.sceneDurationMs} ms).`,
    ...(hasBoundReferences
      ? [
          "",
          "Reference Asset Directives:",
          "When Bound Reference Assets are provided, they are authoritative reference constraints, not optional inspiration:",
          "- For 'subject_identity': The character or subject identity must strictly follow the described appearance and characteristics.",
          "- For 'product': The product appearance, packaging, and branding must strictly follow the described product details.",
          "- For 'location': The scene setting, architecture, and physical environment must strictly match the described location.",
          "- For 'style' and 'composition': The aesthetic cues, framing, color palette, and visual mood must follow the described cues."
        ]
      : [])
  ].join("\n");

  const userPromptLines: string[] = [
    `Please generate ${input.variantCount} distinct ShotPlan variants for the following scene:`,
    "",
    `Scene Description: ${input.scenePrompt}`,
    `Target Duration: ${input.sceneDurationMs} ms`,
    `Engine Profile: ${input.engineProfileId}`
  ];

  if (hasBoundReferences) {
    userPromptLines.push("Bound Reference Assets:");
    for (const ref of input.boundReferences!) {
      userPromptLines.push(`${ref.promptTag} | ${ref.role} | ${ref.description}`);
    }
  } else if (input.referenceAssetIds && input.referenceAssetIds.length > 0) {
    userPromptLines.push(`Bound Reference Assets: ${input.referenceAssetIds.join(", ")}`);
  }

  if (input.correctiveFeedback) {
    userPromptLines.push("", `Correction Required: ${input.correctiveFeedback}`);
  }

  return {
    systemPrompt,
    userPrompt: userPromptLines.join("\n")
  };
}

export interface BuildShotPlanVariationPromptInput {
  readonly scenePrompt: string;
  readonly sceneDurationMs: number;
  readonly engineProfileId: string;
  readonly sourceShotPlan: ShotPlanSnapshot;
  readonly directorGuidance: string;
  readonly variantCount: number;
  readonly boundReferences?: readonly BoundReferencePromptInput[] | undefined;
  readonly referenceAssetIds?: readonly string[] | undefined;
  readonly correctiveFeedback?: string | undefined;
}

export function buildShotPlanVariationPrompt(
  input: BuildShotPlanVariationPromptInput
): PlanningModelRequest {
  const hasBoundReferences =
    input.boundReferences !== undefined && input.boundReferences.length > 0;

  const systemPrompt = [
    "You are a specialized cinematography director and storyboard planning assistant for AI video synthesis.",
    `Your task is to create ${input.variantCount} directed ShotPlan variation(s) based on a preferred source ShotPlan and specific director guidance.`,
    "",
    "CRITICAL DIRECTIVES:",
    "1. Preserve Unaffected Intent: Fields, framings, lighting, environment, and beats not implicated by the director guidance must retain source intent from the source ShotPlan.",
    "2. Coherent Multi-Field Adjustment: When applying the director guidance, make all necessary adjustments coherently across framing, camera angle, camera movement, movement speed, lens intent, camera position, subjects, action summary, beats, lighting, and environment.",
    "3. Complete Valid Document: Return a complete, valid ShotPlan document for each variation. Do not return partial JSON patches, diffs, or markdown commentary.",
    `4. Temporal Consistency: The beats must partition the scene duration (total ${input.sceneDurationMs} ms). Beat endMs must strictly equal the scene duration on the final beat, and beats must not overlap.`,
    "5. Reference Asset Integrity: You are strictly forbidden from inventing unbound referenceAssetId values. Any subject.referenceAssetId must only reference an asset from the provided bound reference asset list, or remain null/omitted.",
    "6. Format: Respond with a single JSON array of complete shot plan objects. Do not include markdown preamble or conversational text.",
    "",
    "Allowed field values:",
    `- framing: ${JSON.stringify(SHOT_FRAMINGS)}`,
    `- angle: ${JSON.stringify(CAMERA_ANGLES)}`,
    `- cameraMovement: ${JSON.stringify(CAMERA_MOVEMENTS)}`,
    `- movementSpeed: ${JSON.stringify(MOVEMENT_SPEEDS)}`,
    `- lightingStyle: ${JSON.stringify(LIGHTING_STYLES)}`,
    "",
    "Each shot plan object must contain:",
    "- framing: string from allowed framing list",
    "- angle: string from allowed camera angle list",
    "- cameraMovement: string from allowed camera movement list",
    "- movementSpeed: string from allowed movement speed list",
    "- lensIntent: string (e.g. '35mm anamorphic', '50mm prime', '24mm wide')",
    "- cameraPosition: string (e.g. 'eye_level seated', 'low tripod', 'high crane')",
    "- cameraPromptDescription: string concise prompt suitable for generating a previs keyframe",
    "- actionSummary: string concise summary of character and camera action",
    "- lightingStyle: string from allowed lighting style list",
    "- environmentDescription: string describing set, backdrop, and atmosphere",
    "- colorPalette: array of strings describing dominant colors",
    "- subjects: array of objects with { subjectId, role ('subject_identity'|'product'), initialPosition, movementTrajectory }",
    "- beats: array of temporal beats covering the duration, each with { beatIndex, startMs, endMs, description, cameraAction, subjectAction }",
    ...(hasBoundReferences
      ? [
          "",
          "Reference Asset Directives:",
          "When Bound Reference Assets are provided, they are authoritative reference constraints, not optional inspiration:",
          "- For 'subject_identity': The character or subject identity must strictly follow the described appearance and characteristics.",
          "- For 'product': The product appearance, packaging, and branding must strictly follow the described product details.",
          "- For 'location': The scene setting, architecture, and physical environment must strictly match the described location.",
          "- For 'style' and 'composition': The aesthetic cues, framing, color palette, and visual mood must follow the described cues."
        ]
      : [])
  ].join("\n");

  const userPromptLines: string[] = [
    `Please generate ${input.variantCount} directed ShotPlan variation(s) based on the following preferred source ShotPlan and director guidance:`,
    "",
    `Director Guidance: "${input.directorGuidance.trim()}"`,
    "",
    `Scene Description: ${input.scenePrompt}`,
    `Target Duration: ${input.sceneDurationMs} ms`,
    `Engine Profile: ${input.engineProfileId}`
  ];

  if (hasBoundReferences) {
    userPromptLines.push("Bound Reference Assets:");
    for (const ref of input.boundReferences!) {
      userPromptLines.push(`${ref.promptTag} | ${ref.role} | ${ref.description}`);
    }
  } else if (input.referenceAssetIds && input.referenceAssetIds.length > 0) {
    userPromptLines.push(`Bound Reference Assets: ${input.referenceAssetIds.join(", ")}`);
  }

  userPromptLines.push(
    "",
    "Source ShotPlan (Structured Intent to Refine):",
    JSON.stringify(
      {
        framing: input.sourceShotPlan.framing,
        angle: input.sourceShotPlan.angle,
        cameraMovement: input.sourceShotPlan.cameraMovement,
        movementSpeed: input.sourceShotPlan.movementSpeed,
        lensIntent: input.sourceShotPlan.lensIntent,
        cameraPosition: input.sourceShotPlan.cameraPosition,
        cameraPromptDescription: input.sourceShotPlan.cameraPromptDescription,
        actionSummary: input.sourceShotPlan.actionSummary,
        subjects: input.sourceShotPlan.subjects,
        beats: input.sourceShotPlan.beats,
        lightingStyle: input.sourceShotPlan.lightingStyle,
        environmentDescription: input.sourceShotPlan.environmentDescription,
        colorPalette: input.sourceShotPlan.colorPalette,
        atmosphere: input.sourceShotPlan.atmosphere,
        dialogue: input.sourceShotPlan.dialogue
      },
      null,
      2
    )
  );

  if (input.correctiveFeedback) {
    userPromptLines.push("", `Correction Required: ${input.correctiveFeedback}`);
  }

  return {
    systemPrompt,
    userPrompt: userPromptLines.join("\n")
  };
}
