import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { StaleBibleEntryConflictError } from "@cco/application";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertReferenceAssetRecord
} from "../test-support/records.js";
import { PostgresCampaignReferenceBibleRepository } from "./postgres-campaign-reference-bible-repository.js";

describe("PostgresCampaignReferenceBibleRepository Integration", () => {
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

  it("initializes snapshot on first planning run and returns entries unchanged on repeat", async () => {
    const repo = new PostgresCampaignReferenceBibleRepository(client);
    const dbClient = await insertClientRecord(client, { companyName: "Client A" });
    const campaign = await insertCampaignRecord(client, { clientId: dbClient.client_id });
    const asset1 = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "1".repeat(64)
    });
    const asset2 = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "2".repeat(64)
    });

    const initResult = await repo.initializeSnapshot({
      campaignId: campaign.campaign_id,
      entries: [
        {
          referenceAssetId: asset1.asset_id,
          role: "subject_identity",
          description: "Hero protagonist",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "1".repeat(64)
        },
        {
          referenceAssetId: asset2.asset_id,
          role: "location",
          description: "Desert canyon",
          biblePromptTag: "<Picture 2>",
          sourceContentHashSha256: "2".repeat(64)
        }
      ]
    });

    expect(initResult.created).toBe(true);
    expect(initResult.entries).toHaveLength(2);
    expect(initResult.entries[0]!.biblePromptTag).toBe("<Picture 1>");
    expect(initResult.entries[0]!.description).toBe("Hero protagonist");
    expect(initResult.entries[1]!.biblePromptTag).toBe("<Picture 2>");

    // Repeat initialization returns existing snapshot unchanged with created = false
    const repeatResult = await repo.initializeSnapshot({
      campaignId: campaign.campaign_id,
      entries: [
        {
          referenceAssetId: asset1.asset_id,
          role: "subject_identity",
          description: "Divergent description",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "1".repeat(64)
        }
      ]
    });

    expect(repeatResult.created).toBe(false);
    expect(repeatResult.entries).toHaveLength(2);
    expect(repeatResult.entries[0]!.description).toBe("Hero protagonist");
  });

  it("findByCampaignId and findByCampaignAndAsset query entries with deterministic ordering and campaign isolation", async () => {
    const repo = new PostgresCampaignReferenceBibleRepository(client);
    const dbClient = await insertClientRecord(client, { companyName: "Client B" });
    const campaignA = await insertCampaignRecord(client, { clientId: dbClient.client_id });
    const campaignB = await insertCampaignRecord(client, { clientId: dbClient.client_id });

    const asset1 = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "a".repeat(64)
    });
    const asset2 = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "b".repeat(64)
    });

    await repo.initializeSnapshot({
      campaignId: campaignA.campaign_id,
      entries: [
        {
          referenceAssetId: asset1.asset_id,
          role: "location",
          description: "Location A",
          biblePromptTag: "<Picture 2>",
          sourceContentHashSha256: "a".repeat(64)
        },
        {
          referenceAssetId: asset2.asset_id,
          role: "subject_identity",
          description: "Subject B",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "b".repeat(64)
        }
      ]
    });

    const entriesA = await repo.findByCampaignId(campaignA.campaign_id);
    expect(entriesA).toHaveLength(2);
    // Role priority: subject_identity first
    expect(entriesA[0]!.role).toBe("subject_identity");
    expect(entriesA[0]!.referenceAssetId).toBe(asset2.asset_id);
    expect(entriesA[1]!.role).toBe("location");
    expect(entriesA[1]!.referenceAssetId).toBe(asset1.asset_id);

    // Isolation: Campaign B has 0 entries
    const entriesB = await repo.findByCampaignId(campaignB.campaign_id);
    expect(entriesB).toHaveLength(0);

    // Single asset lookup
    const single = await repo.findByCampaignAndAsset(campaignA.campaign_id, asset2.asset_id);
    expect(single).not.toBeNull();
    expect(single?.description).toBe("Subject B");

    const missing = await repo.findByCampaignAndAsset(
      campaignA.campaign_id,
      "00000000-0000-0000-0000-000000000000"
    );
    expect(missing).toBeNull();
  });

  it("updateEntryWithAudit records role updates and appends immutable change history atomically", async () => {
    const repo = new PostgresCampaignReferenceBibleRepository(client);
    const dbClient = await insertClientRecord(client, { companyName: "Client C" });
    const campaign = await insertCampaignRecord(client, { clientId: dbClient.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const asset = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "c".repeat(64)
    });

    const initResult = await repo.initializeSnapshot({
      campaignId: campaign.campaign_id,
      entries: [
        {
          referenceAssetId: asset.asset_id,
          role: "subject_identity",
          description: "Initial subject description",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "c".repeat(64)
        }
      ]
    });

    const initialEntry = initResult.entries[0]!;

    const updated = await repo.updateEntryWithAudit({
      campaignId: campaign.campaign_id,
      referenceAssetId: asset.asset_id,
      expectedUpdatedAt: initialEntry.updatedAt,
      next: {
        role: "location",
        description: "Reclassified as location",
        biblePromptTag: "<Picture 1>",
        sourceContentHashSha256: "c".repeat(64)
      },
      change: {
        changeReason: "reclassify_role",
        sourceSceneId: scene.scene_id,
        sourceSpecRevision: 2,
        sourceBindingId: "binding-1",
        actorKind: "director",
        actorId: "director-1"
      }
    });

    expect(updated.role).toBe("location");
    expect(updated.description).toBe("Reclassified as location");

    const changes = await repo.listChanges(campaign.campaign_id, asset.asset_id);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.oldRole).toBe("subject_identity");
    expect(changes[0]!.newRole).toBe("location");
    expect(changes[0]!.oldDescription).toBe("Initial subject description");
    expect(changes[0]!.newDescription).toBe("Reclassified as location");
    expect(changes[0]!.changeReason).toBe("reclassify_role");
    expect(changes[0]!.sourceSceneId).toBe(scene.scene_id);
  });

  it("updateEntryWithAudit rejects stale expectedUpdatedAt with StaleBibleEntryConflictError", async () => {
    const repo = new PostgresCampaignReferenceBibleRepository(client);
    const dbClient = await insertClientRecord(client, { companyName: "Client D" });
    const campaign = await insertCampaignRecord(client, { clientId: dbClient.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const asset = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "d".repeat(64)
    });

    await repo.initializeSnapshot({
      campaignId: campaign.campaign_id,
      entries: [
        {
          referenceAssetId: asset.asset_id,
          role: "subject_identity",
          description: "Subject D",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "d".repeat(64)
        }
      ]
    });

    await expect(
      repo.updateEntryWithAudit({
        campaignId: campaign.campaign_id,
        referenceAssetId: asset.asset_id,
        expectedUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
        next: {
          role: "location",
          description: "New description",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "d".repeat(64)
        },
        change: {
          changeReason: "stale_attempt",
          sourceSceneId: scene.scene_id,
          sourceSpecRevision: 2,
          sourceBindingId: "binding-2",
          actorKind: "director"
        }
      })
    ).rejects.toThrow(StaleBibleEntryConflictError);
  });

  it("enforces append-only immutability on campaign_reference_bible_changes table", async () => {
    const repo = new PostgresCampaignReferenceBibleRepository(client);
    const dbClient = await insertClientRecord(client, { companyName: "Client E" });
    const campaign = await insertCampaignRecord(client, { clientId: dbClient.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const asset = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "e".repeat(64)
    });

    await repo.updateEntryWithAudit({
      campaignId: campaign.campaign_id,
      referenceAssetId: asset.asset_id,
      next: {
        role: "subject_identity",
        description: "Subject E",
        biblePromptTag: "<Picture 1>",
        sourceContentHashSha256: "e".repeat(64)
      },
      change: {
        changeReason: "added",
        sourceSceneId: scene.scene_id,
        sourceSpecRevision: 1,
        sourceBindingId: "binding-add",
        actorKind: "system"
      }
    });

    const changes = await repo.listChanges(campaign.campaign_id, asset.asset_id);
    expect(changes).toHaveLength(1);

    // Direct UPDATE on changes table is rejected by trigger
    await expect(
      client.query(
        "UPDATE campaign_reference_bible_changes SET change_reason = 'tampered' WHERE change_id = $1",
        [changes[0]!.changeId]
      )
    ).rejects.toThrow(/immutable|not permitted/);

    // Direct DELETE on changes table is rejected by trigger
    await expect(
      client.query("DELETE FROM campaign_reference_bible_changes WHERE change_id = $1", [
        changes[0]!.changeId
      ])
    ).rejects.toThrow(/immutable|not permitted/);
  });

  it("updateEntryWithAudit retains row on campaign-level removal and restores stable tag on re-addition", async () => {
    const repo = new PostgresCampaignReferenceBibleRepository(client);
    const dbClient = await insertClientRecord(client, { companyName: "Client Rem" });
    const campaign = await insertCampaignRecord(client, { clientId: dbClient.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id });
    const asset = await insertReferenceAssetRecord(client, {
      clientId: dbClient.client_id,
      contentHashSha256: "r".repeat(64)
    });

    const initResult = await repo.initializeSnapshot({
      campaignId: campaign.campaign_id,
      entries: [
        {
          referenceAssetId: asset.asset_id,
          role: "subject_identity",
          description: "Protagonist to remove",
          biblePromptTag: "<Picture 1>",
          sourceContentHashSha256: "r".repeat(64)
        }
      ]
    });
    expect(initResult.entries).toHaveLength(1);

    const removed = await repo.updateEntryWithAudit({
      campaignId: campaign.campaign_id,
      referenceAssetId: asset.asset_id,
      expectedUpdatedAt: initResult.entries[0]!.updatedAt,
      next: null,
      change: {
        changeReason: "removed",
        sourceSceneId: scene.scene_id,
        sourceSpecRevision: 2,
        sourceBindingId: "binding-rem",
        actorKind: "director",
        actorId: "director-alice"
      }
    });

    expect(removed.referenceAssetId).toBe(asset.asset_id);

    // Active entry is retained in campaign_reference_bibles while changes preserves identity history
    const entries = await repo.findByCampaignId(campaign.campaign_id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.referenceAssetId).toBe(asset.asset_id);
    expect(entries[0]!.biblePromptTag).toBe("<Picture 1>");

    const assetEntry = await repo.findByCampaignAndAsset(campaign.campaign_id, asset.asset_id);
    expect(assetEntry).not.toBeNull();
    expect(assetEntry?.biblePromptTag).toBe("<Picture 1>");

    // Audit change record reflects removal
    let changes = await repo.listChanges(campaign.campaign_id, asset.asset_id);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.changeReason).toBe("removed");
    expect(changes[0]!.oldRole).toBe("subject_identity");
    expect(changes[0]!.newRole).toBeNull();
    expect(changes[0]!.oldBiblePromptTag).toBe("<Picture 1>");
    expect(changes[0]!.newBiblePromptTag).toBeNull();
    expect(changes[0]!.actorId).toBe("director-alice");

    // Re-addition restores the original stable tag
    const readded = await repo.updateEntryWithAudit({
      campaignId: campaign.campaign_id,
      referenceAssetId: asset.asset_id,
      expectedUpdatedAt: removed.updatedAt,
      next: {
        role: "subject_identity",
        description: "Protagonist restored",
        biblePromptTag: removed.biblePromptTag,
        sourceContentHashSha256: "r".repeat(64)
      },
      change: {
        changeReason: "added",
        sourceSceneId: scene.scene_id,
        sourceSpecRevision: 3,
        sourceBindingId: "binding-readd",
        actorKind: "director",
        actorId: "director-alice",
        oldRole: null,
        oldDescription: null,
        oldBiblePromptTag: null,
        oldSourceContentHashSha256: null
      }
    });

    expect(readded.biblePromptTag).toBe("<Picture 1>");

    changes = await repo.listChanges(campaign.campaign_id, asset.asset_id);
    expect(changes).toHaveLength(2);
    expect(changes[1]!.changeReason).toBe("added");
    expect(changes[1]!.oldRole).toBeNull();
    expect(changes[1]!.newRole).toBe("subject_identity");
    expect(changes[1]!.newBiblePromptTag).toBe("<Picture 1>");
  });
});
