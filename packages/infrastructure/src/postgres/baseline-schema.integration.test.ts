import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { SCENE_STATUSES, REVIEW_ACTIONS } from "@cco/contracts";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import {
  insertRepresentativeGraph,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertReferenceAssetRecord,
  insertSceneReferenceAssetRecord,
  insertRenderJobRecord,
  insertGenerationManifestRecord
} from "./test-support/records.js";

describe("PostgreSQL 18.6 baseline schema integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../migrations/", import.meta.url);

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
    // Clean up public schema between tests
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });

  it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
    const applied = await runMigrations(client, { migrationsDirectory });

    expect(applied).toHaveLength(1);
    expect(applied[0]?.version).toBe("001");

    const schemaRes = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version ASC"
    );
    expect(schemaRes.rows).toEqual([{ version: "001" }]);

    const tablesRes = await client.query<{ table_name: string }>(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name ASC
      `
    );

    const tableNames = tablesRes.rows.map((r) => r.table_name);
    expect(tableNames).toEqual([
      "campaigns",
      "clients",
      "generation_manifests",
      "license_registry",
      "reference_assets",
      "render_jobs",
      "review_events",
      "scene_reference_assets",
      "schema_migrations",
      "storyboard_scenes"
    ]);
  });

  it("stores exactly the canonical scene job campaign license and review enum labels", async () => {
    await runMigrations(client, { migrationsDirectory });

    const enumRes = await client.query<{
      typname: string;
      enumlabel: string;
      enumsortorder: number;
    }>(
      `
      SELECT t.typname, e.enumlabel, e.enumsortorder
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder
      `
    );

    const enumsByType = new Map<string, string[]>();
    for (const row of enumRes.rows) {
      const list = enumsByType.get(row.typname) ?? [];
      list.push(row.enumlabel);
      enumsByType.set(row.typname, list);
    }

    // license_status_enum
    expect(enumsByType.get("license_status_enum")).toEqual([
      "approved",
      "restricted",
      "blocked",
      "review_required"
    ]);

    // campaign_status_enum
    expect(enumsByType.get("campaign_status_enum")).toEqual([
      "drafting",
      "pending_director_review",
      "partially_approved",
      "queued",
      "rendering",
      "qa",
      "completed",
      "failed",
      "cancelled"
    ]);

    // scene_status_enum matching @cco/contracts SCENE_STATUSES
    expect(enumsByType.get("scene_status_enum")).toEqual([...SCENE_STATUSES]);

    // job_status_enum
    expect(enumsByType.get("job_status_enum")).toEqual([
      "queued",
      "leased",
      "rendering",
      "completed",
      "failed",
      "cancelled"
    ]);

    // review_action_enum matching @cco/contracts REVIEW_ACTIONS
    expect(enumsByType.get("review_action_enum")).toEqual([...REVIEW_ACTIONS]);
  });

  it("generates version 7 UUID primary keys without uuid-ossp", async () => {
    await runMigrations(client, { migrationsDirectory });

    const extensionRes = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'uuid-ossp'"
    );
    expect(extensionRes.rows).toHaveLength(0);

    const graph = await insertRepresentativeGraph(client);

    const clientUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(client_id) as v FROM clients WHERE client_id = $1",
      [graph.client.client_id]
    );
    expect(clientUuidVersion.rows[0]?.v).toBe(7);

    const assetUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(asset_id) as v FROM reference_assets WHERE asset_id = $1",
      [graph.referenceAsset.asset_id]
    );
    expect(assetUuidVersion.rows[0]?.v).toBe(7);

    const campaignUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(campaign_id) as v FROM campaigns WHERE campaign_id = $1",
      [graph.campaign.campaign_id]
    );
    expect(campaignUuidVersion.rows[0]?.v).toBe(7);

    const sceneUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(scene_id) as v FROM storyboard_scenes WHERE scene_id = $1",
      [graph.scene.scene_id]
    );
    expect(sceneUuidVersion.rows[0]?.v).toBe(7);

    const jobUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(job_id) as v FROM render_jobs WHERE job_id = $1",
      [graph.renderJob.job_id]
    );
    expect(jobUuidVersion.rows[0]?.v).toBe(7);

    const manifestUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(manifest_id) as v FROM generation_manifests WHERE manifest_id = $1",
      [graph.manifest.manifest_id]
    );
    expect(manifestUuidVersion.rows[0]?.v).toBe(7);

    const eventUuidVersion = await client.query<{ v: number }>(
      "SELECT uuid_extract_version(event_id) as v FROM review_events WHERE event_id = $1",
      [graph.reviewEvent.event_id]
    );
    expect(eventUuidVersion.rows[0]?.v).toBe(7);
  });

  it("inserts and reads a representative client campaign scene reference job manifest and review event graph", async () => {
    await runMigrations(client, { migrationsDirectory });

    const graph = await insertRepresentativeGraph(client);

    // Verify license_registry
    const licenseRes = await client.query(
      "SELECT * FROM license_registry WHERE component_key = $1",
      [graph.license.component_key]
    );
    expect(licenseRes.rows).toHaveLength(1);
    expect(licenseRes.rows[0]?.component_key).toBe("ltx-2.5-distilled");
    expect(licenseRes.rows[0]?.license_name).toBe("LTX-2 Community License");
    expect(licenseRes.rows[0]?.status).toBe("approved");

    // Verify clients
    const clientRes = await client.query("SELECT * FROM clients WHERE client_id = $1", [
      graph.client.client_id
    ]);
    expect(clientRes.rows).toHaveLength(1);
    expect(clientRes.rows[0]?.company_name).toBe("Godzspeed Communications Inc.");
    expect(clientRes.rows[0]?.default_aspect_ratio).toBe("9:16");

    // Verify reference_assets
    const refRes = await client.query("SELECT * FROM reference_assets WHERE asset_id = $1", [
      graph.referenceAsset.asset_id
    ]);
    expect(refRes.rows).toHaveLength(1);
    expect(refRes.rows[0]?.client_id).toBe(graph.client.client_id);
    expect(refRes.rows[0]?.storage_bucket).toBe("godzspeed-reference");
    expect(Number(refRes.rows[0]?.default_strength)).toBeCloseTo(0.85);

    // Verify campaigns
    const campaignRes = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      graph.campaign.campaign_id
    ]);
    expect(campaignRes.rows).toHaveLength(1);
    expect(campaignRes.rows[0]?.client_id).toBe(graph.client.client_id);
    expect(campaignRes.rows[0]?.title).toBe("Carnival Season 2026");
    expect(campaignRes.rows[0]?.status).toBe("drafting");
    expect(campaignRes.rows[0]?.total_scenes).toBe(6);

    // Verify storyboard_scenes
    const sceneRes = await client.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1", [
      graph.scene.scene_id
    ]);
    expect(sceneRes.rows).toHaveLength(1);
    expect(sceneRes.rows[0]?.campaign_id).toBe(graph.campaign.campaign_id);
    expect(sceneRes.rows[0]?.scene_order).toBe(1);
    expect(Number(sceneRes.rows[0]?.duration_seconds)).toBeCloseTo(5.0);
    expect(sceneRes.rows[0]?.status).toBe("draft_pending");

    // Verify scene_reference_assets
    const assocRes = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1 AND asset_id = $2",
      [graph.scene.scene_id, graph.referenceAsset.asset_id]
    );
    expect(assocRes.rows).toHaveLength(1);
    expect(Number(assocRes.rows[0]?.override_strength)).toBeCloseTo(0.9);

    // Verify render_jobs
    const jobRes = await client.query("SELECT * FROM render_jobs WHERE job_id = $1", [
      graph.renderJob.job_id
    ]);
    expect(jobRes.rows).toHaveLength(1);
    expect(jobRes.rows[0]?.scene_id).toBe(graph.scene.scene_id);
    expect(jobRes.rows[0]?.status).toBe("queued");
    expect(jobRes.rows[0]?.retry_count).toBe(0);
    expect(jobRes.rows[0]?.max_retries).toBe(3);

    // Verify generation_manifests
    const manifestRes = await client.query(
      "SELECT * FROM generation_manifests WHERE manifest_id = $1",
      [graph.manifest.manifest_id]
    );
    expect(manifestRes.rows).toHaveLength(1);
    expect(manifestRes.rows[0]?.job_id).toBe(graph.renderJob.job_id);
    expect(manifestRes.rows[0]?.scene_id).toBe(graph.scene.scene_id);
    expect(manifestRes.rows[0]?.campaign_id).toBe(graph.campaign.campaign_id);
    expect(manifestRes.rows[0]?.render_attempt).toBe(1);

    // Verify review_events
    const eventRes = await client.query("SELECT * FROM review_events WHERE event_id = $1", [
      graph.reviewEvent.event_id
    ]);
    expect(eventRes.rows).toHaveLength(1);
    expect(eventRes.rows[0]?.scene_id).toBe(graph.scene.scene_id);
    expect(eventRes.rows[0]?.reviewer_name).toBe("Thomas Cumberbatch");
    expect(eventRes.rows[0]?.action).toBe("approve");
  });

  it("rejects invalid strengths durations retry counts duplicate scene order and invalid enum values", async () => {
    await runMigrations(client, { migrationsDirectory });

    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, { campaignId: campaign.campaign_id, sceneOrder: 1 });
    const asset = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageBucket: "godzspeed-reference",
      storageObjectKey: "brand/logo.png"
    });

    // 1. Invalid default_strength on reference_assets (> 1 or < 0)
    await expect(
      insertReferenceAssetRecord(client, {
        clientId: clientRecord.client_id,
        storageBucket: "godzspeed-reference",
        storageObjectKey: "brand/invalid1.png",
        defaultStrength: 1.05
      })
    ).rejects.toThrow();

    await expect(
      insertReferenceAssetRecord(client, {
        clientId: clientRecord.client_id,
        storageBucket: "godzspeed-reference",
        storageObjectKey: "brand/invalid2.png",
        defaultStrength: -0.1
      })
    ).rejects.toThrow();

    // 2. Invalid override_strength on scene_reference_assets (> 1 or < 0)
    await expect(
      insertSceneReferenceAssetRecord(client, {
        sceneId: scene.scene_id,
        assetId: asset.asset_id,
        overrideStrength: 1.5
      })
    ).rejects.toThrow();

    await expect(
      insertSceneReferenceAssetRecord(client, {
        sceneId: scene.scene_id,
        assetId: asset.asset_id,
        overrideStrength: -0.01
      })
    ).rejects.toThrow();

    // 3. Invalid campaign total_scenes (<= 0) and approved_scenes (< 0)
    await expect(
      insertCampaignRecord(client, {
        clientId: clientRecord.client_id,
        totalScenes: 0
      })
    ).rejects.toThrow();

    await expect(
      insertCampaignRecord(client, {
        clientId: clientRecord.client_id,
        approvedScenes: -1
      })
    ).rejects.toThrow();

    // 4. Invalid storyboard_scene scene_order (<= 0) and duration_seconds (<= 0)
    await expect(
      insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: 0
      })
    ).rejects.toThrow();

    await expect(
      insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: 2,
        durationSeconds: 0
      })
    ).rejects.toThrow();

    await expect(
      insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: 2,
        durationSeconds: -5.0
      })
    ).rejects.toThrow();

    // 5. Invalid render_jobs retry_count (< 0) or retry_count > max_retries
    await expect(
      insertRenderJobRecord(client, {
        sceneId: scene.scene_id,
        retryCount: -1
      })
    ).rejects.toThrow();

    await expect(
      insertRenderJobRecord(client, {
        sceneId: scene.scene_id,
        retryCount: 4,
        maxRetries: 3
      })
    ).rejects.toThrow();

    // 6. Invalid generation_manifests render_attempt (<= 0)
    const job = await insertRenderJobRecord(client, { sceneId: scene.scene_id });
    await expect(
      insertGenerationManifestRecord(client, {
        jobId: job.job_id,
        campaignId: campaign.campaign_id,
        sceneId: scene.scene_id,
        renderAttempt: 0
      })
    ).rejects.toThrow();

    // 7. Duplicate (storage_bucket, storage_object_key) on reference_assets
    await expect(
      insertReferenceAssetRecord(client, {
        clientId: clientRecord.client_id,
        storageBucket: "godzspeed-reference",
        storageObjectKey: "brand/logo.png"
      })
    ).rejects.toThrow();

    // 8. Duplicate scene_order on same campaign (unique_campaign_scene_order)
    await expect(
      insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: 1
      })
    ).rejects.toThrow();

    // 9. Duplicate job_id on generation_manifests (UNIQUE)
    await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id
    });
    await expect(
      insertGenerationManifestRecord(client, {
        jobId: job.job_id,
        campaignId: campaign.campaign_id,
        sceneId: scene.scene_id
      })
    ).rejects.toThrow();

    // 10. Invalid enum value
    await expect(
      client.query(
        "INSERT INTO storyboard_scenes (campaign_id, scene_order, shot_type, visual_description, status) VALUES ($1, $2, $3, $4, $5)",
        [campaign.campaign_id, 99, "wide", "test", "invalid_status_enum_val"]
      )
    ).rejects.toThrow();
  });

  it("creates the required partial unique and lookup indexes", async () => {
    await runMigrations(client, { migrationsDirectory });

    const indexRes = await client.query<{
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      `
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY indexname ASC
      `
    );

    const indexMap = new Map<string, { tablename: string; indexdef: string }>();
    for (const row of indexRes.rows) {
      indexMap.set(row.indexname, { tablename: row.tablename, indexdef: row.indexdef });
    }

    // 1. idx_reference_assets_client
    const idxRef = indexMap.get("idx_reference_assets_client");
    expect(idxRef).toBeDefined();
    expect(idxRef?.tablename).toBe("reference_assets");
    expect(idxRef?.indexdef).toContain("(client_id, asset_type)");
    expect(idxRef?.indexdef).toContain("WHERE (archived_at IS NULL)");

    // 2. idx_campaigns_client_status
    const idxCamp = indexMap.get("idx_campaigns_client_status");
    expect(idxCamp).toBeDefined();
    expect(idxCamp?.tablename).toBe("campaigns");
    expect(idxCamp?.indexdef).toContain("(client_id, status)");
    expect(idxCamp?.indexdef).toContain("WHERE (archived_at IS NULL)");

    // 3. idx_storyboard_scenes_campaign
    const idxScene = indexMap.get("idx_storyboard_scenes_campaign");
    expect(idxScene).toBeDefined();
    expect(idxScene?.tablename).toBe("storyboard_scenes");
    expect(idxScene?.indexdef).toContain("(campaign_id, status)");
    expect(idxScene?.indexdef).toContain("WHERE (archived_at IS NULL)");

    // 4. idx_render_jobs_queue
    const idxQueue = indexMap.get("idx_render_jobs_queue");
    expect(idxQueue).toBeDefined();
    expect(idxQueue?.tablename).toBe("render_jobs");
    expect(idxQueue?.indexdef).toContain("(status, lease_expires_at)");
    expect(idxQueue?.indexdef).toMatch(/WHERE.*queued.*leased/);

    // 5. idx_render_jobs_scene
    const idxJobScene = indexMap.get("idx_render_jobs_scene");
    expect(idxJobScene).toBeDefined();
    expect(idxJobScene?.tablename).toBe("render_jobs");
    expect(idxJobScene?.indexdef).toContain("(scene_id, created_at DESC)");

    // 6. idx_manifests_scene_attempt
    const idxManifest = indexMap.get("idx_manifests_scene_attempt");
    expect(idxManifest).toBeDefined();
    expect(idxManifest?.tablename).toBe("generation_manifests");
    expect(idxManifest?.indexdef).toContain("(scene_id, render_attempt)");

    // 7. idx_review_events_scene
    const idxReview = indexMap.get("idx_review_events_scene");
    expect(idxReview).toBeDefined();
    expect(idxReview?.tablename).toBe("review_events");
    expect(idxReview?.indexdef).toContain("(scene_id, created_at DESC)");
  });
});
