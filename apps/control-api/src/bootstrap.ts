import process from "node:process";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import {
  PostgresSceneReviewQueries,
  PostgresUnitOfWork,
  S3ReviewMediaDelivery
} from "@cco/infrastructure";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { TailscaleReviewerIdentityResolver } from "./http/reviewer-identity.js";
import { startControlApiServer, type ServerListenOptions } from "./http/server.js";
import type { ControlApiDependencies, ReviewerIdentityResolver } from "./http/types.js";
import {
  parseControlApiRuntimeConfig,
  type ControlApiDatabaseConfig,
  type ControlApiRuntimeConfig,
  type ControlApiS3Config
} from "./runtime-config.js";

export interface ControlApiLogger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
}

export interface ControlApiProcessSignals {
  on(signal: string, handler: () => void): void;
  removeListener(signal: string, handler: () => void): void;
  exit?(code: number): void;
}

export interface ControlApiBootstrapOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: ControlApiRuntimeConfig;
  readonly pool?: Pool;
  readonly poolFactory?: (config: ControlApiDatabaseConfig) => Pool;
  readonly s3Client?: S3Client;
  readonly s3ClientFactory?: (config: ControlApiS3Config) => S3Client;
  readonly serverStarter?: (
    dependencies: ControlApiDependencies,
    options: ServerListenOptions
  ) => Promise<{ app: FastifyInstance; close: () => Promise<void>; port: number; host: string }>;
  readonly reviewerIdentityResolver?: ReviewerIdentityResolver;
  readonly logger?: ControlApiLogger;
  readonly processSignals?: ControlApiProcessSignals;
}

export type ControlApiRuntimeState = "starting" | "running" | "stopping" | "stopped";

export interface ControlApiRuntimeHandle {
  readonly config: ControlApiRuntimeConfig;
  readonly pool: Pool;
  readonly server: { app: FastifyInstance; close: () => Promise<void>; port: number; host: string };
  readonly stop: () => Promise<void>;
  readonly state: () => ControlApiRuntimeState;
}

export async function runControlApi(
  options: ControlApiBootstrapOptions = {}
): Promise<ControlApiRuntimeHandle> {
  const logger: ControlApiLogger = options.logger ?? console;
  const signals: ControlApiProcessSignals = options.processSignals ?? process;

  // 1. Parse and validate runtime configuration
  const config = options.config ?? parseControlApiRuntimeConfig(options.env ?? process.env);

  let currentState: ControlApiRuntimeState = "starting";
  const getState = (): ControlApiRuntimeState => currentState;
  let pool: Pool | undefined;
  let s3ReadinessClient: S3Client | undefined;
  let serverHandle:
    { app: FastifyInstance; close: () => Promise<void>; port: number; host: string } | undefined;

  let sigtermHandler: (() => void) | undefined;
  let sigintHandler: (() => void) | undefined;
  let signalHandlersInstalled = false;
  let shutdownPromise: Promise<void> | undefined;

  const stop = async (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    if (currentState === "stopped") {
      return;
    }
    currentState = "stopping";

    shutdownPromise = (async () => {
      // 1. Close HTTP server before PostgreSQL pool
      try {
        if (serverHandle) {
          const handle = serverHandle;
          serverHandle = undefined;
          logger.info("Closing Control API HTTP server...");
          await handle.close();
        }
      } catch (err) {
        logger.error(
          "Error closing HTTP server:",
          err instanceof Error ? err.message : String(err)
        );
      }

      // 2. Close PostgreSQL connection pool
      try {
        if (pool) {
          const p = pool;
          pool = undefined;
          logger.info("Closing PostgreSQL connection pool...");
          await p.end();
        }
      } catch (err) {
        logger.error(
          "Error closing PostgreSQL pool:",
          err instanceof Error ? err.message : String(err)
        );
      }

      // 3. Clean up S3 client
      try {
        if (s3ReadinessClient) {
          const s3 = s3ReadinessClient;
          s3ReadinessClient = undefined;
          if (typeof s3.destroy === "function") {
            s3.destroy();
          }
        }
      } catch {
        // ignore cleanup error
      }

      currentState = "stopped";

      // 4. Remove signal listeners upon completed shutdown
      if (signalHandlersInstalled && sigtermHandler && sigintHandler) {
        signals.removeListener("SIGTERM", sigtermHandler);
        signals.removeListener("SIGINT", sigintHandler);
        signalHandlersInstalled = false;
      }
    })();

    return shutdownPromise;
  };

  try {
    // 2. Create PostgreSQL pool and probe connectivity
    logger.info("Initializing PostgreSQL pool and probing connection...");
    pool =
      options.pool ??
      (options.poolFactory
        ? options.poolFactory(config.database)
        : new Pool({
            connectionString: config.database.url
          }));

    await pool.query("SELECT 1");

    // 3. Create S3 readiness client and probe storage readiness
    logger.info(`Probing S3 readiness on bucket '${config.s3.readinessBucket}'...`);
    s3ReadinessClient =
      options.s3Client ??
      (options.s3ClientFactory
        ? options.s3ClientFactory(config.s3)
        : new S3Client({
            endpoint: config.s3.storageEndpoint,
            region: config.s3.region,
            credentials: config.s3.credentials,
            forcePathStyle: config.s3.forcePathStyle
          }));

    await s3ReadinessClient.send(
      new HeadBucketCommand({
        Bucket: config.s3.readinessBucket
      })
    );

    // 4. Instantiate application adapters and use cases
    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const reviewMediaDelivery = new S3ReviewMediaDelivery({
      signingEndpoint: config.s3.signingEndpoint,
      storageEndpoint: config.s3.storageEndpoint,
      region: config.s3.region,
      credentials: config.s3.credentials,
      forcePathStyle: config.s3.forcePathStyle,
      defaultExpirySeconds: config.s3.defaultExpirySeconds
    });

    const reviewerIdentityResolver =
      options.reviewerIdentityResolver ??
      new TailscaleReviewerIdentityResolver(config.reviewerIdentity);

    // 5. Install signal handlers
    sigtermHandler = () => {
      logger.info("Received SIGTERM, initiating graceful shutdown...");
      void stop();
    };
    sigintHandler = () => {
      logger.info("Received SIGINT, initiating graceful shutdown...");
      void stop();
    };

    signals.on("SIGTERM", sigtermHandler);
    signals.on("SIGINT", sigintHandler);
    signalHandlersInstalled = true;

    // 6. Start Control API HTTP server
    logger.info(`Starting Control API server on ${config.http.host}:${config.http.port}...`);
    const serverStarter = options.serverStarter ?? startControlApiServer;
    serverHandle = await serverStarter(
      {
        uow,
        sceneReviewQueries,
        reviewMediaDelivery
      },
      {
        host: config.http.host,
        port: config.http.port,
        reviewerIdentityResolver
      }
    );

    if (getState() === "stopping" || getState() === "stopped") {
      try {
        const handle = serverHandle;
        serverHandle = undefined;
        await handle.close();
      } catch (closeErr) {
        logger.error(
          "Error closing HTTP server during aborted startup:",
          closeErr instanceof Error ? closeErr.message : String(closeErr)
        );
      }
      if (shutdownPromise) {
        await shutdownPromise;
      }
      throw new Error("Control API startup aborted due to shutdown signal");
    }

    currentState = "running";
    logger.info(`Control API server listening on ${serverHandle.host}:${serverHandle.port}`);

    return {
      config,
      pool,
      server: serverHandle,
      stop,
      state: getState
    };
  } catch (error) {
    const safeMessage = error instanceof Error ? error.message : String(error);
    logger.error("Control API startup failed:", safeMessage);

    if (serverHandle) {
      try {
        const handle = serverHandle;
        serverHandle = undefined;
        await handle.close();
      } catch {
        // ignore
      }
    }
    if (pool) {
      try {
        const p = pool;
        pool = undefined;
        await p.end();
      } catch {
        // ignore
      }
    }
    if (s3ReadinessClient) {
      try {
        const s3 = s3ReadinessClient;
        s3ReadinessClient = undefined;
        if (typeof s3.destroy === "function") {
          s3.destroy();
        }
      } catch {
        // ignore
      }
    }
    if (signalHandlersInstalled && sigtermHandler && sigintHandler) {
      signals.removeListener("SIGTERM", sigtermHandler);
      signals.removeListener("SIGINT", sigintHandler);
      signalHandlersInstalled = false;
    }

    currentState = "stopped";

    if (
      typeof process !== "undefined" &&
      (process.exitCode === undefined || process.exitCode === 0)
    ) {
      process.exitCode = 1;
    }

    throw error;
  }
}

export async function main(): Promise<void> {
  try {
    await runControlApi();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fatal Control API startup failure:", message);
    process.exitCode = 1;
  }
}

if (
  typeof process !== "undefined" &&
  process.argv &&
  process.argv[1] &&
  (process.argv[1].endsWith("bootstrap.js") || process.argv[1].endsWith("bootstrap.ts"))
) {
  void main();
}
