import { z } from "zod";
import { SceneConfigurationSchema, SceneStatusSchema } from "./scene-review.js";

export const CAMPAIGN_STATUSES = [
  "drafting",
  "pending_director_review",
  "partially_approved",
  "queued",
  "rendering",
  "qa",
  "completed",
  "failed",
  "cancelled"
] as const;

export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

// Requested/declared layer — exactly what the caller supplied.
export const CreateCampaignRequestSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1),
  targetPlatform: z.string().min(1).optional(),
  totalScenes: z.number().int().positive().optional()
});
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequestSchema>;

// Configured/executed layer — what was actually persisted, defaults applied.
export const CampaignResponseSchema = z.object({
  campaignId: z.string().uuid(),
  clientId: z.string().uuid(),
  title: z.string().min(1),
  targetPlatform: z.string().min(1),
  status: CampaignStatusSchema,
  totalScenes: z.number().int().positive(),
  approvedScenes: z.number().int().nonnegative(),
  createdAt: z.string().datetime()
});
export type CampaignResponse = z.infer<typeof CampaignResponseSchema>;

// Requested/declared layer — creative brief for cloud planning.
export const CreativeBriefSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1),
    targetPlatform: z.string().min(1).optional(),
    visualStyle: z.string().min(1).optional(),
    requirements: z.array(z.string().min(1)).optional()
  })
  .strict();
export type CreativeBrief = z.infer<typeof CreativeBriefSchema>;

export const CreateSceneManualRequestSchema = z
  .object({
    configuration: SceneConfigurationSchema
  })
  .strict();
export type CreateSceneManualRequest = z.infer<typeof CreateSceneManualRequestSchema>;

export const CreateSceneBriefRequestSchema = z
  .object({
    brief: CreativeBriefSchema,
    candidateReferenceAssetIds: z.array(z.string()).optional(),
    maxDurationMs: z.number().int().positive().optional(),
    targetDurationMs: z.number().int().positive().optional()
  })
  .strict()
  .refine(
    (data) =>
      data.maxDurationMs === undefined ||
      data.targetDurationMs === undefined ||
      data.targetDurationMs <= data.maxDurationMs,
    {
      message: "targetDurationMs cannot exceed maxDurationMs",
      path: ["targetDurationMs"]
    }
  );
export type CreateSceneBriefRequest = z.infer<typeof CreateSceneBriefRequestSchema>;

// Requested/declared layer — union of manual configuration and cloud-planning brief.
export const CreateSceneRequestSchema = z.union([
  CreateSceneManualRequestSchema,
  CreateSceneBriefRequestSchema
]);
export type CreateSceneRequest = z.infer<typeof CreateSceneRequestSchema>;

export function isCreateSceneBriefRequest(
  request: CreateSceneRequest
): request is CreateSceneBriefRequest {
  return "brief" in request;
}

export function isCreateSceneManualRequest(
  request: CreateSceneRequest
): request is CreateSceneManualRequest {
  return "configuration" in request;
}

export const isBriefRequest = isCreateSceneBriefRequest;
export const isManualRequest = isCreateSceneManualRequest;

// Configured/executed layer — echoes the requested configuration verbatim
// plus server-assigned identity/lifecycle fields. No measured/verified
// fields belong here (see design.md "Provenance layering").
export const SceneCreateResponseSchema = z.object({
  sceneId: z.string().uuid(),
  campaignId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive(),
  configuration: SceneConfigurationSchema
});
export type SceneCreateResponse = z.infer<typeof SceneCreateResponseSchema>;

// Requested/declared layer — request for campaign beat-sheet planning.
export const PlanCampaignBeatSheetRequestSchema = z
  .object({
    brief: CreativeBriefSchema,
    targetTotalDurationMs: z.number().int().positive(),
    candidateReferenceAssetIds: z.array(z.string()).optional()
  })
  .strict();
export type PlanCampaignBeatSheetRequest = z.infer<typeof PlanCampaignBeatSheetRequestSchema>;

export const CampaignBeatSchema = z
  .object({
    ordinal: z.number().int().positive(),
    brief: CreativeBriefSchema,
    targetDurationMs: z.number().int().positive()
  })
  .strict();
export type CampaignBeat = z.infer<typeof CampaignBeatSchema>;

// Configured/executed layer — proposed beat sheet for director review.
export const CampaignBeatSheetResponseSchema = z.object({
  campaignId: z.string().uuid(),
  targetTotalDurationMs: z.number().int().positive(),
  beats: z.array(CampaignBeatSchema)
});
export type CampaignBeatSheetResponse = z.infer<typeof CampaignBeatSheetResponseSchema>;
