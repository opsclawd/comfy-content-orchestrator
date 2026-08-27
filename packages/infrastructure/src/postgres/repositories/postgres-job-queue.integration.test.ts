import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { JobAdmissionGate } from "@cco/application";
import type { JobId, LeaseToken } from "@cco/domain";
import { PostgresJobQueue } from "@cco/infrastructure";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertRenderJobRecord
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
});
