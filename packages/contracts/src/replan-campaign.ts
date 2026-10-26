import { z } from "zod";
import {
  CampaignDurationPlanSchema,
  SceneDurationBindingSchema
} from "./campaign-duration-plan.js";

export const ReplanCampaignPreviewRequestSchema = z
  .object({
    campaignId: z.string().uuid(),
    sceneIdDurations: z.record(z.string().uuid(), z.number().int().positive()),
    selectedProfileKey: z.string().trim().min(1).optional(),
    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional(),
    principal: z.string().trim().min(1).optional()
  })
  .strict();
export type ReplanCampaignPreviewRequest = z.infer<typeof ReplanCampaignPreviewRequestSchema>;

export const ReplanCampaignPreviewResponseSchema = z
  .object({
    campaignId: z.string().uuid(),
    feasible: z.boolean(),
    currentPlanRevision: z.number().int().nonnegative(),
    proposedPlan: CampaignDurationPlanSchema.optional(),
    error: z.string().optional()
  })
  .strict();
export type ReplanCampaignPreviewResponse = z.infer<typeof ReplanCampaignPreviewResponseSchema>;

export const ReplanCampaignCommitRequestSchema = z
  .object({
    campaignId: z.string().uuid(),
    actionId: z.string().trim().min(1),
    expectedPlanRevision: z.number().int().positive(),
    expectedSceneSpecRevisions: z.record(z.string().uuid(), z.number().int().positive()),
    sceneIdDurations: z.record(z.string().uuid(), z.number().int().positive()),
    selectedProfileKey: z.string().trim().min(1).optional(),
    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional(),
    principal: z.string().trim().min(1).optional()
  })
  .strict();
export type ReplanCampaignCommitRequest = z.infer<typeof ReplanCampaignCommitRequestSchema>;

export const ReplanCampaignCommitResponseSchema = z
  .object({
    campaignId: z.string().uuid(),
    newPlanRevision: z.number().int().positive(),
    plan: CampaignDurationPlanSchema,
    bindings: z.array(SceneDurationBindingSchema),
    updatedScenes: z.array(
      z.object({
        sceneId: z.string().uuid(),
        newSpecRevision: z.number().int().positive()
      })
    )
  })
  .strict();
export type ReplanCampaignCommitResponse = z.infer<typeof ReplanCampaignCommitResponseSchema>;
