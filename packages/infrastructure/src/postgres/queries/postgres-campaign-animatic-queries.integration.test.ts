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
  insertStoryboardSceneRecord
} from "../test-support/records.js";
import { PostgresCampaignAnimaticQueries } from "./postgres-campaign-animatic-queries.js";

describe("PostgreSQL PostgresCampaignAnimaticQueries Integration", () => {
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

  it("projects campaign animatic in canonical scene order with exact selection, gap handling, and approval status", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Hero Campaign Animatic"
    });

    // Insert scenes out of order: scene 2 first, then scene 1, then scene 3
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      durationSeconds: 3.0,
      status: "director_review",
      specRevision: 1
    });

    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "approved",
      specRevision: 1
    });

    const scene3 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      durationSeconds: 5.0,
      status: "director_review",
      specRevision: 2 // Revision 2 without selection -> gap!
    });

    // Insert shot plan for scene 1 (approved)
    const plan1Res = await client.query<{ shot_plan_id: string }>(
      `
      INSERT INTO shot_plans (
        scene_id, spec_revision, variant_ordinal, status, routing_mode,
        target_duration_ms, target_frame_count, framing, camera_angle,
        camera_movement, lighting_style, structured_plan
      ) VALUES (
        $1, 1, 1, 'approved', 'reference_directed',
        4000, 96, 'medium_close_up', 'eye_level',
        'dolly_in', 'neon_night',
        '{"movementSpeed": "slow", "actionSummary": "Hero raises visor", "beats": [], "subjects": []}'::jsonb
      ) RETURNING shot_plan_id
      `,
      [scene1.scene_id]
    );
    const plan1Id = plan1Res.rows[0]!.shot_plan_id;

    // Link scene 1 to plan1
    await client.query(
      `UPDATE storyboard_scenes
       SET selected_shot_plan_id = $1, selected_shot_plan_revision = 1, approved_shot_plan_id = $1, approved_shot_plan_revision = 1
       WHERE scene_id = $2`,
      [plan1Id, scene1.scene_id]
    );

    // Insert shot plan for scene 2 (draft)
    const plan2Res = await client.query<{ shot_plan_id: string }>(
      `
      INSERT INTO shot_plans (
        scene_id, spec_revision, variant_ordinal, status, routing_mode,
        target_duration_ms, target_frame_count, framing, camera_angle,
        camera_movement, lighting_style, structured_plan
      ) VALUES (
        $1, 1, 1, 'draft', 'reference_directed',
        3000, 72, 'wide', 'low_angle',
        'pan_left', 'golden_hour',
        '{"movementSpeed": "medium", "actionSummary": "City street wide", "beats": [], "subjects": []}'::jsonb
      ) RETURNING shot_plan_id
      `,
      [scene2.scene_id]
    );
    const plan2Id = plan2Res.rows[0]!.shot_plan_id;

    // Link scene 2 to plan2
    await client.query(
      `UPDATE storyboard_scenes
       SET selected_shot_plan_id = $1, selected_shot_plan_revision = 1
       WHERE scene_id = $2`,
      [plan2Id, scene2.scene_id]
    );

    // Scene 3 has no selected shot plan

    const queryAdapter = new PostgresCampaignAnimaticQueries(client);
    const animatic = await queryAdapter.getCampaignAnimatic(campaign.campaign_id as CampaignId);

    expect(animatic).toBeDefined();
    expect(animatic?.campaignId).toBe(campaign.campaign_id);
    expect(animatic?.campaignName).toBe("Hero Campaign Animatic");
    expect(animatic?.totalScenes).toBe(3);
    expect(animatic?.gapCount).toBe(1);
    expect(animatic?.approvedShotCount).toBe(1);
    expect(animatic?.draftShotCount).toBe(1);

    // Check canonical ordering: Scene 1, then Scene 2, then Scene 3
    const seg1 = animatic!.segments[0]!;
    expect(seg1.sceneOrder).toBe(1);
    expect(seg1.sceneId).toBe(scene1.scene_id);
    expect(seg1.hasPlan).toBe(true);
    if (seg1.hasPlan) {
      expect(seg1.shotPlanId).toBe(plan1Id);
      expect(seg1.approvalStatus).toBe("approved");
      expect(seg1.startMs).toBe(0);
      expect(seg1.endMs).toBe(4000);
    }

    const seg2 = animatic!.segments[1]!;
    expect(seg2.sceneOrder).toBe(2);
    expect(seg2.sceneId).toBe(scene2.scene_id);
    expect(seg2.hasPlan).toBe(true);
    if (seg2.hasPlan) {
      expect(seg2.shotPlanId).toBe(plan2Id);
      expect(seg2.approvalStatus).toBe("draft");
      expect(seg2.startMs).toBe(4000);
      expect(seg2.endMs).toBe(7000);
    }

    const seg3 = animatic!.segments[2]!;
    expect(seg3.sceneOrder).toBe(3);
    expect(seg3.sceneId).toBe(scene3.scene_id);
    expect(seg3.hasPlan).toBe(false);
    if (!seg3.hasPlan) {
      expect(seg3.gapReason).toBe("NO_SELECTION");
      expect(seg3.startMs).toBe(7000);
      expect(seg3.endMs).toBe(12000);
      expect(seg3.targetDurationMs).toBe(5000);
    }

    expect(animatic?.totalDurationMs).toBe(12000);
    expect(animatic?.includedShotPlanDurationMs).toBe(7000);
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

    const queryAdapter = new PostgresCampaignAnimaticQueries(client);
    const result = await queryAdapter.getCampaignAnimatic(campaign.campaign_id as CampaignId);
    expect(result).toBeUndefined();
  });
});
