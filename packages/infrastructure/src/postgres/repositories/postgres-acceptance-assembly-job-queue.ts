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
    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
    const leaseToken = randomUUID();
    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'leased',
          worker_id = $1,
          lease_token = $2,
          lease_expires_at = $3,
          updated_at = NOW()
      WHERE job_id = (
        SELECT job_id FROM acceptance_assembly_jobs
        WHERE status = 'queued' OR (status = 'leased' AND lease_expires_at < NOW())
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    const res = await this.client.query<JobRow>(query, [workerId, leaseToken, leaseExpiresAt]);
    if (res.rows.length === 0) return undefined;
    return mapRowToJob(res.rows[0]!);
  }

  async complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void> {
    if (!leaseToken) {
      throw new Error(`Lease token is required to complete acceptance assembly job ${jobId}`);
    }
    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'completed',
          output_manifest_id = $2,
          updated_at = NOW()
      WHERE job_id = $1 AND lease_token = $3::uuid;
    `;
    const res = await this.client.query(query, [jobId, outputManifestId, leaseToken]);
    if (res.rowCount === 0) {
      throw new Error(
        `Failed to complete acceptance assembly job ${jobId}: lease token mismatch or job not found`
      );
    }
  }

  async fail(jobId: string, error: string, leaseToken?: string): Promise<void> {
    if (!leaseToken) {
      throw new Error(`Lease token is required to fail acceptance assembly job ${jobId}`);
    }
    const query = `
      UPDATE acceptance_assembly_jobs
      SET status = 'failed',
          failure_reason = $2,
          updated_at = NOW()
      WHERE job_id = $1 AND lease_token = $3::uuid;
    `;
    const res = await this.client.query(query, [jobId, error, leaseToken]);
    if (res.rowCount === 0) {
      throw new Error(
        `Failed to fail acceptance assembly job ${jobId}: lease token mismatch or job not found`
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
