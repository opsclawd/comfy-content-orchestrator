import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId, CandidateId, SceneId } from "@cco/domain";
import { Scene } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertReferenceAssetRecord,
  insertStoryboardSceneRecord,
  insertSceneReferenceAssetRecord,
  insertStoryboardCandidateRecord
} from "../test-support/records.js";
import { PostgresSceneRepository } from "./postgres-scene-repository.js";

describe("PostgreSQL SceneRepository Adapter Integration", () => {
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

  it("reconstitutes complete Scene aggregate with configuration, approval, and selection preserved", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const refAsset1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref1.png"
    });
    const refAsset2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref2.png"
    });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.5,
      visualDescription: "Vibrant Port of Spain street scene at dawn with steelpan players.",
      engineAssigned: "ltx_25",
      status: "approved",
      specRevision: 1,
      loraConfigurationId: "lora-carnival-v1"
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: refAsset1.asset_id
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: refAsset2.asset_id
    });

    const candidateRecord = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const approvedAtIso = "2026-08-16T14:00:00.000Z";
    await client.query(
      `
      UPDATE storyboard_scenes
      SET
        selected_candidate_id = $1,
        selected_candidate_revision = $2,
        approved_by = $3,
        approved_at = $4,
        approved_revision = $5
      WHERE scene_id = $6
      `,
      [
        candidateRecord.candidate_id,
        1,
        "Thomas Cumberbatch",
        approvedAtIso,
        1,
        sceneRecord.scene_id
      ]
    );

    const repository = new PostgresSceneRepository(client);
    const scene = await repository.findById(sceneRecord.scene_id as SceneId);

    expect(scene).toBeDefined();
    expect(scene).toBeInstanceOf(Scene);

    const snapshot = scene!.snapshot();
    expect(snapshot.id).toBe(sceneRecord.scene_id);
    expect(snapshot.campaignId).toBe(campaign.campaign_id);
    expect(snapshot.status).toBe("approved");
    expect(snapshot.specRevision).toBe(1);
    expect(snapshot.configuration.prompt).toBe(
      "Vibrant Port of Spain street scene at dawn with steelpan players."
    );
    expect(snapshot.configuration.engineProfileId).toBe("ltx_25");
    expect(snapshot.configuration.durationMs).toBe(5500);
    expect(snapshot.configuration.loraConfigurationId).toBe("lora-carnival-v1");
    expect(snapshot.configuration.referenceIds).toEqual(
      expect.arrayContaining([refAsset1.asset_id, refAsset2.asset_id])
    );
    expect(snapshot.configuration.referenceIds).toHaveLength(2);
    expect(snapshot.approval).toEqual({
      revision: 1,
      approvedBy: "Thomas Cumberbatch",
      approvedAt: new Date(approvedAtIso).toISOString()
    });
    expect(snapshot.selectedCandidateId).toBe(candidateRecord.candidate_id);
    expect(snapshot.selectedCandidateRevision).toBe(1);
    expect(snapshot.failedFrom).toBeUndefined();
  });

  it("returns undefined when sceneId is not found", async () => {
    const repository = new PostgresSceneRepository(client);
    const notFound = await repository.findById("01950c46-9e90-7d3d-82d2-8f1d3c999999" as SceneId);
    expect(notFound).toBeUndefined();
  });

  it("round-trips scenes in various statuses: draft_pending, failed, and qa", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    // 1. draft_pending scene
    const draftRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.25,
      visualDescription: "Draft prompt",
      engineAssigned: "flux_schnell",
      status: "draft_pending",
      specRevision: 1
    });

    const repo = new PostgresSceneRepository(client);
    const draftScene = await repo.findById(draftRecord.scene_id as SceneId);
    expect(draftScene).toBeDefined();
    expect(draftScene!.snapshot()).toEqual({
      id: draftRecord.scene_id,
      campaignId: campaign.campaign_id,
      status: "draft_pending",
      specRevision: 1,
      configuration: {
        prompt: "Draft prompt",
        referenceIds: [],
        engineProfileId: "flux_schnell",
        durationMs: 4250
      }
    });

    // 2. failed scene with failedFrom
    const failedRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      durationSeconds: 6.0,
      visualDescription: "Failed scene prompt",
      engineAssigned: "ltx_25",
      status: "failed",
      specRevision: 1,
      failedFrom: "rendering"
    });

    const failedScene = await repo.findById(failedRecord.scene_id as SceneId);
    expect(failedScene).toBeDefined();
    expect(failedScene!.snapshot().status).toBe("failed");
    expect(failedScene!.snapshot().failedFrom).toBe("rendering");

    // 3. qa scene
    const qaCandidate = await insertStoryboardCandidateRecord(client, {
      sceneId: draftRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const qaApprovedAt = "2026-08-16T16:30:00.000Z";
    await client.query(
      `
      UPDATE storyboard_scenes
      SET
        status = 'qa',
        selected_candidate_id = $1,
        selected_candidate_revision = 1,
        approved_by = 'Director Bob',
        approved_at = $2,
        approved_revision = 1
      WHERE scene_id = $3
      `,
      [qaCandidate.candidate_id, qaApprovedAt, draftRecord.scene_id]
    );

    const qaScene = await repo.findById(draftRecord.scene_id as SceneId);
    expect(qaScene).toBeDefined();
    const qaSnapshot = qaScene!.snapshot();
    expect(qaSnapshot.status).toBe("qa");
    expect(qaSnapshot.selectedCandidateId).toBe(qaCandidate.candidate_id);
    expect(qaSnapshot.selectedCandidateRevision).toBe(1);
    expect(qaSnapshot.approval?.approvedBy).toBe("Director Bob");
  });

  it("synchronizes scene updates and reference asset associations on save", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const refAsset1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref1.png"
    });
    const refAsset2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref2.png"
    });
    const refAsset3 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref3.png"
    });

    const initialSceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial description",
      engineAssigned: "ltx_25",
      status: "draft_pending",
      specRevision: 1
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: initialSceneRecord.scene_id,
      assetId: refAsset1.asset_id
    });

    const repo = new PostgresSceneRepository(client);
    const scene = await repo.findById(initialSceneRecord.scene_id as SceneId);
    expect(scene).toBeDefined();

    // Mutate configuration through domain methods
    scene!.updatePrompt("Updated prompt for director review");
    scene!.updateDuration(7500);
    scene!.updateLora("lora-style-sunset");
    scene!.updateReferences([refAsset2.asset_id, refAsset3.asset_id]);

    await repo.save(scene!);

    // Re-fetch and verify all updated fields & reference associations
    const updatedScene = await repo.findById(initialSceneRecord.scene_id as SceneId);
    expect(updatedScene).toBeDefined();
    const updatedSnapshot = updatedScene!.snapshot();

    expect(updatedSnapshot.specRevision).toBe(5); // 1 initial + 4 config updates
    expect(updatedSnapshot.configuration.prompt).toBe("Updated prompt for director review");
    expect(updatedSnapshot.configuration.durationMs).toBe(7500);
    expect(updatedSnapshot.configuration.loraConfigurationId).toBe("lora-style-sunset");
    expect(updatedSnapshot.configuration.referenceIds).toHaveLength(2);
    expect(updatedSnapshot.configuration.referenceIds).toEqual(
      expect.arrayContaining([refAsset2.asset_id, refAsset3.asset_id])
    );
    expect(updatedSnapshot.configuration.referenceIds).not.toContain(refAsset1.asset_id);

    // Verify DB reference_assets table actually removed old and has new associations
    const refRows = await client.query(
      "SELECT asset_id FROM scene_reference_assets WHERE scene_id = $1",
      [initialSceneRecord.scene_id]
    );
    const linkedAssetIds = refRows.rows.map((r: { asset_id: string }) => r.asset_id);
    expect(linkedAssetIds).toHaveLength(2);
    expect(linkedAssetIds).toContain(refAsset2.asset_id);
    expect(linkedAssetIds).toContain(refAsset3.asset_id);
    expect(linkedAssetIds).not.toContain(refAsset1.asset_id);
  });

  it("persists lifecycle transitions through candidate selection, approval, queueing, and failure", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "draft_pending",
      specRevision: 1
    });

    const repo = new PostgresSceneRepository(client);
    const scene = (await repo.findById(sceneRecord.scene_id as SceneId))!;

    // 1. draft_pending -> generating_candidates
    scene.beginCandidateGeneration();
    await repo.save(scene);

    let fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.status).toBe("generating_candidates");

    // 2. generating_candidates -> director_review
    scene.submitCandidatesForReview();
    await repo.save(scene);

    fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.status).toBe("director_review");

    // 3. Insert candidate and select candidate
    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    scene.selectCandidate(candidate.candidate_id as CandidateId, 1, scene.id);
    await repo.save(scene);

    fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.snapshot().selectedCandidateId).toBe(candidate.candidate_id);
    expect(fetched.snapshot().selectedCandidateRevision).toBe(1);

    // 4. Approve
    const approvedAt = "2026-08-16T17:00:00.000Z";
    scene.approve({ approvedBy: "Thomas Cumberbatch", approvedAt });
    await repo.save(scene);

    fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.status).toBe("approved");
    expect(fetched.snapshot().approval).toEqual({
      revision: 1,
      approvedBy: "Thomas Cumberbatch",
      approvedAt: new Date(approvedAt).toISOString()
    });

    // 5. Queue -> Render -> Fail
    scene.queueForProduction();
    await repo.save(scene);

    fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.status).toBe("queued");

    scene.startRendering();
    await repo.save(scene);

    fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.status).toBe("rendering");

    scene.fail();
    await repo.save(scene);

    fetched = (await repo.findById(sceneRecord.scene_id as SceneId))!;
    expect(fetched.status).toBe("failed");
    expect(fetched.snapshot().failedFrom).toBe("rendering");
  });

  it("executes SELECT ... FOR UPDATE when forUpdate option is specified", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review"
    });

    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");

      const repoWithLock = new PostgresSceneRepository(txClient, { forUpdate: true });
      const lockedScene = await repoWithLock.findById(sceneRecord.scene_id as SceneId);

      expect(lockedScene).toBeDefined();
      expect(lockedScene!.id).toBe(sceneRecord.scene_id);

      await txClient.query("COMMIT");
    } catch (err) {
      await txClient.query("ROLLBACK");
      throw err;
    } finally {
      txClient.release();
    }
  });

  it("inserts a newly created Scene aggregate from scratch on save", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const refAsset = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/new_ref.png"
    });

    const newSceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000088" as SceneId;
    const newScene = Scene.create({
      id: newSceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Newly created scene prompt from scratch",
        referenceIds: [refAsset.asset_id],
        engineProfileId: "ltx_25",
        durationMs: 6000
      }
    });

    const repo = new PostgresSceneRepository(client);
    await repo.save(newScene);

    const reconstituted = await repo.findById(newSceneId);
    expect(reconstituted).toBeDefined();
    expect(reconstituted!.snapshot()).toEqual({
      id: newSceneId,
      campaignId: campaign.campaign_id,
      status: "draft_pending",
      specRevision: 1,
      configuration: {
        prompt: "Newly created scene prompt from scratch",
        referenceIds: [refAsset.asset_id],
        engineProfileId: "ltx_25",
        durationMs: 6000
      }
    });
  });

  it("persists scene aggregate atomically when repository is initialized with a Pool", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const refAsset = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/pool_ref.png"
    });

    const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000077" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene saved with Pool instance",
        referenceIds: [refAsset.asset_id],
        engineProfileId: "ltx_25",
        durationMs: 4000
      }
    });

    const poolRepo = new PostgresSceneRepository(pool);
    await poolRepo.save(scene);

    const fetched = await poolRepo.findById(sceneId);
    expect(fetched).toBeDefined();
    expect(fetched!.snapshot().configuration.prompt).toBe("Scene saved with Pool instance");
    expect(fetched!.snapshot().configuration.referenceIds).toEqual([refAsset.asset_id]);
  });

  it("bulk inserts multiple scene reference assets in a single query", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/bulk1.png"
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/bulk2.png"
    });
    const ref3 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/bulk3.png"
    });

    const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000066" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Bulk references scene",
        referenceIds: [ref1.asset_id, ref2.asset_id, ref3.asset_id],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });

    const repo = new PostgresSceneRepository(client);
    await repo.save(scene);

    const fetched = await repo.findById(sceneId);
    expect(fetched).toBeDefined();
    expect(fetched!.snapshot().configuration.referenceIds).toHaveLength(3);
    expect(fetched!.snapshot().configuration.referenceIds).toEqual(
      expect.arrayContaining([ref1.asset_id, ref2.asset_id, ref3.asset_id])
    );
  });

  it("throws an error when findById is invoked with forUpdate: true on a Pool instance", async () => {
    const poolRepo = new PostgresSceneRepository(pool, { forUpdate: true });
    await expect(
      poolRepo.findById("01950c46-9e90-7d3d-82d2-8f1d3c000001" as SceneId)
    ).rejects.toThrow(/Cannot execute findById with forUpdate: true using a pg Pool instance/);

    const poolRepoDefault = new PostgresSceneRepository(pool);
    await expect(
      poolRepoDefault.findById("01950c46-9e90-7d3d-82d2-8f1d3c000001" as SceneId, {
        forUpdate: true
      })
    ).rejects.toThrow(/Cannot execute findById with forUpdate: true using a pg Pool instance/);
  });

  it("serializes concurrent scene insertions for the same campaign with unique scene_order", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const scene1 = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000011" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene 1",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });

    const scene2 = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000022" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene 2",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });

    const scene3 = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000033" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene 3",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });

    const poolRepo = new PostgresSceneRepository(pool);

    // Save all 3 scenes concurrently via connection pool
    await Promise.all([poolRepo.save(scene1), poolRepo.save(scene2), poolRepo.save(scene3)]);

    const result = await client.query(
      `SELECT scene_id, scene_order FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC`,
      [campaign.campaign_id]
    );

    expect(result.rows).toHaveLength(3);
    const orders = result.rows.map((r: { scene_order: number }) => r.scene_order);
    expect(orders).toEqual([1, 2, 3]);
  });

  it("executes findById with forUpdate: true followed by save without acquiring campaign lock", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "draft_pending",
      specRevision: 1
    });

    const txClient = await pool.connect();
    try {
      await txClient.query("BEGIN");

      const repo = new PostgresSceneRepository(txClient, { forUpdate: true });
      const lockedScene = await repo.findById(sceneRecord.scene_id as SceneId);
      expect(lockedScene).toBeDefined();

      lockedScene!.beginCandidateGeneration();
      await repo.save(lockedScene!);

      await txClient.query("COMMIT");

      const reFetched = await repo.findById(sceneRecord.scene_id as SceneId);
      expect(reFetched!.status).toBe("generating_candidates");
    } catch (err) {
      await txClient.query("ROLLBACK");
      throw err;
    } finally {
      txClient.release();
    }
  });
});
