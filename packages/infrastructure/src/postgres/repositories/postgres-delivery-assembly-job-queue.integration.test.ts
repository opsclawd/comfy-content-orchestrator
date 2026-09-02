import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { AssemblySpec } from "@cco/contracts";
import type { JobId, LeaseToken } from "@cco/domain";
import { PostgresDeliveryAssemblyJobQueue } from "./postgres-delivery-assembly-job-queue.js";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertDeliveryAssemblyJobRecord
} from "../test-support/records.js";

describe("PostgresDeliveryAssemblyJobQueue integration", () => {
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

  async function createTestCampaign(): Promise<{ campaignId: string }> {
    const clientRec = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRec.client_id });
    return { campaignId: campaign.campaign_id };
  }

  function createValidAssemblySpec(campaignId: string): AssemblySpec {
    return {
      campaignId,
      assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
      expectedTotalDurationMs: 5000,
      videoStems: [
        {
          order: 0,
          sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
          generationManifestId: "01950c46-9e90-7d3d-82d2-8f1d3c000002",
          expectedDurationMs: 5000,
          media: {
            bucket: "godzspeed-delivery",
            key: `campaigns/${campaignId}/scenes/scene-1/output.mp4`,
            sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            contentType: "video/mp4"
          }
        }
      ]
    } as unknown as AssemblySpec;
  }

  it("enqueues a delivery assembly job and reads it back", async () => {
    const { campaignId } = await createTestCampaign();
    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const spec = createValidAssemblySpec(campaignId);

    const job = await queue.enqueue({
      campaignId,
      assemblySpec: spec
    });

    expect(job).toBeDefined();
    expect(job.jobId).toBeDefined();
    expect(job.campaignId).toBe(campaignId);
    expect(job.status).toBe("queued");
    expect(job.workerId).toBeNull();
    expect(job.leaseToken).toBeNull();
    expect(job.leaseExpiresAt).toBeNull();
    expect(job.retryCount).toBe(0);
    expect(job.maxRetries).toBe(3);
    expect(job.errorTrace).toBeNull();
    expect(job.assemblySpec.campaignId).toBe(campaignId);

    const fetched = await queue.getJob(job.jobId);
    expect(fetched).toBeDefined();
    expect(fetched?.jobId).toBe(job.jobId);
    expect(fetched?.campaignId).toBe(campaignId);
  });

  it("concurrent claimers lease one queued job exactly once", async () => {
    const { campaignId } = await createTestCampaign();
    const spec = createValidAssemblySpec(campaignId);
    const insertedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      assemblySpec: spec as unknown as Record<string, unknown>,
      status: "queued"
    });

    const queue1 = new PostgresDeliveryAssemblyJobQueue(pool);
    const queue2 = new PostgresDeliveryAssemblyJobQueue(pool);
    const queue3 = new PostgresDeliveryAssemblyJobQueue(pool);

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
    expect(["worker-1", "worker-2", "worker-3"]).toContain(winner.workerId);

    const checkRes = await client.query<{
      status: string;
      worker_id: string;
      lease_token: string;
      retry_count: number;
    }>(
      "SELECT status, worker_id, lease_token, retry_count FROM delivery_assembly_jobs WHERE job_id = $1",
      [insertedJob.job_id]
    );

    expect(checkRes.rows[0]?.status).toBe("leased");
    expect(checkRes.rows[0]?.worker_id).toBe(winner.workerId);
    expect(checkRes.rows[0]?.lease_token).toBe(winner.leaseToken);
    expect(checkRes.rows[0]?.retry_count).toBe(0);
  });

  it("claim leases the oldest eligible job in FIFO order", async () => {
    const { campaignId } = await createTestCampaign();
    const spec = createValidAssemblySpec(campaignId);
    const olderJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      assemblySpec: spec as unknown as Record<string, unknown>,
      status: "queued",
      createdAt: new Date(Date.now() - 60_000)
    });
    const newerJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      assemblySpec: spec as unknown as Record<string, unknown>,
      status: "queued",
      createdAt: new Date(Date.now())
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const claimed = await queue.claim({ workerId: "worker-alpha", leaseDurationMs: 15_000 });

    expect(claimed).toBeDefined();
    expect(claimed?.jobId).toBe(olderJob.job_id);
    expect(claimed?.status).toBe("leased");
    expect(claimed?.workerId).toBe("worker-alpha");

    const newerDbRow = await client.query<{ status: string }>(
      "SELECT status FROM delivery_assembly_jobs WHERE job_id = $1",
      [newerJob.job_id]
    );
    expect(newerDbRow.rows[0]?.status).toBe("queued");
  });

  it("claim reassigns an expired lease with a fresh fencing token", async () => {
    const { campaignId } = await createTestCampaign();
    const initialToken = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
    const expiredJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "leased",
      workerId: "dead-worker",
      leaseToken: initialToken,
      leaseExpiresAt: new Date(Date.now() - 10_000),
      retryCount: 1,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const claimed = await queue.claim({ workerId: "new-worker", leaseDurationMs: 20_000 });

    expect(claimed).toBeDefined();
    expect(claimed?.jobId).toBe(expiredJob.job_id);
    expect(claimed?.workerId).toBe("new-worker");
    expect(claimed?.leaseToken).not.toBe(initialToken);
    expect(claimed?.retryCount).toBe(2);
    expect(claimed?.status).toBe("leased");
  });

  it("claim terminalizes an expired lease at retry exhaustion", async () => {
    const { campaignId } = await createTestCampaign();
    const exhaustedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "rendering",
      workerId: "stalled-worker",
      leaseExpiresAt: new Date(Date.now() - 5_000),
      retryCount: 3,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const claimed = await queue.claim({ workerId: "worker-next", leaseDurationMs: 10_000 });

    expect(claimed).toBeUndefined();

    const dbRow = await client.query<{
      status: string;
      error_trace: string;
      retry_count: number;
    }>("SELECT status, error_trace, retry_count FROM delivery_assembly_jobs WHERE job_id = $1", [
      exhaustedJob.job_id
    ]);
    expect(dbRow.rows[0]?.status).toBe("failed");
    expect(dbRow.rows[0]?.error_trace).toBe("lease expired; retries exhausted");
    expect(dbRow.rows[0]?.retry_count).toBe(3);
  });

  it("start transitions the current lease from leased to rendering", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const expiry = new Date(Date.now() + 60_000);
    const insertedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "leased",
      workerId: "worker-start",
      leaseToken: token,
      leaseExpiresAt: expiry,
      retryCount: 0,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const result = await queue.start(insertedJob.job_id as JobId, token);

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.jobId).toBe(insertedJob.job_id);
      expect(result.job.status).toBe("rendering");
      expect(result.job.workerId).toBe("worker-start");
      expect(result.job.leaseToken).toBe(token);
    }
  });

  it("start is idempotent only for the same token already rendering", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const renderingJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "rendering",
      workerId: "worker-1",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const repeatedStartResult = await queue.start(renderingJob.job_id as JobId, token);

    expect(repeatedStartResult.outcome).toBe("already_applied");
    if (repeatedStartResult.outcome === "already_applied") {
      expect(repeatedStartResult.job.jobId).toBe(renderingJob.job_id);
      expect(repeatedStartResult.job.status).toBe("rendering");
    }
  });

  it("heartbeat extends active lease", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const initialExpiry = new Date(Date.now() + 5_000);
    const job = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "rendering",
      workerId: "worker-hb",
      leaseToken: token,
      leaseExpiresAt: initialExpiry,
      retryCount: 1,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const result = await queue.heartbeat(job.job_id as JobId, token, 60_000);

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.jobId).toBe(job.job_id);
      expect(result.job.leaseExpiresAt!.getTime()).toBeGreaterThan(initialExpiry.getTime());
    }
  });

  it("completes a rendering job", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "rendering",
      workerId: "worker-complete",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const result = await queue.complete(insertedJob.job_id as JobId, token);

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.jobId).toBe(insertedJob.job_id);
      expect(result.job.status).toBe("completed");
    }

    const jobRow = await client.query<{ status: string }>(
      "SELECT status FROM delivery_assembly_jobs WHERE job_id = $1",
      [insertedJob.job_id]
    );
    expect(jobRow.rows[0]?.status).toBe("completed");
  });

  it("fails and re-queues when retries remain", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "rendering",
      workerId: "worker-fail",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 0,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const result = await queue.fail(insertedJob.job_id as JobId, token, "Encode error");

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.status).toBe("queued");
      expect(result.job.retryCount).toBe(1);
      expect(result.job.errorTrace).toBe("Encode error");
    }
  });

  it("fails terminally when retries exhausted", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "rendering",
      workerId: "worker-fail-terminal",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 3,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const result = await queue.fail(insertedJob.job_id as JobId, token, "Final error");

    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      expect(result.job.status).toBe("failed");
      expect(result.job.retryCount).toBe(3);
      expect(result.job.errorTrace).toBe("Final error");
    }
  });

  it("defers a leased or rendering job back to queued without incrementing retry count", async () => {
    const { campaignId } = await createTestCampaign();
    const token = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as LeaseToken;
    const insertedJob = await insertDeliveryAssemblyJobRecord(client, {
      campaignId,
      status: "leased",
      workerId: "worker-defer",
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      retryCount: 1,
      maxRetries: 3
    });

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const result = await queue.defer(insertedJob.job_id as JobId, token, "Backing off");

    expect(result.outcome).toBe("deferred");
    if (result.outcome === "deferred") {
      expect(result.job.status).toBe("queued");
      expect(result.job.workerId).toBeNull();
      expect(result.job.retryCount).toBe(1);
      expect(result.job.errorTrace).toBe("Backing off");
    }
  });

  it("rejects enqueue when campaignId does not match assemblySpec.campaignId", async () => {
    const { campaignId: campaignA } = await createTestCampaign();
    const { campaignId: campaignB } = await createTestCampaign();
    const specB = createValidAssemblySpec(campaignB);

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    await expect(
      queue.enqueue({
        campaignId: campaignA,
        assemblySpec: specB
      })
    ).rejects.toThrow(/does not match assemblySpec\.campaignId/i);
  });

  it("enforces database CHECK constraint rejecting mismatched campaign IDs on raw insert", async () => {
    const { campaignId: campaignA } = await createTestCampaign();
    const { campaignId: campaignB } = await createTestCampaign();
    const specB = createValidAssemblySpec(campaignB);

    await expect(
      client.query(
        `INSERT INTO delivery_assembly_jobs (campaign_id, assembly_spec) VALUES ($1, $2)`,
        [campaignA, JSON.stringify(specB)]
      )
    ).rejects.toThrow(/check_delivery_assembly_campaign_match/i);
  });

  it("maintains strict campaign isolation across multiple campaigns in queue and claims", async () => {
    const { campaignId: campaignA } = await createTestCampaign();
    const { campaignId: campaignB } = await createTestCampaign();
    const specA = createValidAssemblySpec(campaignA);
    const specB = createValidAssemblySpec(campaignB);

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    const jobA = await queue.enqueue({ campaignId: campaignA, assemblySpec: specA });
    const jobB = await queue.enqueue({ campaignId: campaignB, assemblySpec: specB });

    expect(jobA.campaignId).toBe(campaignA);
    expect(jobA.assemblySpec.campaignId).toBe(campaignA);
    expect(jobB.campaignId).toBe(campaignB);
    expect(jobB.assemblySpec.campaignId).toBe(campaignB);

    const claimed1 = await queue.claim({ workerId: "worker-1", leaseDurationMs: 30_000 });
    expect(claimed1).toBeDefined();
    expect(claimed1?.campaignId).toBe(campaignA);
    expect(claimed1?.assemblySpec.campaignId).toBe(campaignA);

    const claimed2 = await queue.claim({ workerId: "worker-2", leaseDurationMs: 30_000 });
    expect(claimed2).toBeDefined();
    expect(claimed2?.campaignId).toBe(campaignB);
    expect(claimed2?.assemblySpec.campaignId).toBe(campaignB);
  });

  it("throws typed corruption error on reading row with malformed or invalid assembly_spec", async () => {
    const { campaignId } = await createTestCampaign();

    // Raw insert with invalid JSON schema in assembly_spec (bypassing queue.enqueue)
    const invalidSpec = { campaignId, invalidField: true };
    const res = await client.query<{ job_id: string }>(
      `INSERT INTO delivery_assembly_jobs (campaign_id, assembly_spec) VALUES ($1, $2) RETURNING job_id`,
      [campaignId, JSON.stringify(invalidSpec)]
    );
    const jobId = res.rows[0]!.job_id;

    const queue = new PostgresDeliveryAssemblyJobQueue(pool);
    await expect(queue.getJob(jobId)).rejects.toThrow(/failed schema validation/i);
    await expect(queue.claim({ workerId: "worker-1", leaseDurationMs: 10_000 })).rejects.toThrow(
      /failed schema validation/i
    );
  });

  it("executes all queue operations successfully under the application role", async () => {
    // Re-run migrations with application role configured
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await client.query("DROP ROLE IF EXISTS orchestrator_app;");
    await client.query("CREATE ROLE orchestrator_app NOLOGIN;");

    await runMigrations(client, {
      migrationsDirectory,
      applicationRole: "orchestrator_app"
    });

    const { campaignId } = await createTestCampaign();
    const spec = createValidAssemblySpec(campaignId);

    const appClient = await pool.connect();
    try {
      await appClient.query("SET ROLE orchestrator_app;");
      await appClient.query("SET search_path TO public;");

      const pseudoPool = {
        query: (sql: string, params?: unknown[]) => appClient.query(sql, params),
        connect: async () => ({
          query: (sql: string, params?: unknown[]) => appClient.query(sql, params),
          release: () => {}
        })
      } as unknown as Pool;

      const appQueue = new PostgresDeliveryAssemblyJobQueue(pseudoPool);

      // 1. Enqueue
      const enqueued = await appQueue.enqueue({ campaignId, assemblySpec: spec });
      expect(enqueued.jobId).toBeDefined();

      // 2. Claim
      const claimed = await appQueue.claim({ workerId: "app-worker", leaseDurationMs: 30_000 });
      expect(claimed).toBeDefined();
      expect(claimed?.jobId).toBe(enqueued.jobId);

      const leaseToken = claimed!.leaseToken!;

      // 3. Start
      const startResult = await appQueue.start(enqueued.jobId, leaseToken);
      expect(startResult.outcome).toBe("applied");

      // 4. Heartbeat
      const hbResult = await appQueue.heartbeat(enqueued.jobId, leaseToken, 60_000);
      expect(hbResult.outcome).toBe("applied");

      // 5. Complete
      const completeResult = await appQueue.complete(enqueued.jobId, leaseToken);
      expect(completeResult.outcome).toBe("applied");

      // 6. GetJob
      const fetched = await appQueue.getJob(enqueued.jobId);
      expect(fetched).toBeDefined();
      expect(fetched?.status).toBe("completed");
    } finally {
      await appClient.query("RESET ROLE;");
      appClient.release();
    }
  });
});
