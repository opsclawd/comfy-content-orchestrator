import type { CampaignId } from "./scene.js";

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
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface CampaignRecord {
  readonly id: CampaignId;
  readonly clientId: string;
  readonly title: string;
  readonly targetPlatform: string;
  readonly status: CampaignStatus;
  readonly totalScenes: number;
  readonly approvedScenes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly idempotencyKey?: string | undefined;
  readonly targetTotalDurationMs?: number | undefined;
  readonly archivedAt?: string | undefined;
}

export interface CampaignShellRecord extends CampaignRecord {
  readonly idempotencyKey: string;
  readonly targetTotalDurationMs: number;
}
