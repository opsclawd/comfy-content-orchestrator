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
import { createControlApiApp } from "./app.js";

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
      companyName: "Acme Productions"
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
      companyName: "Acme Productions"
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
});
