import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { ClientNotFoundError } from "@cco/application";
import type { CampaignId, CampaignRecord } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
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
});
