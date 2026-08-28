import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  S3Client,
  CreateBucketCommand,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertRenderJobRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresJobQueue,
  HttpComfyUiOutputReader,
  S3ObjectStorage,
  type CertificationProfile,
  type CertificationProvenanceReport
} from "@cco/infrastructure";
import { FakeComfyUiTransport } from "../../packages/infrastructure/src/comfyui/test-support/fake-comfyui.js";
import {
  StorageAdmissionError,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult
} from "@cco/application";
import type { StorageAdmissionPolicy } from "@cco/domain";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";
import { createControlApiClient } from "../../apps/render-worker/src/control-api-client.js";
import {
  RenderWorker,
  type StorageAdmissionEnforcer,
  type WorkerLogger
} from "../../apps/render-worker/src/worker.js";
import {
  createCertifiedRenderJobExecutor,
  type ProductionManifestAssembler
} from "../../apps/render-worker/src/render-job-executor.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sleepUntilTimeoutOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener("abort", finish);
      resolve();
    };

    timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

const noopLogger: WorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

const fakeProfile: CertificationProfile = {
  id: "flux-schnell-draft",
  engine: "flux_schnell",
  workflowPath: "/templates/flux_schnell_draft_api.json",
  workflowRelativePath: "flux_schnell_draft_api.json",
  expectedWorkflowHash: "af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5",
  source: {
    kind: "validated_host_export",
    uri: "https://github.com/comfyanonymous/ComfyUI",
    revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    license: "GPL-3.0"
  },
  baseline: {
    width: 1024,
    height: 1024,
    steps: 4,
    frames: 1
  },
  minFreeDiskGb: 0,
  runnerProfile: "dynamicvram-offload-v1",
  models: [],
  assertions: [],
  renderProfileIdentity: {
    key: "FLUX_SCHNELL_DRAFT_V1",
    version: 1
  }
};

const fakeLiveProvenance: CertificationProvenanceReport = {
  version: 1,
  profileId: "flux-schnell-draft",
  generatedAt: "2026-08-27T00:00:00.000Z",
  models: [],
  disk: {
    modelFootprintBytes: 0,
    availableBytes: 100_000_000_000,
    requiredFreeBytes: 0,
    modelFootprintGb: 0,
    availableGb: 100,
    minFreeDiskGb: 0,
    passes: true
  },
  git: {
    comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNodes: []
  },
  workflow: {
    relativePath: "flux_schnell_draft_api.json",
    sha256: fakeProfile.expectedWorkflowHash,
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }
  },
  renderProfileProvenance: {
    key: "FLUX_SCHNELL_DRAFT_V1",
    version: 1,
    engine: "flux_schnell",
    workflowHash: fakeProfile.expectedWorkflowHash,
    frames: 1,
    steps: 4,
    runnerProfile: "dynamicvram-offload-v1",
    measuredDiskFootprintGb: 10,
    minFreeDiskGb: 0,
    modelHashes: {}
  }
};

const fakeRawWorkflow = JSON.stringify({
  "1": {
    inputs: { seed: 42, steps: 4 },
    class_type: "KSampler"
  },
  "3": {
    inputs: { text: "default prompt" },
    class_type: "CLIPTextEncode"
  },
  "4": {
    inputs: { text: "default negative" },
    class_type: "CLIPTextEncode"
  }
});

describe("Render Worker Cross-App Durable Integration Tests", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let pool: Pool;
  let serverApp: ReturnType<typeof createControlApiApp> | undefined;
  let controlApiUrl: string;

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
  }, 120_000);

  afterAll(async () => {
    if (rawS3Client) {
      rawS3Client.destroy();
    }
    if (minioContainer) {
      await minioContainer.stop();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await runMigrations(client, { migrationsDirectory: MIGRATIONS_DIRECTORY_URL });
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    if (serverApp) {
      await serverApp.close();
      serverApp = undefined;
    }
  });

  async function startControlApi(options?: {
    admissionGate?: { canAdmit: () => Promise<boolean> };
    storageTelemetry?: {
      getStorageTelemetry: () => Promise<{
        totalBytes: number;
        freeBytes: number;
        usedBytes: number;
        measuredAt: Date;
      }>;
    };
  }): Promise<{ url: string; app: ReturnType<typeof createControlApiApp> }> {
    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool, options?.admissionGate);
    const storageTelemetry = options?.storageTelemetry ?? {
      async getStorageTelemetry() {
        return {
          totalBytes: 1_000_000_000,
          freeBytes: 500_000_000,
          usedBytes: 500_000_000,
          measuredAt: new Date()
        };
      }
    };

    const app = createControlApiApp(
      {
        uow,
        jobQueue,
        storageTelemetry
      },
      {
        jobDispatch: {
          leaseDurationMs: 300_000,
          heartbeatIntervalMs: 30_000
        }
      }
    );

    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    serverApp = app;
    controlApiUrl = address;
    return { url: address, app };
  }

  it("recovers an expired rendering lease and persists exactly one production manifest", async () => {
    await startControlApi();

    const client = await pool.connect();
    let jobId: string;
    let sceneId: string;
    try {
      const clientRecord = await insertClientRecord(client);
      const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
      const scene = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        status: "approved",
        specRevision: 1
      });
      sceneId = scene.scene_id;

      const job = await insertRenderJobRecord(client, {
        sceneId: scene.scene_id,
        jobKind: "production",
        status: "queued",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: {
          prompt: "Production master render for scene 1",
          negativePrompt: "low quality"
        },
        retryCount: 0,
        maxRetries: 3
      });
      jobId = job.job_id;
    } finally {
      client.release();
    }

    const controlApiClient = createControlApiClient({ baseUrl: controlApiUrl });

    // Synchronization deferred promises between Worker A and Worker B
    const workerAStarted = createDeferred<void>();
    const workerAHold = createDeferred<void>();

    const workerAOutputBytes = new Uint8Array([0x10, 0x20, 0x30]);
    const transportA = new FakeComfyUiTransport();
    transportA.fakeFetch.setDefaultResponseHandler(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/view")) {
        return new Response(workerAOutputBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response("Not found", { status: 404 });
    });
    const outputReaderA = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transportA);

    const assemblerA: ProductionManifestAssembler = async (input) => ({
      promptIdComfy: input.renderResult.promptId,
      profile: input.profile.id,
      mediaCount: input.mediaObjects.length,
      workerOrigin: "worker-a"
    });

    const executorA = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeProfile,
      readApprovedProvenance: async () => fakeLiveProvenance,
      collectCertificationProvenance: async () => fakeLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawWorkflow,
      hashWorkflow: () => fakeProfile.expectedWorkflowHash,
      executeProfileRender: async (
        input: ExecuteProfileRenderInput
      ): Promise<ExecuteProfileRenderResult> => {
        workerAStarted.resolve();
        // Hold worker A while worker B reclaims and completes
        await workerAHold.promise;
        return {
          status: "succeeded",
          promptId: "prompt-comfy-worker-a",
          outputObjectKeys: ["output_a.png"],
          durationMs: 5000,
          profile: input.identity,
          preDispatchGpu: {
            totalVramMb: 24576,
            usedVramMb: 4096,
            freeVramMb: 20480,
            reservedVramMb: 4096,
            measuredAt: new Date().toISOString()
          }
        };
      },
      outputReader: outputReaderA,
      productionManifestAssembler: assemblerA
    });

    const admissionEnforcer: StorageAdmissionEnforcer = {
      async execute(): Promise<StorageAdmissionPolicy> {
        return {
          totalBytes: 1_000_000_000,
          freeBytes: 500_000_000,
          usedBytes: 500_000_000,
          usedRatio: 0.5,
          watermarkState: "green",
          isAdmissible: true
        };
      }
    };

    const workerA = new RenderWorker(
      {
        controlApiClient,
        objectStorage,
        enforceStorageAdmission: admissionEnforcer,
        renderJobExecutor: executorA,
        logger: noopLogger,
        sleep: sleepUntilTimeoutOrAbort
      },
      {
        workerId: "worker-a",
        pollIntervalMs: 100,
        heartbeatIntervalMs: 30000,
        leaseDurationMs: 60000,
        allowedJobKinds: ["production"]
      }
    );

    // 1. Worker A runs and begins execution
    const workerAPromise = workerA.runOnce();
    await workerAStarted.promise;

    // Verify Worker A claimed and started
    const checkClientA = await pool.connect();
    try {
      const activeJobRes = await checkClientA.query<{ status: string; worker_id: string }>(
        "SELECT status, worker_id FROM render_jobs WHERE job_id = $1",
        [jobId]
      );
      expect(activeJobRes.rows[0]?.status).toBe("rendering");
      expect(activeJobRes.rows[0]?.worker_id).toBe("worker-a");

      // 2. Expire Worker A's lease directly in PostgreSQL
      await checkClientA.query(
        "UPDATE render_jobs SET lease_expires_at = NOW() - INTERVAL '10 seconds' WHERE job_id = $1",
        [jobId]
      );
    } finally {
      checkClientA.release();
    }

    // 3. Set up Worker B to claim, render, and complete
    const workerBOutputBytes = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const transportB = new FakeComfyUiTransport();
    transportB.fakeFetch.setDefaultResponseHandler(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/view")) {
        return new Response(workerBOutputBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response("Not found", { status: 404 });
    });
    const outputReaderB = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transportB);

    const assemblerB: ProductionManifestAssembler = async (input) => ({
      promptIdComfy: input.renderResult.promptId,
      profile: input.profile.id,
      mediaCount: input.mediaObjects.length,
      workerOrigin: "worker-b"
    });

    const executorB = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeProfile,
      readApprovedProvenance: async () => fakeLiveProvenance,
      collectCertificationProvenance: async () => fakeLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawWorkflow,
      hashWorkflow: () => fakeProfile.expectedWorkflowHash,
      executeProfileRender: async (
        input: ExecuteProfileRenderInput
      ): Promise<ExecuteProfileRenderResult> => ({
        status: "succeeded",
        promptId: "prompt-comfy-worker-b",
        outputObjectKeys: ["output_b.png"],
        durationMs: 4000,
        profile: input.identity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      }),
      outputReader: outputReaderB,
      productionManifestAssembler: assemblerB
    });

    const workerB = new RenderWorker(
      {
        controlApiClient,
        objectStorage,
        enforceStorageAdmission: admissionEnforcer,
        renderJobExecutor: executorB,
        logger: noopLogger,
        sleep: sleepUntilTimeoutOrAbort
      },
      {
        workerId: "worker-b",
        pollIntervalMs: 100,
        heartbeatIntervalMs: 30000,
        leaseDurationMs: 60000,
        allowedJobKinds: ["production"]
      }
    );

    // 4. Worker B claims the expired lease, starts, renders, and completes
    const workerBDidWork = await workerB.runOnce();
    expect(workerBDidWork).toBe(true);

    // Verify Worker B successfully completed in PostgreSQL
    const checkClientB = await pool.connect();
    try {
      const jobAfterB = await checkClientB.query<{
        status: string;
        worker_id: string;
        retry_count: number;
      }>("SELECT status, worker_id, retry_count FROM render_jobs WHERE job_id = $1", [jobId]);
      expect(jobAfterB.rows[0]?.status).toBe("completed");
      expect(jobAfterB.rows[0]?.worker_id).toBe("worker-b");
      expect(jobAfterB.rows[0]?.retry_count).toBe(1);

      const manifestsAfterB = await checkClientB.query<{
        prompt_id_comfy: string;
        manifest_payload: { workerOrigin: string };
      }>("SELECT prompt_id_comfy, manifest_payload FROM generation_manifests WHERE job_id = $1", [
        jobId
      ]);
      expect(manifestsAfterB.rows).toHaveLength(1);
      expect(manifestsAfterB.rows[0]?.prompt_id_comfy).toBe("prompt-comfy-worker-b");
      expect(manifestsAfterB.rows[0]?.manifest_payload.workerOrigin).toBe("worker-b");
    } finally {
      checkClientB.release();
    }

    // 5. Release Worker A
    workerAHold.resolve();
    await workerAPromise;

    // 6. Assert exactly one production manifest and one completion remain durable
    const finalClient = await pool.connect();
    try {
      const finalJob = await finalClient.query<{
        status: string;
        worker_id: string;
        retry_count: number;
      }>("SELECT status, worker_id, retry_count FROM render_jobs WHERE job_id = $1", [jobId]);
      expect(finalJob.rows[0]?.status).toBe("completed");
      expect(finalJob.rows[0]?.worker_id).toBe("worker-b");
      expect(finalJob.rows[0]?.retry_count).toBe(1);

      const finalManifests = await finalClient.query<{
        prompt_id_comfy: string;
        manifest_payload: { workerOrigin: string };
      }>("SELECT prompt_id_comfy, manifest_payload FROM generation_manifests WHERE job_id = $1", [
        jobId
      ]);
      expect(finalManifests.rows).toHaveLength(1);
      expect(finalManifests.rows[0]?.prompt_id_comfy).toBe("prompt-comfy-worker-b");
      expect(finalManifests.rows[0]?.manifest_payload.workerOrigin).toBe("worker-b");

      const candidates = await finalClient.query<{ count: string }>(
        "SELECT count(*) FROM storyboard_candidates WHERE scene_id = $1",
        [sceneId]
      );
      expect(Number(candidates.rows[0]?.count)).toBe(0);

      // Verify production media object was durably persisted to S3/MinIO
      const workerBChecksum = sha256Hex(workerBOutputBytes);
      const digestSegment = workerBChecksum.slice(0, 16);
      const expectedStorageKey = `scenes/${sceneId}/jobs/${jobId}/${digestSegment}-output_b.png`;
      const storedObjectB = await objectStorage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: expectedStorageKey
      });
      expect(storedObjectB).toBeDefined();
      expect(storedObjectB?.body).toEqual(workerBOutputBytes);
    } finally {
      finalClient.release();
    }
  });

  it("completes a candidate with one byte-accurate durable candidate row", async () => {
    await startControlApi();

    const client = await pool.connect();
    let jobId: string;
    let sceneId: string;
    try {
      const clientRecord = await insertClientRecord(client);
      const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
      const scene = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        status: "generating_candidates",
        specRevision: 1
      });
      sceneId = scene.scene_id;

      const job = await insertRenderJobRecord(client, {
        sceneId: scene.scene_id,
        jobKind: "candidate",
        status: "queued",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: {
          prompt: "High-contrast candidate portrait",
          negativePrompt: "grainy, blur",
          seed: 424242,
          variantOrdinal: 1
        },
        retryCount: 0,
        maxRetries: 3
      });
      jobId = job.job_id;
    } finally {
      client.release();
    }

    const candidateImageBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb, 0xcc, 0xdd
    ]);
    const expectedChecksum = sha256Hex(candidateImageBytes);

    const transport = new FakeComfyUiTransport();
    transport.fakeFetch.setDefaultResponseHandler(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/view")) {
        return new Response(candidateImageBytes, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response("Not found", { status: 404 });
    });
    const outputReader = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transport);

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeProfile,
      readApprovedProvenance: async () => fakeLiveProvenance,
      collectCertificationProvenance: async () => fakeLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawWorkflow,
      hashWorkflow: () => fakeProfile.expectedWorkflowHash,
      executeProfileRender: async (
        input: ExecuteProfileRenderInput
      ): Promise<ExecuteProfileRenderResult> => ({
        status: "succeeded",
        promptId: "prompt-cand-101",
        outputObjectKeys: ["candidate_out.png"],
        durationMs: 3100,
        profile: input.identity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      }),
      outputReader
    });

    const controlApiClient = createControlApiClient({ baseUrl: controlApiUrl });

    const admissionEnforcer: StorageAdmissionEnforcer = {
      async execute(): Promise<StorageAdmissionPolicy> {
        return {
          totalBytes: 1_000_000_000,
          freeBytes: 500_000_000,
          usedBytes: 500_000_000,
          usedRatio: 0.5,
          watermarkState: "green",
          isAdmissible: true
        };
      }
    };

    const worker = new RenderWorker(
      {
        controlApiClient,
        objectStorage,
        enforceStorageAdmission: admissionEnforcer,
        renderJobExecutor: executor,
        logger: noopLogger,
        sleep: sleepUntilTimeoutOrAbort
      },
      {
        workerId: "candidate-worker-1",
        pollIntervalMs: 100,
        heartbeatIntervalMs: 1000,
        leaseDurationMs: 5000,
        allowedJobKinds: ["candidate"]
      }
    );

    const didWork = await worker.runOnce();
    expect(didWork).toBe(true);

    // Verify durable state in PostgreSQL
    const checkClient = await pool.connect();
    try {
      const jobRow = await checkClient.query<{ status: string; worker_id: string }>(
        "SELECT status, worker_id FROM render_jobs WHERE job_id = $1",
        [jobId]
      );
      expect(jobRow.rows[0]?.status).toBe("completed");
      expect(jobRow.rows[0]?.worker_id).toBe("candidate-worker-1");

      const candidateRows = await checkClient.query<{
        scene_id: string;
        scene_spec_revision: number;
        variant_ordinal: number;
        storage_bucket: string;
        storage_object_key: string;
        content_hash_sha256: string;
        generation_payload: {
          promptIdComfy: string;
          originalOutputKey: string;
        };
      }>("SELECT * FROM storyboard_candidates WHERE scene_id = $1", [sceneId]);

      expect(candidateRows.rows).toHaveLength(1);
      const candidate = candidateRows.rows[0]!;
      expect(candidate.scene_id).toBe(sceneId);
      expect(candidate.scene_spec_revision).toBe(1);
      expect(candidate.variant_ordinal).toBe(1);
      expect(candidate.storage_bucket).toBe(BUCKETS.REVIEW);
      expect(candidate.content_hash_sha256).toBe(expectedChecksum);
      expect(candidate.generation_payload.promptIdComfy).toBe("prompt-cand-101");
      expect(candidate.generation_payload.originalOutputKey).toBe("candidate_out.png");

      // Verify object in storage matches byte-for-byte
      const stored = await objectStorage.getObject({
        bucket: candidate.storage_bucket,
        key: candidate.storage_object_key
      });
      expect(stored).toBeDefined();
      expect(stored?.body).toEqual(candidateImageBytes);

      // Verify 0 production manifests
      const manifests = await checkClient.query<{ count: string }>(
        "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
        [jobId]
      );
      expect(Number(manifests.rows[0]?.count)).toBe(0);
    } finally {
      checkClient.release();
    }
  });

  it("defers write-time admission without consuming retry count", async () => {
    // Start Control API with admission enforcer throwing StorageAdmissionError on write
    const failingAdmissionEnforcer: StorageAdmissionEnforcer = {
      async execute(): Promise<StorageAdmissionPolicy> {
        throw new StorageAdmissionError({
          operationClass: "candidate_upload",
          watermarkState: "red",
          usedRatio: 0.96,
          totalBytes: 1_000_000_000,
          freeBytes: 40_000_000
        });
      }
    };

    await startControlApi();

    const client = await pool.connect();
    let jobId: string;
    let sceneId: string;
    try {
      const clientRecord = await insertClientRecord(client);
      const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
      const scene = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        status: "generating_candidates",
        specRevision: 1
      });
      sceneId = scene.scene_id;

      const job = await insertRenderJobRecord(client, {
        sceneId: scene.scene_id,
        jobKind: "candidate",
        status: "queued",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: {
          variantOrdinal: 1
        },
        retryCount: 0,
        maxRetries: 3
      });
      jobId = job.job_id;
    } finally {
      client.release();
    }

    const testBytes = new Uint8Array([1, 2, 3, 4]);
    const transport = new FakeComfyUiTransport();
    transport.fakeFetch.setDefaultResponseHandler(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/view")) {
        return new Response(testBytes, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });
    const outputReader = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transport);

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeProfile,
      readApprovedProvenance: async () => fakeLiveProvenance,
      collectCertificationProvenance: async () => fakeLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawWorkflow,
      hashWorkflow: () => fakeProfile.expectedWorkflowHash,
      executeProfileRender: async (
        input: ExecuteProfileRenderInput
      ): Promise<ExecuteProfileRenderResult> => ({
        status: "succeeded",
        promptId: "prompt-deferred-1",
        outputObjectKeys: ["out.png"],
        durationMs: 1000,
        profile: input.identity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      }),
      outputReader
    });

    const controlApiClient = createControlApiClient({ baseUrl: controlApiUrl });

    const worker = new RenderWorker(
      {
        controlApiClient,
        objectStorage,
        enforceStorageAdmission: failingAdmissionEnforcer,
        renderJobExecutor: executor,
        logger: noopLogger,
        sleep: sleepUntilTimeoutOrAbort
      },
      {
        workerId: "defer-worker-1",
        pollIntervalMs: 100,
        heartbeatIntervalMs: 1000,
        leaseDurationMs: 5000,
        allowedJobKinds: ["candidate"]
      }
    );

    const didWork = await worker.runOnce();
    expect(didWork).toBe(true);

    // Verify in PostgreSQL: status returned to 'queued', retry_count remains 0!
    const checkClient = await pool.connect();
    try {
      const jobRow = await checkClient.query<{
        status: string;
        worker_id: string | null;
        lease_token: string | null;
        lease_expires_at: Date | null;
        retry_count: number;
        error_trace: string | null;
      }>(
        "SELECT status, worker_id, lease_token, lease_expires_at, retry_count, error_trace FROM render_jobs WHERE job_id = $1",
        [jobId]
      );

      expect(jobRow.rows[0]?.status).toBe("queued");
      expect(jobRow.rows[0]?.worker_id).toBeNull();
      expect(jobRow.rows[0]?.lease_expires_at).toBeNull();
      expect(jobRow.rows[0]?.retry_count).toBe(0);
      expect(jobRow.rows[0]?.error_trace).toContain(
        'Storage admission denied for operation "candidate_upload"'
      );

      // Verify zero candidates written
      const candidates = await checkClient.query<{ count: string }>(
        "SELECT count(*) FROM storyboard_candidates WHERE scene_id = $1",
        [sceneId]
      );
      expect(Number(candidates.rows[0]?.count)).toBe(0);

      // Verify zero manifests written
      const manifests = await checkClient.query<{ count: string }>(
        "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
        [jobId]
      );
      expect(Number(manifests.rows[0]?.count)).toBe(0);
    } finally {
      checkClient.release();
    }
  });
});
