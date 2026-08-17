import type { SceneRepository } from "@cco/application";
import type { CampaignId, CandidateId, SceneId, SceneSnapshot, SceneStatus } from "@cco/domain";
import { Scene } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

export interface PostgresSceneRepositoryOptions {
  readonly forUpdate?: boolean;
}

interface StoryboardSceneRow {
  scene_id: string;
  campaign_id: string;
  scene_order: number;
  duration_seconds: string | number;
  shot_type: string;
  visual_description: string;
  voiceover_copy: string | null;
  audio_fx_prompt: string | null;
  engine_assigned: string;
  status: string;
  spec_revision: number;
  draft_storage_bucket: string | null;
  draft_storage_object_key: string | null;
  director_notes: string | null;
  selected_candidate_id: string | null;
  selected_candidate_revision: number | null;
  lora_configuration_id: string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  approved_revision: number | null;
  failed_from: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  reference_asset_ids: string[] | null;
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

export class PostgresSceneRepository implements SceneRepository {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly options: PostgresSceneRepositoryOptions = {}
  ) {}

  async findById(
    sceneId: SceneId,
    options?: PostgresSceneRepositoryOptions
  ): Promise<Scene | undefined> {
    const forUpdate = options?.forUpdate ?? this.options.forUpdate ?? false;
    if (forUpdate && isPool(this.client)) {
      throw new Error(
        "Cannot execute findById with forUpdate: true using a pg Pool instance. A transaction-bound PoolClient is required for row locking."
      );
    }
    const lockClause = forUpdate ? " FOR UPDATE" : "";

    const sceneResult = await this.client.query<StoryboardSceneRow>(
      `
      SELECT
        s.scene_id,
        s.campaign_id,
        s.scene_order,
        s.duration_seconds,
        s.shot_type,
        s.visual_description,
        s.voiceover_copy,
        s.audio_fx_prompt,
        s.engine_assigned,
        s.status,
        s.spec_revision,
        s.draft_storage_bucket,
        s.draft_storage_object_key,
        s.director_notes,
        s.selected_candidate_id,
        s.selected_candidate_revision,
        s.lora_configuration_id,
        s.approved_by,
        s.approved_at,
        s.approved_revision,
        s.failed_from,
        s.created_at,
        s.updated_at,
        s.archived_at,
        COALESCE(
          (
            SELECT array_agg(sra.asset_id::text ORDER BY sra.asset_id ASC)
            FROM scene_reference_assets sra
            WHERE sra.scene_id = s.scene_id
          ),
          '{}'
        ) AS reference_asset_ids
      FROM storyboard_scenes s
      WHERE s.scene_id = $1
      ${lockClause}
      `,
      [sceneId]
    );

    const row = sceneResult.rows[0];
    if (!row) {
      return undefined;
    }

    const referenceIds = Object.freeze(
      Array.isArray(row.reference_asset_ids) ? row.reference_asset_ids : []
    );

    const durationSeconds =
      typeof row.duration_seconds === "number"
        ? row.duration_seconds
        : parseFloat(row.duration_seconds);
    const durationMs = Math.round(durationSeconds * 1000);

    const approval =
      row.approved_by && row.approved_at && row.approved_revision != null
        ? {
            revision: Number(row.approved_revision),
            approvedBy: row.approved_by,
            approvedAt:
              row.approved_at instanceof Date
                ? row.approved_at.toISOString()
                : new Date(row.approved_at).toISOString()
          }
        : undefined;

    const snapshot: SceneSnapshot = {
      id: row.scene_id as SceneId,
      campaignId: row.campaign_id as CampaignId,
      status: row.status as SceneStatus,
      specRevision: Number(row.spec_revision),
      configuration: {
        prompt: row.visual_description,
        referenceIds,
        engineProfileId: row.engine_assigned,
        durationMs,
        ...(row.lora_configuration_id ? { loraConfigurationId: row.lora_configuration_id } : {})
      },
      ...(approval !== undefined ? { approval } : {}),
      ...(row.failed_from ? { failedFrom: row.failed_from as SceneStatus } : {}),
      ...(row.selected_candidate_id
        ? { selectedCandidateId: row.selected_candidate_id as CandidateId }
        : {}),
      ...(row.selected_candidate_revision != null
        ? { selectedCandidateRevision: Number(row.selected_candidate_revision) }
        : {})
    };

    return Scene.reconstitute(snapshot);
  }

  async save(scene: Scene): Promise<void> {
    if (isPool(this.client)) {
      const client = await this.client.connect();
      try {
        await client.query("BEGIN");
        await this.persistScene(client, scene);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } else {
      await this.persistScene(this.client, scene);
    }
  }

  private async persistScene(client: Pool | PoolClient, scene: Scene): Promise<void> {
    const snapshot = scene.snapshot();
    const durationSeconds = (snapshot.configuration.durationMs / 1000).toFixed(2);
    const approvedAt = snapshot.approval ? new Date(snapshot.approval.approvedAt) : null;
    const approvedBy = snapshot.approval?.approvedBy ?? null;
    const approvedRevision = snapshot.approval?.revision ?? null;
    const loraConfigurationId = snapshot.configuration.loraConfigurationId ?? null;
    const selectedCandidateId = snapshot.selectedCandidateId ?? null;
    const selectedCandidateRevision = snapshot.selectedCandidateRevision ?? null;
    const failedFrom = snapshot.failedFrom ?? null;

    const updateResult = await client.query(
      `
      UPDATE storyboard_scenes
      SET
        status = $2,
        spec_revision = $3,
        visual_description = $4,
        engine_assigned = $5,
        duration_seconds = $6,
        lora_configuration_id = $7,
        selected_candidate_id = $8,
        selected_candidate_revision = $9,
        approved_by = $10,
        approved_at = $11,
        approved_revision = $12,
        failed_from = $13,
        updated_at = CURRENT_TIMESTAMP
      WHERE scene_id = $1
      `,
      [
        snapshot.id,
        snapshot.status,
        snapshot.specRevision,
        snapshot.configuration.prompt,
        snapshot.configuration.engineProfileId,
        durationSeconds,
        loraConfigurationId,
        selectedCandidateId,
        selectedCandidateRevision,
        approvedBy,
        approvedAt,
        approvedRevision,
        failedFrom
      ]
    );

    if ((updateResult.rowCount ?? 0) === 0) {
      await client.query(`SELECT campaign_id FROM campaigns WHERE campaign_id = $1 FOR UPDATE`, [
        snapshot.campaignId
      ]);

      await client.query(
        `
        INSERT INTO storyboard_scenes (
          scene_id,
          campaign_id,
          scene_order,
          duration_seconds,
          shot_type,
          visual_description,
          engine_assigned,
          status,
          spec_revision,
          lora_configuration_id,
          selected_candidate_id,
          selected_candidate_revision,
          approved_by,
          approved_at,
          approved_revision,
          failed_from,
          updated_at
        ) VALUES (
          $1,
          $2,
          COALESCE((SELECT COALESCE(MAX(s.scene_order), 0) + 1 FROM storyboard_scenes s WHERE s.campaign_id = $2), 1),
          $3,
          'wide',
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          CURRENT_TIMESTAMP
        )
        `,
        [
          snapshot.id,
          snapshot.campaignId,
          durationSeconds,
          snapshot.configuration.prompt,
          snapshot.configuration.engineProfileId,
          snapshot.status,
          snapshot.specRevision,
          loraConfigurationId,
          selectedCandidateId,
          selectedCandidateRevision,
          approvedBy,
          approvedAt,
          approvedRevision,
          failedFrom
        ]
      );
    }

    // Synchronize reference asset associations
    await client.query(`DELETE FROM scene_reference_assets WHERE scene_id = $1`, [snapshot.id]);

    const uniqueReferenceIds = [...new Set(snapshot.configuration.referenceIds)];
    if (uniqueReferenceIds.length > 0) {
      const placeholders = uniqueReferenceIds.map((_, idx) => `($1, $${idx + 2})`).join(", ");
      await client.query(
        `
        INSERT INTO scene_reference_assets (scene_id, asset_id)
        VALUES ${placeholders}
        ON CONFLICT (scene_id, asset_id) DO NOTHING
        `,
        [snapshot.id, ...uniqueReferenceIds]
      );
    }
  }
}
