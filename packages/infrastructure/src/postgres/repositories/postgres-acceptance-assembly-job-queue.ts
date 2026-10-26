import { randomUUID } from "node:crypto";
import type { AcceptanceAssemblyJobQueuePort } from "@cco/application";
import { type AcceptanceAssemblyJob, AcceptanceAssemblyJobSchema } from "@cco/contracts";
import type { Pool, PoolClient } from "pg";

interface JobRow {
  job_id: string;
  acceptance_run_id: string;
  campaign_id: string;
  status: string;
  realm: unknown;
  evidence_origin: string;
  assembly_spec: unknown;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  worker_id: string | null;
  output_manifest_id: string | null;
  failure_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function parseJsonField<T>(val: unknown): T {
  if (typeof val === "string") {
    return JSON.parse(val) as T;
  }
  return val as T;
}

function mapRowToJob(row: JobRow): AcceptanceAssemblyJob {
  const raw = {
    jobId: row.job_id,
    acceptanceRunId: row.acceptance_run_id,
    campaignId: row.campaign_id,
    status: row.status,
    realm: parseJsonField(row.realm),
    evidenceOrigin: row.evidence_origin,
    assemblySpec: parseJsonField(row.assembly_spec),
    ...(row.lease_token != null ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at != null
      ? {
          leaseExpiresAt:
            row.lease_expires_at instanceof Date
              ? row.lease_expires_at.toISOString()
              : new Date(row.lease_expires_at).toISOString()
        }
      : {}),
    ...(row.worker_id != null ? { workerId: row.worker_id } : {}),
    ...(row.output_manifest_id != null ? { outputManifestId: row.output_manifest_id } : {}),
    ...(row.failure_reason != null ? { failureReason: row.failure_reason } : {}),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  };
  return AcceptanceAssemblyJobSchema.parse(raw);
}

export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJobQueuePort {
  constructor(private readonly client: Pool | PoolClient) {}

  async enqueue(
    job: Omit<AcceptanceAssemblyJob, "status" | "createdAt" | "updatedAt">
  ): Promise<AcceptanceAssemblyJob> {
    const now = new Date().toISOString();
    const query = `
      INSERT INTO acceptance_assembly_jobs (
        job_id,
        acceptance_run_id,
        campaign_id,
        status,
        realm,
        evidence_origin,
        assembly_spec,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, 'queued', $4, $5, $6, $7, $7)
      RETURNING *;
    `;

    const res = await this.client.query<JobRow>(query, [
      job.jobId,
      job.acceptanceRunId,
      job.campaignId,
      JSON.stringify(job.realm),
      job.evidenceOrigin,
      JSON.stringify(job.assemblySpec),
      now
    ]);

    return mapRowToJob(res.rows[0]!);
  }

  async claim(
    workerId: string,
    leaseDurationMs: number
  ): Promise<AcceptanceAssemblyJob | undefined> {
    const leaseToken = randomUUID();
    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'leased',
          worker_id = $1,
          lease_token = $2,
          lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
          updated_at = NOW()
      WHERE job_id = (
        SELECT job_id FROM acceptance_assembly_jobs
        WHERE status = 'queued' OR (status IN ('leased', 'rendering') AND lease_expires_at < NOW())
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    const res = await this.client.query<JobRow>(query, [workerId, leaseToken, leaseDurationMs]);
    if (res.rows.length === 0) return undefined;
    return mapRowToJob(res.rows[0]!);
  }

  async start(jobId: string, leaseToken: string): Promise<void> {
    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'rendering',
          updated_at = NOW()
      WHERE job_id = $1 AND lease_token = $2::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
    `;
    const res = await this.client.query(query, [jobId, leaseToken]);
    if (res.rowCount === 0) {
      throw new Error(
        `Failed to start acceptance assembly job ${jobId}: lease token mismatch, expired, or job not in leased/rendering status`
      );
    }
  }

  async heartbeat(jobId: string, leaseToken: string, leaseDurationMs: number): Promise<void> {
    const query = `
      UPDATE acceptance_assembly_jobs
      SET lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
          updated_at = NOW()
      WHERE job_id = $1 AND lease_token = $2::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
    `;
    const res = await this.client.query(query, [jobId, leaseToken, leaseDurationMs]);
    if (res.rowCount === 0) {
      throw new Error(
        `Failed to heartbeat acceptance assembly job ${jobId}: lease token mismatch, expired, or job not active`
      );
    }
  }

  async complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void> {
    if (!leaseToken) {
      throw new Error(`Lease token is required to complete acceptance assembly job ${jobId}`);
    }
    const existing = await this.findById(jobId);
    if (existing && existing.status === "completed") {
      if (existing.outputManifestId === outputManifestId && existing.leaseToken === leaseToken) {
        return;
      }
      if (existing.leaseToken && existing.leaseToken !== leaseToken) {
        throw new Error(
          `Failed to complete acceptance assembly job ${jobId}: lease token mismatch (job completed under different lease)`
        );
      }
      throw new Error(
        `Acceptance assembly job ${jobId} already completed with different manifest (expected ${existing.outputManifestId}, got ${outputManifestId})`
      );
    }

    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'completed',
          output_manifest_id = $2,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE job_id = $1 AND lease_token = $3::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
    `;
    const res = await this.client.query(query, [jobId, outputManifestId, leaseToken]);
    if (res.rowCount === 0) {
      const recheck = await this.findById(jobId);
      if (
        recheck &&
        recheck.status === "completed" &&
        recheck.outputManifestId === outputManifestId &&
        recheck.leaseToken === leaseToken
      ) {
        return;
      }
      throw new Error(
        `Failed to complete acceptance assembly job ${jobId}: lease token mismatch, expired, or job not found`
      );
    }
  }

  async fail(jobId: string, error: string, leaseToken?: string): Promise<void> {
    if (!leaseToken) {
      throw new Error(`Lease token is required to fail acceptance assembly job ${jobId}`);
    }
    const existing = await this.findById(jobId);
    if (existing && existing.status === "failed") {
      if (existing.leaseToken === leaseToken) {
        return;
      }
    }

    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'failed',
          failure_reason = $2,
          lease_expires_at = NULL,
          updated_at = NOW()
      WHERE job_id = $1 AND lease_token = $3::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
    `;
    const res = await this.client.query(query, [jobId, error, leaseToken]);
    if (res.rowCount === 0) {
      const recheck = await this.findById(jobId);
      if (recheck && recheck.status === "failed" && recheck.leaseToken === leaseToken) {
        return;
      }
      throw new Error(
        `Failed to fail acceptance assembly job ${jobId}: lease token mismatch, expired, or job not active`
      );
    }
  }

  async findById(jobId: string): Promise<AcceptanceAssemblyJob | undefined> {
    const query = `
      SELECT * FROM acceptance_assembly_jobs
      WHERE job_id = $1;
    `;
    const res = await this.client.query<JobRow>(query, [jobId]);
    if (res.rows.length === 0) return undefined;
    return mapRowToJob(res.rows[0]!);
  }
}
