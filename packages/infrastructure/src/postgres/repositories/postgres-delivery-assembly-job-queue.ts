import type {
  ClaimDeliveryAssemblyJobInput,
  DeliveryAssemblyJobMutationResult,
  DeliveryAssemblyJobQueuePort,
  EnqueueDeliveryAssemblyJobInput
} from "@cco/application";
import { AssemblySpecSchema, type AssemblySpec } from "@cco/contracts";
import type { CampaignId, DeliveryAssemblyJob, JobId, JobStatus, LeaseToken } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface DeliveryAssemblyJobRow {
  job_id: string;
  campaign_id: string;
  assembly_spec: unknown;
  status: string;
  worker_id: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  retry_count: number | string;
  max_retries: number | string;
  error_trace: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresDeliveryAssemblyJobQueue implements DeliveryAssemblyJobQueuePort {
  constructor(private readonly pool: Pool) {}

  async enqueue(
    input: EnqueueDeliveryAssemblyJobInput
  ): Promise<DeliveryAssemblyJob<AssemblySpec>> {
    if (!input || typeof input !== "object") {
      throw new TypeError("EnqueueDeliveryAssemblyJobInput must be a non-null object");
    }
    if (typeof input.campaignId !== "string" || input.campaignId.trim().length === 0) {
      throw new Error("campaignId must be a non-empty string");
    }
    if (!input.assemblySpec || typeof input.assemblySpec !== "object") {
      throw new Error("assemblySpec must be a non-null object");
    }
    const parsedSpec = AssemblySpecSchema.safeParse(input.assemblySpec);
    if (!parsedSpec.success) {
      throw new Error(`Invalid assemblySpec: ${parsedSpec.error.message}`);
    }
    if (input.campaignId.trim() !== parsedSpec.data.campaignId) {
      throw new Error(
        `campaignId (${input.campaignId}) does not match assemblySpec.campaignId (${parsedSpec.data.campaignId})`
      );
    }
    const maxRetries = input.maxRetries ?? 3;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new Error("maxRetries must be a non-negative integer");
    }

    const res = await this.pool.query<DeliveryAssemblyJobRow>(
      `
      INSERT INTO delivery_assembly_jobs (
        campaign_id,
        assembly_spec,
        status,
        max_retries
      ) VALUES ($1, $2, 'queued', $3)
      RETURNING
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [input.campaignId.trim(), JSON.stringify(input.assemblySpec), maxRetries]
    );

    const row = res.rows[0];
    if (!row) {
      throw new Error("Failed to insert delivery assembly job");
    }

    return this.mapRowToDeliveryAssemblyJob(row);
  }

  async claim(
    input: ClaimDeliveryAssemblyJobInput
  ): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined> {
    if (!input || typeof input !== "object") {
      throw new TypeError("ClaimDeliveryAssemblyJobInput must be a non-null object");
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

    // 1. Terminalize expired exhausted active rows in a standalone query
    await this.pool.query(
      `
      UPDATE delivery_assembly_jobs
      SET
        status = 'failed',
        error_trace = 'lease expired; retries exhausted',
        updated_at = NOW()
      WHERE status IN ('leased', 'rendering')
        AND lease_expires_at <= NOW()
        AND retry_count >= max_retries
      `
    );

    // 2. Conditionally claim the oldest eligible queued or expired recoverable job
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const claimRes = await client.query<DeliveryAssemblyJobRow>(
        `
        WITH claimable AS (
          SELECT job_id
          FROM delivery_assembly_jobs
          WHERE (
            status = 'queued'
            OR (
              status IN ('leased', 'rendering')
              AND lease_expires_at <= NOW()
              AND retry_count < max_retries
            )
          )
          ORDER BY created_at ASC, job_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE delivery_assembly_jobs d
        SET
          status = 'leased',
          worker_id = $1,
          lease_token = gen_random_uuid(),
          lease_expires_at = NOW() + ($2 * INTERVAL '1 millisecond'),
          retry_count = CASE
            WHEN d.status IN ('leased', 'rendering') THEN d.retry_count + 1
            ELSE d.retry_count
          END,
          updated_at = NOW()
        FROM claimable c
        WHERE d.job_id = c.job_id
        RETURNING
          d.job_id,
          d.campaign_id,
          d.assembly_spec,
          d.status,
          d.worker_id,
          d.lease_token,
          d.lease_expires_at,
          d.retry_count,
          d.max_retries,
          d.error_trace,
          d.created_at,
          d.updated_at
        `,
        [input.workerId.trim(), input.leaseDurationMs]
      );

      const row = claimRes.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return undefined;
      }

      await client.query("COMMIT");
      return this.mapRowToDeliveryAssemblyJob(row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async start(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    const updateRes = await this.pool.query<DeliveryAssemblyJobRow>(
      `
      UPDATE delivery_assembly_jobs
      SET
        status = 'rendering',
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status = 'leased'
      RETURNING
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [jobId, leaseToken]
    );

    const updatedRow = updateRes.rows[0];
    if (updatedRow) {
      return {
        outcome: "applied",
        job: this.mapRowToDeliveryAssemblyJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    if (currentRow.lease_token === leaseToken && currentRow.status === "rendering") {
      return {
        outcome: "already_applied",
        job: this.mapRowToDeliveryAssemblyJob(currentRow)
      };
    }

    return { outcome: "superseded" };
  }

  async heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    leaseDurationMs: number
  ): Promise<DeliveryAssemblyJobMutationResult> {
    if (
      typeof leaseDurationMs !== "number" ||
      !Number.isFinite(leaseDurationMs) ||
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs <= 0
    ) {
      throw new Error("leaseDurationMs must be a positive finite integer");
    }

    const updateRes = await this.pool.query<DeliveryAssemblyJobRow>(
      `
      UPDATE delivery_assembly_jobs
      SET
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status IN ('leased', 'rendering')
      RETURNING
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [jobId, leaseToken, leaseDurationMs]
    );

    const updatedRow = updateRes.rows[0];
    if (updatedRow) {
      return {
        outcome: "applied",
        job: this.mapRowToDeliveryAssemblyJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    return { outcome: "superseded" };
  }

  async complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    const updateRes = await this.pool.query<DeliveryAssemblyJobRow>(
      `
      UPDATE delivery_assembly_jobs
      SET
        status = 'completed',
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status = 'rendering'
      RETURNING
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [jobId, leaseToken]
    );

    const updatedRow = updateRes.rows[0];
    if (updatedRow) {
      return {
        outcome: "applied",
        job: this.mapRowToDeliveryAssemblyJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    if (currentRow.lease_token === leaseToken && currentRow.status === "completed") {
      return {
        outcome: "already_applied",
        job: this.mapRowToDeliveryAssemblyJob(currentRow)
      };
    }

    return { outcome: "superseded" };
  }

  async fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    const updateRes = await this.pool.query<DeliveryAssemblyJobRow>(
      `
      UPDATE delivery_assembly_jobs
      SET
        status = CASE
          WHEN retry_count < max_retries THEN 'queued'::job_status_enum
          ELSE 'failed'::job_status_enum
        END,
        worker_id = CASE
          WHEN retry_count < max_retries THEN NULL
          ELSE worker_id
        END,
        lease_expires_at = CASE
          WHEN retry_count < max_retries THEN NULL
          ELSE lease_expires_at
        END,
        retry_count = CASE
          WHEN retry_count < max_retries THEN retry_count + 1
          ELSE retry_count
        END,
        error_trace = $3,
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status IN ('leased', 'rendering')
      RETURNING
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [jobId, leaseToken, errorTrace]
    );

    const updatedRow = updateRes.rows[0];
    if (updatedRow) {
      return {
        outcome: "applied",
        job: this.mapRowToDeliveryAssemblyJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    if (currentRow.lease_token === leaseToken && currentRow.status === "failed") {
      return {
        outcome: "already_applied",
        job: this.mapRowToDeliveryAssemblyJob(currentRow)
      };
    }

    return { outcome: "superseded" };
  }

  async defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<DeliveryAssemblyJobMutationResult> {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("reason must be a non-empty string");
    }

    const updateRes = await this.pool.query<DeliveryAssemblyJobRow>(
      `
      UPDATE delivery_assembly_jobs
      SET
        status = 'queued',
        worker_id = NULL,
        lease_expires_at = NULL,
        error_trace = $3,
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status IN ('leased', 'rendering')
      RETURNING
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [jobId, leaseToken, reason]
    );

    const updatedRow = updateRes.rows[0];
    if (updatedRow) {
      return {
        outcome: "deferred",
        job: this.mapRowToDeliveryAssemblyJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    if (currentRow.lease_token === leaseToken && currentRow.status === "queued") {
      return {
        outcome: "already_applied",
        job: this.mapRowToDeliveryAssemblyJob(currentRow)
      };
    }

    return { outcome: "superseded" };
  }

  async getJob(jobId: JobId | string): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined> {
    const row = await this.readJobRow(jobId);
    if (!row) {
      return undefined;
    }
    return this.mapRowToDeliveryAssemblyJob(row);
  }

  private async readJobRow(
    jobId: string,
    runner: Pool | PoolClient = this.pool
  ): Promise<DeliveryAssemblyJobRow | undefined> {
    const res = await runner.query<DeliveryAssemblyJobRow>(
      `
      SELECT
        job_id,
        campaign_id,
        assembly_spec,
        status,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      FROM delivery_assembly_jobs
      WHERE job_id = $1
      `,
      [jobId]
    );
    return res.rows[0];
  }

  private mapRowToDeliveryAssemblyJob(
    row: DeliveryAssemblyJobRow
  ): DeliveryAssemblyJob<AssemblySpec> {
    let rawSpec: unknown;
    if (typeof row.assembly_spec === "string") {
      try {
        rawSpec = JSON.parse(row.assembly_spec);
      } catch (err) {
        throw new Error(
          `Corrupt delivery assembly job ${row.job_id}: invalid JSON in assembly_spec: ${(err as Error).message}`
        );
      }
    } else {
      rawSpec = row.assembly_spec;
    }

    const parsed = AssemblySpecSchema.safeParse(rawSpec);
    if (!parsed.success) {
      throw new Error(
        `Corrupt delivery assembly job ${row.job_id}: assembly_spec failed schema validation: ${parsed.error.message}`
      );
    }

    const assemblySpec = Object.freeze(parsed.data);

    if (row.campaign_id !== assemblySpec.campaignId) {
      throw new Error(
        `Corrupt delivery assembly job ${row.job_id}: row campaign_id (${row.campaign_id}) does not match assemblySpec.campaignId (${assemblySpec.campaignId})`
      );
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
      campaignId: row.campaign_id as CampaignId,
      assemblySpec,
      status: row.status as JobStatus,
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
