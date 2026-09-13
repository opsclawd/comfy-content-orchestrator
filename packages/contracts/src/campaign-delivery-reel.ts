import { z } from "zod";
import { AssemblyManifestSchema } from "./assembly-manifest.js";
import { sha256HashSchema } from "./persistent-media.js";

export const CAMPAIGN_DELIVERY_REEL_STATES = [
  "not-started",
  "assembling",
  "completed",
  "failed",
  "unavailable-artifact"
] as const;

export type CampaignDeliveryReelState = (typeof CAMPAIGN_DELIVERY_REEL_STATES)[number];
export const CampaignDeliveryReelStateSchema = z.enum(CAMPAIGN_DELIVERY_REEL_STATES);

export const CampaignDeliveryMediaReadModelSchema = z.object({
  url: z.string().url(),
  bucket: z.string().min(1),
  key: z.string().min(1),
  sha256: sha256HashSchema,
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

export type CampaignDeliveryMediaReadModel = z.infer<typeof CampaignDeliveryMediaReadModelSchema>;

export const CampaignDeliveryReelReadModelSchema = z.object({
  campaignId: z.string().uuid(),
  status: CampaignDeliveryReelStateSchema,
  state: CampaignDeliveryReelStateSchema,
  assemblyId: z.string().optional(),
  runId: z.string().uuid().optional(),
  assemblyJobId: z.string().uuid().optional(),
  manifest: AssemblyManifestSchema.optional(),
  media: CampaignDeliveryMediaReadModelSchema.optional(),
  error: z.string().optional(),
  reason: z.string().optional(),
  updatedAt: z.string().datetime().optional()
});

export type CampaignDeliveryReelReadModel = z.infer<typeof CampaignDeliveryReelReadModelSchema>;
