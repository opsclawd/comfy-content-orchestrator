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

// Source of truth: packages/application/src/use-cases/scene-count-policy.ts — kept in sync via campaign.test.ts + scene-count-policy.test.ts cross-check.
export const MIN_TARGET_DURATION_MS = 5_000;
export const MAX_TARGET_DURATION_MS = 300_000;
export const MIN_SCENE_COUNT = 1;
export const MAX_SCENE_COUNT = 60;
export const MIN_SCENE_DURATION_MS = 1_000;
export const MAX_SCENE_DURATION_MS = 15_000;

// Requested/declared layer — durable campaign shell creation request.
export const CreateCampaignShellRequestSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    clientId: z.string().uuid(),
    title: z.string().min(1),
    targetPlatform: z.string().min(1).optional(),
    targetTotalDurationMs: z.number().int().min(MIN_TARGET_DURATION_MS).max(MAX_TARGET_DURATION_MS),
    sceneCountOverride: z.number().int().min(MIN_SCENE_COUNT).max(MAX_SCENE_COUNT).optional()
  })
  .strict()
  .refine(
    (data) => {
      const n = data.sceneCountOverride;
      if (n === undefined) return true;
      return (
        data.targetTotalDurationMs >= n * MIN_SCENE_DURATION_MS &&
        data.targetTotalDurationMs <= n * MAX_SCENE_DURATION_MS
      );
    },
    {
      message:
        "targetTotalDurationMs and sceneCountOverride imply an unsupported per-scene duration",
      path: ["sceneCountOverride"]
    }
  );
export type CreateCampaignShellRequest = z.infer<typeof CreateCampaignShellRequestSchema>;

// Configured/executed layer — echoes resolved N and duration, plus identity.
export const CreateCampaignShellResponseSchema = z.object({
  campaignId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  status: CampaignStatusSchema,
  totalScenes: z.number().int().positive(),
  targetTotalDurationMs: z.number().int().positive(),
  isIdempotentReplay: z.boolean(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional()
});
export type CreateCampaignShellResponse = z.infer<typeof CreateCampaignShellResponseSchema>;

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
