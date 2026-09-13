import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertStoryboardCandidateRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresJobQueue,
  PostgresDeliveryAssemblyJobQueue
} from "@cco/infrastructure";
import type { CandidateId } from "@cco/domain";
import type { ReviewErrorResponse } from "@cco/contracts";
import { createControlApiApp } from "./app.js";

const defaultTestOptions = {
  reviewerIdentityResolver: {
    resolve: () => "Director"
  }
};

const defaultDispatchConfig = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

const fakeStorageTelemetry = {
  getStorageTelemetry: async () => ({
    totalBytes: 1_000_000_000,
    usedBytes: 100_000_000,
    freeBytes: 900_000_000,
    buckets: [],
    measuredAt: "2026-09-01T00:00:00.000Z"
  })
};

describe("Campaign Production Dispatch and Gating Integration (#197)", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

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

  function createTestApp() {
    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const deliveryAssemblyJobQueue = new PostgresDeliveryAssemblyJobQueue(pool);
    return createControlApiApp(
      {
        uow,
        jobQueue,
        deliveryAssemblyJobQueue,
        storageTelemetry: fakeStorageTelemetry
      },
      {
        ...defaultTestOptions,
        jobDispatch: defaultDispatchConfig
      }
    );
  }

  it("handles concurrent scene approvals on different scenes without deadlock or duplicate dispatch", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 2,
      status: "drafting"
    });

    const candidate1Id = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as CandidateId;
    const candidate2Id = "01950c46-9e90-7d3d-82d2-8f1d3c000002" as CandidateId;

    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "director_review"
    });

    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      durationSeconds: 4.0,
      status: "director_review"
    });

    await insertStoryboardCandidateRecord(client, {
      candidateId: candidate1Id,
      sceneId: scene1.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    await insertStoryboardCandidateRecord(client, {
      candidateId: candidate2Id,
      sceneId: scene2.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [candidate1Id, scene1.scene_id]
    );
    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [candidate2Id, scene2.scene_id]
    );

    const app = createTestApp();

    // Race two concurrent approvals on different scenes in the same campaign
    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/scenes/${scene1.scene_id}/review-command`,
        payload: {
          actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000011",
          sceneId: scene1.scene_id,
          expectedSpecRevision: 1,
          action: "approve",
          payload: {}
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/scenes/${scene2.scene_id}/review-command`,
        payload: {
          actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000012",
          sceneId: scene2.scene_id,
          expectedSpecRevision: 1,
          action: "approve",
          payload: {}
        }
      })
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // Verify campaign status in PostgreSQL
    const campaignRes = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(campaignRes.rows[0].status).toBe("queued");
    expect(campaignRes.rows[0].approved_scenes).toBe(2);

    // Verify exactly one production run in PostgreSQL
    const runsRes = await client.query(
      "SELECT * FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runsRes.rows).toHaveLength(1);
    expect(runsRes.rows[0].status).toBe("dispatched");

    // Verify exactly 2 production render jobs enqueued
    const jobsRes = await client.query(
      "SELECT * FROM render_jobs WHERE job_kind = 'production' AND status = 'queued'"
    );
    expect(jobsRes.rows).toHaveLength(2);

    await app.close();
  });

  it("evaluates live readiness: editing approved scene reverts readiness, re-approval triggers dispatch", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 3,
      status: "drafting"
    });

    const cand1 = "01950c46-9e90-7d3d-82d2-8f1d3c000021" as CandidateId;
    const cand2 = "01950c46-9e90-7d3d-82d2-8f1d3c000022" as CandidateId;
    const cand3 = "01950c46-9e90-7d3d-82d2-8f1d3c000023" as CandidateId;

    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "director_review"
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      durationSeconds: 4.0,
      status: "director_review"
    });
    const scene3 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      durationSeconds: 4.0,
      status: "director_review"
    });

    const candidateScenePairs: Array<[CandidateId, string]> = [
      [cand1, scene1.scene_id],
      [cand2, scene2.scene_id],
      [cand3, scene3.scene_id]
    ];
    for (const [candId, sceneId] of candidateScenePairs) {
      await insertStoryboardCandidateRecord(client, {
        candidateId: candId,
        sceneId,
        sceneSpecRevision: 1,
        variantOrdinal: 1
      });
      await client.query(
        "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
        [candId, sceneId]
      );
    }

    const app = createTestApp();

    // 1. Approve scene 1
    const app1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000031",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });
    expect(app1.statusCode).toBe(200);

    // 2. Approve scene 2
    const app2 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000032",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });
    expect(app2.statusCode).toBe(200);

    // Verify campaign remains drafting, 0 runs
    let camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("drafting");
    expect(camp.rows[0].approved_scenes).toBe(2);

    // 3. Edit scene 1's prompt. This reverts scene 1 to director_review and bumps specRevision to 2.
    const editRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000033",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "prompt_edit",
        payload: { prompt: "A newly adjusted scene prompt" }
      }
    });
    expect(editRes.statusCode).toBe(200);
    const scene1Check = await client.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1", [
      scene1.scene_id
    ]);
    expect(scene1Check.rows[0].status).toBe("director_review");
    expect(scene1Check.rows[0].spec_revision).toBe(2);

    // 4. Now approve scene 3.
    // Even though 2 approvals occurred previously, scene 1 is now in director_review.
    // Live readiness must evaluate to false!
    const app3 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene3.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000034",
        sceneId: scene3.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });
    expect(app3.statusCode).toBe(200);

    // Verify campaign is STILL in drafting and NO run was created
    camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("drafting");
    expect(camp.rows[0].approved_scenes).toBe(2); // scene 2 and scene 3
    let runs = await client.query("SELECT * FROM campaign_production_runs WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(runs.rows).toHaveLength(0);

    // 5. Re-approve scene 1 at specRevision 2
    // We need a candidate for rev 2
    await insertStoryboardCandidateRecord(client, {
      candidateId: "01950c46-9e90-7d3d-82d2-8f1d3c000029" as CandidateId,
      sceneId: scene1.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 1
    });

    // Select candidate for rev 2
    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000035",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 2,
        action: "candidate_select",
        payload: { candidateId: "01950c46-9e90-7d3d-82d2-8f1d3c000029" }
      }
    });

    const reApprove = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000036",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 2,
        action: "approve",
        payload: {}
      }
    });
    expect(reApprove.statusCode).toBe(200);

    // Now all 3 scenes are live-approved -> campaign transitions to queued!
    camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("queued");
    expect(camp.rows[0].approved_scenes).toBe(3);

    runs = await client.query("SELECT * FROM campaign_production_runs WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].status).toBe("dispatched");

    // 6. Mid-flight edit rejection:
    // Attempting to edit scene 2 (which is now in queued status) must be rejected
    const rejectedEdit = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000037",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "prompt_edit",
        payload: { prompt: "Illegal edit during production" }
      }
    });
    expect(rejectedEdit.statusCode).toBe(422);
    const body = rejectedEdit.json() as ReviewErrorResponse;
    expect(body.code).toBe("INVALID_DOMAIN_TRANSITION");

    await app.close();
  });

  it("drives full lifecycle: start -> rendering -> manifests -> completion -> production review without auto-assembly", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 2,
      status: "drafting"
    });

    const cand1 = "01950c46-9e90-7d3d-82d2-8f1d3c000041" as CandidateId;
    const cand2 = "01950c46-9e90-7d3d-82d2-8f1d3c000042" as CandidateId;

    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "director_review"
    });

    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      durationSeconds: 4.0,
      status: "director_review"
    });

    await insertStoryboardCandidateRecord(client, {
      candidateId: cand1,
      sceneId: scene1.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    await insertStoryboardCandidateRecord(client, {
      candidateId: cand2,
      sceneId: scene2.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [cand1, scene1.scene_id]
    );
    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [cand2, scene2.scene_id]
    );

    const app = createTestApp();

    // Approve both scenes to trigger production dispatch
    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000051",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });

    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000052",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });

    // Campaign is queued
    let camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("queued");

    // Worker claims and starts job 1
    const claim1 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-1" }
    });
    expect(claim1.statusCode).toBe(200);
    const job1 = claim1.json();

    const start1 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job1.jobId}/start`,
      payload: { leaseToken: job1.leaseToken }
    });
    expect(start1.statusCode).toBe(200);

    // Campaign status transitioned to rendering!
    camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("rendering");

    // Worker claims and starts job 2
    const claim2 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-2" }
    });
    expect(claim2.statusCode).toBe(200);
    const job2 = claim2.json();

    const start2 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job2.jobId}/start`,
      payload: { leaseToken: job2.leaseToken }
    });
    expect(start2.statusCode).toBe(200);

    // Campaign status remains rendering
    camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("rendering");

    // Complete job 1 with manifest
    const validSha1 = "1111111111111111111111111111111111111111111111111111111111111111";
    const validSha2 = "2222222222222222222222222222222222222222222222222222222222222222";

    const comp1 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job1.jobId}/complete`,
      payload: {
        leaseToken: job1.leaseToken,
        manifestPayload: {
          promptIdComfy: "prompt-job-1",
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: "cco-render-output",
              key: `campaigns/${campaign.campaign_id}/scenes/${job1.sceneId}/output.mp4`,
              checksumSha256: validSha1
            }
          ]
        }
      }
    });
    expect(comp1.statusCode).toBe(200);

    // Campaign still rendering, no assembly job yet
    camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("rendering");

    let assemblyJobs = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobs.rows).toHaveLength(0);

    // Complete job 2 (the final production job!)
    const comp2 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job2.jobId}/complete`,
      payload: {
        leaseToken: job2.leaseToken,
        manifestPayload: {
          promptIdComfy: "prompt-job-2",
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: "cco-render-output",
              key: `campaigns/${campaign.campaign_id}/scenes/${job2.sceneId}/output.mp4`,
              checksumSha256: validSha2
            }
          ]
        }
      }
    });
    expect(comp2.statusCode).toBe(200);

    // Campaign status transitioned to qa (production review ready)!
    camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("qa");

    // No delivery assembly job was enqueued (proves no auto-assembly)!
    assemblyJobs = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobs.rows).toHaveLength(0);

    // Verify CampaignProductionRun status is production_review with no assembly_job_id
    const runs = await client.query(
      "SELECT * FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runs.rows[0].status).toBe("production_review");
    expect(runs.rows[0].assembly_job_id).toBeNull();

    // Verify all scenes in the campaign are in qa
    const scenes = await client.query(
      "SELECT * FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC",
      [campaign.campaign_id]
    );
    expect(scenes.rows).toHaveLength(2);
    expect(scenes.rows[0].status).toBe("qa");
    expect(scenes.rows[1].status).toBe("qa");

    await app.close();
  });

  it("transitions campaign and run to failed when delivery assembly job fails", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 1,
      status: "drafting"
    });

    const cand1 = "01950c46-9e90-7d3d-82d2-8f1d3c000061" as CandidateId;
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "director_review"
    });
    await insertStoryboardCandidateRecord(client, {
      candidateId: cand1,
      sceneId: scene1.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });
    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [cand1, scene1.scene_id]
    );

    const app = createTestApp();

    // Approve scene 1 -> queued
    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000071",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });

    const claim1 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-1" }
    });
    const job1 = claim1.json();

    await app.inject({
      method: "POST",
      url: `/api/jobs/${job1.jobId}/start`,
      payload: { leaseToken: job1.leaseToken }
    });

    const complete1 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job1.jobId}/complete`,
      payload: {
        leaseToken: job1.leaseToken,
        manifestPayload: {
          promptIdComfy: "prompt-job-fail-test",
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: "cco-render-output",
              key: `out.mp4`,
              checksumSha256: "1111111111111111111111111111111111111111111111111111111111111111"
            }
          ]
        }
      }
    });
    expect(complete1.statusCode).toBe(200);

    // Since production completion no longer auto-enqueues assembly, explicitly enqueue delivery assembly job and link to run
    const runsBefore = await client.query(
      "SELECT * FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    const runId = runsBefore.rows[0].run_id;

    const enqueueAssembly = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs",
      payload: {
        campaignId: campaign.campaign_id,
        assemblySpec: {
          campaignId: campaign.campaign_id,
          assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
          expectedTotalDurationMs: 4000,
          videoStems: [
            {
              order: 0,
              sceneId: scene1.scene_id,
              generationManifestId: "01950c46-9e90-7d3d-82d2-8f1d3c000088",
              expectedDurationMs: 4000,
              media: {
                bucket: "cco-render-output",
                key: "out.mp4",
                sha256: "1111111111111111111111111111111111111111111111111111111111111111",
                contentType: "video/mp4"
              }
            }
          ]
        }
      }
    });
    expect(enqueueAssembly.statusCode).toBe(201);
    const enqueued = enqueueAssembly.json();

    await client.query(
      "UPDATE campaign_production_runs SET assembly_job_id = $1, status = 'assembling' WHERE run_id = $2",
      [enqueued.jobId, runId]
    );

    // Claim delivery assembly job and fail it
    const claimAssembly = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs/claim",
      payload: { workerId: "assembly-worker-1" }
    });
    const claimedAssemblyJob = claimAssembly.json();

    // Set retry_count = max_retries so failure is terminal and triggers campaign failure
    await client.query(
      "UPDATE delivery_assembly_jobs SET retry_count = max_retries WHERE job_id = $1",
      [claimedAssemblyJob.jobId]
    );

    const failAssembly = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${claimedAssemblyJob.jobId}/fail`,
      payload: { leaseToken: claimedAssemblyJob.leaseToken, errorTrace: "FFmpeg render failure" }
    });
    expect(failAssembly.statusCode).toBe(200);

    // Assert campaign and run status both transitioned to failed
    const camp = await client.query("SELECT * FROM campaigns WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(camp.rows[0].status).toBe("failed");

    const runs = await client.query(
      "SELECT * FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runs.rows[0].status).toBe("failed");

    await app.close();
  });
});
