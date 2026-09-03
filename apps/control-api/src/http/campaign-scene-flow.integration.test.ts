import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import { runMigrations, PostgresUnitOfWork, PostgresSceneRepository } from "@cco/infrastructure";
import type { SceneId } from "@cco/domain";
import { createControlApiApp } from "./app.js";

const defaultTestOptions = {
  reviewerIdentityResolver: {
    resolve: () => "Test Creator"
  }
};

describe("Campaign and Scene Creation End-to-End Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

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

  it("creates a real campaign and scene landing in PostgreSQL in draft_pending state", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Productions"
    });

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    // 1. POST /api/campaigns
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Carnival 2026 Commercial",
        targetPlatform: "instagram_reels",
        totalScenes: 2
      }
    });

    expect(campaignRes.statusCode).toBe(201);
    const campaignBody = campaignRes.json();
    expect(campaignBody.campaignId).toBeDefined();
    expect(campaignBody.clientId).toBe(clientRecord.client_id);
    expect(campaignBody.title).toBe("Carnival 2026 Commercial");
    expect(campaignBody.targetPlatform).toBe("instagram_reels");
    expect(campaignBody.status).toBe("drafting");
    expect(campaignBody.totalScenes).toBe(2);
    expect(campaignBody.approvedScenes).toBe(0);
    expect(campaignBody.createdAt).toBeDefined();

    // Verify campaign landed in PostgreSQL
    const campaignRowResult = await client.query(
      "SELECT campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes FROM campaigns WHERE campaign_id = $1",
      [campaignBody.campaignId]
    );
    expect(campaignRowResult.rows).toHaveLength(1);
    const campaignRow = campaignRowResult.rows[0];
    expect(campaignRow?.client_id).toBe(clientRecord.client_id);
    expect(campaignRow?.title).toBe("Carnival 2026 Commercial");
    expect(campaignRow?.status).toBe("drafting");
    expect(campaignRow?.total_scenes).toBe(2);

    // 2. POST /api/campaigns/:campaignId/scenes
    const configuration = {
      prompt: "Cinematic shot of carnival dancer in golden plumage at sunset",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: "lora-carnival-v1"
    };

    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignBody.campaignId}/scenes`,
      payload: { configuration }
    });

    expect(sceneRes.statusCode).toBe(201);
    const sceneBody = sceneRes.json();
    expect(sceneBody.sceneId).toBeDefined();
    expect(sceneBody.campaignId).toBe(campaignBody.campaignId);
    expect(sceneBody.status).toBe("draft_pending");
    expect(sceneBody.specRevision).toBe(1);
    expect(sceneBody.configuration).toEqual(configuration);

    // Verify scene landed in PostgreSQL in draft_pending state with spec_revision = 1
    const sceneRowResult = await client.query(
      "SELECT scene_id, campaign_id, scene_order, duration_seconds, visual_description, engine_assigned, status, spec_revision, lora_configuration_id FROM storyboard_scenes WHERE scene_id = $1",
      [sceneBody.sceneId]
    );
    expect(sceneRowResult.rows).toHaveLength(1);
    const sceneRow = sceneRowResult.rows[0];
    expect(sceneRow?.campaign_id).toBe(campaignBody.campaignId);
    expect(sceneRow?.status).toBe("draft_pending");
    expect(sceneRow?.spec_revision).toBe(1);
    expect(sceneRow?.scene_order).toBe(1);
    expect(sceneRow?.visual_description).toBe(configuration.prompt);
    expect(sceneRow?.engine_assigned).toBe("ltx_25");
    expect(sceneRow?.lora_configuration_id).toBe("lora-carnival-v1");

    // Also verify Scene repository can reconstitute it
    const sceneRepo = new PostgresSceneRepository(pool);
    const reconstituted = await sceneRepo.findById(sceneBody.sceneId as SceneId);
    expect(reconstituted).toBeDefined();
    expect(reconstituted?.status).toBe("draft_pending");
    expect(reconstituted?.snapshot().specRevision).toBe(1);
  });

  it("returns 404 NOT_FOUND when attempting to create campaign with non-existent clientId", async () => {
    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    const nonExistentClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899";
    const res = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: nonExistentClientId,
        title: "Orphan Campaign"
      }
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(`Client '${nonExistentClientId}' was not found.`);
  });

  it("returns 404 NOT_FOUND when attempting to create scene under non-existent campaignId", async () => {
    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    const nonExistentCampaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800";
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${nonExistentCampaignId}/scenes`,
      payload: {
        configuration: {
          prompt: "Caldera sunrise",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      }
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(`Campaign '${nonExistentCampaignId}' was not found.`);
  });
});
