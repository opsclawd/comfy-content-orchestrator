import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
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

describe("Client to Campaign End-to-End Integration Flow", () => {
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

  it("creates a client via API then creates a campaign and scene referencing it end-to-end without direct DB seeding", async () => {
    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    // 1. POST /api/clients (no direct DB insertion!)
    const clientRes = await app.inject({
      method: "POST",
      url: "/api/clients",
      payload: {
        companyName: "Godzspeed Communications Inc."
      }
    });

    expect(clientRes.statusCode).toBe(201);
    const clientBody = clientRes.json();
    expect(clientBody.clientId).toBeDefined();
    expect(clientBody.companyName).toBe("Godzspeed Communications Inc.");
    expect(clientBody.brandBibleJson).toEqual({});
    expect(clientBody.defaultAspectRatio).toBe("9:16");
    expect(clientBody.externalProcessingPolicy).toEqual({
      allowCloudPlanning: true,
      allowCloudVisualQA: true,
      allowCloudVoice: true,
      allowedProviders: ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
      sensitiveDataMasking: true
    });
    expect(clientBody.createdAt).toBeDefined();
    expect(clientBody.updatedAt).toBeDefined();

    // Verify client record landed in PostgreSQL
    const clientDbResult = await client.query(
      "SELECT client_id, company_name, brand_bible_json, default_aspect_ratio, external_processing_policy FROM clients WHERE client_id = $1",
      [clientBody.clientId]
    );
    expect(clientDbResult.rows).toHaveLength(1);
    const clientRow = clientDbResult.rows[0];
    expect(clientRow?.company_name).toBe("Godzspeed Communications Inc.");
    expect(clientRow?.default_aspect_ratio).toBe("9:16");

    // 2. POST /api/campaigns referencing the newly created client
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientBody.clientId,
        title: "Carnival 2026 Commercial",
        targetPlatform: "instagram_reels",
        totalScenes: 1
      }
    });

    expect(campaignRes.statusCode).toBe(201);
    const campaignBody = campaignRes.json();
    expect(campaignBody.campaignId).toBeDefined();
    expect(campaignBody.clientId).toBe(clientBody.clientId);
    expect(campaignBody.title).toBe("Carnival 2026 Commercial");
    expect(campaignBody.status).toBe("drafting");

    // Verify campaign landed in PostgreSQL with FK satisfied
    const campaignDbResult = await client.query(
      "SELECT campaign_id, client_id, title, status FROM campaigns WHERE campaign_id = $1",
      [campaignBody.campaignId]
    );
    expect(campaignDbResult.rows).toHaveLength(1);
    expect(campaignDbResult.rows[0]?.client_id).toBe(clientBody.clientId);

    // 3. POST /api/campaigns/:campaignId/scenes referencing the campaign
    const configuration = {
      prompt: "Opening shot: Trinidad carnival dancer in golden plumage at sunrise",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000
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

    // Verify scene landed in PostgreSQL
    const sceneRepo = new PostgresSceneRepository(pool);
    const reconstitutedScene = await sceneRepo.findById(sceneBody.sceneId as SceneId);
    expect(reconstitutedScene).toBeDefined();
    expect(reconstitutedScene?.snapshot().campaignId).toBe(campaignBody.campaignId);
  });
});
