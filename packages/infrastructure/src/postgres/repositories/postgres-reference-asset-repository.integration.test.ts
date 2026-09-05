import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { ReferenceAssetId, SceneId } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertReferenceAssetRecord,
  insertSceneReferenceAssetRecord
} from "../test-support/records.js";
import { PostgresReferenceAssetRepository } from "./postgres-reference-asset-repository.js";

describe("PostgresReferenceAssetRepository Integration", () => {
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

  it("resolves existing IDs for the client with populated clientId and structurally absent sceneId", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      assetType: "brand_logo",
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/logo.png",
      contentHashSha256: "1111111111111111111111111111111111111111111111111111111111111111"
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      assetType: "style_lora",
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/style.safetensors",
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222222"
    });

    const results = await repo.findByIds(clientRecord.client_id, [
      ref1.asset_id as ReferenceAssetId,
      ref2.asset_id as ReferenceAssetId
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe(ref1.asset_id);
    expect(results[0]?.clientId).toBe(clientRecord.client_id);
    expect("sceneId" in (results[0] as object)).toBe(false);
    expect(results[0]?.sceneId).toBeUndefined();

    expect(results[1]?.id).toBe(ref2.asset_id);
    expect(results[1]?.clientId).toBe(clientRecord.client_id);
    expect("sceneId" in (results[1] as object)).toBe(false);
    expect(results[1]?.sceneId).toBeUndefined();
  });

  it("short-circuits when ids array is empty", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const results = await repo.findByIds(clientRecord.client_id, []);
    expect(results).toEqual([]);
  });

  it("silently excludes nonexistent or fabricated UUIDs", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    const fakeUuid = "00000000-0000-0000-0000-000000000099" as ReferenceAssetId;
    const results = await repo.findByIds(clientRecord.client_id, [
      ref1.asset_id as ReferenceAssetId,
      fakeUuid
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(ref1.asset_id);
  });

  it("excludes real, non-archived assets that belong to a different client (cross-tenant isolation)", async () => {
    const clientA = await insertClientRecord(client);
    const clientB = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const assetClientA = await insertReferenceAssetRecord(client, {
      clientId: clientA.client_id,
      storageObjectKey: "assets/clientA.png"
    });
    const assetClientB = await insertReferenceAssetRecord(client, {
      clientId: clientB.client_id,
      storageObjectKey: "assets/clientB.png"
    });

    // Querying with clientA should NEVER return clientB's asset even when clientB's asset ID is requested
    const resultsForClientA = await repo.findByIds(clientA.client_id, [
      assetClientA.asset_id as ReferenceAssetId,
      assetClientB.asset_id as ReferenceAssetId
    ]);

    expect(resultsForClientA).toHaveLength(1);
    expect(resultsForClientA[0]?.id).toBe(assetClientA.asset_id);
    expect(resultsForClientA[0]?.clientId).toBe(clientA.client_id);

    // Querying with clientB only returns clientB's asset
    const resultsForClientB = await repo.findByIds(clientB.client_id, [
      assetClientA.asset_id as ReferenceAssetId,
      assetClientB.asset_id as ReferenceAssetId
    ]);

    expect(resultsForClientB).toHaveLength(1);
    expect(resultsForClientB[0]?.id).toBe(assetClientB.asset_id);
    expect(resultsForClientB[0]?.clientId).toBe(clientB.client_id);
  });

  it("silently excludes archived reference assets", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/archived-ref1.png"
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/active-ref2.png"
    });

    await client.query(
      "UPDATE reference_assets SET archived_at = CURRENT_TIMESTAMP WHERE asset_id = $1",
      [ref1.asset_id]
    );

    const results = await repo.findByIds(clientRecord.client_id, [
      ref1.asset_id as ReferenceAssetId,
      ref2.asset_id as ReferenceAssetId
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(ref2.asset_id);
  });

  it("populates clientId in listBySceneId", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });

    const ref = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: ref.asset_id
    });

    const repo = new PostgresReferenceAssetRepository(client);
    const assets = await repo.listBySceneId(scene.scene_id as SceneId);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.id).toBe(ref.asset_id);
    expect(assets[0]?.sceneId).toBe(scene.scene_id);
    expect(assets[0]?.clientId).toBe(clientRecord.client_id);
  });
});
