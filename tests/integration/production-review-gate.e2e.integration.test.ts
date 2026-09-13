import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
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
  PostgresDeliveryAssemblyJobQueue,
  PostgresGenerationManifestRepository,
  PostgresCurrentProductionAttemptQueries,
  S3ObjectStorage,
  S3ReviewMediaDelivery,
  FfmpegMediaAssemblerAdapter,
  JsonFileLicenseRegistryPort
} from "@cco/infrastructure";
import { AssembleDeliveryReel, EnforceLicenseRouting } from "@cco/application";
import type { CandidateId, DeliveryAssemblyJob } from "@cco/domain";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import type {
  ReviewCommandResponse,
  CurrentProductionAttemptReadModel,
  AssemblySpec
} from "@cco/contracts";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";
import { generateSyntheticStems } from "../../packages/infrastructure/src/ffmpeg/test-support/synthetic-stem-fixtures.js";

const DEFAULT_DISPATCH_CONFIG = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

const FAKE_STORAGE_TELEMETRY = {
  getStorageTelemetry: async () => ({
    totalBytes: 1_000_000_000,
    usedBytes: 100_000_000,
    freeBytes: 900_000_000,
    buckets: [],
    measuredAt: "2026-09-01T00:00:00.000Z"
  })
};

describe("Production Review Gate End-to-End Integration (#266)", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let client: PoolClient;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let reviewMediaDelivery: S3ReviewMediaDelivery;
  let fixtureDir: string;
  let assemblyWorkspaceRoot: string;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

  beforeAll(async () => {
    [postgresContainer, minioContainer] = await Promise.all([
      startPostgres18Container(),
      startMinioContainer()
    ]);

    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });

    rawS3Client = new S3Client({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    for (const bucket of BUCKET_NAMES) {
      try {
        await rawS3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: unknown) {
        const errorName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (errorName !== "BucketAlreadyExists" && errorName !== "BucketAlreadyOwnedByYou") {
          throw err;
        }
      }
    }

    objectStorage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    reviewMediaDelivery = new S3ReviewMediaDelivery({
      signingEndpoint: minioContainer.getEndpoint(),
      storageEndpoint: minioContainer.getEndpoint(),
      client: rawS3Client,
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "cco-review-gate-fixtures-"));
    assemblyWorkspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cco-review-gate-workspace-"));
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
    if (minioContainer) {
      await minioContainer.stop();
    }
    if (fixtureDir) {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
    if (assemblyWorkspaceRoot) {
      await fs.rm(assemblyWorkspaceRoot, { recursive: true, force: true });
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
    const currentProductionAttemptQueries = new PostgresCurrentProductionAttemptQueries(pool);

    return createControlApiApp(
      {
        uow,
        jobQueue,
        deliveryAssemblyJobQueue,
        storageTelemetry: FAKE_STORAGE_TELEMETRY,
        reviewMediaDelivery,
        currentProductionAttemptQueries
      },
      {
        reviewerIdentityResolver: {
          resolve: () => "Director Thomas"
        },
        jobDispatch: DEFAULT_DISPATCH_CONFIG
      }
    );
  }

  it("proves complete production-review gate end to end across all application boundaries", async () => {
    const app = createTestApp();

    // -------------------------------------------------------------------------
    // Phase 1: Materialize Storyboard and Approved Visual Conditioning (#214)
    // -------------------------------------------------------------------------
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 2,
      status: "drafting"
    });

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

    const candidate1Id = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as CandidateId;
    const candidate2Id = "01950c46-9e90-7d3d-82d2-8f1d3c000002" as CandidateId;

    const candidatePngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    const candidateSha = createHash("sha256").update(candidatePngBytes).digest("hex");

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: `scenes/${scene1.scene_id}/candidates/${candidate1Id}.png`,
        Body: candidatePngBytes,
        ContentType: "image/png"
      })
    );
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: `scenes/${scene2.scene_id}/candidates/${candidate2Id}.png`,
        Body: candidatePngBytes,
        ContentType: "image/png"
      })
    );

    await insertStoryboardCandidateRecord(client, {
      candidateId: candidate1Id,
      sceneId: scene1.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: BUCKETS.REVIEW,
      storageObjectKey: `scenes/${scene1.scene_id}/candidates/${candidate1Id}.png`,
      contentHashSha256: candidateSha
    });

    await insertStoryboardCandidateRecord(client, {
      candidateId: candidate2Id,
      sceneId: scene2.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: BUCKETS.REVIEW,
      storageObjectKey: `scenes/${scene2.scene_id}/candidates/${candidate2Id}.png`,
      contentHashSha256: candidateSha
    });

    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [candidate1Id, scene1.scene_id]
    );
    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [candidate2Id, scene2.scene_id]
    );

    // Approve Scene 1: campaign remains drafting, no production run dispatched yet
    const approve1Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000011",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });
    expect(approve1Res.statusCode).toBe(200);

    let runsDb = await client.query(
      "SELECT * FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runsDb.rows).toHaveLength(0);

    // Approve Scene 2: completes campaign approval and triggers production dispatch
    const approve2Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000012",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });
    expect(approve2Res.statusCode).toBe(200);

    // Verify campaign and CampaignProductionRun status
    runsDb = await client.query<{
      run_id: string;
      status: string;
      assembly_job_id: string | null;
      expected_total_duration_ms: number;
    }>("SELECT * FROM campaign_production_runs WHERE campaign_id = $1", [campaign.campaign_id]);
    expect(runsDb.rows).toHaveLength(1);
    const runId = runsDb.rows[0]!.run_id;
    expect(runsDb.rows[0]!.status).toBe("dispatched");
    expect(runsDb.rows[0]!.assembly_job_id).toBeNull();
    expect(runsDb.rows[0]!.expected_total_duration_ms).toBe(8000);

    // Verify #214 conditioned I2V profile identity on dispatched render jobs
    const jobsDb = await client.query<{
      job_id: string;
      scene_id: string;
      job_kind: string;
      workflow_template: string;
      injected_payload: {
        prompt: string;
        seed: number;
        approvedCandidateId: string;
        frameCount?: number;
      };
    }>("SELECT * FROM render_jobs WHERE job_kind = 'production' ORDER BY created_at ASC");
    expect(jobsDb.rows).toHaveLength(2);

    for (const job of jobsDb.rows) {
      expect(job.workflow_template).toBe("ltx-25-720p-97f-i2v");
      const expectedCandId = job.scene_id === scene1.scene_id ? candidate1Id : candidate2Id;
      expect(job.injected_payload.approvedCandidateId).toBe(expectedCandId);
      expect(typeof job.injected_payload.seed).toBe("number");
    }

    // -------------------------------------------------------------------------
    // Phase 2: Render Execution & Review Gating (No Auto-Assembly)
    // -------------------------------------------------------------------------
    // Generate deterministic synthetic MP4 video stems using pinned FFmpeg
    const syntheticStems = await generateSyntheticStems({
      ffmpegPath: "ffmpeg",
      outputDir: path.join(fixtureDir, "narrative-stems"),
      count: 3,
      durationSec: 4.0,
      width: 1280,
      height: 720,
      fps: 24,
      format: "mp4"
    });
    const stem1 = syntheticStems[0]!;
    const stem2 = syntheticStems[1]!;
    const stem1Rerender = syntheticStems[2]!;

    // Claim, start, and complete Job 1 (Scene 1)
    const claim1 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-narrative-1" }
    });
    expect(claim1.statusCode).toBe(200);
    const claimedJob1 = claim1.json<{ jobId: string; leaseToken: string; sceneId: string }>();

    await app.inject({
      method: "POST",
      url: `/api/jobs/${claimedJob1.jobId}/start`,
      payload: { leaseToken: claimedJob1.leaseToken }
    });

    const stem1Key = `campaigns/${campaign.campaign_id}/scenes/${scene1.scene_id}/output-attempt-1.mp4`;
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.DELIVERY,
        Key: stem1Key,
        Body: stem1.bytes,
        ContentType: "video/mp4"
      })
    );

    const comp1 = await app.inject({
      method: "POST",
      url: `/api/jobs/${claimedJob1.jobId}/complete`,
      payload: {
        leaseToken: claimedJob1.leaseToken,
        manifestPayload: {
          promptIdComfy: `prompt-${claimedJob1.jobId}`,
          renderProfile: "LTX_25_720P_5S_I2V_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: BUCKETS.DELIVERY,
              key: stem1Key,
              checksumSha256: stem1.sha256,
              contentType: "video/mp4"
            }
          ]
        }
      }
    });
    expect(comp1.statusCode).toBe(200);

    // Scene 1 is in QA, but campaign is still rendering and zero assembly jobs exist
    const scene1Db = await client.query<{ status: string }>(
      "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
      [scene1.scene_id]
    );
    expect(scene1Db.rows[0]!.status).toBe("qa");

    let assemblyJobsDb = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobsDb.rows).toHaveLength(0);

    // Claim, start, and complete Job 2 (Scene 2)
    const claim2 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-narrative-1" }
    });
    expect(claim2.statusCode).toBe(200);
    const claimedJob2 = claim2.json<{ jobId: string; leaseToken: string; sceneId: string }>();

    await app.inject({
      method: "POST",
      url: `/api/jobs/${claimedJob2.jobId}/start`,
      payload: { leaseToken: claimedJob2.leaseToken }
    });

    const stem2Key = `campaigns/${campaign.campaign_id}/scenes/${scene2.scene_id}/output-attempt-1.mp4`;
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.DELIVERY,
        Key: stem2Key,
        Body: stem2.bytes,
        ContentType: "video/mp4"
      })
    );

    const comp2 = await app.inject({
      method: "POST",
      url: `/api/jobs/${claimedJob2.jobId}/complete`,
      payload: {
        leaseToken: claimedJob2.leaseToken,
        manifestPayload: {
          promptIdComfy: `prompt-${claimedJob2.jobId}`,
          renderProfile: "LTX_25_720P_5S_I2V_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: BUCKETS.DELIVERY,
              key: stem2Key,
              checksumSha256: stem2.sha256,
              contentType: "video/mp4"
            }
          ]
        }
      }
    });
    expect(comp2.statusCode).toBe(200);

    // Both scenes are now in QA. Verify CampaignProductionRun entered production_review with ZERO auto-assembly
    const campDb = await client.query<{ status: string }>(
      "SELECT status FROM campaigns WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(campDb.rows[0]!.status).toBe("qa");

    runsDb = await client.query<{ status: string; assembly_job_id: string | null }>(
      "SELECT status, assembly_job_id FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runsDb.rows[0]!.status).toBe("production_review");
    expect(runsDb.rows[0]!.assembly_job_id).toBeNull();

    assemblyJobsDb = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobsDb.rows).toHaveLength(0);

    // -------------------------------------------------------------------------
    // Phase 3: Review Media Read Path & Playable Presigned URLs
    // -------------------------------------------------------------------------
    const readAttempt1 = await app.inject({
      method: "GET",
      url: `/api/scenes/${scene1.scene_id}/production-attempt`
    });
    expect(readAttempt1.statusCode).toBe(200);

    const readAttempt1ByRun = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/runs/${runId}/scenes/${scene1.scene_id}/production-attempt`
    });
    expect(readAttempt1ByRun.statusCode).toBe(200);
    expect(readAttempt1ByRun.json<CurrentProductionAttemptReadModel>().productionJobId).toBe(
      claimedJob1.jobId
    );

    const attempt1Data = readAttempt1.json<CurrentProductionAttemptReadModel>();
    expect(attempt1Data.technicalState).toBe("completed");
    expect(attempt1Data.reviewReady).toBe(true);
    expect(attempt1Data.availability).toBe("available");
    expect(attempt1Data.attemptOrdinal).toBe(1);
    expect(attempt1Data.productionJobId).toBe(claimedJob1.jobId);
    expect(attempt1Data.media?.url).toBeDefined();

    // Verify the presigned media URL fetches the real bytes from MinIO
    const fetchedMedia = await fetch(attempt1Data.media!.url);
    expect(fetchedMedia.status).toBe(200);
    const mediaBytes = Buffer.from(await fetchedMedia.arrayBuffer());
    expect(mediaBytes).toEqual(stem1.bytes);

    // -------------------------------------------------------------------------
    // Phase 4: Creative Re-render, Lineage & Provenance Preservation
    // -------------------------------------------------------------------------
    // Snapshot state before re-render
    const preRerenderScene = await client.query<{
      spec_revision: number;
      selected_candidate_id: string;
      selected_candidate_revision: number;
      approved_revision: number;
      active_production_job_id: string;
    }>(
      "SELECT spec_revision, selected_candidate_id, selected_candidate_revision, approved_revision, active_production_job_id FROM storyboard_scenes WHERE scene_id = $1",
      [scene1.scene_id]
    );
    expect(preRerenderScene.rows[0]!.spec_revision).toBe(1);
    expect(preRerenderScene.rows[0]!.selected_candidate_id).toBe(candidate1Id);
    expect(preRerenderScene.rows[0]!.selected_candidate_revision).toBe(1);
    expect(preRerenderScene.rows[0]!.approved_revision).toBe(1);
    expect(preRerenderScene.rows[0]!.active_production_job_id).toBe(claimedJob1.jobId);

    // Request creative re-render for Scene 1
    const rerenderRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000031",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "production_rerender",
        payload: {
          expectedProductionJobId: claimedJob1.jobId
        },
        directorNotes: "Needs dynamic camera movement"
      }
    });
    expect(rerenderRes.statusCode).toBe(200);
    const rerenderBody = rerenderRes.json<ReviewCommandResponse>();
    expect(rerenderBody.status).toBe("queued");
    expect(rerenderBody.isIdempotentReplay).toBe(false);
    expect(rerenderBody.activeProductionJobId).toBeDefined();
    expect(rerenderBody.activeProductionJobId).not.toBe(claimedJob1.jobId);
    const rerenderJobId = rerenderBody.activeProductionJobId!;

    // Assert SceneSpec revision, selected candidate, and approval were preserved intact
    const postRerenderScene = await client.query<{
      status: string;
      spec_revision: number;
      selected_candidate_id: string;
      selected_candidate_revision: number;
      approved_revision: number;
      active_production_job_id: string;
      production_attempt_ordinal: number;
    }>(
      "SELECT status, spec_revision, selected_candidate_id, selected_candidate_revision, approved_revision, active_production_job_id, production_attempt_ordinal FROM storyboard_scenes WHERE scene_id = $1",
      [scene1.scene_id]
    );
    expect(postRerenderScene.rows[0]!.status).toBe("queued");
    expect(postRerenderScene.rows[0]!.spec_revision).toBe(1);
    expect(postRerenderScene.rows[0]!.selected_candidate_id).toBe(candidate1Id);
    expect(postRerenderScene.rows[0]!.selected_candidate_revision).toBe(1);
    expect(postRerenderScene.rows[0]!.approved_revision).toBe(1);
    expect(postRerenderScene.rows[0]!.active_production_job_id).toBe(rerenderJobId);
    expect(postRerenderScene.rows[0]!.production_attempt_ordinal).toBe(2);

    // Verify historical attempt provenance preserved in production_attempts
    const attemptsDb = await client.query<{
      ordinal: number;
      production_job_id: string;
    }>(
      "SELECT ordinal, production_job_id FROM production_attempts WHERE scene_id = $1 ORDER BY ordinal ASC",
      [scene1.scene_id]
    );
    expect(attemptsDb.rows).toHaveLength(2);
    expect(attemptsDb.rows[0]!.ordinal).toBe(1);
    expect(attemptsDb.rows[0]!.production_job_id).toBe(claimedJob1.jobId);
    expect(attemptsDb.rows[1]!.ordinal).toBe(2);
    expect(attemptsDb.rows[1]!.production_job_id).toBe(rerenderJobId);

    // -------------------------------------------------------------------------
    // Phase 5: Idempotent Command Replay
    // -------------------------------------------------------------------------
    // Idempotent replay of production_rerender with identical actionId succeeds without duplicate jobs
    const rerenderReplayRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000031",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "production_rerender",
        payload: {
          expectedProductionJobId: claimedJob1.jobId
        },
        directorNotes: "Needs dynamic camera movement"
      }
    });
    expect(rerenderReplayRes.statusCode).toBe(200);
    expect(rerenderReplayRes.json<ReviewCommandResponse>().isIdempotentReplay).toBe(true);

    const attemptsCountAfterReplay = await client.query(
      "SELECT count(*) FROM production_attempts WHERE scene_id = $1",
      [scene1.scene_id]
    );
    expect(Number(attemptsCountAfterReplay.rows[0]!.count)).toBe(2);

    // -------------------------------------------------------------------------
    // Phase 6: Complete Re-render, Attempt-Fenced Acceptance & Admission Gating
    // -------------------------------------------------------------------------
    // Claim and complete the re-rendered job (Attempt 2)
    const claimRerender = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-narrative-1" }
    });
    expect(claimRerender.statusCode).toBe(200);
    const claimedRerender = claimRerender.json<{ jobId: string; leaseToken: string }>();
    expect(claimedRerender.jobId).toBe(rerenderJobId);

    await app.inject({
      method: "POST",
      url: `/api/jobs/${claimedRerender.jobId}/start`,
      payload: { leaseToken: claimedRerender.leaseToken }
    });

    const stem1RerenderKey = `campaigns/${campaign.campaign_id}/scenes/${scene1.scene_id}/output-attempt-2.mp4`;
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.DELIVERY,
        Key: stem1RerenderKey,
        Body: stem1Rerender.bytes,
        ContentType: "video/mp4"
      })
    );

    const compRerender = await app.inject({
      method: "POST",
      url: `/api/jobs/${claimedRerender.jobId}/complete`,
      payload: {
        leaseToken: claimedRerender.leaseToken,
        manifestPayload: {
          promptIdComfy: `prompt-${claimedRerender.jobId}`,
          renderProfile: "LTX_25_720P_5S_I2V_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: BUCKETS.DELIVERY,
              key: stem1RerenderKey,
              checksumSha256: stem1Rerender.sha256,
              contentType: "video/mp4"
            }
          ]
        }
      }
    });
    expect(compRerender.statusCode).toBe(200);

    // Verify the read path now resolves Attempt 2
    const readAttempt2 = await app.inject({
      method: "GET",
      url: `/api/scenes/${scene1.scene_id}/production-attempt`
    });
    expect(readAttempt2.statusCode).toBe(200);
    const attempt2Data = readAttempt2.json<CurrentProductionAttemptReadModel>();
    expect(attempt2Data.attemptOrdinal).toBe(2);
    expect(attempt2Data.productionJobId).toBe(rerenderJobId);
    expect(attempt2Data.reviewReady).toBe(true);

    // Stale production_accept referencing superseded job 1 fails even though specRevision is current (1)
    const staleAcceptRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000032",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: claimedJob1.jobId
        }
      }
    });
    expect(staleAcceptRes.statusCode).toBe(409);
    expect(staleAcceptRes.json().code).toBe("STALE_PRODUCTION_ATTEMPT_CONFLICT");

    // Accept Scene 1 (Attempt 2)
    const accept1Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000041",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: rerenderJobId
        },
        directorNotes: "Camera movement is spot on!"
      }
    });
    expect(accept1Res.statusCode).toBe(200);
    const accept1Body = accept1Res.json<ReviewCommandResponse>();
    expect(accept1Body.status).toBe("completed");
    expect(accept1Body.acceptedAttemptOrdinal).toBe(2);

    // Verify Scene 1 acceptedAttemptId points to attempt 2, never superseded attempt 1
    const runScene1Db = await client.query<{
      accepted_attempt_ordinal: number;
      accepted_production_job_id: string;
    }>(
      "SELECT accepted_attempt_ordinal, accepted_production_job_id FROM campaign_production_run_scenes WHERE scene_id = $1",
      [scene1.scene_id]
    );
    expect(runScene1Db.rows[0]!.accepted_attempt_ordinal).toBe(2);
    expect(runScene1Db.rows[0]!.accepted_production_job_id).toBe(rerenderJobId);

    // Scene 2 is still unaccepted; assert ZERO assembly jobs enqueued
    assemblyJobsDb = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobsDb.rows).toHaveLength(0);

    // Accept final Scene 2 (Attempt 1)
    const accept2Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000042",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: claimedJob2.jobId
        },
        directorNotes: "Approved for final assembly"
      }
    });
    expect(accept2Res.statusCode).toBe(200);

    // Verify all required scenes accepted triggers assembly admission atomically
    runsDb = await client.query<{ status: string; assembly_job_id: string | null }>(
      "SELECT status, assembly_job_id FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runsDb.rows[0]!.status).toBe("assembling");
    expect(runsDb.rows[0]!.assembly_job_id).not.toBeNull();
    const assemblyJobId = runsDb.rows[0]!.assembly_job_id!;

    // Verify exactly ONE delivery assembly job enqueued
    assemblyJobsDb = await client.query<{
      job_id: string;
      assembly_spec: AssemblySpec;
    }>("SELECT job_id, assembly_spec FROM delivery_assembly_jobs WHERE campaign_id = $1", [
      campaign.campaign_id
    ]);
    expect(assemblyJobsDb.rows).toHaveLength(1);
    expect(assemblyJobsDb.rows[0]!.job_id).toBe(assemblyJobId);

    // Replay final acceptance command: idempotent replay produces NO duplicate assembly job
    const accept2ReplayRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000042",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: claimedJob2.jobId
        },
        directorNotes: "Approved for final assembly"
      }
    });
    expect(accept2ReplayRes.statusCode).toBe(200);
    expect(accept2ReplayRes.json<ReviewCommandResponse>().isIdempotentReplay).toBe(true);

    const assemblyJobsAfterReplay = await client.query(
      "SELECT count(*) FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(Number(assemblyJobsAfterReplay.rows[0]!.count)).toBe(1);

    // -------------------------------------------------------------------------
    // Phase 7: Canonical Stem Order & Real FFmpeg Delivery Assembly Execution
    // -------------------------------------------------------------------------
    const assemblySpec = assemblyJobsDb.rows[0]!.assembly_spec;
    expect(assemblySpec.videoStems).toHaveLength(2);
    // Canonical ordering: Stem 0 is Scene 1 (with Attempt 2 generation manifest), Stem 1 is Scene 2
    expect(assemblySpec.videoStems[0]!.order).toBe(0);
    expect(assemblySpec.videoStems[0]!.sceneId).toBe(scene1.scene_id);
    expect(assemblySpec.videoStems[1]!.order).toBe(1);
    expect(assemblySpec.videoStems[1]!.sceneId).toBe(scene2.scene_id);

    // Wire real delivery assembly worker with pinned FFmpeg
    const licenseRegistryPath = path.resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "../../config/component-license-registry.json"
    );
    const licenseRegistry = JsonFileLicenseRegistryPort.fromFile(licenseRegistryPath);
    const enforceLicenseRouting = new EnforceLicenseRouting({ registry: licenseRegistry });
    const generationManifestRepository = new PostgresGenerationManifestRepository(pool);
    const mediaAssembler = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot: assemblyWorkspaceRoot,
      outputBucket: BUCKETS.DELIVERY,
      objectStorage
    });
    const runtimeComponents = await mediaAssembler.getRuntimeComponents();

    const assembleDeliveryReel = new AssembleDeliveryReel({
      mediaAssembler,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository,
      runtimeComponents
    });

    // Worker claims delivery assembly job
    const claimAssembly = await app.inject({
      method: "POST",
      url: "/api/delivery-assembly-jobs/claim",
      payload: { workerId: "assembly-worker-narrative" }
    });
    expect(claimAssembly.statusCode).toBe(200);
    const claimedAssembly = claimAssembly.json<DeliveryAssemblyJob<AssemblySpec>>();
    expect(claimedAssembly.jobId).toBe(assemblyJobId);

    // Start delivery assembly job
    await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${claimedAssembly.jobId}/start`,
      payload: { leaseToken: claimedAssembly.leaseToken }
    });

    // Execute real delivery reel assembly with pinned FFmpeg
    const assemblyExecution = await assembleDeliveryReel.assemble({
      spec: claimedAssembly.assemblySpec
    });
    expect(assemblyExecution.manifest).toBeDefined();
    expect(assemblyExecution.executionResult.output).toBeDefined();
    expect(assemblyExecution.executionResult.output.media).toBeDefined();

    // Verify AssemblyManifest preserves canonical input stem order and accepted attempt provenance
    expect(assemblyExecution.manifest.inputs.videoStems).toHaveLength(2);
    expect(assemblyExecution.manifest.inputs.videoStems[0]!.sceneId).toBe(scene1.scene_id);
    expect(assemblyExecution.manifest.inputs.videoStems[0]!.generationManifestId).toBe(
      assemblySpec.videoStems[0]!.generationManifestId
    );
    expect(assemblyExecution.manifest.inputs.videoStems[1]!.sceneId).toBe(scene2.scene_id);
    expect(assemblyExecution.manifest.inputs.videoStems[1]!.generationManifestId).toBe(
      assemblySpec.videoStems[1]!.generationManifestId
    );

    // Complete delivery assembly job
    const compAssembly = await app.inject({
      method: "POST",
      url: `/api/delivery-assembly-jobs/${claimedAssembly.jobId}/complete`,
      payload: { leaseToken: claimedAssembly.leaseToken }
    });
    expect(compAssembly.statusCode).toBe(200);

    // Assert final transition: Campaign and CampaignProductionRun reach completed status
    const finalRunDb = await client.query<{ status: string }>(
      "SELECT status FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(finalRunDb.rows[0]!.status).toBe("completed");

    const finalCampDb = await client.query<{ status: string }>(
      "SELECT status FROM campaigns WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(finalCampDb.rows[0]!.status).toBe("completed");

    await app.close();
  });

  it("fails closed without assembly enqueue when accepted attempt invariants are violated", async () => {
    const app = createTestApp();

    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 2,
      status: "drafting"
    });

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

    const candidate1Id = "01950c46-9e90-7d3d-82d2-8f1d3c000051" as CandidateId;
    const candidate2Id = "01950c46-9e90-7d3d-82d2-8f1d3c000052" as CandidateId;

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

    // Approve both scenes
    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000061",
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
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000062",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });

    // Complete Job 1 and Job 2
    const claim1 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-invariants" }
    });
    const job1 = claim1.json<{ jobId: string; leaseToken: string }>();
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job1.jobId}/start`,
      payload: { leaseToken: job1.leaseToken }
    });
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job1.jobId}/complete`,
      payload: {
        leaseToken: job1.leaseToken,
        manifestPayload: {
          promptIdComfy: `prompt-${job1.jobId}`,
          renderProfile: "LTX_25_720P_5S_I2V_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: BUCKETS.DELIVERY,
              key: `out1.mp4`,
              checksumSha256: "1".repeat(64),
              contentType: "video/mp4"
            }
          ]
        }
      }
    });

    const claim2 = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-invariants" }
    });
    const job2 = claim2.json<{ jobId: string; leaseToken: string }>();
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job2.jobId}/start`,
      payload: { leaseToken: job2.leaseToken }
    });
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job2.jobId}/complete`,
      payload: {
        leaseToken: job2.leaseToken,
        manifestPayload: {
          promptIdComfy: `prompt-${job2.jobId}`,
          renderProfile: "LTX_25_720P_5S_I2V_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: BUCKETS.DELIVERY,
              key: `out2.mp4`,
              checksumSha256: "2".repeat(64),
              contentType: "video/mp4"
            }
          ]
        }
      }
    });

    // Accept Scene 1
    const accept1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000063",
        sceneId: scene1.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: job1.jobId
        }
      }
    });
    expect(accept1.statusCode).toBe(200);

    // Tamper with Scene 1's attempt in DB: alter spec_revision to create an invariant mismatch
    await client.query(
      "UPDATE production_attempts SET spec_revision = 999 WHERE production_job_id = $1",
      [job1.jobId]
    );

    // Now attempt to accept final Scene 2 (which triggers attemptEnqueueAssemblyForAcceptedRun)
    const accept2Failing = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000064",
        sceneId: scene2.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: job2.jobId
        }
      }
    });

    // Invariant failure aborts the transaction (500 internal invariant failure)
    expect(accept2Failing.statusCode).toBe(500);

    // Fail-closed verification: Scene 2 was NOT marked completed/accepted in DB
    const scene2Db = await client.query<{
      status: string;
      accepted_production_attempt_id: string | null;
    }>("SELECT status, accepted_production_attempt_id FROM storyboard_scenes WHERE scene_id = $1", [
      scene2.scene_id
    ]);
    expect(scene2Db.rows[0]!.status).toBe("qa");
    expect(scene2Db.rows[0]!.accepted_production_attempt_id).toBeNull();

    // Fail-closed verification: Run status remains production_review and zero assembly jobs enqueued
    const runsDb = await client.query<{ status: string; assembly_job_id: string | null }>(
      "SELECT status, assembly_job_id FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(runsDb.rows[0]!.status).toBe("production_review");
    expect(runsDb.rows[0]!.assembly_job_id).toBeNull();

    const assemblyJobsDb = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobsDb.rows).toHaveLength(0);

    await app.close();
  });

  it("proves legacy QA reject fails closed against production run assembly", async () => {
    const app = createTestApp();

    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 1,
      status: "drafting"
    });

    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "director_review"
    });

    const candidateId = "01950c46-9e90-7d3d-82d2-8f1d3c000071" as CandidateId;
    await insertStoryboardCandidateRecord(client, {
      candidateId,
      sceneId: scene.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });
    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [candidateId, scene.scene_id]
    );

    // Approve scene to trigger production run
    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000072",
        sceneId: scene.scene_id,
        expectedSpecRevision: 1,
        action: "approve",
        payload: {}
      }
    });

    // Claim and complete render job to enter QA
    const claim = await app.inject({
      method: "POST",
      url: "/api/jobs/claim",
      payload: { workerId: "worker-reject" }
    });
    const job = claim.json<{ jobId: string; leaseToken: string }>();
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job.jobId}/start`,
      payload: { leaseToken: job.leaseToken }
    });
    await app.inject({
      method: "POST",
      url: `/api/jobs/${job.jobId}/complete`,
      payload: {
        leaseToken: job.leaseToken,
        manifestPayload: {
          promptIdComfy: `prompt-${job.jobId}`,
          renderProfile: "LTX_25_720P_5S_I2V_V1",
          renderProfileVersion: 1,
          outputs: [
            {
              bucket: BUCKETS.DELIVERY,
              key: `out-reject.mp4`,
              checksumSha256: "3".repeat(64),
              contentType: "video/mp4"
            }
          ]
        }
      }
    });

    // Call legacy reject action (rejectQA)
    const rejectRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000073",
        sceneId: scene.scene_id,
        expectedSpecRevision: 1,
        action: "reject",
        payload: {}
      }
    });
    expect(rejectRes.statusCode).toBe(200);

    // Scene transitioned back to director_review and cleared approval and activeProductionJobId
    const sceneDb = await client.query<{
      status: string;
      approved_revision: number | null;
      active_production_job_id: string | null;
    }>(
      "SELECT status, approved_revision, active_production_job_id FROM storyboard_scenes WHERE scene_id = $1",
      [scene.scene_id]
    );
    expect(sceneDb.rows[0]!.status).toBe("director_review");
    expect(sceneDb.rows[0]!.approved_revision).toBeNull();
    expect(sceneDb.rows[0]!.active_production_job_id).toBeNull();

    // Verify fail-closed: runScene accepted_attempt_id was never set and assembly is impossible
    const runSceneDb = await client.query<{ accepted_attempt_id: string | null }>(
      "SELECT accepted_attempt_id FROM campaign_production_run_scenes WHERE scene_id = $1",
      [scene.scene_id]
    );
    expect(runSceneDb.rows[0]!.accepted_attempt_id).toBeNull();

    const assemblyJobsDb = await client.query(
      "SELECT * FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(assemblyJobsDb.rows).toHaveLength(0);

    await app.close();
  });
});
