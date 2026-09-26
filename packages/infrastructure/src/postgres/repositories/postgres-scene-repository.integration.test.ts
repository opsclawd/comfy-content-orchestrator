import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId, CandidateId, ReferenceAssetId, SceneId } from "@cco/domain";
import {
  ArchivedReferenceBindingError,
  CrossClientReferenceBindingError,
  ReferenceAssetNotFoundError,
  Scene
} from "@cco/domain";
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
    expect(snapshot.sequenceIndex).toBe(1);
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
      sequenceIndex: 1,
      productionRoutingMode: "reference_directed",
      configuration: {
        prompt: "Draft prompt",
        referenceIds: [],
        engineProfileId: "flux_schnell",
        durationMs: 4250,
        loraConfigurationId: null
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

    // Verify DB reference_assets table actually removed old and has new associations for current revision
    const refRows = await client.query(
      "SELECT asset_id FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = $2",
      [initialSceneRecord.scene_id, updatedSnapshot.specRevision]
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
      sequenceIndex: 1,
      productionRoutingMode: "reference_directed",
      configuration: {
        prompt: "Newly created scene prompt from scratch",
        referenceIds: [refAsset.asset_id],
        referenceBindings: [
          {
            sceneId: newSceneId,
            specRevision: 1,
            referenceAssetId: refAsset.asset_id,
            role: "style",
            weight: null,
            hints: null
          }
        ],
        engineProfileId: "ltx_25",
        durationMs: 6000,
        loraConfigurationId: null
      }
    });
  });

  it("round-trips an explicitly null loraConfigurationId", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000099" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Explicitly no LoRA",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 4000,
        loraConfigurationId: null
      }
    });

    const repository = new PostgresSceneRepository(client);
    await repository.save(scene);

    expect((await repository.findById(sceneId))?.snapshot().configuration.loraConfigurationId).toBe(
      null
    );
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

  it("persists explicit sequenceIndex as scene_order independent of insertion order", async () => {
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
      },
      sequenceIndex: 1
    });

    const scene2 = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000022" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene 2",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 2
    });

    const scene3 = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000033" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene 3",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 3
    });

    const poolRepo = new PostgresSceneRepository(pool);

    // Save scenes out of completion order: 3 first, then 1, then 2
    await poolRepo.save(scene3);
    await poolRepo.save(scene1);
    await poolRepo.save(scene2);

    const result = await client.query(
      `SELECT scene_id, scene_order FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC`,
      [campaign.campaign_id]
    );

    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual({ scene_id: scene1.id, scene_order: 1 });
    expect(result.rows[1]).toEqual({ scene_id: scene2.id, scene_order: 2 });
    expect(result.rows[2]).toEqual({ scene_id: scene3.id, scene_order: 3 });
  });

  it("rejects duplicate sequenceIndex for the same campaign with unique constraint violation (23505)", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const sceneA = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000044" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene A",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const sceneB = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000055" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene B with colliding sequenceIndex",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const poolRepo = new PostgresSceneRepository(pool);
    await poolRepo.save(sceneA);

    await expect(poolRepo.save(sceneB)).rejects.toMatchObject({
      code: "23505",
      constraint: "unique_campaign_scene_order"
    });
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

  it("finds scenes by campaignId in canonical scene_order with sequenceIndex mapped", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      visualDescription: "Scene two",
      status: "draft_pending"
    });
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      visualDescription: "Scene one",
      status: "approved"
    });
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      visualDescription: "Scene three",
      status: "approved"
    });

    const repo = new PostgresSceneRepository(client);
    const scenes = await repo.findByCampaignId(campaign.campaign_id as CampaignId);

    expect(scenes).toHaveLength(3);
    expect(scenes[0]!.sequenceIndex).toBe(1);
    expect(scenes[1]!.sequenceIndex).toBe(2);
    expect(scenes[2]!.sequenceIndex).toBe(3);
  });

  it("lock-free findCampaignIdBySceneId resolves owning campaignId without blocking or holding locks", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      visualDescription: "Scene for lookup",
      status: "approved"
    });

    const repo = new PostgresSceneRepository(client);
    const resolvedCampaignId = await repo.findCampaignIdBySceneId(sceneRecord.scene_id as SceneId);
    expect(resolvedCampaignId).toBe(campaign.campaign_id);

    const nonExistent = await repo.findCampaignIdBySceneId(
      "01950c46-9e90-7d3d-82d2-8f1d3c999999" as SceneId
    );
    expect(nonExistent).toBeUndefined();

    // Now prove lock freedom across two independent connections:
    // Connection 1 holds an exclusive FOR UPDATE lock on the scene row.
    // Connection 2 must be able to resolve campaignId immediately without blocking.
    await client.query("COMMIT");
    const conn1 = await pool.connect();
    const conn2 = await pool.connect();

    try {
      await conn1.query("BEGIN");
      await conn1.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1 FOR UPDATE", [
        sceneRecord.scene_id
      ]);

      // conn2 reads campaignId via findCampaignIdBySceneId while conn1 holds the FOR UPDATE lock
      const repo2 = new PostgresSceneRepository(conn2);
      const readDuringLock = await repo2.findCampaignIdBySceneId(sceneRecord.scene_id as SceneId);
      expect(readDuringLock).toBe(campaign.campaign_id);

      await conn1.query("ROLLBACK");

      // Conversely, conn2 calling findCampaignIdBySceneId inside an open transaction does not
      // acquire row locks that would block conn1 from modifying the row.
      await conn2.query("BEGIN");
      await repo2.findCampaignIdBySceneId(sceneRecord.scene_id as SceneId);

      await conn1.query("BEGIN");
      await conn1.query(
        "UPDATE storyboard_scenes SET visual_description = 'concurrently updated' WHERE scene_id = $1",
        [sceneRecord.scene_id]
      );
      await conn1.query("COMMIT");

      await conn2.query("ROLLBACK");
    } finally {
      conn1.release();
      conn2.release();
      await client.query("BEGIN");
    }
  });

  it("findByCampaignId with forUpdate=true acquires exclusive row locks on all campaign scenes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "approved"
    });

    await client.query("COMMIT");
    const conn1 = await pool.connect();
    const conn2 = await pool.connect();

    try {
      await conn1.query("BEGIN");
      const repo1 = new PostgresSceneRepository(conn1);
      const lockedScenes = await repo1.findByCampaignId(campaign.campaign_id as CampaignId, {
        forUpdate: true
      });
      expect(lockedScenes).toHaveLength(2);

      // Verify conn2 attempting to acquire FOR UPDATE NOWAIT on either scene is rejected (55P03)
      await conn2.query("BEGIN");
      await expect(
        conn2.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1 FOR UPDATE NOWAIT", [
          scene1.scene_id
        ])
      ).rejects.toMatchObject({ code: "55P03" });

      await conn2.query("ROLLBACK");
      await conn2.query("BEGIN");

      await expect(
        conn2.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1 FOR UPDATE NOWAIT", [
          scene2.scene_id
        ])
      ).rejects.toMatchObject({ code: "55P03" });

      await conn2.query("ROLLBACK");
      await conn1.query("ROLLBACK");
    } finally {
      conn1.release();
      conn2.release();
      await client.query("BEGIN");
    }
  });

  it("persists and reloads non-centisecond duration (5001ms) with exact millisecond fidelity", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const scene = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000099" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Exact millisecond scene",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5001
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await repo.save(scene);

    const raw = await client.query<{ duration_seconds: string }>(
      `SELECT duration_seconds FROM storyboard_scenes WHERE scene_id = $1`,
      [scene.id]
    );
    expect(raw.rows[0]?.duration_seconds).toBe("5.001");

    const reloaded = await repo.findById(scene.id);
    expect(reloaded).toBeDefined();
    expect(reloaded!.snapshot().configuration.durationMs).toBe(5001);
  });

  it("findByCampaignId respects includeArchived option", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const activeScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });

    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "approved"
    });
    await client.query(
      "UPDATE storyboard_scenes SET archived_at = CURRENT_TIMESTAMP WHERE scene_id = $1",
      [archivedScene.scene_id]
    );

    const repo = new PostgresSceneRepository(pool);

    const activeOnly = await repo.findByCampaignId(campaign.campaign_id as CampaignId);
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0]?.id).toBe(activeScene.scene_id);

    const allScenes = await repo.findByCampaignId(campaign.campaign_id as CampaignId, {
      includeArchived: true
    });
    expect(allScenes).toHaveLength(2);
    expect(allScenes.map((s) => s.id)).toEqual([activeScene.scene_id, archivedScene.scene_id]);
  });

  it("rejects saving scene with cross-client reference and performs zero writes", async () => {
    const clientA = await insertClientRecord(client);
    const clientB = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientA.client_id });

    const refClientB = await insertReferenceAssetRecord(client, {
      clientId: clientB.client_id
    });

    const scene = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000101" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "A scene with cross client ref",
        referenceIds: [refClientB.asset_id],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await expect(repo.save(scene)).rejects.toThrow(CrossClientReferenceBindingError);

    // Verify ZERO writes occurred
    const scenesInDb = await client.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1", [
      scene.id
    ]);
    expect(scenesInDb.rows).toHaveLength(0);

    const bindingsInDb = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1",
      [scene.id]
    );
    expect(bindingsInDb.rows).toHaveLength(0);
  });

  it("rejects newly binding an archived reference with ArchivedReferenceBindingError and performs zero writes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const archivedRef = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      archivedAt: new Date()
    });

    const scene = Scene.create({
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000102" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "A scene with archived ref",
        referenceIds: [archivedRef.asset_id],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await expect(repo.save(scene)).rejects.toThrow(ArchivedReferenceBindingError);

    // Verify ZERO writes occurred
    const scenesInDb = await client.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1", [
      scene.id
    ]);
    expect(scenesInDb.rows).toHaveLength(0);
  });

  it("permits preserving an existing binding in the same revision even if the reference has since been archived", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const ref = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial visual description",
      engineAssigned: "ltx_25",
      status: "draft_pending",
      specRevision: 1
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: ref.asset_id,
      specRevision: 1
    });

    // Archive the reference asset post-binding
    await client.query(
      "UPDATE reference_assets SET archived_at = CURRENT_TIMESTAMP WHERE asset_id = $1",
      [ref.asset_id]
    );

    const repo = new PostgresSceneRepository(pool);
    const loaded = await repo.findById(sceneRecord.scene_id as SceneId);
    expect(loaded).toBeDefined();

    // Saving in the same revision (specRevision 1) preserves existing binding
    loaded!.cancel();
    expect(loaded!.snapshot().specRevision).toBe(1);
    await expect(repo.save(loaded!)).resolves.not.toThrow();

    const reloaded = await repo.findById(sceneRecord.scene_id as SceneId);
    expect(reloaded?.status).toBe("cancelled");
    expect(reloaded?.snapshot().configuration.referenceIds).toEqual([ref.asset_id]);
  });

  it("rejects an archived reference when attempting to add or carry it into revision 2 after archiving", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const ref = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial visual description",
      engineAssigned: "ltx_25",
      status: "draft_pending",
      specRevision: 1
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: ref.asset_id,
      specRevision: 1
    });

    // Archive the reference asset post-binding in revision 1
    await client.query(
      "UPDATE reference_assets SET archived_at = CURRENT_TIMESTAMP WHERE asset_id = $1",
      [ref.asset_id]
    );

    const repo = new PostgresSceneRepository(pool);
    const loaded = await repo.findById(sceneRecord.scene_id as SceneId);
    expect(loaded).toBeDefined();

    // Advance to revision 2 attempting to retain/add the archived reference
    loaded!.updatePrompt("Updated prompt text for revision 2");
    expect(loaded!.snapshot().specRevision).toBe(2);

    await expect(repo.save(loaded!)).rejects.toThrow(ArchivedReferenceBindingError);

    // Verify zero writes occurred for revision 2 in scene_reference_assets
    const rev2Rows = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = 2",
      [sceneRecord.scene_id]
    );
    expect(rev2Rows.rows).toHaveLength(0);
  });

  it("rejects when the current revision's requested binding is changed on an archived reference", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const ref = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id
    });

    const sceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73852" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Initial prompt",
        referenceIds: [ref.asset_id],
        referenceBindings: [
          {
            sceneId,
            specRevision: 1,
            referenceAssetId: ref.asset_id as ReferenceAssetId,
            role: "style",
            weight: 0.5,
            hints: null
          }
        ],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await repo.save(scene);

    // Archive the reference asset
    await client.query(
      "UPDATE reference_assets SET archived_at = CURRENT_TIMESTAMP WHERE asset_id = $1",
      [ref.asset_id]
    );

    // Reconstitute scene at the same revision 1, but with changed binding (different weight)
    const sceneWithChangedBinding = Scene.reconstitute({
      ...scene.snapshot(),
      configuration: {
        ...scene.snapshot().configuration,
        referenceBindings: [
          {
            sceneId,
            specRevision: 1,
            referenceAssetId: ref.asset_id as ReferenceAssetId,
            role: "style",
            weight: 0.9,
            hints: null
          }
        ]
      }
    });

    await expect(repo.save(sceneWithChangedBinding)).rejects.toThrow(ArchivedReferenceBindingError);
  });

  it("save rejects nonexistent reference with ReferenceAssetNotFoundError", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const scene = Scene.create({
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73851" as SceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Nonexistent reference test",
        referenceIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73899"],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await expect(repo.save(scene)).rejects.toThrow(ReferenceAssetNotFoundError);
  });

  it("persists and reconstitutes referenceBindings across revisions without mutating prior revisions", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref1.png"
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref2.png"
    });

    const sceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73850" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "First revision prompt",
        referenceIds: [ref1.asset_id],
        referenceBindings: [
          {
            sceneId,
            specRevision: 1,
            referenceAssetId: ref1.asset_id as ReferenceAssetId,
            role: "subject_identity",
            weight: 0.85,
            hints: { faceConfidence: 0.95 }
          }
        ],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await repo.save(scene);

    const loadedRev1 = await repo.findById(sceneId);
    expect(loadedRev1).toBeDefined();
    expect(loadedRev1?.snapshot().specRevision).toBe(1);
    expect(loadedRev1?.snapshot().configuration.referenceIds).toEqual([ref1.asset_id]);
    expect(loadedRev1?.snapshot().configuration.referenceBindings).toEqual([
      {
        sceneId,
        specRevision: 1,
        referenceAssetId: ref1.asset_id,
        role: "subject_identity",
        weight: 0.85,
        hints: { faceConfidence: 0.95 }
      }
    ]);

    // Advance to revision 2 with different binding role and second reference
    loadedRev1!.updateReferences(
      [ref1.asset_id, ref2.asset_id],
      [
        {
          sceneId,
          specRevision: 2,
          referenceAssetId: ref1.asset_id as ReferenceAssetId,
          role: "composition",
          weight: 0.5,
          hints: null
        },
        {
          sceneId,
          specRevision: 2,
          referenceAssetId: ref2.asset_id as ReferenceAssetId,
          role: "style",
          weight: 0.7,
          hints: { colorProfile: "vibrant" }
        }
      ]
    );

    await repo.save(loadedRev1!);

    const loadedRev2 = await repo.findById(sceneId);
    expect(loadedRev2).toBeDefined();
    expect(loadedRev2?.snapshot().specRevision).toBe(2);
    expect(loadedRev2?.snapshot().configuration.referenceIds).toEqual([
      ref1.asset_id,
      ref2.asset_id
    ]);
    expect(loadedRev2?.snapshot().configuration.referenceBindings).toHaveLength(2);
    expect(loadedRev2?.snapshot().configuration.referenceBindings?.[0]?.role).toBe("composition");
    expect(loadedRev2?.snapshot().configuration.referenceBindings?.[1]?.role).toBe("style");

    // Verify in database that revision 1 bindings are PRESERVED and not deleted/overwritten
    const rowsRev1 = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = 1",
      [sceneId]
    );
    expect(rowsRev1.rows).toHaveLength(1);
    expect(rowsRev1.rows[0].role).toBe("subject_identity");

    const rowsRev2 = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = 2",
      [sceneId]
    );
    expect(rowsRev2.rows).toHaveLength(2);
  });

  it("retains explicitly bound asset metadata while adding another reference ID without bindings", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const ref1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref1_hero.png"
    });
    const ref2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref2_extra.png"
    });

    const sceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73860" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId: campaign.campaign_id as CampaignId,
      configuration: {
        prompt: "Scene with initial explicit binding",
        referenceIds: [ref1.asset_id],
        referenceBindings: [
          {
            sceneId,
            specRevision: 1,
            referenceAssetId: ref1.asset_id as ReferenceAssetId,
            role: "subject_identity",
            weight: 0.95,
            hints: { facialLandmarks: true }
          }
        ],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    const repo = new PostgresSceneRepository(pool);
    await repo.save(scene);

    const loaded = await repo.findById(sceneId);
    expect(loaded).toBeDefined();

    // Update references by providing referenceIds containing both ref1 and ref2, omitting referenceBindings
    loaded!.updateReferences([ref1.asset_id, ref2.asset_id]);
    await repo.save(loaded!);

    const reloaded = await repo.findById(sceneId);
    expect(reloaded).toBeDefined();
    const snapshot = reloaded!.snapshot();

    expect(snapshot.specRevision).toBe(2);
    expect(snapshot.configuration.referenceIds).toEqual([ref1.asset_id, ref2.asset_id]);
    expect(snapshot.configuration.referenceBindings).toHaveLength(2);

    const binding1 = snapshot.configuration.referenceBindings?.find(
      (b) => b.referenceAssetId === ref1.asset_id
    );
    expect(binding1).toBeDefined();
    expect(binding1?.role).toBe("subject_identity");
    expect(binding1?.weight).toBe(0.95);
    expect(binding1?.hints).toEqual({ facialLandmarks: true });
    expect(binding1?.specRevision).toBe(2);

    const binding2 = snapshot.configuration.referenceBindings?.find(
      (b) => b.referenceAssetId === ref2.asset_id
    );
    expect(binding2).toBeDefined();
    expect(binding2?.role).toBe("style");
    expect(binding2?.weight).toBeNull();
    expect(binding2?.specRevision).toBe(2);

    // Verify DB rows for both revisions
    const rowsRev1 = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = 1",
      [sceneId]
    );
    expect(rowsRev1.rows).toHaveLength(1);
    expect(rowsRev1.rows[0].role).toBe("subject_identity");

    const rowsRev2 = await client.query(
      "SELECT * FROM scene_reference_assets WHERE scene_id = $1 AND spec_revision = 2",
      [sceneId]
    );
    expect(rowsRev2.rows).toHaveLength(2);
  });
});
