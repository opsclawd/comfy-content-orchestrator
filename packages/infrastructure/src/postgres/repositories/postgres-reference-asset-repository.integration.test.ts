import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  ArchivedReferenceBindingError,
  CrossClientReferenceBindingError,
  ReferenceAssetNotFoundError
} from "@cco/domain";
import type {
  ReferenceAsset,
  ReferenceAssetId,
  ReferenceGroupId,
  SceneId,
  SceneReferenceBinding
} from "@cco/domain";
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
  insertReferenceGroupRecord,
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

  it("saves a new ReferenceAsset and retrieves it via findByIds", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const assetId = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as ReferenceAssetId;
    const asset: ReferenceAsset = {
      id: assetId,
      clientId: clientRecord.client_id,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/portrait.png",
      contentHashSha256: "3333333333333333333333333333333333333333333333333333333333333333",
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Hero Portrait",
      groupId: null,
      archivedAt: null
    };

    const saved = await repo.save(asset);
    expect(saved.id).toBe(asset.id);
    expect(saved.width).toBe(1920);
    expect(saved.height).toBe(1080);
    expect(saved.mimeType).toBe("image/png");
    expect(saved.displayName).toBe("Hero Portrait");
    expect(saved.archivedAt).toBeUndefined();

    const retrieved = await repo.findByIds(clientRecord.client_id, [asset.id]);
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.id).toBe(asset.id);
    expect(retrieved[0]?.width).toBe(1920);
    expect(retrieved[0]?.height).toBe(1080);
    expect(retrieved[0]?.mimeType).toBe("image/png");
    expect(retrieved[0]?.displayName).toBe("Hero Portrait");
  });

  it("archives a reference asset and includes it only when includeArchived is true", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const ref = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/archived-test.png"
    });

    const assetId = ref.asset_id as ReferenceAssetId;
    await repo.archive(clientRecord.client_id, assetId);

    const activeOnly = await repo.findByIds(clientRecord.client_id, [assetId]);
    expect(activeOnly).toHaveLength(0);

    const withArchived = await repo.findByIds(clientRecord.client_id, [assetId], {
      includeArchived: true
    });
    expect(withArchived).toHaveLength(1);
    expect(withArchived[0]?.id).toBe(assetId);
    expect(withArchived[0]?.archivedAt).not.toBeNull();
  });

  it("findByClientId supports pagination, includeArchived, and groupId filtering", async () => {
    const clientRecord = await insertClientRecord(client);
    const repo = new PostgresReferenceAssetRepository(client);

    const group = await insertReferenceGroupRecord(client, {
      clientId: clientRecord.client_id,
      name: "Group A"
    });

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      groupId: group.group_id
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });
    const ref3 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      archivedAt: new Date()
    });

    // Default: active only, all groups
    const active = await repo.findByClientId(clientRecord.client_id);
    expect(active).toHaveLength(2);
    expect(active.map((a) => a.id).sort()).toEqual([ref1.asset_id, ref2.asset_id].sort());

    // With includeArchived: true
    const all = await repo.findByClientId(clientRecord.client_id, { includeArchived: true });
    expect(all).toHaveLength(3);
    expect(all.map((a) => a.id).sort()).toEqual(
      [ref1.asset_id, ref2.asset_id, ref3.asset_id].sort()
    );

    // Filter by groupId
    const groupOnly = await repo.findByClientId(clientRecord.client_id, {
      groupId: group.group_id as ReferenceGroupId
    });
    expect(groupOnly).toHaveLength(1);
    expect(groupOnly[0]?.id).toBe(ref1.asset_id);
    expect(groupOnly[0]?.groupId).toBe(group.group_id);
  });

  it("saveBindings and listBindingsBySceneId persist and query bindings with roles and weights", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 2
    });

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    const repo = new PostgresReferenceAssetRepository(client);

    const bindings: SceneReferenceBinding[] = [
      {
        sceneId: scene.scene_id as SceneId,
        specRevision: 2,
        referenceAssetId: ref1.asset_id as ReferenceAssetId,
        role: "subject_identity",
        weight: 0.85,
        hints: { faceConfidence: 0.99 },
        archivedAt: null
      },
      {
        sceneId: scene.scene_id as SceneId,
        specRevision: 2,
        referenceAssetId: ref2.asset_id as ReferenceAssetId,
        role: "style",
        weight: 0.6,
        hints: null,
        archivedAt: null
      }
    ];

    await repo.saveBindings(scene.scene_id as SceneId, bindings);

    const listed = await repo.listBindingsBySceneId(scene.scene_id as SceneId);
    expect(listed).toHaveLength(2);
    expect(listed[0]?.role).toBe("subject_identity");
    expect(listed[0]?.weight).toBe(0.85);
    expect(listed[0]?.hints).toEqual({ faceConfidence: 0.99 });
    expect(listed[1]?.role).toBe("style");
    expect(listed[1]?.weight).toBe(0.6);

    // Filter by specRevision
    const rev2 = await repo.listBindingsBySceneId(scene.scene_id as SceneId, { specRevision: 2 });
    expect(rev2).toHaveLength(2);

    const rev1 = await repo.listBindingsBySceneId(scene.scene_id as SceneId, { specRevision: 1 });
    expect(rev1).toHaveLength(0);
  });

  it("saveBindings rejects cross-client reference with CrossClientReferenceBindingError", async () => {
    const clientA = await insertClientRecord(client);
    const clientB = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientA.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });

    const refClientB = await insertReferenceAssetRecord(client, {
      clientId: clientB.client_id
    });

    const repo = new PostgresReferenceAssetRepository(client);

    await expect(
      repo.saveBindings(scene.scene_id as SceneId, [
        {
          sceneId: scene.scene_id as SceneId,
          specRevision: 1,
          referenceAssetId: refClientB.asset_id as ReferenceAssetId,
          role: "subject_identity",
          weight: null,
          hints: null,
          archivedAt: null
        }
      ])
    ).rejects.toThrow(CrossClientReferenceBindingError);
  });

  it("saveBindings rejects archived reference with ArchivedReferenceBindingError", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });

    const archivedRef = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      archivedAt: new Date()
    });

    const repo = new PostgresReferenceAssetRepository(client);

    await expect(
      repo.saveBindings(scene.scene_id as SceneId, [
        {
          sceneId: scene.scene_id as SceneId,
          specRevision: 1,
          referenceAssetId: archivedRef.asset_id as ReferenceAssetId,
          role: "subject_identity",
          weight: null,
          hints: null,
          archivedAt: null
        }
      ])
    ).rejects.toThrow(ArchivedReferenceBindingError);
  });

  it("saveBindings rejects nonexistent reference with ReferenceAssetNotFoundError", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });

    const repo = new PostgresReferenceAssetRepository(client);

    await expect(
      repo.saveBindings(scene.scene_id as SceneId, [
        {
          sceneId: scene.scene_id as SceneId,
          specRevision: 1,
          referenceAssetId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
          role: "subject_identity",
          weight: null,
          hints: null,
          archivedAt: null
        }
      ])
    ).rejects.toThrow(ReferenceAssetNotFoundError);
  });

  it("preserves bindings across multiple revisions and roles for the same asset", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });

    const ref = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    const repo = new PostgresReferenceAssetRepository(client);

    // Save revision 1 as subject_identity
    await repo.saveBindings(scene.scene_id as SceneId, [
      {
        sceneId: scene.scene_id as SceneId,
        specRevision: 1,
        referenceAssetId: ref.asset_id as ReferenceAssetId,
        role: "subject_identity",
        weight: 0.9,
        hints: null,
        archivedAt: null
      }
    ]);

    // Save revision 2 as style for the same asset
    await repo.saveBindings(scene.scene_id as SceneId, [
      {
        sceneId: scene.scene_id as SceneId,
        specRevision: 2,
        referenceAssetId: ref.asset_id as ReferenceAssetId,
        role: "style",
        weight: 0.5,
        hints: null,
        archivedAt: null
      }
    ]);

    // Both revisions must be queryable and preserved
    const allBindings = await repo.listBindingsBySceneId(scene.scene_id as SceneId);
    expect(allBindings).toHaveLength(2);

    const rev1Bindings = await repo.listBindingsBySceneId(scene.scene_id as SceneId, {
      specRevision: 1
    });
    expect(rev1Bindings).toHaveLength(1);
    expect(rev1Bindings[0]?.role).toBe("subject_identity");

    const rev2Bindings = await repo.listBindingsBySceneId(scene.scene_id as SceneId, {
      specRevision: 2
    });
    expect(rev2Bindings).toHaveLength(1);
    expect(rev2Bindings[0]?.role).toBe("style");
  });
});
