import type { ShotPlanRepository } from "@cco/application";
import {
  ShotPlan,
  type CameraAngle,
  type CameraMovement,
  type LightingStyle,
  type SceneId,
  type ShotFraming,
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
}

function mapRowToShotPlan(row: ShotPlanRow): ShotPlan {
  const structured =
    typeof row.structured_plan === "string"
      ? (JSON.parse(row.structured_plan) as ShotPlanSnapshot)
      : (row.structured_plan as unknown as ShotPlanSnapshot);

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
    previs: structured.previs ?? null,
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
  constructor(private readonly client: Pool | PoolClient) {}

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
        updated_at
      FROM shot_plans
      WHERE shot_plan_id = $1
      `,
      [shotPlanId]
    );

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return mapRowToShotPlan(row);
  }

  async save(shotPlan: ShotPlan): Promise<void> {
    const snap = shotPlan.snapshot();
    const createdAt = snap.createdAt ? new Date(snap.createdAt) : new Date();
    const updatedAt = snap.updatedAt ? new Date(snap.updatedAt) : new Date();
    const previsCandidateId = snap.previs?.candidateId ?? null;

    await this.client.query(
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
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (shot_plan_id) DO UPDATE SET
        status = EXCLUDED.status,
        routing_mode = EXCLUDED.routing_mode,
        previs_candidate_id = EXCLUDED.previs_candidate_id,
        structured_plan = EXCLUDED.structured_plan,
        updated_at = EXCLUDED.updated_at
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
        previsCandidateId,
        JSON.stringify(snap),
        createdAt,
        updatedAt
      ]
    );
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
        updated_at
      FROM shot_plans
      WHERE scene_id = $1 AND spec_revision = $2
      ORDER BY variant_ordinal ASC
      `,
      [sceneId, specRevision]
    );

    return Object.freeze(result.rows.map(mapRowToShotPlan));
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
        updated_at
      FROM shot_plans
      WHERE scene_id = $1
      ORDER BY spec_revision ASC, variant_ordinal ASC
      `,
      [sceneId]
    );

    return Object.freeze(result.rows.map(mapRowToShotPlan));
  }
}
