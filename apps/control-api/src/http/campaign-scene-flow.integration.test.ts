import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresSceneRepository,
  PostgresJobQueue,
  PostgresSceneReviewQueries
} from "@cco/infrastructure";
import type { SceneId } from "@cco/domain";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import type { PlanningModelClientPort, ReferenceAssetRepository } from "@cco/application";
import { createControlApiApp } from "./app.js";

const manualProcessingPolicy = {
  allowCloudPlanning: false,
  allowCloudVisualQA: true,
  allowCloudVoice: true,
  allowedProviders: [],
  sensitiveDataMasking: true
};

const defaultTestOptions = {
  reviewerIdentityResolver: {
    resolve: () => "Test Creator"
  }
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

const fakeReviewMediaDelivery = {
  generatePresignedReadUrl: async (loc: { bucket: string; key: string }) =>
    `https://media.local/${loc.bucket}/${loc.key}`
};

const defaultDispatchConfig = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

describe("Campaign and Scene Creation End-to-End Integration", () => {
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

  it("creates a real campaign and scene landing in PostgreSQL in draft_pending state", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Productions",
      externalProcessingPolicy: manualProcessingPolicy
    });

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    // 1. POST /api/campaigns
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Carnival 2026 Commercial",
        targetPlatform: "instagram_reels",
        totalScenes: 2
      }
    });

    expect(campaignRes.statusCode).toBe(201);
    const campaignBody = campaignRes.json();
    expect(campaignBody.campaignId).toBeDefined();
    expect(campaignBody.clientId).toBe(clientRecord.client_id);
    expect(campaignBody.title).toBe("Carnival 2026 Commercial");
    expect(campaignBody.targetPlatform).toBe("instagram_reels");
    expect(campaignBody.status).toBe("drafting");
    expect(campaignBody.totalScenes).toBe(2);
    expect(campaignBody.approvedScenes).toBe(0);
    expect(campaignBody.createdAt).toBeDefined();

    // Verify campaign landed in PostgreSQL
    const campaignRowResult = await client.query(
      "SELECT campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes FROM campaigns WHERE campaign_id = $1",
      [campaignBody.campaignId]
    );
    expect(campaignRowResult.rows).toHaveLength(1);
    const campaignRow = campaignRowResult.rows[0];
    expect(campaignRow?.client_id).toBe(clientRecord.client_id);
    expect(campaignRow?.title).toBe("Carnival 2026 Commercial");
    expect(campaignRow?.status).toBe("drafting");
    expect(campaignRow?.total_scenes).toBe(2);

    // 2. POST /api/campaigns/:campaignId/scenes
    const configuration = {
      prompt: "Cinematic shot of carnival dancer in golden plumage at sunset",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: "lora-carnival-v1"
    };

    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignBody.campaignId}/scenes`,
      payload: { configuration }
    });

    expect(sceneRes.statusCode).toBe(201);
    const sceneBody = sceneRes.json();
    expect(sceneBody.sceneId).toBeDefined();
    expect(sceneBody.campaignId).toBe(campaignBody.campaignId);
    expect(sceneBody.status).toBe("draft_pending");
    expect(sceneBody.specRevision).toBe(1);
    expect(sceneBody.configuration).toEqual(configuration);

    // Verify scene landed in PostgreSQL in draft_pending state with spec_revision = 1
    const sceneRowResult = await client.query(
      "SELECT scene_id, campaign_id, scene_order, duration_seconds, visual_description, engine_assigned, status, spec_revision, lora_configuration_id FROM storyboard_scenes WHERE scene_id = $1",
      [sceneBody.sceneId]
    );
    expect(sceneRowResult.rows).toHaveLength(1);
    const sceneRow = sceneRowResult.rows[0];
    expect(sceneRow?.campaign_id).toBe(campaignBody.campaignId);
    expect(sceneRow?.status).toBe("draft_pending");
    expect(sceneRow?.spec_revision).toBe(1);
    expect(sceneRow?.scene_order).toBe(1);
    expect(sceneRow?.visual_description).toBe(configuration.prompt);
    expect(sceneRow?.engine_assigned).toBe("ltx_25");
    expect(sceneRow?.lora_configuration_id).toBe("lora-carnival-v1");

    // Also verify Scene repository can reconstitute it
    const sceneRepo = new PostgresSceneRepository(pool);
    const reconstituted = await sceneRepo.findById(sceneBody.sceneId as SceneId);
    expect(reconstituted).toBeDefined();
    expect(reconstituted?.status).toBe("draft_pending");
    expect(reconstituted?.snapshot().specRevision).toBe(1);
  });

  it("returns 404 NOT_FOUND when attempting to create campaign with non-existent clientId", async () => {
    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    const nonExistentClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899";
    const res = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: nonExistentClientId,
        title: "Orphan Campaign"
      }
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(`Client '${nonExistentClientId}' was not found.`);
  });

  it("returns 404 NOT_FOUND when attempting to create scene under non-existent campaignId", async () => {
    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow }, defaultTestOptions);

    const nonExistentCampaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800";
    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${nonExistentCampaignId}/scenes`,
      payload: {
        configuration: {
          prompt: "Caldera sunrise",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      }
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(`Campaign '${nonExistentCampaignId}' was not found.`);
  });

  it("transitions draft_pending scene to generating_candidates, enqueues 3 candidate jobs, allows worker claim, and candidates are visible in review", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Productions",
      externalProcessingPolicy: manualProcessingPolicy
    });

    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);

    const app = createControlApiApp(
      {
        uow,
        jobQueue,
        storageTelemetry: fakeStorageTelemetry,
        sceneReviewQueries,
        reviewMediaDelivery: fakeReviewMediaDelivery
      },
      {
        ...defaultTestOptions,
        jobDispatch: defaultDispatchConfig
      }
    );

    // 1. POST /api/campaigns
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Candidate Generation Test Campaign",
        targetPlatform: "instagram_reels",
        totalScenes: 1
      }
    });
    expect(campaignRes.statusCode).toBe(201);
    const campaignBody = campaignRes.json();

    // 2. POST /api/campaigns/:campaignId/scenes
    const configuration = {
      prompt: "Golden sunrise over misty pine forest with morning dew",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: "lora-mist-v1"
    };

    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignBody.campaignId}/scenes`,
      payload: { configuration }
    });
    expect(sceneRes.statusCode).toBe(201);
    const sceneBody = sceneRes.json();
    expect(sceneBody.status).toBe("draft_pending");
    expect(sceneBody.specRevision).toBe(1);

    // 3. POST /api/scenes/:sceneId/generation-admission
    const admissionRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneBody.sceneId}/generation-admission`
    });

    expect(admissionRes.statusCode).toBe(200);
    const admissionBody = admissionRes.json();
    expect(admissionBody.sceneId).toBe(sceneBody.sceneId);
    expect(admissionBody.status).toBe("generating_candidates");
    expect(admissionBody.specRevision).toBe(1);
    expect(admissionBody.enqueuedJobIds).toHaveLength(3);

    // Ensure job IDs are distinct
    const distinctJobIds = new Set(admissionBody.enqueuedJobIds);
    expect(distinctJobIds.size).toBe(3);

    // 4. Assert PostgreSQL render_jobs rows
    const jobRowsRes = await client.query<{
      job_id: string;
      scene_id: string;
      job_kind: string;
      workflow_template: string;
      injected_payload: { prompt: string; seed: number; variantOrdinal: number };
      status: string;
      worker_id: string | null;
      lease_token: string | null;
      retry_count: number;
      max_retries: number;
    }>(
      "SELECT * FROM render_jobs WHERE scene_id = $1 ORDER BY (injected_payload->>'variantOrdinal')::int ASC",
      [sceneBody.sceneId]
    );

    expect(jobRowsRes.rows).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const row = jobRowsRes.rows[i]!;
      const expectedOrdinal = i + 1;
      const expectedSeed = 42 + expectedOrdinal;

      expect(row.scene_id).toBe(sceneBody.sceneId);
      expect(row.job_kind).toBe("candidate");
      expect(row.workflow_template).toBe("flux-schnell-draft");
      expect(row.status).toBe("queued");
      expect(row.max_retries).toBe(3);
      expect(row.retry_count).toBe(0);
      expect(row.worker_id).toBeNull();
      expect(row.lease_token).toBeNull();
      expect(row.injected_payload).toEqual({
        prompt: configuration.prompt,
        seed: expectedSeed,
        variantOrdinal: expectedOrdinal
      });
      expect(admissionBody.enqueuedJobIds).toContain(row.job_id);
    }

    // 5. Claim a job with allowedJobKinds: ['candidate'] using the real PostgresJobQueue
    const claimedJob = await jobQueue.claim({
      workerId: "worker-daemon-alpha",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });

    expect(claimedJob).toBeDefined();
    expect(claimedJob?.sceneId).toBe(sceneBody.sceneId);
    expect(claimedJob?.jobKind).toBe("candidate");
    expect(claimedJob?.status).toBe("leased");
    expect(claimedJob?.workerId).toBe("worker-daemon-alpha");
    expect(claimedJob?.leaseToken).toBeDefined();
    expect(claimedJob?.workflowTemplate).toBe("flux-schnell-draft");
    expect(claimedJob?.injectedPayload.variantOrdinal).toBe(1);

    // 6. Start rendering and complete the candidate job
    const startRes = await jobQueue.start(claimedJob!.jobId, claimedJob!.leaseToken!);
    expect(startRes.outcome).toBe("applied");

    const candidatePayload = {
      variantOrdinal: 1,
      storageBucket: "cco-renders",
      storageObjectKey: `scenes/${sceneBody.sceneId}/candidate-1.png`,
      contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      generationPayload: {
        seed: 43,
        prompt: configuration.prompt
      }
    };

    const completeRes = await jobQueue.complete(
      claimedJob!.jobId,
      claimedJob!.leaseToken!,
      undefined,
      candidatePayload
    );
    expect(completeRes.outcome).toBe("applied");

    // 7. Review-read route verifies candidate visibility
    const reviewRes = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneBody.sceneId}/review`
    });

    expect(reviewRes.statusCode).toBe(200);
    const reviewBody = reviewRes.json();
    expect(reviewBody.sceneId).toBe(sceneBody.sceneId);
    expect(reviewBody.status).toBe("generating_candidates");
    expect(reviewBody.specRevision).toBe(1);
    expect(reviewBody.candidatesByRevision).toHaveLength(1);

    const revisionGroup = reviewBody.candidatesByRevision[0];
    expect(revisionGroup.specRevision).toBe(1);
    expect(revisionGroup.candidates).toHaveLength(1);

    const candidate = revisionGroup.candidates[0];
    expect(candidate.variantOrdinal).toBe(1);
    expect(candidate.specRevision).toBe(1);
    expect(candidate.contentHash).toBe(candidatePayload.contentHashSha256);
    expect(candidate.media.available).toBe(true);
    expect(candidate.media.url).toContain(
      `https://media.local/${candidatePayload.storageBucket}/${candidatePayload.storageObjectKey}`
    );
    expect(candidate.generationMetadata).toEqual(candidatePayload.generationPayload);

    // 8. Concurrent admissions have one winner and one rejected loser.
    const concurrentSceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignBody.campaignId}/scenes`,
      payload: {
        configuration: {
          ...configuration,
          prompt: "Second scene used to prove concurrent admission locking"
        }
      }
    });
    expect(concurrentSceneRes.statusCode).toBe(201);
    const concurrentSceneId = concurrentSceneRes.json().sceneId as string;

    const concurrentAdmissions = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/scenes/${concurrentSceneId}/generation-admission`
      }),
      app.inject({
        method: "POST",
        url: `/api/scenes/${concurrentSceneId}/generation-admission`
      })
    ]);

    expect(concurrentAdmissions.map((response) => response.statusCode).sort()).toEqual([200, 422]);
    const concurrentJobRows = await client.query(
      "SELECT job_id FROM render_jobs WHERE scene_id = $1",
      [concurrentSceneId]
    );
    expect(concurrentJobRows.rows).toHaveLength(3);
  });

  it("automatically transitions scene from generating_candidates to director_review on batch completion (2 completed, 1 failed terminal)", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Batch Complete Test",
      externalProcessingPolicy: manualProcessingPolicy
    });

    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp(
      {
        uow,
        jobQueue,
        sceneReviewQueries,
        storageTelemetry: fakeStorageTelemetry,
        reviewMediaDelivery: fakeReviewMediaDelivery
      },
      { ...defaultTestOptions, jobDispatch: defaultDispatchConfig }
    );

    // Create campaign and scene
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Commercial A",
        targetPlatform: "instagram_reels",
        totalScenes: 1
      }
    });
    const campaignId = campaignRes.json().campaignId as string;

    const configuration = {
      prompt: "A cinematic shot of a mountain sunrise",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000
    };
    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/scenes`,
      payload: { configuration }
    });
    const sceneId = sceneRes.json().sceneId as string;

    // Admission to candidate generation (enqueues 3 candidate jobs)
    const admissionRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/generation-admission`
    });
    expect(admissionRes.statusCode).toBe(200);

    // Claim, start, and complete candidate job 1 via HTTP
    const job1 = await jobQueue.claim({
      workerId: "worker-1",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    expect(job1).toBeDefined();
    await jobQueue.start(job1!.jobId, job1!.leaseToken!);

    const complete1Res = await app.inject({
      method: "POST",
      url: `/api/jobs/${job1!.jobId}/complete`,
      payload: {
        leaseToken: job1!.leaseToken,
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "cco-renders",
          storageObjectKey: `scenes/${sceneId}/candidate-1.png`,
          contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          generationPayload: { seed: 43 }
        }
      }
    });
    expect(complete1Res.statusCode).toBe(200);

    // Scene should still be in generating_candidates (2 jobs remaining)
    let reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("generating_candidates");
    expect(reviewRes.json().allowedActions).toEqual(["cancel"]);

    // Claim, start, and complete candidate job 2 via HTTP
    const job2 = await jobQueue.claim({
      workerId: "worker-2",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    expect(job2).toBeDefined();
    await jobQueue.start(job2!.jobId, job2!.leaseToken!);

    const complete2Res = await app.inject({
      method: "POST",
      url: `/api/jobs/${job2!.jobId}/complete`,
      payload: {
        leaseToken: job2!.leaseToken,
        candidatePayload: {
          variantOrdinal: 2,
          storageBucket: "cco-renders",
          storageObjectKey: `scenes/${sceneId}/candidate-2.png`,
          contentHashSha256: "1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          generationPayload: { seed: 44 }
        }
      }
    });
    expect(complete2Res.statusCode).toBe(200);

    // Scene should still be in generating_candidates (1 job remaining)
    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("generating_candidates");

    // Claim candidate job 3, mark its retry_count = max_retries so failing it will permanently fail it
    const job3 = await jobQueue.claim({
      workerId: "worker-3",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    expect(job3).toBeDefined();
    await jobQueue.start(job3!.jobId, job3!.leaseToken!);
    await client.query("UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1", [
      job3!.jobId
    ]);

    // Fail job 3 via HTTP
    const fail3Res = await app.inject({
      method: "POST",
      url: `/api/jobs/${job3!.jobId}/fail`,
      payload: {
        leaseToken: job3!.leaseToken,
        errorTrace: "Permanent generation failure"
      }
    });
    expect(fail3Res.statusCode).toBe(200);
    expect(fail3Res.json().outcome).toBe("applied");

    // Now all 3 jobs are terminal (2 completed, 1 failed) -> scene MUST have transitioned to director_review!
    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.statusCode).toBe(200);
    const reviewBody = reviewRes.json();
    expect(reviewBody.status).toBe("director_review");
    expect(reviewBody.allowedActions).toContain("approve");
    expect(reviewBody.allowedActions).toContain("reroll");
    expect(reviewBody.allowedActions).toContain("candidate_select");
    expect(reviewBody.candidatesByRevision).toHaveLength(1);
    expect(reviewBody.candidatesByRevision[0].candidates).toHaveLength(2);
  });

  it("transitions scene to director_review when all candidates fail (0/3 survive)", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "All Failed Test",
      externalProcessingPolicy: manualProcessingPolicy
    });

    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp(
      {
        uow,
        jobQueue,
        sceneReviewQueries,
        storageTelemetry: fakeStorageTelemetry,
        reviewMediaDelivery: fakeReviewMediaDelivery
      },
      { ...defaultTestOptions, jobDispatch: defaultDispatchConfig }
    );

    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Commercial B",
        targetPlatform: "instagram_reels",
        totalScenes: 1
      }
    });
    const campaignId = campaignRes.json().campaignId as string;

    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/scenes`,
      payload: {
        configuration: {
          prompt: "A shot destined to fail renders",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      }
    });
    const sceneId = sceneRes.json().sceneId as string;

    await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/generation-admission`
    });

    // Fail all 3 jobs terminally
    for (let i = 0; i < 3; i++) {
      const job = await jobQueue.claim({
        workerId: `worker-fail-${i}`,
        leaseDurationMs: 60_000,
        allowedJobKinds: ["candidate"]
      });
      expect(job).toBeDefined();
      await jobQueue.start(job!.jobId, job!.leaseToken!);
      await client.query("UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1", [
        job!.jobId
      ]);

      const failRes = await app.inject({
        method: "POST",
        url: `/api/jobs/${job!.jobId}/fail`,
        payload: {
          leaseToken: job!.leaseToken,
          errorTrace: `Terminal error ${i + 1}`
        }
      });
      expect(failRes.statusCode).toBe(200);
    }

    const reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.statusCode).toBe(200);
    const reviewBody = reviewRes.json();
    expect(reviewBody.status).toBe("director_review");
    expect(reviewBody.allowedActions).toContain("reroll");
    expect(reviewBody.candidatesByRevision).toHaveLength(0);
  });

  it("safely handles worker retry (already_applied) on the last candidate job without erroring or duplicating transitions", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Retry Simulation Test",
      externalProcessingPolicy: manualProcessingPolicy
    });

    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp(
      {
        uow,
        jobQueue,
        sceneReviewQueries,
        storageTelemetry: fakeStorageTelemetry,
        reviewMediaDelivery: fakeReviewMediaDelivery
      },
      { ...defaultTestOptions, jobDispatch: defaultDispatchConfig }
    );

    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Commercial C",
        targetPlatform: "instagram_reels",
        totalScenes: 1
      }
    });
    const campaignId = campaignRes.json().campaignId as string;

    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/scenes`,
      payload: {
        configuration: {
          prompt: "Retry test scene",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      }
    });
    const sceneId = sceneRes.json().sceneId as string;

    await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/generation-admission`
    });

    // Complete jobs 1 and 2
    for (let ord = 1; ord <= 2; ord++) {
      const job = await jobQueue.claim({
        workerId: `worker-${ord}`,
        leaseDurationMs: 60_000,
        allowedJobKinds: ["candidate"]
      });
      await jobQueue.start(job!.jobId, job!.leaseToken!);
      const completeRes = await app.inject({
        method: "POST",
        url: `/api/jobs/${job!.jobId}/complete`,
        payload: {
          leaseToken: job!.leaseToken,
          candidatePayload: {
            variantOrdinal: ord,
            storageBucket: "cco-renders",
            storageObjectKey: `scenes/${sceneId}/candidate-${ord}.png`,
            contentHashSha256: `a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde${ord}`,
            generationPayload: { seed: 42 + ord }
          }
        }
      });
      expect(completeRes.statusCode).toBe(200);
    }

    // Claim, start job 3
    const job3 = await jobQueue.claim({
      workerId: "worker-3",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    await jobQueue.start(job3!.jobId, job3!.leaseToken!);

    const job3Payload = {
      leaseToken: job3!.leaseToken,
      candidatePayload: {
        variantOrdinal: 3,
        storageBucket: "cco-renders",
        storageObjectKey: `scenes/${sceneId}/candidate-3.png`,
        contentHashSha256: "a123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde3",
        generationPayload: { seed: 45 }
      }
    };

    // First completion POST: applied -> transitions to director_review
    const res1 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job3!.jobId}/complete`,
      payload: job3Payload
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().outcome).toBe("applied");

    let reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("director_review");

    // Second completion POST: simulates worker completeWithRetry retry -> already_applied
    const res2 = await app.inject({
      method: "POST",
      url: `/api/jobs/${job3!.jobId}/complete`,
      payload: job3Payload
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().outcome).toBe("already_applied");

    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("director_review");
    expect(reviewRes.json().candidatesByRevision[0].candidates).toHaveLength(3);
  });

  it("safely resolves concurrent-reroll-vs-stale-retry race condition via row locking", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Witness Test",
      externalProcessingPolicy: manualProcessingPolicy
    });

    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp(
      {
        uow,
        jobQueue,
        sceneReviewQueries,
        storageTelemetry: fakeStorageTelemetry,
        reviewMediaDelivery: fakeReviewMediaDelivery
      },
      { ...defaultTestOptions, jobDispatch: defaultDispatchConfig }
    );

    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Witness Campaign",
        targetPlatform: "instagram_reels",
        totalScenes: 1
      }
    });
    const campaignId = campaignRes.json().campaignId as string;

    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/scenes`,
      payload: {
        configuration: {
          prompt: "Initial prompt for cycle 1",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      }
    });
    const sceneId = sceneRes.json().sceneId as string;

    // Cycle 1: begin candidate generation
    await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/generation-admission`
    });

    // Resolve cycle 1: 2 completed, 1 failed
    const c1Job1 = await jobQueue.claim({
      workerId: "c1-w1",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    await jobQueue.start(c1Job1!.jobId, c1Job1!.leaseToken!);
    const c1Payload1 = {
      variantOrdinal: 1,
      storageBucket: "cco-renders",
      storageObjectKey: `scenes/${sceneId}/c1-1.png`,
      contentHashSha256: "c100000000000000000000000000000000000000000000000000000000000001",
      generationPayload: { seed: 43 }
    };
    await app.inject({
      method: "POST",
      url: `/api/jobs/${c1Job1!.jobId}/complete`,
      payload: { leaseToken: c1Job1!.leaseToken, candidatePayload: c1Payload1 }
    });

    const c1Job2 = await jobQueue.claim({
      workerId: "c1-w2",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    await jobQueue.start(c1Job2!.jobId, c1Job2!.leaseToken!);
    await app.inject({
      method: "POST",
      url: `/api/jobs/${c1Job2!.jobId}/complete`,
      payload: {
        leaseToken: c1Job2!.leaseToken,
        candidatePayload: {
          variantOrdinal: 2,
          storageBucket: "cco-renders",
          storageObjectKey: `scenes/${sceneId}/c1-2.png`,
          contentHashSha256: "c100000000000000000000000000000000000000000000000000000000000002",
          generationPayload: { seed: 44 }
        }
      }
    });

    const c1Job3 = await jobQueue.claim({
      workerId: "c1-w3",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    await jobQueue.start(c1Job3!.jobId, c1Job3!.leaseToken!);
    await client.query("UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1", [
      c1Job3!.jobId
    ]);
    await app.inject({
      method: "POST",
      url: `/api/jobs/${c1Job3!.jobId}/fail`,
      payload: { leaseToken: c1Job3!.leaseToken, errorTrace: "c1 fail" }
    });

    // Verify step 1: scene is in director_review and specRevision is 1
    let reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("director_review");
    expect(reviewRes.json().specRevision).toBe(1);

    // Step 2: Issue configuration edit via review command so specRevision becomes 2
    const editRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73901",
        sceneId,
        expectedSpecRevision: 1,
        action: "prompt_edit",
        payload: {
          prompt: "Updated prompt for cycle 2"
        }
      }
    });
    expect(editRes.statusCode).toBe(200);

    const dbRevisionRes = await client.query<{ spec_revision: number }>(
      "SELECT spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneId]
    );
    expect(Number(dbRevisionRes.rows[0]?.spec_revision)).toBe(2);

    // Step 3: Issue reroll via review command
    const rerollRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73902",
        sceneId,
        expectedSpecRevision: 2,
        action: "reroll",
        payload: {}
      }
    });
    expect(rerollRes.statusCode).toBe(200);

    // Confirm scene is in generating_candidates and cycle 2 has 3 queued jobs
    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("generating_candidates");

    const cycle2QueuedJobs = await client.query<{ count: string }>(
      "SELECT count(*) FROM render_jobs WHERE scene_id = $1 AND status = 'queued'",
      [sceneId]
    );
    expect(Number(cycle2QueuedJobs.rows[0]?.count)).toBe(3);

    // Step 4: Sequentially claim/start/complete cycle-2's first two jobs (ordinals 1 and 2)
    const c2Job1 = await jobQueue.claim({
      workerId: "c2-w1",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    expect(c2Job1).toBeDefined();
    await jobQueue.start(c2Job1!.jobId, c2Job1!.leaseToken!);
    await app.inject({
      method: "POST",
      url: `/api/jobs/${c2Job1!.jobId}/complete`,
      payload: {
        leaseToken: c2Job1!.leaseToken,
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "cco-renders",
          storageObjectKey: `scenes/${sceneId}/c2-1.png`,
          contentHashSha256: "c200000000000000000000000000000000000000000000000000000000000001",
          generationPayload: { seed: 101 }
        }
      }
    });
    // Assert still in generating_candidates
    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("generating_candidates");

    const c2Job2 = await jobQueue.claim({
      workerId: "c2-w2",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    expect(c2Job2).toBeDefined();
    await jobQueue.start(c2Job2!.jobId, c2Job2!.leaseToken!);
    await app.inject({
      method: "POST",
      url: `/api/jobs/${c2Job2!.jobId}/complete`,
      payload: {
        leaseToken: c2Job2!.leaseToken,
        candidatePayload: {
          variantOrdinal: 2,
          storageBucket: "cco-renders",
          storageObjectKey: `scenes/${sceneId}/c2-2.png`,
          contentHashSha256: "c200000000000000000000000000000000000000000000000000000000000002",
          generationPayload: { seed: 102 }
        }
      }
    });
    // Assert still in generating_candidates
    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.json().status).toBe("generating_candidates");

    // Step 5: Claim and start cycle-2's third job (to obtain valid lease first)
    const c2Job3 = await jobQueue.claim({
      workerId: "c2-w3",
      leaseDurationMs: 60_000,
      allowedJobKinds: ["candidate"]
    });
    expect(c2Job3).toBeDefined();
    await jobQueue.start(c2Job3!.jobId, c2Job3!.leaseToken!);

    // Fire two requests concurrently:
    // (a) Stale retry of cycle-1's completed job 1
    // (b) Legitimate completion of cycle-2's third job
    const [staleRetryRes, finalCompleteRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/jobs/${c1Job1!.jobId}/complete`,
        payload: {
          leaseToken: c1Job1!.leaseToken,
          candidatePayload: c1Payload1
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/jobs/${c2Job3!.jobId}/complete`,
        payload: {
          leaseToken: c2Job3!.leaseToken,
          candidatePayload: {
            variantOrdinal: 3,
            storageBucket: "cco-renders",
            storageObjectKey: `scenes/${sceneId}/c2-3.png`,
            contentHashSha256: "c200000000000000000000000000000000000000000000000000000000000003",
            generationPayload: { seed: 103 }
          }
        }
      })
    ]);

    // Step 6: Assertions
    expect(staleRetryRes.statusCode).toBe(200);
    expect(staleRetryRes.json().outcome).toBe("already_applied");
    expect(finalCompleteRes.statusCode).toBe(200);
    expect(finalCompleteRes.json().outcome).toBe("applied");

    reviewRes = await app.inject({ method: "GET", url: `/api/scenes/${sceneId}/review` });
    expect(reviewRes.statusCode).toBe(200);
    const finalReviewBody = reviewRes.json() as SceneReviewDetailReadModel;
    expect(finalReviewBody.status).toBe("director_review");
    // specRevision is 3: the prompt_edit in step 2 bumped 1 -> 2, and the
    // reroll in step 3 bumps 2 -> 3 (Scene.requestReroll() increments
    // specRevision as of #179 — see packages/domain/src/scene.ts).
    expect(finalReviewBody.specRevision).toBe(3);

    // Review candidates are grouped by spec revision. Cycle-1 has 2 candidates
    // at revision 1, and cycle-2 has all 3 candidates at revision 3 (the
    // revision reroll actually left active; revision 2 was never used for any
    // real candidate generation batch — its prompt_edit was immediately
    // superseded by the reroll before any job could complete under it).
    expect(finalReviewBody.candidatesByRevision).toHaveLength(2);
    const rev1Group = finalReviewBody.candidatesByRevision.find((g) => g.specRevision === 1);
    expect(rev1Group).toBeDefined();
    expect(rev1Group?.candidates).toHaveLength(2);

    const activeCandidates = finalReviewBody.candidatesByRevision.find((g) => g.specRevision === 3);
    expect(activeCandidates).toBeDefined();
    expect(activeCandidates?.specRevision).toBe(3);
    expect(activeCandidates?.candidates).toHaveLength(3);
    const ordinals = activeCandidates!.candidates.map((c) => c.variantOrdinal).sort();
    expect(ordinals).toEqual([1, 2, 3]);
    for (const c of activeCandidates!.candidates) {
      expect(c.specRevision).toBe(3);
    }

    // Direct DB check on storyboard_candidates
    const candidatesInDb = await client.query<{ variant_ordinal: number }>(
      "SELECT variant_ordinal FROM storyboard_candidates WHERE scene_id = $1 AND scene_spec_revision = 3 ORDER BY variant_ordinal ASC",
      [sceneId]
    );
    expect(candidatesInDb.rows).toHaveLength(3);
    expect(candidatesInDb.rows.map((r) => r.variant_ordinal)).toEqual([1, 2, 3]);
  });

  it("creates a scene via cloud planning with allowCloudPlanning: true, landing in PostgreSQL in draft_pending state", async () => {
    const cloudPolicy = {
      allowCloudPlanning: true,
      allowCloudVisualQA: true,
      allowCloudVoice: true,
      allowedProviders: ["Anthropic", "OpenAI"],
      sensitiveDataMasking: true
    };
    const clientRecord = await insertClientRecord(client, {
      companyName: "Cloud Planning Client",
      externalProcessingPolicy: cloudPolicy
    });

    const plannedConfig = {
      prompt: "AI planned prompt: Trinidad carnival dancer in plumage at sunrise",
      referenceIds: [],
      engineProfileId: "LTX_25_720P_5S_V1",
      durationMs: 5000,
      loraConfigurationId: null
    };

    const mockPrimary: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: async () => ({
        kind: "success",
        rawText: JSON.stringify(plannedConfig)
      })
    };
    const mockFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: async () => ({
        kind: "success",
        rawText: JSON.stringify(plannedConfig)
      })
    };
    const mockAssetRepo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: async () => []
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    // 1. POST /api/campaigns
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "AI Planned Campaign",
        targetPlatform: "tiktok",
        totalScenes: 1
      }
    });
    expect(campaignRes.statusCode).toBe(201);
    const campaignBody = campaignRes.json();

    // 2. POST /api/campaigns/:campaignId/scenes with creative brief
    const sceneRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignBody.campaignId}/scenes`,
      payload: {
        brief: {
          title: "Carnival Sunrise",
          description: "High energy commercial intro with vibrant summer vibes",
          targetPlatform: "tiktok"
        }
      }
    });

    expect(sceneRes.statusCode).toBe(201);
    const sceneBody = sceneRes.json();
    expect(sceneBody.sceneId).toBeDefined();
    expect(sceneBody.campaignId).toBe(campaignBody.campaignId);
    expect(sceneBody.status).toBe("draft_pending");
    expect(sceneBody.configuration).toEqual(plannedConfig);

    // Verify scene landed in PostgreSQL
    const sceneRepo = new PostgresSceneRepository(pool);
    const reconstitutedScene = await sceneRepo.findById(sceneBody.sceneId as SceneId);
    expect(reconstitutedScene).toBeDefined();
    expect(reconstitutedScene?.snapshot().campaignId).toBe(campaignBody.campaignId);
    expect(reconstitutedScene?.snapshot().status).toBe("draft_pending");
    expect(reconstitutedScene?.snapshot().configuration).toEqual(plannedConfig);
  });

  it("proposes beat sheet and creates approved scenes with targetDurationMs preserved in PostgreSQL", async () => {
    const cloudPolicy = {
      allowCloudPlanning: true,
      allowCloudVisualQA: true,
      allowCloudVoice: true,
      allowedProviders: ["Anthropic", "OpenAI"],
      sensitiveDataMasking: true
    };
    const clientRecord = await insertClientRecord(client, {
      companyName: "Beat Sheet Integration Client",
      externalProcessingPolicy: cloudPolicy
    });

    const beatSheetPayload = {
      beats: [
        {
          ordinal: 1,
          brief: {
            title: "Beat 1 Opening",
            description: "Opening hook of high energy commercial"
          },
          targetDurationMs: 2500
        },
        {
          ordinal: 2,
          brief: {
            title: "Beat 2 Climax",
            description: "Climax shot with vibrant colors"
          },
          targetDurationMs: 3500
        }
      ]
    };

    let callCount = 0;
    const mockPrimary: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: async (req) => {
        callCount++;
        if (callCount === 1) {
          return {
            kind: "success",
            rawText: JSON.stringify(beatSheetPayload)
          };
        }
        let durationMs = 2500;
        if (req.userPrompt.includes("Climax")) {
          durationMs = 3500;
        }
        return {
          kind: "success",
          rawText: JSON.stringify({
            prompt: "Scene prompt from LLM",
            referenceIds: [],
            engineProfileId: "LTX_25_720P_5S_V1",
            durationMs,
            loraConfigurationId: null
          })
        };
      }
    };
    const mockFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: async () => ({ kind: "retryable_failure", message: "unused" })
    };
    const mockAssetRepo: ReferenceAssetRepository = {
      listBySceneId: async () => [],
      findByIds: async () => []
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    // 1. Create campaign with totalScenes = 2
    const campaignRes = await app.inject({
      method: "POST",
      url: "/api/campaigns",
      payload: {
        clientId: clientRecord.client_id,
        title: "Beat Sheet Flow Campaign",
        targetPlatform: "tiktok",
        totalScenes: 2
      }
    });
    expect(campaignRes.statusCode).toBe(201);
    const campaignBody = campaignRes.json();

    // 2. Propose beat sheet
    const beatSheetRes = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignBody.campaignId}/beat-sheet`,
      payload: {
        brief: {
          description: "Campaign-level creative idea"
        },
        targetTotalDurationMs: 6000
      }
    });
    expect(beatSheetRes.statusCode).toBe(200);
    const beatSheet = beatSheetRes.json();
    expect(beatSheet.beats).toHaveLength(2);
    expect(beatSheet.beats[0]?.targetDurationMs).toBe(2500);
    expect(beatSheet.beats[1]?.targetDurationMs).toBe(3500);

    // Verify zero scenes in DB before scenes are submitted
    const scenesBefore = await client.query(
      "SELECT * FROM storyboard_scenes WHERE campaign_id = $1",
      [campaignBody.campaignId]
    );
    expect(scenesBefore.rows).toHaveLength(0);

    // 3. Create scenes one by one using approved beats and their targetDurationMs
    const createdSceneIds: SceneId[] = [];
    for (const beat of beatSheet.beats) {
      const sceneRes = await app.inject({
        method: "POST",
        url: `/api/campaigns/${campaignBody.campaignId}/scenes`,
        payload: {
          brief: beat.brief,
          targetDurationMs: beat.targetDurationMs
        }
      });
      expect(sceneRes.statusCode).toBe(201);
      const sceneBody = sceneRes.json();
      expect(sceneBody.configuration.durationMs).toBe(beat.targetDurationMs);
      createdSceneIds.push(sceneBody.sceneId as SceneId);
    }

    // 4. Verify PostgreSQL persistence and duration preservation
    expect(createdSceneIds).toHaveLength(2);
    const sceneRepo = new PostgresSceneRepository(pool);
    const scene1 = await sceneRepo.findById(createdSceneIds[0]!);
    expect(scene1).toBeDefined();
    expect(scene1?.snapshot().configuration.durationMs).toBe(2500);

    const scene2 = await sceneRepo.findById(createdSceneIds[1]!);
    expect(scene2).toBeDefined();
    expect(scene2?.snapshot().configuration.durationMs).toBe(3500);
  });
});
