import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId, SceneConfiguration } from "@cco/domain";
import {
  CANDIDATE_BATCH_SIZE,
  MaterializeStoryboardUseCase,
  ProgressSceneProductionUseCases,
  type OrderedSceneConfiguration,
  type ProgressSceneProductionInput,
  type UnitOfWorkContext
} from "@cco/application";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord, insertCampaignRecord } from "../test-support/records.js";
import { PostgresJobQueue } from "../repositories/postgres-job-queue.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";

describe("MaterializeStoryboardUseCase Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
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

  const createSceneConfigs = (count: number = 3): OrderedSceneConfiguration[] => {
    return Array.from({ length: count }, (_, i) => ({
      ordinal: i + 1,
      configuration: {
        prompt: `Scene description ${i + 1}`,
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: i === 0 ? 5001 : 5000 + i * 500,
        loraConfigurationId: i === 0 ? "lora-carnival-v1" : null
      } satisfies SceneConfiguration
    }));
  };

  it("materializes N scenes and candidate jobs atomically, preserving exact sequenceIndex and duration", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 3
    });

    const uow = new PostgresUnitOfWork(pool);
    const queue = new PostgresJobQueue(pool);
    const progressUseCases = new ProgressSceneProductionUseCases(uow, undefined, queue);
    const useCase = new MaterializeStoryboardUseCase(uow, progressUseCases);

    const configs = createSceneConfigs(3);
    const result = await useCase.execute({
      campaignId: campaign.campaign_id as CampaignId,
      scenes: configs
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0]!.configuration.durationMs).toBe(5001);

    // Verify raw PostgreSQL storyboard_scenes rows
    const sceneRows = await client.query<{
      scene_id: string;
      campaign_id: string;
      scene_order: number;
      duration_seconds: string;
      visual_description: string;
      status: string;
      spec_revision: number;
    }>(
      `SELECT scene_id, campaign_id, scene_order, duration_seconds, visual_description, status, spec_revision
       FROM storyboard_scenes
       WHERE campaign_id = $1
       ORDER BY scene_order ASC`,
      [campaign.campaign_id]
    );

    expect(sceneRows.rows).toHaveLength(3);
    expect(sceneRows.rows.map((r) => r.scene_order)).toEqual([1, 2, 3]);
    expect(sceneRows.rows.every((r) => r.status === "generating_candidates")).toBe(true);
    expect(sceneRows.rows.every((r) => r.spec_revision === 1)).toBe(true);

    // Check duration conversion fidelity (e.g. 5001ms -> "5.001", 5500ms -> "5.500", 6000ms -> "6.000")
    expect(parseFloat(sceneRows.rows[0]!.duration_seconds)).toBe(5.001);
    expect(sceneRows.rows[0]!.duration_seconds).toBe("5.001");
    expect(parseFloat(sceneRows.rows[1]!.duration_seconds)).toBe(5.5);
    expect(parseFloat(sceneRows.rows[2]!.duration_seconds)).toBe(6.0);

    // Verify raw PostgreSQL render_jobs rows
    const jobRows = await client.query<{
      job_id: string;
      scene_id: string;
      job_kind: string;
      status: string;
    }>(
      `SELECT job_id, scene_id, job_kind, status
       FROM render_jobs
       ORDER BY created_at ASC`
    );

    expect(jobRows.rows).toHaveLength(3 * CANDIDATE_BATCH_SIZE);
    expect(jobRows.rows.every((r) => r.job_kind === "candidate")).toBe(true);
    expect(jobRows.rows.every((r) => r.status === "queued")).toBe(true);

    // Idempotent replay: executing again returns existing scenes without inserting new rows
    const replayResult = await useCase.execute({
      campaignId: campaign.campaign_id as CampaignId,
      scenes: configs
    });

    expect(replayResult.isIdempotentReplay).toBe(true);
    expect(replayResult.scenes).toHaveLength(3);
    expect(replayResult.scenes.map((s) => s.id)).toEqual(result.scenes.map((s) => s.id));
    expect(replayResult.scenes[0]!.configuration.durationMs).toBe(5001);

    const recheckSceneRows = await client.query(
      `SELECT count(*)::int AS count FROM storyboard_scenes WHERE campaign_id = $1`,
      [campaign.campaign_id]
    );
    expect(recheckSceneRows.rows[0]?.count).toBe(3);

    const recheckJobRows = await client.query(`SELECT count(*)::int AS count FROM render_jobs`);
    expect(recheckJobRows.rows[0]?.count).toBe(3 * CANDIDATE_BATCH_SIZE);
  });

  it("serializes concurrent executions on the same campaign shell so exactly one executes and one replays", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 3
    });

    const uow = new PostgresUnitOfWork(pool);
    const queue = new PostgresJobQueue(pool);
    const progressUseCases = new ProgressSceneProductionUseCases(uow, undefined, queue);
    const useCase = new MaterializeStoryboardUseCase(uow, progressUseCases);

    const configs = createSceneConfigs(3);

    const [res1, res2] = await Promise.all([
      useCase.execute({ campaignId: campaign.campaign_id as CampaignId, scenes: configs }),
      useCase.execute({ campaignId: campaign.campaign_id as CampaignId, scenes: configs })
    ]);

    const replays = [res1.isIdempotentReplay, res2.isIdempotentReplay].sort();
    expect(replays).toEqual([false, true]);

    const sceneCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM storyboard_scenes WHERE campaign_id = $1`,
      [campaign.campaign_id]
    );
    expect(sceneCount.rows[0]?.count).toBe(3);

    const jobCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM render_jobs`
    );
    expect(jobCount.rows[0]?.count).toBe(3 * CANDIDATE_BATCH_SIZE);
  });

  it("rolls back all scene and candidate records if failure occurs midway through transaction", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 3
    });

    let callCount = 0;
    const failingProgressUseCases = {
      async beginCandidateGenerationWithContext(
        context: UnitOfWorkContext,
        input: ProgressSceneProductionInput
      ) {
        callCount++;
        if (callCount === 2) {
          throw new Error("Simulated mid-flight failure during candidate admission");
        }
        const realProgress = new ProgressSceneProductionUseCases(
          new PostgresUnitOfWork(pool),
          undefined,
          new PostgresJobQueue(pool)
        );
        return realProgress.beginCandidateGenerationWithContext(context, input);
      }
    } as unknown as ProgressSceneProductionUseCases;

    const uow = new PostgresUnitOfWork(pool);
    const useCase = new MaterializeStoryboardUseCase(uow, failingProgressUseCases);

    const configs = createSceneConfigs(3);

    await expect(
      useCase.execute({
        campaignId: campaign.campaign_id as CampaignId,
        scenes: configs
      })
    ).rejects.toThrow("Simulated mid-flight failure during candidate admission");

    // Complete rollback: zero scenes persisted for this campaign
    const sceneCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM storyboard_scenes WHERE campaign_id = $1`,
      [campaign.campaign_id]
    );
    expect(sceneCount.rows[0]?.count).toBe(0);

    // Zero render_jobs persisted
    const jobCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM render_jobs`
    );
    expect(jobCount.rows[0]?.count).toBe(0);
  });

  it("durably persists and reconstitutes non-centisecond duration values (5001ms) exactly from PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 1
    });

    const uow = new PostgresUnitOfWork(pool);
    const queue = new PostgresJobQueue(pool);
    const progressUseCases = new ProgressSceneProductionUseCases(uow, undefined, queue);
    const useCase = new MaterializeStoryboardUseCase(uow, progressUseCases);

    const result = await useCase.execute({
      campaignId: campaign.campaign_id as CampaignId,
      scenes: [
        {
          ordinal: 1,
          configuration: {
            prompt: "Scene with exact 5001ms duration",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 5001,
            loraConfigurationId: null
          }
        }
      ]
    });

    expect(result.scenes[0]!.configuration.durationMs).toBe(5001);

    // Verify row directly in PostgreSQL has 5.001
    const rawRow = await client.query<{ duration_seconds: string }>(
      `SELECT duration_seconds FROM storyboard_scenes WHERE scene_id = $1`,
      [result.scenes[0]!.id]
    );
    expect(rawRow.rows[0]?.duration_seconds).toBe("5.001");

    // Re-read via PostgresSceneRepository and verify reconstituted Scene has exact 5001 durationMs
    const repoScene = await uow.execute((context) => context.scenes.findById(result.scenes[0]!.id));
    expect(repoScene).toBeDefined();
    expect(repoScene!.snapshot().configuration.durationMs).toBe(5001);
  });
});
