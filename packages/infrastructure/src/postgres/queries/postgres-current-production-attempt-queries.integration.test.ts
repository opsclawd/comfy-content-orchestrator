import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId, SceneId } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertRenderJobRecord,
  insertGenerationManifestRecord
} from "../test-support/records.js";
import { PostgresCampaignProductionRunRepository } from "../repositories/postgres-campaign-production-run-repository.js";
import { PostgresCurrentProductionAttemptQueries } from "./postgres-current-production-attempt-queries.js";

describe("PostgresCurrentProductionAttemptQueries Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);
  const validSha = "a".repeat(64);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN;");
    await runMigrations(client, { migrationsDirectory });
    return async () => {
      await client.query("ROLLBACK;");
      client.release();
    };
  });

  it("resolves current production attempt with available and reviewReady true when in qa", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      status: "qa"
    });

    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      status: "completed",
      retryCount: 0
    });

    await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id,
      renderAttempt: 1,
      manifestPayload: {
        renderProfile: "LTX_25_720P_5S_V1",
        renderAttempt: 1,
        outputs: [
          {
            bucket: "prod-bucket",
            key: "prod/video.mp4",
            checksumSha256: validSha,
            contentType: "video/mp4"
          }
        ]
      }
    });

    const runsRepo = new PostgresCampaignProductionRunRepository(client);
    const { run } = await runsRepo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_query_test_1",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    await runsRepo.insertRunScenes(run.id, [
      {
        runId: run.id,
        sceneId: scene.scene_id as SceneId,
        specRevision: 2,
        sequenceIndex: 1,
        expectedDurationMs: 5000,
        productionJobId: job.job_id
      }
    ]);

    const queries = new PostgresCurrentProductionAttemptQueries(client);
    const attempt = await queries.getCurrentProductionAttempt({
      campaignId: campaign.campaign_id as CampaignId,
      runId: run.id,
      sceneId: scene.scene_id as SceneId
    });

    expect(attempt).toBeDefined();
    expect(attempt!.runId).toBe(run.id);
    expect(attempt!.sceneId).toBe(scene.scene_id);
    expect(attempt!.specRevision).toBe(2);
    expect(attempt!.attemptOrdinal).toBe(1);
    expect(attempt!.productionJobId).toBe(job.job_id);
    expect(attempt!.technicalState).toBe("completed");
    expect(attempt!.reviewReady).toBe(true);
    expect(attempt!.availability).toBe("available");
    expect(attempt!.media).toEqual({
      generationManifestId: expect.any(String),
      ref: {
        bucket: "prod-bucket",
        key: "prod/video.mp4",
        sha256: validSha,
        contentType: "video/mp4"
      }
    });
  });

  it("returns unavailable when production job is not yet completed", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      status: "rendering"
    });

    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      status: "rendering",
      retryCount: 0
    });

    const runsRepo = new PostgresCampaignProductionRunRepository(client);
    const { run } = await runsRepo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_query_test_2",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    await runsRepo.insertRunScenes(run.id, [
      {
        runId: run.id,
        sceneId: scene.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 5000,
        productionJobId: job.job_id
      }
    ]);

    const queries = new PostgresCurrentProductionAttemptQueries(client);
    const attempt = await queries.getCurrentProductionAttempt({
      campaignId: campaign.campaign_id as CampaignId,
      runId: run.id,
      sceneId: scene.scene_id as SceneId
    });

    expect(attempt).toBeDefined();
    expect(attempt!.availability).toBe("unavailable");
    expect(attempt!.technicalState).toBe("rendering");
    expect(attempt!.reviewReady).toBe(false);
    expect(attempt!.media).toBeUndefined();
  });

  it("returns missing_manifest when job completed but no manifest exists", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      status: "qa"
    });

    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      status: "completed",
      retryCount: 0
    });

    const runsRepo = new PostgresCampaignProductionRunRepository(client);
    const { run } = await runsRepo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_query_test_3",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    await runsRepo.insertRunScenes(run.id, [
      {
        runId: run.id,
        sceneId: scene.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 5000,
        productionJobId: job.job_id
      }
    ]);

    const queries = new PostgresCurrentProductionAttemptQueries(client);
    const attempt = await queries.getCurrentProductionAttempt({
      campaignId: campaign.campaign_id as CampaignId,
      runId: run.id,
      sceneId: scene.scene_id as SceneId
    });

    expect(attempt).toBeDefined();
    expect(attempt!.availability).toBe("missing_manifest");
    expect(attempt!.technicalState).toBe("completed");
    expect(attempt!.reviewReady).toBe(false);
  });

  it("fails closed (returns undefined) for wrong campaign or scene pairing", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign1 = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const campaign2 = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign1.campaign_id,
      status: "qa"
    });

    const runsRepo = new PostgresCampaignProductionRunRepository(client);
    const { run } = await runsRepo.createIfAbsent({
      campaignId: campaign1.campaign_id as CampaignId,
      fingerprint: "fp_query_test_4",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    await runsRepo.insertRunScenes(run.id, [
      {
        runId: run.id,
        sceneId: scene1.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 5000
      }
    ]);

    const queries = new PostgresCurrentProductionAttemptQueries(client);

    // Wrong campaign ID
    const wrongCampaign = await queries.getCurrentProductionAttempt({
      campaignId: campaign2.campaign_id as CampaignId,
      runId: run.id,
      sceneId: scene1.scene_id as SceneId
    });
    expect(wrongCampaign).toBeUndefined();

    // Wrong scene ID
    const wrongScene = await queries.getCurrentProductionAttempt({
      campaignId: campaign1.campaign_id as CampaignId,
      runId: run.id,
      sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c999999" as SceneId
    });
    expect(wrongScene).toBeUndefined();
  });
});
