import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { CreateSceneUseCase } from "@cco/application";
import type { SceneConfiguration } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord
} from "../test-support/records.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";

describe("CreateSceneUseCase Integration", () => {
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

  const sampleConfig: SceneConfiguration = {
    prompt: "A bustling market in Port of Spain",
    referenceIds: [],
    engineProfileId: "ltx_25",
    durationMs: 5000,
    loraConfigurationId: null
  };

  it("serializes concurrent CreateScene executions on an empty campaign with unique sequential sequenceIndex", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 2
    });

    const uow1 = new PostgresUnitOfWork(pool);
    const uow2 = new PostgresUnitOfWork(pool);
    const useCase1 = new CreateSceneUseCase(uow1);
    const useCase2 = new CreateSceneUseCase(uow2);

    // Concurrently execute CreateScene for the same empty campaign
    const [sceneA, sceneB] = await Promise.all([
      useCase1.execute({
        campaignId: campaign.campaign_id,
        configuration: { ...sampleConfig, prompt: "Scene Concurrent A" }
      }),
      useCase2.execute({
        campaignId: campaign.campaign_id,
        configuration: { ...sampleConfig, prompt: "Scene Concurrent B" }
      })
    ]);

    expect(sceneA.id).toBeDefined();
    expect(sceneB.id).toBeDefined();
    expect(sceneA.id).not.toBe(sceneB.id);

    const indices = [sceneA.sequenceIndex, sceneB.sequenceIndex].sort((a, b) => a - b);
    expect(indices).toEqual([1, 2]);

    // Verify raw PostgreSQL storyboard_scenes rows
    const sceneRows = await client.query<{
      scene_id: string;
      scene_order: number;
    }>(
      `SELECT scene_id, scene_order
       FROM storyboard_scenes
       WHERE campaign_id = $1
       ORDER BY scene_order ASC`,
      [campaign.campaign_id]
    );

    expect(sceneRows.rows).toHaveLength(2);
    expect(sceneRows.rows.map((r) => r.scene_order)).toEqual([1, 2]);
  });

  it("allocates next sequenceIndex correctly when the highest ordinal belongs to an archived scene", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 3
    });

    // Scene 1: active
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });

    // Scene 2: archived (highest ordinal prior to append)
    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "approved"
    });
    await client.query(
      "UPDATE storyboard_scenes SET archived_at = CURRENT_TIMESTAMP WHERE scene_id = $1",
      [archivedScene.scene_id]
    );

    const uow = new PostgresUnitOfWork(pool);
    const useCase = new CreateSceneUseCase(uow);

    // Append new scene - must allocate sequenceIndex 3 without colliding with archived scene 2
    const newScene = await useCase.execute({
      campaignId: campaign.campaign_id,
      configuration: { ...sampleConfig, prompt: "Scene 3 after archived scene 2" }
    });

    expect(newScene.sequenceIndex).toBe(3);
    expect(newScene.snapshot().sequenceIndex).toBe(3);

    // Verify all rows in storyboard_scenes (including archived)
    const allRows = await client.query<{
      scene_id: string;
      scene_order: number;
      archived_at: string | null;
    }>(
      `SELECT scene_id, scene_order, archived_at
       FROM storyboard_scenes
       WHERE campaign_id = $1
       ORDER BY scene_order ASC`,
      [campaign.campaign_id]
    );

    expect(allRows.rows).toHaveLength(3);
    expect(allRows.rows.map((r) => r.scene_order)).toEqual([1, 2, 3]);
    expect(allRows.rows[1]?.archived_at).not.toBeNull();
    expect(allRows.rows[2]?.scene_id).toBe(newScene.id);
  });
});
