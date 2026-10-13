import type { ShotPlanRepository } from "@cco/application";
import {
  ShotPlan,
  ShotPlanValidationError,
  type CameraAngle,
  type CameraMovement,
  type LightingStyle,
  type SceneId,
  type ShotFraming,
  type ShotPlanBeatPrevisAssociation,
  type ShotPlanId,
  type ShotPlanRoutingMode,
  type ShotPlanSnapshot,
  type ShotPlanStatus
} from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface ShotPlanRow {
  shot_plan_id: string;
  scene_id: string;
  spec_revision: number;
  variant_ordinal: number;
  status: string;
  routing_mode: string;
  target_duration_ms: number;
  target_frame_count: number;
  framing: string;
  camera_angle: string;
  camera_movement: string;
  lighting_style: string;
  previs_candidate_id: string | null;
  structured_plan: Record<string, unknown> | string;
  created_at: Date | string;
  updated_at: Date | string;
  derived_from_shot_plan_id?: string | null;
  idempotency_key?: string | null;
  request_hash_sha256?: string | null;
}

interface AssociationRow {
  shot_plan_id: string;
  beat_index: number;
  candidate_id: string;
  storage_bucket: string;
  storage_object_key: string;
  content_hash_sha256: string;
  generation_payload: Record<string, unknown> | string;
  candidate_created_at: Date | string;
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

export interface PostgresShotPlanRepositoryOptions {
  /**
   * If true, transaction lifecycle is owned externally (e.g. by UnitOfWork).
   * The repository will not execute BEGIN or COMMIT.
   */
  externalTransaction?: boolean;
  /**
   * If true, wraps persistence operations in a PostgreSQL SAVEPOINT.
   */
  useSavepoint?: boolean;
}

function mapRowToShotPlan(
  row: ShotPlanRow,
  associations: readonly AssociationRow[] = []
): ShotPlan {
  const structured =
    typeof row.structured_plan === "string"
      ? (JSON.parse(row.structured_plan) as ShotPlanSnapshot)
      : (row.structured_plan as unknown as ShotPlanSnapshot);

  const structuredAssocs = structured.previsAssociations ?? [];
  let resolvedAssocs: ShotPlanBeatPrevisAssociation[] = [];

  const hasExplicitStructuredAssocs = structured.previsAssociations !== undefined;
  if (associations.length > 0) {
    resolvedAssocs = associations.map((a) => {
      const matchingStructured = structuredAssocs.find(
        (sa) => sa.beatIndex === Number(a.beat_index)
      );
      const payload =
        typeof a.generation_payload === "string"
          ? (JSON.parse(a.generation_payload) as Record<string, unknown>)
          : (a.generation_payload ?? {});

      const generatedAt =
        matchingStructured?.generatedAt ??
        (a.candidate_created_at instanceof Date
          ? a.candidate_created_at.toISOString()
          : new Date(a.candidate_created_at).toISOString());

      return {
        beatIndex: Number(a.beat_index),
        candidateId: a.candidate_id,
        storageBucket: a.storage_bucket,
        storageObjectKey: a.storage_object_key,
        contentHashSha256: a.content_hash_sha256,
        modelProfile:
          matchingStructured?.modelProfile ??
          (typeof payload["modelProfile"] === "string" ? payload["modelProfile"] : "unknown"),
        generatedAt,
        reviewNotes:
          matchingStructured?.reviewNotes ??
          (typeof payload["reviewNotes"] === "string" ? payload["reviewNotes"] : null)
      };
    });
  } else if (hasExplicitStructuredAssocs) {
    resolvedAssocs = [...structuredAssocs];
  } else if (structured.previs) {
    resolvedAssocs = [
      {
        ...structured.previs,
        beatIndex: structured.previs.beatIndex ?? 1
      }
    ];
  }

  const beat1Assoc = resolvedAssocs.find((a) => a.beatIndex === 1);
  const previs =
    associations.length > 0 || hasExplicitStructuredAssocs
      ? (beat1Assoc ?? resolvedAssocs[0] ?? null)
      : (structured.previs ?? beat1Assoc ?? resolvedAssocs[0] ?? null);

  return ShotPlan.reconstitute({
    ...structured,
    id: row.shot_plan_id as ShotPlanId,
    sceneId: row.scene_id as SceneId,
    specRevision: Number(row.spec_revision),
    variantOrdinal: Number(row.variant_ordinal),
    status: row.status as ShotPlanStatus,
    routingMode: row.routing_mode as ShotPlanRoutingMode,
    targetDurationMs: Number(row.target_duration_ms),
    targetFrameCount: Number(row.target_frame_count),
    framing: row.framing as ShotFraming,
    angle: row.camera_angle as CameraAngle,
    cameraMovement: row.camera_movement as CameraMovement,
    lightingStyle: row.lighting_style as LightingStyle,
    previs,
    previsAssociations: resolvedAssocs,
    derivedFromShotPlanId:
      (row.derived_from_shot_plan_id as ShotPlanId | undefined) ??
      structured.derivedFromShotPlanId ??
      null,
    derivation: structured.derivation ?? null,
    idempotencyKey: row.idempotency_key ?? structured.idempotencyKey ?? null,
    requestHashSha256: row.request_hash_sha256 ?? structured.requestHashSha256 ?? null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  });
}

export class PostgresShotPlanRepository implements ShotPlanRepository {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly options: PostgresShotPlanRepositoryOptions = {}
  ) {}

  private async loadAssociations(
    planIds: readonly string[]
  ): Promise<Map<string, AssociationRow[]>> {
    const map = new Map<string, AssociationRow[]>();
    if (planIds.length === 0) {
      return map;
    }

    const result = await this.client.query<AssociationRow>(
      `
      SELECT
        a.shot_plan_id,
        a.beat_index,
        a.candidate_id,
        sc.storage_bucket,
        sc.storage_object_key,
        sc.content_hash_sha256,
        sc.generation_payload,
        sc.created_at AS candidate_created_at
      FROM shot_plan_previs_associations a
      JOIN storyboard_candidates sc ON sc.candidate_id = a.candidate_id
      WHERE a.shot_plan_id = ANY($1::uuid[])
      ORDER BY a.beat_index ASC
      `,
      [planIds]
    );

    for (const row of result.rows) {
      const list = map.get(row.shot_plan_id) ?? [];
      list.push(row);
      map.set(row.shot_plan_id, list);
    }

    return map;
  }

  async findById(shotPlanId: ShotPlanId): Promise<ShotPlan | undefined> {
    const result = await this.client.query<ShotPlanRow>(
      `
      SELECT
        shot_plan_id,
        scene_id,
        spec_revision,
        variant_ordinal,
        status,
        routing_mode,
        target_duration_ms,
        target_frame_count,
        framing,
        camera_angle,
        camera_movement,
        lighting_style,
        previs_candidate_id,
        structured_plan,
        created_at,
        updated_at,
        derived_from_shot_plan_id,
        idempotency_key,
        request_hash_sha256
      FROM shot_plans
      WHERE shot_plan_id = $1
      `,
      [shotPlanId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const assocMap = await this.loadAssociations([row.shot_plan_id]);
    return mapRowToShotPlan(row, assocMap.get(row.shot_plan_id));
  }

  async save(shotPlan: ShotPlan): Promise<void> {
    const snap = shotPlan.snapshot();
    const createdAt = snap.createdAt ? new Date(snap.createdAt) : new Date();
    const updatedAt = snap.updatedAt ? new Date(snap.updatedAt) : new Date();

    const associations = snap.previsAssociations ?? [];
    const beatIndices = new Set(snap.beats.map((b) => b.beatIndex));
    const seenAssocBeats = new Set<number>();

    for (const assoc of associations) {
      if (!Number.isInteger(assoc.beatIndex) || assoc.beatIndex <= 0) {
        throw new ShotPlanValidationError(
          `Previs association beatIndex must be a positive integer, got ${assoc.beatIndex}`
        );
      }
      if (seenAssocBeats.has(assoc.beatIndex)) {
        throw new ShotPlanValidationError(
          `Duplicate beatIndex in previs associations: ${assoc.beatIndex}`
        );
      }
      seenAssocBeats.add(assoc.beatIndex);

      if (snap.beats.length > 0 && !beatIndices.has(assoc.beatIndex)) {
        throw new ShotPlanValidationError(
          `Previs association references non-existent beat ${assoc.beatIndex} in shot plan`
        );
      }
    }

    if (snap.previs?.beatIndex !== undefined) {
      if (!Number.isInteger(snap.previs.beatIndex) || snap.previs.beatIndex <= 0) {
        throw new ShotPlanValidationError(
          `Previs association beatIndex must be a positive integer, got ${snap.previs.beatIndex}`
        );
      }
      if (snap.beats.length > 0 && !beatIndices.has(snap.previs.beatIndex)) {
        throw new ShotPlanValidationError(
          `Previs association references non-existent beat ${snap.previs.beatIndex} in shot plan`
        );
      }
    }

    const hasExplicitAssocs = snap.previsAssociations !== undefined;
    const scalarPrevisCandidateId = hasExplicitAssocs
      ? (associations.find((a) => a.beatIndex === 1)?.candidateId ??
        associations[0]?.candidateId ??
        null)
      : (snap.previs?.candidateId ?? null);

    const targetAssociations: Array<{ beatIndex: number; candidateId: string }> = [];
    if (hasExplicitAssocs) {
      for (const assoc of associations) {
        targetAssociations.push({
          beatIndex: assoc.beatIndex,
          candidateId: assoc.candidateId
        });
      }
    } else if (snap.previs?.candidateId) {
      targetAssociations.push({
        beatIndex: snap.previs.beatIndex ?? 1,
        candidateId: snap.previs.candidateId
      });
    }

    const persistedSnap: ShotPlanSnapshot = hasExplicitAssocs
      ? {
          ...snap,
          previs:
            associations.length === 0
              ? null
              : (associations.find((a) => a.beatIndex === 1) ?? associations[0] ?? null),
          previsAssociations: associations
        }
      : snap;

    const executeInTx = async (txClient: PoolClient) => {
      // 1. Upsert shot_plans
      await txClient.query(
        `
        INSERT INTO shot_plans (
          shot_plan_id,
          scene_id,
          spec_revision,
          variant_ordinal,
          status,
          routing_mode,
          target_duration_ms,
          target_frame_count,
          framing,
          camera_angle,
          camera_movement,
          lighting_style,
          previs_candidate_id,
          structured_plan,
          created_at,
          updated_at,
          derived_from_shot_plan_id,
          idempotency_key,
          request_hash_sha256
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (shot_plan_id) DO UPDATE SET
          status = EXCLUDED.status,
          routing_mode = EXCLUDED.routing_mode,
          previs_candidate_id = EXCLUDED.previs_candidate_id,
          structured_plan = EXCLUDED.structured_plan,
          updated_at = EXCLUDED.updated_at,
          derived_from_shot_plan_id = EXCLUDED.derived_from_shot_plan_id,
          idempotency_key = EXCLUDED.idempotency_key,
          request_hash_sha256 = EXCLUDED.request_hash_sha256
        `,
        [
          snap.id,
          snap.sceneId,
          snap.specRevision,
          snap.variantOrdinal,
          snap.status,
          snap.routingMode,
          snap.targetDurationMs,
          snap.targetFrameCount,
          snap.framing,
          snap.angle,
          snap.cameraMovement,
          snap.lightingStyle,
          scalarPrevisCandidateId,
          JSON.stringify(persistedSnap),
          createdAt,
          updatedAt,
          snap.derivedFromShotPlanId ?? null,
          snap.idempotencyKey ?? null,
          snap.requestHashSha256 ?? null
        ]
      );

      // 2. Synchronize associations: remove associations absent from snapshot, then upsert current
      if (targetAssociations.length === 0) {
        await txClient.query(`DELETE FROM shot_plan_previs_associations WHERE shot_plan_id = $1`, [
          snap.id
        ]);
      } else {
        const activeBeatIndices = targetAssociations.map((a) => a.beatIndex);
        await txClient.query(
          `DELETE FROM shot_plan_previs_associations WHERE shot_plan_id = $1 AND NOT (beat_index = ANY($2::int[]))`,
          [snap.id, activeBeatIndices]
        );

        for (const assoc of targetAssociations) {
          await txClient.query(
            `
            INSERT INTO shot_plan_previs_associations (
              shot_plan_id,
              beat_index,
              candidate_id,
              scene_id,
              spec_revision,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (shot_plan_id, beat_index) DO UPDATE SET
              candidate_id = EXCLUDED.candidate_id,
              scene_id = EXCLUDED.scene_id,
              spec_revision = EXCLUDED.spec_revision,
              updated_at = EXCLUDED.updated_at
            `,
            [
              snap.id,
              assoc.beatIndex,
              assoc.candidateId,
              snap.sceneId,
              snap.specRevision,
              createdAt,
              updatedAt
            ]
          );
        }
      }
    };

    if (isPool(this.client)) {
      const client = await this.client.connect();
      try {
        await client.query("BEGIN");
        await executeInTx(client);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } else {
      const client = this.client as PoolClient;
      if (this.options.externalTransaction) {
        if (this.options.useSavepoint) {
          await client.query("SAVEPOINT save_shot_plan");
          try {
            await executeInTx(client);
            await client.query("RELEASE SAVEPOINT save_shot_plan");
          } catch (err) {
            await client.query("ROLLBACK TO SAVEPOINT save_shot_plan").catch(() => {});
            throw err;
          }
        } else {
          await executeInTx(client);
        }
      } else {
        await client.query("BEGIN");
        try {
          await executeInTx(client);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          throw err;
        }
      }
    }
  }

  async saveMany(shotPlans: readonly ShotPlan[]): Promise<void> {
    for (const plan of shotPlans) {
      await this.save(plan);
    }
  }

  async listBySceneAndRevision(
    sceneId: SceneId,
    specRevision: number
  ): Promise<readonly ShotPlan[]> {
    const result = await this.client.query<ShotPlanRow>(
      `
      SELECT
        shot_plan_id,
        scene_id,
        spec_revision,
        variant_ordinal,
        status,
        routing_mode,
        target_duration_ms,
        target_frame_count,
        framing,
        camera_angle,
        camera_movement,
        lighting_style,
        previs_candidate_id,
        structured_plan,
        created_at,
        updated_at,
        derived_from_shot_plan_id,
        idempotency_key,
        request_hash_sha256
      FROM shot_plans
      WHERE scene_id = $1 AND spec_revision = $2
      ORDER BY variant_ordinal ASC
      `,
      [sceneId, specRevision]
    );

    if (result.rows.length === 0) {
      return Object.freeze([]);
    }

    const assocMap = await this.loadAssociations(result.rows.map((r) => r.shot_plan_id));
    return Object.freeze(
      result.rows.map((row) => mapRowToShotPlan(row, assocMap.get(row.shot_plan_id)))
    );
  }

  async listByScene(sceneId: SceneId): Promise<readonly ShotPlan[]> {
    const result = await this.client.query<ShotPlanRow>(
      `
      SELECT
        shot_plan_id,
        scene_id,
        spec_revision,
        variant_ordinal,
        status,
        routing_mode,
        target_duration_ms,
        target_frame_count,
        framing,
        camera_angle,
        camera_movement,
        lighting_style,
        previs_candidate_id,
        structured_plan,
        created_at,
        updated_at,
        derived_from_shot_plan_id,
        idempotency_key,
        request_hash_sha256
      FROM shot_plans
      WHERE scene_id = $1
      ORDER BY spec_revision ASC, variant_ordinal ASC
      `,
      [sceneId]
    );

    if (result.rows.length === 0) {
      return Object.freeze([]);
    }

    const assocMap = await this.loadAssociations(result.rows.map((r) => r.shot_plan_id));
    return Object.freeze(
      result.rows.map((row) => mapRowToShotPlan(row, assocMap.get(row.shot_plan_id)))
    );
  }

  async listByIdempotencyKey(
    sceneId: SceneId,
    idempotencyKey: string
  ): Promise<readonly ShotPlan[]> {
    const result = await this.client.query<ShotPlanRow>(
      `
      SELECT
        shot_plan_id,
        scene_id,
        spec_revision,
        variant_ordinal,
        status,
        routing_mode,
        target_duration_ms,
        target_frame_count,
        framing,
        camera_angle,
        camera_movement,
        lighting_style,
        previs_candidate_id,
        structured_plan,
        created_at,
        updated_at,
        derived_from_shot_plan_id,
        idempotency_key,
        request_hash_sha256
      FROM shot_plans
      WHERE scene_id = $1 AND idempotency_key = $2
      ORDER BY variant_ordinal ASC
      `,
      [sceneId, idempotencyKey]
    );

    if (result.rows.length === 0) {
      return Object.freeze([]);
    }

    const assocMap = await this.loadAssociations(result.rows.map((r) => r.shot_plan_id));
    return Object.freeze(
      result.rows.map((row) => mapRowToShotPlan(row, assocMap.get(row.shot_plan_id)))
    );
  }
}
