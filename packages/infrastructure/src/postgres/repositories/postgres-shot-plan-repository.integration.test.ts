import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { ShotPlan, type CandidateId, type SceneId, type ShotPlanId } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertStoryboardCandidateRecord
} from "../test-support/records.js";
import { PostgresShotPlanRepository } from "./postgres-shot-plan-repository.js";
import { PostgresSceneRepository } from "./postgres-scene-repository.js";

describe("PostgreSQL ShotPlanRepository Adapter Integration", () => {
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

  function createTestShotPlan(overrides: {
    id?: ShotPlanId;
    sceneId: SceneId;
    specRevision?: number;
    variantOrdinal?: number;
    status?: "draft" | "approved" | "superseded" | "rejected";
    previsCandidateId?: CandidateId;
  }): ShotPlan {
    const specRevision = overrides.specRevision ?? 1;
    const variantOrdinal = overrides.variantOrdinal ?? 1;
    return ShotPlan.create({
      id: overrides.id ?? ("01928374-abcd-7000-8000-000000000010" as ShotPlanId),
      sceneId: overrides.sceneId,
      specRevision,
      variantOrdinal,
      status: overrides.status ?? "draft",
      routingMode: "reference_directed",
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "35mm prime",
      cameraPosition: "eye level center",
      cameraMovement: "tracking",
      movementSpeed: "slow",
      cameraPromptDescription: "Wide tracking shot of futuristic terminal",
      actionSummary: "Commuters move through transit hall",
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 2000,
          description: "Establish bustling transit area",
          cameraAction: "slow track forward",
          subjectAction: "crowd traverses frame"
        },
        {
          beatIndex: 2,
          startMs: 2000,
          endMs: 4000,
          description: "Hero turns toward gates",
          cameraAction: "pan left slightly",
          subjectAction: "hero emerges from crowd"
        }
      ],
      lightingStyle: "high_key_commercial",
      environmentDescription: "Sleek glass terminal with neon signage",
      colorPalette: ["#112233", "#445566"],
      ...(overrides.previsCandidateId !== undefined
        ? {
            previs: {
              candidateId: overrides.previsCandidateId,
              storageBucket: "cco-previs",
              storageObjectKey: `previs/${overrides.sceneId}/${overrides.previsCandidateId}.webp`,
              contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              modelProfile: "storyboard-fast",
              generatedAt: new Date().toISOString()
            }
          }
        : {})
    });
  }

  it("persists and retrieves a ShotPlan with complete structured intent and previs association", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      specRevision: 1
    });
    const candidateRecord = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const repo = new PostgresShotPlanRepository(client);
    const shotPlan = createTestShotPlan({
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      previsCandidateId: candidateRecord.candidate_id as CandidateId
    });

    await repo.save(shotPlan);

    const retrieved = await repo.findById(shotPlan.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(shotPlan.id);
    expect(retrieved!.sceneId).toBe(sceneRecord.scene_id);
    expect(retrieved!.specRevision).toBe(1);
    expect(retrieved!.variantOrdinal).toBe(1);
    expect(retrieved!.status).toBe("draft");
    expect(retrieved!.framing).toBe("wide");
    expect(retrieved!.beats).toHaveLength(2);
    expect(retrieved!.beats[0]?.description).toBe("Establish bustling transit area");
    expect(retrieved!.previs?.candidateId).toBe(candidateRecord.candidate_id);
  });

  it("enforces composite foreign key on previs candidate (candidate_id, scene_id, spec_revision)", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      specRevision: 1
    });

    // Candidate belongs to scene2
    const candidateOfScene2 = await insertStoryboardCandidateRecord(client, {
      sceneId: scene2.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const repo = new PostgresShotPlanRepository(client);

    // Attempting to attach candidate of scene2 to shot plan of scene1 must fail with FK error
    const crossScenePlan = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000021" as ShotPlanId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      previsCandidateId: candidateOfScene2.candidate_id as CandidateId
    });

    await expect(repo.save(crossScenePlan)).rejects.toThrow();
  });

  it("enforces unique (scene_id, spec_revision, variant_ordinal) constraint", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      specRevision: 1
    });

    const repo = new PostgresShotPlanRepository(client);

    const planA = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000031" as ShotPlanId,
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1
    });
    await repo.save(planA);

    // Plan B has a different ID but same scene, revision, and variantOrdinal
    const planB = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000032" as ShotPlanId,
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1
    });

    await expect(repo.save(planB)).rejects.toThrow();
  });

  it("persists non-colliding variant ordinals across rerolls on the same spec_revision", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      specRevision: 1
    });

    const repo = new PostgresShotPlanRepository(client);

    // First batch: ordinals 1, 2, 3
    const batch1 = [1, 2, 3].map((ordinal) =>
      createTestShotPlan({
        id: `01928374-abcd-7000-8000-00000000004${ordinal}` as ShotPlanId,
        sceneId: sceneRecord.scene_id as SceneId,
        specRevision: 1,
        variantOrdinal: ordinal,
        status: "superseded"
      })
    );
    await repo.saveMany(batch1);

    // Reroll batch on same revision: ordinals 4, 5, 6
    const batch2 = [4, 5, 6].map((ordinal) =>
      createTestShotPlan({
        id: `01928374-abcd-7000-8000-00000000005${ordinal}` as ShotPlanId,
        sceneId: sceneRecord.scene_id as SceneId,
        specRevision: 1,
        variantOrdinal: ordinal,
        status: "draft"
      })
    );
    await repo.saveMany(batch2);

    const allPlans = await repo.listBySceneAndRevision(sceneRecord.scene_id as SceneId, 1);
    expect(allPlans).toHaveLength(6);
    expect(allPlans.map((p) => p.variantOrdinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("preserves historical candidates immutability alongside ShotPlans", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      specRevision: 1
    });

    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "cco-media",
      storageObjectKey: "storyboard/legacy_1.webp"
    });

    const repo = new PostgresShotPlanRepository(client);
    const plan = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000061" as ShotPlanId,
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      previsCandidateId: candidate.candidate_id as CandidateId
    });
    await repo.save(plan);

    // Verify candidate row is untouched in database
    const candidateQuery = await client.query(
      `SELECT * FROM storyboard_candidates WHERE candidate_id = $1`,
      [candidate.candidate_id]
    );
    expect(candidateQuery.rows).toHaveLength(1);
    expect(candidateQuery.rows[0]?.storage_object_key).toBe("storyboard/legacy_1.webp");
  });

  it("lists all shot plans across revisions ordered by revision and ordinal", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      specRevision: 2
    });

    const repo = new PostgresShotPlanRepository(client);

    const planRev1 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000071" as ShotPlanId,
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      status: "superseded"
    });
    const planRev2Var1 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000072" as ShotPlanId,
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 2,
      variantOrdinal: 1,
      status: "draft"
    });
    const planRev2Var2 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000073" as ShotPlanId,
      sceneId: sceneRecord.scene_id as SceneId,
      specRevision: 2,
      variantOrdinal: 2,
      status: "draft"
    });

    await repo.saveMany([planRev2Var2, planRev1, planRev2Var1]);

    const all = await repo.listByScene(sceneRecord.scene_id as SceneId);
    expect(all).toHaveLength(3);
    expect(all[0]?.specRevision).toBe(1);
    expect(all[0]?.variantOrdinal).toBe(1);
    expect(all[1]?.specRevision).toBe(2);
    expect(all[1]?.variantOrdinal).toBe(1);
    expect(all[2]?.specRevision).toBe(2);
    expect(all[2]?.variantOrdinal).toBe(2);
  });

  it("enforces storyboard_scenes selection fencing check constraints and foreign key", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      specRevision: 1
    });

    const repo = new PostgresShotPlanRepository(client);
    const planScene1 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000081" as ShotPlanId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1
    });
    const planScene2 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000082" as ShotPlanId,
      sceneId: scene2.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1
    });
    await repo.saveMany([planScene1, planScene2]);

    // 1. Selection pair constraint: id without revision fails
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET selected_shot_plan_id = $1, selected_shot_plan_revision = NULL WHERE scene_id = $2`,
        [planScene1.id, scene1.scene_id]
      )
    ).rejects.toThrow(/storyboard_scene_shot_plan_selection_pair/);

    // 2. Selection pair constraint: revision without id fails
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET selected_shot_plan_id = NULL, selected_shot_plan_revision = 1 WHERE scene_id = $1`,
        [scene1.scene_id]
      )
    ).rejects.toThrow(/storyboard_scene_shot_plan_selection_pair/);

    // 3. Selection revision must match scene current spec_revision
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET selected_shot_plan_id = $1, selected_shot_plan_revision = 2 WHERE scene_id = $2`,
        [planScene1.id, scene1.scene_id]
      )
    ).rejects.toThrow(/storyboard_scene_selected_shot_plan_revision_current/);

    // 4. Cross-scene selection violates composite foreign key (fk_scene_selected_shot_plan_revision)
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET selected_shot_plan_id = $1, selected_shot_plan_revision = 1 WHERE scene_id = $2`,
        [planScene2.id, scene1.scene_id]
      )
    ).rejects.toThrow(/fk_scene_selected_shot_plan_revision/);

    // 5. Non-existent shot plan ID violates composite foreign key
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET selected_shot_plan_id = $1, selected_shot_plan_revision = 1 WHERE scene_id = $2`,
        ["01928374-abcd-7000-8000-000000000099", scene1.scene_id]
      )
    ).rejects.toThrow(/fk_scene_selected_shot_plan_revision/);

    // 6. Valid selection succeeds
    await client.query(
      `UPDATE storyboard_scenes SET selected_shot_plan_id = $1, selected_shot_plan_revision = 1 WHERE scene_id = $2`,
      [planScene1.id, scene1.scene_id]
    );
    const updated = await client.query(
      `SELECT selected_shot_plan_id, selected_shot_plan_revision FROM storyboard_scenes WHERE scene_id = $1`,
      [scene1.scene_id]
    );
    expect(updated.rows[0]?.selected_shot_plan_id).toBe(planScene1.id);
    expect(updated.rows[0]?.selected_shot_plan_revision).toBe(1);
  });

  it("enforces storyboard_scenes approval fencing check constraints and foreign key", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      specRevision: 1
    });

    const repo = new PostgresShotPlanRepository(client);
    const planScene1 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000083" as ShotPlanId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1
    });
    const planScene2 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000084" as ShotPlanId,
      sceneId: scene2.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1
    });
    await repo.saveMany([planScene1, planScene2]);

    // 1. Approval pair constraint: id without revision fails
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET approved_shot_plan_id = $1, approved_shot_plan_revision = NULL WHERE scene_id = $2`,
        [planScene1.id, scene1.scene_id]
      )
    ).rejects.toThrow(/storyboard_scene_shot_plan_approval_pair/);

    // 2. Approval pair constraint: revision without id fails
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET approved_shot_plan_id = NULL, approved_shot_plan_revision = 1 WHERE scene_id = $1`,
        [scene1.scene_id]
      )
    ).rejects.toThrow(/storyboard_scene_shot_plan_approval_pair/);

    // 3. Approval revision must match scene current spec_revision
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET approved_shot_plan_id = $1, approved_shot_plan_revision = 2 WHERE scene_id = $2`,
        [planScene1.id, scene1.scene_id]
      )
    ).rejects.toThrow(/storyboard_scene_approved_shot_plan_revision_current/);

    // 4. Cross-scene approval violates composite foreign key (fk_scene_approved_shot_plan_revision)
    await expect(
      client.query(
        `UPDATE storyboard_scenes SET approved_shot_plan_id = $1, approved_shot_plan_revision = 1 WHERE scene_id = $2`,
        [planScene2.id, scene1.scene_id]
      )
    ).rejects.toThrow(/fk_scene_approved_shot_plan_revision/);

    // 5. Valid approval succeeds
    await client.query(
      `UPDATE storyboard_scenes SET approved_shot_plan_id = $1, approved_shot_plan_revision = 1 WHERE scene_id = $2`,
      [planScene1.id, scene1.scene_id]
    );
    const updated = await client.query(
      `SELECT approved_shot_plan_id, approved_shot_plan_revision FROM storyboard_scenes WHERE scene_id = $1`,
      [scene1.scene_id]
    );
    expect(updated.rows[0]?.approved_shot_plan_id).toBe(planScene1.id);
    expect(updated.rows[0]?.approved_shot_plan_revision).toBe(1);
  });

  it("persists selection and approval through PostgresSceneRepository and clears them on spec mutation", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      specRevision: 1,
      status: "draft_pending"
    });

    const sceneRepo = new PostgresSceneRepository(client);
    const shotPlanRepo = new PostgresShotPlanRepository(client);

    // Load reconstituted scene and transition to director_review
    const scene = await sceneRepo.findById(sceneRecord.scene_id as SceneId);
    expect(scene).toBeDefined();
    scene!.beginCandidateGeneration();
    scene!.submitCandidatesForReview();
    await sceneRepo.save(scene!);

    // Create and save ShotPlan for rev 1
    const shotPlanRev1 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000085" as ShotPlanId,
      sceneId: scene!.id,
      specRevision: 1,
      variantOrdinal: 1
    });
    await shotPlanRepo.save(shotPlanRev1);

    // Select shot plan on scene
    scene!.selectShotPlan(shotPlanRev1.id, 1, scene!.id);
    await sceneRepo.save(scene!);

    // Verify selection reconstituted from Postgres
    const afterSelect = await sceneRepo.findById(scene!.id);
    expect(afterSelect?.selectedShotPlanId).toBe(shotPlanRev1.id);
    expect(afterSelect?.selectedShotPlanRevision).toBe(1);

    // Approve shot plan on scene
    scene!.approveShotPlan({
      shotPlanId: shotPlanRev1.id,
      shotPlanRevision: 1,
      shotPlanSceneId: scene!.id,
      approvedBy: "director-test",
      approvedAt: "2026-09-25T12:00:00.000Z"
    });
    await sceneRepo.save(scene!);

    // Verify approval reconstituted from Postgres
    const afterApprove = await sceneRepo.findById(scene!.id);
    expect(afterApprove?.status).toBe("approved");
    expect(afterApprove?.approvedShotPlanId).toBe(shotPlanRev1.id);
    expect(afterApprove?.approvedShotPlanRevision).toBe(1);

    // Mutate scene spec configuration (updatePrompt)
    scene!.updatePrompt("New mutated prompt for rev 2");
    expect(scene!.specRevision).toBe(2);
    expect(scene!.selectedShotPlanId).toBeUndefined();
    expect(scene!.selectedShotPlanRevision).toBeUndefined();
    expect(scene!.approvedShotPlanId).toBeUndefined();
    expect(scene!.approvedShotPlanRevision).toBeUndefined();

    // Persist mutated scene to Postgres
    await sceneRepo.save(scene!);

    // Verify reconstituted scene has cleared selection/approval and incremented revision
    const afterMutation = await sceneRepo.findById(scene!.id);
    expect(afterMutation?.specRevision).toBe(2);
    expect(afterMutation?.status).toBe("director_review");
    expect(afterMutation?.selectedShotPlanId).toBeUndefined();
    expect(afterMutation?.selectedShotPlanRevision).toBeUndefined();
    expect(afterMutation?.approvedShotPlanId).toBeUndefined();
    expect(afterMutation?.approvedShotPlanRevision).toBeUndefined();

    // Verify database check constraint fails closed if someone attempts to increment spec_revision
    // while leaving stale selected_shot_plan_revision
    const shotPlanRev2 = createTestShotPlan({
      id: "01928374-abcd-7000-8000-000000000086" as ShotPlanId,
      sceneId: scene!.id,
      specRevision: 2,
      variantOrdinal: 1
    });
    await shotPlanRepo.save(shotPlanRev2);

    await client.query(
      `UPDATE storyboard_scenes
       SET selected_shot_plan_id = $1, selected_shot_plan_revision = 2
       WHERE scene_id = $2`,
      [shotPlanRev2.id, scene!.id]
    );

    // Incrementing spec_revision to 3 without clearing/updating selected_shot_plan_revision must violate check constraint
    await expect(
      client.query(`UPDATE storyboard_scenes SET spec_revision = 3 WHERE scene_id = $1`, [
        scene!.id
      ])
    ).rejects.toThrow(/storyboard_scene_selected_shot_plan_revision_current/);
  });
});
