import { ClientNotFoundError, type CampaignRepository } from "@cco/application";
import type { CampaignId, CampaignRecord, CampaignStatus } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface CampaignRow {
  campaign_id: string;
  client_id: string;
  title: string;
  target_platform: string;
  status: string;
  total_scenes: number;
  approved_scenes: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRowToCampaign(row: CampaignRow): CampaignRecord {
  return {
    id: row.campaign_id as CampaignId,
    clientId: row.client_id,
    title: row.title,
    targetPlatform: row.target_platform,
    status: row.status as CampaignStatus,
    totalScenes: Number(row.total_scenes),
    approvedScenes: Number(row.approved_scenes),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  };
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

export class PostgresCampaignRepository implements CampaignRepository<CampaignRecord> {
  constructor(private readonly client: Pool | PoolClient) {}

  async findById(campaignId: string): Promise<CampaignRecord | undefined> {
    const result = await this.client.query<CampaignRow>(
      `
      SELECT
        campaign_id,
        client_id,
        title,
        target_platform,
        status,
        total_scenes,
        approved_scenes,
        created_at,
        updated_at
      FROM campaigns
      WHERE campaign_id = $1 AND archived_at IS NULL
      `,
      [campaignId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return mapRowToCampaign(row);
  }

  async findByIdForUpdate(campaignId: string): Promise<CampaignRecord | undefined> {
    if (isPool(this.client)) {
      throw new Error(
        "Cannot execute findByIdForUpdate using a pg Pool instance. A transaction-bound PoolClient is required for row locking."
      );
    }

    const result = await this.client.query<CampaignRow>(
      `
      SELECT
        campaign_id,
        client_id,
        title,
        target_platform,
        status,
        total_scenes,
        approved_scenes,
        created_at,
        updated_at
      FROM campaigns
      WHERE campaign_id = $1 AND archived_at IS NULL
      FOR UPDATE
      `,
      [campaignId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return mapRowToCampaign(row);
  }

  async save(campaign: CampaignRecord): Promise<void> {
    const createdAt = campaign.createdAt ? new Date(campaign.createdAt) : new Date();
    const updatedAt = campaign.updatedAt ? new Date(campaign.updatedAt) : new Date();

    try {
      await this.client.query(
        `
        INSERT INTO campaigns (
          campaign_id,
          client_id,
          title,
          target_platform,
          status,
          total_scenes,
          approved_scenes,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        )
        ON CONFLICT (campaign_id) DO UPDATE SET
          title = EXCLUDED.title,
          target_platform = EXCLUDED.target_platform,
          status = EXCLUDED.status,
          total_scenes = EXCLUDED.total_scenes,
          approved_scenes = EXCLUDED.approved_scenes,
          updated_at = CURRENT_TIMESTAMP
        `,
        [
          campaign.id,
          campaign.clientId,
          campaign.title,
          campaign.targetPlatform,
          campaign.status,
          campaign.totalScenes,
          campaign.approvedScenes,
          createdAt,
          updatedAt
        ]
      );
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "23503") {
        throw new ClientNotFoundError(campaign.clientId);
      }
      throw error;
    }
  }

  async transitionStatusIf(
    campaignId: string,
    expectedStatus: CampaignStatus | readonly CampaignStatus[],
    nextStatus: CampaignStatus,
    options?: { readonly approvedScenes?: number }
  ): Promise<boolean> {
    const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const updateApproved = options?.approvedScenes !== undefined;
    const query = updateApproved
      ? `
      UPDATE campaigns
      SET status = $3, approved_scenes = $4, updated_at = CURRENT_TIMESTAMP
      WHERE campaign_id = $1 AND status = ANY($2::campaign_status_enum[]) AND archived_at IS NULL
      `
      : `
      UPDATE campaigns
      SET status = $3, updated_at = CURRENT_TIMESTAMP
      WHERE campaign_id = $1 AND status = ANY($2::campaign_status_enum[]) AND archived_at IS NULL
      `;
    const params = updateApproved
      ? [campaignId, statuses, nextStatus, options!.approvedScenes]
      : [campaignId, statuses, nextStatus];
    const result = await this.client.query(query, params);
    return (result.rowCount ?? 0) === 1;
  }
}
