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
  insertRenderJobRecord
} from "../test-support/records.js";
import type { AssemblySpec } from "@cco/contracts";
import { PostgresCampaignProductionRunRepository } from "./postgres-campaign-production-run-repository.js";
import { PostgresDeliveryAssemblyJobQueue } from "./postgres-delivery-assembly-job-queue.js";

describe("PostgresCampaignProductionRunRepository Integration", () => {
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

  it("creates run idempotently via createIfAbsent", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const repo = new PostgresCampaignProductionRunRepository(client);

    const input = {
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_test_12345",
      status: "dispatched" as const,
      expectedTotalDurationMs: 12000
    };

    const first = await repo.createIfAbsent(input);
    expect(first.created).toBe(true);
    expect(first.run.campaignId).toBe(campaign.campaign_id);
    expect(first.run.fingerprint).toBe(input.fingerprint);
    expect(first.run.status).toBe("dispatched");
    expect(first.run.expectedTotalDurationMs).toBe(12000);

    const second = await repo.createIfAbsent(input);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);
  });

  it("inserts and retrieves run scenes, and looks up by productionJobId", async () => {
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

    const repo = new PostgresCampaignProductionRunRepository(client);
    const { run } = await repo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_scenes_test",
      status: "dispatched",
      expectedTotalDurationMs: 8000
    });

    const job1Id = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
    const job2Id = "01950c46-9e90-7d3d-82d2-8f1d3c000002";

    // Insert dummy render jobs for the foreign key if needed, or check schema
    // In migration 010: production_job_id uuid REFERENCES render_jobs(job_id) ON DELETE RESTRICT
    // So let's insert render_jobs rows
    await client.query(
      `
      INSERT INTO render_jobs (
        job_id, scene_id, job_kind, status, workflow_template, injected_payload, max_retries
      ) VALUES
        ($1, $2, 'production', 'queued', 'workflow_prod', '{}'::jsonb, 3),
        ($3, $4, 'production', 'queued', 'workflow_prod', '{}'::jsonb, 3)
      `,
      [job1Id, scene1.scene_id, job2Id, scene2.scene_id]
    );

    await repo.insertRunScenes(run.id, [
      {
        runId: run.id,
        sceneId: scene1.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: job1Id
      },
      {
        runId: run.id,
        sceneId: scene2.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: job2Id
      }
    ]);

    const retrievedScenes = await repo.findRunScenes(run.id);
    expect(retrievedScenes).toHaveLength(2);
    expect(retrievedScenes[0]!.sequenceIndex).toBe(1);
    expect(retrievedScenes[0]!.productionJobId).toBe(job1Id);
    expect(retrievedScenes[1]!.sequenceIndex).toBe(2);
    expect(retrievedScenes[1]!.productionJobId).toBe(job2Id);

    const lookupScene = await repo.findRunSceneByProductionJobId(job1Id);
    expect(lookupScene).toBeDefined();
    expect(lookupScene!.sceneId).toBe(scene1.scene_id);
    expect(lookupScene!.runId).toBe(run.id);
  });

  it("enforces single atomic claim for assembly and transitions to assembling", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const repo = new PostgresCampaignProductionRunRepository(client);

    const { run } = await repo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_atomic_claim",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    // First claim succeeds
    const claimed = await repo.claimForAssembly(run.id);
    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe("assembling");

    // Second claim fails (returns undefined)
    const secondClaim = await repo.claimForAssembly(run.id);
    expect(secondClaim).toBeUndefined();

    // Associates assembly job ID
    const assemblyJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000099";
    // delivery_assembly_jobs table foreign key check:
    await client.query(
      `
      INSERT INTO delivery_assembly_jobs (
        job_id, campaign_id, assembly_spec, status, max_retries
      ) VALUES
        ($1, $2, $3::jsonb, 'queued', 3)
      `,
      [assemblyJobId, campaign.campaign_id, JSON.stringify({ campaignId: campaign.campaign_id })]
    );

    await repo.setAssemblyJobId(run.id, assemblyJobId);

    const byAssemblyJob = await repo.findByAssemblyJobId(assemblyJobId);
    expect(byAssemblyJob).toBeDefined();
    expect(byAssemblyJob!.id).toBe(run.id);
    expect(byAssemblyJob!.assemblyJobId).toBe(assemblyJobId);

    // Claim completion transitions assembling -> completed
    const completed = await repo.claimCompletion(run.id);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe("completed");

    // Once completed, claimCompletion again returns undefined
    const secondCompletion = await repo.claimCompletion(run.id);
    expect(secondCompletion).toBeUndefined();
  });

  it("claims production review atomically and idempotently", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const repo = new PostgresCampaignProductionRunRepository(client);

    const { run } = await repo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_prod_review_claim",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    // First claim succeeds
    const claimed = await repo.claimForProductionReview(run.id);
    expect(claimed).toBeDefined();
    expect(claimed!.status).toBe("production_review");

    // Second claim fails (returns undefined)
    const secondClaim = await repo.claimForProductionReview(run.id);
    expect(secondClaim).toBeUndefined();

    // Can transition to failure from production_review
    const failed = await repo.claimFailure(run.id);
    expect(failed).toBeDefined();
    expect(failed!.status).toBe("failed");
  });

  it("claims failure from dispatched or assembling status", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const repo = new PostgresCampaignProductionRunRepository(client);

    const { run } = await repo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: "fp_failure_test",
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    const failed = await repo.claimFailure(run.id);
    expect(failed).toBeDefined();
    expect(failed!.status).toBe("failed");

    // Cannot fail again
    const secondFail = await repo.claimFailure(run.id);
    expect(secondFail).toBeUndefined();
  });

  it("serializes competing assembly claims across real Postgres connections", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const repo = new PostgresCampaignProductionRunRepository(client);
    const { run } = await repo.createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: `fp_concurrent_${Date.now()}`,
      status: "dispatched",
      expectedTotalDurationMs: 5000
    });

    // Make the run visible to two independent transactions while retaining the
    // fixture connection for the normal per-test rollback.
    await client.query("COMMIT");
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      const [firstClaim, secondClaim] = await Promise.all([
        (async () => {
          await first.query("BEGIN");
          try {
            const claim = await new PostgresCampaignProductionRunRepository(first).claimForAssembly(
              run.id
            );
            await first.query("COMMIT");
            return claim;
          } catch (err) {
            await first.query("ROLLBACK");
            throw err;
          }
        })(),
        (async () => {
          await second.query("BEGIN");
          try {
            const claim = await new PostgresCampaignProductionRunRepository(
              second
            ).claimForAssembly(run.id);
            await second.query("COMMIT");
            return claim;
          } catch (err) {
            await second.query("ROLLBACK");
            throw err;
          }
        })()
      ]);

      expect([firstClaim, secondClaim].filter((claim) => claim !== undefined)).toHaveLength(1);
    } finally {
      first.release();
      second.release();
      await client.query("BEGIN");
    }
  });

  it("enqueues exactly one durable assembly job when the last two completions race", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "qa"
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "qa"
    });
    const job1 = await insertRenderJobRecord(client, {
      sceneId: scene1.scene_id,
      jobKind: "production",
      status: "completed"
    });
    const job2 = await insertRenderJobRecord(client, {
      sceneId: scene2.scene_id,
      jobKind: "production",
      status: "completed"
    });
    const { run } = await new PostgresCampaignProductionRunRepository(client).createIfAbsent({
      campaignId: campaign.campaign_id as CampaignId,
      fingerprint: `fp_enqueue_race_${Date.now()}`,
      status: "dispatched",
      expectedTotalDurationMs: 8000
    });
    await new PostgresCampaignProductionRunRepository(client).insertRunScenes(run.id, [
      {
        runId: run.id,
        sceneId: scene1.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: job1.job_id
      },
      {
        runId: run.id,
        sceneId: scene2.scene_id as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: job2.job_id
      }
    ]);

    // Commit the fixture so two independent transactions can observe the same
    // completed siblings and race the run's atomic dispatched -> assembling claim.
    await client.query("COMMIT");
    const first = await pool.connect();
    const second = await pool.connect();
    const assemblySpec: AssemblySpec = {
      campaignId: campaign.campaign_id,
      videoStems: [
        {
          sceneId: scene1.scene_id,
          generationManifestId: "manifest-1",
          order: 0,
          expectedDurationMs: 4000,
          media: {
            bucket: "renders",
            key: "scene-1.mp4",
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          }
        },
        {
          sceneId: scene2.scene_id,
          generationManifestId: "manifest-2",
          order: 1,
          expectedDurationMs: 4000,
          media: {
            bucket: "renders",
            key: "scene-2.mp4",
            sha256: "b".repeat(64),
            contentType: "video/mp4"
          }
        }
      ],
      subtitleCues: [],
      assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
      expectedTotalDurationMs: 8000
    };

    try {
      const race = async (connection: PoolClient) => {
        await connection.query("BEGIN");
        try {
          const repo = new PostgresCampaignProductionRunRepository(connection);
          expect(await repo.countIncompleteRunScenes(run.id)).toBe(0);
          const claimed = await repo.claimForAssembly(run.id);
          if (!claimed) {
            await connection.query("COMMIT");
            return false;
          }
          const job = await new PostgresDeliveryAssemblyJobQueue(connection).enqueue({
            campaignId: campaign.campaign_id,
            assemblySpec
          });
          await repo.setAssemblyJobId(run.id, job.jobId);
          await connection.query("COMMIT");
          return true;
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        }
      };

      const claims = await Promise.all([race(first), race(second)]);
      expect(claims.filter(Boolean)).toHaveLength(1);

      const rows = await client.query(
        "SELECT job_id, assembly_spec FROM delivery_assembly_jobs WHERE campaign_id = $1",
        [campaign.campaign_id]
      );
      expect(rows.rows).toHaveLength(1);
      expect(
        rows.rows[0].assembly_spec.videoStems.map((stem: { order: number }) => stem.order)
      ).toEqual([0, 1]);
    } finally {
      first.release();
      second.release();
      await client.query("BEGIN");
    }
  });
});
