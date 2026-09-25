import type { ReferenceGroupRepository, ReferenceGroupRepositoryOptions } from "@cco/application";
import type { CampaignId, ReferenceGroup, ReferenceGroupId } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface ReferenceGroupDbRow {
  group_id: string;
  client_id: string;
  campaign_id?: string | null;
  name: string;
  description?: string | null;
  created_at: Date | string;
  archived_at?: Date | string | null;
}

function mapRowToReferenceGroup(row: ReferenceGroupDbRow): ReferenceGroup {
  return Object.freeze({
    id: row.group_id as ReferenceGroupId,
    clientId: row.client_id,
    ...(row.campaign_id !== null && row.campaign_id !== undefined
      ? { campaignId: row.campaign_id as CampaignId }
      : {}),
    name: row.name,
    ...(row.description !== null && row.description !== undefined
      ? { description: row.description }
      : {}),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    ...(row.archived_at !== null && row.archived_at !== undefined
      ? {
          archivedAt:
            row.archived_at instanceof Date
              ? row.archived_at.toISOString()
              : new Date(row.archived_at).toISOString()
        }
      : {})
  });
}

export class PostgresReferenceGroupRepository implements ReferenceGroupRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async findById(groupId: ReferenceGroupId): Promise<ReferenceGroup | undefined> {
    const result = await this.client.query<ReferenceGroupDbRow>(
      `
      SELECT
        group_id,
        client_id,
        campaign_id,
        name,
        description,
        created_at,
        archived_at
      FROM reference_groups
      WHERE group_id = $1
      `,
      [groupId]
    );

    const row = result.rows[0];
    return row ? mapRowToReferenceGroup(row) : undefined;
  }

  async findByClientId(
    clientId: string,
    options?: ReferenceGroupRepositoryOptions
  ): Promise<readonly ReferenceGroup[]> {
    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND archived_at IS NULL";
    const params: unknown[] = [clientId];
    let campaignFilter = "";
    if (options?.campaignId !== undefined) {
      params.push(options.campaignId);
      campaignFilter = `AND campaign_id = $${params.length}`;
    }

    const result = await this.client.query<ReferenceGroupDbRow>(
      `
      SELECT
        group_id,
        client_id,
        campaign_id,
        name,
        description,
        created_at,
        archived_at
      FROM reference_groups
      WHERE client_id = $1 ${archivedFilter} ${campaignFilter}
      ORDER BY created_at ASC
      `,
      params
    );

    return Object.freeze(result.rows.map(mapRowToReferenceGroup));
  }

  async save(group: ReferenceGroup): Promise<ReferenceGroup> {
    const result = await this.client.query<ReferenceGroupDbRow>(
      `
      INSERT INTO reference_groups (
        group_id,
        client_id,
        campaign_id,
        name,
        description,
        created_at,
        archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (group_id) DO UPDATE SET
        campaign_id = EXCLUDED.campaign_id,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        archived_at = EXCLUDED.archived_at
      RETURNING *
      `,
      [
        group.id,
        group.clientId,
        group.campaignId ?? null,
        group.name,
        group.description ?? null,
        group.createdAt ? new Date(group.createdAt) : new Date(),
        group.archivedAt ? new Date(group.archivedAt) : null
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error("Failed to save reference group");
    }
    return mapRowToReferenceGroup(row);
  }

  async archive(clientId: string, groupId: ReferenceGroupId): Promise<boolean> {
    const result = await this.client.query(
      `
      UPDATE reference_groups
      SET archived_at = CURRENT_TIMESTAMP
      WHERE group_id = $1 AND client_id = $2 AND archived_at IS NULL
      `,
      [groupId, clientId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}
