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
import { RenderWorker, type WorkerDependencies, type RenderWorkerOptions } from "../worker.js";

export interface WorkerRuntimeConfig {
  readonly storageTelemetryPath: string;
  readonly controlApiBaseUrl: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
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

  const dependencies: WorkerDependencies = {
    controlApiClient,
    objectStorage,
    enforceStorageAdmission,
    ...(overrides?.renderJobExecutor ? { renderJobExecutor: overrides.renderJobExecutor } : {})
  };

  const options: RenderWorkerOptions = {
    workerId: effectiveConfig.workerId,
    pollIntervalMs: effectiveConfig.pollIntervalMs
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
    const onSignal = () => {
      worker.stop();
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
