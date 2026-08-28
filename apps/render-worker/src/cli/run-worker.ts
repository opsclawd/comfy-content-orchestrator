import path from "node:path";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EnforceStorageAdmission } from "@cco/application";
import {
  HostFsStorageTelemetryAdapter,
  S3ObjectStorage,
  type S3ObjectStorageOptions
} from "@cco/infrastructure";
import { createControlApiClient } from "../control-api-client.js";
import { createRenderJobExecutor } from "../render-job-executor.js";
import { RenderWorker, type RenderWorkerOptions, type WorkerDependencies } from "../worker.js";

export interface WorkerRuntimeConfig {
  readonly storageTelemetryPath: string;
  readonly controlApiBaseUrl: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly telemetryBackoffMs?: number | undefined;
  readonly admissionBackoffMs?: number | undefined;
  readonly s3Config?: S3ObjectStorageOptions | undefined;
}

export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

function parseRequiredString(val: unknown, varName: string): string {
  if (typeof val !== "string" || val.trim() === "") {
    throw new WorkerConfigError(`Missing or empty required environment variable: ${varName}`);
  }
  return val.trim();
}

export function parseStorageTelemetryPath(
  val: unknown,
  varName = "STORAGE_TELEMETRY_PATH"
): string {
  const raw = parseRequiredString(val, varName);
  if (!path.isAbsolute(raw)) {
    throw new WorkerConfigError(
      `Invalid storage telemetry path in variable: ${varName} (must be an absolute path)`
    );
  }
  return raw;
}

export function parseWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerRuntimeConfig {
  const storageTelemetryPath = parseStorageTelemetryPath(
    env.STORAGE_TELEMETRY_PATH,
    "STORAGE_TELEMETRY_PATH"
  );
  const controlApiBaseUrl = env.CONTROL_API_BASE_URL?.trim() || "http://localhost:3000";
  const workerId = env.WORKER_ID?.trim() || "render-worker-default";

  let pollIntervalMs = 1000;
  if (env.JOB_POLL_INTERVAL_MS !== undefined && env.JOB_POLL_INTERVAL_MS.trim() !== "") {
    const parsed = Number.parseInt(env.JOB_POLL_INTERVAL_MS.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      pollIntervalMs = parsed;
    }
  }

  let heartbeatIntervalMs = 30_000;
  const rawHeartbeat = env.JOB_HEARTBEAT_INTERVAL_MS ?? env.HEARTBEAT_INTERVAL_MS;
  if (rawHeartbeat !== undefined && rawHeartbeat.trim() !== "") {
    const parsed = Number.parseInt(rawHeartbeat.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      heartbeatIntervalMs = parsed;
    }
  }

  let leaseDurationMs = 300_000;
  const rawLease = env.JOB_LEASE_DURATION_MS ?? env.LEASE_DURATION_MS;
  if (rawLease !== undefined && rawLease.trim() !== "") {
    const parsed = Number.parseInt(rawLease.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      leaseDurationMs = parsed;
    }
  }

  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new WorkerConfigError(
      "Invalid job dispatch configuration: heartbeat interval must be less than lease duration"
    );
  }

  let telemetryBackoffMs: number | undefined;
  const rawTelemetryBackoff = env.JOB_TELEMETRY_BACKOFF_MS ?? env.TELEMETRY_BACKOFF_MS;
  if (rawTelemetryBackoff !== undefined && rawTelemetryBackoff.trim() !== "") {
    const parsed = Number.parseInt(rawTelemetryBackoff.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      telemetryBackoffMs = parsed;
    }
  }

  let admissionBackoffMs: number | undefined;
  const rawAdmissionBackoff = env.JOB_ADMISSION_BACKOFF_MS ?? env.ADMISSION_BACKOFF_MS;
  if (rawAdmissionBackoff !== undefined && rawAdmissionBackoff.trim() !== "") {
    const parsed = Number.parseInt(rawAdmissionBackoff.trim(), 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      admissionBackoffMs = parsed;
    }
  }

  const s3Endpoint = env.S3_STORAGE_ENDPOINT?.trim() || env.S3_ENDPOINT?.trim();
  let s3Config: S3ObjectStorageOptions | undefined;
  if (s3Endpoint) {
    const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim() ?? env.S3_ACCESS_KEY_ID?.trim() ?? "";
    const secretAccessKey =
      env.AWS_SECRET_ACCESS_KEY?.trim() ?? env.S3_SECRET_ACCESS_KEY?.trim() ?? "";
    s3Config = {
      endpoint: s3Endpoint,
      region: env.AWS_REGION?.trim() || env.S3_REGION?.trim() || "us-east-1",
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
      ...(accessKeyId && secretAccessKey
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey
            }
          }
        : {})
    };
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
    s3Config
  };
}

export function createProductionWorker(
  config?: WorkerRuntimeConfig | undefined,
  overrides?: Partial<WorkerDependencies> | undefined
): RenderWorker {
  const effectiveConfig = config ?? parseWorkerRuntimeConfig();

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

  const objectStorage =
    overrides?.objectStorage ??
    new S3ObjectStorage(
      effectiveConfig.s3Config ?? {
        endpoint: "http://localhost:9000",
        credentials: {
          accessKeyId: "minioadmin",
          secretAccessKey: "minioadmin"
        }
      }
    );

  const renderJobExecutor = overrides?.renderJobExecutor ?? createRenderJobExecutor();

  const logger = overrides?.logger ?? console;
  const sleep =
    overrides?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

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
  depsOverrides?: Partial<WorkerDependencies> | undefined
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
