import type { CreativeBrief } from "@cco/contracts";
import type { CampaignId, ReferenceAsset } from "@cco/domain";
import type { PlanningModelRequest } from "../ports/planning-model-client-port.js";
import { isMiniMaxEngineOrProfile } from "./map-production-duration.js";
import { formatReferenceAssetMetadata, maskCampaignIdentifier } from "./planning-prompt.js";

export interface BuildBeatSheetPlanningPromptInput {
  readonly brief: CreativeBrief;
  readonly campaignId: CampaignId | string;
  readonly totalScenes: number;
  readonly targetTotalDurationMs: number;
  readonly resolvedReferenceAssets: readonly ReferenceAsset[];
  readonly maskSensitiveData?: boolean | undefined;
  readonly correctiveFeedback?: string | undefined;
  readonly targetEngine?: string | undefined;
  readonly engineProfileId?: string | undefined;
}

export function buildBeatSheetPlanningPrompt(
  input: BuildBeatSheetPlanningPromptInput
): PlanningModelRequest {
  const effectiveCampaignId = input.maskSensitiveData
    ? maskCampaignIdentifier(input.campaignId)
    : input.campaignId;

  const isMiniMax =
    isMiniMaxEngineOrProfile(input.targetEngine) ||
    isMiniMaxEngineOrProfile(input.engineProfileId) ||
    Math.round(input.targetTotalDurationMs / input.totalScenes) >= 4500;

  const durationGuidance = isMiniMax
    ? "  - targetDurationMs: positive integer duration in milliseconds for this beat. For video synthesis, each beat should target ~5000 ms (5.0 seconds, matching the certified 124-frame MiniMax-H3 video engine)."
    : "  - targetDurationMs: positive integer duration in milliseconds for this beat. For video synthesis, each beat should target ~4000 ms (4.0 seconds, matching the certified 97-frame video engine).";

  const visualStyleGuidance = isMiniMax
    ? [
        "",
        "Visual style guidelines for MiniMax-H3 photorealistic synthesis:",
        "- Prioritize authentic human anatomy, natural skin micro-textures, physical weight, and lifelike movement.",
        "- Emphasize cinematic lighting, specular reflections, depth of field, and natural fabric/hair physics.",
        "- Avoid artificial CGI descriptors (e.g. 'unreal engine', '3D render'); specify concrete photographic properties and camera staging."
      ]
    : [];

  const systemPrompt = [
    "You are a specialized creative planning assistant for video synthesis.",
    "Your goal is to decompose a campaign-level creative brief into a reviewable beat sheet of scenes.",
    "Respond with a single JSON object. Do not include extraneous conversational text.",
    "",
    "Rules for the output JSON fields:",
    `- beats: array of exactly ${input.totalScenes} scene beats.`,
    "- Each beat in the array must be an object with the following fields:",
    `  - ordinal: positive integer from 1 to ${input.totalScenes}, unique and contiguous.`,
    "  - brief: a creative brief object for this scene with fields:",
    "    - description: non-empty string describing the visual scene beat in detail.",
    "    - title: optional string title for this beat.",
    "    - targetPlatform: optional string.",
    "    - visualStyle: optional string.",
    "    - requirements: optional array of non-empty strings.",
    durationGuidance,
    `- The sum of all beat targetDurationMs values MUST equal exactly ${input.targetTotalDurationMs} ms.`,
    ...visualStyleGuidance
  ].join("\n");

  const briefSections: string[] = [
    `Campaign Identifier: ${effectiveCampaignId}`,
    `Total Required Scenes: ${input.totalScenes}`,
    `Target Total Duration: ${input.targetTotalDurationMs} ms`,
    `Campaign Description: ${input.brief.description}`
  ];

  if (input.brief.title) {
    briefSections.push(`Campaign Title: ${input.brief.title}`);
  }
  if (input.brief.targetPlatform) {
    briefSections.push(`Target Platform: ${input.brief.targetPlatform}`);
  }
  if (input.brief.visualStyle) {
    briefSections.push(`Visual Style: ${input.brief.visualStyle}`);
  }
  if (input.brief.requirements && input.brief.requirements.length > 0) {
    briefSections.push(
      `Requirements:\n${input.brief.requirements.map((r) => `- ${r}`).join("\n")}`
    );
  }

  const userPromptParts: string[] = [
    "Please decompose the following campaign creative brief into a proposed beat sheet:",
    "",
    ...briefSections,
    "",
    "Available Reference Assets:",
    formatReferenceAssetMetadata(input.resolvedReferenceAssets),
    "",
    "Reference Role Definitions (for semantic context):",
    "- subject_identity: Core character, actor, or subject identity to maintain consistency across scenes.",
    "- product: Commercial product, hero object, or key item featured in the video.",
    "- location: Environment, setting, architectural space, or background scenery.",
    "- style: Overall visual mood, lighting style, color palette, or artistic aesthetic.",
    "- composition: Framing, perspective, camera angle, or spatial layout guidance."
  ];

  if (input.correctiveFeedback) {
    userPromptParts.push(
      "",
      "IMPORTANT: The previous attempt was rejected for the following reason:",
      input.correctiveFeedback,
      "Please correct your output to resolve this validation issue."
    );
  }

  return {
    systemPrompt,
    userPrompt: userPromptParts.join("\n")
  };
}
