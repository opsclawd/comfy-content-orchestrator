import type { SceneRepository } from "@cco/application";
import type {
  CampaignId,
  CandidateId,
  ReferenceAssetId,
  ReferenceRole,
  SceneId,
  SceneReferenceBinding,
  SceneSnapshot,
  SceneStatus,
  ShotPlanId,
  ShotPlanRoutingMode
} from "@cco/domain";
import {
  ArchivedReferenceBindingError,
  CrossClientReferenceBindingError,
  ReferenceAssetNotFoundError,
  Scene
} from "@cco/domain";
import type { Pool, PoolClient } from "pg";

export interface PostgresSceneRepositoryOptions {
  readonly forUpdate?: boolean;
  readonly includeArchived?: boolean;
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
  selected_shot_plan_id: string | null;
  selected_shot_plan_revision: number | null;
  approved_shot_plan_id: string | null;
  approved_shot_plan_revision: number | null;
  production_routing_mode: string | null;
  lora_configuration_id: string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
  approved_revision: number | null;
  failed_from: string | null;
  active_production_job_id: string | null;
  production_attempt_ordinal: number | null;
  accepted_production_attempt_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
  reference_asset_ids: string[] | null;
  reference_bindings: Array<{
    sceneId: string;
    specRevision: number;
    referenceAssetId: string;
    role: string;
    weight: number | null;
    hints: Record<string, unknown> | null;
    archivedAt: Date | string | null;
  }> | null;
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

function mapRowToScene(row: StoryboardSceneRow): Scene {
  const referenceBindings: readonly SceneReferenceBinding[] = Array.isArray(row.reference_bindings)
    ? Object.freeze(
        row.reference_bindings.map((b) => {
          const binding: {
            sceneId: SceneId;
            specRevision: number;
            referenceAssetId: ReferenceAssetId;
            role: ReferenceRole;
            weight: number | null;
            hints: Record<string, unknown> | null;
            archivedAt?: string;
          } = {
            sceneId: b.sceneId as SceneId,
            specRevision: Number(b.specRevision),
            referenceAssetId: b.referenceAssetId as ReferenceAssetId,
            role: b.role as ReferenceRole,
            weight: b.weight !== null && b.weight !== undefined ? Number(b.weight) : null,
            hints: b.hints ?? null
          };
          if (b.archivedAt) {
            binding.archivedAt =
              b.archivedAt instanceof Date
                ? b.archivedAt.toISOString()
                : new Date(b.archivedAt).toISOString();
          }
          return Object.freeze(binding as SceneReferenceBinding);
        })
      )
    : [];

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
    sequenceIndex: Number(row.scene_order),
    configuration: {
      prompt: row.visual_description,
      referenceIds,
      ...(referenceBindings.length > 0 ? { referenceBindings } : {}),
      engineProfileId: row.engine_assigned,
      durationMs,
      loraConfigurationId: row.lora_configuration_id
    },
    ...(approval !== undefined ? { approval } : {}),
    ...(row.failed_from ? { failedFrom: row.failed_from as SceneStatus } : {}),
    ...(row.selected_candidate_id
      ? { selectedCandidateId: row.selected_candidate_id as CandidateId }
      : {}),
    ...(row.selected_candidate_revision != null
      ? { selectedCandidateRevision: Number(row.selected_candidate_revision) }
      : {}),
    ...(row.selected_shot_plan_id
      ? { selectedShotPlanId: row.selected_shot_plan_id as ShotPlanId }
      : {}),
    ...(row.selected_shot_plan_revision != null
      ? { selectedShotPlanRevision: Number(row.selected_shot_plan_revision) }
      : {}),
    ...(row.approved_shot_plan_id
      ? { approvedShotPlanId: row.approved_shot_plan_id as ShotPlanId }
      : {}),
    ...(row.approved_shot_plan_revision != null
      ? { approvedShotPlanRevision: Number(row.approved_shot_plan_revision) }
      : {}),
    ...(row.production_routing_mode
      ? { productionRoutingMode: row.production_routing_mode as ShotPlanRoutingMode }
      : {}),
    ...(row.active_production_job_id
      ? { activeProductionJobId: row.active_production_job_id }
      : {}),
    ...(row.production_attempt_ordinal != null && Number(row.production_attempt_ordinal) > 0
      ? { productionAttemptOrdinal: Number(row.production_attempt_ordinal) }
      : {}),
    ...(row.accepted_production_attempt_id
      ? { acceptedProductionAttemptId: row.accepted_production_attempt_id }
      : {})
  };

  return Scene.reconstitute(snapshot);
}

function weightsEqual(
  w1: string | number | null | undefined,
  w2: string | number | null | undefined
): boolean {
  if (w1 == null && w2 == null) return true;
  if (w1 == null || w2 == null) return false;
  return Number(w1) === Number(w2);
}

function hintsEqual(h1: unknown, h2: unknown): boolean {
  const norm1 =
    h1 == null || (typeof h1 === "object" && Object.keys(h1 as object).length === 0)
      ? null
      : JSON.stringify(h1);
  const norm2 =
    h2 == null || (typeof h2 === "object" && Object.keys(h2 as object).length === 0)
      ? null
      : JSON.stringify(h2);
  return norm1 === norm2;
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
        s.selected_shot_plan_id,
        s.selected_shot_plan_revision,
        s.approved_shot_plan_id,
        s.approved_shot_plan_revision,
        s.production_routing_mode,
        s.lora_configuration_id,
        s.approved_by,
        s.approved_at,
        s.approved_revision,
        s.failed_from,
        s.active_production_job_id,
        s.production_attempt_ordinal,
        s.accepted_production_attempt_id,
        s.created_at,
        s.updated_at,
        s.archived_at,
        COALESCE(
          (
            SELECT array_agg(DISTINCT sra.asset_id::text ORDER BY sra.asset_id::text ASC)
            FROM scene_reference_assets sra
            WHERE sra.scene_id = s.scene_id AND sra.spec_revision = s.spec_revision AND sra.archived_at IS NULL
          ),
          '{}'
        ) AS reference_asset_ids,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'sceneId', sra.scene_id,
                'specRevision', sra.spec_revision,
                'referenceAssetId', sra.asset_id,
                'role', sra.role,
                'weight', sra.weight,
                'hints', sra.hints,
                'archivedAt', sra.archived_at
              )
              ORDER BY sra.asset_id ASC, sra.role ASC
            )
            FROM scene_reference_assets sra
            WHERE sra.scene_id = s.scene_id AND sra.spec_revision = s.spec_revision
          ),
          '[]'::json
        ) AS reference_bindings
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

    return mapRowToScene(row);
  }

  async findByCampaignId(
    campaignId: CampaignId,
    options?: PostgresSceneRepositoryOptions
  ): Promise<Scene[]> {
    const forUpdate = options?.forUpdate ?? this.options.forUpdate ?? false;
    const includeArchived = options?.includeArchived ?? this.options.includeArchived ?? false;
    if (forUpdate && isPool(this.client)) {
      throw new Error(
        "Cannot execute findByCampaignId with forUpdate: true using a pg Pool instance. A transaction-bound PoolClient is required for row locking."
      );
    }
    const lockClause = forUpdate ? " FOR UPDATE" : "";
    const archivedClause = includeArchived ? "" : " AND s.archived_at IS NULL";

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
        s.selected_shot_plan_id,
        s.selected_shot_plan_revision,
        s.approved_shot_plan_id,
        s.approved_shot_plan_revision,
        s.production_routing_mode,
        s.lora_configuration_id,
        s.approved_by,
        s.approved_at,
        s.approved_revision,
        s.failed_from,
        s.active_production_job_id,
        s.production_attempt_ordinal,
        s.accepted_production_attempt_id,
        s.created_at,
        s.updated_at,
        s.archived_at,
        COALESCE(
          (
            SELECT array_agg(DISTINCT sra.asset_id::text ORDER BY sra.asset_id::text ASC)
            FROM scene_reference_assets sra
            WHERE sra.scene_id = s.scene_id AND sra.spec_revision = s.spec_revision AND sra.archived_at IS NULL
          ),
          '{}'
        ) AS reference_asset_ids,
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'sceneId', sra.scene_id,
                'specRevision', sra.spec_revision,
                'referenceAssetId', sra.asset_id,
                'role', sra.role,
                'weight', sra.weight,
                'hints', sra.hints,
                'archivedAt', sra.archived_at
              )
              ORDER BY sra.asset_id ASC, sra.role ASC
            )
            FROM scene_reference_assets sra
            WHERE sra.scene_id = s.scene_id AND sra.spec_revision = s.spec_revision
          ),
          '[]'::json
        ) AS reference_bindings
      FROM storyboard_scenes s
      WHERE s.campaign_id = $1${archivedClause}
      ORDER BY s.scene_order ASC
      ${lockClause}
      `,
      [campaignId]
    );

    return sceneResult.rows.map(mapRowToScene);
  }

  async findCampaignIdBySceneId(sceneId: SceneId): Promise<CampaignId | undefined> {
    const result = await this.client.query<{ campaign_id: string }>(
      `
      SELECT campaign_id
      FROM storyboard_scenes
      WHERE scene_id = $1 AND archived_at IS NULL
      `,
      [sceneId]
    );

    const row = result.rows[0];
    return row ? (row.campaign_id as CampaignId) : undefined;
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
    const durationSeconds = (snapshot.configuration.durationMs / 1000).toFixed(3);
    const approvedAt = snapshot.approval ? new Date(snapshot.approval.approvedAt) : null;
    const approvedBy = snapshot.approval?.approvedBy ?? null;
    const approvedRevision = snapshot.approval?.revision ?? null;
    const loraConfigurationId = snapshot.configuration.loraConfigurationId ?? null;
    const selectedCandidateId = snapshot.selectedCandidateId ?? null;
    const selectedCandidateRevision = snapshot.selectedCandidateRevision ?? null;
    const selectedShotPlanId = snapshot.selectedShotPlanId ?? null;
    const selectedShotPlanRevision = snapshot.selectedShotPlanRevision ?? null;
    const approvedShotPlanId = snapshot.approvedShotPlanId ?? null;
    const approvedShotPlanRevision = snapshot.approvedShotPlanRevision ?? null;
    const productionRoutingMode = snapshot.productionRoutingMode ?? null;
    const failedFrom = snapshot.failedFrom ?? null;
    const activeProductionJobId = snapshot.activeProductionJobId ?? null;
    const productionAttemptOrdinal = snapshot.productionAttemptOrdinal ?? 0;
    const acceptedProductionAttemptId = snapshot.acceptedProductionAttemptId ?? null;

    const allRequestedRefIds = [
      ...new Set([
        ...snapshot.configuration.referenceIds,
        ...(snapshot.configuration.referenceBindings ?? []).map((b) => b.referenceAssetId)
      ])
    ];

    if (allRequestedRefIds.length > 0) {
      const campaignRes = await client.query<{ client_id: string }>(
        `SELECT client_id FROM campaigns WHERE campaign_id = $1`,
        [snapshot.campaignId]
      );
      const campaignClientId = campaignRes.rows[0]?.client_id;
      if (!campaignClientId) {
        throw new Error(`Campaign "${snapshot.campaignId}" not found for scene "${snapshot.id}".`);
      }

      const sortedRequestedRefIds = [...allRequestedRefIds].sort();
      const assetsRes = await client.query<{
        asset_id: string;
        client_id: string;
        archived_at: Date | string | null;
      }>(
        `SELECT asset_id, client_id, archived_at FROM reference_assets WHERE asset_id = ANY($1) ORDER BY asset_id ASC FOR UPDATE`,
        [sortedRequestedRefIds]
      );
      const assetMap = new Map(assetsRes.rows.map((row) => [row.asset_id, row]));

      const existingBindingsRes = await client.query<{
        asset_id: string;
        role: string;
        weight: string | number | null;
        hints: Record<string, unknown> | null;
      }>(
        `SELECT asset_id, role, weight, hints FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = $2`,
        [snapshot.id, snapshot.specRevision]
      );

      for (const refId of allRequestedRefIds) {
        const asset = assetMap.get(refId);
        if (!asset) {
          throw new ReferenceAssetNotFoundError(refId);
        }
        if (asset.client_id !== campaignClientId) {
          throw new CrossClientReferenceBindingError(campaignClientId, refId, asset.client_id);
        }
        if (asset.archived_at != null) {
          const existingForRef = existingBindingsRes.rows.filter((r) => r.asset_id === refId);
          if (existingForRef.length === 0) {
            throw new ArchivedReferenceBindingError(refId);
          }

          let requestedForRef: Array<{
            role: string;
            weight: number | null;
            hints: Record<string, unknown> | null;
          }> = [];

          if (
            snapshot.configuration.referenceBindings &&
            snapshot.configuration.referenceBindings.length > 0
          ) {
            const explicit = snapshot.configuration.referenceBindings.filter(
              (b) => b.referenceAssetId === refId
            );
            if (explicit.length > 0) {
              requestedForRef = explicit.map((b) => ({
                role: b.role,
                weight: b.weight ?? null,
                hints: (b.hints as Record<string, unknown> | null) ?? null
              }));
            }
          }

          if (requestedForRef.length === 0 && snapshot.configuration.referenceIds.includes(refId)) {
            requestedForRef = [
              {
                role: "style",
                weight: null,
                hints: null
              }
            ];
          }

          if (requestedForRef.length !== existingForRef.length) {
            throw new ArchivedReferenceBindingError(refId);
          }

          const unmatchedExisting = [...existingForRef];
          for (const req of requestedForRef) {
            const matchIndex = unmatchedExisting.findIndex(
              (ex) =>
                ex.role === req.role &&
                weightsEqual(ex.weight, req.weight) &&
                hintsEqual(ex.hints, req.hints)
            );
            if (matchIndex === -1) {
              throw new ArchivedReferenceBindingError(refId);
            }
            unmatchedExisting.splice(matchIndex, 1);
          }
          if (unmatchedExisting.length > 0) {
            throw new ArchivedReferenceBindingError(refId);
          }
        }
      }
    }

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
        active_production_job_id = $14,
        production_attempt_ordinal = $15,
        accepted_production_attempt_id = $16,
        selected_shot_plan_id = $17,
        selected_shot_plan_revision = $18,
        approved_shot_plan_id = $19,
        approved_shot_plan_revision = $20,
        production_routing_mode = $21,
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
        failedFrom,
        activeProductionJobId,
        productionAttemptOrdinal,
        acceptedProductionAttemptId,
        selectedShotPlanId,
        selectedShotPlanRevision,
        approvedShotPlanId,
        approvedShotPlanRevision,
        productionRoutingMode
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
          active_production_job_id,
          production_attempt_ordinal,
          accepted_production_attempt_id,
          selected_shot_plan_id,
          selected_shot_plan_revision,
          approved_shot_plan_id,
          approved_shot_plan_revision,
          production_routing_mode,
          updated_at
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          'wide',
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
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          $23,
          CURRENT_TIMESTAMP
        )
        `,
        [
          snapshot.id,
          snapshot.campaignId,
          snapshot.sequenceIndex ?? 1,
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
          failedFrom,
          activeProductionJobId,
          productionAttemptOrdinal,
          acceptedProductionAttemptId,
          selectedShotPlanId,
          selectedShotPlanRevision,
          approvedShotPlanId,
          approvedShotPlanRevision,
          productionRoutingMode
        ]
      );
    }

    // Synchronize reference asset associations for CURRENT revision only
    await client.query(
      `DELETE FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = $2`,
      [snapshot.id, snapshot.specRevision]
    );

    if (
      snapshot.configuration.referenceBindings &&
      snapshot.configuration.referenceBindings.length > 0
    ) {
      for (const binding of snapshot.configuration.referenceBindings) {
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
            snapshot.id,
            binding.referenceAssetId,
            snapshot.specRevision,
            binding.role,
            binding.weight ?? null,
            binding.hints ? JSON.stringify(binding.hints) : null,
            binding.archivedAt ? new Date(binding.archivedAt) : null
          ]
        );
      }

      const boundAssetIds = new Set(
        snapshot.configuration.referenceBindings.map((b) => b.referenceAssetId as string)
      );
      for (const assetId of snapshot.configuration.referenceIds) {
        if (!boundAssetIds.has(assetId)) {
          await client.query(
            `
            INSERT INTO scene_reference_assets (scene_id, asset_id, spec_revision, role)
            VALUES ($1, $2, $3, 'style')
            ON CONFLICT (scene_id, spec_revision, asset_id, role) DO NOTHING
            `,
            [snapshot.id, assetId, snapshot.specRevision]
          );
        }
      }
    } else if (allRequestedRefIds.length > 0) {
      for (const assetId of allRequestedRefIds) {
        await client.query(
          `
          INSERT INTO scene_reference_assets (scene_id, asset_id, spec_revision, role)
          VALUES ($1, $2, $3, 'style')
          ON CONFLICT (scene_id, spec_revision, asset_id, role) DO NOTHING
          `,
          [snapshot.id, assetId, snapshot.specRevision]
        );
      }
    }
  }
}
