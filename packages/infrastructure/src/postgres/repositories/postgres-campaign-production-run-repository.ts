import type {
  CampaignProductionRunRepository,
  CreateCampaignProductionRunInput,
  ProductionAttemptRecord,
  RecordProductionAttemptInput
} from "@cco/application";
import type {
  CampaignId,
  CampaignProductionRunRecord,
  CampaignProductionRunSceneRecord,
  CampaignProductionRunStatus,
  SceneId
} from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface CampaignProductionRunRow {
  run_id: string;
  campaign_id: string;
  fingerprint: string;
  status: string;
  expected_total_duration_ms: number;
  assembly_job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CampaignProductionRunSceneRow {
  run_id: string;
  scene_id: string;
  spec_revision: number;
  sequence_index: number;
  expected_duration_ms: number;
  production_job_id: string | null;
  current_attempt_id: string | null;
  current_attempt_ordinal: number | null;
  accepted_attempt_id: string | null;
  accepted_production_job_id: string | null;
  accepted_attempt_ordinal: number | null;
}

interface ProductionAttemptRow {
  attempt_id: string;
  scene_id: string;
  run_id: string | null;
  ordinal: number;
  production_job_id: string;
  spec_revision: number;
  selected_candidate_id: string | null;
  selected_candidate_revision: number | null;
  seed: string | number;
  created_reason: "initial_dispatch" | "failure_recovery" | "production_rerender";
  created_at: Date | string;
}

function mapRowToRun(row: CampaignProductionRunRow): CampaignProductionRunRecord {
  return {
    id: row.run_id,
    campaignId: row.campaign_id as CampaignId,
    fingerprint: row.fingerprint,
    status: row.status as CampaignProductionRunStatus,
    expectedTotalDurationMs: Number(row.expected_total_duration_ms),
    ...(row.assembly_job_id ? { assemblyJobId: row.assembly_job_id } : {}),
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

function mapRowToRunScene(row: CampaignProductionRunSceneRow): CampaignProductionRunSceneRecord {
  return {
    runId: row.run_id,
    sceneId: row.scene_id as SceneId,
    specRevision: Number(row.spec_revision),
    sequenceIndex: Number(row.sequence_index),
    expectedDurationMs: Number(row.expected_duration_ms),
    ...(row.production_job_id ? { productionJobId: row.production_job_id } : {}),
    ...(row.current_attempt_id ? { currentAttemptId: row.current_attempt_id } : {}),
    ...(row.current_attempt_ordinal !== null && row.current_attempt_ordinal !== undefined
      ? { currentAttemptOrdinal: Number(row.current_attempt_ordinal) }
      : {}),
    ...(row.accepted_attempt_id ? { acceptedAttemptId: row.accepted_attempt_id } : {}),
    ...(row.accepted_production_job_id
      ? { acceptedProductionJobId: row.accepted_production_job_id }
      : {}),
    ...(row.accepted_attempt_ordinal !== null && row.accepted_attempt_ordinal !== undefined
      ? { acceptedAttemptOrdinal: Number(row.accepted_attempt_ordinal) }
      : {})
  };
}

function mapRowToProductionAttempt(row: ProductionAttemptRow): ProductionAttemptRecord {
  return {
    attemptId: row.attempt_id,
    sceneId: row.scene_id as SceneId,
    runId: row.run_id ?? undefined,
    ordinal: Number(row.ordinal),
    productionJobId: row.production_job_id,
    specRevision: Number(row.spec_revision),
    ...(row.selected_candidate_id ? { selectedCandidateId: row.selected_candidate_id } : {}),
    ...(row.selected_candidate_revision !== null && row.selected_candidate_revision !== undefined
      ? { selectedCandidateRevision: Number(row.selected_candidate_revision) }
      : {}),
    seed: Number(row.seed),
    createdReason: row.created_reason,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
}

export class PostgresCampaignProductionRunRepository implements CampaignProductionRunRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async createIfAbsent(
    input: CreateCampaignProductionRunInput
  ): Promise<{ readonly run: CampaignProductionRunRecord; readonly created: boolean }> {
    const insertResult = await this.client.query<CampaignProductionRunRow>(
      `
      INSERT INTO campaign_production_runs (
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT (campaign_id, fingerprint) DO NOTHING
      RETURNING
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      `,
      [input.campaignId, input.fingerprint, input.status, input.expectedTotalDurationMs]
    );

    if (insertResult.rows.length > 0) {
      return {
        run: mapRowToRun(insertResult.rows[0]!),
        created: true
      };
    }

    const existingResult = await this.client.query<CampaignProductionRunRow>(
      `
      SELECT
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      FROM campaign_production_runs
      WHERE campaign_id = $1 AND fingerprint = $2
      `,
      [input.campaignId, input.fingerprint]
    );

    if (existingResult.rows.length === 0) {
      throw new Error("Failed to insert or find existing campaign production run");
    }

    return {
      run: mapRowToRun(existingResult.rows[0]!),
      created: false
    };
  }

  async findById(runId: string): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      SELECT
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      FROM campaign_production_runs
      WHERE run_id = $1
      `,
      [runId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }

  async findByIdForUpdate(runId: string): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      SELECT
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      FROM campaign_production_runs
      WHERE run_id = $1
      FOR UPDATE
      `,
      [runId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }

  async findByAssemblyJobId(
    assemblyJobId: string
  ): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      SELECT
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      FROM campaign_production_runs
      WHERE assembly_job_id = $1
      `,
      [assemblyJobId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }

  async findRunSceneBySceneId(
    sceneId: string
  ): Promise<CampaignProductionRunSceneRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunSceneRow>(
      `
      SELECT
        run_id,
        scene_id,
        spec_revision,
        sequence_index,
        expected_duration_ms,
        production_job_id,
        current_attempt_id,
        current_attempt_ordinal,
        accepted_attempt_id,
        accepted_production_job_id,
        accepted_attempt_ordinal
      FROM campaign_production_run_scenes
      WHERE scene_id = $1
      LIMIT 1
      `,
      [sceneId]
    );

    const row = result.rows[0];
    return row ? mapRowToRunScene(row) : undefined;
  }

  async findRunSceneByProductionJobId(
    productionJobId: string
  ): Promise<CampaignProductionRunSceneRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunSceneRow>(
      `
      SELECT
        run_id,
        scene_id,
        spec_revision,
        sequence_index,
        expected_duration_ms,
        production_job_id,
        current_attempt_id,
        current_attempt_ordinal,
        accepted_attempt_id,
        accepted_production_job_id,
        accepted_attempt_ordinal
      FROM campaign_production_run_scenes
      WHERE production_job_id = $1
      `,
      [productionJobId]
    );

    const row = result.rows[0];
    return row ? mapRowToRunScene(row) : undefined;
  }

  async findRunScenes(runId: string): Promise<readonly CampaignProductionRunSceneRecord[]> {
    const result = await this.client.query<CampaignProductionRunSceneRow>(
      `
      SELECT
        run_id,
        scene_id,
        spec_revision,
        sequence_index,
        expected_duration_ms,
        production_job_id,
        current_attempt_id,
        current_attempt_ordinal,
        accepted_attempt_id,
        accepted_production_job_id,
        accepted_attempt_ordinal
      FROM campaign_production_run_scenes
      WHERE run_id = $1
      ORDER BY sequence_index ASC
      `,
      [runId]
    );

    return result.rows.map(mapRowToRunScene);
  }

  async insertRunScenes(
    runId: string,
    scenes: readonly CampaignProductionRunSceneRecord[]
  ): Promise<void> {
    for (const scene of scenes) {
      await this.client.query(
        `
        INSERT INTO campaign_production_run_scenes (
          run_id,
          scene_id,
          spec_revision,
          sequence_index,
          expected_duration_ms,
          production_job_id,
          current_attempt_id,
          current_attempt_ordinal
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          runId,
          scene.sceneId,
          scene.specRevision,
          scene.sequenceIndex,
          scene.expectedDurationMs,
          scene.productionJobId ?? null,
          scene.currentAttemptId ?? null,
          scene.currentAttemptOrdinal ?? 1
        ]
      );
    }
  }

  async recordProductionAttempt(
    input: RecordProductionAttemptInput
  ): Promise<ProductionAttemptRecord> {
    const result = await this.client.query<ProductionAttemptRow>(
      `
      INSERT INTO production_attempts (
        scene_id,
        run_id,
        ordinal,
        production_job_id,
        spec_revision,
        selected_candidate_id,
        selected_candidate_revision,
        seed,
        created_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING
        attempt_id,
        scene_id,
        run_id,
        ordinal,
        production_job_id,
        spec_revision,
        selected_candidate_id,
        selected_candidate_revision,
        seed,
        created_reason,
        created_at
      `,
      [
        input.sceneId,
        input.runId ?? null,
        input.ordinal,
        input.productionJobId,
        input.specRevision,
        input.selectedCandidateId ?? null,
        input.selectedCandidateRevision ?? null,
        input.seed,
        input.createdReason
      ]
    );

    const row = result.rows[0]!;
    return mapRowToProductionAttempt(row);
  }

  async findAttemptByProductionJobId(
    productionJobId: string
  ): Promise<ProductionAttemptRecord | undefined> {
    const result = await this.client.query<ProductionAttemptRow>(
      `
      SELECT
        attempt_id,
        scene_id,
        run_id,
        ordinal,
        production_job_id,
        spec_revision,
        selected_candidate_id,
        selected_candidate_revision,
        seed,
        created_reason,
        created_at
      FROM production_attempts
      WHERE production_job_id = $1
      `,
      [productionJobId]
    );

    const row = result.rows[0];
    return row ? mapRowToProductionAttempt(row) : undefined;
  }

  async updateCurrentAttempt(
    runId: string,
    sceneId: string,
    attempt: { attemptId: string; attemptOrdinal: number; productionJobId: string }
  ): Promise<void> {
    await this.client.query(
      `
      UPDATE campaign_production_run_scenes
      SET current_attempt_id = $1, current_attempt_ordinal = $2, production_job_id = $3
      WHERE run_id = $4 AND scene_id = $5
      `,
      [attempt.attemptId, attempt.attemptOrdinal, attempt.productionJobId, runId, sceneId]
    );
  }

  async recordAcceptedAttempt(
    runId: string,
    sceneId: string,
    attempt: { attemptId: string; attemptOrdinal: number; productionJobId: string }
  ): Promise<{ readonly accepted: boolean }> {
    const result = await this.client.query(
      `
      UPDATE campaign_production_run_scenes
      SET accepted_attempt_id = $1, accepted_production_job_id = $2, accepted_attempt_ordinal = $3
      WHERE run_id = $4 AND scene_id = $5 AND accepted_attempt_id IS NULL
      `,
      [attempt.attemptId, attempt.productionJobId, attempt.attemptOrdinal, runId, sceneId]
    );

    return { accepted: (result.rowCount ?? 0) === 1 };
  }

  async countIncompleteRunScenes(runId: string): Promise<number> {
    const result = await this.client.query<{ count: string | number }>(
      `
      SELECT COUNT(*)::int AS count
      FROM campaign_production_run_scenes rs
      LEFT JOIN render_jobs rj ON rj.job_id = rs.production_job_id
      WHERE rs.run_id = $1
        AND (rs.production_job_id IS NULL OR rj.job_id IS NULL OR rj.status <> 'completed')
      `,
      [runId]
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  async claimForProductionReview(runId: string): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      UPDATE campaign_production_runs
      SET status = 'production_review', updated_at = CURRENT_TIMESTAMP
      WHERE run_id = $1 AND status = 'dispatched'
      RETURNING
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      `,
      [runId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }

  async claimForAssembly(runId: string): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      UPDATE campaign_production_runs
      SET status = 'assembling', updated_at = CURRENT_TIMESTAMP
      WHERE run_id = $1 AND status = 'dispatched'
      RETURNING
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      `,
      [runId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }

  async setAssemblyJobId(runId: string, assemblyJobId: string): Promise<void> {
    await this.client.query(
      `
      UPDATE campaign_production_runs
      SET assembly_job_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE run_id = $1
      `,
      [runId, assemblyJobId]
    );
  }

  async claimCompletion(runId: string): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      UPDATE campaign_production_runs
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE run_id = $1 AND status = 'assembling'
      RETURNING
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      `,
      [runId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }

  async claimFailure(runId: string): Promise<CampaignProductionRunRecord | undefined> {
    const result = await this.client.query<CampaignProductionRunRow>(
      `
      UPDATE campaign_production_runs
      SET status = 'failed', updated_at = CURRENT_TIMESTAMP
      WHERE run_id = $1 AND status IN ('dispatched', 'production_review', 'assembling')
      RETURNING
        run_id,
        campaign_id,
        fingerprint,
        status,
        expected_total_duration_ms,
        assembly_job_id,
        created_at,
        updated_at
      `,
      [runId]
    );

    const row = result.rows[0];
    return row ? mapRowToRun(row) : undefined;
  }
}
