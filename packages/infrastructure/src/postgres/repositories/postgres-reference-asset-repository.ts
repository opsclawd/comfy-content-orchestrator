import type { ReferenceAssetRepository } from "@cco/application";
import type { ReferenceAsset, ReferenceAssetId, SceneId } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface ReferenceAssetRow {
  asset_id: string;
  scene_id: string;
  asset_type: string;
  storage_bucket: string;
  storage_object_key: string;
  content_hash_sha256: string;
}

export class PostgresReferenceAssetRepository implements ReferenceAssetRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async listBySceneId(sceneId: SceneId): Promise<readonly ReferenceAsset[]> {
    const result = await this.client.query<ReferenceAssetRow>(
      `
      SELECT
        ra.asset_id,
        sra.scene_id,
        ra.asset_type,
        ra.storage_bucket,
        ra.storage_object_key,
        ra.content_hash_sha256
      FROM scene_reference_assets sra
      JOIN reference_assets ra ON ra.asset_id = sra.asset_id
      WHERE sra.scene_id = $1 AND ra.archived_at IS NULL
      ORDER BY ra.created_at ASC
      `,
      [sceneId]
    );

    return Object.freeze(
      result.rows.map((row) => ({
        id: row.asset_id as ReferenceAssetId,
        sceneId: row.scene_id as SceneId,
        assetType: row.asset_type,
        storageBucket: row.storage_bucket,
        storageObjectKey: row.storage_object_key,
        contentHashSha256: row.content_hash_sha256
      }))
    );
  }
}
