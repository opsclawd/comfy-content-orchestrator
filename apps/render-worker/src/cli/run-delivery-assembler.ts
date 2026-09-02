import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
const { Pool } = pg;
import {
  AssembleDeliveryReel,
  EnforceLicenseRouting,
  type GenerationManifestRepository,
  type MediaAssemblerPort,
  type ObjectStoragePort
} from "@cco/application";
import type { ComponentRef } from "@cco/contracts";
import {
  FfmpegMediaAssemblerAdapter,
  JsonFileLicenseRegistryPort,
  PostgresGenerationManifestRepository,
  S3ObjectStorage,
  type S3ObjectStorageOptions
} from "@cco/infrastructure";
import {
  createDeliveryAssemblyControlApiClient,
  type DeliveryAssemblyControlApiClient
} from "../control-api-client.js";
import { DeliveryAssemblyWorker } from "../delivery-assembly-worker.js";
import type { WorkerLogger } from "../worker.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
const DEFAULT_LICENSE_REGISTRY_PATH = resolve(
  DEFAULT_REPO_ROOT,
  "config/component-license-registry.json"
);

export interface DeliveryAssemblerRuntimeConfig {
  readonly controlApiBaseUrl: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly databaseUrl: string;
  readonly licenseRegistryPath: string;
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly assemblyWorkspaceRoot: string;
  readonly s3DeliveryBucket: string;
  readonly s3Endpoint: string;
  readonly s3Region: string;
  readonly s3ForcePathStyle: boolean;
  readonly s3AccessKeyId: string;
  readonly s3SecretAccessKey: string;
  readonly s3Config: S3ObjectStorageOptions;
}

export class DeliveryAssemblerConfigError extends Error {
  override readonly name = "DeliveryAssemblerConfigError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export function parseDeliveryAssemblerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2)
): DeliveryAssemblerRuntimeConfig {
  const getArg = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg?.startsWith(prefix)) {
        return arg.slice(prefix.length);
      }
      if (arg === `--${name}` && i + 1 < argv.length) {
        return argv[i + 1];
      }
    }
    return undefined;
  };

  const controlApiBaseUrl = (
    getArg("control-api-url") ??
    env.CONTROL_API_BASE_URL ??
    "http://localhost:3000"
  ).trim();

  const workerId = (
    getArg("worker-id") ??
    env.WORKER_ID ??
    `delivery-assembler-${process.pid}`
  ).trim();

  const parsePositiveInt = (
    val: string | undefined,
    fallback: number,
    fieldName: string
  ): number => {
    if (!val) {
      return fallback;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
      throw new DeliveryAssemblerConfigError(`${fieldName} must be a positive integer`);
    }
    return num;
  };

  const pollIntervalMs = parsePositiveInt(
    getArg("poll-interval-ms") ?? env.POLL_INTERVAL_MS,
    5000,
    "pollIntervalMs"
  );
  const heartbeatIntervalMs = parsePositiveInt(
    getArg("heartbeat-interval-ms") ?? env.HEARTBEAT_INTERVAL_MS,
    30_000,
    "heartbeatIntervalMs"
  );
  const leaseDurationMs = parsePositiveInt(
    getArg("lease-duration-ms") ?? env.LEASE_DURATION_MS,
    300_000,
    "leaseDurationMs"
  );

  if (heartbeatIntervalMs >= leaseDurationMs) {
    throw new DeliveryAssemblerConfigError("heartbeatIntervalMs must be less than leaseDurationMs");
  }

  const databaseUrl = (
    getArg("database-url") ??
    env.DATABASE_URL ??
    env.POSTGRES_URL ??
    "postgres://postgres:postgres@localhost:5432/cco"
  ).trim();

  const licenseRegistryPath = resolve(
    getArg("license-registry-path") ?? env.LICENSE_REGISTRY_PATH ?? DEFAULT_LICENSE_REGISTRY_PATH
  );

  const ffmpegPath = (getArg("ffmpeg-path") ?? env.FFMPEG_PATH ?? "ffmpeg").trim();
  if (ffmpegPath.length === 0) {
    throw new DeliveryAssemblerConfigError("ffmpegPath must not be empty");
  }

  const ffprobePath = (getArg("ffprobe-path") ?? env.FFPROBE_PATH ?? "ffprobe").trim();
  if (ffprobePath.length === 0) {
    throw new DeliveryAssemblerConfigError("ffprobePath must not be empty");
  }

  const assemblyWorkspaceRoot = resolve(
    (
      getArg("assembly-workspace-root") ??
      env.ASSEMBLY_WORKSPACE_ROOT ??
      env.WORKSPACE_ROOT ??
      "/tmp/cco-assembly"
    ).trim()
  );

  const s3DeliveryBucket = (
    getArg("s3-delivery-bucket") ??
    env.S3_DELIVERY_BUCKET ??
    "godzspeed-delivery"
  ).trim();

  const s3Endpoint = (
    getArg("s3-endpoint") ??
    env.AWS_ENDPOINT_URL_S3 ??
    env.S3_STORAGE_ENDPOINT ??
    env.S3_ENDPOINT ??
    "http://localhost:9000"
  ).trim();

  const s3Region = (getArg("s3-region") ?? env.AWS_REGION ?? "us-east-1").trim();
  const s3ForcePathStyle =
    (getArg("s3-force-path-style") ?? env.S3_FORCE_PATH_STYLE ?? "true").toLowerCase() !== "false";
  const s3AccessKeyId = (
    getArg("s3-access-key-id") ??
    env.AWS_ACCESS_KEY_ID ??
    "minioadmin"
  ).trim();
  const s3SecretAccessKey = (
    getArg("s3-secret-access-key") ??
    env.AWS_SECRET_ACCESS_KEY ??
    "minioadmin"
  ).trim();

  const s3Config: S3ObjectStorageOptions = {
    endpoint: s3Endpoint,
    region: s3Region,
    forcePathStyle: s3ForcePathStyle,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey
    }
  };

  return {
    controlApiBaseUrl,
    workerId,
    pollIntervalMs,
    heartbeatIntervalMs,
    leaseDurationMs,
    databaseUrl,
    licenseRegistryPath,
    ffmpegPath,
    ffprobePath,
    assemblyWorkspaceRoot,
    s3DeliveryBucket,
    s3Endpoint,
    s3Region,
    s3ForcePathStyle,
    s3AccessKeyId,
    s3SecretAccessKey,
    s3Config
  };
}

export interface DeliveryReelAssemblerOverrides {
  readonly pool?: pg.Pool | undefined;
  readonly generationManifestRepository?: GenerationManifestRepository | undefined;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly mediaAssembler?: MediaAssemblerPort | undefined;
  readonly runtimeComponents?: readonly ComponentRef[] | undefined;
  readonly enforceLicenseRouting?: EnforceLicenseRouting | undefined;
  readonly assembleDeliveryReelUseCase?: AssembleDeliveryReel | undefined;
  readonly controlApiClient?: DeliveryAssemblyControlApiClient | undefined;
  readonly logger?: WorkerLogger | undefined;
  readonly sleep?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
}

export interface CreatedDeliveryReelAssembler {
  readonly worker: DeliveryAssemblyWorker;
  readonly pool: pg.Pool;
  readonly assembleDeliveryReelUseCase: AssembleDeliveryReel;
  readonly runtimeComponents: readonly ComponentRef[];
  readonly cleanup: () => Promise<void>;
}

export async function createDeliveryReelAssembler(
  config: DeliveryAssemblerRuntimeConfig,
  overrides?: DeliveryReelAssemblerOverrides
): Promise<CreatedDeliveryReelAssembler> {
  const pool = overrides?.pool ?? new Pool({ connectionString: config.databaseUrl });
  const ownsPool = !overrides?.pool;

  const generationManifestRepository =
    overrides?.generationManifestRepository ?? new PostgresGenerationManifestRepository(pool);

  const objectStorage = overrides?.objectStorage ?? new S3ObjectStorage(config.s3Config);

  const licenseRegistry = JsonFileLicenseRegistryPort.fromFile(config.licenseRegistryPath);
  const enforceLicenseRouting =
    overrides?.enforceLicenseRouting ?? new EnforceLicenseRouting({ registry: licenseRegistry });

  const mediaAssembler =
    overrides?.mediaAssembler ??
    new FfmpegMediaAssemblerAdapter({
      ffmpegPath: config.ffmpegPath,
      ffprobePath: config.ffprobePath,
      workspaceRoot: config.assemblyWorkspaceRoot,
      outputBucket: config.s3DeliveryBucket,
      objectStorage
    });

  // Eagerly probe runtime components ONCE at startup per AssembleDeliveryReelDependencies contract
  const runtimeComponents =
    overrides?.runtimeComponents ??
    (mediaAssembler.getRuntimeComponents ? await mediaAssembler.getRuntimeComponents() : []);

  const assembleDeliveryReelUseCase =
    overrides?.assembleDeliveryReelUseCase ??
    new AssembleDeliveryReel({
      mediaAssembler,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository,
      runtimeComponents
    });

  const controlApiClient =
    overrides?.controlApiClient ??
    createDeliveryAssemblyControlApiClient({
      baseUrl: config.controlApiBaseUrl
    });

  const logger: WorkerLogger = overrides?.logger ?? console;

  const sleep =
    overrides?.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Aborted"));
          return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Aborted"));
          },
          { once: true }
        );
      }));

  const worker = new DeliveryAssemblyWorker(
    {
      controlApiClient,
      assembleDeliveryReel: async (job) => {
        return assembleDeliveryReelUseCase.assemble({ spec: job.assemblySpec });
      },
      logger,
      sleep
    },
    {
      workerId: config.workerId,
      pollIntervalMs: config.pollIntervalMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      leaseDurationMs: config.leaseDurationMs
    }
  );

  const cleanup = async () => {
    if (ownsPool) {
      await pool.end().catch(() => {});
    }
  };

  return {
    worker,
    pool,
    assembleDeliveryReelUseCase,
    runtimeComponents,
    cleanup
  };
}

export async function runDeliveryAssemblerCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const config = parseDeliveryAssemblerRuntimeConfig(env, argv);
  const assembler = await createDeliveryReelAssembler(config);

  const shutdown = async () => {
    console.info("Shutting down delivery assembly worker...");
    await assembler.worker.stop();
    await assembler.cleanup();
    console.info("Shutdown complete.");
  };

  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });

  try {
    await assembler.worker.start();
  } finally {
    await assembler.cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDeliveryAssemblerCli().catch((err) => {
    console.error("Delivery assembly worker crashed:", err);
    process.exit(1);
  });
}
