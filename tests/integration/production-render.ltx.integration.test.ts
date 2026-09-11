import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  S3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  FakeComfyUiTransport,
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
  ComfyUiClient,
  HttpComfyUiInputStagingAdapter,
  ComfyUiRenderEngineAdapter,
  type CertificationProfile,
  type CertificationProvenanceReport
} from "@cco/infrastructure";
import {
  EnqueueSceneProductionRenderUseCase,
  ApproveSceneAndDispatchCampaignProductionUseCase,
  ExecuteProfileRenderUseCase,
  AssembleGenerationManifest,
  ResolveApprovedCandidateMediaUseCase,
  type EnforceLicenseRouting,
  type EnforceStorageAdmission,
  type GpuTelemetryPort
} from "@cco/application";
import { LTX_FPS } from "@cco/contracts";
import type { CandidateId, SceneId } from "@cco/domain";
import { BUCKET_NAMES, BUCKETS } from "@cco/shared";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";
import { createControlApiClient } from "../../apps/render-worker/src/control-api-client.js";
import {
  createCertifiedRenderJobExecutor,
  MissingCertifiedProfileError
} from "../../apps/render-worker/src/render-job-executor.js";
import { RenderWorker } from "../../apps/render-worker/src/worker.js";
import { createProductionWorker } from "../../apps/render-worker/src/cli/run-worker.js";
import { verifyGoldMasterProvenance } from "../../apps/render-worker/src/certification/preflight.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface LiveLtxConfig {
  readonly comfyUiUrl: string;
  readonly comfyUiDir: string;
  readonly goldMasterProvenancePath?: string;
  readonly licenseRegistryPath?: string;
}

export function resolveLiveLtxConfig(env: NodeJS.ProcessEnv = process.env): LiveLtxConfig {
  const comfyUiUrl = env.COMFYUI_URL?.trim();
  const comfyUiDir = env.COMFYUI_DIR?.trim();

  if (!comfyUiUrl || !comfyUiDir) {
    throw new Error(
      "Missing required host prerequisites for live LTX production render: COMFYUI_URL and COMFYUI_DIR must be set."
    );
  }

  const rootPath = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const goldMasterProvenancePath =
    env.GOLD_MASTER_PROVENANCE_PATH?.trim() ||
    env.CERTIFICATION_MANIFEST_PATH?.trim() ||
    resolve(rootPath, "certification/ltx-25/approved-provenance.json");
  const licenseRegistryPath =
    env.LICENSE_REGISTRY_PATH?.trim() ||
    resolve(rootPath, "config/component-license-registry.json");

  return {
    comfyUiUrl,
    comfyUiDir,
    ...(env.GOLD_MASTER_PROVENANCE_PATH?.trim() || env.CERTIFICATION_MANIFEST_PATH?.trim()
      ? { goldMasterProvenancePath }
      : {}),
    ...(env.LICENSE_REGISTRY_PATH?.trim() ? { licenseRegistryPath } : {})
  };
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

const dummyModelSha256 = "a".repeat(64);

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
  models: [
    {
      category: "diffusion_models",
      relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
    }
  ],
  assertions: [
    {
      nodeId: "1",
      classType: "KSampler",
      input: "steps",
      equals: 8
    },
    {
      nodeId: "5",
      classType: "EmptyLTXLatentVideo",
      input: "width",
      equals: 1280
    },
    {
      nodeId: "5",
      classType: "EmptyLTXLatentVideo",
      input: "height",
      equals: 720
    },
    {
      nodeId: "5",
      classType: "EmptyLTXLatentVideo",
      input: "length",
      equals: 97
    }
  ],
  renderProfileIdentity: {
    key: "LTX_25_720P_5S_I2V_V1",
    version: 1
  }
};

const fakeLtxI2vProvenance: CertificationProvenanceReport = {
  version: 1,
  profileId: "ltx-25-720p-97f-i2v",
  generatedAt: "2026-09-02T00:00:00.000Z",
  models: [
    {
      category: "diffusion_models",
      relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
      sha256: dummyModelSha256,
      bytes: 1000
    }
  ],
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
    modelHashes: {
      "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors":
        dummyModelSha256
    }
  }
};

interface RecordedUpload {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly formType: string;
  readonly overwrite: string;
}

interface RecordedPrompt {
  readonly promptId: string;
  readonly workflow: Record<string, { class_type?: string; inputs: Record<string, unknown> }>;
  readonly clientId: string;
}

interface RecordingTransportOptions {
  readonly uploadShouldFail?: boolean;
}

function setupRecordingComfyUiTransport(options?: RecordingTransportOptions): {
  transport: FakeComfyUiTransport;
  recordedUploads: RecordedUpload[];
  recordedPrompts: RecordedPrompt[];
} {
  const transport = new FakeComfyUiTransport();
  const recordedUploads: RecordedUpload[] = [];
  const recordedPrompts: RecordedPrompt[] = [];
  let promptCounter = 0;

  transport.fakeFetch.setDefaultResponseHandler(async (input, init) => {
    const urlStr = String(input);
    if (urlStr.includes("/upload/image")) {
      const formData = init?.body as FormData;
      const file = formData.get("image") as File;
      const formType = String(formData.get("type") ?? "");
      const overwrite = String(formData.get("overwrite") ?? "");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const filename = file.name;
      const contentType = file.type;

      recordedUploads.push({
        filename,
        bytes,
        contentType,
        formType,
        overwrite
      });

      if (options?.uploadShouldFail) {
        return new Response(
          JSON.stringify({ error: "Storage or disk upload failure during staging" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          name: filename,
          subfolder: "conditioning",
          type: "input"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (urlStr.includes("/history/")) {
      const parts = urlStr.split("/");
      const promptId = parts[parts.length - 1] || "prompt-1";
      return new Response(
        JSON.stringify({
          [promptId]: {
            status: { completed: true, status_str: "success" },
            outputs: {
              "9": {
                images: [{ filename: "output.webp", type: "output", subfolder: "" }]
              }
            }
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    if (urlStr.endsWith("/prompt") || urlStr.includes("/prompt?")) {
      promptCounter += 1;
      const promptId = `prompt-${promptCounter}`;
      const body = JSON.parse(init?.body as string);
      recordedPrompts.push({
        promptId,
        workflow: body.prompt,
        clientId: body.client_id
      });

      queueMicrotask(() => {
        const ws = transport.createdWebSockets[transport.createdWebSockets.length - 1];
        if (ws) {
          ws.message({
            type: "executing",
            data: { prompt_id: promptId, node: null }
          });
        }
      });

      return new Response(JSON.stringify({ prompt_id: promptId }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (urlStr.includes("/free")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  });

  const origCreateWebSocket = transport.createWebSocket.bind(transport);
  transport.createWebSocket = (url: string) => {
    const ws = origCreateWebSocket(url);
    const origAddEventListener = ws.addEventListener.bind(ws);
    ws.addEventListener = (type, listener) => {
      origAddEventListener(type, listener);
      if (type === "message") {
        queueMicrotask(() => {
          ws.message({
            type: "status",
            data: { status: { exec_info: { queue_remaining: 0 } } }
          });
        });
      }
    };
    return ws;
  };

  return { transport, recordedUploads, recordedPrompts };
}

interface CreateTestWorkerOptions {
  readonly controlApiClient: ReturnType<typeof createControlApiClient>;
  readonly uow: PostgresUnitOfWork;
  readonly objectStorage: S3ObjectStorage;
  readonly transport: FakeComfyUiTransport;
  readonly loadProfile?: () => Promise<CertificationProfile>;
  readonly licenseError?: Error;
  readonly fakeVideoBytes?: Uint8Array;
}

function createTestRenderWorker(options: CreateTestWorkerOptions) {
  const client = new ComfyUiClient("http://127.0.0.1:8188", options.transport);
  const stageReferenceImage = new HttpComfyUiInputStagingAdapter({
    client,
    comfyUiDir: "/tmp/fake-comfyui",
    unlinkFn: async () => {}
  });

  const renderEngine = new ComfyUiRenderEngineAdapter({
    baseUrl: "http://127.0.0.1:8188",
    transport: options.transport
  });

  const fakeGpuLease = {
    acquireLease: async () => ({
      holder: {
        version: 1 as const,
        pid: 1234,
        startedAt: new Date().toISOString(),
        hostname: "test-host",
        leaseId: "lease-1"
      },
      release: async () => {}
    })
  };

  const fakeGpuTelemetry: GpuTelemetryPort = {
    readMemory: async () => ({
      totalVramMb: 24576,
      usedVramMb: 4096,
      freeVramMb: 20480,
      reservedVramMb: 4096,
      measuredAt: new Date().toISOString()
    })
  };

  const mockEnforceLicenseRouting: EnforceLicenseRouting = {
    enforce: () => {
      if (options.licenseError) {
        throw options.licenseError;
      }
    }
  };

  const executeProfileRenderUseCase = new ExecuteProfileRenderUseCase(
    renderEngine,
    fakeGpuLease,
    fakeGpuTelemetry,
    mockEnforceLicenseRouting
  );

  const resolveApprovedCandidateMedia = new ResolveApprovedCandidateMediaUseCase({
    sceneRepository: {
      findById: async (id: SceneId) => options.uow.execute(async (ctx) => ctx.scenes.findById(id)),
      save: async () => {}
    },
    storyboardCandidateRepository: {
      findById: async (id: CandidateId) =>
        options.uow.execute(async (ctx) => ctx.candidates.findById(id)),
      insert: async () => {},
      listBySceneAndRevision: async () => []
    },
    objectStorage: options.objectStorage,
    hashBytes: {
      hashBytes: async (bytes: Uint8Array) => sha256Hex(bytes)
    }
  });

  const productionAssembler = new AssembleGenerationManifest({
    hashBytes: {
      hashBytes: async (bytes: Uint8Array) => sha256Hex(bytes)
    },
    sceneRepository: {
      findById: async (id: SceneId) => options.uow.execute(async (ctx) => ctx.scenes.findById(id)),
      save: async () => {}
    },
    storyboardCandidateRepository: {
      findById: async (id: CandidateId) =>
        options.uow.execute(async (ctx) => ctx.candidates.findById(id)),
      insert: async () => {},
      listBySceneAndRevision: async () => []
    },
    referenceAssetRepository: {
      listBySceneId: async () => [],
      findByIds: async () => []
    }
  });

  const fakeVideoBytes =
    options.fakeVideoBytes ?? new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

  const executor = createCertifiedRenderJobExecutor({
    loadCertificationProfile: options.loadProfile ?? (async () => fakeLtxI2vProfile),
    readApprovedProvenance: async () => fakeLtxI2vProvenance,
    collectCertificationProvenance: async () => fakeLtxI2vProvenance,
    verifyGoldMasterProvenance,
    readWorkflowFile: async () => realLtxI2vWorkflow,
    hashWorkflow: () => fakeLtxI2vProfile.expectedWorkflowHash,
    resolveApprovedCandidateMedia,
    objectStorage: options.objectStorage,
    stageReferenceImage,
    useCase: executeProfileRenderUseCase,
    outputReader: {
      readOutput: async () => ({
        bytes: fakeVideoBytes,
        contentType: "video/mp4"
      })
    },
    productionManifestAssembler: productionAssembler
  });

  const worker = new RenderWorker(
    {
      controlApiClient: options.controlApiClient,
      objectStorage: options.objectStorage,
      enforceStorageAdmission: {
        execute: async () => {}
      } as unknown as EnforceStorageAdmission,
      renderJobExecutor: async (job) => {
        try {
          return await executor(job);
        } catch (err) {
          console.error("[EXECUTOR-FAILED]", err);
          throw err;
        }
      },
      logger: {
        info: () => {},
        warn: (...args: unknown[]) => console.warn("[WORKER-WARN]", ...args),
        error: (...args: unknown[]) => console.error("[WORKER-ERROR]", ...args)
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

  return { worker, stageReferenceImage };
}

async function setupTestScene(
  client: PoolClient,
  objectStorage: S3ObjectStorage,
  options?: {
    engineAssigned?: string;
    durationSeconds?: number;
    specRevision?: number;
    candidateCount?: number;
    visualDescription?: string;
  }
) {
  const clientRecord = await insertClientRecord(client);
  const campaign = await insertCampaignRecord(client, {
    clientId: clientRecord.client_id,
    totalScenes: 1
  });
  const sceneRecord = await insertStoryboardSceneRecord(client, {
    campaignId: campaign.campaign_id,
    durationSeconds: options?.durationSeconds ?? 4.042,
    status: "director_review",
    specRevision: options?.specRevision ?? 1,
    engineAssigned: options?.engineAssigned ?? "LTX_25_720P_5S_I2V_V1",
    visualDescription:
      options?.visualDescription ?? "Sunset over Caribbean waters with cinematic motion blur."
  });

  const candidates: Array<{
    candidateId: string;
    candidateStorageKey: string;
    bytes: Uint8Array;
    hash: string;
  }> = [];

  const count = options?.candidateCount ?? 1;
  for (let i = 1; i <= count; i++) {
    const bytes = new Uint8Array([
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
      0,
      0,
      0,
      13,
      73,
      72,
      68,
      82,
      0,
      0,
      0,
      i,
      0,
      0,
      0,
      i,
      8,
      6,
      0,
      0,
      0,
      31,
      21,
      196,
      137 + i
    ]);
    const hash = sha256Hex(bytes);
    const candidateStorageKey = `candidates/${sceneRecord.scene_id}/rev_${sceneRecord.spec_revision}_var_${i}.png`;

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: candidateStorageKey,
      body: bytes,
      contentType: "image/png"
    });

    const candidateRecord = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id as SceneId,
      sceneSpecRevision: sceneRecord.spec_revision,
      variantOrdinal: i,
      storageBucket: BUCKETS.REVIEW,
      storageObjectKey: candidateStorageKey,
      contentHashSha256: hash
    });

    candidates.push({
      candidateId: candidateRecord.candidate_id,
      candidateStorageKey,
      bytes,
      hash
    });
  }

  if (candidates.length > 0) {
    await client.query(
      `UPDATE storyboard_scenes
       SET selected_candidate_id = $1,
           selected_candidate_revision = $2
       WHERE scene_id = $3`,
      [candidates[0]!.candidateId, sceneRecord.spec_revision, sceneRecord.scene_id]
    );
  }

  return {
    clientRecord,
    campaign,
    sceneRecord,
    candidates
  };
}

describe("LTX-2.5 Production Render End-to-End Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let pool: Pool;
  let serverApp: ReturnType<typeof createControlApiApp> | undefined;

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
    return { url: address, app, uow };
  }

  it("AC-1, AC-2, AC-8: normal control-plane dispatch without manual override selects I2V profile, injects referenceImage over real transport, and carries execution provenance to manifest", async () => {
    const origEnableI2v = process.env.ENABLE_I2V_PRODUCTION;
    const origCcoEnableI2v = process.env.CCO_ENABLE_I2V_PRODUCTION;
    delete process.env.ENABLE_I2V_PRODUCTION;
    delete process.env.CCO_ENABLE_I2V_PRODUCTION;

    try {
      const { uow, url: controlApiBaseUrl } = await startControlApi();
      const client = await pool.connect();
      let sceneId: string;
      let candidateId: string;
      let candidateHash: string;

      try {
        const setup = await setupTestScene(client, objectStorage, {
          engineAssigned: "LTX_25_720P_5S_I2V_V1"
        });
        sceneId = setup.sceneRecord.scene_id;
        candidateId = setup.candidates[0]!.candidateId;
        candidateHash = setup.candidates[0]!.hash;

        // Verify scene configuration carries the I2V profile identity directly
        expect(setup.sceneRecord.engine_assigned).toBe("LTX_25_720P_5S_I2V_V1");
      } finally {
        client.release();
      }

      // 1. Normal dispatch: construct EnqueueSceneProductionRenderUseCase with zero options and no env vars
      const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
      const approveAndDispatch = new ApproveSceneAndDispatchCampaignProductionUseCase(
        uow,
        enqueueUseCase
      );
      await approveAndDispatch.execute({
        sceneId,
        eventId: randomUUID(),
        reviewerName: "director-e2e-normal",
        occurredAt: new Date().toISOString()
      });

      // Verify render job created has I2V workflow template, candidate bound, frameCount undefined
      const verifyClient1 = await pool.connect();
      let jobId: string;
      try {
        const dbJob = await verifyClient1.query(
          "SELECT job_id, job_kind, workflow_template, injected_payload, status FROM render_jobs WHERE scene_id = $1",
          [sceneId]
        );
        expect(dbJob.rows).toHaveLength(1);
        const row = dbJob.rows[0]!;
        jobId = row.job_id;
        expect(row.job_kind).toBe("production");
        expect(row.workflow_template).toBe("ltx-25-720p-97f-i2v");
        expect(row.status).toBe("queued");
        expect(row.injected_payload.approvedCandidateId).toBe(candidateId);
        expect(row.injected_payload.frameCount).toBeUndefined();
        expect(typeof row.injected_payload.seed).toBe("number");
      } finally {
        verifyClient1.release();
      }

      // 2. Worker claims job
      const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
      const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
      expect(claimedJob).toBeDefined();
      expect(claimedJob?.jobId).toBe(jobId);

      // 3. Process with real transport stack
      const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
      const { worker } = createTestRenderWorker({
        controlApiClient,
        uow,
        objectStorage,
        transport
      });

      const outcome = await worker.processJob(claimedJob!);
      expect(outcome).toBe("completed");

      // 4. Assert real transport HTTP upload and prompt calls (AC-2)
      expect(recordedUploads).toHaveLength(1);
      const upload = recordedUploads[0]!;
      expect(upload.formType).toBe("input");
      expect(sha256Hex(upload.bytes)).toBe(candidateHash);

      expect(recordedPrompts).toHaveLength(1);
      const prompt = recordedPrompts[0]!;
      const node20 = prompt.workflow["20"]?.inputs as Record<string, unknown> | undefined;
      expect(node20?.["image"]).toBe(`conditioning/${upload.filename}`);
      const node3 = prompt.workflow["3"]?.inputs as Record<string, unknown> | undefined;
      expect(node3?.["text"]).toBe("Sunset over Caribbean waters with cinematic motion blur.");
      const node1 = prompt.workflow["1"]?.inputs as Record<string, unknown> | undefined;
      expect(node1?.["seed"]).toBe(claimedJob!.injectedPayload.seed);

      // 5. Assert DB state & GenerationManifest provenance (AC-8)
      const verifyClient2 = await pool.connect();
      try {
        const dbScene = await verifyClient2.query(
          "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
          [sceneId]
        );
        expect(dbScene.rows[0]?.status).toBe("qa");

        const dbJob = await verifyClient2.query(
          "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
          [jobId]
        );
        expect(dbJob.rows[0]?.status).toBe("completed");
        expect(dbJob.rows[0]?.error_trace).toBeNull();

        const dbManifest = await verifyClient2.query(
          "SELECT manifest_payload FROM generation_manifests WHERE job_id = $1",
          [jobId]
        );
        expect(dbManifest.rows).toHaveLength(1);
        const payload = dbManifest.rows[0]?.manifest_payload;
        expect(payload.renderProfile).toBe("ltx-25-720p-97f-i2v");
        expect(payload.engine).toBe("ltx_25_i2v");
        expect(payload.executionConditioning.candidateId).toBe(candidateId);
        expect(payload.executionConditioning.contentHashSha256).toBe(candidateHash);
        expect(payload.executionConditioning.stagedAs.name).toBe(upload.filename);
        expect(payload.approvedCandidate.id).toBe(candidateId);
        expect(payload.approvedCandidate.contentHash).toBe(candidateHash);

        // Verify S3 video delivery
        const videoObjectKey = payload.outputs[0].key;
        const storedVideo = await objectStorage.getObject({
          bucket: BUCKETS.DELIVERY,
          key: videoObjectKey
        });
        expect(storedVideo).toBeDefined();
        expect(sha256Hex(storedVideo!.body)).toBe(payload.outputs[0].checksumSha256);
      } finally {
        verifyClient2.release();
      }
    } finally {
      if (origEnableI2v !== undefined) {
        process.env.ENABLE_I2V_PRODUCTION = origEnableI2v;
      } else {
        delete process.env.ENABLE_I2V_PRODUCTION;
      }
      if (origCcoEnableI2v !== undefined) {
        process.env.CCO_ENABLE_I2V_PRODUCTION = origCcoEnableI2v;
      } else {
        delete process.env.CCO_ENABLE_I2V_PRODUCTION;
      }
    }
  });

  it("normal reviewed production selects I2V workflow and executes conditioning even for scenes configured with legacy profile", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;
    let candidateId: string;
    let candidateHash: string;

    try {
      const setup = await setupTestScene(client, objectStorage, {
        engineAssigned: "ltx_25" // Legacy engine profile
      });
      sceneId = setup.sceneRecord.scene_id;
      candidateId = setup.candidates[0]!.candidateId;
      candidateHash = setup.candidates[0]!.hash;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-override',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidateId, sceneId]
      );
    } finally {
      client.release();
    }

    // Enqueue using normal reviewed production dispatch (no rollout override needed)
    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    const enqueueResult = await enqueueUseCase.execute({ sceneId });

    expect(enqueueResult.job.workflowTemplate).toBe("ltx-25-720p-97f-i2v");
    expect(enqueueResult.job.injectedPayload.approvedCandidateId).toBe(candidateId);

    // Claim and process with real transport
    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("completed");
    expect(recordedUploads).toHaveLength(1);
    expect(sha256Hex(recordedUploads[0]!.bytes)).toBe(candidateHash);
    expect(recordedPrompts).toHaveLength(1);
    expect(recordedPrompts[0]!.workflow["20"]?.inputs?.["image"]).toBe(
      `conditioning/${recordedUploads[0]!.filename}`
    );
  });

  it("AC-3: changing the selected/approved candidate changes the actual image input submitted to ComfyUI while preserving the same SceneSpec revision rules", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;
    let candidateA: { candidateId: string; hash: string; bytes: Uint8Array };
    let candidateB: { candidateId: string; hash: string; bytes: Uint8Array };

    try {
      const setup = await setupTestScene(client, objectStorage, {
        candidateCount: 2
      });
      sceneId = setup.sceneRecord.scene_id;
      candidateA = setup.candidates[0]!;
      candidateB = setup.candidates[1]!;
    } finally {
      client.release();
    }

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });

    // RUN 1: Approve Candidate A and render
    const client1 = await pool.connect();
    try {
      await client1.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidateA.candidateId, sceneId]
      );
    } finally {
      client1.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    await enqueueUseCase.execute({ sceneId });

    const claimedJobA = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJobA).toBeDefined();

    const transportA = setupRecordingComfyUiTransport();
    const workerA = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport: transportA.transport
    });

    const outcomeA = await workerA.worker.processJob(claimedJobA!);
    expect(outcomeA).toBe("completed");
    expect(transportA.recordedUploads).toHaveLength(1);
    const uploadA = transportA.recordedUploads[0]!;
    expect(sha256Hex(uploadA.bytes)).toBe(candidateA.hash);
    expect(transportA.recordedPrompts[0]!.workflow["20"]?.inputs?.["image"]).toBe(
      `conditioning/${uploadA.filename}`
    );

    // RUN 2: Swap approval to Candidate B on the same spec revision 1 and render
    const client2 = await pool.connect();
    try {
      await client2.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidateB.candidateId, sceneId]
      );
    } finally {
      client2.release();
    }

    await enqueueUseCase.execute({ sceneId });

    const claimedJobB = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJobB).toBeDefined();

    const transportB = setupRecordingComfyUiTransport();
    const workerB = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport: transportB.transport
    });

    const outcomeB = await workerB.worker.processJob(claimedJobB!);
    expect(outcomeB).toBe("completed");
    expect(transportB.recordedUploads).toHaveLength(1);
    const uploadB = transportB.recordedUploads[0]!;
    expect(sha256Hex(uploadB.bytes)).toBe(candidateB.hash);
    expect(transportB.recordedPrompts[0]!.workflow["20"]?.inputs?.["image"]).toBe(
      `conditioning/${uploadB.filename}`
    );

    // Assert inputs differ and match their respective candidate
    expect(sha256Hex(uploadA.bytes)).not.toBe(sha256Hex(uploadB.bytes));
    expect(uploadA.filename).not.toBe(uploadB.filename);
  });

  it("AC-4: fail-closed: a different unselected candidate from the same scene/revision cannot condition production", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;
    let candidateAId: string;
    let candidateBId: string;

    try {
      const setup = await setupTestScene(client, objectStorage, {
        candidateCount: 2
      });
      sceneId = setup.sceneRecord.scene_id;
      candidateAId = setup.candidates[0]!.candidateId;
      candidateBId = setup.candidates[1]!.candidateId;

      // Approve Candidate A
      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidateAId, sceneId]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    const enqueueResult = await enqueueUseCase.execute({ sceneId });

    // Tamper injectedPayload to reference Candidate B instead of approved Candidate A
    const clientMutate = await pool.connect();
    try {
      await clientMutate.query(
        `UPDATE render_jobs
         SET injected_payload = jsonb_set(injected_payload, '{approvedCandidateId}', to_jsonb($1::text)),
             retry_count = max_retries
         WHERE job_id = $2`,
        [candidateBId, enqueueResult.job.jobId]
      );
    } finally {
      clientMutate.release();
    }

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    // Verify DB state
    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(dbJob.rows[0]?.error_trace).toContain("CandidateIdentityMismatchError");

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    // Zero ComfyUI uploads or prompts
    expect(recordedUploads).toHaveLength(0);
    expect(recordedPrompts).toHaveLength(0);
  });

  it("AC-4: fail-closed: candidate belonging to a different scene cannot condition production", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let scene1Id: string;
    let candidate2Id: string;

    try {
      // Drop composite FK to simulate desynced database state where scene selected candidate from another scene
      await client.query(
        "ALTER TABLE storyboard_scenes DROP CONSTRAINT IF EXISTS fk_scene_selected_candidate_revision;"
      );

      const setup1 = await setupTestScene(client, objectStorage);
      scene1Id = setup1.sceneRecord.scene_id;

      const setup2 = await setupTestScene(client, objectStorage);
      candidate2Id = setup2.candidates[0]!.candidateId;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidate2Id, scene1Id]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    const enqueueResult = await enqueueUseCase.execute({ sceneId: scene1Id });

    // Tamper job payload to point to candidate from scene 2
    const clientMutate = await pool.connect();
    try {
      await clientMutate.query(
        `UPDATE render_jobs
         SET injected_payload = jsonb_set(injected_payload, '{approvedCandidateId}', to_jsonb($1::text)),
             retry_count = max_retries
         WHERE job_id = $2`,
        [candidate2Id, enqueueResult.job.jobId]
      );
    } finally {
      clientMutate.release();
    }

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(dbJob.rows[0]?.error_trace).toContain("CandidateSceneMismatchError");

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [scene1Id]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    expect(recordedUploads).toHaveLength(0);
    expect(recordedPrompts).toHaveLength(0);
  });

  it("AC-5: fail-closed: stale or misaligned candidate/selection/approval revision cannot condition production", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;
    let candidateId: string;

    try {
      const setup = await setupTestScene(client, objectStorage);
      sceneId = setup.sceneRecord.scene_id;
      candidateId = setup.candidates[0]!.candidateId;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidateId, sceneId]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    const enqueueResult = await enqueueUseCase.execute({ sceneId });

    // Invalidate candidate on spec revision bump:
    // Scene spec_revision increments to 2, while candidate was generated for spec_revision 1
    const clientMutate = await pool.connect();
    try {
      // Drop constraints to simulate stale candidate reference in Postgres
      await clientMutate.query(
        "ALTER TABLE storyboard_scenes DROP CONSTRAINT IF EXISTS storyboard_scene_selected_revision_current;"
      );
      await clientMutate.query(
        "ALTER TABLE storyboard_scenes DROP CONSTRAINT IF EXISTS fk_scene_selected_candidate_revision;"
      );

      await clientMutate.query(
        `UPDATE storyboard_scenes
         SET spec_revision = 2
         WHERE scene_id = $1`,
        [sceneId]
      );
      await clientMutate.query(
        "UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1",
        [enqueueResult.job.jobId]
      );
    } finally {
      clientMutate.release();
    }

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(dbJob.rows[0]?.error_trace).toContain("StaleCandidateRevisionError");

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    expect(recordedUploads).toHaveLength(0);
    expect(recordedPrompts).toHaveLength(0);
  });

  it("AC-6: fail-closed: missing candidate media fails deterministically with actionable error", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;
    let candidateStorageKey: string;

    try {
      const setup = await setupTestScene(client, objectStorage);
      sceneId = setup.sceneRecord.scene_id;
      const candidate = setup.candidates[0]!;
      candidateStorageKey = candidate.candidateStorageKey;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidate.candidateId, sceneId]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    await enqueueUseCase.execute({ sceneId });

    // Delete candidate media from MinIO before worker processes it
    await rawS3Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: candidateStorageKey
      })
    );

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const clientMutate = await pool.connect();
    try {
      await clientMutate.query(
        "UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1",
        [claimedJob!.jobId]
      );
    } finally {
      clientMutate.release();
    }

    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(dbJob.rows[0]?.error_trace).toContain("ApprovedCandidateMediaUnavailableError");

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    expect(recordedUploads).toHaveLength(0);
    expect(recordedPrompts).toHaveLength(0);
  });

  it("AC-6: fail-closed: corrupt/hash-mismatched candidate media fails deterministically", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;
    let candidateStorageKey: string;

    try {
      const setup = await setupTestScene(client, objectStorage);
      sceneId = setup.sceneRecord.scene_id;
      const candidate = setup.candidates[0]!;
      candidateStorageKey = candidate.candidateStorageKey;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidate.candidateId, sceneId]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    await enqueueUseCase.execute({ sceneId });

    // Overwrite candidate media in MinIO with corrupt bytes
    const corruptBytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: candidateStorageKey,
      body: corruptBytes,
      contentType: "image/png"
    });

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const clientMutate = await pool.connect();
    try {
      await clientMutate.query(
        "UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1",
        [claimedJob!.jobId]
      );
    } finally {
      clientMutate.release();
    }

    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(
        dbJob.rows[0]?.error_trace?.includes("ApprovedCandidateMediaHashMismatchError") ||
          dbJob.rows[0]?.error_trace?.includes("ReferenceImageIntegrityError")
      ).toBe(true);

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    expect(recordedUploads).toHaveLength(0);
    expect(recordedPrompts).toHaveLength(0);
  });

  it("AC-7: fail-closed: missing/unrepresentable conditioned profile cannot silently fall back to text-only generation", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;

    try {
      const setup = await setupTestScene(client, objectStorage);
      sceneId = setup.sceneRecord.scene_id;
      const candidate = setup.candidates[0]!;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidate.candidateId, sceneId]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    await enqueueUseCase.execute({ sceneId });

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const clientMutate = await pool.connect();
    try {
      await clientMutate.query(
        "UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1",
        [claimedJob!.jobId]
      );
    } finally {
      clientMutate.release();
    }

    const { transport, recordedPrompts } = setupRecordingComfyUiTransport();
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport,
      loadProfile: async () => {
        throw new MissingCertifiedProfileError("ltx-25-720p-97f-i2v");
      }
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(dbJob.rows[0]?.error_trace).toContain("MissingCertifiedProfileError");

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    // Strictly assert zero prompts were submitted to ComfyUI (no fallback to legacy profile)
    expect(recordedPrompts).toHaveLength(0);
  });

  it("AC-7: fail-closed: staging/injection failure fails deterministically and prevents prompt submission", async () => {
    const { uow, url: controlApiBaseUrl } = await startControlApi();
    const client = await pool.connect();
    let sceneId: string;

    try {
      const setup = await setupTestScene(client, objectStorage);
      sceneId = setup.sceneRecord.scene_id;
      const candidate = setup.candidates[0]!;

      await client.query(
        `UPDATE storyboard_scenes
         SET status = 'approved',
             approved_by = 'director-test',
             approved_at = NOW(),
             approved_revision = 1,
             selected_candidate_id = $1,
             selected_candidate_revision = 1
         WHERE scene_id = $2`,
        [candidate.candidateId, sceneId]
      );
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
    await enqueueUseCase.execute({ sceneId });

    const controlApiClient = createControlApiClient({ baseUrl: controlApiBaseUrl });
    const claimedJob = await controlApiClient.claim("worker-ltx-test", ["production"]);
    expect(claimedJob).toBeDefined();

    const clientMutate = await pool.connect();
    try {
      await clientMutate.query(
        "UPDATE render_jobs SET retry_count = max_retries WHERE job_id = $1",
        [claimedJob!.jobId]
      );
    } finally {
      clientMutate.release();
    }

    // Transport configured to fail on upload/image
    const { transport, recordedUploads, recordedPrompts } = setupRecordingComfyUiTransport({
      uploadShouldFail: true
    });
    const { worker } = createTestRenderWorker({
      controlApiClient,
      uow,
      objectStorage,
      transport
    });

    const outcome = await worker.processJob(claimedJob!);
    expect(outcome).toBe("failed");

    const verifyClient = await pool.connect();
    try {
      const dbJob = await verifyClient.query(
        "SELECT status, error_trace FROM render_jobs WHERE job_id = $1",
        [claimedJob!.jobId]
      );
      expect(dbJob.rows[0]?.status).toBe("failed");
      expect(dbJob.rows[0]?.error_trace).toContain("ReferenceImageStagingError");

      const dbScene = await verifyClient.query(
        "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
        [sceneId]
      );
      expect(dbScene.rows[0]?.status).toBe("failed");
    } finally {
      verifyClient.release();
    }

    // Upload was attempted but rejected
    expect(recordedUploads).toHaveLength(1);
    // Zero prompts submitted to ComfyUI
    expect(recordedPrompts).toHaveLength(0);
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
      const candidateFixturePath = resolve(
        fileURLToPath(new URL("../fixtures/deterministic-reference.png", import.meta.url))
      );
      const candidateImageBytes = readFileSync(candidateFixturePath);
      const candidateHash = sha256Hex(candidateImageBytes);
      expect(candidateHash).toBe(
        "37ff59a820284c1dac27db2f824add8e8504b746c39c3dba4306fc206696ce3b"
      );

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

      // 2. Enqueue production render job via EnqueueSceneProductionRenderUseCase (default conditioned dispatch)
      const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow);
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
          goldMasterProvenancePath:
            liveConfig.goldMasterProvenancePath ??
            resolve(rootPath, "certification/ltx-25/approved-provenance.json"),
          licenseRegistryPath:
            liveConfig.licenseRegistryPath ??
            resolve(rootPath, "config/component-license-registry.json"),
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
