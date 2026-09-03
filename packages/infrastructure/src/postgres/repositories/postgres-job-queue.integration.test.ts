import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  AssembleGenerationManifest,
  InvalidJobCompletionPayloadError,
  type ExecuteProfileRenderResult,
  type HashBytesPort,
  type JobAdmissionGate,
  type EnqueueJobInput
} from "@cco/application";
import type { CandidateId, JobId, JobKind, LeaseToken, RenderJob, SceneId } from "@cco/domain";
import { PostgresJobQueue } from "./postgres-job-queue.js";
import { PostgresSceneRepository } from "./postgres-scene-repository.js";
import { PostgresStoryboardCandidateRepository } from "./postgres-storyboard-candidate-repository.js";
import { PostgresReferenceAssetRepository } from "./postgres-reference-asset-repository.js";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertRenderJobRecord,
  insertReferenceAssetRecord,
  insertSceneReferenceAssetRecord,
  insertStoryboardCandidateRecord
} from "../test-support/records.js";

describe("PostgresJobQueue integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri()
    });
  }, 120_000);

  afterAll(async () => {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  async function createTestScene(): Promise<{ sceneId: string }> {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    return { sceneId: scene.scene_id };
  }

  it("concurrent claimers lease one queued job exactly once", async () => {
    const { sceneId } = await createTestScene();
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued"
    });

    const queue1 = new PostgresJobQueue(pool);
    const queue2 = new PostgresJobQueue(pool);
    const queue3 = new PostgresJobQueue(pool);

    const [res1, res2, res3] = await Promise.all([
      queue1.claim({ workerId: "worker-1", leaseDurationMs: 30_000 }),
      queue2.claim({ workerId: "worker-2", leaseDurationMs: 30_000 }),
      queue3.claim({ workerId: "worker-3", leaseDurationMs: 30_000 })
    ]);

    const results = [res1, res2, res3].filter((r) => r !== undefined);
    expect(results).toHaveLength(1);

    const winner = results[0]!;
    expect(winner.jobId).toBe(insertedJob.job_id);
    expect(winner.status).toBe("leased");
    expect(winner.leaseToken).toBeDefined();
    expect(winner.workerId).toBeDefined();
    expect(["worker-1", "worker-2", "worker-3"]).toContain(winner.workerId);

    const checkRes = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      lease_expires_at: Date;
      retry_count: number;
    }>(
      "SELECT status, worker_id, lease_token, lease_expires_at, retry_count FROM render_jobs WHERE job_id = $1",
      [insertedJob.job_id]
    );

    expect(checkRes.rows[0]?.status).toBe("leased");
    expect(checkRes.rows[0]?.worker_id).toBe(winner.workerId);
    expect(checkRes.rows[0]?.lease_token).toBe(winner.leaseToken);
    expect(checkRes.rows[0]?.retry_count).toBe(0);
  });

  it("claim leases the oldest eligible job without consuming a retry", async () => {
    const { sceneId } = await createTestScene();
    const olderJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued",
      createdAt: new Date(Date.now() - 60_000)
    });
    const newerJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued",
      createdAt: new Date(Date.now())
    });

    const queue = new PostgresJobQueue(pool);
    const claimed = await queue.claim({ workerId: "worker-alpha", leaseDurationMs: 15_000 });

    expect(claimed).toBeDefined();
    expect(claimed?.jobId).toBe(olderJob.job_id);
    expect(claimed?.status).toBe("leased");
    expect(claimed?.workerId).toBe("worker-alpha");
    expect(claimed?.leaseToken).toBeDefined();
    expect(claimed?.retryCount).toBe(0);
    expect(claimed?.leaseExpiresAt).toBeInstanceOf(Date);
    expect(claimed?.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // Check DB directly
    const dbRow = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      retry_count: number;
    }>("SELECT status, worker_id, lease_token, retry_count FROM render_jobs WHERE job_id = $1", [
      olderJob.job_id
    ]);
    expect(dbRow.rows[0]?.status).toBe("leased");
    expect(dbRow.rows[0]?.worker_id).toBe("worker-alpha");
    expect(dbRow.rows[0]?.retry_count).toBe(0);

    // Second job is still queued
    const newerDbRow = await client.query<{ status: string }>(
      "SELECT status FROM render_jobs WHERE job_id = $1",
      [newerJob.job_id]
    );
    expect(newerDbRow.rows[0]?.status).toBe("queued");
  });

  it("claim reassigns an expired lease with a fresh fencing token", async () => {
    const { sceneId } = await createTestScene();
    const initialToken = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
    const expiredJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "leased",
      workerId: "dead-worker",
      leaseToken: initialToken,
      leaseExpiresAt: new Date(Date.now() - 10_000),
      retryCount: 1,
      maxRetries: 3
    });

    const queue = new PostgresJobQueue(pool);
    const claimed = await queue.claim({ workerId: "new-worker", leaseDurationMs: 20_000 });

    expect(claimed).toBeDefined();
    expect(claimed?.jobId).toBe(expiredJob.job_id);
    expect(claimed?.workerId).toBe("new-worker");
    expect(claimed?.leaseToken).not.toBe(initialToken);
    expect(claimed?.retryCount).toBe(2);
    expect(claimed?.status).toBe("leased");
    expect(claimed?.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    const dbRow = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      retry_count: number;
    }>("SELECT status, worker_id, lease_token, retry_count FROM render_jobs WHERE job_id = $1", [
      expiredJob.job_id
    ]);
    expect(dbRow.rows[0]?.status).toBe("leased");
    expect(dbRow.rows[0]?.worker_id).toBe("new-worker");
    expect(dbRow.rows[0]?.lease_token).toBe(claimed?.leaseToken);
    expect(dbRow.rows[0]?.retry_count).toBe(2);
  });

  it("claim terminalizes an expired lease at retry exhaustion", async () => {
    const { sceneId } = await createTestScene();
    const exhaustedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "rendering",
      workerId: "stalled-worker",
      leaseExpiresAt: new Date(Date.now() - 5_000),
      retryCount: 3,
      maxRetries: 3
    });

    const queue = new PostgresJobQueue(pool);
    const claimed = await queue.claim({ workerId: "worker-next", leaseDurationMs: 10_000 });

    expect(claimed).toBeUndefined();

    const dbRow = await client.query<{
      status: string;
      error_trace: string;
      retry_count: number;
    }>("SELECT status, error_trace, retry_count FROM render_jobs WHERE job_id = $1", [
      exhaustedJob.job_id
    ]);
    expect(dbRow.rows[0]?.status).toBe("failed");
    expect(dbRow.rows[0]?.error_trace).toBe("lease expired; retries exhausted");
    expect(dbRow.rows[0]?.retry_count).toBe(3);

    // Later claims never return it
    const claimedAgain = await queue.claim({ workerId: "worker-next", leaseDurationMs: 10_000 });
    expect(claimedAgain).toBeUndefined();
  });

  it("admission refusal rolls back every claim mutation", async () => {
    const { sceneId } = await createTestScene();
    const job = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null
    });

    const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      job.job_id
    ]);

    const refusingGate: JobAdmissionGate = {
      async canAdmit(): Promise<boolean> {
        return false;
      }
    };

    const queue = new PostgresJobQueue(pool, refusingGate);
    const claimed = await queue.claim({ workerId: "worker-1", leaseDurationMs: 30_000 });

    expect(claimed).toBeUndefined();

    const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      job.job_id
    ]);

    expect(postSnapshot.rows[0]).toEqual(preSnapshot.rows[0]);
  });

  it("admission failure rolls back and propagates", async () => {
    const { sceneId } = await createTestScene();
    const job = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null
    });

    const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      job.job_id
    ]);

    const throwingGate: JobAdmissionGate = {
      async canAdmit(): Promise<boolean> {
        throw new Error("Admission downstream failure");
      }
    };

    const queue = new PostgresJobQueue(pool, throwingGate);
    await expect(queue.claim({ workerId: "worker-1", leaseDurationMs: 30_000 })).rejects.toThrow(
      "Admission downstream failure"
    );

    const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      job.job_id
    ]);

    expect(postSnapshot.rows[0]).toEqual(preSnapshot.rows[0]);
  });

  it("claim rejects invalid ownership input before opening a transaction", async () => {
    const { sceneId } = await createTestScene();
    await insertRenderJobRecord(client, {
      sceneId,
      status: "queued"
    });

    const queue = new PostgresJobQueue(pool);

    // Empty or whitespace workerId
    await expect(queue.claim({ workerId: "", leaseDurationMs: 10_000 })).rejects.toThrow();
    await expect(queue.claim({ workerId: "   ", leaseDurationMs: 10_000 })).rejects.toThrow();

    // Invalid lease durations: non-positive, fractional, infinite, non-finite
    await expect(queue.claim({ workerId: "worker-1", leaseDurationMs: 0 })).rejects.toThrow();
    await expect(queue.claim({ workerId: "worker-1", leaseDurationMs: -100 })).rejects.toThrow();
    await expect(queue.claim({ workerId: "worker-1", leaseDurationMs: 15.5 })).rejects.toThrow();
    await expect(
      queue.claim({ workerId: "worker-1", leaseDurationMs: Infinity })
    ).rejects.toThrow();
    await expect(
      queue.claim({ workerId: "worker-1", leaseDurationMs: -Infinity })
    ).rejects.toThrow();
    await expect(queue.claim({ workerId: "worker-1", leaseDurationMs: NaN })).rejects.toThrow();

    // Invalid allowedJobKinds
    await expect(
      queue.claim({
        workerId: "worker-1",
        leaseDurationMs: 10_000,
        allowedJobKinds: ["invalid-kind" as unknown as "candidate"]
      })
    ).rejects.toThrow();

    // Verify queue row untouched
    const countRes = await client.query<{ count: string }>(
      "SELECT count(*) FROM render_jobs WHERE status = 'queued'"
    );
    expect(Number(countRes.rows[0]?.count)).toBe(1);
  });

  it("admission refusal does not revert preceding expired job cleanup", async () => {
    const { sceneId } = await createTestScene();

    // 1. Insert an expired exhausted job
    const exhaustedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "rendering",
      workerId: "stalled-worker",
      leaseExpiresAt: new Date(Date.now() - 5_000),
      retryCount: 3,
      maxRetries: 3
    });

    // 2. Insert a queued job
    const queuedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null
    });

    // 3. Admission gate that refuses admission
    const refusingGate: JobAdmissionGate = {
      async canAdmit(): Promise<boolean> {
        return false;
      }
    };

    const queue = new PostgresJobQueue(pool, refusingGate);
    const claimed = await queue.claim({ workerId: "worker-1", leaseDurationMs: 30_000 });

    expect(claimed).toBeUndefined();

    // The queued job was rolled back / left queued
    const queuedDbRow = await client.query<{ status: string }>(
      "SELECT status FROM render_jobs WHERE job_id = $1",
      [queuedJob.job_id]
    );
    expect(queuedDbRow.rows[0]?.status).toBe("queued");

    // The exhausted job was terminalized and NOT rolled back
    const exhaustedDbRow = await client.query<{ status: string; error_trace: string }>(
      "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
      [exhaustedJob.job_id]
    );
    expect(exhaustedDbRow.rows[0]?.status).toBe("failed");
    expect(exhaustedDbRow.rows[0]?.error_trace).toBe("lease expired; retries exhausted");
  });

  it("skips blocked job kinds and claims oldest admissible job without head-of-line blocking", async () => {
    const { sceneId } = await createTestScene();

    // Older candidate job
    const olderCandidateJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "queued",
      createdAt: new Date(Date.now() - 60_000)
    });

    // Newer production job
    const newerProductionJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "production",
      status: "queued",
      createdAt: new Date(Date.now())
    });

    // Gate that blocks candidate jobs (e.g. storage degraded) but admits production jobs
    const gate: JobAdmissionGate = {
      async canAdmit(jobKind: string): Promise<boolean> {
        return jobKind === "production";
      }
    };

    const queue = new PostgresJobQueue(pool, gate);
    const claimed = await queue.claim({ workerId: "worker-prod", leaseDurationMs: 20_000 });

    expect(claimed).toBeDefined();
    expect(claimed?.jobId).toBe(newerProductionJob.job_id);
    expect(claimed?.jobKind).toBe("production");
    expect(claimed?.status).toBe("leased");

    // Older candidate job was not blocked or locked permanently, still queued
    const candidateDbRow = await client.query<{ status: string }>(
      "SELECT status FROM render_jobs WHERE job_id = $1",
      [olderCandidateJob.job_id]
    );
    expect(candidateDbRow.rows[0]?.status).toBe("queued");
  });

  it("supports worker allowedJobKinds filter", async () => {
    const { sceneId } = await createTestScene();

    // Older production job
    const olderProductionJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "production",
      status: "queued",
      createdAt: new Date(Date.now() - 60_000)
    });

    // Newer candidate job
    const newerCandidateJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "queued",
      createdAt: new Date(Date.now())
    });

    const queue = new PostgresJobQueue(pool);
    // Worker specifically asks only for candidate jobs
    const claimed = await queue.claim({
      workerId: "candidate-worker",
      leaseDurationMs: 15_000,
      allowedJobKinds: ["candidate"]
    });

    expect(claimed).toBeDefined();
    expect(claimed?.jobId).toBe(newerCandidateJob.job_id);
    expect(claimed?.jobKind).toBe("candidate");

    // Production job still queued
    const productionDbRow = await client.query<{ status: string }>(
      "SELECT status FROM render_jobs WHERE job_id = $1",
      [olderProductionJob.job_id]
    );
    expect(productionDbRow.rows[0]?.status).toBe("queued");
  });

  it("start transitions the current lease from leased to rendering", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const expiry = new Date(Date.now() + 60_000);
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "leased",
      workerId: "worker-start",
      leaseToken: token,
      leaseExpiresAt: expiry,
      retryCount: 0,
      maxRetries: 3
    });

    const queue = new PostgresJobQueue(pool);
    const result = await queue.start(insertedJob.job_id as JobId, token);

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.jobId).toBe(insertedJob.job_id);
      expect(result.job.status).toBe("rendering");
      expect(result.job.workerId).toBe("worker-start");
      expect(result.job.leaseToken).toBe(token);
      expect(result.job.retryCount).toBe(0);
      expect(result.job.maxRetries).toBe(3);
    }

    const dbRow = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      retry_count: number;
      max_retries: number;
    }>(
      "SELECT status, worker_id, lease_token, retry_count, max_retries FROM render_jobs WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(dbRow.rows[0]?.status).toBe("rendering");
    expect(dbRow.rows[0]?.worker_id).toBe("worker-start");
    expect(dbRow.rows[0]?.lease_token).toBe(token);
    expect(dbRow.rows[0]?.retry_count).toBe(0);
    expect(dbRow.rows[0]?.max_retries).toBe(3);
  });

  it("start is idempotent only for the same token already rendering", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const staleToken = "01950c46-9e90-7d3d-82d2-8f1d3c000099" as LeaseToken;

    // 1. Same-token rendering returns already_applied with the job
    const renderingJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "rendering",
      workerId: "worker-1",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const queue = new PostgresJobQueue(pool);
    const repeatedStartResult = await queue.start(renderingJob.job_id as JobId, token);

    expect(repeatedStartResult.outcome).toBe("already_applied");
    if (repeatedStartResult.outcome === "already_applied") {
      expect(repeatedStartResult.job.jobId).toBe(renderingJob.job_id);
      expect(repeatedStartResult.job.status).toBe("rendering");
      expect(repeatedStartResult.job.leaseToken).toBe(token);
    }

    // 2. Table of non-applicable / superseded states:
    const testCases = [
      { status: "queued" as const, tokenToUse: token, desc: "queued status with token" },
      { status: "completed" as const, tokenToUse: token, desc: "completed status with token" },
      { status: "failed" as const, tokenToUse: token, desc: "failed status with token" },
      { status: "cancelled" as const, tokenToUse: token, desc: "cancelled status with token" },
      { status: "leased" as const, tokenToUse: staleToken, desc: "leased status with stale token" },
      {
        status: "rendering" as const,
        tokenToUse: staleToken,
        desc: "rendering status with stale token"
      }
    ];

    for (const tc of testCases) {
      const job = await insertRenderJobRecord(client, {
        sceneId,
        status: tc.status,
        workerId: tc.status === "queued" ? null : "worker-1",
        leaseToken: tc.status === "queued" ? null : token,
        leaseExpiresAt: tc.status === "queued" ? null : new Date(Date.now() + 60_000),
        retryCount: 0
      });

      const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);

      const res = await queue.start(job.job_id as JobId, tc.tokenToUse);
      expect(res.outcome, `Expected superseded for ${tc.desc}`).toBe("superseded");
      expect((res as { job?: unknown }).job).toBeUndefined();

      const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);
      expect(postSnapshot.rows[0], `Row mutated for ${tc.desc}`).toEqual(preSnapshot.rows[0]);
    }
  });

  it("heartbeat extends only a current active lease from database time", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const queue = new PostgresJobQueue(pool);

    for (const status of ["leased" as const, "rendering" as const]) {
      const initialExpiry = new Date(Date.now() + 5_000);
      const job = await insertRenderJobRecord(client, {
        sceneId,
        status,
        workerId: "worker-hb",
        leaseToken: token,
        leaseExpiresAt: initialExpiry,
        retryCount: 1,
        maxRetries: 3
      });

      const result = await queue.heartbeat(job.job_id as JobId, token, 60_000);

      expect(result.outcome).toBe("applied");
      if (result.outcome === "applied") {
        expect(result.job.jobId).toBe(job.job_id);
        expect(result.job.status).toBe(status);
        expect(result.job.workerId).toBe("worker-hb");
        expect(result.job.leaseToken).toBe(token);
        expect(result.job.retryCount).toBe(1);
        expect(result.job.maxRetries).toBe(3);
        expect(result.job.leaseExpiresAt).toBeInstanceOf(Date);
        expect(result.job.leaseExpiresAt!.getTime()).toBeGreaterThan(initialExpiry.getTime());
      }

      const dbRow = await client.query<{
        status: string;
        worker_id: string;
        lease_token: string;
        lease_expires_at: Date;
        retry_count: number;
        max_retries: number;
      }>(
        "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, max_retries FROM render_jobs WHERE job_id = $1",
        [job.job_id]
      );
      expect(dbRow.rows[0]?.status).toBe(status);
      expect(dbRow.rows[0]?.worker_id).toBe("worker-hb");
      expect(dbRow.rows[0]?.lease_token).toBe(token);
      expect(dbRow.rows[0]?.retry_count).toBe(1);
      expect(dbRow.rows[0]?.max_retries).toBe(3);
      expect(new Date(dbRow.rows[0]!.lease_expires_at).getTime()).toBeGreaterThan(
        initialExpiry.getTime()
      );
    }
  });

  it("heartbeat never revives queued or terminal work", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const staleToken = "01950c46-9e90-7d3d-82d2-8f1d3c000099" as LeaseToken;
    const queue = new PostgresJobQueue(pool);

    const testCases = [
      { status: "queued" as const, tokenToUse: token, desc: "queued status" },
      { status: "completed" as const, tokenToUse: token, desc: "completed status" },
      { status: "failed" as const, tokenToUse: token, desc: "failed status" },
      { status: "cancelled" as const, tokenToUse: token, desc: "cancelled status" },
      { status: "leased" as const, tokenToUse: staleToken, desc: "leased status with stale token" },
      {
        status: "rendering" as const,
        tokenToUse: staleToken,
        desc: "rendering status with stale token"
      }
    ];

    for (const tc of testCases) {
      const job = await insertRenderJobRecord(client, {
        sceneId,
        status: tc.status,
        workerId: tc.status === "queued" ? null : "worker-hb",
        leaseToken: tc.status === "queued" ? null : token,
        leaseExpiresAt: tc.status === "queued" ? null : new Date(Date.now() + 60_000),
        retryCount: 1,
        maxRetries: 3
      });

      const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);

      const res = await queue.heartbeat(job.job_id as JobId, tc.tokenToUse, 30_000);
      expect(res.outcome, `Expected superseded for ${tc.desc}`).toBe("superseded");
      expect((res as { job?: unknown }).job).toBeUndefined();

      const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);
      expect(postSnapshot.rows[0], `Row mutated for ${tc.desc}`).toEqual(preSnapshot.rows[0]);
    }
  });

  it("missing mutations return not_found", async () => {
    const missingJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000000" as JobId;
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const queue = new PostgresJobQueue(pool);

    const startResult = await queue.start(missingJobId, token);
    expect(startResult.outcome).toBe("not_found");
    expect((startResult as { job?: unknown }).job).toBeUndefined();

    const heartbeatResult = await queue.heartbeat(missingJobId, token, 30_000);
    expect(heartbeatResult.outcome).toBe("not_found");
    expect((heartbeatResult as { job?: unknown }).job).toBeUndefined();
  });

  it("heartbeat rejects invalid durations before querying", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const job = await insertRenderJobRecord(client, {
      sceneId,
      status: "leased",
      workerId: "worker-hb",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      job.job_id
    ]);

    const queue = new PostgresJobQueue(pool);

    const invalidDurations = [0, -100, 15.5, Infinity, -Infinity, NaN];
    for (const dur of invalidDurations) {
      await expect(
        queue.heartbeat(job.job_id as JobId, token, dur),
        `Duration ${dur} should reject`
      ).rejects.toThrow();
    }

    const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      job.job_id
    ]);
    expect(postSnapshot.rows[0]).toEqual(preSnapshot.rows[0]);
  });

  it("completes a candidate without a manifest", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "rendering",
      workerId: "worker-cand",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const candidatePayload = {
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneId}/rev_1_var_1.webp`,
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    };

    const queue = new PostgresJobQueue(pool);
    const result = await queue.complete(
      insertedJob.job_id as JobId,
      token,
      undefined,
      candidatePayload
    );

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.jobId).toBe(insertedJob.job_id);
      expect(result.job.jobKind).toBe("candidate");
      expect(result.job.status).toBe("completed");
      expect(result.job.workerId).toBe("worker-cand");
      expect(result.job.leaseToken).toBe(token);
      expect(result.job.retryCount).toBe(0);
    }

    const jobRow = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      retry_count: number;
    }>("SELECT status, worker_id, lease_token, retry_count FROM render_jobs WHERE job_id = $1", [
      insertedJob.job_id
    ]);
    expect(jobRow.rows[0]?.status).toBe("completed");
    expect(jobRow.rows[0]?.worker_id).toBe("worker-cand");
    expect(jobRow.rows[0]?.lease_token).toBe(token);
    expect(jobRow.rows[0]?.retry_count).toBe(0);

    const manifestCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(Number(manifestCount.rows[0]?.count)).toBe(0);
  });

  it("completes a candidate and writes exactly one storyboard_candidates row from the payload", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "rendering",
      workerId: "worker-cand-row",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const candidatePayload = {
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneId}/rev_1_var_2.webp`,
      contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      generationPayload: { promptIdComfy: "prompt-cand-2" }
    };

    const queue = new PostgresJobQueue(pool);
    const result = await queue.complete(
      insertedJob.job_id as JobId,
      token,
      undefined,
      candidatePayload
    );

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.status).toBe("completed");
    }

    const candidateRows = await client.query<{
      candidate_id: string;
      scene_id: string;
      scene_spec_revision: number;
      variant_ordinal: number;
      storage_bucket: string;
      storage_object_key: string;
      content_hash_sha256: string;
      generation_payload: Record<string, unknown>;
    }>(
      `SELECT candidate_id, scene_id, scene_spec_revision, variant_ordinal,
              storage_bucket, storage_object_key, content_hash_sha256, generation_payload
       FROM storyboard_candidates
       WHERE scene_id = $1`,
      [sceneId]
    );
    expect(candidateRows.rows).toHaveLength(1);
    const row = candidateRows.rows[0];
    expect(row?.scene_id).toBe(sceneId);
    expect(row?.scene_spec_revision).toBe(1);
    expect(row?.variant_ordinal).toBe(2);
    expect(row?.storage_bucket).toBe("godzspeed-temp");
    expect(row?.storage_object_key).toBe(`candidates/${sceneId}/rev_1_var_2.webp`);
    expect(row?.content_hash_sha256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(row?.generation_payload).toEqual({ promptIdComfy: "prompt-cand-2" });

    const manifestCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(Number(manifestCount.rows[0]?.count)).toBe(0);
  });

  it("rejects candidate completion without a candidate payload", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "rendering",
      workerId: "worker-cand-missing",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000)
    });

    const queue = new PostgresJobQueue(pool);
    await expect(
      queue.complete(insertedJob.job_id as JobId, token, undefined, undefined)
    ).rejects.toBeInstanceOf(InvalidJobCompletionPayloadError);
  });

  it("rejects candidate completion when both manifest and candidate payloads are supplied", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "rendering",
      workerId: "worker-cand-both",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000)
    });

    const queue = new PostgresJobQueue(pool);
    await expect(
      queue.complete(
        insertedJob.job_id as JobId,
        token,
        { promptIdComfy: "p" },
        {
          variantOrdinal: 1,
          storageBucket: "b",
          storageObjectKey: "k",
          contentHashSha256: "h".repeat(64)
        }
      )
    ).rejects.toBeInstanceOf(InvalidJobCompletionPayloadError);
  });

  it("completes production and its manifest in one transaction", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 1,
      maxRetries: 3
    });

    const manifestPayload = {
      promptIdComfy: "prompt-prod-12345",
      frameCount: 97,
      outputBucket: "godzspeed-delivery",
      outputObjectKey: `campaigns/${campaign.campaign_id}/scenes/${scene.scene_id}/output.mp4`
    };

    const queue = new PostgresJobQueue(pool);
    const result = await queue.complete(insertedJob.job_id as JobId, token, manifestPayload);

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.jobId).toBe(insertedJob.job_id);
      expect(result.job.jobKind).toBe("production");
      expect(result.job.status).toBe("completed");
      expect(result.job.workerId).toBe("worker-prod");
      expect(result.job.leaseToken).toBe(token);
      expect(result.job.retryCount).toBe(1);
    }

    const jobRow = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      retry_count: number;
    }>("SELECT status, worker_id, lease_token, retry_count FROM render_jobs WHERE job_id = $1", [
      insertedJob.job_id
    ]);
    expect(jobRow.rows[0]?.status).toBe("completed");
    expect(jobRow.rows[0]?.worker_id).toBe("worker-prod");
    expect(jobRow.rows[0]?.lease_token).toBe(token);
    expect(jobRow.rows[0]?.retry_count).toBe(1);

    const manifestRes = await client.query<{
      manifest_id: string;
      job_id: string;
      prompt_id_comfy: string;
      campaign_id: string;
      scene_id: string;
      render_attempt: number;
      manifest_payload: unknown;
    }>("SELECT * FROM generation_manifests WHERE job_id = $1", [insertedJob.job_id]);

    expect(manifestRes.rows).toHaveLength(1);
    const manifest = manifestRes.rows[0]!;
    expect(manifest.job_id).toBe(insertedJob.job_id);
    expect(manifest.prompt_id_comfy).toBe("prompt-prod-12345");
    expect(manifest.campaign_id).toBe(campaign.campaign_id);
    expect(manifest.scene_id).toBe(scene.scene_id);
    expect(manifest.render_attempt).toBe(2);
    expect(manifest.manifest_payload).toEqual(manifestPayload);
  });

  it("completes production job using a manifest assembled by AssembleGenerationManifest with real Postgres repositories", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id
    });
    const refAsset = await insertReferenceAssetRecord(client, { clientId: clientRec.client_id });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: refAsset.asset_id
    });
    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: scene.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      contentHashSha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
    });
    await client.query(
      `UPDATE storyboard_scenes
       SET selected_candidate_id = $1,
           selected_candidate_revision = 1,
           approved_by = 'director-1',
           approved_at = NOW(),
           approved_revision = 1
       WHERE scene_id = $2`,
      [candidate.candidate_id, scene.scene_id]
    );

    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const sceneRepository = new PostgresSceneRepository(pool);
    const storyboardCandidateRepository = new PostgresStoryboardCandidateRepository(pool);
    const referenceAssetRepository = new PostgresReferenceAssetRepository(pool);
    const hashBytes: HashBytesPort = {
      hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
    };

    const assembler = new AssembleGenerationManifest({
      hashBytes,
      sceneRepository,
      storyboardCandidateRepository,
      referenceAssetRepository
    });

    const renderJob: RenderJob = {
      jobId: insertedJob.job_id as JobId,
      sceneId: scene.scene_id as SceneId,
      jobKind: "production",
      status: "rendering",
      workflowTemplate: "ltx-25",
      injectedPayload: {
        prompt: "A majestic mountain",
        negativePrompt: "blurry",
        audioPrompt: "mountain wind and eagles",
        seed: 42
      },
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const profile = {
      id: "ltx-25-test",
      engine: "ltx_25",
      runnerProfile: "dynamicvram-offload-v1",
      source: {
        kind: "host_export",
        license: "GPL-3.0"
      },
      baseline: {
        width: 1280,
        height: 720,
        frames: 97,
        steps: 8,
        approximateDurationSeconds: 5
      },
      models: [{ category: "diffusion_models", relativePath: "ltx.safetensors" }]
    };

    const provenance = {
      generatedAt: "2026-08-29T12:00:00.000Z",
      workflow: { sha256: "workflow-sha256-test" },
      models: [
        {
          key: "models/ltx.safetensors",
          category: "diffusion_models",
          sha256: "model-sha256-test",
          bytes: 1024
        }
      ],
      git: {
        comfyUiCommit: "git-commit-test",
        customNodes: []
      }
    };

    const renderResult: ExecuteProfileRenderResult = {
      status: "succeeded",
      promptId: "prompt-real-postgres-999",
      outputObjectKeys: ["renders/output.mp4"],
      durationMs: 3500,
      profile: {
        profileId: "ltx-25-test",
        renderProfileKey: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        engine: "ltx_25",
        workflowSha256: "workflow-sha256-test",
        modelSha256: {},
        runnerProfile: "dynamicvram-offload-v1",
        comfyUiCommit: "git-commit-test"
      },
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: "2026-08-29T12:00:00.000Z"
      }
    };

    const workflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1
        }
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "A majestic mountain" }
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "blurry" }
      }
    };

    const mediaObjects = [
      {
        bucket: "godzspeed-delivery",
        key: `scenes/${scene.scene_id}/output.mp4`,
        body: new Uint8Array([1, 2, 3]),
        checksumSha256: "aabbcc00112233445566778899aabbcc00112233445566778899aabbcc001122"
      }
    ];

    const { manifestPayload } = await assembler.assemble({
      job: renderJob,
      profile,
      provenance,
      renderResult,
      workflow,
      mediaObjects,
      approvedCandidateId: candidate.candidate_id as CandidateId
    });

    expect(manifestPayload.promptIdComfy).toBe("prompt-real-postgres-999");

    const queue = new PostgresJobQueue(pool);
    const result = await queue.complete(insertedJob.job_id as JobId, token, manifestPayload);

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.status).toBe("completed");
    }

    const manifestRes = await client.query<{
      manifest_id: string;
      job_id: string;
      prompt_id_comfy: string;
      campaign_id: string;
      scene_id: string;
      render_attempt: number;
      manifest_payload: Record<string, unknown>;
    }>("SELECT * FROM generation_manifests WHERE job_id = $1", [insertedJob.job_id]);

    expect(manifestRes.rows).toHaveLength(1);
    const row = manifestRes.rows[0]!;
    expect(row.job_id).toBe(insertedJob.job_id);
    expect(row.prompt_id_comfy).toBe("prompt-real-postgres-999");
    expect(row.campaign_id).toBe(campaign.campaign_id);
    expect(row.scene_id).toBe(scene.scene_id);
    expect(row.render_attempt).toBe(1);
    expect(row.manifest_payload).toEqual(manifestPayload);
  });

  it("completes production job when promptId is provided via runtimeMetadata.promptId", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const manifestPayload = {
      runtimeMetadata: {
        promptId: "prompt-nested-runtime-123"
      },
      frameCount: 97
    };

    const queue = new PostgresJobQueue(pool);
    const result = await queue.complete(insertedJob.job_id as JobId, token, manifestPayload);

    expect(result.outcome).toBe("applied");

    const manifestRes = await client.query<{
      prompt_id_comfy: string;
    }>("SELECT prompt_id_comfy FROM generation_manifests WHERE job_id = $1", [insertedJob.job_id]);

    expect(manifestRes.rows).toHaveLength(1);
    expect(manifestRes.rows[0]?.prompt_id_comfy).toBe("prompt-nested-runtime-123");
  });

  it("preserves idempotent production completion", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const manifestPayload = { promptIdComfy: "prompt-idempotent-1" };
    const queue = new PostgresJobQueue(pool);

    const firstResult = await queue.complete(insertedJob.job_id as JobId, token, manifestPayload);
    expect(firstResult.outcome).toBe("applied");

    const secondResult = await queue.complete(insertedJob.job_id as JobId, token, manifestPayload);
    expect(secondResult.outcome).toBe("already_applied");
    if (secondResult.outcome === "already_applied") {
      expect(secondResult.job.jobId).toBe(insertedJob.job_id);
      expect(secondResult.job.status).toBe("completed");
      expect(secondResult.job.leaseToken).toBe(token);
    }

    const manifestCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(Number(manifestCount.rows[0]?.count)).toBe(1);
  });

  it("concurrent production completion has one durable winner", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const manifestPayload = { promptIdComfy: "prompt-concurrent-winner" };
    const queue1 = new PostgresJobQueue(pool);
    const queue2 = new PostgresJobQueue(pool);

    const p1 = queue1.complete(insertedJob.job_id as JobId, token, manifestPayload);
    const p2 = queue2.complete(insertedJob.job_id as JobId, token, manifestPayload);

    const [res1, res2] = await Promise.all([p1, p2]);
    const outcomes = [res1.outcome, res2.outcome].sort();
    expect(outcomes).toEqual(["already_applied", "applied"]);

    const dbRow = await client.query<{
      status: string;
      lease_token: string;
    }>("SELECT status, lease_token FROM render_jobs WHERE job_id = $1", [insertedJob.job_id]);
    expect(dbRow.rows[0]?.status).toBe("completed");
    expect(dbRow.rows[0]?.lease_token).toBe(token);

    const manifestCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(Number(manifestCount.rows[0]?.count)).toBe(1);
  });

  it("stale completion is fenced after lease reclaim", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const oldToken = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const newToken = "01950c46-9e90-7d3d-82d2-8f1d3c000002" as LeaseToken;

    const insertedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "leased",
      workerId: "new-worker",
      leaseToken: newToken,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 1
    });

    const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      insertedJob.job_id
    ]);

    const queue = new PostgresJobQueue(pool);
    const result = await queue.complete(insertedJob.job_id as JobId, oldToken, {
      promptIdComfy: "prompt-stale"
    });

    expect(result.outcome).toBe("superseded");
    expect((result as { job?: unknown }).job).toBeUndefined();

    const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      insertedJob.job_id
    ]);
    expect(postSnapshot.rows[0]).toEqual(preSnapshot.rows[0]);

    const manifestCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(Number(manifestCount.rows[0]?.count)).toBe(0);
  });

  it("completion requires rendering and current ownership", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const staleToken = "01950c46-9e90-7d3d-82d2-8f1d3c000099" as LeaseToken;
    const queue = new PostgresJobQueue(pool);

    const testCases = [
      { status: "queued" as const, tokenToUse: token, desc: "queued status" },
      { status: "leased" as const, tokenToUse: token, desc: "leased status" },
      { status: "failed" as const, tokenToUse: token, desc: "failed status" },
      { status: "cancelled" as const, tokenToUse: token, desc: "cancelled status" },
      {
        status: "completed" as const,
        tokenToUse: staleToken,
        desc: "completed status with other token"
      },
      {
        status: "rendering" as const,
        tokenToUse: staleToken,
        desc: "rendering status with other token"
      }
    ];

    for (const tc of testCases) {
      for (const jobKind of ["candidate" as const, "production" as const]) {
        const job = await insertRenderJobRecord(client, {
          sceneId,
          jobKind,
          status: tc.status,
          workerId: tc.status === "queued" ? null : "worker-1",
          leaseToken: tc.status === "queued" ? null : token,
          leaseExpiresAt: tc.status === "queued" ? null : new Date(Date.now() + 60_000),
          retryCount: 0
        });

        const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
          job.job_id
        ]);

        const res = await queue.complete(
          job.job_id as JobId,
          tc.tokenToUse,
          jobKind === "production" ? { promptIdComfy: "prompt-test" } : undefined
        );
        expect(res.outcome, `Expected superseded for ${jobKind} ${tc.desc}`).toBe("superseded");
        expect((res as { job?: unknown }).job).toBeUndefined();

        const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
          job.job_id
        ]);
        expect(postSnapshot.rows[0], `Row mutated for ${jobKind} ${tc.desc}`).toEqual(
          preSnapshot.rows[0]
        );

        const manifestCount = await client.query<{ count: string }>(
          "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
          [job.job_id]
        );
        expect(Number(manifestCount.rows[0]?.count)).toBe(0);
      }
    }

    // Missing job ID
    const missingJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000000" as JobId;
    const missingRes = await queue.complete(missingJobId, token, {
      promptIdComfy: "prompt-missing"
    });
    expect(missingRes.outcome).toBe("not_found");
    expect((missingRes as { job?: unknown }).job).toBeUndefined();
  });

  it("rejects production completion without a prompt manifest and rolls back the job transition", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const queue = new PostgresJobQueue(pool);

    const invalidPayloads = [
      undefined,
      {},
      { promptIdComfy: "" },
      { promptIdComfy: "   " },
      { promptIdComfy: 123 as unknown as string },
      { promptIdComfy: null as unknown as string },
      null as unknown as Readonly<Record<string, unknown>>
    ];

    for (const invalidPayload of invalidPayloads) {
      await expect(
        queue.complete(
          insertedJob.job_id as JobId,
          token,
          invalidPayload as Readonly<Record<string, unknown>>
        )
      ).rejects.toThrow(InvalidJobCompletionPayloadError);

      const jobRow = await client.query<{ status: string }>(
        "SELECT status FROM render_jobs WHERE job_id = $1",
        [insertedJob.job_id]
      );
      expect(jobRow.rows[0]?.status).toBe("rendering");

      const manifestCount = await client.query<{ count: string }>(
        "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
        [insertedJob.job_id]
      );
      expect(Number(manifestCount.rows[0]?.count)).toBe(0);
    }
  });

  it("rejects candidate completion with a manifest and rolls back the job transition", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "candidate",
      status: "rendering",
      workerId: "worker-cand",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const queue = new PostgresJobQueue(pool);

    const suppliedPayloads = [{ promptIdComfy: "prompt-cand-123" }, {}, { otherKey: "value" }];

    for (const payload of suppliedPayloads) {
      await expect(queue.complete(insertedJob.job_id as JobId, token, payload)).rejects.toThrow(
        InvalidJobCompletionPayloadError
      );

      const jobRow = await client.query<{ status: string }>(
        "SELECT status FROM render_jobs WHERE job_id = $1",
        [insertedJob.job_id]
      );
      expect(jobRow.rows[0]?.status).toBe("rendering");

      const manifestCount = await client.query<{ count: string }>(
        "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
        [insertedJob.job_id]
      );
      expect(Number(manifestCount.rows[0]?.count)).toBe(0);
    }
  });

  it("unexpected unique violations and inconsistent duplicate state are not masked", async () => {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;

    // Sub-case 1: Completed production job but 0 manifests (inconsistent duplicate state)
    const incompleteCompletedJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed",
      workerId: "worker-prod",
      leaseToken: token,
      retryCount: 0
    });

    const queue = new PostgresJobQueue(pool);

    await expect(
      queue.complete(incompleteCompletedJob.job_id as JobId, token, {
        promptIdComfy: "prompt-1"
      })
    ).rejects.toThrow(/inconsistent/i);

    // Sub-case 2: Unrelated unique violation error rethrows and does not classify as already_applied
    const faultyJob = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "rendering",
      workerId: "worker-prod",
      leaseToken: token,
      retryCount: 0
    });

    const fakeUniqueError = Object.assign(new Error("unrelated unique violation"), {
      code: "23505",
      constraint: "unrelated_constraint_key"
    });

    const faultyPool = {
      connect: async () => {
        const actualClient = await pool.connect();
        return {
          query: (sql: string | { text: string }, values?: unknown[]) => {
            const sqlText = typeof sql === "string" ? sql : sql.text;
            if (sqlText.includes("INSERT INTO generation_manifests")) {
              throw fakeUniqueError;
            }
            return actualClient.query(sql as string, values);
          },
          release: () => actualClient.release()
        } as unknown as PoolClient;
      },
      query: pool.query.bind(pool)
    } as unknown as Pool;

    const queueWithFaultyPool = new PostgresJobQueue(faultyPool);
    await expect(
      queueWithFaultyPool.complete(faultyJob.job_id as JobId, token, {
        promptIdComfy: "prompt-fail"
      })
    ).rejects.toThrow("unrelated unique violation");

    // Verify row was rolled back and still rendering
    const jobRow = await client.query<{ status: string }>(
      "SELECT status FROM render_jobs WHERE job_id = $1",
      [faultyJob.job_id]
    );
    expect(jobRow.rows[0]?.status).toBe("rendering");
  });

  it("fail requeues current active work while retries remain", async () => {
    const { sceneId } = await createTestScene();
    const queue = new PostgresJobQueue(pool);

    // 1. leased source state
    const leasedToken = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const leasedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "leased",
      workerId: "worker-leased-fail",
      leaseToken: leasedToken,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const leasedResult = await queue.fail(
      leasedJob.job_id as JobId,
      leasedToken,
      "failed during leased"
    );

    expect(leasedResult.outcome).toBe("applied");
    if (leasedResult.outcome === "applied") {
      expect(leasedResult.job.jobId).toBe(leasedJob.job_id);
      expect(leasedResult.job.status).toBe("queued");
      expect(leasedResult.job.retryCount).toBe(1);
      expect(leasedResult.job.maxRetries).toBe(3);
      expect(leasedResult.job.workerId).toBeNull();
      expect(leasedResult.job.leaseExpiresAt).toBeNull();
      expect(leasedResult.job.leaseToken).toBe(leasedToken);
      expect(leasedResult.job.errorTrace).toBe("failed during leased");
    }

    const dbRowLeased = await client.query<{
      status: string;
      worker_id: string | null;
      lease_token: string | null;
      lease_expires_at: Date | null;
      retry_count: number;
      error_trace: string | null;
    }>(
      "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
      [leasedJob.job_id]
    );
    expect(dbRowLeased.rows[0]?.status).toBe("queued");
    expect(dbRowLeased.rows[0]?.worker_id).toBeNull();
    expect(dbRowLeased.rows[0]?.lease_expires_at).toBeNull();
    expect(dbRowLeased.rows[0]?.lease_token).toBe(leasedToken);
    expect(dbRowLeased.rows[0]?.retry_count).toBe(1);
    expect(dbRowLeased.rows[0]?.error_trace).toBe("failed during leased");

    // Old token cannot mutate the requeued job
    const startAttempt = await queue.start(leasedJob.job_id as JobId, leasedToken);
    expect(startAttempt.outcome).toBe("superseded");
    const hbAttempt = await queue.heartbeat(leasedJob.job_id as JobId, leasedToken, 30_000);
    expect(hbAttempt.outcome).toBe("superseded");
    const completeAttempt = await queue.complete(leasedJob.job_id as JobId, leasedToken);
    expect(completeAttempt.outcome).toBe("superseded");
    const failAgainAttempt = await queue.fail(leasedJob.job_id as JobId, leasedToken, "fail again");
    expect(failAgainAttempt.outcome).toBe("superseded");

    // 2. rendering source state
    const renderingToken = "01950c46-9e90-7d3d-82d2-8f1d3c000002" as LeaseToken;
    const renderingJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "rendering",
      workerId: "worker-rendering-fail",
      leaseToken: renderingToken,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 1,
      maxRetries: 3
    });

    const renderingResult = await queue.fail(
      renderingJob.job_id as JobId,
      renderingToken,
      "failed during rendering"
    );

    expect(renderingResult.outcome).toBe("applied");
    if (renderingResult.outcome === "applied") {
      expect(renderingResult.job.jobId).toBe(renderingJob.job_id);
      expect(renderingResult.job.status).toBe("queued");
      expect(renderingResult.job.retryCount).toBe(2);
      expect(renderingResult.job.maxRetries).toBe(3);
      expect(renderingResult.job.workerId).toBeNull();
      expect(renderingResult.job.leaseExpiresAt).toBeNull();
      expect(renderingResult.job.leaseToken).toBe(renderingToken);
      expect(renderingResult.job.errorTrace).toBe("failed during rendering");
    }

    const dbRowRendering = await client.query<{
      status: string;
      worker_id: string | null;
      lease_token: string | null;
      lease_expires_at: Date | null;
      retry_count: number;
      error_trace: string | null;
    }>(
      "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
      [renderingJob.job_id]
    );
    expect(dbRowRendering.rows[0]?.status).toBe("queued");
    expect(dbRowRendering.rows[0]?.worker_id).toBeNull();
    expect(dbRowRendering.rows[0]?.lease_expires_at).toBeNull();
    expect(dbRowRendering.rows[0]?.lease_token).toBe(renderingToken);
    expect(dbRowRendering.rows[0]?.retry_count).toBe(2);
    expect(dbRowRendering.rows[0]?.error_trace).toBe("failed during rendering");
  });

  it("fail terminalizes current active work at retry exhaustion", async () => {
    const { sceneId } = await createTestScene();
    const queue = new PostgresJobQueue(pool);

    // 1. leased source state with retry_count >= max_retries
    const leasedToken = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const leasedExpiry = new Date(Date.now() + 60_000);
    const leasedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "leased",
      workerId: "worker-leased-exhausted",
      leaseToken: leasedToken,
      leaseExpiresAt: leasedExpiry,
      retryCount: 3,
      maxRetries: 3
    });

    const leasedResult = await queue.fail(
      leasedJob.job_id as JobId,
      leasedToken,
      "exhaustion in leased"
    );

    expect(leasedResult.outcome).toBe("applied");
    if (leasedResult.outcome === "applied") {
      expect(leasedResult.job.jobId).toBe(leasedJob.job_id);
      expect(leasedResult.job.status).toBe("failed");
      expect(leasedResult.job.retryCount).toBe(3);
      expect(leasedResult.job.maxRetries).toBe(3);
      expect(leasedResult.job.workerId).toBe("worker-leased-exhausted");
      expect(leasedResult.job.leaseToken).toBe(leasedToken);
      expect(leasedResult.job.leaseExpiresAt).toBeInstanceOf(Date);
      expect(leasedResult.job.errorTrace).toBe("exhaustion in leased");
    }

    const dbRowLeased = await client.query<{
      status: string;
      worker_id: string | null;
      lease_token: string | null;
      lease_expires_at: Date | null;
      retry_count: number;
      error_trace: string | null;
    }>(
      "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
      [leasedJob.job_id]
    );
    expect(dbRowLeased.rows[0]?.status).toBe("failed");
    expect(dbRowLeased.rows[0]?.worker_id).toBe("worker-leased-exhausted");
    expect(dbRowLeased.rows[0]?.lease_token).toBe(leasedToken);
    expect(dbRowLeased.rows[0]?.retry_count).toBe(3);
    expect(dbRowLeased.rows[0]?.error_trace).toBe("exhaustion in leased");
    expect(dbRowLeased.rows[0]?.lease_expires_at).toBeDefined();

    // 2. rendering source state with retry_count >= max_retries
    const renderingToken = "01950c46-9e90-7d3d-82d2-8f1d3c000002" as LeaseToken;
    const renderingExpiry = new Date(Date.now() + 60_000);
    const renderingJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "rendering",
      workerId: "worker-rendering-exhausted",
      leaseToken: renderingToken,
      leaseExpiresAt: renderingExpiry,
      retryCount: 3,
      maxRetries: 3
    });

    const renderingResult = await queue.fail(
      renderingJob.job_id as JobId,
      renderingToken,
      "exhaustion in rendering"
    );

    expect(renderingResult.outcome).toBe("applied");
    if (renderingResult.outcome === "applied") {
      expect(renderingResult.job.jobId).toBe(renderingJob.job_id);
      expect(renderingResult.job.status).toBe("failed");
      expect(renderingResult.job.retryCount).toBe(3);
      expect(renderingResult.job.maxRetries).toBe(3);
      expect(renderingResult.job.workerId).toBe("worker-rendering-exhausted");
      expect(renderingResult.job.leaseToken).toBe(renderingToken);
      expect(renderingResult.job.leaseExpiresAt).toBeInstanceOf(Date);
      expect(renderingResult.job.errorTrace).toBe("exhaustion in rendering");
    }

    const dbRowRendering = await client.query<{
      status: string;
      worker_id: string | null;
      lease_token: string | null;
      lease_expires_at: Date | null;
      retry_count: number;
      error_trace: string | null;
    }>(
      "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
      [renderingJob.job_id]
    );
    expect(dbRowRendering.rows[0]?.status).toBe("failed");
    expect(dbRowRendering.rows[0]?.worker_id).toBe("worker-rendering-exhausted");
    expect(dbRowRendering.rows[0]?.lease_token).toBe(renderingToken);
    expect(dbRowRendering.rows[0]?.retry_count).toBe(3);
    expect(dbRowRendering.rows[0]?.error_trace).toBe("exhaustion in rendering");
    expect(dbRowRendering.rows[0]?.lease_expires_at).toBeDefined();
  });

  it("fail idempotency on requeued row returns superseded", async () => {
    const { sceneId } = await createTestScene();
    const queue = new PostgresJobQueue(pool);
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;

    const activeJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "leased",
      workerId: "worker-1",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const firstFail = await queue.fail(activeJob.job_id as JobId, token, "first failure");
    expect(firstFail.outcome).toBe("applied");

    const secondFail = await queue.fail(activeJob.job_id as JobId, token, "second failure");
    expect(secondFail.outcome).toBe("superseded");
    expect((secondFail as { job?: unknown }).job).toBeUndefined();

    const dbRowRequeued = await client.query<{
      status: string;
      retry_count: number;
      error_trace: string;
    }>("SELECT status, retry_count, error_trace FROM render_jobs WHERE job_id = $1", [
      activeJob.job_id
    ]);
    expect(dbRowRequeued.rows[0]?.status).toBe("queued");
    expect(dbRowRequeued.rows[0]?.retry_count).toBe(1);
    expect(dbRowRequeued.rows[0]?.error_trace).toBe("first failure");
  });

  it("fail idempotency on terminal failed row returns already_applied", async () => {
    const { sceneId } = await createTestScene();
    const queue = new PostgresJobQueue(pool);
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;

    const exhaustedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "rendering",
      workerId: "worker-1",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 3,
      maxRetries: 3
    });

    const firstExhaustedFail = await queue.fail(
      exhaustedJob.job_id as JobId,
      token,
      "first exhaustion failure"
    );
    expect(firstExhaustedFail.outcome).toBe("applied");

    const secondExhaustedFail = await queue.fail(
      exhaustedJob.job_id as JobId,
      token,
      "second exhaustion failure"
    );
    expect(secondExhaustedFail.outcome).toBe("already_applied");
    if (secondExhaustedFail.outcome === "already_applied") {
      expect(secondExhaustedFail.job.jobId).toBe(exhaustedJob.job_id);
      expect(secondExhaustedFail.job.status).toBe("failed");
      expect(secondExhaustedFail.job.errorTrace).toBe("first exhaustion failure");
    }

    const dbRowExhausted = await client.query<{
      status: string;
      retry_count: number;
      error_trace: string;
    }>("SELECT status, retry_count, error_trace FROM render_jobs WHERE job_id = $1", [
      exhaustedJob.job_id
    ]);
    expect(dbRowExhausted.rows[0]?.status).toBe("failed");
    expect(dbRowExhausted.rows[0]?.retry_count).toBe(3);
    expect(dbRowExhausted.rows[0]?.error_trace).toBe("first exhaustion failure");
  });

  it("fail fences stale and illegal states", async () => {
    const { sceneId } = await createTestScene();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const staleToken = "01950c46-9e90-7d3d-82d2-8f1d3c000099" as LeaseToken;
    const queue = new PostgresJobQueue(pool);

    const testCases = [
      { status: "queued" as const, tokenToUse: token, desc: "queued status with matching token" },
      {
        status: "completed" as const,
        tokenToUse: token,
        desc: "completed status with matching token"
      },
      {
        status: "cancelled" as const,
        tokenToUse: token,
        desc: "cancelled status with matching token"
      },
      { status: "leased" as const, tokenToUse: staleToken, desc: "leased status with stale token" },
      {
        status: "rendering" as const,
        tokenToUse: staleToken,
        desc: "rendering status with stale token"
      }
    ];

    for (const tc of testCases) {
      const job = await insertRenderJobRecord(client, {
        sceneId,
        status: tc.status,
        workerId: tc.status === "queued" ? null : "worker-1",
        leaseToken: tc.status === "queued" ? null : token,
        leaseExpiresAt: tc.status === "queued" ? null : new Date(Date.now() + 60_000),
        retryCount: 0,
        errorTrace: null
      });

      const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);

      const res = await queue.fail(job.job_id as JobId, tc.tokenToUse, "attempted illegal failure");
      expect(res.outcome, `Expected superseded for ${tc.desc}`).toBe("superseded");
      expect((res as { job?: unknown }).job).toBeUndefined();

      const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);
      expect(postSnapshot.rows[0], `Row mutated for ${tc.desc}`).toEqual(preSnapshot.rows[0]);
    }
  });

  it("fail reports missing jobs", async () => {
    const missingJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000000" as JobId;
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const queue = new PostgresJobQueue(pool);

    const result = await queue.fail(missingJobId, token, "missing job failure");
    expect(result.outcome).toBe("not_found");
    expect((result as { job?: unknown }).job).toBeUndefined();
  });

  it("retry boundary preserves the final attempt", async () => {
    const { sceneId } = await createTestScene();
    const queue = new PostgresJobQueue(pool);

    // Initial queued job with retry_count = 2, max_retries = 3
    const insertedJob = await insertRenderJobRecord(client, {
      sceneId,
      status: "queued",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryCount: 2,
      maxRetries: 3
    });

    // 1. Worker 1 claims job (from queued -> does not increment retry_count)
    const claimed1 = await queue.claim({ workerId: "worker-attempt-3", leaseDurationMs: 30_000 });
    expect(claimed1).toBeDefined();
    expect(claimed1?.jobId).toBe(insertedJob.job_id);
    expect(claimed1?.status).toBe("leased");
    expect(claimed1?.retryCount).toBe(2);
    expect(claimed1?.workerId).toBe("worker-attempt-3");
    const token1 = claimed1!.leaseToken!;
    expect(token1).toBeDefined();

    // 2. Worker 1 starts rendering
    const startRes1 = await queue.start(claimed1!.jobId, token1);
    expect(startRes1.outcome).toBe("applied");

    // 3. Worker 1 fails below max (retry 2 -> 3, with max_retries = 3)
    const failRes1 = await queue.fail(claimed1!.jobId, token1, "attempt 3 failed");
    expect(failRes1.outcome).toBe("applied");
    if (failRes1.outcome === "applied") {
      expect(failRes1.job.status).toBe("queued");
      expect(failRes1.job.retryCount).toBe(3);
      expect(failRes1.job.workerId).toBeNull();
      expect(failRes1.job.leaseExpiresAt).toBeNull();
      expect(failRes1.job.leaseToken).toBe(token1);
      expect(failRes1.job.errorTrace).toBe("attempt 3 failed");
    }

    // 4. Worker 2 claims the requeued job (final attempt 4, retry_count is 3, max_retries is 3)
    const claimed2 = await queue.claim({ workerId: "worker-attempt-4", leaseDurationMs: 30_000 });
    expect(claimed2).toBeDefined();
    expect(claimed2?.jobId).toBe(insertedJob.job_id);
    expect(claimed2?.status).toBe("leased");
    expect(claimed2?.retryCount).toBe(3); // Queued claim does NOT increment
    expect(claimed2?.workerId).toBe("worker-attempt-4");
    const token2 = claimed2!.leaseToken!;
    expect(token2).toBeDefined();
    expect(token2).not.toBe(token1); // Fresh token generated

    // 5. Worker 2 starts rendering
    const startRes2 = await queue.start(claimed2!.jobId, token2);
    expect(startRes2.outcome).toBe("applied");

    // 6. Worker 2 fails at max (retry 3 >= 3) -> terminalizes
    const failRes2 = await queue.fail(claimed2!.jobId, token2, "final attempt failed");
    expect(failRes2.outcome).toBe("applied");
    if (failRes2.outcome === "applied") {
      expect(failRes2.job.status).toBe("failed");
      expect(failRes2.job.retryCount).toBe(3);
      expect(failRes2.job.workerId).toBe("worker-attempt-4");
      expect(failRes2.job.leaseToken).toBe(token2);
      expect(failRes2.job.leaseExpiresAt).toBeInstanceOf(Date);
      expect(failRes2.job.errorTrace).toBe("final attempt failed");
    }

    // DB state verification
    const finalDbRow = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      lease_expires_at: Date;
      retry_count: number;
      max_retries: number;
      error_trace: string;
    }>(
      "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, max_retries, error_trace FROM render_jobs WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(finalDbRow.rows[0]?.status).toBe("failed");
    expect(finalDbRow.rows[0]?.worker_id).toBe("worker-attempt-4");
    expect(finalDbRow.rows[0]?.lease_token).toBe(token2);
    expect(finalDbRow.rows[0]?.retry_count).toBe(3);
    expect(finalDbRow.rows[0]?.max_retries).toBe(3);
    expect(finalDbRow.rows[0]?.error_trace).toBe("final attempt failed");

    // 7. Subsequent claims return undefined
    const claimed3 = await queue.claim({ workerId: "worker-attempt-5", leaseDurationMs: 30_000 });
    expect(claimed3).toBeUndefined();
  });

  describe("defer", () => {
    it("defer requeues leased and rendering jobs without consuming retry budget", async () => {
      const { sceneId } = await createTestScene();
      const queue = new PostgresJobQueue(pool);

      // 1. leased source state
      const leasedToken = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
      const leasedJob = await insertRenderJobRecord(client, {
        sceneId,
        status: "leased",
        workerId: "worker-leased-defer",
        leaseToken: leasedToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        retryCount: 1,
        maxRetries: 3
      });

      const leasedResult = await queue.defer(
        leasedJob.job_id as JobId,
        leasedToken,
        "preempted during leased"
      );

      expect(leasedResult.outcome).toBe("deferred");
      if (leasedResult.outcome === "deferred") {
        expect(leasedResult.job.jobId).toBe(leasedJob.job_id);
        expect(leasedResult.job.status).toBe("queued");
        expect(leasedResult.job.retryCount).toBe(1);
        expect(leasedResult.job.maxRetries).toBe(3);
        expect(leasedResult.job.workerId).toBeNull();
        expect(leasedResult.job.leaseExpiresAt).toBeNull();
        expect(leasedResult.job.leaseToken).toBe(leasedToken);
        expect(leasedResult.job.errorTrace).toBe("preempted during leased");
      }

      const dbRowLeased = await client.query<{
        status: string;
        worker_id: string | null;
        lease_token: string | null;
        lease_expires_at: Date | null;
        retry_count: number;
        error_trace: string | null;
      }>(
        "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
        [leasedJob.job_id]
      );
      expect(dbRowLeased.rows[0]?.status).toBe("queued");
      expect(dbRowLeased.rows[0]?.worker_id).toBeNull();
      expect(dbRowLeased.rows[0]?.lease_expires_at).toBeNull();
      expect(dbRowLeased.rows[0]?.lease_token).toBe(leasedToken);
      expect(dbRowLeased.rows[0]?.retry_count).toBe(1);
      expect(dbRowLeased.rows[0]?.error_trace).toBe("preempted during leased");

      // 2. rendering source state
      const renderingToken = "01950c46-9e90-7d3d-82d2-8f1d3c000002" as LeaseToken;
      const renderingJob = await insertRenderJobRecord(client, {
        sceneId,
        status: "rendering",
        workerId: "worker-rendering-defer",
        leaseToken: renderingToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        retryCount: 2,
        maxRetries: 3
      });

      const renderingResult = await queue.defer(
        renderingJob.job_id as JobId,
        renderingToken,
        "preempted during rendering"
      );

      expect(renderingResult.outcome).toBe("deferred");
      if (renderingResult.outcome === "deferred") {
        expect(renderingResult.job.jobId).toBe(renderingJob.job_id);
        expect(renderingResult.job.status).toBe("queued");
        expect(renderingResult.job.retryCount).toBe(2);
        expect(renderingResult.job.maxRetries).toBe(3);
        expect(renderingResult.job.workerId).toBeNull();
        expect(renderingResult.job.leaseExpiresAt).toBeNull();
        expect(renderingResult.job.leaseToken).toBe(renderingToken);
        expect(renderingResult.job.errorTrace).toBe("preempted during rendering");
      }

      const dbRowRendering = await client.query<{
        status: string;
        worker_id: string | null;
        lease_token: string | null;
        lease_expires_at: Date | null;
        retry_count: number;
        error_trace: string | null;
      }>(
        "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
        [renderingJob.job_id]
      );
      expect(dbRowRendering.rows[0]?.status).toBe("queued");
      expect(dbRowRendering.rows[0]?.worker_id).toBeNull();
      expect(dbRowRendering.rows[0]?.lease_expires_at).toBeNull();
      expect(dbRowRendering.rows[0]?.lease_token).toBe(renderingToken);
      expect(dbRowRendering.rows[0]?.retry_count).toBe(2);
      expect(dbRowRendering.rows[0]?.error_trace).toBe("preempted during rendering");
    });

    it("defer replay with the retained token is already applied", async () => {
      const { sceneId } = await createTestScene();
      const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
      const queue = new PostgresJobQueue(pool);

      const job = await insertRenderJobRecord(client, {
        sceneId,
        status: "leased",
        workerId: "worker-replay-defer",
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        retryCount: 0,
        maxRetries: 3
      });

      // First defer call
      const firstRes = await queue.defer(job.job_id as JobId, token, "initial defer");
      expect(firstRes.outcome).toBe("deferred");

      const preReplaySnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);

      // Replay defer call with same token
      const replayRes = await queue.defer(job.job_id as JobId, token, "replay defer");
      expect(replayRes.outcome).toBe("already_applied");
      if (replayRes.outcome === "already_applied") {
        expect(replayRes.job.jobId).toBe(job.job_id);
        expect(replayRes.job.status).toBe("queued");
        expect(replayRes.job.leaseToken).toBe(token);
        expect(replayRes.job.workerId).toBeNull();
        expect(replayRes.job.leaseExpiresAt).toBeNull();
      }

      const postReplaySnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);
      expect(postReplaySnapshot.rows[0]).toEqual(preReplaySnapshot.rows[0]);
    });

    it("defer replay after reclaim is superseded", async () => {
      const { sceneId } = await createTestScene();
      const token1 = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
      const queue = new PostgresJobQueue(pool);

      const job = await insertRenderJobRecord(client, {
        sceneId,
        status: "leased",
        workerId: "worker-1",
        leaseToken: token1,
        leaseExpiresAt: new Date(Date.now() + 60_000),
        retryCount: 0,
        maxRetries: 3
      });

      // Defer moves it to queued retaining token1
      const deferRes = await queue.defer(job.job_id as JobId, token1, "first worker defer");
      expect(deferRes.outcome).toBe("deferred");

      // Another worker claims the requeued job -> gets fresh lease token2
      const claimRes = await queue.claim({ workerId: "worker-2", leaseDurationMs: 30_000 });
      expect(claimRes).toBeDefined();
      expect(claimRes?.jobId).toBe(job.job_id);
      expect(claimRes?.status).toBe("leased");
      expect(claimRes?.workerId).toBe("worker-2");
      const token2 = claimRes!.leaseToken!;
      expect(token2).not.toBe(token1);

      const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);

      // Worker 1 tries stale defer with token1
      const staleDeferRes = await queue.defer(
        job.job_id as JobId,
        token1,
        "stale defer after reclaim"
      );
      expect(staleDeferRes.outcome).toBe("superseded");
      expect((staleDeferRes as { job?: unknown }).job).toBeUndefined();

      const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
        job.job_id
      ]);
      expect(postSnapshot.rows[0]).toEqual(preSnapshot.rows[0]);
      expect(postSnapshot.rows[0]?.status).toBe("leased");
      expect(postSnapshot.rows[0]?.worker_id).toBe("worker-2");
      expect(postSnapshot.rows[0]?.lease_token).toBe(token2);
    });

    it("defer fences stale tokens and illegal states", async () => {
      const { sceneId } = await createTestScene();
      const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
      const staleToken = "01950c46-9e90-7d3d-82d2-8f1d3c000099" as LeaseToken;
      const queue = new PostgresJobQueue(pool);

      const testCases = [
        {
          status: "queued" as const,
          tokenToUse: staleToken,
          desc: "queued status with mismatched token"
        },
        {
          status: "completed" as const,
          tokenToUse: token,
          desc: "completed status with matching token"
        },
        {
          status: "cancelled" as const,
          tokenToUse: token,
          desc: "cancelled status with matching token"
        },
        {
          status: "failed" as const,
          tokenToUse: token,
          desc: "failed status with matching token"
        },
        {
          status: "leased" as const,
          tokenToUse: staleToken,
          desc: "leased status with stale token"
        },
        {
          status: "rendering" as const,
          tokenToUse: staleToken,
          desc: "rendering status with stale token"
        }
      ];

      for (const tc of testCases) {
        const job = await insertRenderJobRecord(client, {
          sceneId,
          status: tc.status,
          workerId: tc.status === "queued" ? null : "worker-1",
          leaseToken: tc.status === "queued" ? null : token,
          leaseExpiresAt: tc.status === "queued" ? null : new Date(Date.now() + 60_000),
          retryCount: 0,
          errorTrace: null
        });

        const preSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
          job.job_id
        ]);

        const res = await queue.defer(
          job.job_id as JobId,
          tc.tokenToUse,
          "attempted illegal defer"
        );
        expect(res.outcome, `Expected superseded for ${tc.desc}`).toBe("superseded");
        expect((res as { job?: unknown }).job).toBeUndefined();

        const postSnapshot = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
          job.job_id
        ]);
        expect(postSnapshot.rows[0], `Row mutated for ${tc.desc}`).toEqual(preSnapshot.rows[0]);
      }
    });

    it("defer reports missing jobs", async () => {
      const missingJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000000" as JobId;
      const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
      const queue = new PostgresJobQueue(pool);

      const result = await queue.defer(missingJobId, token, "missing job defer");
      expect(result.outcome).toBe("not_found");
      expect((result as { job?: unknown }).job).toBeUndefined();
    });

    it("defer rejects invalid reason before querying", async () => {
      const missingJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000000" as JobId;
      const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
      const queue = new PostgresJobQueue(pool);

      await expect(queue.defer(missingJobId, token, "")).rejects.toThrow(
        "reason must be a non-empty string"
      );
      await expect(queue.defer(missingJobId, token, "   ")).rejects.toThrow(
        "reason must be a non-empty string"
      );
    });
  });

  describe("enqueue", () => {
    it("enqueues a candidate job with database default max_retries = 3 and initial status queued", async () => {
      const { sceneId } = await createTestScene();
      const queue = new PostgresJobQueue(pool);

      const job = await queue.enqueue({
        sceneId: sceneId as SceneId,
        jobKind: "candidate",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: {
          prompt: "A cinematic shot of a mountain sunrise",
          seed: 43,
          variantOrdinal: 1
        }
      });

      expect(job.jobId).toBeDefined();
      expect(job.sceneId).toBe(sceneId);
      expect(job.jobKind).toBe("candidate");
      expect(job.status).toBe("queued");
      expect(job.workflowTemplate).toBe("flux-schnell-draft");
      expect(job.injectedPayload).toEqual({
        prompt: "A cinematic shot of a mountain sunrise",
        seed: 43,
        variantOrdinal: 1
      });
      expect(job.workerId).toBeNull();
      expect(job.leaseToken).toBeNull();
      expect(job.leaseExpiresAt).toBeNull();
      expect(job.retryCount).toBe(0);
      expect(job.maxRetries).toBe(3);
      expect(job.errorTrace).toBeNull();
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.updatedAt).toBeInstanceOf(Date);

      // Verify row in database
      const rowRes = await client.query<{
        job_id: string;
        scene_id: string;
        job_kind: string;
        status: string;
        workflow_template: string;
        injected_payload: Record<string, unknown>;
        retry_count: number;
        max_retries: number;
      }>("SELECT * FROM render_jobs WHERE job_id = $1", [job.jobId]);

      expect(rowRes.rows).toHaveLength(1);
      const row = rowRes.rows[0]!;
      expect(row.scene_id).toBe(sceneId);
      expect(row.job_kind).toBe("candidate");
      expect(row.status).toBe("queued");
      expect(row.workflow_template).toBe("flux-schnell-draft");
      expect(row.injected_payload).toEqual({
        prompt: "A cinematic shot of a mountain sunrise",
        seed: 43,
        variantOrdinal: 1
      });
      expect(row.max_retries).toBe(3);
      expect(row.retry_count).toBe(0);
    });

    it("respects explicit maxRetries override when supplied", async () => {
      const { sceneId } = await createTestScene();
      const queue = new PostgresJobQueue(pool);

      const job = await queue.enqueue({
        sceneId: sceneId as SceneId,
        jobKind: "candidate",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: {
          prompt: "Explicit retries prompt",
          seed: 44,
          variantOrdinal: 2
        },
        maxRetries: 5
      });

      expect(job.maxRetries).toBe(5);

      const rowRes = await client.query<{ max_retries: number }>(
        "SELECT max_retries FROM render_jobs WHERE job_id = $1",
        [job.jobId]
      );
      expect(rowRes.rows[0]?.max_retries).toBe(5);
    });

    it("enqueued candidate job is immediately claimable by claim()", async () => {
      const { sceneId } = await createTestScene();
      const queue = new PostgresJobQueue(pool);

      const enqueued = await queue.enqueue({
        sceneId: sceneId as SceneId,
        jobKind: "candidate",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: {
          prompt: "Claimable candidate",
          seed: 45,
          variantOrdinal: 3
        }
      });

      const claimed = await queue.claim({
        workerId: "test-worker-1",
        leaseDurationMs: 30_000,
        allowedJobKinds: ["candidate"]
      });

      expect(claimed).toBeDefined();
      expect(claimed?.jobId).toBe(enqueued.jobId);
      expect(claimed?.status).toBe("leased");
      expect(claimed?.workerId).toBe("test-worker-1");
      expect(claimed?.leaseToken).toBeDefined();
    });

    it("defensively validates enqueue input parameters", async () => {
      const { sceneId } = await createTestScene();
      const queue = new PostgresJobQueue(pool);

      // Non-object input
      await expect(queue.enqueue(null as unknown as EnqueueJobInput)).rejects.toThrow(
        "EnqueueJobInput must be a non-null object"
      );
      await expect(queue.enqueue([] as unknown as EnqueueJobInput)).rejects.toThrow(
        "EnqueueJobInput must be a non-null object"
      );

      // Blank sceneId
      await expect(
        queue.enqueue({
          sceneId: "" as SceneId,
          jobKind: "candidate",
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: { prompt: "test" }
        })
      ).rejects.toThrow("sceneId must be a non-empty string");

      // Invalid jobKind
      await expect(
        queue.enqueue({
          sceneId: sceneId as SceneId,
          jobKind: "invalid_kind" as unknown as JobKind,
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: { prompt: "test" }
        })
      ).rejects.toThrow("jobKind must be a valid JobKind");

      // Blank workflowTemplate
      await expect(
        queue.enqueue({
          sceneId: sceneId as SceneId,
          jobKind: "candidate",
          workflowTemplate: "   ",
          injectedPayload: { prompt: "test" }
        })
      ).rejects.toThrow("workflowTemplate must be a non-empty string");

      // Invalid injectedPayload (array or null)
      await expect(
        queue.enqueue({
          sceneId: sceneId as SceneId,
          jobKind: "candidate",
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: null as unknown as Record<string, unknown>
        })
      ).rejects.toThrow("injectedPayload must be a non-null object");

      await expect(
        queue.enqueue({
          sceneId: sceneId as SceneId,
          jobKind: "candidate",
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: ["not", "an", "object"] as unknown as Record<string, unknown>
        })
      ).rejects.toThrow("injectedPayload must be a non-null object");

      // Invalid maxRetries (negative or non-integer)
      await expect(
        queue.enqueue({
          sceneId: sceneId as SceneId,
          jobKind: "candidate",
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: { prompt: "test" },
          maxRetries: -1
        })
      ).rejects.toThrow("maxRetries must be a non-negative finite integer");

      await expect(
        queue.enqueue({
          sceneId: sceneId as SceneId,
          jobKind: "candidate",
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: { prompt: "test" },
          maxRetries: 1.5
        })
      ).rejects.toThrow("maxRetries must be a non-negative finite integer");
    });
  });
});
