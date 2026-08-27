import type { ClaimJobInput, JobAdmissionGate, JobQueuePort } from "@cco/application";
import {
  JOB_KINDS,
  type JobId,
  type JobKind,
  type JobStatus,
  type LeaseToken,
  type RenderJob,
  type SceneId
} from "@cco/domain";
import type { Pool } from "pg";

interface RenderJobRow {
  job_id: string;
  scene_id: string;
  job_kind: string;
  status: string;
  workflow_template: string;
  injected_payload: unknown;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  retry_count: number | string;
  max_retries: number | string;
  error_trace: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresJobQueue implements JobQueuePort {
  private readonly gate: JobAdmissionGate;

  constructor(
    private readonly pool: Pool,
    gate?: JobAdmissionGate
  ) {
    this.gate = gate ?? {
      async canAdmit(): Promise<boolean> {
        return true;
      }
    };
  }

  async claim(input: ClaimJobInput): Promise<RenderJob | undefined> {
    if (!input || typeof input !== "object") {
      throw new TypeError("ClaimJobInput must be a non-null object");
    }
    if (typeof input.workerId !== "string" || input.workerId.trim().length === 0) {
      throw new Error("workerId must be a non-empty string");
    }
    if (
      typeof input.leaseDurationMs !== "number" ||
      !Number.isFinite(input.leaseDurationMs) ||
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs <= 0
    ) {
      throw new Error("leaseDurationMs must be a positive finite integer");
    }
    if (input.allowedJobKinds !== undefined) {
      if (
        !Array.isArray(input.allowedJobKinds) ||
        input.allowedJobKinds.some((k) => !(JOB_KINDS as readonly string[]).includes(k))
      ) {
        throw new Error("allowedJobKinds must be an array of valid JobKind");
      }
    }

    // 1. Terminalize expired exhausted active rows in a dedicated standalone query so that
    // subsequent claim rollbacks do not inadvertently revert this terminal cleanup.
    await this.pool.query(
      `
      UPDATE render_jobs
      SET
        status = 'failed',
        error_trace = 'lease expired; retries exhausted',
        updated_at = NOW()
      WHERE status IN ('leased', 'rendering')
        AND lease_expires_at <= NOW()
        AND retry_count >= max_retries
      `
    );

    // 2. Pre-filter candidate job kinds against the admission gate to prevent head-of-line blocking.
    const candidateKinds = input.allowedJobKinds ?? JOB_KINDS;
    const admissibleKinds: JobKind[] = [];
    for (const kind of candidateKinds) {
      if (await this.gate.canAdmit(kind)) {
        admissibleKinds.push(kind);
      }
    }

    if (admissibleKinds.length === 0) {
      return undefined;
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 3. Conditionally claim the oldest eligible queued or expired recoverable job matching admissible kinds
      const claimRes = await client.query<RenderJobRow>(
        `
        WITH claimable AS (
          SELECT job_id
          FROM render_jobs
          WHERE (
            status = 'queued'
            OR (
              status IN ('leased', 'rendering')
              AND lease_expires_at <= NOW()
              AND retry_count < max_retries
            )
          )
          AND job_kind::text = ANY($3::text[])
          ORDER BY created_at ASC, job_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE render_jobs r
        SET
          status = 'leased',
          worker_id = $1,
          lease_token = gen_random_uuid(),
          lease_expires_at = NOW() + ($2 * INTERVAL '1 millisecond'),
          retry_count = CASE
            WHEN r.status IN ('leased', 'rendering') THEN r.retry_count + 1
            ELSE r.retry_count
          END,
          updated_at = NOW()
        FROM claimable c
        WHERE r.job_id = c.job_id
        RETURNING
          r.job_id,
          r.scene_id,
          r.job_kind,
          r.status,
          r.workflow_template,
          r.injected_payload,
          r.worker_id,
          r.lease_token,
          r.lease_expires_at,
          r.retry_count,
          r.max_retries,
          r.error_trace,
          r.created_at,
          r.updated_at
        `,
        [input.workerId, input.leaseDurationMs, admissibleKinds]
      );

      const row = claimRes.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }

      const job = this.mapRowToRenderJob(row);

      // Defense-in-depth re-check with admission gate
      const admitted = await this.gate.canAdmit(job.jobKind);
      if (!admitted) {
        await client.query("ROLLBACK");
        return undefined;
      }

      await client.query("COMMIT");
      return job;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  private mapRowToRenderJob(row: RenderJobRow): RenderJob {
    let injectedPayload: Readonly<Record<string, unknown>>;
    if (typeof row.injected_payload === "string") {
      try {
        injectedPayload = Object.freeze(
          JSON.parse(row.injected_payload) as Record<string, unknown>
        );
      } catch {
        injectedPayload = Object.freeze({});
      }
    } else if (
      typeof row.injected_payload === "object" &&
      row.injected_payload !== null &&
      !Array.isArray(row.injected_payload)
    ) {
      injectedPayload = Object.freeze({ ...(row.injected_payload as Record<string, unknown>) });
    } else {
      injectedPayload = Object.freeze({});
    }

    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(row.created_at);
    const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
    const leaseExpiresAt = row.lease_expires_at
      ? row.lease_expires_at instanceof Date
        ? row.lease_expires_at
        : new Date(row.lease_expires_at)
      : null;

    return Object.freeze({
      jobId: row.job_id as JobId,
      sceneId: row.scene_id as SceneId,
      jobKind: row.job_kind as JobKind,
      status: row.status as JobStatus,
      workflowTemplate: row.workflow_template,
      injectedPayload,
      workerId: row.worker_id ?? null,
      leaseToken: (row.lease_token as LeaseToken) ?? null,
      leaseExpiresAt,
      retryCount: Number(row.retry_count),
      maxRetries: Number(row.max_retries),
      errorTrace: row.error_trace ?? null,
      createdAt,
      updatedAt
    });
  }
}
