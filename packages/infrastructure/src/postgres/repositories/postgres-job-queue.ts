import {
  type CandidateCompletionPayload,
  type ClaimJobInput,
  type EnqueueJobInput,
  InvalidJobCompletionPayloadError,
  type JobAdmissionGate,
  type JobMutationResult,
  type JobQueuePort,
  type TransactionalJobEnqueuer
} from "@cco/application";
import {
  JOB_KINDS,
  type JobId,
  type JobKind,
  type JobStatus,
  type LeaseToken,
  type RenderJob,
  type SceneId
} from "@cco/domain";
import type { Pool, PoolClient } from "pg";

export interface RenderJobRow {
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

export type PostgresJobRunner = Pool | PoolClient;

export async function insertRenderJob(
  runner: PostgresJobRunner,
  input: EnqueueJobInput
): Promise<RenderJob> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("EnqueueJobInput must be a non-null object");
  }
  if (typeof input.sceneId !== "string" || input.sceneId.trim().length === 0) {
    throw new Error("sceneId must be a non-empty string");
  }
  if (!input.jobKind || !(JOB_KINDS as readonly string[]).includes(input.jobKind)) {
    throw new Error("jobKind must be a valid JobKind");
  }
  if (typeof input.workflowTemplate !== "string" || input.workflowTemplate.trim().length === 0) {
    throw new Error("workflowTemplate must be a non-empty string");
  }
  if (
    !input.injectedPayload ||
    typeof input.injectedPayload !== "object" ||
    Array.isArray(input.injectedPayload)
  ) {
    throw new Error("injectedPayload must be a non-null object");
  }
  if (input.maxRetries !== undefined) {
    if (
      typeof input.maxRetries !== "number" ||
      !Number.isFinite(input.maxRetries) ||
      !Number.isInteger(input.maxRetries) ||
      input.maxRetries < 0
    ) {
      throw new Error("maxRetries must be a non-negative finite integer");
    }
  }

  const payloadJson = JSON.stringify(input.injectedPayload);

  let res;
  if (input.maxRetries === undefined) {
    res = await runner.query<RenderJobRow>(
      `
      INSERT INTO render_jobs (
        scene_id,
        job_kind,
        workflow_template,
        injected_payload
      ) VALUES ($1, $2, $3, $4)
      RETURNING
        job_id,
        scene_id,
        job_kind,
        status,
        workflow_template,
        injected_payload,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [input.sceneId, input.jobKind, input.workflowTemplate, payloadJson]
    );
  } else {
    res = await runner.query<RenderJobRow>(
      `
      INSERT INTO render_jobs (
        scene_id,
        job_kind,
        workflow_template,
        injected_payload,
        max_retries
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING
        job_id,
        scene_id,
        job_kind,
        status,
        workflow_template,
        injected_payload,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      `,
      [input.sceneId, input.jobKind, input.workflowTemplate, payloadJson, input.maxRetries]
    );
  }

  return mapRenderJobRow(res.rows[0]!);
}

async function queryAllJobsTerminal(
  queryable: Pick<Pool | PoolClient, "query">,
  sceneId: SceneId,
  jobKind: JobKind
): Promise<boolean> {
  const result = await queryable.query<{ total: string; pending: string }>(
    `
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status IN ('queued', 'leased', 'rendering')) AS pending
    FROM render_jobs
    WHERE scene_id = $1 AND job_kind = $2
    `,
    [sceneId, jobKind]
  );
  const row = result.rows[0];
  return Number(row?.total ?? 0) > 0 && Number(row?.pending ?? 0) === 0;
}

export class PostgresTransactionalJobEnqueuer implements TransactionalJobEnqueuer {
  constructor(private readonly client: PoolClient) {}

  async enqueue(input: EnqueueJobInput): Promise<RenderJob> {
    return insertRenderJob(this.client, input);
  }

  async areAllJobsTerminal(sceneId: SceneId, jobKind: JobKind): Promise<boolean> {
    return queryAllJobsTerminal(this.client, sceneId, jobKind);
  }
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

  async enqueue(input: EnqueueJobInput): Promise<RenderJob> {
    return insertRenderJob(this.pool, input);
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

  async start(jobId: JobId, leaseToken: LeaseToken): Promise<JobMutationResult> {
    const updateRes = await this.pool.query<RenderJobRow>(
      `
      UPDATE render_jobs
      SET
        status = 'rendering',
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status = 'leased'
      RETURNING
        job_id,
        scene_id,
        job_kind,
        status,
        workflow_template,
        injected_payload,
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
        job: this.mapRowToRenderJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    if (currentRow.lease_token === leaseToken && currentRow.status === "rendering") {
      return {
        outcome: "already_applied",
        job: this.mapRowToRenderJob(currentRow)
      };
    }

    return { outcome: "superseded" };
  }

  async heartbeat(
    jobId: JobId,
    leaseToken: LeaseToken,
    leaseDurationMs: number
  ): Promise<JobMutationResult> {
    if (
      typeof leaseDurationMs !== "number" ||
      !Number.isFinite(leaseDurationMs) ||
      !Number.isInteger(leaseDurationMs) ||
      leaseDurationMs <= 0
    ) {
      throw new Error("leaseDurationMs must be a positive finite integer");
    }

    const updateRes = await this.pool.query<RenderJobRow>(
      `
      UPDATE render_jobs
      SET
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status IN ('leased', 'rendering')
      RETURNING
        job_id,
        scene_id,
        job_kind,
        status,
        workflow_template,
        injected_payload,
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
        job: this.mapRowToRenderJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    return { outcome: "superseded" };
  }

  async complete(
    jobId: JobId,
    leaseToken: LeaseToken,
    manifestPayload?: Readonly<Record<string, unknown>>,
    candidatePayload?: CandidateCompletionPayload
  ): Promise<JobMutationResult> {
    let clientReleased = false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const updateRes = await client.query<RenderJobRow>(
        `
        UPDATE render_jobs
        SET
          status = 'completed',
          updated_at = NOW()
        WHERE job_id = $1
          AND lease_token = $2
          AND status = 'rendering'
        RETURNING
          job_id,
          scene_id,
          job_kind,
          status,
          workflow_template,
          injected_payload,
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
        if (updatedRow.job_kind === "candidate") {
          if (manifestPayload !== undefined) {
            throw new InvalidJobCompletionPayloadError(
              "manifestPayload is not allowed for candidate job completion"
            );
          }
          if (candidatePayload === undefined) {
            throw new InvalidJobCompletionPayloadError(
              "candidatePayload is required for candidate job completion"
            );
          }
          await this.insertCandidateRow(client, updatedRow.scene_id, candidatePayload);

          await client.query("COMMIT");
          return {
            outcome: "applied",
            job: this.mapRowToRenderJob(updatedRow)
          };
        }

        if (candidatePayload !== undefined) {
          throw new InvalidJobCompletionPayloadError(
            "candidatePayload is not allowed for production job completion"
          );
        }

        if (
          !manifestPayload ||
          typeof manifestPayload !== "object" ||
          Array.isArray(manifestPayload)
        ) {
          throw new InvalidJobCompletionPayloadError(
            "manifestPayload must be an object for production job completion"
          );
        }

        const promptIdComfy =
          typeof manifestPayload.promptIdComfy === "string" &&
          manifestPayload.promptIdComfy.trim().length > 0
            ? manifestPayload.promptIdComfy
            : typeof (manifestPayload.runtimeMetadata as { promptId?: unknown } | undefined)
                  ?.promptId === "string" &&
                (manifestPayload.runtimeMetadata as { promptId: string }).promptId.trim().length > 0
              ? (manifestPayload.runtimeMetadata as { promptId: string }).promptId
              : undefined;

        if (!promptIdComfy) {
          throw new InvalidJobCompletionPayloadError(
            "manifestPayload.promptIdComfy must be a non-empty string for production job completion"
          );
        }

        const sceneRes = await client.query<{ campaign_id: string }>(
          "SELECT campaign_id FROM storyboard_scenes WHERE scene_id = $1",
          [updatedRow.scene_id]
        );
        const campaignId = sceneRes.rows[0]?.campaign_id;
        if (!campaignId) {
          throw new Error(`Storyboard scene not found: ${updatedRow.scene_id}`);
        }

        const renderAttempt = Number(updatedRow.retry_count) + 1;

        await client.query(
          `
          INSERT INTO generation_manifests (
            job_id,
            prompt_id_comfy,
            campaign_id,
            scene_id,
            render_attempt,
            manifest_payload
          ) VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            updatedRow.job_id,
            promptIdComfy,
            campaignId,
            updatedRow.scene_id,
            renderAttempt,
            JSON.stringify(manifestPayload)
          ]
        );

        await client.query("COMMIT");
        return {
          outcome: "applied",
          job: this.mapRowToRenderJob(updatedRow)
        };
      }

      const currentRow = await this.readJobRow(jobId, client);
      if (!currentRow) {
        await client.query("COMMIT");
        return { outcome: "not_found" };
      }

      if (currentRow.lease_token === leaseToken && currentRow.status === "completed") {
        if (currentRow.job_kind === "production") {
          const manifestCountRes = await client.query<{ count: string }>(
            "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
            [jobId]
          );
          const count = Number(manifestCountRes.rows[0]?.count);
          if (count === 1) {
            await client.query("COMMIT");
            return {
              outcome: "already_applied",
              job: this.mapRowToRenderJob(currentRow)
            };
          }
          throw new Error(
            `Inconsistent duplicate state: completed production job ${jobId} has ${count} manifests`
          );
        }
        const candidateCountRes = await client.query<{ count: string }>(
          "SELECT count(*) FROM storyboard_candidates WHERE scene_id = $1",
          [currentRow.scene_id]
        );
        const candidateCount = Number(candidateCountRes.rows[0]?.count);
        if (candidateCount > 0) {
          await client.query("COMMIT");
          return {
            outcome: "already_applied",
            job: this.mapRowToRenderJob(currentRow)
          };
        }
        throw new Error(
          `Inconsistent duplicate state: completed candidate job ${jobId} has ${candidateCount} candidates`
        );
      }

      await client.query("COMMIT");
      return { outcome: "superseded" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      clientReleased = true;

      const pgError = error as { code?: string; constraint?: string };
      if (
        pgError?.code === "23505" &&
        (!pgError.constraint || pgError.constraint === "generation_manifests_job_id_key")
      ) {
        const currentRow = await this.readJobRow(jobId);
        if (
          currentRow &&
          currentRow.lease_token === leaseToken &&
          currentRow.status === "completed"
        ) {
          const manifestCountRes = await this.pool.query<{ count: string }>(
            "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
            [jobId]
          );
          if (Number(manifestCountRes.rows[0]?.count) === 1) {
            return {
              outcome: "already_applied",
              job: this.mapRowToRenderJob(currentRow)
            };
          }
        }
      }

      throw error;
    } finally {
      if (!clientReleased) {
        client.release();
      }
    }
  }

  async fail(jobId: JobId, leaseToken: LeaseToken, errorTrace: string): Promise<JobMutationResult> {
    const updateRes = await this.pool.query<RenderJobRow>(
      `
      UPDATE render_jobs
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
        scene_id,
        job_kind,
        status,
        workflow_template,
        injected_payload,
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
        job: this.mapRowToRenderJob(updatedRow)
      };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) {
      return { outcome: "not_found" };
    }

    if (currentRow.lease_token === leaseToken && currentRow.status === "failed") {
      return {
        outcome: "already_applied",
        job: this.mapRowToRenderJob(currentRow)
      };
    }

    return { outcome: "superseded" };
  }

  async defer(jobId: JobId, leaseToken: LeaseToken, reason: string): Promise<JobMutationResult> {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new Error("reason must be a non-empty string");
    }

    const updateRes = await this.pool.query<RenderJobRow>(
      `
      UPDATE render_jobs
      SET status = 'queued',
          worker_id = NULL,
          lease_expires_at = NULL,
          error_trace = $3,
          updated_at = NOW()
      WHERE job_id = $1
        AND lease_token = $2
        AND status IN ('leased', 'rendering')
      RETURNING
        job_id, scene_id, job_kind, status, workflow_template, injected_payload,
        worker_id, lease_token, lease_expires_at, retry_count, max_retries,
        error_trace, created_at, updated_at
      `,
      [jobId, leaseToken, reason]
    );

    const updatedRow = updateRes.rows[0];
    if (updatedRow) {
      return { outcome: "deferred", job: this.mapRowToRenderJob(updatedRow) };
    }

    const currentRow = await this.readJobRow(jobId);
    if (!currentRow) return { outcome: "not_found" };
    if (currentRow.lease_token === leaseToken && currentRow.status === "queued") {
      return {
        outcome: "already_applied",
        job: this.mapRowToRenderJob(currentRow)
      };
    }
    return { outcome: "superseded" };
  }

  async areAllJobsTerminal(sceneId: SceneId, jobKind: JobKind): Promise<boolean> {
    return queryAllJobsTerminal(this.pool, sceneId, jobKind);
  }

  private async insertCandidateRow(
    client: PoolClient,
    sceneId: string,
    candidatePayload: CandidateCompletionPayload
  ): Promise<void> {
    if (
      !Number.isInteger(candidatePayload.variantOrdinal) ||
      candidatePayload.variantOrdinal <= 0
    ) {
      throw new InvalidJobCompletionPayloadError(
        "candidatePayload.variantOrdinal must be a positive integer"
      );
    }
    if (
      typeof candidatePayload.storageBucket !== "string" ||
      candidatePayload.storageBucket.trim().length === 0
    ) {
      throw new InvalidJobCompletionPayloadError(
        "candidatePayload.storageBucket must be a non-empty string"
      );
    }
    if (
      typeof candidatePayload.storageObjectKey !== "string" ||
      candidatePayload.storageObjectKey.trim().length === 0
    ) {
      throw new InvalidJobCompletionPayloadError(
        "candidatePayload.storageObjectKey must be a non-empty string"
      );
    }
    if (
      typeof candidatePayload.contentHashSha256 !== "string" ||
      candidatePayload.contentHashSha256.length !== 64
    ) {
      throw new InvalidJobCompletionPayloadError(
        "candidatePayload.contentHashSha256 must be a 64-character sha256 hex digest"
      );
    }

    const sceneRes = await client.query<{ spec_revision: number }>(
      "SELECT spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneId]
    );
    const specRevision = Number(sceneRes.rows[0]?.spec_revision);
    if (!Number.isInteger(specRevision) || specRevision <= 0) {
      throw new Error(`Storyboard scene not found or has invalid spec_revision: ${sceneId}`);
    }

    const generationPayload = candidatePayload.generationPayload ?? {};

    await client.query(
      `
      INSERT INTO storyboard_candidates (
        scene_id,
        scene_spec_revision,
        variant_ordinal,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        generation_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        sceneId,
        specRevision,
        candidatePayload.variantOrdinal,
        candidatePayload.storageBucket,
        candidatePayload.storageObjectKey,
        candidatePayload.contentHashSha256,
        JSON.stringify(generationPayload)
      ]
    );
  }

  private async readJobRow(
    jobId: string,
    runner: Pool | PoolClient = this.pool
  ): Promise<RenderJobRow | undefined> {
    const res = await runner.query<RenderJobRow>(
      `
      SELECT
        job_id,
        scene_id,
        job_kind,
        status,
        workflow_template,
        injected_payload,
        worker_id,
        lease_token,
        lease_expires_at,
        retry_count,
        max_retries,
        error_trace,
        created_at,
        updated_at
      FROM render_jobs
      WHERE job_id = $1
      `,
      [jobId]
    );
    return res.rows[0];
  }

  private mapRowToRenderJob(row: RenderJobRow): RenderJob {
    return mapRenderJobRow(row);
  }
}

export function mapRenderJobRow(row: RenderJobRow): RenderJob {
  let injectedPayload: Readonly<Record<string, unknown>>;
  if (typeof row.injected_payload === "string") {
    try {
      injectedPayload = Object.freeze(JSON.parse(row.injected_payload) as Record<string, unknown>);
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
