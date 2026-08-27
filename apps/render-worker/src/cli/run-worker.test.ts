import { describe, expect, it, vi } from "vitest";
import {
  type StorageAdmissionPolicy,
  createStorageAdmissionPolicy,
  type RenderJob
} from "@cco/domain";
import type {
  JobMutationResult,
  PutObjectInput,
  ObjectLocator,
  StoredObject,
  ObjectStoragePort
} from "@cco/application";
import type { ControlApiClient } from "../control-api-client.js";
import { RenderWorker, type StorageAdmissionEnforcer } from "../worker.js";
import {
  WorkerConfigError,
  createProductionWorker,
  isDirectExecution,
  parseStorageTelemetryPath,
  parseWorkerRuntimeConfig,
  runWorkerCli
} from "./run-worker.js";

class TestControlApiClient implements ControlApiClient {
  async claim(): Promise<RenderJob | undefined> {
    return undefined;
  }
  async start(): Promise<JobMutationResult> {
    return { outcome: "applied", job: {} as RenderJob };
  }
  async heartbeat(): Promise<JobMutationResult> {
    return { outcome: "applied", job: {} as RenderJob };
  }
  async complete(): Promise<JobMutationResult> {
    return { outcome: "applied", job: {} as RenderJob };
  }
  async fail(): Promise<JobMutationResult> {
    return { outcome: "applied", job: {} as RenderJob };
  }
  async defer(): Promise<JobMutationResult> {
    return { outcome: "deferred", job: {} as RenderJob };
  }
}

class TestObjectStorage implements ObjectStoragePort {
  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    return { bucket: input.bucket, key: input.key };
  }
  async getObject(): Promise<StoredObject | undefined> {
    return undefined;
  }
}

class TestAdmissionEnforcer implements StorageAdmissionEnforcer {
  async execute(): Promise<StorageAdmissionPolicy> {
    return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
  }
}

describe("run-worker CLI", () => {
  describe("parseStorageTelemetryPath", () => {
    it("returns trimmed absolute path when valid", () => {
      expect(parseStorageTelemetryPath("/var/log/telemetry")).toBe("/var/log/telemetry");
      expect(parseStorageTelemetryPath("  /opt/storage/path  ")).toBe("/opt/storage/path");
    });

    it("throws WorkerConfigError when missing, empty, or non-string", () => {
      expect(() => parseStorageTelemetryPath(undefined)).toThrow(WorkerConfigError);
      expect(() => parseStorageTelemetryPath(undefined)).toThrow(
        "Missing or empty required environment variable: STORAGE_TELEMETRY_PATH"
      );
      expect(() => parseStorageTelemetryPath("")).toThrow(WorkerConfigError);
      expect(() => parseStorageTelemetryPath("   ")).toThrow(WorkerConfigError);
      expect(() => parseStorageTelemetryPath(123 as unknown as string)).toThrow(WorkerConfigError);
    });

    it("throws WorkerConfigError when path is relative", () => {
      expect(() => parseStorageTelemetryPath("relative/path")).toThrow(WorkerConfigError);
      expect(() => parseStorageTelemetryPath("relative/path")).toThrow(
        "Invalid storage telemetry path in variable: STORAGE_TELEMETRY_PATH (must be an absolute path)"
      );
      expect(() => parseStorageTelemetryPath("./storage")).toThrow(
        "Invalid storage telemetry path in variable: STORAGE_TELEMETRY_PATH (must be an absolute path)"
      );
    });

    it("includes custom varName in error messages", () => {
      expect(() => parseStorageTelemetryPath("", "CUSTOM_VAR")).toThrow(
        "Missing or empty required environment variable: CUSTOM_VAR"
      );
      expect(() => parseStorageTelemetryPath("relative", "CUSTOM_VAR")).toThrow(
        "Invalid storage telemetry path in variable: CUSTOM_VAR (must be an absolute path)"
      );
    });
  });

  describe("parseWorkerRuntimeConfig", () => {
    it("parses valid complete configuration with S3 AWS credentials", () => {
      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/mnt/storage-telemetry",
        CONTROL_API_BASE_URL: "http://control-api.internal:8000",
        WORKER_ID: "worker-node-1",
        JOB_POLL_INTERVAL_MS: "5000",
        S3_STORAGE_ENDPOINT: "http://minio.internal:9000",
        AWS_ACCESS_KEY_ID: "aws-key",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AWS_REGION: "us-west-2",
        S3_FORCE_PATH_STYLE: "true"
      };

      const config = parseWorkerRuntimeConfig(env);
      expect(config).toEqual({
        storageTelemetryPath: "/mnt/storage-telemetry",
        controlApiBaseUrl: "http://control-api.internal:8000",
        workerId: "worker-node-1",
        pollIntervalMs: 5000,
        s3Config: {
          endpoint: "http://minio.internal:9000",
          region: "us-west-2",
          forcePathStyle: true,
          credentials: {
            accessKeyId: "aws-key",
            secretAccessKey: "aws-secret"
          }
        }
      });
    });

    it("uses default values when optional environment variables are omitted", () => {
      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage"
      };

      const config = parseWorkerRuntimeConfig(env);
      expect(config).toEqual({
        storageTelemetryPath: "/var/run/storage",
        controlApiBaseUrl: "http://localhost:3000",
        workerId: "render-worker-default",
        pollIntervalMs: 1000,
        s3Config: undefined
      });
    });

    it("falls back to default poll interval when JOB_POLL_INTERVAL_MS is invalid", () => {
      expect(
        parseWorkerRuntimeConfig({
          STORAGE_TELEMETRY_PATH: "/var/run/storage",
          JOB_POLL_INTERVAL_MS: "invalid"
        }).pollIntervalMs
      ).toBe(1000);

      expect(
        parseWorkerRuntimeConfig({
          STORAGE_TELEMETRY_PATH: "/var/run/storage",
          JOB_POLL_INTERVAL_MS: "0"
        }).pollIntervalMs
      ).toBe(1000);

      expect(
        parseWorkerRuntimeConfig({
          STORAGE_TELEMETRY_PATH: "/var/run/storage",
          JOB_POLL_INTERVAL_MS: "-10"
        }).pollIntervalMs
      ).toBe(1000);
    });

    it("supports S3 fallback environment variable aliases", () => {
      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage",
        S3_ENDPOINT: "http://s3.local:9000",
        S3_ACCESS_KEY_ID: "s3-alias-key",
        S3_SECRET_ACCESS_KEY: "s3-alias-secret",
        S3_REGION: "eu-central-1",
        S3_FORCE_PATH_STYLE: "false"
      };

      const config = parseWorkerRuntimeConfig(env);
      expect(config.s3Config).toEqual({
        endpoint: "http://s3.local:9000",
        region: "eu-central-1",
        forcePathStyle: false,
        credentials: {
          accessKeyId: "s3-alias-key",
          secretAccessKey: "s3-alias-secret"
        }
      });
    });

    it("omits credentials when accessKeyId or secretAccessKey are empty", () => {
      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage",
        S3_STORAGE_ENDPOINT: "http://s3.local:9000"
      };

      const config = parseWorkerRuntimeConfig(env);
      expect(config.s3Config).toEqual({
        endpoint: "http://s3.local:9000",
        region: "us-east-1",
        forcePathStyle: true
      });
    });

    it("throws WorkerConfigError when STORAGE_TELEMETRY_PATH is missing", () => {
      expect(() => parseWorkerRuntimeConfig({})).toThrow(WorkerConfigError);
    });
  });

  describe("createProductionWorker", () => {
    it("creates a RenderWorker instance with provided config", () => {
      const config = {
        storageTelemetryPath: "/var/run/storage",
        controlApiBaseUrl: "http://localhost:3000",
        workerId: "test-worker",
        pollIntervalMs: 2000
      };

      const worker = createProductionWorker(config);
      expect(worker).toBeInstanceOf(RenderWorker);
    });

    it("accepts and uses dependency overrides", () => {
      const config = {
        storageTelemetryPath: "/var/run/storage",
        controlApiBaseUrl: "http://localhost:3000",
        workerId: "test-worker",
        pollIntervalMs: 2000
      };

      const fakeClient = new TestControlApiClient();
      const fakeStorage = new TestObjectStorage();
      const fakeEnforcer = new TestAdmissionEnforcer();
      const fakeExecutor = vi.fn().mockResolvedValue({});

      const worker = createProductionWorker(config, {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: fakeExecutor
      });

      expect(worker).toBeInstanceOf(RenderWorker);
    });

    it("parses from process.env when config is not provided", () => {
      const originalEnv = process.env;
      try {
        process.env = {
          ...originalEnv,
          STORAGE_TELEMETRY_PATH: "/var/run/storage"
        };
        const worker = createProductionWorker();
        expect(worker).toBeInstanceOf(RenderWorker);
      } finally {
        process.env = originalEnv;
      }
    });
  });

  describe("runWorkerCli", () => {
    it("handles SIGINT signal to stop worker and exit cleanly with 0", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");

      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage",
        JOB_POLL_INTERVAL_MS: "10"
      };

      const fakeClient = new TestControlApiClient();
      fakeClient.claim = vi.fn().mockImplementation(async () => {
        process.emit("SIGINT");
        return undefined;
      });

      const exitCode = await runWorkerCli([], env, {
        controlApiClient: fakeClient,
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer()
      });

      expect(exitCode).toBe(0);
      expect(process.listenerCount("SIGINT")).toBe(sigintCountBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermCountBefore);
    });

    it("handles SIGTERM signal to stop worker and exit cleanly with 0", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");

      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage",
        JOB_POLL_INTERVAL_MS: "10"
      };

      const fakeClient = new TestControlApiClient();
      fakeClient.claim = vi.fn().mockImplementation(async () => {
        process.emit("SIGTERM");
        return undefined;
      });

      const exitCode = await runWorkerCli([], env, {
        controlApiClient: fakeClient,
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer()
      });

      expect(exitCode).toBe(0);
      expect(process.listenerCount("SIGINT")).toBe(sigintCountBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermCountBefore);
    });

    it("cleans up SIGINT and SIGTERM listeners when worker.start throws", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");

      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage"
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const startSpy = vi
        .spyOn(RenderWorker.prototype, "start")
        .mockRejectedValueOnce(new Error("Fatal connection failure"));

      const exitCode = await runWorkerCli([], env, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer()
      });

      expect(exitCode).toBe(1);
      expect(process.listenerCount("SIGINT")).toBe(sigintCountBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermCountBefore);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Worker execution failed:",
        "Fatal connection failure"
      );

      startSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it("returns exit code 1 when configuration parsing fails", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const exitCode = await runWorkerCli([], {});

      expect(exitCode).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Worker execution failed:",
        expect.stringContaining("Missing or empty required environment variable")
      );
      expect(process.listenerCount("SIGINT")).toBe(sigintCountBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermCountBefore);

      consoleSpy.mockRestore();
    });
  });

  describe("isDirectExecution", () => {
    it("returns a boolean", () => {
      expect(typeof isDirectExecution()).toBe("boolean");
    });
  });
});
