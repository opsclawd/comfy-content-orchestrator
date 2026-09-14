import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  S3Client,
  CreateBucketCommand,
  insertClientRecord,
  insertCampaignRecord,
  insertDeliveryAssemblyJobRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresJobQueue,
  PostgresDeliveryAssemblyJobQueue,
  PostgresCampaignDeliveryReelQueries,
  S3ObjectStorage,
  S3ReviewMediaDelivery
} from "@cco/infrastructure";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import {
  computeAssemblyId,
  createAssemblyManifest,
  type AssemblySpec,
  type AssemblyExecutionResult,
  type CampaignDeliveryReelReadModel
} from "@cco/contracts";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";

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

function makeAssemblySpec(params: {
  campaignId: string;
  sceneId?: string;
  generationManifestId?: string;
  durationMs?: number;
  stemMediaKey?: string;
  stemMediaBucket?: string;
}): AssemblySpec {
  const sceneId = params.sceneId ?? "01950c46-9e90-7d3d-82d2-8f1d3c000001";
  const generationManifestId =
    params.generationManifestId ?? "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const durationMs = params.durationMs ?? 5000;
  const bucket = params.stemMediaBucket ?? BUCKETS.DELIVERY;
  const key = params.stemMediaKey ?? `campaigns/${params.campaignId}/scenes/scene-1.mp4`;

  return {
    campaignId: params.campaignId,
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    expectedTotalDurationMs: durationMs,
    subtitleCues: [],
    videoStems: [
      {
        sceneId,
        generationManifestId,
        order: 0,
        expectedDurationMs: durationMs,
        media: {
          bucket,
          key,
          sha256: "a".repeat(64),
          contentType: "video/mp4"
        }
      }
    ]
  };
}

function makeExecutionResult(params: {
  assemblyId: string;
  campaignId: string;
  videoBytesSha256: string;
  mediaKey: string;
  mediaBucket?: string;
  sceneId?: string;
  generationManifestId?: string;
  durationMs?: number;
}): AssemblyExecutionResult {
  const sceneId = params.sceneId ?? "01950c46-9e90-7d3d-82d2-8f1d3c000001";
  const generationManifestId =
    params.generationManifestId ?? "01950c46-9e90-7d3d-82d2-8f1d3c000002";
  const durationMs = params.durationMs ?? 5000;
  const bucket = params.mediaBucket ?? BUCKETS.DELIVERY;

  return {
    assemblyId: params.assemblyId,
    campaignId: params.campaignId,
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    executedInputs: {
      videoStems: [
        {
          sceneId,
          generationManifestId,
          order: 0,
          media: {
            bucket,
            key: `campaigns/${params.campaignId}/scenes/scene-1.mp4`,
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          },
          actualDurationMs: durationMs
        }
      ]
    },
    timeline: {
      totalDurationMs: durationMs,
      stemDurationsMs: [durationMs]
    },
    layout: {
      mode: "fit_blurred_fill"
    },
    subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    ffmpeg: {
      executable: "ffmpeg",
      version: "7.0.2-static",
      buildInfo: "ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/"
    },
    commandFingerprint: "b".repeat(64),
    encoding: {
      video: {
        codec: "libx264",
        pixelFormat: "yuv420p",
        crf: 23,
        preset: "veryfast"
      }
    },
    streams: {
      video: {
        codecName: "h264",
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        frameRate: 30,
        durationMs
      }
    },
    output: {
      media: {
        bucket,
        key: params.mediaKey,
        sha256: params.videoBytesSha256,
        contentType: "video/mp4"
      },
      durationMs,
      width: 1080,
      height: 1920
    },
    stagingMedia: {
      bucket,
      key: `campaigns/${params.campaignId}/assemblies/${params.assemblyId}/.staging/output.mp4`
    },
    measuredFrameRate: 30,
    executionDurationMs: 1500
  };
}

describe("Final Delivery Reel End-to-End Integration (#278)", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let client: PoolClient;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let reviewMediaDelivery: S3ReviewMediaDelivery;
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
    const campaignDeliveryReelQueries = new PostgresCampaignDeliveryReelQueries(pool);

    return createControlApiApp(
      {
        uow,
        jobQueue,
        deliveryAssemblyJobQueue,
        storageTelemetry: FAKE_STORAGE_TELEMETRY,
        reviewMediaDelivery,
        campaignDeliveryReelQueries,
        objectStorage
      },
      {
        reviewerIdentityResolver: {
          resolve: () => "Director Thomas"
        },
        jobDispatch: DEFAULT_DISPATCH_CONFIG
      }
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Canonical completed delivery reel & presigned artifact resolution
  // ---------------------------------------------------------------------------
  it("resolves canonical completed delivery reel with presigned URL and verified download", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      status: "completed"
    });

    const spec = makeAssemblySpec({ campaignId: campaign.campaign_id });
    const assemblyId = computeAssemblyId(spec);

    const videoBytes = Buffer.from("VIDEO_STREAM_BYTES_MP4_CANONICAL_OUTPUT_TEST_12345");
    const videoSha = createHash("sha256").update(videoBytes).digest("hex");
    const outputMediaKey = `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/output.mp4`;

    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: outputMediaKey,
      body: videoBytes,
      checksumSha256: videoSha,
      contentType: "video/mp4"
    });

    const executionResult = makeExecutionResult({
      assemblyId,
      campaignId: campaign.campaign_id,
      videoBytesSha256: videoSha,
      mediaKey: outputMediaKey,
      mediaBucket: BUCKETS.DELIVERY
    });

    const manifest = createAssemblyManifest({
      executionResult,
      governanceDecisionId: "gov-dec-01950c46-9e90-7d3d-82d2-8f1d3c000001"
    });

    const manifestKey = `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/manifest.json`;
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKey,
      body: manifestBytes,
      checksumSha256: createHash("sha256").update(manifestBytes).digest("hex"),
      contentType: "application/json"
    });

    const job = await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      assemblySpec: spec,
      status: "completed"
    });

    // Query primary route
    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("completed");
    expect(body.campaignId).toBe(campaign.campaign_id);
    expect(body.assemblyId).toBe(assemblyId);
    expect(body.assemblyJobId).toBe(job.job_id);
    expect(body.manifest).toBeDefined();
    expect(body.manifest?.assemblyId).toBe(assemblyId);
    expect(body.media).toBeDefined();
    expect(body.media?.key).toBe(outputMediaKey);
    expect(body.media?.sha256).toBe(videoSha);
    expect(body.media?.durationMs).toBe(5000);
    expect(body.media?.width).toBe(1080);
    expect(body.media?.height).toBe(1920);
    expect(body.media?.url).toMatch(/^http/);

    // Verify presigned URL can be fetched directly via HTTP and downloads the exact bytes
    const fetchRes = await fetch(body.media!.url);
    expect(fetchRes.ok).toBe(true);
    expect(fetchRes.status).toBe(200);
    const downloadedBuffer = Buffer.from(await fetchRes.arrayBuffer());
    expect(downloadedBuffer).toEqual(videoBytes);

    // Verify alias route /api/campaigns/:campaignId/delivery produces identical output
    const aliasRes = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery`
    });
    expect(aliasRes.statusCode).toBe(200);
    const aliasBody = JSON.parse(aliasRes.body) as CampaignDeliveryReelReadModel;
    expect(aliasBody.status).toBe("completed");
    expect(aliasBody.assemblyId).toBe(assemblyId);
    expect(aliasBody.media?.key).toBe(outputMediaKey);
  });

  // ---------------------------------------------------------------------------
  // 2. Multi-Tenant Campaign Isolation Proof
  // ---------------------------------------------------------------------------
  it("enforces multi-tenant campaign isolation: Campaign B never sees Campaign A artifacts", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaignA = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const campaignB = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    // Seed Campaign A with a completed delivery reel
    const specA = makeAssemblySpec({ campaignId: campaignA.campaign_id });
    const assemblyIdA = computeAssemblyId(specA);
    const videoBytesA = Buffer.from("VIDEO_STREAM_BYTES_CAMPAIGN_A");
    const videoShaA = createHash("sha256").update(videoBytesA).digest("hex");
    const outputMediaKeyA = `campaigns/${campaignA.campaign_id}/assemblies/${assemblyIdA}/output.mp4`;

    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: outputMediaKeyA,
      body: videoBytesA,
      checksumSha256: videoShaA,
      contentType: "video/mp4"
    });

    const executionResultA = makeExecutionResult({
      assemblyId: assemblyIdA,
      campaignId: campaignA.campaign_id,
      videoBytesSha256: videoShaA,
      mediaKey: outputMediaKeyA
    });
    const manifestA = createAssemblyManifest({
      executionResult: executionResultA,
      governanceDecisionId: "gov-dec-01950c46-9e90-7d3d-82d2-8f1d3c000001"
    });
    const manifestKeyA = `campaigns/${campaignA.campaign_id}/assemblies/${assemblyIdA}/manifest.json`;
    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKeyA,
      body: Buffer.from(JSON.stringify(manifestA)),
      contentType: "application/json"
    });

    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaignA.campaign_id,
      assemblySpec: specA,
      status: "completed"
    });

    // Query Campaign B: has no jobs or runs, must return not-started with zero leakage of Campaign A
    const resB = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignB.campaign_id}/delivery-reel`
    });

    expect(resB.statusCode).toBe(200);
    const bodyB = JSON.parse(resB.body) as CampaignDeliveryReelReadModel;
    expect(bodyB.status).toBe("not-started");
    expect(bodyB.campaignId).toBe(campaignB.campaign_id);
    expect((bodyB as unknown as Record<string, unknown>).assemblyId).toBeUndefined();
    expect(bodyB.media).toBeUndefined();
    expect(bodyB.manifest).toBeUndefined();

    // Tampered locator attack: Campaign B has a completed job, but the manifest references
    // Campaign A's media key in storage. Must fail closed at storage locator namespace check!
    const specB = makeAssemblySpec({ campaignId: campaignB.campaign_id });
    const assemblyIdB = computeAssemblyId(specB);

    const tamperedExecutionResultB = makeExecutionResult({
      assemblyId: assemblyIdB,
      campaignId: campaignB.campaign_id,
      videoBytesSha256: videoShaA,
      mediaKey: outputMediaKeyA // Attacking Campaign A's storage namespace!
    });
    const tamperedManifestB = createAssemblyManifest({
      executionResult: tamperedExecutionResultB,
      governanceDecisionId: "gov-dec-01950c46-9e90-7d3d-82d2-8f1d3c000002"
    });
    const manifestKeyB = `campaigns/${campaignB.campaign_id}/assemblies/${assemblyIdB}/manifest.json`;
    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKeyB,
      body: Buffer.from(JSON.stringify(tamperedManifestB)),
      contentType: "application/json"
    });

    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaignB.campaign_id,
      assemblySpec: specB,
      status: "completed"
    });

    const resAttack = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignB.campaign_id}/delivery-reel`
    });
    expect(resAttack.statusCode).toBe(200);
    const bodyAttack = JSON.parse(resAttack.body) as CampaignDeliveryReelReadModel;
    expect(bodyAttack.status).toBe("unavailable-artifact");
    expect(bodyAttack.campaignId).toBe(campaignB.campaign_id);
    expect(bodyAttack.reason).toContain(
      "Assembly output media key does not belong to requested campaign namespace"
    );
    expect(bodyAttack.media).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 3. Fail-Closed Artifact Inconsistency Handling
  // ---------------------------------------------------------------------------
  it("fails closed to unavailable-artifact when manifest object is missing in storage", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const spec = makeAssemblySpec({ campaignId: campaign.campaign_id });
    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      assemblySpec: spec,
      status: "completed"
    });

    // Do NOT upload manifest to MinIO
    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("unavailable-artifact");
    expect(body.reason).toContain("manifest object was not found in storage");
    expect(body.media).toBeUndefined();
  });

  it("fails closed to unavailable-artifact when physical media object is missing in storage", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const spec = makeAssemblySpec({ campaignId: campaign.campaign_id });
    const assemblyId = computeAssemblyId(spec);
    const outputMediaKey = `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/output.mp4`;

    // Upload manifest referencing outputMediaKey, but do NOT upload outputMediaKey
    const executionResult = makeExecutionResult({
      assemblyId,
      campaignId: campaign.campaign_id,
      videoBytesSha256: "d".repeat(64),
      mediaKey: outputMediaKey
    });
    const manifest = createAssemblyManifest({
      executionResult,
      governanceDecisionId: "gov-dec-01950c46-9e90-7d3d-82d2-8f1d3c000001"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/manifest.json`,
      body: Buffer.from(JSON.stringify(manifest)),
      contentType: "application/json"
    });

    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      assemblySpec: spec,
      status: "completed"
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("unavailable-artifact");
    expect(body.reason).toContain("output media object was not found in storage");
    expect(body.media).toBeUndefined();
  });

  it("fails closed to unavailable-artifact when media checksum mismatches manifest hash", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const spec = makeAssemblySpec({ campaignId: campaign.campaign_id });
    const assemblyId = computeAssemblyId(spec);
    const outputMediaKey = `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/output.mp4`;

    const actualBytes = Buffer.from("TAMPERED_OR_CORRUPTED_BYTES");
    const actualSha = createHash("sha256").update(actualBytes).digest("hex");
    const manifestExpectedSha = "e".repeat(64); // Mismatch!

    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: outputMediaKey,
      body: actualBytes,
      checksumSha256: actualSha,
      contentType: "video/mp4"
    });

    const executionResult = makeExecutionResult({
      assemblyId,
      campaignId: campaign.campaign_id,
      videoBytesSha256: manifestExpectedSha,
      mediaKey: outputMediaKey
    });
    const manifest = createAssemblyManifest({
      executionResult,
      governanceDecisionId: "gov-dec-01950c46-9e90-7d3d-82d2-8f1d3c000001"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/manifest.json`,
      body: Buffer.from(JSON.stringify(manifest)),
      contentType: "application/json"
    });

    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      assemblySpec: spec,
      status: "completed"
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("unavailable-artifact");
    expect(body.reason).toContain("Output media checksum mismatch");
    expect(body.media).toBeUndefined();
  });

  it("fails closed to unavailable-artifact when manifest body is corrupted non-JSON", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const spec = makeAssemblySpec({ campaignId: campaign.campaign_id });
    const assemblyId = computeAssemblyId(spec);

    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaign.campaign_id}/assemblies/${assemblyId}/manifest.json`,
      body: Buffer.from("{ bad non-json string !!!"),
      contentType: "application/json"
    });

    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      assemblySpec: spec,
      status: "completed"
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("unavailable-artifact");
    expect(body.reason).toContain("corrupt or invalid");
    expect(body.media).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 4. Not-Ready States Against Real PostgreSQL
  // ---------------------------------------------------------------------------
  it("returns not-started for a newly created campaign with no assembly jobs or runs", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("not-started");
    expect(body.campaignId).toBe(campaign.campaign_id);
    expect(body.media).toBeUndefined();
  });

  it("returns assembling when a delivery assembly job is queued or leased", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const job = await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      status: "queued"
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("assembling");
    expect(body.campaignId).toBe(campaign.campaign_id);
    expect(body.assemblyJobId).toBe(job.job_id);
    expect(body.media).toBeUndefined();
  });

  it("returns assembling when a campaign production run is in assembling status", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const runResult = await client.query<{ run_id: string }>(
      `INSERT INTO campaign_production_runs (campaign_id, fingerprint, status, expected_total_duration_ms)
       VALUES ($1, $2, $3, $4)
       RETURNING run_id`,
      [campaign.campaign_id, "test-run-fingerprint-456", "assembling", 5000]
    );
    const runId = runResult.rows[0]!.run_id;

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("assembling");
    expect(body.campaignId).toBe(campaign.campaign_id);
    expect(body.runId).toBe(runId);
    expect(body.media).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 5. Failed State Against Real PostgreSQL
  // ---------------------------------------------------------------------------
  it("returns failed state with error trace and job ID", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const errorTrace = "FFmpeg transcode failed: Non-monotonous DTS in output stream";
    const job = await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      status: "failed",
      errorTrace
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/delivery-reel`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as CampaignDeliveryReelReadModel;
    expect(body.status).toBe("failed");
    expect(body.campaignId).toBe(campaign.campaign_id);
    expect(body.assemblyJobId).toBe(job.job_id);
    expect(body.error).toBe(errorTrace);
    expect(body.media).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 6. Unknown Campaign Handling (404)
  // ---------------------------------------------------------------------------
  it("returns 404 NOT_FOUND for unknown campaign UUID", async () => {
    const app = createTestApp();
    const nonExistentCampaignId = "01950c46-9e90-7d3d-82d2-8f1d3c999999";

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${nonExistentCampaignId}/delivery-reel`
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body) as { code: string; message: string };
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(nonExistentCampaignId);
  });
});
