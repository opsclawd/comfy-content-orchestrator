import { createHash } from "node:crypto";
import { REFERENCE_ROLES, RenderProfileKeySchema, type CreativeBrief } from "@cco/contracts";
import type { CampaignId, ReferenceAsset } from "@cco/domain";
import type { PlanningModelRequest } from "../ports/planning-model-client-port.js";

export type { CreativeBrief };

export function maskCampaignIdentifier(campaignId: string): string {
  const hash = createHash("sha256").update(campaignId).digest("hex");
  return `masked-campaign-${hash.slice(0, 12)}`;
}

export function formatReferenceAssetMetadata(assets: readonly ReferenceAsset[]): string {
  if (assets.length === 0) {
    return "None";
  }
  const sorted = [...assets].sort((a, b) => (a.id as string).localeCompare(b.id as string));
  return sorted
    .map(
      (a) =>
        `- referenceId: ${a.id}\n  displayName: ${a.displayName ?? "unspecified"}\n  libraryRole: ${a.libraryRole ?? "unspecified"}\n  description: ${a.description ?? "unspecified"}`
    )
    .join("\n");
}

export interface BuildPlanningPromptInput {
  readonly brief: CreativeBrief;
  readonly campaignId: CampaignId | string;
  readonly resolvedReferenceAssets: readonly ReferenceAsset[];
  readonly maskSensitiveData?: boolean | undefined;
  readonly maxDurationMs?: number | undefined;
  readonly targetDurationMs?: number | undefined;
  readonly correctiveFeedback?: string | undefined;
  readonly targetEngineProfileId?: string | undefined;
}

export function buildPlanningPrompt(input: BuildPlanningPromptInput): PlanningModelRequest {
  const effectiveCampaignId = input.maskSensitiveData
    ? maskCampaignIdentifier(input.campaignId)
    : input.campaignId;

  const certifiedProfiles = RenderProfileKeySchema.options;
  const assetIds = input.resolvedReferenceAssets.map((asset) => asset.id as string).sort();

  const durationConstraintText =
    input.targetDurationMs !== undefined
      ? ` (must equal exactly ${input.targetDurationMs})`
      : input.maxDurationMs !== undefined
        ? ` (maximum: ${input.maxDurationMs})`
        : "";

  const engineRule =
    input.targetEngineProfileId !== undefined
      ? `- engineProfileId: string, must equal "${input.targetEngineProfileId}".`
      : `- engineProfileId: string, must be one of the certified profiles: ${JSON.stringify(certifiedProfiles)}.`;

  const systemPrompt = [
    "You are a specialized creative planning assistant for video synthesis.",
    "Your goal is to generate a strictly valid SceneConfiguration JSON object based on the provided creative brief.",
    "Respond with a single JSON object. Do not include extraneous conversational text.",
    "",
    "Rules for the output JSON fields:",
    "- prompt: non-empty string describing the visual scene to be rendered in detail.",
    `- references: array of objects assigning reference assets to this scene. Each object must contain:`,
    `  - referenceId: string, must be selected strictly from available candidate reference IDs: ${JSON.stringify(assetIds)}. Only use IDs from this list.`,
    `  - role: string, must be one of the reference roles: ${JSON.stringify(REFERENCE_ROLES)}. Choose the role based on script and visual context.`,
    engineRule,
    `- durationMs: positive integer in milliseconds${durationConstraintText}.`,
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
    "Available Reference Assets:",
    formatReferenceAssetMetadata(input.resolvedReferenceAssets),
    "",
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
