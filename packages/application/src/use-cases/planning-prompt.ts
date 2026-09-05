import { createHash } from "node:crypto";
import { RenderProfileKeySchema, type CreativeBrief } from "@cco/contracts";
import type { CampaignId, ReferenceAsset } from "@cco/domain";
import type { PlanningModelRequest } from "../ports/planning-model-client-port.js";

export type { CreativeBrief };

export function maskCampaignIdentifier(campaignId: string): string {
  const hash = createHash("sha256").update(campaignId).digest("hex");
  return `masked-campaign-${hash.slice(0, 12)}`;
}

export interface BuildPlanningPromptInput {
  readonly brief: CreativeBrief;
  readonly campaignId: CampaignId | string;
  readonly resolvedReferenceAssets: readonly ReferenceAsset[];
  readonly maskSensitiveData?: boolean | undefined;
  readonly maxDurationMs?: number | undefined;
  readonly correctiveFeedback?: string | undefined;
}

export function buildPlanningPrompt(input: BuildPlanningPromptInput): PlanningModelRequest {
  const effectiveCampaignId = input.maskSensitiveData
    ? maskCampaignIdentifier(input.campaignId)
    : input.campaignId;

  const certifiedProfiles = RenderProfileKeySchema.options;
  const assetIds = input.resolvedReferenceAssets.map((asset) => asset.id as string);

  const systemPrompt = [
    "You are a specialized creative planning assistant for video synthesis.",
    "Your goal is to generate a strictly valid SceneConfiguration JSON object based on the provided creative brief.",
    "Respond with a single JSON object. Do not include extraneous conversational text.",
    "",
    "Rules for the output JSON fields:",
    "- prompt: non-empty string describing the visual scene to be rendered in detail.",
    `- referenceIds: array of strings selected strictly from available reference asset IDs: ${JSON.stringify(assetIds)}. Only use IDs from this list.`,
    `- engineProfileId: string, must be one of the certified profiles: ${JSON.stringify(certifiedProfiles)}.`,
    `- durationMs: positive integer in milliseconds${input.maxDurationMs !== undefined ? ` (maximum: ${input.maxDurationMs})` : ""}.`,
    "- loraConfigurationId: optional string or null."
  ].join("\n");

  const briefSections: string[] = [
    `Campaign Identifier: ${effectiveCampaignId}`,
    `Description: ${input.brief.description}`
  ];

  if (input.brief.title) {
    briefSections.push(`Title: ${input.brief.title}`);
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
    "Please generate a SceneConfiguration JSON object for the following creative brief:",
    "",
    ...briefSections,
    "",
    `Available Reference Asset IDs: ${assetIds.length > 0 ? assetIds.join(", ") : "None"}`,
    `Certified Engine Profiles: ${certifiedProfiles.join(", ")}`
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
