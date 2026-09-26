import {
  CAMERA_ANGLES,
  CAMERA_MOVEMENTS,
  LIGHTING_STYLES,
  MOVEMENT_SPEEDS,
  SHOT_FRAMINGS
} from "@cco/domain";
import type { PlanningModelRequest } from "../ports/planning-model-client-port.js";

export interface BuildShotPlanPromptInput {
  readonly scenePrompt: string;
  readonly sceneDurationMs: number;
  readonly engineProfileId: string;
  readonly variantCount: number;
  readonly referenceAssetIds?: readonly string[] | undefined;
  readonly correctiveFeedback?: string | undefined;
}

export function buildShotPlanPrompt(input: BuildShotPlanPromptInput): PlanningModelRequest {
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
    `  NOTE: The beats must partition the scene duration (total ${input.sceneDurationMs} ms).`
  ].join("\n");

  const userPromptLines: string[] = [
    `Please generate ${input.variantCount} distinct ShotPlan variants for the following scene:`,
    "",
    `Scene Description: ${input.scenePrompt}`,
    `Target Duration: ${input.sceneDurationMs} ms`,
    `Engine Profile: ${input.engineProfileId}`
  ];

  if (input.referenceAssetIds && input.referenceAssetIds.length > 0) {
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
