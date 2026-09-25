import type { ReferenceAssetRepository, ReferenceAssetRepositoryOptions } from "@cco/application";
import {
  assertValidReferenceRole,
  assertValidReferenceWeight,
  ArchivedReferenceBindingError,
  CrossClientReferenceBindingError,
  ReferenceAssetNotFoundError,
  type ReferenceAsset,
  type ReferenceAssetId,
  type ReferenceGroupId,
  type ReferenceRole,
  type SceneId,
  type SceneReferenceBinding
} from "@cco/domain";
import type { Pool, PoolClient } from "pg";

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

interface ReferenceAssetDbRow {
  asset_id: string;
  client_id: string;
  asset_type?: string | null;
  storage_bucket: string;
  storage_object_key: string;
  content_hash_sha256: string;
  width?: number | null;
  height?: number | null;
  mime_type?: string | null;
  display_name?: string | null;
  description?: string | null;
  library_role?: string | null;
  group_id?: string | null;
  archived_at?: Date | string | null;
  scene_id?: string | null;
}

interface SceneReferenceBindingDbRow {
  scene_id: string;
  spec_revision: number;
  asset_id: string;
  role: string;
  weight?: number | string | null;
  hints?: Record<string, unknown> | null;
  archived_at?: Date | string | null;
}

function mapRowToReferenceAsset(row: ReferenceAssetDbRow, includeSceneId = false): ReferenceAsset {
  const asset: Record<string, unknown> = {
    id: row.asset_id as ReferenceAssetId,
    clientId: row.client_id,
    storageBucket: row.storage_bucket,
    storageObjectKey: row.storage_object_key,
    contentHashSha256: row.content_hash_sha256
  };

  if (includeSceneId && row.scene_id) {
    asset.sceneId = row.scene_id as SceneId;
  }
  if (row.asset_type !== null && row.asset_type !== undefined) {
    asset.assetType = row.asset_type;
  }
  if (row.width !== null && row.width !== undefined) {
    asset.width = Number(row.width);
  }
  if (row.height !== null && row.height !== undefined) {
    asset.height = Number(row.height);
  }
  if (row.mime_type !== null && row.mime_type !== undefined) {
    asset.mimeType = row.mime_type;
  }
  if (row.display_name !== null && row.display_name !== undefined) {
    asset.displayName = row.display_name;
  }
  if (row.description !== null && row.description !== undefined) {
    asset.description = row.description;
  }
  if (row.library_role !== null && row.library_role !== undefined) {
    asset.libraryRole = row.library_role as ReferenceRole;
  }
  if (row.group_id !== null && row.group_id !== undefined) {
    asset.groupId = row.group_id as ReferenceGroupId;
  }
  if (row.archived_at !== null && row.archived_at !== undefined) {
    asset.archivedAt =
      row.archived_at instanceof Date
        ? row.archived_at.toISOString()
        : new Date(row.archived_at).toISOString();
  }

  return Object.freeze(asset as unknown as ReferenceAsset);
}

export class PostgresReferenceAssetRepository implements ReferenceAssetRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async listBySceneId(
    sceneId: SceneId,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "specRevision">
  ): Promise<readonly ReferenceAsset[]> {
    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND ra.archived_at IS NULL";
    const params: unknown[] = [sceneId];
    let specRevFilter = "";
    if (options?.specRevision !== undefined) {
      params.push(options.specRevision);
      specRevFilter = `AND sra.spec_revision = $${params.length}`;
    }

    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      SELECT
        ra.asset_id,
        sra.scene_id,
        ra.client_id,
        ra.asset_type,
        ra.storage_bucket,
        ra.storage_object_key,
        ra.content_hash_sha256,
        ra.width,
        ra.height,
        ra.mime_type,
        ra.display_name,
        ra.description,
        ra.library_role,
        ra.group_id,
        ra.archived_at
      FROM scene_reference_assets sra
      JOIN reference_assets ra ON ra.asset_id = sra.asset_id
      WHERE sra.scene_id = $1 ${archivedFilter} ${specRevFilter}
      ORDER BY ra.created_at ASC
      `,
      params
    );

    return Object.freeze(result.rows.map((row) => mapRowToReferenceAsset(row, true)));
  }

  async findByIds(
    clientId: string,
    ids: readonly ReferenceAssetId[],
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "forUpdate">
  ): Promise<readonly ReferenceAsset[]> {
    if (ids.length === 0) {
      return Object.freeze([]);
    }

    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND archived_at IS NULL";
    const forUpdateClause = options?.forUpdate ? " FOR UPDATE" : "";

    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      SELECT
        asset_id,
        client_id,
        asset_type,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        width,
        height,
        mime_type,
        display_name,
        description,
        library_role,
        group_id,
        archived_at
      FROM reference_assets
      WHERE client_id = $1 AND asset_id = ANY($2) ${archivedFilter}
      ORDER BY created_at ASC
      ${forUpdateClause}
      `,
      [clientId, [...ids]]
    );

    return Object.freeze(result.rows.map((row) => mapRowToReferenceAsset(row, false)));
  }

  async findByIdsGlobal(
    ids: readonly ReferenceAssetId[],
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "forUpdate">
  ): Promise<readonly ReferenceAsset[]> {
    if (ids.length === 0) {
      return Object.freeze([]);
    }

    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND archived_at IS NULL";
    const forUpdateClause = options?.forUpdate ? " FOR UPDATE" : "";

    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      SELECT
        asset_id,
        client_id,
        asset_type,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        width,
        height,
        mime_type,
        display_name,
        description,
        library_role,
        group_id,
        archived_at
      FROM reference_assets
      WHERE asset_id = ANY($1) ${archivedFilter}
      ORDER BY created_at ASC
      ${forUpdateClause}
      `,
      [[...ids]]
    );

    return Object.freeze(result.rows.map((row) => mapRowToReferenceAsset(row, false)));
  }

  async findByClientId(
    clientId: string,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "groupId">
  ): Promise<readonly ReferenceAsset[]> {
    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND archived_at IS NULL";
    const params: unknown[] = [clientId];
    let groupFilter = "";
    if (options?.groupId !== undefined) {
      params.push(options.groupId);
      groupFilter = `AND group_id = $${params.length}`;
    }

    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      SELECT
        asset_id,
        client_id,
        asset_type,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        width,
        height,
        mime_type,
        display_name,
        description,
        library_role,
        group_id,
        archived_at
      FROM reference_assets
      WHERE client_id = $1 ${archivedFilter} ${groupFilter}
      ORDER BY created_at ASC
      `,
      params
    );

    return Object.freeze(result.rows.map((row) => mapRowToReferenceAsset(row, false)));
  }

  async listBindingsBySceneId(
    sceneId: SceneId,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "specRevision">
  ): Promise<readonly SceneReferenceBinding[]> {
    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND archived_at IS NULL";
    const params: unknown[] = [sceneId];
    let specRevFilter = "";
    if (options?.specRevision !== undefined) {
      params.push(options.specRevision);
      specRevFilter = `AND spec_revision = $${params.length}`;
    }

    const result = await this.client.query<SceneReferenceBindingDbRow>(
      `
      SELECT
        scene_id,
        spec_revision,
        asset_id,
        role,
        weight,
        hints,
        archived_at
      FROM scene_reference_assets
      WHERE scene_id = $1 ${archivedFilter} ${specRevFilter}
      ORDER BY asset_id ASC
      `,
      params
    );

    return Object.freeze(
      result.rows.map((row) => {
        const binding: {
          sceneId: SceneId;
          specRevision: number;
          referenceAssetId: ReferenceAssetId;
          role: ReferenceRole;
          weight: number | null;
          hints: Record<string, unknown> | null;
          archivedAt?: string;
        } = {
          sceneId: row.scene_id as SceneId,
          specRevision: Number(row.spec_revision),
          referenceAssetId: row.asset_id as ReferenceAssetId,
          role: row.role as ReferenceRole,
          weight: row.weight !== null && row.weight !== undefined ? Number(row.weight) : null,
          hints: row.hints ?? null
        };
        if (row.archived_at) {
          binding.archivedAt =
            row.archived_at instanceof Date
              ? row.archived_at.toISOString()
              : new Date(row.archived_at).toISOString();
        }
        return Object.freeze(binding as SceneReferenceBinding);
      })
    );
  }

  async saveBindings(sceneId: SceneId, bindings: readonly SceneReferenceBinding[]): Promise<void> {
    if (isPool(this.client)) {
      const client = await this.client.connect();
      try {
        await client.query("BEGIN");
        await this.persistBindings(client, sceneId, bindings);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } else {
      await this.persistBindings(this.client, sceneId, bindings);
    }
  }

  private async persistBindings(
    client: Pool | PoolClient,
    sceneId: SceneId,
    bindings: readonly SceneReferenceBinding[]
  ): Promise<void> {
    const sceneOwnerRes = await client.query<{ client_id: string }>(
      `
      SELECT c.client_id
      FROM storyboard_scenes s
      JOIN campaigns c ON c.campaign_id = s.campaign_id
      WHERE s.scene_id = $1
      `,
      [sceneId]
    );

    const campaignClientId = sceneOwnerRes.rows[0]?.client_id;
    if (!campaignClientId) {
      throw new Error(`Scene "${sceneId}" not found or has no owning campaign.`);
    }

    if (bindings.length === 0) {
      return;
    }

    for (const binding of bindings) {
      assertValidReferenceRole(binding.role);
      assertValidReferenceWeight(binding.weight);
    }

    const assetIds = [...new Set(bindings.map((b) => b.referenceAssetId))];
    const assetsRes = await client.query<{
      asset_id: string;
      client_id: string;
      archived_at: Date | string | null;
    }>(
      `
      SELECT asset_id, client_id, archived_at
      FROM reference_assets
      WHERE asset_id = ANY($1)
      `,
      [assetIds]
    );

    const assetMap = new Map(assetsRes.rows.map((row) => [row.asset_id, row]));

    for (const binding of bindings) {
      const asset = assetMap.get(binding.referenceAssetId);
      if (!asset) {
        throw new ReferenceAssetNotFoundError(binding.referenceAssetId);
      }
      if (asset.client_id !== campaignClientId) {
        throw new CrossClientReferenceBindingError(
          campaignClientId,
          binding.referenceAssetId,
          asset.client_id
        );
      }
      if (asset.archived_at != null) {
        throw new ArchivedReferenceBindingError(binding.referenceAssetId);
      }
    }

    const targetRevisions = [...new Set(bindings.map((b) => b.specRevision))];
    for (const rev of targetRevisions) {
      await client.query(
        `DELETE FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = $2`,
        [sceneId, rev]
      );
    }

    for (const binding of bindings) {
      await client.query(
        `
        INSERT INTO scene_reference_assets (
          scene_id,
          asset_id,
          spec_revision,
          role,
          weight,
          hints,
          archived_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (scene_id, spec_revision, asset_id, role) DO UPDATE SET
          weight = EXCLUDED.weight,
          hints = EXCLUDED.hints,
          archived_at = EXCLUDED.archived_at
        `,
        [
          sceneId,
          binding.referenceAssetId,
          binding.specRevision,
          binding.role,
          binding.weight ?? null,
          binding.hints ? JSON.stringify(binding.hints) : null,
          binding.archivedAt ? new Date(binding.archivedAt) : null
        ]
      );
    }
  }

  async save(asset: ReferenceAsset): Promise<ReferenceAsset> {
    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      INSERT INTO reference_assets (
        asset_id,
        client_id,
        asset_type,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        width,
        height,
        mime_type,
        display_name,
        description,
        library_role,
        group_id,
        archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (asset_id) DO UPDATE SET
        group_id = EXCLUDED.group_id,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        mime_type = EXCLUDED.mime_type,
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        library_role = EXCLUDED.library_role,
        archived_at = EXCLUDED.archived_at
      WHERE reference_assets.client_id = EXCLUDED.client_id
      RETURNING *
      `,
      [
        asset.id,
        asset.clientId,
        asset.assetType ?? "image",
        asset.storageBucket,
        asset.storageObjectKey,
        asset.contentHashSha256,
        asset.width ?? null,
        asset.height ?? null,
        asset.mimeType ?? "image/png",
        asset.displayName ?? null,
        asset.description ?? null,
        asset.libraryRole ?? null,
        asset.groupId ?? null,
        asset.archivedAt ? new Date(asset.archivedAt) : null
      ]
    );

    const savedRow = result.rows[0];
    if (!savedRow) {
      const existing = await this.client.query<ReferenceAssetDbRow>(
        `SELECT client_id FROM reference_assets WHERE asset_id = $1`,
        [asset.id]
      );
      if (existing.rows[0] && existing.rows[0].client_id !== asset.clientId) {
        throw new Error(
          `Inconsistent client ownership: asset belongs to client ${existing.rows[0].client_id}, not ${asset.clientId}`
        );
      }
      throw new Error("Failed to save reference asset");
    }
    return mapRowToReferenceAsset(savedRow, false);
  }

  async archive(clientId: string, id: ReferenceAssetId): Promise<boolean> {
    const result = await this.client.query(
      `
      UPDATE reference_assets
      SET archived_at = CURRENT_TIMESTAMP
      WHERE asset_id = $1 AND client_id = $2 AND archived_at IS NULL
      `,
      [id, clientId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateLibraryRole(
    clientId: string,
    id: ReferenceAssetId,
    role: ReferenceRole
  ): Promise<ReferenceAsset | undefined> {
    assertValidReferenceRole(role);
    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      UPDATE reference_assets
      SET library_role = $3
      WHERE asset_id = $1 AND client_id = $2 AND archived_at IS NULL
      RETURNING *
      `,
      [id, clientId, role]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return mapRowToReferenceAsset(row, false);
  }

  async findByClientAndContentHash(
    clientId: string,
    contentHashSha256: string,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived">
  ): Promise<ReferenceAsset | undefined> {
    const includeArchived = options?.includeArchived ?? false;
    const archivedFilter = includeArchived ? "" : "AND archived_at IS NULL";

    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      SELECT
        asset_id,
        client_id,
        asset_type,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        width,
        height,
        mime_type,
        display_name,
        description,
        library_role,
        group_id,
        archived_at
      FROM reference_assets
      WHERE client_id = $1 AND content_hash_sha256 = $2 ${archivedFilter}
      ORDER BY archived_at NULLS FIRST, created_at ASC
      LIMIT 1
      `,
      [clientId, contentHashSha256]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }
    return mapRowToReferenceAsset(row, false);
  }

  async saveOrReactivateByContentHash(asset: ReferenceAsset): Promise<ReferenceAsset> {
    const result = await this.client.query<ReferenceAssetDbRow>(
      `
      INSERT INTO reference_assets (
        asset_id,
        client_id,
        asset_type,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        width,
        height,
        mime_type,
        display_name,
        description,
        library_role,
        group_id,
        archived_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL)
      ON CONFLICT (storage_bucket, storage_object_key) DO UPDATE SET
        archived_at = NULL,
        description = COALESCE(EXCLUDED.description, reference_assets.description),
        library_role = COALESCE(EXCLUDED.library_role, reference_assets.library_role)
      WHERE reference_assets.client_id = EXCLUDED.client_id
        AND reference_assets.content_hash_sha256 = EXCLUDED.content_hash_sha256
      RETURNING *
      `,
      [
        asset.id,
        asset.clientId,
        asset.assetType ?? "image",
        asset.storageBucket,
        asset.storageObjectKey,
        asset.contentHashSha256,
        asset.width ?? null,
        asset.height ?? null,
        asset.mimeType ?? "image/png",
        asset.displayName ?? null,
        asset.description ?? null,
        asset.libraryRole ?? null,
        asset.groupId ?? null
      ]
    );

    const savedRow = result.rows[0];
    if (!savedRow) {
      const conflictResult = await this.client.query<ReferenceAssetDbRow>(
        `
        SELECT asset_id, client_id, content_hash_sha256, storage_bucket, storage_object_key
        FROM reference_assets
        WHERE storage_bucket = $1 AND storage_object_key = $2
        `,
        [asset.storageBucket, asset.storageObjectKey]
      );
      const conflictRow = conflictResult.rows[0];
      if (conflictRow) {
        if (conflictRow.client_id !== asset.clientId) {
          throw new Error(
            `Inconsistent client ownership: asset key belongs to client ${conflictRow.client_id}, not ${asset.clientId}`
          );
        }
        if (conflictRow.content_hash_sha256 !== asset.contentHashSha256) {
          throw new Error(
            `Inconsistent content hash: asset key has hash ${conflictRow.content_hash_sha256}, not ${asset.contentHashSha256}`
          );
        }
      }
      throw new Error("Failed to save or reactivate reference asset");
    }

    if (savedRow.client_id !== asset.clientId) {
      throw new Error(
        `Inconsistent client ownership: asset key belongs to client ${savedRow.client_id}, not ${asset.clientId}`
      );
    }
    if (savedRow.content_hash_sha256 !== asset.contentHashSha256) {
      throw new Error(
        `Inconsistent content hash: asset key has hash ${savedRow.content_hash_sha256}, not ${asset.contentHashSha256}`
      );
    }
    if (
      savedRow.storage_bucket !== asset.storageBucket ||
      savedRow.storage_object_key !== asset.storageObjectKey
    ) {
      throw new Error("Returned row storage bucket or key does not match requested asset");
    }

    return mapRowToReferenceAsset(savedRow, false);
  }

  async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (isPool(this.client)) {
      const client = await this.client.connect();
      try {
        await client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
        try {
          return await action();
        } finally {
          await client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => {});
        }
      } finally {
        client.release();
      }
    } else {
      await this.client.query("SELECT pg_advisory_lock(hashtext($1))", [key]);
      try {
        return await action();
      } finally {
        await this.client.query("SELECT pg_advisory_unlock(hashtext($1))", [key]).catch(() => {});
      }
    }
  }
}
