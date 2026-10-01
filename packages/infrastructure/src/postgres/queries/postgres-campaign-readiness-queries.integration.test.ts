import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId } from "@cco/domain";
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
import { PostgresCampaignReadinessQueries } from "./postgres-campaign-readiness-queries.js";

const SIDE_EFFECT_TABLES = [
  "render_jobs",
  "production_attempts",
  "campaign_production_runs",
  "review_events",
  "delivery_assembly_jobs",
  "generation_manifests"
];

describe("PostgreSQL PostgresCampaignReadinessQueries Integration", () => {
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

  async function insertShotPlan(
    sceneId: string,
    specRevision: number,
    variantOrdinal: number,
    status: "draft" | "approved" | "superseded" | "rejected" = "draft"
  ): Promise<string> {
    const res = await client.query<{ shot_plan_id: string }>(
      `
      INSERT INTO shot_plans (
        scene_id, spec_revision, variant_ordinal, status, routing_mode,
        target_duration_ms, target_frame_count, framing, camera_angle,
        camera_movement, lighting_style, structured_plan
      ) VALUES (
        $1, $2, $3, $4, 'reference_directed',
        4000, 96, 'medium_close_up', 'eye_level',
        'dolly_in', 'neon_night',
        '{"movementSpeed": "slow", "actionSummary": "Hero raises visor", "beats": [], "subjects": []}'::jsonb
      ) RETURNING shot_plan_id
      `,
      [sceneId, specRevision, variantOrdinal, status]
    );
    return res.rows[0]!.shot_plan_id;
  }

  async function selectAndApprove(
    sceneId: string,
    shotPlanId: string,
    specRevision: number,
    { approve }: { approve: boolean }
  ): Promise<void> {
    await client.query(
      `UPDATE storyboard_scenes
       SET selected_shot_plan_id = $1::uuid, selected_shot_plan_revision = $2::integer,
           approved_shot_plan_id = CASE WHEN $3::boolean THEN $1::uuid ELSE NULL END,
           approved_shot_plan_revision = CASE WHEN $3::boolean THEN $2::integer ELSE NULL END
       WHERE scene_id = $4::uuid`,
      [shotPlanId, specRevision, approve, sceneId]
    );
  }

  async function snapshotSideEffectCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of SIDE_EFFECT_TABLES) {
      const res = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${table}`);
      counts[table] = Number(res.rows[0]!.count);
    }
    return counts;
  }

  it("projects a fully prepared scene as planning_ready", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Fully Prepared Campaign"
    });
    const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 1
    });
    const planId = await insertShotPlan(scene.scene_id, 1, 1, "approved");
    await selectAndApprove(scene.scene_id, planId, 1, { approve: true });

    const queries = new PostgresCampaignReadinessQueries(client);
    const model = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );

    expect(model).toBeDefined();
    expect(model!.scenes).toHaveLength(1);
    expect(model!.scenes[0]!.status).toBe("planning_ready");
    expect(model!.aggregates.planningReadyCount).toBe(1);
    expect(model!.aggregates.totalScenes).toBe(1);
  });

  it("reports NO_SHOT_PLAN_SELECTED when no selection exists, with correct drillDown", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "No Selection Campaign"
    });
    const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 1
    });
    await insertShotPlan(scene.scene_id, 1, 1, "draft");

    const queries = new PostgresCampaignReadinessQueries(client);
    const model = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );

    expect(model!.scenes[0]!.status).toBe("needs_attention");
    const blocker = model!.scenes[0]!.blockers.find((b) => b.code === "NO_SHOT_PLAN_SELECTED");
    expect(blocker).toBeDefined();
    expect(blocker!.drillDown).toEqual({
      sceneId: scene.scene_id,
      sceneOrder: 1,
      section: "shot-plans"
    });
  });

  it("marks a scene stale after a real reference-change revision bump, then planning_ready again once replanned and reselected", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Reference Change Campaign"
    });
    const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 1
    });
    const planId = await insertShotPlan(scene.scene_id, 1, 1, "approved");
    await selectAndApprove(scene.scene_id, planId, 1, { approve: true });

    const queries = new PostgresCampaignReadinessQueries(client);
    const before = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );
    expect(before!.scenes[0]!.status).toBe("planning_ready");

    // Reference change: bump spec_revision and null the selection/approval pointers in the
    // same statement, exactly as the CHECK constraints (storyboard_scene_selected_shot_plan_revision_current,
    // storyboard_scene_approved_shot_plan_revision_current) require.
    await client.query(
      `UPDATE storyboard_scenes
       SET spec_revision = 2,
           selected_shot_plan_id = NULL, selected_shot_plan_revision = NULL,
           approved_shot_plan_id = NULL, approved_shot_plan_revision = NULL
       WHERE scene_id = $1`,
      [scene.scene_id]
    );
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 2
    });

    const afterRevisionBump = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );
    expect(afterRevisionBump!.scenes[0]!.status).not.toBe("planning_ready");
    expect(afterRevisionBump!.scenes[0]!.staleness.isStaleAfterRevisionChange).toBe(true);
    const staleBlocker = afterRevisionBump!.scenes[0]!.blockers.find(
      (b) => b.code === "SHOT_PLAN_SELECTION_STALE"
    );
    expect(staleBlocker).toBeDefined();
    expect(afterRevisionBump!.aggregates.staleSceneCount).toBe(1);

    const newPlanId = await insertShotPlan(scene.scene_id, 2, 1, "approved");
    await selectAndApprove(scene.scene_id, newPlanId, 2, { approve: true });

    const afterReplan = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );
    expect(afterReplan!.scenes[0]!.status).toBe("planning_ready");
    expect(afterReplan!.scenes[0]!.staleness.isStaleAfterRevisionChange).toBe(false);
  });

  it("never reports planning_ready for a scene whose only ShotPlans are superseded", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Superseded Only Campaign"
    });
    const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 3
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 3
    });
    await insertShotPlan(scene.scene_id, 1, 1, "superseded");
    await insertShotPlan(scene.scene_id, 2, 1, "superseded");

    const queries = new PostgresCampaignReadinessQueries(client);
    const model = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );

    expect(model!.scenes[0]!.status).toBe("blocked_for_planning");
    const blocker = model!.scenes[0]!.blockers.find((b) => b.code === "NO_CURRENT_SHOT_PLANS");
    expect(blocker).toBeDefined();
    expect(model!.scenes[0]!.shotPlans.supersededCount).toBe(2);
  });

  it("flags an archived bound reference asset and a reference count over the H3 ceiling", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Archived Binding Campaign"
    });

    const archivedAsset = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      archivedAt: new Date()
    });
    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: archivedScene.scene_id,
      assetId: archivedAsset.asset_id,
      specRevision: 1
    });

    const overLimitScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      specRevision: 1
    });
    for (let i = 0; i < 10; i += 1) {
      const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
      await insertSceneReferenceAssetRecord(client, {
        sceneId: overLimitScene.scene_id,
        assetId: asset.asset_id,
        specRevision: 1,
        role: i === 0 ? "subject_identity" : "style"
      });
    }

    const queries = new PostgresCampaignReadinessQueries(client);
    const model = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );

    const archivedProjection = model!.scenes.find((s) => s.sceneId === archivedScene.scene_id)!;
    expect(archivedProjection.status).toBe("blocked_for_planning");
    expect(archivedProjection.blockers.some((b) => b.code === "ARCHIVED_REFERENCE_BINDING")).toBe(
      true
    );

    const overLimitProjection = model!.scenes.find((s) => s.sceneId === overLimitScene.scene_id)!;
    expect(overLimitProjection.status).toBe("blocked_for_planning");
    expect(overLimitProjection.blockers.some((b) => b.code === "REFERENCE_LIMIT_EXCEEDED")).toBe(
      true
    );
  });

  it("flags a cross-client bound reference asset", async () => {
    const clientRecord = await insertClientRecord(client);
    const otherClientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Cross Client Campaign"
    });
    const crossClientAsset = await insertReferenceAssetRecord(client, {
      clientId: otherClientRecord.client_id
    });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: crossClientAsset.asset_id,
      specRevision: 1
    });

    const queries = new PostgresCampaignReadinessQueries(client);
    const model = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );

    expect(model!.scenes[0]!.status).toBe("blocked_for_planning");
    expect(
      model!.scenes[0]!.blockers.some((b) => b.code === "CROSS_CLIENT_REFERENCE_BINDING")
    ).toBe(true);
  });

  it("flips a scene from needs_attention to planning_ready purely on an approval transition", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Approval Transition Campaign"
    });
    const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 1
    });
    const planId = await insertShotPlan(scene.scene_id, 1, 1, "draft");
    await selectAndApprove(scene.scene_id, planId, 1, { approve: false });

    const queries = new PostgresCampaignReadinessQueries(client);
    const beforeApproval = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );
    expect(beforeApproval!.scenes[0]!.status).toBe("needs_attention");
    expect(
      beforeApproval!.scenes[0]!.blockers.some((b) => b.code === "SHOT_PLAN_NOT_APPROVED")
    ).toBe(true);

    await client.query(
      `UPDATE storyboard_scenes
       SET approved_shot_plan_id = $1, approved_shot_plan_revision = 1
       WHERE scene_id = $2`,
      [planId, scene.scene_id]
    );

    const afterApproval = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );
    expect(afterApproval!.scenes[0]!.status).toBe("planning_ready");
  });

  it("causes zero writes to render/production/review/delivery tables", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Isolation Campaign"
    });
    const asset = await insertReferenceAssetRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene.scene_id,
      assetId: asset.asset_id,
      specRevision: 1
    });
    const planId = await insertShotPlan(scene.scene_id, 1, 1, "approved");
    await selectAndApprove(scene.scene_id, planId, 1, { approve: true });

    const before = await snapshotSideEffectCounts();

    const queries = new PostgresCampaignReadinessQueries(client);
    await queries.getCampaignPreProductionReadiness(campaign.campaign_id as CampaignId);
    await queries.getCampaignPreProductionReadiness(campaign.campaign_id as CampaignId);

    const after = await snapshotSideEffectCounts();
    expect(after).toEqual(before);
  });

  it("returns scenes in scene_order regardless of insertion order and excludes archived scenes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Ordering Campaign"
    });

    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      specRevision: 1
    });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      specRevision: 1
    });
    await client.query(
      `UPDATE storyboard_scenes SET archived_at = CURRENT_TIMESTAMP WHERE scene_id = $1`,
      [archivedScene.scene_id]
    );

    const queries = new PostgresCampaignReadinessQueries(client);
    const model = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );

    expect(model!.scenes).toHaveLength(2);
    expect(model!.scenes[0]!.sceneId).toBe(scene1.scene_id);
    expect(model!.scenes[1]!.sceneId).toBe(scene2.scene_id);
  });

  it("returns undefined when campaign is not found or is archived", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Archived Campaign"
    });
    await client.query(
      `UPDATE campaigns SET archived_at = CURRENT_TIMESTAMP WHERE campaign_id = $1`,
      [campaign.campaign_id]
    );

    const queries = new PostgresCampaignReadinessQueries(client);
    const result = await queries.getCampaignPreProductionReadiness(
      campaign.campaign_id as CampaignId
    );
    expect(result).toBeUndefined();
  });
});
