import type {
  CampaignReferenceBibleChange,
  CampaignReferenceBibleEntry,
  CampaignReferenceBibleRepository,
  CampaignReferenceBibleRole,
  InitializeCampaignReferenceBibleSnapshotInput,
  InitializeCampaignReferenceBibleSnapshotResult,
  UpdateCampaignReferenceBibleEntryWithAuditInput
} from "@cco/application";
import { StaleBibleEntryConflictError } from "@cco/application";
import type { Pool, PoolClient } from "pg";

interface CampaignReferenceBibleRow {
  campaign_id: string;
  reference_asset_id: string;
  role: string;
  description: string;
  bible_prompt_tag: string;
  source_content_hash_sha256: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CampaignReferenceBibleChangeRow {
  change_id: string;
  campaign_id: string;
  reference_asset_id: string;
  old_role: string | null;
  new_role: string | null;
  old_description: string | null;
  new_description: string | null;
  old_bible_prompt_tag: string | null;
  new_bible_prompt_tag: string | null;
  old_source_content_hash_sha256: string | null;
  new_source_content_hash_sha256: string | null;
  changed_at: Date | string;
  change_reason: string;
  source_scene_id: string;
  source_spec_revision: number;
  source_binding_id: string;
  actor_kind: string;
  actor_id: string | null;
}

function mapRowToEntry(row: CampaignReferenceBibleRow): CampaignReferenceBibleEntry {
  return {
    campaignId: row.campaign_id,
    referenceAssetId: row.reference_asset_id,
    role: row.role as CampaignReferenceBibleRole,
    description: row.description,
    biblePromptTag: row.bible_prompt_tag,
    sourceContentHashSha256: row.source_content_hash_sha256,
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

function mapRowToChange(row: CampaignReferenceBibleChangeRow): CampaignReferenceBibleChange {
  return {
    changeId: row.change_id,
    campaignId: row.campaign_id,
    referenceAssetId: row.reference_asset_id,
    oldRole: (row.old_role as CampaignReferenceBibleRole) ?? null,
    newRole: (row.new_role as CampaignReferenceBibleRole) ?? null,
    oldDescription: row.old_description ?? null,
    newDescription: row.new_description ?? null,
    oldBiblePromptTag: row.old_bible_prompt_tag ?? null,
    newBiblePromptTag: row.new_bible_prompt_tag ?? null,
    oldSourceContentHashSha256: row.old_source_content_hash_sha256 ?? null,
    newSourceContentHashSha256: row.new_source_content_hash_sha256 ?? null,
    changedAt:
      row.changed_at instanceof Date
        ? row.changed_at.toISOString()
        : new Date(row.changed_at).toISOString(),
    changeReason: row.change_reason,
    sourceSceneId: row.source_scene_id,
    sourceSpecRevision: Number(row.source_spec_revision),
    sourceBindingId: row.source_binding_id,
    actorKind: row.actor_kind,
    actorId: row.actor_id ?? null
  };
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

interface ClientWithTransactionStatus {
  getTransactionStatus?: () => string;
}

function isInTransaction(client: PoolClient): boolean {
  const candidate = client as unknown as ClientWithTransactionStatus;
  if (typeof candidate.getTransactionStatus === "function") {
    const status = candidate.getTransactionStatus();
    return status === "T" || status === "E";
  }
  return false;
}

export class PostgresCampaignReferenceBibleRepository implements CampaignReferenceBibleRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async findByCampaignId(campaignId: string): Promise<readonly CampaignReferenceBibleEntry[]> {
    const result = await this.client.query<CampaignReferenceBibleRow>(
      `
      SELECT *
      FROM campaign_reference_bibles
      WHERE campaign_id = $1
      ORDER BY
        CASE WHEN role = 'subject_identity' THEN 0 ELSE 1 END,
        LOWER(reference_asset_id::text) ASC
      `,
      [campaignId]
    );
    return result.rows.map(mapRowToEntry);
  }

  async findByCampaignAndAsset(
    campaignId: string,
    referenceAssetId: string
  ): Promise<CampaignReferenceBibleEntry | null> {
    const result = await this.client.query<CampaignReferenceBibleRow>(
      `
      SELECT *
      FROM campaign_reference_bibles
      WHERE campaign_id = $1 AND reference_asset_id = $2
      LIMIT 1
      `,
      [campaignId, referenceAssetId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapRowToEntry(result.rows[0]!);
  }

  async initializeSnapshot(
    input: InitializeCampaignReferenceBibleSnapshotInput
  ): Promise<InitializeCampaignReferenceBibleSnapshotResult> {
    if (isPool(this.client)) {
      const client = await this.client.connect();
      try {
        const repo = new PostgresCampaignReferenceBibleRepository(client);
        return await repo.initializeSnapshot(input);
      } finally {
        client.release();
      }
    }

    const client = this.client as PoolClient;
    const inTx = isInTransaction(client);

    const existing = await this.findByCampaignId(input.campaignId);
    if (existing.length > 0) {
      return { entries: existing, created: false };
    }

    if (input.entries.length === 0) {
      return { entries: [], created: true };
    }

    if (inTx) {
      try {
        await client.query("SAVEPOINT init_bible_snapshot");
        const inserted: CampaignReferenceBibleEntry[] = [];
        for (const entry of input.entries) {
          const res = await client.query<CampaignReferenceBibleRow>(
            `
            INSERT INTO campaign_reference_bibles (
              campaign_id,
              reference_asset_id,
              role,
              description,
              bible_prompt_tag,
              source_content_hash_sha256,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING *
            `,
            [
              input.campaignId,
              entry.referenceAssetId,
              entry.role,
              entry.description,
              entry.biblePromptTag,
              entry.sourceContentHashSha256
            ]
          );
          inserted.push(mapRowToEntry(res.rows[0]!));
        }
        await client.query("RELEASE SAVEPOINT init_bible_snapshot");
        return { entries: inserted, created: true };
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT init_bible_snapshot");
        const winner = await this.findByCampaignId(input.campaignId);
        if (winner.length > 0) {
          return { entries: winner, created: false };
        }
        throw err;
      }
    } else {
      try {
        await client.query("BEGIN");
        const inserted: CampaignReferenceBibleEntry[] = [];
        for (const entry of input.entries) {
          const res = await client.query<CampaignReferenceBibleRow>(
            `
            INSERT INTO campaign_reference_bibles (
              campaign_id,
              reference_asset_id,
              role,
              description,
              bible_prompt_tag,
              source_content_hash_sha256,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
            RETURNING *
            `,
            [
              input.campaignId,
              entry.referenceAssetId,
              entry.role,
              entry.description,
              entry.biblePromptTag,
              entry.sourceContentHashSha256
            ]
          );
          inserted.push(mapRowToEntry(res.rows[0]!));
        }
        await client.query("COMMIT");
        return { entries: inserted, created: true };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        const winner = await this.findByCampaignId(input.campaignId);
        if (winner.length > 0) {
          return { entries: winner, created: false };
        }
        throw err;
      }
    }
  }

  async updateEntryWithAudit(
    input: UpdateCampaignReferenceBibleEntryWithAuditInput
  ): Promise<CampaignReferenceBibleEntry> {
    if (isPool(this.client)) {
      const client = await this.client.connect();
      try {
        const repo = new PostgresCampaignReferenceBibleRepository(client);
        return await repo.updateEntryWithAudit(input);
      } finally {
        client.release();
      }
    }

    const client = this.client as PoolClient;
    const inTx = isInTransaction(client);
    if (!inTx) {
      await client.query("BEGIN");
      try {
        const result = await this.performUpdateEntryWithAudit(input);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }
    return this.performUpdateEntryWithAudit(input);
  }

  private async performUpdateEntryWithAudit(
    input: UpdateCampaignReferenceBibleEntryWithAuditInput
  ): Promise<CampaignReferenceBibleEntry> {
    const existingRes = await this.client.query<CampaignReferenceBibleRow>(
      `
      SELECT *
      FROM campaign_reference_bibles
      WHERE campaign_id = $1 AND reference_asset_id = $2
      FOR UPDATE
      `,
      [input.campaignId, input.referenceAssetId]
    );
    const existing = existingRes.rows[0];

    if (input.expectedUpdatedAt !== undefined) {
      if (!existing) {
        throw new StaleBibleEntryConflictError(
          input.campaignId,
          input.referenceAssetId,
          input.expectedUpdatedAt,
          undefined
        );
      }
      const existingUpdatedIso = new Date(existing.updated_at).toISOString();
      if (new Date(existing.updated_at).getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
        throw new StaleBibleEntryConflictError(
          input.campaignId,
          input.referenceAssetId,
          input.expectedUpdatedAt,
          existingUpdatedIso
        );
      }
    }

    if (input.next) {
      let savedRow: CampaignReferenceBibleRow;
      if (existing) {
        const updateRes = await this.client.query<CampaignReferenceBibleRow>(
          `
          UPDATE campaign_reference_bibles
          SET
            role = $3,
            description = $4,
            bible_prompt_tag = $5,
            source_content_hash_sha256 = $6,
            updated_at = NOW()
          WHERE campaign_id = $1 AND reference_asset_id = $2
          RETURNING *
          `,
          [
            input.campaignId,
            input.referenceAssetId,
            input.next.role,
            input.next.description,
            input.next.biblePromptTag,
            input.next.sourceContentHashSha256
          ]
        );
        savedRow = updateRes.rows[0]!;
      } else {
        const insertRes = await this.client.query<CampaignReferenceBibleRow>(
          `
          INSERT INTO campaign_reference_bibles (
            campaign_id,
            reference_asset_id,
            role,
            description,
            bible_prompt_tag,
            source_content_hash_sha256,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING *
          `,
          [
            input.campaignId,
            input.referenceAssetId,
            input.next.role,
            input.next.description,
            input.next.biblePromptTag,
            input.next.sourceContentHashSha256
          ]
        );
        savedRow = insertRes.rows[0]!;
      }

      const oldRole =
        input.change.oldRole !== undefined
          ? input.change.oldRole
          : input.change.changeReason === "added"
            ? null
            : (existing?.role ?? null);
      const oldDescription =
        input.change.oldDescription !== undefined
          ? input.change.oldDescription
          : input.change.changeReason === "added"
            ? null
            : (existing?.description ?? null);
      const oldBiblePromptTag =
        input.change.oldBiblePromptTag !== undefined
          ? input.change.oldBiblePromptTag
          : input.change.changeReason === "added"
            ? null
            : (existing?.bible_prompt_tag ?? null);
      const oldSourceContentHashSha256 =
        input.change.oldSourceContentHashSha256 !== undefined
          ? input.change.oldSourceContentHashSha256
          : input.change.changeReason === "added"
            ? null
            : (existing?.source_content_hash_sha256 ?? null);

      await this.client.query(
        `
        INSERT INTO campaign_reference_bible_changes (
          campaign_id,
          reference_asset_id,
          old_role,
          new_role,
          old_description,
          new_description,
          old_bible_prompt_tag,
          new_bible_prompt_tag,
          old_source_content_hash_sha256,
          new_source_content_hash_sha256,
          changed_at,
          change_reason,
          source_scene_id,
          source_spec_revision,
          source_binding_id,
          actor_kind,
          actor_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13, $14, $15, $16
        )
        `,
        [
          input.campaignId,
          input.referenceAssetId,
          oldRole,
          input.next.role,
          oldDescription,
          input.next.description,
          oldBiblePromptTag,
          input.next.biblePromptTag,
          oldSourceContentHashSha256,
          input.next.sourceContentHashSha256,
          input.change.changeReason,
          input.change.sourceSceneId,
          input.change.sourceSpecRevision,
          input.change.sourceBindingId,
          input.change.actorKind,
          input.change.actorId ?? null
        ]
      );

      return mapRowToEntry(savedRow);
    } else {
      if (!existing) {
        throw new Error(
          `Cannot record removal for nonexistent bible entry "${input.referenceAssetId}" in campaign "${input.campaignId}".`
        );
      }

      const updateRes = await this.client.query<CampaignReferenceBibleRow>(
        `
        UPDATE campaign_reference_bibles
        SET updated_at = NOW()
        WHERE campaign_id = $1 AND reference_asset_id = $2
        RETURNING *
        `,
        [input.campaignId, input.referenceAssetId]
      );
      const savedRow = updateRes.rows[0]!;

      await this.client.query(
        `
        INSERT INTO campaign_reference_bible_changes (
          campaign_id,
          reference_asset_id,
          old_role,
          new_role,
          old_description,
          new_description,
          old_bible_prompt_tag,
          new_bible_prompt_tag,
          old_source_content_hash_sha256,
          new_source_content_hash_sha256,
          changed_at,
          change_reason,
          source_scene_id,
          source_spec_revision,
          source_binding_id,
          actor_kind,
          actor_id
        ) VALUES (
          $1, $2, $3, NULL, $4, NULL, $5, NULL, $6, NULL, NOW(), $7, $8, $9, $10, $11, $12
        )
        `,
        [
          input.campaignId,
          input.referenceAssetId,
          existing.role,
          existing.description,
          existing.bible_prompt_tag,
          existing.source_content_hash_sha256,
          input.change.changeReason,
          input.change.sourceSceneId,
          input.change.sourceSpecRevision,
          input.change.sourceBindingId,
          input.change.actorKind,
          input.change.actorId ?? null
        ]
      );

      return mapRowToEntry(savedRow);
    }
  }

  async listChanges(
    campaignId: string,
    referenceAssetId?: string
  ): Promise<readonly CampaignReferenceBibleChange[]> {
    const result = await this.client.query<CampaignReferenceBibleChangeRow>(
      `
      SELECT *
      FROM campaign_reference_bible_changes
      WHERE campaign_id = $1
        AND ($2::uuid IS NULL OR reference_asset_id = $2::uuid)
      ORDER BY changed_at ASC
      `,
      [campaignId, referenceAssetId ?? null]
    );
    return result.rows.map(mapRowToChange);
  }
}
