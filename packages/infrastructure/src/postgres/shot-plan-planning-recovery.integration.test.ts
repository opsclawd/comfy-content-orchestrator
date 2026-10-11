import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord
} from "./test-support/records.js";
import {
  recoverInterruptedPlanningRuns,
  DEFAULT_PLANNING_INTERRUPTED_REASON
} from "./shot-plan-planning-recovery.js";

describe("Shot-plan planning recovery integration", () => {
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
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  it("recovers expired planning runs to failed, clears planning markers, and persists failure reason", async () => {
    const clientRec = await insertClientRecord(client);
    const campaignRec = await insertCampaignRecord(client, { clientId: clientRec.client_id });

    const expiredRunId = randomUUID();
    const expiredTimestamp = new Date(Date.now() - 60_000); // 1 minute in the past

    const activeRunId = randomUUID();
    const futureTimestamp = new Date(Date.now() + 600_000); // 10 minutes in the future

    // 1. Expired planning run
    const expiredScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaignRec.campaign_id,
      sceneOrder: 1,
      status: "generating_candidates",
      activePlanningRunId: expiredRunId,
      activePlanningExpiresAt: expiredTimestamp
    });

    // 2. Active planning run (peer instance or still valid)
    const activeScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaignRec.campaign_id,
      sceneOrder: 2,
      status: "generating_candidates",
      activePlanningRunId: activeRunId,
      activePlanningExpiresAt: futureTimestamp
    });

    // 3. Unrelated candidate generation (activePlanningRunId is null)
    const renderScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaignRec.campaign_id,
      sceneOrder: 3,
      status: "generating_candidates",
      activePlanningRunId: null,
      activePlanningExpiresAt: null
    });

    // 4. Draft pending scene
    const draftScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaignRec.campaign_id,
      sceneOrder: 4,
      status: "draft_pending"
    });

    // Execute recovery
    const recoveredIds = await recoverInterruptedPlanningRuns({
      pool,
      asOf: new Date()
    });

    // Only the expired planning scene should be recovered
    expect(recoveredIds).toEqual([expiredScene.scene_id]);

    // Verify expired scene transitioned to failed, markers cleared, and reason persisted
    const expiredRes = await client.query<{
      status: string;
      failed_from: string | null;
      failure_reason: string | null;
      active_planning_run_id: string | null;
      active_planning_expires_at: Date | null;
    }>(
      `SELECT status, failed_from, failure_reason, active_planning_run_id, active_planning_expires_at
       FROM storyboard_scenes WHERE scene_id = $1`,
      [expiredScene.scene_id]
    );
    expect(expiredRes.rows[0]).toEqual({
      status: "failed",
      failed_from: "generating_candidates",
      failure_reason: DEFAULT_PLANNING_INTERRUPTED_REASON,
      active_planning_run_id: null,
      active_planning_expires_at: null
    });

    // Verify active scene was untouched
    const activeRes = await client.query<{
      status: string;
      active_planning_run_id: string | null;
    }>(`SELECT status, active_planning_run_id FROM storyboard_scenes WHERE scene_id = $1`, [
      activeScene.scene_id
    ]);
    expect(activeRes.rows[0]?.status).toBe("generating_candidates");
    expect(activeRes.rows[0]?.active_planning_run_id).toBe(activeRunId);

    // Verify unrelated candidate generation was untouched
    const renderRes = await client.query<{
      status: string;
      active_planning_run_id: string | null;
    }>(`SELECT status, active_planning_run_id FROM storyboard_scenes WHERE scene_id = $1`, [
      renderScene.scene_id
    ]);
    expect(renderRes.rows[0]?.status).toBe("generating_candidates");
    expect(renderRes.rows[0]?.active_planning_run_id).toBeNull();

    // Verify draft scene was untouched
    const draftRes = await client.query<{ status: string }>(
      `SELECT status FROM storyboard_scenes WHERE scene_id = $1`,
      [draftScene.scene_id]
    );
    expect(draftRes.rows[0]?.status).toBe("draft_pending");

    // Verify idempotency: running recovery again recovers 0 rows
    const rerunIds = await recoverInterruptedPlanningRuns({
      pool,
      asOf: new Date()
    });
    expect(rerunIds).toEqual([]);
  });

  it("persists a custom failure reason when provided", async () => {
    const clientRec = await insertClientRecord(client);
    const campaignRec = await insertCampaignRecord(client, { clientId: clientRec.client_id });

    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaignRec.campaign_id,
      sceneOrder: 1,
      status: "generating_candidates",
      activePlanningRunId: randomUUID(),
      activePlanningExpiresAt: new Date(Date.now() - 30_000)
    });

    const customReason = "Node host preemption triggered coordinator eviction";
    const recovered = await recoverInterruptedPlanningRuns({
      pool,
      failureReason: customReason
    });

    expect(recovered).toEqual([scene.scene_id]);

    const res = await client.query<{ failure_reason: string | null }>(
      `SELECT failure_reason FROM storyboard_scenes WHERE scene_id = $1`,
      [scene.scene_id]
    );
    expect(res.rows[0]?.failure_reason).toBe(customReason);
  });
});
