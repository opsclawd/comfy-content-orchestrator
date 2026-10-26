import type { OperatorAcceptanceRunRepository } from "@cco/application";
import {
  type AcceptanceRunScene,
  type OperatorAcceptanceActionReceipt,
  type OperatorAcceptanceActionScope,
  type OperatorAcceptanceRun,
  type OperatorAcceptanceRunStatus,
  OperatorAcceptanceRunSchema,
  AcceptanceRunSceneSchema,
  OperatorAcceptanceActionReceiptSchema,
  OperatorAcceptanceIdempotencyConflictError
} from "@cco/contracts";
import type { Pool, PoolClient } from "pg";

interface RunRow {
  acceptance_run_id: string;
  campaign_id: string;
  status: string;
  realm: unknown;
  evidence_origin: string;
  plan_id: string;
  expected_total_duration_ms: number;
  assembly_job_id: string | null;
  created_by: string;
  action_receipt_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SceneRow {
  acceptance_run_id: string;
  scene_id: string;
  allocation_id: string;
  spec_revision: number;
  sequence_index: number;
  profile_key: string;
  frames: number;
  fps: number;
  expected_duration_ms: number;
  current_attempt_id: string | null;
  current_attempt_ordinal: number;
  accepted_attempt_id: string | null;
  accepted_staging_job_id: string | null;
  accepted_attempt_ordinal: number | null;
  candidate_specification_digest: string | null;
  plan_id: string | null;
}

function parseJsonField<T>(val: unknown): T {
  if (typeof val === "string") {
    return JSON.parse(val) as T;
  }
  return val as T;
}

function mapRowToRun(row: RunRow): OperatorAcceptanceRun {
  const raw = {
    acceptanceRunId: row.acceptance_run_id,
    campaignId: row.campaign_id,
    status: row.status,
    realm: parseJsonField(row.realm),
    evidenceOrigin: row.evidence_origin,
    planId: row.plan_id,
    expectedTotalDurationMs: row.expected_total_duration_ms,
    ...(row.assembly_job_id != null ? { assemblyJobId: row.assembly_job_id } : {}),
    createdBy: row.created_by,
    ...(row.action_receipt_id != null ? { actionReceiptId: row.action_receipt_id } : {}),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  };
  return OperatorAcceptanceRunSchema.parse(raw);
}

function mapRowToScene(row: SceneRow): AcceptanceRunScene {
  const raw = {
    acceptanceRunId: row.acceptance_run_id,
    sceneId: row.scene_id,
    allocationId: row.allocation_id,
    specRevision: row.spec_revision,
    sequenceIndex: row.sequence_index,
    profileKey: row.profile_key,
    frames: row.frames,
    fps: Number(row.fps),
    expectedDurationMs: row.expected_duration_ms,
    ...(row.current_attempt_id != null ? { currentAttemptId: row.current_attempt_id } : {}),
    currentAttemptOrdinal: row.current_attempt_ordinal,
    ...(row.accepted_attempt_id != null ? { acceptedAttemptId: row.accepted_attempt_id } : {}),
    ...(row.accepted_staging_job_id != null
      ? { acceptedStagingJobId: row.accepted_staging_job_id }
      : {}),
    ...(row.accepted_attempt_ordinal != null
      ? { acceptedAttemptOrdinal: row.accepted_attempt_ordinal }
      : {}),
    ...(row.candidate_specification_digest != null
      ? { candidateSpecificationDigest: row.candidate_specification_digest }
      : {}),
    ...(row.plan_id != null ? { planId: row.plan_id } : {})
  };
  return AcceptanceRunSceneSchema.parse(raw);
}

export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptanceRunRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async createRun(
    run: OperatorAcceptanceRun,
    scenes: readonly AcceptanceRunScene[]
  ): Promise<void> {
    const runQuery = `
      INSERT INTO operator_acceptance_runs (
        acceptance_run_id,
        campaign_id,
        status,
        realm,
        evidence_origin,
        plan_id,
        expected_total_duration_ms,
        assembly_job_id,
        created_by,
        action_receipt_id,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (acceptance_run_id) DO NOTHING;
    `;

    await this.client.query(runQuery, [
      run.acceptanceRunId,
      run.campaignId,
      run.status,
      JSON.stringify(run.realm),
      run.evidenceOrigin,
      run.planId,
      run.expectedTotalDurationMs,
      run.assemblyJobId ?? null,
      run.createdBy,
      run.actionReceiptId ?? null,
      run.createdAt,
      run.updatedAt
    ]);

    for (const scene of scenes) {
      const sceneQuery = `
        INSERT INTO acceptance_run_scenes (
          acceptance_run_id,
          scene_id,
          allocation_id,
          spec_revision,
          sequence_index,
          profile_key,
          frames,
          fps,
          expected_duration_ms,
          current_attempt_id,
          current_attempt_ordinal,
          accepted_attempt_id,
          accepted_staging_job_id,
          accepted_attempt_ordinal,
          candidate_specification_digest,
          plan_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (acceptance_run_id, scene_id) DO NOTHING;
      `;
      await this.client.query(sceneQuery, [
        scene.acceptanceRunId,
        scene.sceneId,
        scene.allocationId,
        scene.specRevision,
        scene.sequenceIndex,
        scene.profileKey,
        scene.frames,
        scene.fps,
        scene.expectedDurationMs,
        scene.currentAttemptId ?? null,
        scene.currentAttemptOrdinal,
        scene.acceptedAttemptId ?? null,
        scene.acceptedStagingJobId ?? null,
        scene.acceptedAttemptOrdinal ?? null,
        scene.candidateSpecificationDigest ?? null,
        scene.planId ?? null
      ]);
    }
  }

  async findRunById(acceptanceRunId: string): Promise<OperatorAcceptanceRun | undefined> {
    const query = `
      SELECT * FROM operator_acceptance_runs
      WHERE acceptance_run_id = $1;
    `;
    const res = await this.client.query<RunRow>(query, [acceptanceRunId]);
    if (res.rows.length === 0) return undefined;
    return mapRowToRun(res.rows[0]!);
  }

  async findRunByCampaignId(campaignId: string): Promise<OperatorAcceptanceRun | undefined> {
    const query = `
      SELECT * FROM operator_acceptance_runs
      WHERE campaign_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const res = await this.client.query<RunRow>(query, [campaignId]);
    if (res.rows.length === 0) return undefined;
    return mapRowToRun(res.rows[0]!);
  }

  async findRunScenes(acceptanceRunId: string): Promise<readonly AcceptanceRunScene[]> {
    const query = `
      SELECT * FROM acceptance_run_scenes
      WHERE acceptance_run_id = $1
      ORDER BY sequence_index ASC;
    `;
    const res = await this.client.query<SceneRow>(query, [acceptanceRunId]);
    return res.rows.map(mapRowToScene);
  }

  async findRunSceneBySceneId(sceneId: string): Promise<AcceptanceRunScene | undefined> {
    const query = `
      SELECT * FROM acceptance_run_scenes
      WHERE scene_id = $1
      ORDER BY sequence_index ASC
      LIMIT 1;
    `;
    const res = await this.client.query<SceneRow>(query, [sceneId]);
    if (res.rows.length === 0) return undefined;
    return mapRowToScene(res.rows[0]!);
  }

  async updateRunStatus(
    acceptanceRunId: string,
    status: OperatorAcceptanceRunStatus,
    assemblyJobId?: string,
    actionReceiptId?: string
  ): Promise<void> {
    const isTerminalSettlement = status === "completed" || status === "failed";
    const query =
      isTerminalSettlement && assemblyJobId
        ? `
          UPDATE operator_acceptance_runs
          SET status = $2,
              assembly_job_id = COALESCE($3, assembly_job_id),
              action_receipt_id = COALESCE($4, action_receipt_id),
              updated_at = NOW()
          WHERE acceptance_run_id = $1
            AND (assembly_job_id = $3 OR assembly_job_id IS NULL)
            AND (status = 'assembling' OR status = $2);
        `
        : `
          UPDATE operator_acceptance_runs
          SET status = $2,
              assembly_job_id = COALESCE($3, assembly_job_id),
              action_receipt_id = COALESCE($4, action_receipt_id),
              updated_at = NOW()
          WHERE acceptance_run_id = $1;
        `;
    const res = await this.client.query(query, [
      acceptanceRunId,
      status,
      assemblyJobId ?? null,
      actionReceiptId ?? null
    ]);
    if (isTerminalSettlement && assemblyJobId && res.rowCount === 0) {
      const existing = await this.findRunById(acceptanceRunId);
      if (!existing) {
        throw new Error(`Acceptance run '${acceptanceRunId}' not found`);
      }
      if (existing.status !== "assembling" && existing.status !== status) {
        throw new Error(
          `Cannot settle acceptance run '${acceptanceRunId}' from status '${existing.status}' to '${status}'`
        );
      }
      if (existing.assemblyJobId && existing.assemblyJobId !== assemblyJobId) {
        throw new Error(
          `Cannot settle acceptance run '${acceptanceRunId}': assembly job mismatch (expected ${existing.assemblyJobId}, got ${assemblyJobId})`
        );
      }
    }
  }

  async updateSceneAcceptedAttempt(
    acceptanceRunId: string,
    sceneId: string,
    attemptId: string,
    stagingJobId: string,
    ordinal: number
  ): Promise<void> {
    const query = `
      UPDATE acceptance_run_scenes
      SET accepted_attempt_id = $3,
          accepted_staging_job_id = $4,
          accepted_attempt_ordinal = $5
      WHERE acceptance_run_id = $1 AND scene_id = $2;
    `;
    await this.client.query(query, [acceptanceRunId, sceneId, attemptId, stagingJobId, ordinal]);
  }

  async updateSceneCurrentAttempt(
    acceptanceRunId: string,
    sceneId: string,
    attemptId: string,
    ordinal: number
  ): Promise<void> {
    const query = `
      UPDATE acceptance_run_scenes
      SET current_attempt_id = $3,
          current_attempt_ordinal = $4
      WHERE acceptance_run_id = $1 AND scene_id = $2;
    `;
    await this.client.query(query, [acceptanceRunId, sceneId, attemptId, ordinal]);
  }

  async saveActionReceipt(receipt: OperatorAcceptanceActionReceipt): Promise<void> {
    const existing = await this.findActionReceipt(
      receipt.scope,
      receipt.runOrCampaignId,
      receipt.actionId
    );
    if (existing) {
      if (existing.requestHash !== receipt.requestHash) {
        throw new OperatorAcceptanceIdempotencyConflictError(receipt.actionId);
      }
      return;
    }

    const query = `
      INSERT INTO operator_acceptance_action_receipts (
        action_id,
        scope,
        run_or_campaign_id,
        realm,
        request_hash,
        response,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (scope, run_or_campaign_id, action_id) DO NOTHING
      RETURNING request_hash;
    `;
    const res = await this.client.query<{ request_hash: string }>(query, [
      receipt.actionId,
      receipt.scope,
      receipt.runOrCampaignId,
      JSON.stringify(receipt.realm),
      receipt.requestHash,
      JSON.stringify(receipt.response),
      receipt.createdAt
    ]);
    if (res.rowCount === 0) {
      const conflictReceipt = await this.findActionReceipt(
        receipt.scope,
        receipt.runOrCampaignId,
        receipt.actionId
      );
      if (conflictReceipt && conflictReceipt.requestHash !== receipt.requestHash) {
        throw new OperatorAcceptanceIdempotencyConflictError(receipt.actionId);
      }
    }
  }

  async findActionReceipt(
    scope: OperatorAcceptanceActionScope | string,
    runOrCampaignId: string,
    actionId: string
  ): Promise<OperatorAcceptanceActionReceipt | undefined> {
    const query = `
      SELECT * FROM operator_acceptance_action_receipts
      WHERE scope = $1 AND run_or_campaign_id = $2 AND action_id = $3;
    `;
    const res = await this.client.query<{
      action_id: string;
      scope: string;
      run_or_campaign_id: string;
      realm: unknown;
      request_hash: string;
      response: unknown;
      created_at: Date | string;
    }>(query, [scope, runOrCampaignId, actionId]);

    const row = res.rows[0];
    if (!row) return undefined;

    return OperatorAcceptanceActionReceiptSchema.parse({
      actionId: row.action_id,
      scope: row.scope,
      runOrCampaignId: row.run_or_campaign_id,
      realm: parseJsonField(row.realm),
      requestHash: row.request_hash,
      response: parseJsonField(row.response),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString()
    });
  }
}
