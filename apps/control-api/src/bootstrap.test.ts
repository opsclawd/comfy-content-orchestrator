import { describe, expect, it, vi } from "vitest";
import { main, runControlApi } from "./bootstrap.js";
import type { ControlApiRuntimeConfig } from "./runtime-config.js";
import { HeadBucketCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";

describe("bootstrap", () => {
  const validConfig: ControlApiRuntimeConfig = {
    database: {
      url: "postgres://app_user:s3cr3t_db_pass@db.internal:5432/comfy_orchestrator"
    },
    s3: {
      storageEndpoint: "http://minio.internal:9000",
      signingEndpoint: "https://storage.godzspeed-internal.ts.net",
      credentials: {
        accessKeyId: "app-s3-key",
        secretAccessKey: "s3cr3t_s3_key"
      },
      region: "us-east-1",
      forcePathStyle: true,
      readinessBucket: "godzspeed-review",
      defaultExpirySeconds: 300
    },
    http: {
      host: "100.64.0.1",
      port: 3000
    },
    reviewerIdentity: {
      trustedProxyAddresses: []
    }
  };

  function createTestHarness() {
    const events: string[] = [];

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        events.push(`pool.query:${sql}`);
        return { rows: [{ "?column?": 1 }] };
      }),
      end: vi.fn().mockImplementation(async () => {
        events.push("pool.end");
      })
    };

    const mockS3Client = {
      send: vi.fn().mockImplementation(async (command: unknown) => {
        if (command instanceof HeadBucketCommand) {
          events.push(`s3.headBucket:${command.input.Bucket}`);
        } else {
          events.push("s3.send");
        }
        return {};
      }),
      destroy: vi.fn().mockImplementation(() => {
        events.push("s3.destroy");
      })
    };

    const mockServerHandle = {
      app: {} as FastifyInstance,
      close: vi.fn().mockImplementation(async () => {
        events.push("server.close");
      }),
      port: 3000,
      host: "100.64.0.1"
    };

    const mockServerStarter = vi.fn().mockImplementation(async (_deps: unknown, _opts: unknown) => {
      events.push("server.start");
      return mockServerHandle;
    });

    const signalListeners = new Map<string, Array<() => void>>();
    const mockSignals = {
      on: vi.fn().mockImplementation((signal: string, handler: () => void) => {
        const list = signalListeners.get(signal) ?? [];
        list.push(handler);
        signalListeners.set(signal, list);
      }),
      removeListener: vi.fn().mockImplementation((signal: string, handler: () => void) => {
        const list = signalListeners.get(signal) ?? [];
        const index = list.indexOf(handler);
        if (index !== -1) {
          list.splice(index, 1);
        }
        signalListeners.set(signal, list);
      }),
      emitSignal: (signal: string) => {
        const list = signalListeners.get(signal) ?? [];
        for (const handler of list) {
          handler();
        }
      },
      listenerCount: (signal: string) => (signalListeners.get(signal) ?? []).length,
      exit: vi.fn()
    };

    const mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    };

    return {
      events,
      mockPool,
      mockS3Client,
      mockServerHandle,
      mockServerStarter,
      mockSignals,
      mockLogger
    };
  }

  it("probes PostgreSQL and MinIO before listening", async () => {
    const harness = createTestHarness();

    const runtime = await runControlApi({
      config: validConfig,
      poolFactory: () => harness.mockPool as unknown as Pool,
      s3ClientFactory: () => harness.mockS3Client as unknown as S3Client,
      serverStarter: harness.mockServerStarter,
      processSignals: harness.mockSignals,
      logger: harness.mockLogger
    });

    expect(runtime.state()).toBe("running");
    expect(harness.events).toEqual([
      "pool.query:SELECT 1",
      "s3.headBucket:godzspeed-review",
      "server.start"
    ]);

    expect(harness.mockServerStarter).toHaveBeenCalledWith(
      expect.objectContaining({
        uow: expect.any(Object),
        sceneReviewQueries: expect.any(Object),
        reviewMediaDelivery: expect.any(Object)
      }),
      expect.objectContaining({
        host: "100.64.0.1",
        port: 3000,
        reviewerIdentityResolver: expect.any(Object)
      })
    );
  });

  it("probes PostgreSQL and fails startup if SELECT 1 fails", async () => {
    const harness = createTestHarness();
    harness.mockPool.query.mockRejectedValueOnce(new Error("Connection refused to PostgreSQL"));

    await expect(
      runControlApi({
        config: validConfig,
        poolFactory: () => harness.mockPool as unknown as Pool,
        s3ClientFactory: () => harness.mockS3Client as unknown as S3Client,
        serverStarter: harness.mockServerStarter,
        processSignals: harness.mockSignals,
        logger: harness.mockLogger
      })
    ).rejects.toThrow("Connection refused to PostgreSQL");

    // Server should not start, S3 should not be probed, pool should be closed
    expect(harness.mockServerStarter).not.toHaveBeenCalled();
    expect(harness.mockS3Client.send).not.toHaveBeenCalled();
    expect(harness.mockPool.end).toHaveBeenCalled();
  });

  it("probes MinIO and fails startup if S3 readiness probe fails", async () => {
    const harness = createTestHarness();
    harness.mockS3Client.send.mockRejectedValueOnce(
      new Error("S3 bucket not found or unreachable")
    );

    await expect(
      runControlApi({
        config: validConfig,
        poolFactory: () => harness.mockPool as unknown as Pool,
        s3ClientFactory: () => harness.mockS3Client as unknown as S3Client,
        serverStarter: harness.mockServerStarter,
        processSignals: harness.mockSignals,
        logger: harness.mockLogger
      })
    ).rejects.toThrow("S3 bucket not found or unreachable");

    // Server should not start, pool should be closed
    expect(harness.mockServerStarter).not.toHaveBeenCalled();
    expect(harness.mockPool.end).toHaveBeenCalled();
  });

  it("closes HTTP before the PostgreSQL pool exactly once on SIGTERM and SIGINT", async () => {
    const harness = createTestHarness();

    const runtime = await runControlApi({
      config: validConfig,
      poolFactory: () => harness.mockPool as unknown as Pool,
      s3ClientFactory: () => harness.mockS3Client as unknown as S3Client,
      serverStarter: harness.mockServerStarter,
      processSignals: harness.mockSignals,
      logger: harness.mockLogger
    });

    expect(harness.mockSignals.listenerCount("SIGTERM")).toBe(1);
    expect(harness.mockSignals.listenerCount("SIGINT")).toBe(1);
    expect(runtime.state()).toBe("running");

    // Trigger SIGTERM
    harness.mockSignals.emitSignal("SIGTERM");

    // Immediately trigger a subsequent SIGINT during shutdown to verify idempotency and reuse of shutdown promise
    harness.mockSignals.emitSignal("SIGINT");
    harness.mockSignals.emitSignal("SIGTERM");

    // Await the shutdown
    await runtime.stop();

    expect(runtime.state()).toBe("stopped");

    // Verify ordering: server.close must happen BEFORE pool.end
    const serverCloseIndex = harness.events.indexOf("server.close");
    const poolEndIndex = harness.events.indexOf("pool.end");

    expect(serverCloseIndex).toBeGreaterThan(-1);
    expect(poolEndIndex).toBeGreaterThan(-1);
    expect(serverCloseIndex).toBeLessThan(poolEndIndex);

    // Verify closing occurred exactly once
    expect(harness.mockServerHandle.close).toHaveBeenCalledTimes(1);
    expect(harness.mockPool.end).toHaveBeenCalledTimes(1);

    // Handlers must be cleaned up when shutdown completes
    expect(harness.mockSignals.listenerCount("SIGTERM")).toBe(0);
    expect(harness.mockSignals.listenerCount("SIGINT")).toBe(0);
  });

  it("cleans up partial startup and sets exitCode to 1 without abruptly killing process", async () => {
    const harness = createTestHarness();
    const secretValues = ["s3cr3t_db_pass", "s3cr3t_s3_key"];
    const originalExitCode = process.exitCode;

    try {
      process.exitCode = 0;
      // Make server listen fail
      harness.mockServerStarter.mockRejectedValueOnce(
        new Error("EADDRINUSE: address already in use 100.64.0.1:3000")
      );

      let thrownError: unknown;
      try {
        await runControlApi({
          config: validConfig,
          poolFactory: () => harness.mockPool as unknown as Pool,
          s3ClientFactory: () => harness.mockS3Client as unknown as S3Client,
          serverStarter: harness.mockServerStarter,
          processSignals: harness.mockSignals,
          logger: harness.mockLogger
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toContain("EADDRINUSE");

      // Verify every created resource was closed
      expect(harness.mockPool.end).toHaveBeenCalledTimes(1);

      // Verify process.exitCode is set to 1 and signals.exit was NOT called
      expect(process.exitCode).toBe(1);
      expect(harness.mockSignals.exit).not.toHaveBeenCalled();

      // Verify signal listeners were cleaned up
      expect(harness.mockSignals.listenerCount("SIGTERM")).toBe(0);
      expect(harness.mockSignals.listenerCount("SIGINT")).toBe(0);

      // Verify error logging never outputs secret credentials
      for (const call of harness.mockLogger.error.mock.calls) {
        const logString = call.map(String).join(" ");
        for (const secret of secretValues) {
          expect(logString).not.toContain(secret);
        }
      }
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("aborts startup and closes HTTP server if termination signal is received while serverStarter is executing", async () => {
    const harness = createTestHarness();
    const originalExitCode = process.exitCode;

    try {
      process.exitCode = 0;
      harness.mockServerStarter.mockImplementationOnce(async () => {
        harness.events.push("server.start");
        // Simulate SIGTERM arriving during serverStarter execution
        harness.mockSignals.emitSignal("SIGTERM");
        return harness.mockServerHandle;
      });

      let thrownError: unknown;
      try {
        await runControlApi({
          config: validConfig,
          poolFactory: () => harness.mockPool as unknown as Pool,
          s3ClientFactory: () => harness.mockS3Client as unknown as S3Client,
          serverStarter: harness.mockServerStarter,
          processSignals: harness.mockSignals,
          logger: harness.mockLogger
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      expect(thrownError).toBeInstanceOf(Error);
      expect((thrownError as Error).message).toContain(
        "Control API startup aborted due to shutdown signal"
      );

      // HTTP server must be closed (no ghost server)
      expect(harness.mockServerHandle.close).toHaveBeenCalledTimes(1);

      // Pool must be closed
      expect(harness.mockPool.end).toHaveBeenCalledTimes(1);

      // Process signals must be unhooked
      expect(harness.mockSignals.listenerCount("SIGTERM")).toBe(0);
      expect(harness.mockSignals.listenerCount("SIGINT")).toBe(0);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("main() logs error and sets process.exitCode = 1 on failure without throwing unhandled rejection", async () => {
    const originalEnv = { ...process.env };
    const originalExitCode = process.exitCode;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // Clear env to guarantee runControlApi() fails during validation
      process.env = {};
      process.exitCode = 0;

      await expect(main()).resolves.toBeUndefined();
      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Fatal Control API startup failure:",
        expect.any(String)
      );
    } finally {
      process.env = originalEnv;
      process.exitCode = originalExitCode;
      consoleErrorSpy.mockRestore();
    }
  });
});
