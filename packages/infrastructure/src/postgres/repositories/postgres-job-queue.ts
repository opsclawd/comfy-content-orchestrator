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
          await this.insertCandidateRow(client, updatedRow.scene_id, candidatePayload, updatedRow);

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
        const candidateCount = await this.countMatchingCandidates(
          client,
          currentRow,
          candidatePayload
        );
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
      if (pgError?.code === "23505") {
        const currentRow = await this.readJobRow(jobId);
        if (
          currentRow &&
          currentRow.lease_token === leaseToken &&
          currentRow.status === "completed"
        ) {
          if (currentRow.job_kind === "production") {
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
          } else if (currentRow.job_kind === "candidate") {
            const candidateCount = await this.countMatchingCandidates(
              this.pool,
              currentRow,
              candidatePayload
            );
            if (candidateCount > 0) {
              return {
                outcome: "already_applied",
                job: this.mapRowToRenderJob(currentRow)
              };
            }
          }
        }

        /*
         * A 23505 on the storyboard_candidates (scene, revision, variant, beat)
         * uniqueness constraint, where THIS job's own render_jobs row was not
         * already completed, means a sibling job targeting the same variant
         * slot already won the race and committed first (e.g. two ShotPlan
         * generations for the same scene/revision/variant/beat). Retrying can
         * never succeed — the slot is permanently taken. Without this branch,
         * the error fell through to an unhandled 500 that the worker retries
         * forever, indefinitely blocking the single-threaded worker on a job
         * that can never complete.
         */
        if (
          pgError.constraint === "uq_storyboard_candidates_variant_beat" ||
          pgError.constraint ===
            "storyboard_candidates_scene_id_scene_spec_revision_variant__key" ||
          pgError.constraint === "storyboard_candidates_scene_id_scene_spec_revision_variant_ord" ||
          pgError.constraint ===
            "storyboard_candidates_scene_id_scene_spec_revision_variant_ordi" ||
          pgError.constraint ===
            "storyboard_candidates_scene_id_scene_spec_revision_variant_ordinal_key"
        ) {
          await this.pool.query(
            `
            UPDATE render_jobs
            SET status = 'failed', error_trace = $2, updated_at = NOW()
            WHERE job_id = $1 AND status <> 'completed'
            `,
            [
              jobId,
              "Superseded: a different job already recorded the storyboard candidate for this scene/revision/variant."
            ]
          );
          return { outcome: "superseded" };
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

  private async countMatchingCandidates(
    runner: Pool | PoolClient,
    currentRow: RenderJobRow,
    candidatePayload?: CandidateCompletionPayload
  ): Promise<number> {
    let injectedPayload: Record<string, unknown> = {};
    if (typeof currentRow.injected_payload === "object" && currentRow.injected_payload !== null) {
      injectedPayload = currentRow.injected_payload as Record<string, unknown>;
    } else if (typeof currentRow.injected_payload === "string") {
      try {
        injectedPayload = JSON.parse(currentRow.injected_payload) as Record<string, unknown>;
      } catch {
        // Ignore JSON parse error on unexpected non-JSON payload
      }
    }

    let specRevision =
      candidatePayload?.specRevision ??
      (typeof injectedPayload["specRevision"] === "number" &&
      Number.isInteger(injectedPayload["specRevision"]) &&
      injectedPayload["specRevision"] > 0
        ? injectedPayload["specRevision"]
        : undefined);

    let variantOrdinal =
      candidatePayload?.variantOrdinal ??
      (typeof injectedPayload["variantOrdinal"] === "number" &&
      Number.isInteger(injectedPayload["variantOrdinal"]) &&
      injectedPayload["variantOrdinal"] > 0
        ? injectedPayload["variantOrdinal"]
        : undefined);

    const shotPlanId =
      candidatePayload?.shotPlanId ??
      (typeof injectedPayload["shotPlanId"] === "string" &&
      injectedPayload["shotPlanId"].trim().length > 0
        ? injectedPayload["shotPlanId"].trim()
        : undefined);

    if (shotPlanId && (specRevision === undefined || variantOrdinal === undefined)) {
      const planRes = await runner.query<{ spec_revision: number; variant_ordinal: number }>(
        "SELECT spec_revision, variant_ordinal FROM shot_plans WHERE shot_plan_id = $1 AND scene_id = $2",
        [shotPlanId, currentRow.scene_id]
      );
      if (planRes.rows[0]) {
        if (specRevision === undefined) {
          specRevision = Number(planRes.rows[0].spec_revision);
        }
        if (variantOrdinal === undefined) {
          variantOrdinal = Number(planRes.rows[0].variant_ordinal);
        }
      }
    }

    const beatIndex =
      candidatePayload?.beatIndex ??
      (typeof injectedPayload["beatIndex"] === "number" &&
      Number.isInteger(injectedPayload["beatIndex"]) &&
      injectedPayload["beatIndex"] > 0
        ? injectedPayload["beatIndex"]
        : 1);

    if (specRevision !== undefined && variantOrdinal !== undefined) {
      const res = await runner.query<{ count: string }>(
        `SELECT count(*) FROM storyboard_candidates
         WHERE scene_id = $1
           AND scene_spec_revision = $2
           AND variant_ordinal = $3
           AND beat_index = $4`,
        [currentRow.scene_id, specRevision, variantOrdinal, beatIndex]
      );
      return Number(res.rows[0]?.count ?? 0);
    }

    if (variantOrdinal !== undefined) {
      const res = await runner.query<{ count: string }>(
        `SELECT count(*) FROM storyboard_candidates
         WHERE scene_id = $1
           AND variant_ordinal = $2
           AND beat_index = $3`,
        [currentRow.scene_id, variantOrdinal, beatIndex]
      );
      return Number(res.rows[0]?.count ?? 0);
    }

    const res = await runner.query<{ count: string }>(
      `SELECT count(*) FROM storyboard_candidates
       WHERE scene_id = $1
         AND beat_index = $2`,
      [currentRow.scene_id, beatIndex]
    );
    const count = Number(res.rows[0]?.count ?? 0);
    if (count > 0) {
      return count;
    }

    const fallbackRes = await runner.query<{ count: string }>(
      "SELECT count(*) FROM storyboard_candidates WHERE scene_id = $1",
      [currentRow.scene_id]
    );
    return Number(fallbackRes.rows[0]?.count ?? 0);
  }

  private async insertCandidateRow(
    client: PoolClient,
    sceneId: string,
    candidatePayload: CandidateCompletionPayload,
    jobRow?: RenderJobRow
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

    if (candidatePayload.beatIndex !== undefined) {
      if (
        typeof candidatePayload.beatIndex !== "number" ||
        !Number.isInteger(candidatePayload.beatIndex) ||
        candidatePayload.beatIndex <= 0
      ) {
        throw new InvalidJobCompletionPayloadError(
          "candidatePayload.beatIndex must be a positive integer"
        );
      }
    }

    const sceneRes = await client.query<{ spec_revision: number }>(
      "SELECT spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneId]
    );
    const sceneCurrentRevision = Number(sceneRes.rows[0]?.spec_revision);
    if (!Number.isInteger(sceneCurrentRevision) || sceneCurrentRevision <= 0) {
      throw new Error(`Storyboard scene not found or has invalid spec_revision: ${sceneId}`);
    }

    let injectedShotPlanId: string | undefined;
    let injectedSpecRevision: number | undefined;
    let injectedBeatIndex: number | undefined;
    if (typeof jobRow?.injected_payload === "object" && jobRow.injected_payload !== null) {
      const payload = jobRow.injected_payload as Record<string, unknown>;
      if (typeof payload.shotPlanId === "string" && payload.shotPlanId.trim().length > 0) {
        injectedShotPlanId = payload.shotPlanId.trim();
      }
      if (
        typeof payload.specRevision === "number" &&
        Number.isInteger(payload.specRevision) &&
        payload.specRevision > 0
      ) {
        injectedSpecRevision = payload.specRevision;
      }
      if (
        typeof payload.beatIndex === "number" &&
        Number.isInteger(payload.beatIndex) &&
        payload.beatIndex > 0
      ) {
        injectedBeatIndex = payload.beatIndex;
      }
    } else if (typeof jobRow?.injected_payload === "string") {
      try {
        const parsed = JSON.parse(jobRow.injected_payload) as Record<string, unknown>;
        if (typeof parsed.shotPlanId === "string" && parsed.shotPlanId.trim().length > 0) {
          injectedShotPlanId = parsed.shotPlanId.trim();
        }
        if (
          typeof parsed.specRevision === "number" &&
          Number.isInteger(parsed.specRevision) &&
          parsed.specRevision > 0
        ) {
          injectedSpecRevision = parsed.specRevision;
        }
        if (
          typeof parsed.beatIndex === "number" &&
          Number.isInteger(parsed.beatIndex) &&
          parsed.beatIndex > 0
        ) {
          injectedBeatIndex = parsed.beatIndex;
        }
      } catch {
        // Ignore JSON parse error on unexpected non-JSON payload
      }
    }

    if (candidatePayload.specRevision !== undefined) {
      if (
        typeof candidatePayload.specRevision !== "number" ||
        !Number.isInteger(candidatePayload.specRevision) ||
        candidatePayload.specRevision <= 0
      ) {
        throw new InvalidJobCompletionPayloadError(
          "candidatePayload.specRevision must be a positive integer"
        );
      }
      if (
        injectedSpecRevision !== undefined &&
        candidatePayload.specRevision !== injectedSpecRevision
      ) {
        throw new InvalidJobCompletionPayloadError(
          `candidatePayload.specRevision (${candidatePayload.specRevision}) does not match injected job specRevision (${injectedSpecRevision})`
        );
      }
    }

    if (
      injectedBeatIndex !== undefined &&
      candidatePayload.beatIndex !== undefined &&
      candidatePayload.beatIndex !== injectedBeatIndex
    ) {
      throw new InvalidJobCompletionPayloadError(
        `candidatePayload.beatIndex (${candidatePayload.beatIndex}) does not match injected job beatIndex (${injectedBeatIndex})`
      );
    }

    const resolvedBeatIndex = candidatePayload.beatIndex ?? injectedBeatIndex ?? 1;
    if (!Number.isInteger(resolvedBeatIndex) || resolvedBeatIndex <= 0) {
      throw new InvalidJobCompletionPayloadError(
        "candidatePayload.beatIndex must be a positive integer"
      );
    }

    const generationPayload = (candidatePayload.generationPayload ?? {}) as Record<string, unknown>;
    const generationBeatIndex = generationPayload.beatIndex;
    if (generationBeatIndex !== undefined) {
      if (
        typeof generationBeatIndex !== "number" ||
        !Number.isInteger(generationBeatIndex) ||
        generationBeatIndex <= 0
      ) {
        throw new InvalidJobCompletionPayloadError(
          "candidatePayload.generationPayload.beatIndex must be a positive integer"
        );
      }
      if (
        candidatePayload.beatIndex !== undefined &&
        generationBeatIndex !== candidatePayload.beatIndex
      ) {
        throw new InvalidJobCompletionPayloadError(
          `candidatePayload.generationPayload.beatIndex (${generationBeatIndex}) does not match candidatePayload.beatIndex (${candidatePayload.beatIndex})`
        );
      }
      if (candidatePayload.beatIndex === undefined && generationBeatIndex !== resolvedBeatIndex) {
        throw new InvalidJobCompletionPayloadError(
          `candidatePayload.generationPayload.beatIndex (${generationBeatIndex}) does not match resolved beatIndex (${resolvedBeatIndex})`
        );
      }
    }

    if (candidatePayload.shotPlanId !== undefined) {
      if (
        typeof candidatePayload.shotPlanId !== "string" ||
        candidatePayload.shotPlanId.trim().length === 0
      ) {
        throw new InvalidJobCompletionPayloadError(
          "candidatePayload.shotPlanId must be a non-empty string"
        );
      }
      if (injectedShotPlanId !== undefined && candidatePayload.shotPlanId !== injectedShotPlanId) {
        throw new InvalidJobCompletionPayloadError(
          `candidatePayload.shotPlanId (${candidatePayload.shotPlanId}) does not match injected job shotPlanId (${injectedShotPlanId})`
        );
      }
    }

    const targetShotPlanId = candidatePayload.shotPlanId ?? injectedShotPlanId;
    let targetSpecRevision = candidatePayload.specRevision ?? injectedSpecRevision;

    if (targetShotPlanId && targetSpecRevision === undefined) {
      const planRes = await client.query<{ spec_revision: number }>(
        "SELECT spec_revision FROM shot_plans WHERE shot_plan_id = $1 AND scene_id = $2",
        [targetShotPlanId, sceneId]
      );
      if (planRes.rows[0]) {
        targetSpecRevision = Number(planRes.rows[0].spec_revision);
      }
    }

    if (targetSpecRevision === undefined) {
      targetSpecRevision = sceneCurrentRevision;
    }

    if (targetSpecRevision > sceneCurrentRevision) {
      throw new InvalidJobCompletionPayloadError(
        `Job target spec_revision (${targetSpecRevision}) exceeds scene spec_revision (${sceneCurrentRevision})`
      );
    }

    let targetPlanRow:
      | {
          shot_plan_id: string;
          spec_revision: number;
          structured_plan: unknown;
          previs_candidate_id: string | null;
        }
      | undefined;

    if (targetShotPlanId) {
      const planRes = await client.query<{
        shot_plan_id: string;
        spec_revision: number;
        structured_plan: unknown;
        previs_candidate_id: string | null;
      }>(
        "SELECT shot_plan_id, spec_revision, structured_plan, previs_candidate_id FROM shot_plans WHERE shot_plan_id = $1 AND scene_id = $2 AND spec_revision = $3",
        [targetShotPlanId, sceneId, targetSpecRevision]
      );
      targetPlanRow = planRes.rows[0];
      if (!targetPlanRow) {
        throw new InvalidJobCompletionPayloadError(
          `Target shot plan ${targetShotPlanId} not found for scene ${sceneId} at spec revision ${targetSpecRevision}`
        );
      }
    } else {
      const planRes = await client.query<{
        shot_plan_id: string;
        spec_revision: number;
        structured_plan: unknown;
        previs_candidate_id: string | null;
      }>(
        "SELECT shot_plan_id, spec_revision, structured_plan, previs_candidate_id FROM shot_plans WHERE scene_id = $1 AND spec_revision = $2 AND variant_ordinal = $3",
        [sceneId, targetSpecRevision, candidatePayload.variantOrdinal]
      );
      targetPlanRow = planRes.rows[0];
    }

    if (targetPlanRow) {
      let structuredPlan: Record<string, unknown> | null = null;
      if (
        typeof targetPlanRow.structured_plan === "object" &&
        targetPlanRow.structured_plan !== null
      ) {
        structuredPlan = targetPlanRow.structured_plan as Record<string, unknown>;
      } else if (typeof targetPlanRow.structured_plan === "string") {
        try {
          structuredPlan = JSON.parse(targetPlanRow.structured_plan) as Record<string, unknown>;
        } catch {
          // Ignore JSON parse error on unexpected non-JSON payload
        }
      }

      if (Array.isArray(structuredPlan?.beats) && structuredPlan.beats.length > 0) {
        const hasMatchingBeat = structuredPlan.beats.some(
          (b: unknown) =>
            typeof b === "object" &&
            b !== null &&
            (b as { beatIndex?: unknown }).beatIndex === resolvedBeatIndex
        );
        if (!hasMatchingBeat) {
          throw new InvalidJobCompletionPayloadError(
            `Shot plan ${targetPlanRow.shot_plan_id} does not contain beatIndex ${resolvedBeatIndex}`
          );
        }
      }
    }

    const insertRes = await client.query<{ candidate_id: string }>(
      `
      INSERT INTO storyboard_candidates (
        scene_id,
        scene_spec_revision,
        variant_ordinal,
        storage_bucket,
        storage_object_key,
        content_hash_sha256,
        generation_payload,
        beat_index
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING candidate_id
      `,
      [
        sceneId,
        targetSpecRevision,
        candidatePayload.variantOrdinal,
        candidatePayload.storageBucket,
        candidatePayload.storageObjectKey,
        candidatePayload.contentHashSha256,
        JSON.stringify(generationPayload),
        resolvedBeatIndex
      ]
    );

    const candidateId = insertRes.rows[0]?.candidate_id;
    if (!candidateId) {
      throw new Error("Failed to insert candidate row");
    }

    if (targetPlanRow) {
      await client.query(
        `
        INSERT INTO shot_plan_previs_associations (
          shot_plan_id,
          beat_index,
          candidate_id,
          scene_id,
          spec_revision,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (shot_plan_id, beat_index) DO UPDATE
        SET
          candidate_id = EXCLUDED.candidate_id,
          scene_id = EXCLUDED.scene_id,
          spec_revision = EXCLUDED.spec_revision,
          updated_at = NOW()
        `,
        [targetPlanRow.shot_plan_id, resolvedBeatIndex, candidateId, sceneId, targetSpecRevision]
      );

      if (resolvedBeatIndex === 1) {
        const profilePayload = candidatePayload.generationPayload?.profile;
        const resolvedModelProfile =
          typeof profilePayload === "string" && profilePayload.trim().length > 0
            ? profilePayload
            : typeof (profilePayload as Record<string, unknown> | undefined)?.profileId ===
                  "string" &&
                ((profilePayload as Record<string, unknown>).profileId as string).trim().length > 0
              ? ((profilePayload as Record<string, unknown>).profileId as string)
              : (jobRow?.workflow_template ?? "flux_schnell_storyboard_v1");

        const previsObj = {
          candidateId,
          storageBucket: candidatePayload.storageBucket,
          storageObjectKey: candidatePayload.storageObjectKey,
          contentHashSha256: candidatePayload.contentHashSha256,
          modelProfile: resolvedModelProfile,
          generatedAt: new Date().toISOString(),
          reviewNotes: null
        };

        if (targetShotPlanId) {
          await client.query(
            `
            UPDATE shot_plans
            SET
              previs_candidate_id = $3,
              structured_plan = jsonb_set(
                structured_plan,
                '{previs}',
                $5::jsonb,
                true
              ),
              updated_at = NOW()
            WHERE shot_plan_id = $1 AND scene_id = $2 AND spec_revision = $4
            `,
            [targetShotPlanId, sceneId, candidateId, targetSpecRevision, JSON.stringify(previsObj)]
          );
        } else {
          await client.query(
            `
            UPDATE shot_plans
            SET
              previs_candidate_id = $4,
              structured_plan = jsonb_set(
                structured_plan,
                '{previs}',
                $5::jsonb,
                true
              ),
              updated_at = NOW()
            WHERE scene_id = $1 AND spec_revision = $2 AND variant_ordinal = $3 AND previs_candidate_id IS NULL
            `,
            [
              sceneId,
              targetSpecRevision,
              candidatePayload.variantOrdinal,
              candidateId,
              JSON.stringify(previsObj)
            ]
          );
        }
      }
    }
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
