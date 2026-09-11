import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  ClientNotFoundError,
  CampaignIdempotencyConflictError,
  CreateCampaignShellUseCase
} from "@cco/application";
import type { CampaignId, CampaignRecord, CampaignShellRecord } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
import { PostgresUnitOfWork } from "../uow/postgres-unit-of-work.js";
import { PostgresCampaignRepository } from "./postgres-campaign-repository.js";

describe("PostgresCampaignRepository Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
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

  it("returns undefined for non-existent campaign", async () => {
    const repository = new PostgresCampaignRepository(client);
    const result = await repository.findById("018e69e0-8a6a-72cb-b1b7-ec79a1f73899");
    expect(result).toBeUndefined();
  });

  it("returns undefined for archived campaign", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Archived Campaign",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(campaign);
    await client.query(
      "UPDATE campaigns SET archived_at = CURRENT_TIMESTAMP WHERE campaign_id = $1",
      [campaignId]
    );

    const result = await repository.findById(campaignId);
    expect(result).toBeUndefined();
  });

  it("inserts and finds a campaign by id", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Carnival 2026 Commercial",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 4,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(campaign);

    const retrieved = await repository.findById(campaignId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(campaignId);
    expect(retrieved?.clientId).toBe(clientRecord.client_id);
    expect(retrieved?.title).toBe("Carnival 2026 Commercial");
    expect(retrieved?.targetPlatform).toBe("tiktok");
    expect(retrieved?.status).toBe("drafting");
    expect(retrieved?.totalScenes).toBe(4);
    expect(retrieved?.approvedScenes).toBe(0);
    expect(retrieved?.createdAt).toBeDefined();
    expect(retrieved?.updatedAt).toBeDefined();
  });

  it("updates existing campaign on conflict", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73802" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Initial Title",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(campaign);

    const updatedCampaign: CampaignRecord = {
      ...campaign,
      title: "Updated Title",
      status: "pending_director_review",
      totalScenes: 3,
      approvedScenes: 1
    };

    await repository.save(updatedCampaign);

    const retrieved = await repository.findById(campaignId);
    expect(retrieved?.title).toBe("Updated Title");
    expect(retrieved?.status).toBe("pending_director_review");
    expect(retrieved?.totalScenes).toBe(3);
    expect(retrieved?.approvedScenes).toBe(1);
  });

  it("throws ClientNotFoundError when clientId foreign key does not exist", async () => {
    const repository = new PostgresCampaignRepository(client);

    const campaign: CampaignRecord = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73803" as CampaignId,
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899", // non-existent client
      title: "Ghost Client Campaign",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await expect(repository.save(campaign)).rejects.toThrow(ClientNotFoundError);
  });

  it("findByIdForUpdate acquires exclusive row lock and blocks concurrent transactions", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73804" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Lock Test Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 2,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await repository.save(campaign);

    // Commit setup so independent connections can query it
    await client.query("COMMIT");
    const conn1 = await pool.connect();
    const conn2 = await pool.connect();

    try {
      await conn1.query("BEGIN");
      const repo1 = new PostgresCampaignRepository(conn1);
      const lockedCampaign = await repo1.findByIdForUpdate(campaignId);
      expect(lockedCampaign).toBeDefined();
      expect(lockedCampaign!.id).toBe(campaignId);

      // Verify conn2 attempting to acquire FOR UPDATE NOWAIT on this campaign row fails with 55P03
      await conn2.query("BEGIN");
      await expect(
        conn2.query("SELECT * FROM campaigns WHERE campaign_id = $1 FOR UPDATE NOWAIT", [
          campaignId
        ])
      ).rejects.toMatchObject({ code: "55P03" });

      // Rollback conn2's aborted transaction from the failed NOWAIT lock attempt
      await conn2.query("ROLLBACK");

      // After conn1 commits, conn2 can acquire the lock
      await conn1.query("COMMIT");
      await conn2.query("BEGIN");
      const repo2 = new PostgresCampaignRepository(conn2);
      const lockedByConn2 = await repo2.findByIdForUpdate(campaignId);
      expect(lockedByConn2).toBeDefined();
      expect(lockedByConn2!.id).toBe(campaignId);
      await conn2.query("COMMIT");
    } finally {
      conn1.release();
      conn2.release();
      await client.query("BEGIN");
    }
  });

  it("inserts via saveWithRequestHash and retrieves via findByIdempotencyKey with all metadata", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73805" as CampaignId;
    const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73806";
    const requestHash = "a".repeat(64);

    const campaign: CampaignShellRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Idempotent Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey,
      targetTotalDurationMs: 15000
    };

    await repository.saveWithRequestHash(campaign, requestHash);

    const retrieved = await repository.findByIdempotencyKey(idempotencyKey);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(campaignId);
    expect(retrieved?.clientId).toBe(clientRecord.client_id);
    expect(retrieved?.title).toBe("Idempotent Campaign");
    expect(retrieved?.targetPlatform).toBe("tiktok");
    expect(retrieved?.status).toBe("drafting");
    expect(retrieved?.totalScenes).toBe(3);
    expect(retrieved?.approvedScenes).toBe(0);
    expect(retrieved?.idempotencyKey).toBe(idempotencyKey);
    expect(retrieved?.targetTotalDurationMs).toBe(15000);
    expect(retrieved?.requestHashSha256).toBe(requestHash);
  });

  it("rejects duplicate idempotency key with CampaignIdempotencyConflictError", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73807";
    const requestHash = "b".repeat(64);

    const campaign1: CampaignShellRecord = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73808" as CampaignId,
      clientId: clientRecord.client_id,
      title: "Winner Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey,
      targetTotalDurationMs: 15000
    };
    await repository.saveWithRequestHash(campaign1, requestHash);

    const campaign2: CampaignShellRecord = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73809" as CampaignId,
      clientId: clientRecord.client_id,
      title: "Loser Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey,
      targetTotalDurationMs: 15000
    };

    await expect(repository.saveWithRequestHash(campaign2, requestHash)).rejects.toThrow(
      CampaignIdempotencyConflictError
    );
  });

  it("demonstrates PostgreSQL 25P02 transaction-abort behavior on unique constraint conflict (Finding 3 witness)", async () => {
    const clientRecord = await insertClientRecord(client);
    const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73810";
    const requestHash = "c".repeat(64);

    // Commit a winner on an independent connection
    const conn1 = await pool.connect();
    try {
      const repo1 = new PostgresCampaignRepository(conn1);
      const winner: CampaignShellRecord = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73811" as CampaignId,
        clientId: clientRecord.client_id,
        title: "Winner",
        targetPlatform: "tiktok",
        status: "drafting",
        totalScenes: 3,
        approvedScenes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        idempotencyKey,
        targetTotalDurationMs: 15000
      };
      await repo1.saveWithRequestHash(winner, requestHash);
    } finally {
      conn1.release();
    }

    // Now conn2 starts a transaction block and attempts to insert the same key
    const conn2 = await pool.connect();
    try {
      await conn2.query("BEGIN");
      const repo2 = new PostgresCampaignRepository(conn2);

      const loser: CampaignShellRecord = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73812" as CampaignId,
        clientId: clientRecord.client_id,
        title: "Loser",
        targetPlatform: "tiktok",
        status: "drafting",
        totalScenes: 3,
        approvedScenes: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        idempotencyKey,
        targetTotalDurationMs: 15000
      };

      // saveWithRequestHash catches 23505 and maps to CampaignIdempotencyConflictError
      await expect(repo2.saveWithRequestHash(loser, requestHash)).rejects.toThrow(
        CampaignIdempotencyConflictError
      );

      // CRITICAL: Any subsequent query on conn2's aborted transaction MUST fail with 25P02.
      // This proves that attempting findByIdempotencyKey on the same transaction context is a defect!
      await expect(repo2.findByIdempotencyKey(idempotencyKey)).rejects.toMatchObject({
        code: "25P02"
      });

      // Rollback conn2
      await conn2.query("ROLLBACK");

      // After rollback, a fresh read on conn2 (outside the aborted transaction) succeeds
      const recovered = await repo2.findByIdempotencyKey(idempotencyKey);
      expect(recovered).toBeDefined();
      expect(recovered?.id).toBe("018e69e0-8a6a-72cb-b1b7-ec79a1f73811");
    } finally {
      conn2.release();
    }
  });

  it("leaves idempotency_key, target_total_duration_ms, and request_hash_sha256 as NULL when using existing save()", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73813" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Legacy Save Campaign",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(campaign);

    // Verify row directly in Postgres
    const rawResult = await client.query<{
      idempotency_key: string | null;
      target_total_duration_ms: number | null;
      request_hash_sha256: string | null;
    }>(
      `SELECT idempotency_key, target_total_duration_ms, request_hash_sha256 FROM campaigns WHERE campaign_id = $1`,
      [campaignId]
    );
    expect(rawResult.rows).toHaveLength(1);
    expect(rawResult.rows[0]?.idempotency_key).toBeNull();
    expect(rawResult.rows[0]?.target_total_duration_ms).toBeNull();
    expect(rawResult.rows[0]?.request_hash_sha256).toBeNull();

    // Verify findById also returns undefined for these optional fields
    const retrieved = await repository.findById(campaignId);
    expect(retrieved?.idempotencyKey).toBeUndefined();
    expect(retrieved?.targetTotalDurationMs).toBeUndefined();
  });

  it("resolves original campaign on identical retry of an archived operation (Finding 1)", async () => {
    const clientRecord = await insertClientRecord(client);
    const repository = new PostgresCampaignRepository(client);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73820" as CampaignId;
    const idempotencyKey = "018e69e0-8a6a-72cb-b1b7-ec79a1f73821";
    const requestHash = "d".repeat(64);

    const campaign: CampaignShellRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "Archived Operation Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyKey,
      targetTotalDurationMs: 15000
    };

    await repository.saveWithRequestHash(campaign, requestHash);

    // Archive the campaign in Postgres
    await client.query(
      "UPDATE campaigns SET archived_at = CURRENT_TIMESTAMP WHERE campaign_id = $1",
      [campaignId]
    );

    // Regular findById should return undefined because campaign is archived
    const activeById = await repository.findById(campaignId);
    expect(activeById).toBeUndefined();

    // Idempotency lookup MUST include archived rows so identical retry can resolve it
    const retrieved = await repository.findByIdempotencyKey(idempotencyKey);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(campaignId);
    expect(retrieved?.idempotencyKey).toBe(idempotencyKey);
    expect(retrieved?.targetTotalDurationMs).toBe(15000);
    expect(retrieved?.requestHashSha256).toBe(requestHash);
    expect(retrieved?.archivedAt).toBeDefined();
  });

  it("enforces chk_campaigns_operation_identity requiring all three operation columns to be either all NULL or all non-NULL (Finding 2)", async () => {
    const clientRecord = await insertClientRecord(client);

    // 1. Partial operation columns: idempotency_key set, but target_total_duration_ms and request_hash NULL -> fails
    await expect(
      client.query(
        `INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes, idempotency_key)
         VALUES ($1, $2, 'Partial Campaign', 'tiktok', 'drafting', 1, 0, $3)`,
        [
          "018e69e0-8a6a-72cb-b1b7-ec79a1f73822",
          clientRecord.client_id,
          "018e69e0-8a6a-72cb-b1b7-ec79a1f73823"
        ]
      )
    ).rejects.toMatchObject({ code: "23514" }); // check_violation

    // 2. Partial operation columns: request_hash set, but idempotency_key and duration NULL -> fails
    await expect(
      client.query(
        `INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes, request_hash_sha256)
         VALUES ($1, $2, 'Partial Campaign 2', 'tiktok', 'drafting', 1, 0, $3)`,
        ["018e69e0-8a6a-72cb-b1b7-ec79a1f73824", clientRecord.client_id, "e".repeat(64)]
      )
    ).rejects.toMatchObject({ code: "23514" });

    // 3. All NULL (legacy campaign) -> succeeds
    await expect(
      client.query(
        `INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes)
         VALUES ($1, $2, 'Legacy All-Null', 'tiktok', 'drafting', 1, 0)`,
        ["018e69e0-8a6a-72cb-b1b7-ec79a1f73825", clientRecord.client_id]
      )
    ).resolves.toBeDefined();

    // 4. All non-NULL (shell campaign) -> succeeds
    await expect(
      client.query(
        `INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes, idempotency_key, target_total_duration_ms, request_hash_sha256)
         VALUES ($1, $2, 'Shell All-NonNull', 'tiktok', 'drafting', 1, 0, $3, 15000, $4)`,
        [
          "018e69e0-8a6a-72cb-b1b7-ec79a1f73826",
          clientRecord.client_id,
          "018e69e0-8a6a-72cb-b1b7-ec79a1f73827",
          "f".repeat(64)
        ]
      )
    ).resolves.toBeDefined();
  });

  it("executes CreateCampaignShellUseCase end-to-end with PostgresUnitOfWork including race recovery and archived retry (Finding 1 & 3)", async () => {
    const clientRecord = await insertClientRecord(client);
    await client.query("COMMIT");

    try {
      const uow = new PostgresUnitOfWork(pool);
      const useCase = new CreateCampaignShellUseCase(uow);

      const request = {
        idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73828",
        clientId: clientRecord.client_id,
        title: "E2E Postgres Shell Campaign",
        targetPlatform: "tiktok",
        targetTotalDurationMs: 15000,
        sceneCountOverride: undefined
      };

      // 1. Initial execution creates drafting shell
      const firstResult = await useCase.execute(request);
      expect(firstResult.isIdempotentReplay).toBe(false);
      expect(firstResult.campaign.totalScenes).toBe(3);
      expect(firstResult.campaign.idempotencyKey).toBe(request.idempotencyKey);
      expect(firstResult.campaign.targetTotalDurationMs).toBe(15000);

      // 2. Identical retry resumes existing shell
      const retryResult = await useCase.execute(request);
      expect(retryResult.isIdempotentReplay).toBe(true);
      expect(retryResult.campaign.id).toBe(firstResult.campaign.id);

      // 3. Different payload throws conflict error
      await expect(
        useCase.execute({
          ...request,
          title: "Mismatched Title"
        })
      ).rejects.toThrow(CampaignIdempotencyConflictError);

      // 4. Archive campaign and perform identical retry -> resolves original with archivedAt
      const conn = await pool.connect();
      try {
        await conn.query(
          "UPDATE campaigns SET archived_at = CURRENT_TIMESTAMP WHERE campaign_id = $1",
          [firstResult.campaign.id]
        );
      } finally {
        conn.release();
      }

      const archivedRetryResult = await useCase.execute(request);
      expect(archivedRetryResult.isIdempotentReplay).toBe(true);
      expect(archivedRetryResult.campaign.id).toBe(firstResult.campaign.id);
      expect(archivedRetryResult.campaign.archivedAt).toBeDefined();
    } finally {
      await client.query("BEGIN");
    }
  });
});
