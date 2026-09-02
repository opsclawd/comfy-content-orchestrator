import { createHash } from "node:crypto";
import path, { resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
const { Pool } = pg;
import {
  AssembleGenerationManifest,
  EnforceLicenseRouting,
  EnforceStorageAdmission,
  ExecuteProfileRenderUseCase,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type GpuExecutionLeasePort,
  type GpuTelemetryPort,
  type HashBytesPort,
  type ReferenceAssetRepository,
  type RenderEnginePort,
  type SceneRepository,
  type StoryboardCandidateRepository
} from "@cco/application";
import { JOB_KINDS, type JobKind } from "@cco/domain";
import {
  ComfyUiRenderEngineAdapter,
  HostFsStorageTelemetryAdapter,
  HttpComfyUiOutputReader,
  JsonFileLicenseRegistryPort,
  loadComponentLicenseRegistrySync,
  LocalFsGpuLeaseAdapter,
  NvidiaSmiTelemetryAdapter,
  PostgresReferenceAssetRepository,
  PostgresSceneRepository,
  PostgresStoryboardCandidateRepository,
  S3ObjectStorage,
  type collectCertificationProvenance,
  type ComfyUiOutputReader,
  type hashWorkflow,
  type loadCertificationProfile,
  type S3ObjectStorageOptions
} from "@cco/infrastructure";
import { BUCKETS } from "@cco/shared";
import type { verifyGoldMasterProvenance } from "../certification/preflight.js";
import { createControlApiClient } from "../control-api-client.js";
import {
  createCertifiedRenderJobExecutor,
  ProductionManifestAssemblyError,
  type AssembleProductionManifestInput,
  type ProductionManifestAssembler
} from "../render-job-executor.js";
import { RenderWorker, type RenderWorkerOptions, type WorkerDependencies } from "../worker.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const DEFAULT_MANIFEST_PATH = resolve(DEFAULT_REPO_ROOT, "templates/provenance.json");
const DEFAULT_LICENSE_REGISTRY_PATH = resolve(
  DEFAULT_REPO_ROOT,
  "config/component-license-registry.json"
);

export interface WorkerRuntimeConfig {
  readonly storageTelemetryPath: string;
  readonly controlApiBaseUrl: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly telemetryBackoffMs?: number | undefined;
  readonly admissionBackoffMs?: number | undefined;
  readonly allowedJobKinds?: readonly JobKind[] | undefined;
  readonly databaseUrl?: string | undefined;
  readonly comfyUiUrl: string;
  readonly comfyUiRenderTimeoutMs: number;
  readonly comfyUiDir: string;
  readonly gpuIndex: number;
  readonly gpuLeasePath: string;
  readonly certificationManifestPath: string;
  readonly goldMasterProvenancePath: string;
  readonly licenseRegistryPath: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly s3CandidateBucket: string;
  readonly s3DeliveryBucket: string;
  readonly s3Config: S3ObjectStorageOptions;
}

export class WorkerConfigError extends Error {
  override readonly name = "WorkerConfigError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export interface ProductionWorkerOverrides extends Partial<WorkerDependencies> {
  readonly productionManifestAssembler?: ProductionManifestAssembler | undefined;
  readonly sceneRepository?: SceneRepository | undefined;
  readonly storyboardCandidateRepository?: StoryboardCandidateRepository | undefined;
  readonly referenceAssetRepository?: ReferenceAssetRepository | undefined;
  readonly hashBytes?: HashBytesPort | undefined;
  readonly pool?: pg.Pool | undefined;
  readonly renderEngine?: RenderEnginePort | undefined;
  readonly gpuLease?: GpuExecutionLeasePort | undefined;
  readonly gpuTelemetry?: GpuTelemetryPort | undefined;
  readonly enforceLicenseRouting?: EnforceLicenseRouting | undefined;
  readonly loadComponentLicenseRegistry?: typeof loadComponentLicenseRegistrySync | undefined;
  readonly executeProfileRenderUseCase?:
    | { execute: (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult> }
    | undefined;
  readonly useCase?:
    | { execute: (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult> }
    | undefined;
  readonly outputReader?: ComfyUiOutputReader | undefined;
  readonly loadCertificationProfile?: typeof loadCertificationProfile | undefined;
  readonly readApprovedProvenance?: ((filePath: string) => Promise<unknown>) | undefined;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance | undefined;
  readonly verifyGoldMasterProvenance?: typeof verifyGoldMasterProvenance | undefined;
  readonly readWorkflowFile?: ((filePath: string) => Promise<string>) | undefined;
  readonly hashWorkflow?: typeof hashWorkflow | undefined;
  readonly now?: (() => Date) | undefined;
}

export function parseStorageTelemetryPath(
  val: unknown,
  varName = "STORAGE_TELEMETRY_PATH"
): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new WorkerConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  const trimmed = val.trim();
  if (!path.isAbsolute(trimmed)) {
    throw new WorkerConfigError(
      `Invalid storage telemetry path in variable: ${varName} (must be an absolute path)`
    );
  }
  if (trimmed === "/" || trimmed === "") {
    throw new WorkerConfigError(
      `Invalid storage telemetry path in variable: ${varName} (must be a dedicated storage directory, not root)`
    );
  }
  return trimmed;
}

function parseHttpUrl(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new WorkerConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  const trimmed = val.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Protocol must be http or https");
    }
    return trimmed;
  } catch {
    throw new WorkerConfigError(
      `Invalid HTTP URL in variable: ${varName} (must be a valid http or https URL)`
    );
  }
}

function parseDatabaseUrl(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new WorkerConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  const trimmed = val.trim();
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    throw new WorkerConfigError(
      `Invalid URL in variable: ${varName} (must be a valid connection URL)`
    );
  }
}

function parseRequiredString(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new WorkerConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  return val.trim();
}

function parsePositiveInteger(val: unknown, varName: string, defaultValue: number): number {
  if (val === undefined || val === null) {
    return defaultValue;
  }
  if (typeof val === "number") {
    if (!Number.isSafeInteger(val) || val <= 0) {
      throw new WorkerConfigError(
        `Invalid positive integer in variable: ${varName} (must be a positive integer)`
      );
    }
    return val;
  }
  if (typeof val !== "string") {
    throw new WorkerConfigError(
      `Invalid positive integer in variable: ${varName} (must be a positive integer)`
    );
  }
  const trimmed = val.trim();
  if (trimmed === "") {
    return defaultValue;
  }
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new WorkerConfigError(
      `Invalid positive integer in variable: ${varName} (must be a positive integer)`
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new WorkerConfigError(
      `Invalid positive integer in variable: ${varName} (must be a positive integer)`
    );
  }
  return parsed;
}

function parseNonNegativeInteger(val: unknown, varName: string, defaultValue: number): number {
  if (val === undefined || val === null) {
    return defaultValue;
  }
  if (typeof val === "number") {
    if (!Number.isSafeInteger(val) || val < 0) {
      throw new WorkerConfigError(
        `Invalid non-negative integer in variable: ${varName} (must be a non-negative integer)`
      );
    }
    return val;
  }
  if (typeof val !== "string") {
    throw new WorkerConfigError(
      `Invalid non-negative integer in variable: ${varName} (must be a non-negative integer)`
    );
  }
  const trimmed = val.trim();
  if (trimmed === "") {
    return defaultValue;
  }
  if (!/^(0|[1-9]\d*)$/.test(trimmed)) {
    throw new WorkerConfigError(
      `Invalid non-negative integer in variable: ${varName} (must be a non-negative integer)`
    );
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WorkerConfigError(
      `Invalid non-negative integer in variable: ${varName} (must be a non-negative integer)`
    );
  }
  return parsed;
}

function parseBoolean(val: unknown, varName: string, defaultValue: boolean): boolean {
  if (val === undefined || val === null) {
    return defaultValue;
  }
  if (typeof val === "boolean") {
    return val;
  }
  if (typeof val === "string") {
    const trimmed = val.trim().toLowerCase();
    if (trimmed === "") {
      return defaultValue;
    }
    if (trimmed === "true" || trimmed === "1" || trimmed === "yes") {
      return true;
    }
    if (trimmed === "false" || trimmed === "0" || trimmed === "no") {
      return false;
    }
  }
  throw new WorkerConfigError(
    `Invalid boolean flag in variable: ${varName} (expected 'true' or 'false')`
  );
}

function parseAllowedJobKinds(
  val: unknown,
  varName = "WORKER_ALLOWED_JOB_KINDS"
): readonly JobKind[] | undefined {
  if (val === undefined || val === null) {
    return undefined;
  }
  if (typeof val !== "string") {
    throw new WorkerConfigError(`Invalid job kinds list in variable: ${varName}`);
  }
  const trimmed = val.trim();
  if (trimmed === "") {
    return undefined;
  }
  const items = trimmed.split(",").map((s) => s.trim());
  const validKinds: JobKind[] = [];
  for (const item of items) {
    if (!item || !(JOB_KINDS as readonly string[]).includes(item)) {
      throw new WorkerConfigError(
        `Invalid job kind in variable: ${varName} (expected comma-separated valid JobKind: ${JOB_KINDS.join(", ")}, received "${item}")`
      );
    }
    if (!validKinds.includes(item as JobKind)) {
      validKinds.push(item as JobKind);
    }
  }
  return Object.freeze(validKinds);
}

export function parseWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerRuntimeConfig {
  // 1. Control API / Worker Identity
  const rawControlApiUrl = env.CONTROL_API_BASE_URL ?? env.CONTROL_API_URL;
  const controlApiVarName =
    env.CONTROL_API_BASE_URL !== undefined || env.CONTROL_API_URL === undefined
      ? "CONTROL_API_BASE_URL"
      : "CONTROL_API_URL";
  const controlApiBaseUrl = parseHttpUrl(rawControlApiUrl, controlApiVarName);

  const rawWorkerId = env.WORKER_ID;
  let workerId = "render-worker-default";
  if (rawWorkerId !== undefined) {
    if (rawWorkerId.trim() === "") {
      throw new WorkerConfigError("Missing or empty required environment variable: WORKER_ID");
    }
    workerId = rawWorkerId.trim();
  }

  // 2. Timings
  const pollIntervalMs = parsePositiveInteger(
    env.JOB_POLL_INTERVAL_MS,
    "JOB_POLL_INTERVAL_MS",
    1000
  );

  const rawHeartbeat = env.JOB_HEARTBEAT_INTERVAL_MS ?? env.HEARTBEAT_INTERVAL_MS;
  const heartbeatVarName =
    env.JOB_HEARTBEAT_INTERVAL_MS !== undefined || env.HEARTBEAT_INTERVAL_MS === undefined
      ? "JOB_HEARTBEAT_INTERVAL_MS"
      : "HEARTBEAT_INTERVAL_MS";
  const heartbeatIntervalMs = parsePositiveInteger(rawHeartbeat, heartbeatVarName, 30_000);

  const rawLease = env.JOB_LEASE_DURATION_MS ?? env.LEASE_DURATION_MS;
  const leaseVarName =
    env.JOB_LEASE_DURATION_MS !== undefined || env.LEASE_DURATION_MS === undefined
      ? "JOB_LEASE_DURATION_MS"
      : "LEASE_DURATION_MS";
  const leaseDurationMs = parsePositiveInteger(rawLease, leaseVarName, 300_000);

  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new WorkerConfigError(
      "Invalid job dispatch configuration: heartbeat interval must be less than lease duration"
    );
  }

  const rawTelemetryBackoff = env.JOB_TELEMETRY_BACKOFF_MS ?? env.TELEMETRY_BACKOFF_MS;
  const telemetryBackoffVarName =
    env.JOB_TELEMETRY_BACKOFF_MS !== undefined || env.TELEMETRY_BACKOFF_MS === undefined
      ? "JOB_TELEMETRY_BACKOFF_MS"
      : "TELEMETRY_BACKOFF_MS";
  const telemetryBackoffMs =
    rawTelemetryBackoff !== undefined && rawTelemetryBackoff.trim() !== ""
      ? parsePositiveInteger(rawTelemetryBackoff, telemetryBackoffVarName, 5000)
      : undefined;

  const rawAdmissionBackoff = env.JOB_ADMISSION_BACKOFF_MS ?? env.ADMISSION_BACKOFF_MS;
  const admissionBackoffVarName =
    env.JOB_ADMISSION_BACKOFF_MS !== undefined || env.ADMISSION_BACKOFF_MS === undefined
      ? "JOB_ADMISSION_BACKOFF_MS"
      : "ADMISSION_BACKOFF_MS";
  const admissionBackoffMs =
    rawAdmissionBackoff !== undefined && rawAdmissionBackoff.trim() !== ""
      ? parsePositiveInteger(rawAdmissionBackoff, admissionBackoffVarName, 5000)
      : undefined;

  // 3. Allowed Job Kinds
  const rawAllowedKinds = env.WORKER_ALLOWED_JOB_KINDS ?? env.ALLOWED_JOB_KINDS;
  const allowedKindsVarName =
    env.WORKER_ALLOWED_JOB_KINDS !== undefined || env.ALLOWED_JOB_KINDS === undefined
      ? "WORKER_ALLOWED_JOB_KINDS"
      : "ALLOWED_JOB_KINDS";
  const allowedJobKinds = parseAllowedJobKinds(rawAllowedKinds, allowedKindsVarName);

  // 4. ComfyUI Configuration
  const rawComfyUiUrl = env.COMFYUI_URL ?? env.COMFYUI_BASE_URL;
  const comfyUiUrlVarName =
    env.COMFYUI_URL !== undefined || env.COMFYUI_BASE_URL === undefined
      ? "COMFYUI_URL"
      : "COMFYUI_BASE_URL";
  const comfyUiUrl = parseHttpUrl(rawComfyUiUrl, comfyUiUrlVarName);

  const comfyUiRenderTimeoutMs = parsePositiveInteger(
    env.COMFYUI_RENDER_TIMEOUT_MS,
    "COMFYUI_RENDER_TIMEOUT_MS",
    300_000
  );

  const comfyUiDir = parseRequiredString(env.COMFYUI_DIR, "COMFYUI_DIR");

  // 5. GPU Configuration
  const gpuIndex = parseNonNegativeInteger(env.GPU_INDEX, "GPU_INDEX", 0);
  const rawGpuLeasePath = env.GPU_LEASE_PATH;
  let gpuLeasePath: string;
  if (rawGpuLeasePath !== undefined) {
    if (rawGpuLeasePath.trim() === "") {
      throw new WorkerConfigError("Missing or empty required environment variable: GPU_LEASE_PATH");
    }
    gpuLeasePath = rawGpuLeasePath.trim();
  } else {
    gpuLeasePath = path.join(tmpdir(), `comfy-content-orchestrator-gpu-${gpuIndex}.lock`);
  }

  // 6. Provenance & Profile Manifest Paths
  const rawManifestPath = env.CERTIFICATION_MANIFEST_PATH ?? env.MANIFEST_PATH;
  let certificationManifestPath = DEFAULT_MANIFEST_PATH;
  if (rawManifestPath !== undefined) {
    if (rawManifestPath.trim() === "") {
      throw new WorkerConfigError(
        "Missing or empty required environment variable: CERTIFICATION_MANIFEST_PATH"
      );
    }
    certificationManifestPath = rawManifestPath.trim();
  }

  const rawProvenancePath = env.GOLD_MASTER_PROVENANCE_PATH;
  let goldMasterProvenancePath = certificationManifestPath;
  if (rawProvenancePath !== undefined) {
    if (rawProvenancePath.trim() === "") {
      throw new WorkerConfigError(
        "Missing or empty required environment variable: GOLD_MASTER_PROVENANCE_PATH"
      );
    }
    goldMasterProvenancePath = rawProvenancePath.trim();
  }

  // 7. License Registry Path
  const rawLicenseRegistryPath = env.LICENSE_REGISTRY_PATH;
  let licenseRegistryPath = DEFAULT_LICENSE_REGISTRY_PATH;
  if (rawLicenseRegistryPath !== undefined) {
    if (rawLicenseRegistryPath.trim() === "") {
      throw new WorkerConfigError(
        "Missing or empty required environment variable: LICENSE_REGISTRY_PATH"
      );
    }
    licenseRegistryPath = rawLicenseRegistryPath.trim();
  }

  // 8. Storage Telemetry Path
  const storageTelemetryPath = parseStorageTelemetryPath(
    env.STORAGE_TELEMETRY_PATH,
    "STORAGE_TELEMETRY_PATH"
  );

  // 9. S3 Configuration
  const rawS3Endpoint = env.S3_STORAGE_ENDPOINT ?? env.S3_ENDPOINT;
  const s3EndpointVarName =
    env.S3_STORAGE_ENDPOINT !== undefined || env.S3_ENDPOINT === undefined
      ? "S3_STORAGE_ENDPOINT"
      : "S3_ENDPOINT";
  const s3Endpoint = parseHttpUrl(rawS3Endpoint, s3EndpointVarName);

  const rawAccessKey = env.AWS_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY_ID ?? env.S3_ACCESS_KEY;
  const accessKeyVarName =
    env.AWS_ACCESS_KEY_ID !== undefined ||
    (env.S3_ACCESS_KEY_ID === undefined && env.S3_ACCESS_KEY === undefined)
      ? "AWS_ACCESS_KEY_ID"
      : env.S3_ACCESS_KEY_ID !== undefined
        ? "S3_ACCESS_KEY_ID"
        : "S3_ACCESS_KEY";
  const s3AccessKeyId = parseRequiredString(rawAccessKey, accessKeyVarName);

  const rawSecretKey = env.AWS_SECRET_ACCESS_KEY ?? env.S3_SECRET_ACCESS_KEY ?? env.S3_SECRET_KEY;
  const secretKeyVarName =
    env.AWS_SECRET_ACCESS_KEY !== undefined ||
    (env.S3_SECRET_ACCESS_KEY === undefined && env.S3_SECRET_KEY === undefined)
      ? "AWS_SECRET_ACCESS_KEY"
      : env.S3_SECRET_ACCESS_KEY !== undefined
        ? "S3_SECRET_ACCESS_KEY"
        : "S3_SECRET_KEY";
  const s3SecretAccessKey = parseRequiredString(rawSecretKey, secretKeyVarName);

  const rawRegion = (env.AWS_REGION ?? env.S3_REGION)?.trim();
  const s3Region = rawRegion && rawRegion !== "" ? rawRegion : "us-east-1";

  const s3ForcePathStyle = parseBoolean(env.S3_FORCE_PATH_STYLE, "S3_FORCE_PATH_STYLE", true);

  const rawCandidateBucket = env.S3_CANDIDATE_BUCKET ?? env.S3_READINESS_BUCKET ?? env.S3_BUCKET;
  let s3CandidateBucket: string = BUCKETS.REVIEW;
  if (rawCandidateBucket !== undefined) {
    if (rawCandidateBucket.trim() === "") {
      throw new WorkerConfigError(
        "Missing or empty required environment variable: S3_CANDIDATE_BUCKET"
      );
    }
    s3CandidateBucket = rawCandidateBucket.trim();
  }

  const rawDeliveryBucket = env.S3_DELIVERY_BUCKET;
  let s3DeliveryBucket: string = BUCKETS.DELIVERY;
  if (rawDeliveryBucket !== undefined) {
    if (rawDeliveryBucket.trim() === "") {
      throw new WorkerConfigError(
        "Missing or empty required environment variable: S3_DELIVERY_BUCKET"
      );
    }
    s3DeliveryBucket = rawDeliveryBucket.trim();
  }

  const s3Config: S3ObjectStorageOptions = {
    endpoint: s3Endpoint,
    region: s3Region,
    forcePathStyle: s3ForcePathStyle,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey
    }
  };

  const rawDbUrl = env.DATABASE_URL ?? env.CONTROL_API_DATABASE_URL;
  const dbVarName =
    env.DATABASE_URL !== undefined || env.CONTROL_API_DATABASE_URL === undefined
      ? "DATABASE_URL"
      : "CONTROL_API_DATABASE_URL";
  let databaseUrl: string | undefined;
  if (rawDbUrl !== undefined && rawDbUrl.trim() !== "") {
    databaseUrl = parseDatabaseUrl(rawDbUrl, dbVarName);
  }

  return {
    storageTelemetryPath,
    controlApiBaseUrl,
    workerId,
    pollIntervalMs,
    heartbeatIntervalMs,
    leaseDurationMs,
    ...(telemetryBackoffMs !== undefined ? { telemetryBackoffMs } : {}),
    ...(admissionBackoffMs !== undefined ? { admissionBackoffMs } : {}),
    ...(allowedJobKinds !== undefined ? { allowedJobKinds } : {}),
    ...(databaseUrl !== undefined ? { databaseUrl } : {}),
    comfyUiUrl,
    comfyUiRenderTimeoutMs,
    comfyUiDir,
    gpuIndex,
    gpuLeasePath,
    certificationManifestPath,
    goldMasterProvenancePath,
    licenseRegistryPath,
    s3Endpoint,
    s3Region,
    s3ForcePathStyle,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3CandidateBucket,
    s3DeliveryBucket,
    s3Config
  };
}

function sleepUntilTimeoutOrAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      resolve();
    }, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export function createProductionWorker(
  config?: WorkerRuntimeConfig | undefined,
  overrides?: ProductionWorkerOverrides | undefined
): RenderWorker {
  const effectiveConfig = config ?? parseWorkerRuntimeConfig();

  const hashBytesPort: HashBytesPort = overrides?.hashBytes ?? {
    hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  };

  const includesProduction =
    !effectiveConfig.allowedJobKinds || effectiveConfig.allowedJobKinds.includes("production");

  let productionManifestAssembler = overrides?.productionManifestAssembler;
  if (!productionManifestAssembler) {
    if (includesProduction) {
      const pool =
        overrides?.pool ??
        (effectiveConfig.databaseUrl
          ? new Pool({ connectionString: effectiveConfig.databaseUrl })
          : undefined);
      const sceneRepository =
        overrides?.sceneRepository ?? (pool ? new PostgresSceneRepository(pool) : undefined);
      const storyboardCandidateRepository =
        overrides?.storyboardCandidateRepository ??
        (pool ? new PostgresStoryboardCandidateRepository(pool) : undefined);
      const referenceAssetRepository =
        overrides?.referenceAssetRepository ??
        (pool ? new PostgresReferenceAssetRepository(pool) : undefined);

      if (!sceneRepository || !storyboardCandidateRepository || !referenceAssetRepository) {
        throw new WorkerConfigError(
          "DATABASE_URL or repository dependencies (sceneRepository, storyboardCandidateRepository, referenceAssetRepository) are required when production jobs are enabled"
        );
      }

      const manifestAssembler = new AssembleGenerationManifest({
        hashBytes: hashBytesPort,
        sceneRepository,
        storyboardCandidateRepository,
        referenceAssetRepository
      });

      productionManifestAssembler = async (input: AssembleProductionManifestInput) => {
        const res = await manifestAssembler.assemble(input);
        return res.manifestPayload;
      };
    } else {
      productionManifestAssembler = async () => {
        throw new ProductionManifestAssemblyError(
          "Production jobs are not enabled on this candidate-only worker"
        );
      };
    }
  }

  const renderEngine =
    overrides?.renderEngine ??
    new ComfyUiRenderEngineAdapter({
      baseUrl: effectiveConfig.comfyUiUrl,
      timeoutMs: effectiveConfig.comfyUiRenderTimeoutMs
    });

  const gpuLease =
    overrides?.gpuLease ??
    new LocalFsGpuLeaseAdapter({
      lockFilePath: effectiveConfig.gpuLeasePath
    });

  const gpuTelemetry =
    overrides?.gpuTelemetry ??
    new NvidiaSmiTelemetryAdapter({
      gpuIndex: effectiveConfig.gpuIndex,
      now: overrides?.now
    });

  const loadComponentLicenseRegistryFn =
    overrides?.loadComponentLicenseRegistry ?? loadComponentLicenseRegistrySync;

  let enforceLicenseRouting = overrides?.enforceLicenseRouting;
  if (!enforceLicenseRouting) {
    try {
      const snapshot = loadComponentLicenseRegistryFn(effectiveConfig.licenseRegistryPath);
      const registryPort = new JsonFileLicenseRegistryPort(snapshot);
      enforceLicenseRouting = new EnforceLicenseRouting({
        registry: registryPort,
        ...(overrides?.now !== undefined ? { now: overrides.now } : {})
      });
    } catch (err) {
      throw new WorkerConfigError(
        `Failed to initialize license routing guard: ${(err as Error).message}`,
        { cause: err }
      );
    }
  }

  const executeProfileRenderUseCase =
    overrides?.executeProfileRenderUseCase ??
    overrides?.useCase ??
    new ExecuteProfileRenderUseCase(
      renderEngine,
      gpuLease,
      gpuTelemetry,
      enforceLicenseRouting,
      overrides?.now
    );

  const outputReader =
    overrides?.outputReader ?? new HttpComfyUiOutputReader(effectiveConfig.comfyUiUrl);

  const renderJobExecutor =
    overrides?.renderJobExecutor ??
    createCertifiedRenderJobExecutor(
      {
        useCase: executeProfileRenderUseCase,
        outputReader,
        productionManifestAssembler,
        hashBytes: hashBytesPort,
        ...(overrides?.loadCertificationProfile !== undefined
          ? { loadCertificationProfile: overrides.loadCertificationProfile }
          : {}),
        ...(overrides?.readApprovedProvenance !== undefined
          ? { readApprovedProvenance: overrides.readApprovedProvenance }
          : {}),
        ...(overrides?.collectCertificationProvenance !== undefined
          ? { collectCertificationProvenance: overrides.collectCertificationProvenance }
          : {}),
        ...(overrides?.verifyGoldMasterProvenance !== undefined
          ? { verifyGoldMasterProvenance: overrides.verifyGoldMasterProvenance }
          : {}),
        ...(overrides?.readWorkflowFile !== undefined
          ? { readWorkflowFile: overrides.readWorkflowFile }
          : {}),
        ...(overrides?.hashWorkflow !== undefined ? { hashWorkflow: overrides.hashWorkflow } : {}),
        ...(overrides?.now !== undefined ? { now: overrides.now } : {})
      },
      {
        manifestPath: effectiveConfig.certificationManifestPath,
        goldMasterProvenancePath: effectiveConfig.goldMasterProvenancePath,
        comfyUiDir: effectiveConfig.comfyUiDir,
        candidateBucket: effectiveConfig.s3CandidateBucket,
        deliveryBucket: effectiveConfig.s3DeliveryBucket
      }
    );

  const telemetryAdapter =
    overrides?.enforceStorageAdmission !== undefined
      ? undefined
      : new HostFsStorageTelemetryAdapter({
          storagePath: effectiveConfig.storageTelemetryPath
        });

  const enforceStorageAdmission =
    overrides?.enforceStorageAdmission ??
    new EnforceStorageAdmission({
      telemetryPort: telemetryAdapter!
    });

  const controlApiClient =
    overrides?.controlApiClient ??
    createControlApiClient({
      baseUrl: effectiveConfig.controlApiBaseUrl
    });

  const objectStorage = overrides?.objectStorage ?? new S3ObjectStorage(effectiveConfig.s3Config);

  const logger = overrides?.logger ?? console;
  const sleep = overrides?.sleep ?? sleepUntilTimeoutOrAbort;

  const dependencies: WorkerDependencies = {
    controlApiClient,
    objectStorage,
    enforceStorageAdmission,
    renderJobExecutor,
    logger,
    sleep
  };

  const options: RenderWorkerOptions = {
    workerId: effectiveConfig.workerId,
    pollIntervalMs: effectiveConfig.pollIntervalMs,
    heartbeatIntervalMs: effectiveConfig.heartbeatIntervalMs,
    leaseDurationMs: effectiveConfig.leaseDurationMs,
    ...(effectiveConfig.allowedJobKinds !== undefined
      ? { allowedJobKinds: effectiveConfig.allowedJobKinds }
      : {}),
    ...(effectiveConfig.telemetryBackoffMs !== undefined
      ? { telemetryBackoffMs: effectiveConfig.telemetryBackoffMs }
      : {}),
    ...(effectiveConfig.admissionBackoffMs !== undefined
      ? { admissionBackoffMs: effectiveConfig.admissionBackoffMs }
      : {})
  };

  return new RenderWorker(dependencies, options);
}

export async function runWorkerCli(
  _argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  depsOverrides?: ProductionWorkerOverrides | undefined
): Promise<number> {
  try {
    const config = parseWorkerRuntimeConfig(env);
    const worker = createProductionWorker(config, depsOverrides);

    const abortController = new AbortController();
    let shutdownRequested = false;
    const onSignal = () => {
      if (shutdownRequested) {
        return;
      }
      shutdownRequested = true;
      worker.requestShutdown();
      abortController.abort();
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);

    try {
      await worker.start(abortController.signal);
      return 0;
    } finally {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    }
  } catch (err) {
    console.error("Worker execution failed:", err instanceof Error ? err.message : String(err));
    return 1;
  }
}

export function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void runWorkerCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
