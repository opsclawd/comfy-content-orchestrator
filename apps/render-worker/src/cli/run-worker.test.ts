import { describe, expect, it, vi } from "vitest";
import {
  type StorageAdmissionPolicy,
  createStorageAdmissionPolicy,
  type JobKind,
  type RenderJob,
  type JobId,
  type SceneId,
  type LeaseToken
} from "@cco/domain";
import type {
  JobMutationResult,
  PutObjectInput,
  ObjectLocator,
  StoredObject,
  ObjectStoragePort,
  GpuExecutionLeasePort,
  GpuLeaseHolder,
  RenderEnginePort
} from "@cco/application";
import type { CertificationProvenanceReport } from "@cco/infrastructure";
import type { ControlApiClient } from "../control-api-client.js";
import { RenderWorker, type StorageAdmissionEnforcer, type WorkerLogger } from "../worker.js";
import {
  WorkerConfigError,
  createProductionWorker,
  isDirectExecution,
  parseStorageTelemetryPath,
  parseWorkerRuntimeConfig,
  runWorkerCli,
  type WorkerRuntimeConfig
} from "./run-worker.js";
import type { ProductionManifestAssembler } from "../render-job-executor.js";

class TestControlApiClient implements ControlApiClient {
  async claim(
    _workerId?: string,
    _allowedJobKinds?: readonly JobKind[]
  ): Promise<RenderJob | undefined> {
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

const testLogger: WorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};

const testSleep = async (_ms: number) => {};

const testAssembler: ProductionManifestAssembler = async (input) => ({
  promptIdComfy: input.renderResult.promptId,
  jobId: input.job.jobId
});

function validProductionEnv(): NodeJS.ProcessEnv {
  return {
    STORAGE_TELEMETRY_PATH: "/mnt/storage-telemetry",
    CONTROL_API_BASE_URL: "http://control-api.internal:8000",
    WORKER_ID: "worker-node-1",
    JOB_POLL_INTERVAL_MS: "5000",
    JOB_HEARTBEAT_INTERVAL_MS: "15000",
    JOB_LEASE_DURATION_MS: "60000",
    JOB_TELEMETRY_BACKOFF_MS: "8000",
    JOB_ADMISSION_BACKOFF_MS: "12000",
    WORKER_ALLOWED_JOB_KINDS: "candidate,production",
    COMFYUI_URL: "http://comfyui.internal:8188",
    COMFYUI_RENDER_TIMEOUT_MS: "180000",
    COMFYUI_DIR: "/opt/comfyui",
    GPU_INDEX: "1",
    GPU_LEASE_PATH: "/var/lock/gpu-1.lock",
    CERTIFICATION_MANIFEST_PATH: "/opt/cco/manifest.json",
    GOLD_MASTER_PROVENANCE_PATH: "/opt/cco/provenance.json",
    LICENSE_REGISTRY_PATH: "/opt/cco/license-registry.json",
    S3_STORAGE_ENDPOINT: "http://minio.internal:9000",
    AWS_ACCESS_KEY_ID: "aws-key",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    AWS_REGION: "us-west-2",
    S3_FORCE_PATH_STYLE: "true",
    S3_CANDIDATE_BUCKET: "custom-candidate-bucket",
    S3_DELIVERY_BUCKET: "custom-delivery-bucket"
  };
}

function minimalValidEnv(): NodeJS.ProcessEnv {
  return {
    STORAGE_TELEMETRY_PATH: "/var/run/storage",
    CONTROL_API_BASE_URL: "http://localhost:3000",
    COMFYUI_URL: "http://127.0.0.1:8188",
    COMFYUI_DIR: "/opt/comfyui",
    S3_STORAGE_ENDPOINT: "http://localhost:9000",
    AWS_ACCESS_KEY_ID: "minio-access-key",
    AWS_SECRET_ACCESS_KEY: "minio-secret-key"
  };
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
      const env = validProductionEnv();
      const config = parseWorkerRuntimeConfig(env);

      expect(config).toEqual<WorkerRuntimeConfig>({
        storageTelemetryPath: "/mnt/storage-telemetry",
        controlApiBaseUrl: "http://control-api.internal:8000",
        workerId: "worker-node-1",
        pollIntervalMs: 5000,
        heartbeatIntervalMs: 15000,
        leaseDurationMs: 60000,
        telemetryBackoffMs: 8000,
        admissionBackoffMs: 12000,
        allowedJobKinds: ["candidate", "production"],
        comfyUiUrl: "http://comfyui.internal:8188",
        comfyUiRenderTimeoutMs: 180000,
        comfyUiDir: "/opt/comfyui",
        gpuIndex: 1,
        gpuLeasePath: "/var/lock/gpu-1.lock",
        certificationManifestPath: "/opt/cco/manifest.json",
        goldMasterProvenancePath: "/opt/cco/provenance.json",
        licenseRegistryPath: "/opt/cco/license-registry.json",
        s3Endpoint: "http://minio.internal:9000",
        s3Region: "us-west-2",
        s3ForcePathStyle: true,
        s3AccessKeyId: "aws-key",
        s3SecretAccessKey: "aws-secret",
        s3CandidateBucket: "custom-candidate-bucket",
        s3DeliveryBucket: "custom-delivery-bucket",
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
      const env = minimalValidEnv();
      const config = parseWorkerRuntimeConfig(env);

      expect(config.workerId).toBe("render-worker-default");
      expect(config.pollIntervalMs).toBe(1000);
      expect(config.heartbeatIntervalMs).toBe(30000);
      expect(config.leaseDurationMs).toBe(300000);
      expect(config.telemetryBackoffMs).toBeUndefined();
      expect(config.admissionBackoffMs).toBeUndefined();
      expect(config.allowedJobKinds).toBeUndefined();
      expect(config.comfyUiRenderTimeoutMs).toBe(300000);
      expect(config.gpuIndex).toBe(0);
      expect(config.gpuLeasePath).toContain("comfy-content-orchestrator-gpu-0.lock");
      expect(config.s3Region).toBe("us-east-1");
      expect(config.s3ForcePathStyle).toBe(true);
      expect(config.s3CandidateBucket).toBe("godzspeed-review");
      expect(config.s3DeliveryBucket).toBe("godzspeed-delivery");
    });

    it("rejects incomplete or unsafe production worker configuration", () => {
      // Missing STORAGE_TELEMETRY_PATH
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          STORAGE_TELEMETRY_PATH: ""
        })
      ).toThrow(WorkerConfigError);

      // Missing CONTROL_API_BASE_URL
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          CONTROL_API_BASE_URL: ""
        })
      ).toThrow(WorkerConfigError);

      // Invalid CONTROL_API_BASE_URL (non-HTTP protocol)
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          CONTROL_API_BASE_URL: "ftp://localhost:3000"
        })
      ).toThrow(WorkerConfigError);

      // Missing COMFYUI_URL
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          COMFYUI_URL: ""
        })
      ).toThrow(WorkerConfigError);

      // Missing COMFYUI_DIR
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          COMFYUI_DIR: ""
        })
      ).toThrow(WorkerConfigError);

      // Missing S3_STORAGE_ENDPOINT
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          S3_STORAGE_ENDPOINT: ""
        })
      ).toThrow(WorkerConfigError);

      // Missing AWS_ACCESS_KEY_ID
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          AWS_ACCESS_KEY_ID: ""
        })
      ).toThrow(WorkerConfigError);

      // Missing AWS_SECRET_ACCESS_KEY
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          AWS_SECRET_ACCESS_KEY: ""
        })
      ).toThrow(WorkerConfigError);

      // Blank S3_CANDIDATE_BUCKET
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          S3_CANDIDATE_BUCKET: "   "
        })
      ).toThrow(WorkerConfigError);

      // Blank S3_DELIVERY_BUCKET
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          S3_DELIVERY_BUCKET: "   "
        })
      ).toThrow(WorkerConfigError);

      // Blank WORKER_ID when provided
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          WORKER_ID: "   "
        })
      ).toThrow(WorkerConfigError);
    });

    it("rejects malformed or non-positive timing and integer values", () => {
      // Non-positive poll interval
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_POLL_INTERVAL_MS: "invalid"
        })
      ).toThrow(WorkerConfigError);

      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_POLL_INTERVAL_MS: "0"
        })
      ).toThrow(WorkerConfigError);

      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_POLL_INTERVAL_MS: "-10"
        })
      ).toThrow(WorkerConfigError);

      // Malformed heartbeat interval
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_HEARTBEAT_INTERVAL_MS: "abc"
        })
      ).toThrow(WorkerConfigError);

      // Malformed lease duration
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_LEASE_DURATION_MS: "xyz"
        })
      ).toThrow(WorkerConfigError);

      // Malformed telemetry backoff
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_TELEMETRY_BACKOFF_MS: "-500"
        })
      ).toThrow(WorkerConfigError);

      // Malformed admission backoff
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_ADMISSION_BACKOFF_MS: "0"
        })
      ).toThrow(WorkerConfigError);

      // Malformed ComfyUI timeout
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          COMFYUI_RENDER_TIMEOUT_MS: "0"
        })
      ).toThrow(WorkerConfigError);

      // Negative GPU index
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          GPU_INDEX: "-1"
        })
      ).toThrow(WorkerConfigError);
    });

    it("rejects when heartbeatIntervalMs >= leaseDurationMs", () => {
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_HEARTBEAT_INTERVAL_MS: "300000",
          JOB_LEASE_DURATION_MS: "300000"
        })
      ).toThrow(WorkerConfigError);

      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          JOB_HEARTBEAT_INTERVAL_MS: "400000",
          JOB_LEASE_DURATION_MS: "300000"
        })
      ).toThrow(WorkerConfigError);
    });

    it("supports fallback environment variable aliases", () => {
      const env: NodeJS.ProcessEnv = {
        STORAGE_TELEMETRY_PATH: "/var/run/storage",
        CONTROL_API_URL: "http://control.local:3000",
        COMFYUI_BASE_URL: "http://comfy.local:8188",
        COMFYUI_DIR: "/opt/comfy",
        S3_ENDPOINT: "http://s3.local:9000",
        S3_ACCESS_KEY_ID: "s3-alias-key",
        S3_SECRET_ACCESS_KEY: "s3-alias-secret",
        S3_REGION: "eu-central-1",
        S3_FORCE_PATH_STYLE: "false",
        HEARTBEAT_INTERVAL_MS: "20000",
        LEASE_DURATION_MS: "120000",
        TELEMETRY_BACKOFF_MS: "6000",
        ADMISSION_BACKOFF_MS: "7000",
        ALLOWED_JOB_KINDS: "candidate"
      };

      const config = parseWorkerRuntimeConfig(env);
      expect(config.controlApiBaseUrl).toBe("http://control.local:3000");
      expect(config.comfyUiUrl).toBe("http://comfy.local:8188");
      expect(config.heartbeatIntervalMs).toBe(20000);
      expect(config.leaseDurationMs).toBe(120000);
      expect(config.telemetryBackoffMs).toBe(6000);
      expect(config.admissionBackoffMs).toBe(7000);
      expect(config.allowedJobKinds).toEqual(["candidate"]);
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

    it("parses and validates WORKER_ALLOWED_JOB_KINDS correctly", () => {
      // Candidate only
      expect(
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          WORKER_ALLOWED_JOB_KINDS: "candidate"
        }).allowedJobKinds
      ).toEqual(["candidate"]);

      // Candidate and production
      expect(
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          WORKER_ALLOWED_JOB_KINDS: "candidate, production"
        }).allowedJobKinds
      ).toEqual(["candidate", "production"]);

      // Production only
      expect(
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          WORKER_ALLOWED_JOB_KINDS: "production"
        }).allowedJobKinds
      ).toEqual(["production"]);

      // Invalid job kind
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          WORKER_ALLOWED_JOB_KINDS: "candidate, invalid_kind"
        })
      ).toThrow(WorkerConfigError);

      // Empty item in list
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          WORKER_ALLOWED_JOB_KINDS: "candidate, "
        })
      ).toThrow(WorkerConfigError);
    });

    it("parses and validates DATABASE_URL and CONTROL_API_DATABASE_URL with proper attribution", () => {
      // 1. DATABASE_URL parsed
      expect(
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          DATABASE_URL: "postgresql://user:pass@localhost:5432/db"
        }).databaseUrl
      ).toBe("postgresql://user:pass@localhost:5432/db");

      // 2. CONTROL_API_DATABASE_URL fallback parsed
      expect(
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          CONTROL_API_DATABASE_URL: "postgresql://user:pass@fallback:5432/db"
        }).databaseUrl
      ).toBe("postgresql://user:pass@fallback:5432/db");

      // 3. Invalid DATABASE_URL error message references DATABASE_URL
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          DATABASE_URL: "not-a-url"
        })
      ).toThrow("Invalid URL in variable: DATABASE_URL (must be a valid connection URL)");

      // 4. Invalid CONTROL_API_DATABASE_URL error message references CONTROL_API_DATABASE_URL
      expect(() =>
        parseWorkerRuntimeConfig({
          ...minimalValidEnv(),
          CONTROL_API_DATABASE_URL: "not-a-url"
        })
      ).toThrow(
        "Invalid URL in variable: CONTROL_API_DATABASE_URL (must be a valid connection URL)"
      );
    });
  });

  describe("createProductionWorker", () => {
    it("requires databaseUrl, repository overrides, or assembler whenever production jobs are enabled", () => {
      const baseConfig = parseWorkerRuntimeConfig(minimalValidEnv());

      // 1. Default without DB or repository overrides: throws WorkerConfigError
      expect(() =>
        createProductionWorker(baseConfig, {
          controlApiClient: new TestControlApiClient(),
          objectStorage: new TestObjectStorage(),
          enforceStorageAdmission: new TestAdmissionEnforcer(),
          logger: testLogger,
          sleep: testSleep
        })
      ).toThrow(WorkerConfigError);
      expect(() =>
        createProductionWorker(baseConfig, {
          controlApiClient: new TestControlApiClient(),
          objectStorage: new TestObjectStorage(),
          enforceStorageAdmission: new TestAdmissionEnforcer(),
          logger: testLogger,
          sleep: testSleep
        })
      ).toThrow(
        "DATABASE_URL or repository dependencies (sceneRepository, storyboardCandidateRepository, referenceAssetRepository) are required when production jobs are enabled"
      );

      // 2. Explicitly allowed production jobs without DB: throws WorkerConfigError
      const prodConfig: WorkerRuntimeConfig = {
        ...baseConfig,
        allowedJobKinds: ["production"]
      };
      expect(() =>
        createProductionWorker(prodConfig, {
          controlApiClient: new TestControlApiClient(),
          objectStorage: new TestObjectStorage(),
          enforceStorageAdmission: new TestAdmissionEnforcer(),
          logger: testLogger,
          sleep: testSleep
        })
      ).toThrow(WorkerConfigError);

      // 3. Candidate-only startup: succeeds without assembler or databaseUrl
      const candidateOnlyConfig: WorkerRuntimeConfig = {
        ...baseConfig,
        allowedJobKinds: ["candidate"]
      };
      const candidateWorker = createProductionWorker(candidateOnlyConfig, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        logger: testLogger,
        sleep: testSleep
      });
      expect(candidateWorker).toBeInstanceOf(RenderWorker);

      // 4. Production bootstrap with DATABASE_URL in config: automatically constructs AssembleGenerationManifest without injected assembler override
      const prodWithDbConfig: WorkerRuntimeConfig = {
        ...baseConfig,
        databaseUrl: "postgresql://postgres:postgres@localhost:5432/cco",
        allowedJobKinds: ["production"]
      };
      const prodWorkerWithDb = createProductionWorker(prodWithDbConfig, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        logger: testLogger,
        sleep: testSleep
      });
      expect(prodWorkerWithDb).toBeInstanceOf(RenderWorker);

      // 5. Production bootstrap with repository overrides: automatically constructs AssembleGenerationManifest
      const prodWorkerWithRepoOverrides = createProductionWorker(baseConfig, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        sceneRepository: { findById: async () => undefined, save: async () => {} },
        storyboardCandidateRepository: {
          findById: async () => undefined,
          insert: async () => {},
          listBySceneAndRevision: async () => []
        },
        referenceAssetRepository: { listBySceneId: async () => [] },
        logger: testLogger,
        sleep: testSleep
      });
      expect(prodWorkerWithRepoOverrides).toBeInstanceOf(RenderWorker);

      // 6. Production jobs with assembler supplied: succeeds
      const prodWithAssemblerWorker = createProductionWorker(baseConfig, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        productionManifestAssembler: testAssembler,
        logger: testLogger,
        sleep: testSleep
      });
      expect(prodWithAssemblerWorker).toBeInstanceOf(RenderWorker);
    });

    it("throws WorkerConfigError when license registry is corrupted or invalid", () => {
      const config = parseWorkerRuntimeConfig({
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate"
      });
      expect(() =>
        createProductionWorker(config, {
          controlApiClient: new TestControlApiClient(),
          objectStorage: new TestObjectStorage(),
          enforceStorageAdmission: new TestAdmissionEnforcer(),
          loadComponentLicenseRegistry: () => {
            throw new Error("Invalid schema");
          },
          logger: testLogger,
          sleep: testSleep
        })
      ).toThrow(WorkerConfigError);
      expect(() =>
        createProductionWorker(config, {
          controlApiClient: new TestControlApiClient(),
          objectStorage: new TestObjectStorage(),
          enforceStorageAdmission: new TestAdmissionEnforcer(),
          loadComponentLicenseRegistry: () => {
            throw new Error("Invalid schema");
          },
          logger: testLogger,
          sleep: testSleep
        })
      ).toThrow("Failed to initialize license routing guard: Invalid schema");
    });

    it("fails closed on denied license with zero GPU lease and zero queue calls during polling worker execution", async () => {
      const config = parseWorkerRuntimeConfig({
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate"
      });

      let acquireLeaseCalled = false;
      let queueRenderCalled = false;

      const mockGpuLease: GpuExecutionLeasePort = {
        acquireLease: vi.fn(async () => {
          acquireLeaseCalled = true;
          return {
            leaseId: "gpu-lease-1",
            holder: "worker-node-1" as unknown as GpuLeaseHolder,
            acquiredAt: new Date(),
            release: vi.fn(async () => {})
          };
        })
      };

      const mockRenderEngine = {
        queueRender: vi.fn(async () => {
          queueRenderCalled = true;
          return { executionId: "exec-1" };
        }),
        getRenderResult: vi.fn(),
        unloadModels: vi.fn()
      };

      const mockGpuTelemetry = {
        readMemory: vi.fn(async () => ({
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 512,
          measuredAt: new Date().toISOString()
        }))
      };

      const testJob: RenderJob = {
        jobId: "job-license-test" as unknown as JobId,
        sceneId: "scene-1" as unknown as SceneId,
        jobKind: "candidate",
        status: "leased",
        workflowTemplate: "ltx-25-720p-97f",
        injectedPayload: {
          prompt: "a scenic sunset",
          variantOrdinal: 1
        },
        workerId: "worker-1",
        leaseToken: "lease-tok-1" as unknown as LeaseToken,
        leaseExpiresAt: new Date(Date.now() + 60000),
        retryCount: 0,
        maxRetries: 3,
        errorTrace: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const abortController = new AbortController();
      let failCalledWithTrace: string | undefined;
      let claimCalls = 0;
      const fakeClient = new TestControlApiClient();
      fakeClient.claim = vi.fn().mockImplementation(async () => {
        claimCalls++;
        if (claimCalls === 1) {
          return testJob;
        }
        abortController.abort();
        return undefined;
      });
      fakeClient.fail = vi.fn().mockImplementation(async (_jobId, _leaseToken, errorTrace) => {
        failCalledWithTrace = errorTrace;
        abortController.abort();
        return { outcome: "applied", job: testJob };
      });
      fakeClient.defer = vi.fn();

      const fakeProvenanceReport = {
        version: 1,
        profileId: "ltx-25-720p-97f",
        generatedAt: new Date().toISOString(),
        environment: { os: "linux" },
        workflow: {
          relativePath: "ltx_25_720p_97f_api.json",
          sha256: "b".repeat(64),
          source: {
            kind: "validated_host_export",
            uri: "repo",
            revision: "rev",
            license: "GPL-3.0"
          }
        },
        models: [
          {
            category: "diffusion_models",
            relativePath: "ltx.safetensors",
            key: "models/diffusion_models/ltx.safetensors",
            bytes: 1000,
            sha256: "c".repeat(64)
          }
        ],
        git: {
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          customNodes: []
        },
        disk: {
          freeBytes: 200 * 1024 * 1024 * 1024,
          modelFootprintGb: 10,
          minFreeDiskGb: 0,
          hasSufficientSpace: true
        },
        renderProfileProvenance: {
          key: "LTX_25_720P_5S_V1",
          version: 1,
          engine: "ltx_25",
          workflowHash: "b".repeat(64),
          modelHashes: { "models/diffusion_models/ltx.safetensors": "c".repeat(64) },
          frames: 97,
          steps: 8,
          runnerProfile: "dynamicvram-offload-v1",
          measuredDiskFootprintGb: 10,
          minFreeDiskGb: 0
        }
      };

      // The committed seed registry approved LTX_25_720P_5S_V1 (issue #143
      // operator determination), so this test injects a registry that still
      // reports LTX as review_required to verify the fail-closed path
      // independently of the production registry contents.
      const worker = createProductionWorker(config, {
        controlApiClient: fakeClient,
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        gpuLease: mockGpuLease,
        renderEngine: mockRenderEngine as unknown as RenderEnginePort,
        gpuTelemetry: mockGpuTelemetry,
        loadComponentLicenseRegistry: () => ({
          schemaVersion: 1 as const,
          registryRevision: "test-review-required",
          generatedAt: "2026-09-02T00:00:00.000Z",
          entries: [
            {
              componentId: "LTX_25_720P_5S_V1",
              componentType: "model" as const,
              versionOrRevision: "1",
              status: "review_required" as const,
              licenseSource: "test-fixture",
              reviewedAt: "2026-09-02T00:00:00.000Z",
              policyRevision: "test-review-required"
            }
          ]
        }),
        loadCertificationProfile: async () => ({
          id: "ltx-25-720p-97f",
          engine: "ltx_25",
          workflowPath: "/comfy/workflows/ltx.json",
          workflowRelativePath: "ltx_25_720p_97f_api.json",
          expectedWorkflowHash: "b".repeat(64),
          source: {
            kind: "validated_host_export",
            uri: "repo",
            revision: "rev",
            license: "GPL-3.0"
          },
          baseline: { width: 1280, height: 720, frames: 97, steps: 8 },
          minFreeDiskGb: 0,
          runnerProfile: "dynamicvram-offload-v1",
          models: [{ category: "diffusion_models", relativePath: "ltx.safetensors" }],
          assertions: [{ nodeId: "1", classType: "KSampler", input: "steps", equals: 8 }],
          renderProfileIdentity: {
            key: "LTX_25_720P_5S_V1",
            version: 1
          }
        }),
        readApprovedProvenance: async () =>
          fakeProvenanceReport as unknown as CertificationProvenanceReport,
        collectCertificationProvenance: async () =>
          fakeProvenanceReport as unknown as CertificationProvenanceReport,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () =>
          JSON.stringify({
            "1": { class_type: "KSampler", inputs: { steps: 8, seed: 1 } },
            "3": { class_type: "CLIPTextEncode", inputs: { text: "old text" } }
          }),
        hashWorkflow: () => "b".repeat(64),
        logger: testLogger,
        sleep: testSleep
      });

      await worker.start(abortController.signal);

      // Assert zero GPU lease acquisition and zero ComfyUI queue dispatch calls
      expect(acquireLeaseCalled).toBe(false);
      expect(queueRenderCalled).toBe(false);
      expect(mockGpuLease.acquireLease).not.toHaveBeenCalled();
      expect(mockRenderEngine.queueRender).not.toHaveBeenCalled();

      // Assert job failed permanently via fail(), NOT deferred via defer()
      expect(fakeClient.fail).toHaveBeenCalledTimes(1);
      expect(fakeClient.defer).not.toHaveBeenCalled();
      expect(failCalledWithTrace).toContain("License routing denied");
    });

    it("accepts and wires concrete dependency overrides", () => {
      const config = parseWorkerRuntimeConfig(minimalValidEnv());
      const fakeClient = new TestControlApiClient();
      const fakeStorage = new TestObjectStorage();
      const fakeEnforcer = new TestAdmissionEnforcer();
      const fakeExecutor = vi.fn().mockResolvedValue({ candidatePayload: { variantOrdinal: 1 } });

      const worker = createProductionWorker(
        { ...config, allowedJobKinds: ["candidate"] },
        {
          controlApiClient: fakeClient,
          objectStorage: fakeStorage,
          enforceStorageAdmission: fakeEnforcer,
          renderJobExecutor: fakeExecutor,
          logger: testLogger,
          sleep: testSleep
        }
      );

      expect(worker).toBeInstanceOf(RenderWorker);
    });

    it("parses from process.env when config is not provided", () => {
      const originalEnv = process.env;
      try {
        process.env = {
          ...originalEnv,
          ...minimalValidEnv(),
          WORKER_ALLOWED_JOB_KINDS: "candidate"
        };
        const worker = createProductionWorker(undefined, {
          logger: testLogger,
          sleep: testSleep
        });
        expect(worker).toBeInstanceOf(RenderWorker);
      } finally {
        process.env = originalEnv;
      }
    });

    it("creates a worker successfully when WORKER_ALLOWED_JOB_KINDS is set to candidate as in .env.example", () => {
      const env: NodeJS.ProcessEnv = {
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate"
      };
      const config = parseWorkerRuntimeConfig(env);
      const worker = createProductionWorker(config, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        logger: testLogger,
        sleep: testSleep
      });
      expect(worker).toBeInstanceOf(RenderWorker);
    });

    it("uses default sleep that clears the active polling timer when aborted", async () => {
      vi.useFakeTimers();
      const config = parseWorkerRuntimeConfig({
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate"
      });

      try {
        const worker = createProductionWorker(config, {
          controlApiClient: new TestControlApiClient(),
          objectStorage: new TestObjectStorage(),
          enforceStorageAdmission: new TestAdmissionEnforcer(),
          renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
          logger: testLogger
        });
        expect(worker).toBeInstanceOf(RenderWorker);

        const abortController = new AbortController();
        const startPromise = worker.start(abortController.signal);
        await Promise.resolve();
        expect(vi.getTimerCount()).toBe(1);

        abortController.abort();
        await expect(startPromise).resolves.toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("runWorkerCli", () => {
    it("handles SIGINT signal to stop worker and exit cleanly with 0", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");

      const env: NodeJS.ProcessEnv = {
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate",
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
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
        logger: testLogger,
        sleep: testSleep
      });

      expect(exitCode).toBe(0);
      expect(process.listenerCount("SIGINT")).toBe(sigintCountBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermCountBefore);
    });

    it("handles SIGTERM signal to stop worker and exit cleanly with 0", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");

      const env: NodeJS.ProcessEnv = {
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate",
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
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
        logger: testLogger,
        sleep: testSleep
      });

      expect(exitCode).toBe(0);
      expect(process.listenerCount("SIGINT")).toBe(sigintCountBefore);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermCountBefore);
    });

    it("cleans up SIGINT and SIGTERM listeners when worker.start throws", async () => {
      const sigintCountBefore = process.listenerCount("SIGINT");
      const sigtermCountBefore = process.listenerCount("SIGTERM");

      const env: NodeJS.ProcessEnv = {
        ...minimalValidEnv(),
        WORKER_ALLOWED_JOB_KINDS: "candidate"
      };

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const startSpy = vi
        .spyOn(RenderWorker.prototype, "start")
        .mockRejectedValueOnce(new Error("Fatal connection failure"));

      const exitCode = await runWorkerCli([], env, {
        controlApiClient: new TestControlApiClient(),
        objectStorage: new TestObjectStorage(),
        enforceStorageAdmission: new TestAdmissionEnforcer(),
        renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
        logger: testLogger,
        sleep: testSleep
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
