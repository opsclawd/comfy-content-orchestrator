import type { AcceptanceAssemblyManifestRepository } from "@cco/application";
import { type AcceptanceAssemblyManifest, AcceptanceAssemblyManifestSchema } from "@cco/contracts";
import type { Pool, PoolClient } from "pg";

interface ManifestRow {
  manifest_id: string;
  job_id: string;
  acceptance_run_id: string;
  campaign_id: string;
  realm: unknown | null;
  evidence_origin: string | null;
  plan_id: string | null;
  accepted_attempt_ids: unknown | null;
  manifest: unknown;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_sha256: string | null;
  manifest_storage_bucket: string | null;
  manifest_storage_key: string | null;
  manifest_storage_sha256: string | null;
  created_at: Date | string;
}

function parseJsonField<T>(val: unknown): T {
  if (typeof val === "string") {
    return JSON.parse(val) as T;
  }
  return val as T;
}

function mapRowToManifest(row: ManifestRow): AcceptanceAssemblyManifest {
  const raw = {
    manifestId: row.manifest_id,
    jobId: row.job_id,
    acceptanceRunId: row.acceptance_run_id,
    campaignId: row.campaign_id,
    ...(row.realm != null ? { realm: parseJsonField(row.realm) } : {}),
    ...(row.evidence_origin != null ? { evidenceOrigin: row.evidence_origin } : {}),
    ...(row.plan_id != null ? { planId: row.plan_id } : {}),
    ...(row.accepted_attempt_ids != null
      ? { acceptedAttemptIds: parseJsonField(row.accepted_attempt_ids) }
      : {}),
    manifest: parseJsonField(row.manifest),
    ...(row.storage_bucket != null ? { storageBucket: row.storage_bucket } : {}),
    ...(row.storage_key != null ? { storageKey: row.storage_key } : {}),
    ...(row.storage_sha256 != null ? { storageSha256: row.storage_sha256 } : {}),
    ...(row.manifest_storage_bucket != null
      ? { manifestStorageBucket: row.manifest_storage_bucket }
      : {}),
    ...(row.manifest_storage_key != null ? { manifestStorageKey: row.manifest_storage_key } : {}),
    ...(row.manifest_storage_sha256 != null
      ? { manifestStorageSha256: row.manifest_storage_sha256 }
      : {}),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString()
  };
  return AcceptanceAssemblyManifestSchema.parse(raw);
}

export class PostgresAcceptanceAssemblyManifestRepository implements AcceptanceAssemblyManifestRepository {
  constructor(private readonly client: Pool | PoolClient) {}

  async saveManifest(manifest: AcceptanceAssemblyManifest): Promise<void> {
    const query = `
      INSERT INTO acceptance_assembly_manifests (
        manifest_id,
        job_id,
        acceptance_run_id,
        campaign_id,
        realm,
        evidence_origin,
        plan_id,
        accepted_attempt_ids,
        manifest,
        storage_bucket,
        storage_key,
        storage_sha256,
        manifest_storage_bucket,
        manifest_storage_key,
        manifest_storage_sha256,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (manifest_id) DO NOTHING;
    `;

    await this.client.query(query, [
      manifest.manifestId,
      manifest.jobId,
      manifest.acceptanceRunId,
      manifest.campaignId,
      manifest.realm ? JSON.stringify(manifest.realm) : null,
      manifest.evidenceOrigin ?? null,
      manifest.planId ?? null,
      manifest.acceptedAttemptIds ? JSON.stringify(manifest.acceptedAttemptIds) : null,
      JSON.stringify(manifest.manifest),
      manifest.storageBucket ?? null,
      manifest.storageKey ?? null,
      manifest.storageSha256 ?? null,
      manifest.manifestStorageBucket ?? null,
      manifest.manifestStorageKey ?? null,
      manifest.manifestStorageSha256 ?? null,
      manifest.createdAt
    ]);
  }

  async findByJobId(jobId: string): Promise<AcceptanceAssemblyManifest | undefined> {
    const query = `
      SELECT * FROM acceptance_assembly_manifests
      WHERE job_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const res = await this.client.query<ManifestRow>(query, [jobId]);
    if (res.rows.length === 0) return undefined;
    return mapRowToManifest(res.rows[0]!);
  }

  async findByRunId(acceptanceRunId: string): Promise<AcceptanceAssemblyManifest | undefined> {
    const query = `
      SELECT * FROM acceptance_assembly_manifests
      WHERE acceptance_run_id = $1
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const res = await this.client.query<ManifestRow>(query, [acceptanceRunId]);
    if (res.rows.length === 0) return undefined;
    return mapRowToManifest(res.rows[0]!);
  }
}
