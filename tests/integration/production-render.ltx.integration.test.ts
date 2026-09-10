import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  insertStoryboardCandidateRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresJobQueue,
  S3ObjectStorage,
  type CertificationProfile,
  type CertificationProvenanceReport
} from "@cco/infrastructure";
import {
  EnqueueSceneProductionRenderUseCase,
  AssembleGenerationManifest,
  ResolveApprovedCandidateMediaUseCase,
  type ComfyUiInputStagingPort,
  type EnforceStorageAdmission,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type RenderWorkflow
} from "@cco/application";
import { LTX_FPS } from "@cco/contracts";
import type { CandidateId, SceneId } from "@cco/domain";
import { BUCKET_NAMES, BUCKETS } from "@cco/shared";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";
import { createControlApiClient } from "../../apps/render-worker/src/control-api-client.js";
import { createCertifiedRenderJobExecutor } from "../../apps/render-worker/src/render-job-executor.js";
import { RenderWorker } from "../../apps/render-worker/src/worker.js";
import { createProductionWorker } from "../../apps/render-worker/src/cli/run-worker.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface LiveLtxConfig {
  readonly comfyUiUrl: string;
  readonly comfyUiDir: string;
}

export function resolveLiveLtxConfig(env: NodeJS.ProcessEnv = process.env): LiveLtxConfig {
  const comfyUiUrl = env.COMFYUI_URL?.trim();
  const comfyUiDir = env.COMFYUI_DIR?.trim();

  if (!comfyUiUrl || !comfyUiDir) {
    throw new Error(
      "Missing required host prerequisites for live LTX production render: COMFYUI_URL and COMFYUI_DIR must be set."
    );
  }

  return { comfyUiUrl, comfyUiDir };
}

/**
 * Whether this process has the real GPU/ComfyUI host prerequisites needed to
 * run the live LTX-2.5 render below. Used to skip that test cleanly
 * everywhere else (so `pnpm test:ltx-production` is safe to run
 * unconditionally in every environment, including the orchestrator's own
 * validation) rather than excluding the suite from validation entirely.
 */
export function hasLiveLtxPrerequisites(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.COMFYUI_URL?.trim() && env.COMFYUI_DIR?.trim());
}

/**
 * Validates prerequisites specifically for live LTX-2.5 I2V production render.
 * Checks host availability AND checks operator approval in license registry
 * and gold master provenance before running (does not fabricate certification values).
 */
export function hasLiveLtxI2vPrerequisites(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!hasLiveLtxPrerequisites(env)) {
    return false;
  }
  try {
    const rootPath = resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const registryPath =
      env.LICENSE_REGISTRY_PATH?.trim() ||
      resolve(rootPath, "config/component-license-registry.json");
    const registryContent = JSON.parse(readFileSync(registryPath, "utf8"));
    const hasApprovedLicense =
      Array.isArray(registryContent?.entries) &&
      registryContent.entries.some(
        (e: { componentId?: string; status?: string }) =>
          e?.componentId === "LTX_25_720P_5S_I2V_V1" && e?.status === "approved"
      );
    if (!hasApprovedLicense) {
      return false;
    }

    const provenancePath =
      env.GOLD_MASTER_PROVENANCE_PATH?.trim() ||
      env.CERTIFICATION_MANIFEST_PATH?.trim() ||
      resolve(rootPath, "certification/ltx-25/approved-provenance.json");
    const provenanceContent = JSON.parse(readFileSync(provenancePath, "utf8"));
    const hasApprovedProvenance =
      provenanceContent?.renderProfileProvenance?.key === "LTX_25_720P_5S_I2V_V1" ||
      provenanceContent?.profileId === "ltx-25-720p-97f-i2v";
    if (!hasApprovedProvenance) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

const rootPath = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const realLtxI2vWorkflowPath = resolve(rootPath, "templates/ltx_25_720p_i2v_97f_api.json");
const realLtxI2vWorkflow = readFileSync(realLtxI2vWorkflowPath, "utf8");
const ltxI2vWorkflowHash = createHash("sha256").update(realLtxI2vWorkflow).digest("hex");

const fakeLtxI2vProfile: CertificationProfile = {
  id: "ltx-25-720p-97f-i2v",
  engine: "ltx_25_i2v",
  workflowPath: realLtxI2vWorkflowPath,
  workflowRelativePath: "ltx_25_720p_i2v_97f_api.json",
  expectedWorkflowHash: ltxI2vWorkflowHash,
  source: {
    kind: "validated_host_export",
    uri: "https://github.com/comfyanonymous/ComfyUI",
    revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    license: "GPL-3.0"
  },
  baseline: {
    width: 1280,
    height: 720,
    steps: 8,
    frames: 97,
    approximateDurationSeconds: 97 / LTX_FPS
  },
  minFreeDiskGb: 0,
  runnerProfile: "dynamicvram-offload-v1",
  models: [],
  assertions: [],
  renderProfileIdentity: {
    key: "LTX_25_720P_5S_I2V_V1",
    version: 1
  }
};

const fakeLtxI2vProvenance: CertificationProvenanceReport = {
  version: 1,
  profileId: "ltx-25-720p-97f-i2v",
  generatedAt: "2026-09-02T00:00:00.000Z",
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
    relativePath: "ltx_25_720p_i2v_97f_api.json",
    sha256: ltxI2vWorkflowHash,
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }
  },
  renderProfileProvenance: {
    key: "LTX_25_720P_5S_I2V_V1",
    version: 1,
    engine: "ltx_25_i2v",
    workflowHash: ltxI2vWorkflowHash,
    frames: 97,
    steps: 8,
    runnerProfile: "dynamicvram-offload-v1",
    measuredDiskFootprintGb: 10,
    minFreeDiskGb: 0,
    modelHashes: {}
  }
};

describe("LTX-2.5 Production Render End-to-End Integration", () => {
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

  async function startControlApi(): Promise<{
    url: string;
    app: ReturnType<typeof createControlApiApp>;
    uow: PostgresUnitOfWork;
  }> {
    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const storageTelemetry = {
      async getStorageTelemetry() {
        return {
          totalBytes: 1_000_000_000,
          freeBytes: 500_000_000,
          usedBytes: 500_000_000,
          measuredAt: new Date().toISOString(),
          buckets: [
            { bucket: BUCKETS.TEMP, usedBytes: 100_000 },
            { bucket: BUCKETS.REVIEW, usedBytes: 100_000 },
            { bucket: BUCKETS.DELIVERY, usedBytes: 100_000 }
          ]
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
    return { url: address, app, uow };
  }

  it("simulated component test: approved scene -> production enqueue -> claim -> RenderWorker.processJob -> QA state with LTX-2.5 manifest", async () => {
    const { uow } = await startControlApi();

    // 1. Insert client, campaign, scene, candidate, and approve scene with candidate selection
    const client = await pool.connect();
    let sceneId: string;
    let candidateId: string;
    let candidateStorageKey: string;
    const candidateImageBytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0, 31, 21, 196, 137
    ]);
    const candidateHash = sha256Hex(candidateImageBytes);

    try {
      const clientRecord = await insertClientRecord(client);
      const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
      const sceneRecord = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        durationSeconds: 4.0, // 4000ms
        status: "director_review",
        specRevision: 1,
        engineAssigned: "ltx_25",
        visualDescription: "Sunset over Caribbean waters with cinematic motion blur."
      });
      sceneId = sceneRecord.scene_id;
      candidateStorageKey = `candidates/${sceneId}/rev_1_var_1.png`;

      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: candidateStorageKey,
        body: candidateImageBytes,
        contentType: "image/png"
      });

      const candidate = await insertStoryboardCandidateRecord(client, {
        sceneId: sceneId as SceneId,
        sceneSpecRevision: 1,
        variantOrdinal: 1,
        storageBucket: BUCKETS.REVIEW,
        storageObjectKey: candidateStorageKey,
        contentHashSha256: candidateHash
      });
      candidateId = candidate.candidate_id;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidate.candidate_id, sceneId]
      );
    } finally {
      client.release();
    }

    // 2. Enqueue production render job via EnqueueSceneProductionRenderUseCase with conditioned profile enabled
    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      enableConditionedProfile: true
    });
    const enqueueResult = await enqueueUseCase.execute({ sceneId });

    expect(enqueueResult.scene.status).toBe("queued");
    expect(enqueueResult.job.jobKind).toBe("production");
    expect(enqueueResult.job.workflowTemplate).toBe("ltx-25-720p-97f-i2v");
    expect(enqueueResult.job.injectedPayload.frameCount).toBeUndefined();
    expect(enqueueResult.job.injectedPayload.approvedCandidateId).toBe(candidateId);
    expect(typeof enqueueResult.job.injectedPayload.seed).toBe("number");
    expect(enqueueResult.job.injectedPayload.prompt).toBe(
      "Sunset over Caribbean waters with cinematic motion blur."
    );

    // Verify scene status in DB is "queued"
    const verifyClient1 = await pool.connect();
    try {
      const dbScene = await verifyClient1.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("queued");
    } finally {
      verifyClient1.release();
    }

    // 3. Worker claims the production job
    const controlApiClient = createControlApiClient({ baseUrl: controlApiUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();
    expect(claimedJob?.jobId).toBe(enqueueResult.job.jobId);
    expect(claimedJob?.status).toBe("leased");
    expect(claimedJob?.injectedPayload.frameCount).toBeUndefined();
    expect(claimedJob?.injectedPayload.approvedCandidateId).toBe(candidateId);

    // 4. Compose certified render executor with simulated engine
    let executedWorkflow: RenderWorkflow | undefined;
    let stagedReferenceImageValue: { name: string; subfolder: string } | undefined;
    let cleanedUpReferenceImage: { name: string; subfolder?: string } | undefined;
    const fakeVideoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]); // dummy mp4 header
    const fakeVideoHash = sha256Hex(fakeVideoBytes);

    const resolveApprovedCandidateMedia = new ResolveApprovedCandidateMediaUseCase({
      sceneRepository: {
        findById: async (id: SceneId) => uow.execute(async (ctx) => ctx.scenes.findById(id)),
        save: async () => {}
      },
      storyboardCandidateRepository: {
        findById: async (id: CandidateId) =>
          uow.execute(async (ctx) => ctx.candidates.findById(id)),
        insert: async () => {},
        listBySceneAndRevision: async () => []
      },
      objectStorage,
      hashBytes: {
        hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
      }
    });

    const stageReferenceImage: ComfyUiInputStagingPort = {
      stage: async (file) => {
        stagedReferenceImageValue = {
          name: file.filename,
          subfolder: "conditioning"
        };
        return stagedReferenceImageValue;
      },
      cleanup: async (file) => {
        cleanedUpReferenceImage = file;
      }
    };

    const productionAssembler = new AssembleGenerationManifest({
      hashBytes: {
        hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
      },
      sceneRepository: {
        findById: async (id: SceneId) => uow.execute(async (ctx) => ctx.scenes.findById(id)),
        save: async () => {}
      },
      storyboardCandidateRepository: {
        findById: async (id: CandidateId) =>
          uow.execute(async (ctx) => ctx.candidates.findById(id)),
        insert: async () => {},
        listBySceneAndRevision: async () => []
      },
      referenceAssetRepository: {
        listBySceneId: async () => [],
        findByIds: async () => []
      }
    });

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeLtxI2vProfile,
      readApprovedProvenance: async () => fakeLtxI2vProvenance,
      collectCertificationProvenance: async () => fakeLtxI2vProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => realLtxI2vWorkflow,
      hashWorkflow: () => fakeLtxI2vProfile.expectedWorkflowHash,
      resolveApprovedCandidateMedia,
      objectStorage,
      stageReferenceImage,
      executeProfileRender: async (
        input: ExecuteProfileRenderInput
      ): Promise<ExecuteProfileRenderResult> => {
        executedWorkflow = input.workflow;
        return {
          status: "succeeded",
          promptId: "prompt-ltx-uuid",
          outputObjectKeys: ["output.mp4"],
          durationMs: 4200,
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
      outputReader: {
        readOutput: async () => ({
          bytes: fakeVideoBytes,
          contentType: "video/mp4"
        })
      },
      productionManifestAssembler: productionAssembler
    });

    // 5. Compose RenderWorker and process the claimed job end-to-end
    const worker = new RenderWorker(
      {
        controlApiClient,
        objectStorage,
        enforceStorageAdmission: {
          execute: async () => {}
        } as unknown as EnforceStorageAdmission,
        renderJobExecutor: executor,
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {}
        },
        sleep: async () => {}
      },
      {
        workerId: "worker-ltx-test",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 5000,
        leaseDurationMs: 30000,
        allowedJobKinds: ["production"]
      }
    );

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("completed");

    // Verify injected workflow parameters in executor
    expect(executedWorkflow).toBeDefined();
    const node20Inputs = executedWorkflow!["20"]?.inputs as Record<string, unknown> | undefined;
    const node3Inputs = executedWorkflow!["3"]?.inputs as Record<string, unknown> | undefined;
    const node1Inputs = executedWorkflow!["1"]?.inputs as Record<string, unknown> | undefined;
    expect(node20Inputs?.["image"]).toBe(`conditioning/${stagedReferenceImageValue!.name}`);
    expect(node3Inputs?.["text"]).toBe("Sunset over Caribbean waters with cinematic motion blur.");
    expect(node1Inputs?.["seed"]).toBe(claimedJob!.injectedPayload.seed);
    expect(cleanedUpReferenceImage).toEqual({
      name: stagedReferenceImageValue!.name,
      subfolder: "conditioning"
    });

    // 6. Verify DB states
    const verifyClient3 = await pool.connect();
    try {
      const dbScene = await verifyClient3.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("qa");

      const dbJob = await verifyClient3.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("completed");
      expect(dbJob.rows[0]?.error_trace).toBeNull();

      const dbManifest = await verifyClient3.query(
        "SELECT manifest_payload FROM generation_manifests WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbManifest.rows).toHaveLength(1);
      const manifestPayload = dbManifest.rows[0]?.manifest_payload;
      expect(manifestPayload.fps).toBe(LTX_FPS);
      expect(manifestPayload.frameCount).toBe(97);
      expect(manifestPayload.sampling.seed).toBe(claimedJob!.injectedPayload.seed);
      expect(manifestPayload.renderProfile).toBe(fakeLtxI2vProfile.id);
      expect(manifestPayload.engine).toBe("ltx_25_i2v");
      expect(manifestPayload.prompts.prompt).toBe(
        "Sunset over Caribbean waters with cinematic motion blur."
      );
      expect(manifestPayload.outputs[0].checksumSha256).toBe(fakeVideoHash);

      // 7. Verify S3 / MinIO video output
      const videoObjectKey = manifestPayload.outputs[0].key;
      const storedVideo = await objectStorage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: videoObjectKey
      });
      expect(storedVideo).toBeDefined();
      expect(sha256Hex(storedVideo!.body)).toBe(fakeVideoHash);
    } finally {
      verifyClient3.release();
    }
  });

  it("requires explicit COMFYUI_URL and COMFYUI_DIR host prerequisites to run live LTX-2.5 production render", () => {
    expect(() => resolveLiveLtxConfig({})).toThrow(
      "Missing required host prerequisites for live LTX production render: COMFYUI_URL and COMFYUI_DIR must be set."
    );
    expect(() =>
      resolveLiveLtxConfig({ COMFYUI_URL: "http://127.0.0.1:8188", COMFYUI_DIR: "   " })
    ).toThrow(
      "Missing required host prerequisites for live LTX production render: COMFYUI_URL and COMFYUI_DIR must be set."
    );
    expect(() => resolveLiveLtxConfig({ COMFYUI_URL: "   ", COMFYUI_DIR: "/opt/ComfyUI" })).toThrow(
      "Missing required host prerequisites for live LTX production render: COMFYUI_URL and COMFYUI_DIR must be set."
    );
    expect(
      resolveLiveLtxConfig({
        COMFYUI_URL: "http://127.0.0.1:8188",
        COMFYUI_DIR: "/opt/ComfyUI"
      })
    ).toEqual({
      comfyUiUrl: "http://127.0.0.1:8188",
      comfyUiDir: "/opt/ComfyUI"
    });
  });

  it("requires operator approval in license registry and provenance for live I2V render", () => {
    expect(hasLiveLtxI2vPrerequisites({})).toBe(false);
    expect(
      hasLiveLtxI2vPrerequisites({
        COMFYUI_URL: "http://127.0.0.1:8188",
        COMFYUI_DIR: "/opt/ComfyUI"
      })
    ).toBe(false);
  });

  it.skipIf(!hasLiveLtxI2vPrerequisites())(
    "runs real LTX-2.5 video generation on host with ComfyUI and GPU",
    async () => {
      const liveConfig = resolveLiveLtxConfig();
      const { uow, url: controlApiBaseUrl } = await startControlApi();

      // 1. Insert client, campaign, scene, candidate, and approve scene with candidate selection
      const client = await pool.connect();
      let sceneId: string;
      const candidateImageBytes = new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137
      ]);
      const candidateHash = sha256Hex(candidateImageBytes);

      try {
        const clientRecord = await insertClientRecord(client);
        const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
        const sceneRecord = await insertStoryboardSceneRecord(client, {
          campaignId: campaign.campaign_id,
          durationSeconds: 4.042, // maps to 97 frames
          status: "director_review",
          specRevision: 1,
          engineAssigned: "ltx_25",
          visualDescription: "Golden hour over a calm ocean with subtle ripples."
        });
        sceneId = sceneRecord.scene_id;
        const candidateKey = `candidates/${sceneId}/rev_1_var_1.png`;

        await objectStorage.putObject({
          bucket: BUCKETS.REVIEW,
          key: candidateKey,
          body: candidateImageBytes,
          contentType: "image/png"
        });

        const candidate = await insertStoryboardCandidateRecord(client, {
          sceneId: sceneId as SceneId,
          sceneSpecRevision: 1,
          variantOrdinal: 1,
          storageBucket: BUCKETS.REVIEW,
          storageObjectKey: candidateKey,
          contentHashSha256: candidateHash
        });

        await client.query(
          `UPDATE storyboard_scenes
           SET status = 'approved',
               approved_by = 'director-live',
               approved_at = NOW(),
               approved_revision = 1,
               selected_candidate_id = $1,
               selected_candidate_revision = 1
           WHERE scene_id = $2`,
          [candidate.candidate_id, sceneId]
        );
      } finally {
        client.release();
      }

      // 2. Enqueue production render job via EnqueueSceneProductionRenderUseCase
      const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
        enableConditionedProfile: true
      });
      const enqueueResult = await enqueueUseCase.execute({ sceneId });

      expect(enqueueResult.scene.status).toBe("queued");
      expect(enqueueResult.job.jobKind).toBe("production");
      expect(enqueueResult.job.workflowTemplate).toBe("ltx-25-720p-97f-i2v");
      expect(enqueueResult.job.injectedPayload.frameCount).toBeUndefined();

      // 3. Compose real production worker using createProductionWorker against authoritative templates and ComfyUI host
      const rootPath = resolve(fileURLToPath(new URL("../..", import.meta.url)));
      const worker = createProductionWorker(
        {
          controlApiBaseUrl,
          workerId: "worker-live-ltx",
          pollIntervalMs: 1000,
          heartbeatIntervalMs: 5000,
          leaseDurationMs: 300_000,
          databaseUrl: postgresContainer.getConnectionUri(),
          comfyUiUrl: liveConfig.comfyUiUrl,
          comfyUiDir: liveConfig.comfyUiDir,
          comfyUiRenderTimeoutMs: 300_000,
          comfyUiUploadTimeoutMs: 30_000,
          storageTelemetryPath: "/tmp",
          gpuIndex: 0,
          gpuLeasePath: "/tmp/gpu-live.lock",
          certificationManifestPath: resolve(rootPath, "templates/provenance.json"),
          goldMasterProvenancePath: resolve(rootPath, "templates/provenance.json"),
          licenseRegistryPath: resolve(rootPath, "config/component-license-registry.json"),
          s3Endpoint: minioContainer.getEndpoint(),
          s3Region: "us-east-1",
          s3ForcePathStyle: true,
          s3AccessKeyId: minioContainer.getAccessKey(),
          s3SecretAccessKey: minioContainer.getSecretKey(),
          s3CandidateBucket: BUCKETS.REVIEW,
          s3DeliveryBucket: BUCKETS.DELIVERY,
          s3Config: {
            endpoint: minioContainer.getEndpoint(),
            region: "us-east-1",
            forcePathStyle: true,
            credentials: {
              accessKeyId: minioContainer.getAccessKey(),
              secretAccessKey: minioContainer.getSecretKey()
            }
          }
        },
        {
          pool
        }
      );

      // 4. Claim the job
      const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
      const claimedJob = await controlApiClient.claim("worker-live-ltx", ["production"]);
      expect(claimedJob).toBeDefined();
      expect(claimedJob?.jobId).toBe(enqueueResult.job.jobId);

      // 5. Process job using real RenderWorker
      const outcome = await worker.processJob(claimedJob!);
      expect(outcome).toBe("completed");

      // 6. Verify DB states
      const verifyClient = await pool.connect();
      try {
        const dbScene = await verifyClient.query(
          "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
          [sceneId]
        );
        expect(dbScene.rows[0]?.status).toBe("qa");

        const dbJob = await verifyClient.query(
          "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
          [claimedJob!.jobId]
        );
        expect(dbJob.rows[0]?.status).toBe("completed");
        expect(dbJob.rows[0]?.error_trace).toBeNull();

        const dbManifest = await verifyClient.query(
          "SELECT manifest_payload FROM generation_manifests WHERE job_id = $1",
          [claimedJob!.jobId]
        );
        expect(dbManifest.rows).toHaveLength(1);
        const manifestPayload = dbManifest.rows[0]?.manifest_payload;
        expect(manifestPayload.fps).toBe(LTX_FPS);
        expect(manifestPayload.frameCount).toBe(97);
        expect(manifestPayload.engine).toBe("ltx_25_i2v");
        expect(manifestPayload.outputs.length).toBeGreaterThan(0);

        const videoOutput = manifestPayload.outputs[0];
        const videoObject = await objectStorage.getObject({
          bucket: BUCKETS.DELIVERY,
          key: videoOutput.key
        });
        expect(videoObject).toBeDefined();
        // Verify non-fabricated video bytes from real LTX render
        expect(videoObject!.body.length).toBeGreaterThan(1000);
        expect(sha256Hex(videoObject!.body)).toBe(videoOutput.checksumSha256);
      } finally {
        verifyClient.release();
      }
    }
  );
});
