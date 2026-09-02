import { describe, expect, it, vi } from "vitest";
import type { ComponentRef } from "@cco/contracts";
import type {
  GenerationManifestRepository,
  MediaAssemblerPort,
  ObjectStoragePort
} from "@cco/application";
import type pg from "pg";
import {
  DeliveryAssemblerConfigError,
  createDeliveryReelAssembler,
  parseDeliveryAssemblerRuntimeConfig
} from "./run-delivery-assembler.js";

describe("run-delivery-assembler CLI & composition root", () => {
  describe("parseDeliveryAssemblerRuntimeConfig", () => {
    it("parses defaults properly", () => {
      const config = parseDeliveryAssemblerRuntimeConfig({}, []);
      expect(config.controlApiBaseUrl).toBe("http://localhost:3000");
      expect(config.pollIntervalMs).toBe(5000);
      expect(config.heartbeatIntervalMs).toBe(30_000);
      expect(config.leaseDurationMs).toBe(300_000);
      expect(config.databaseUrl).toContain("5432");
      expect(config.licenseRegistryPath).toContain("component-license-registry.json");
      expect(config.ffmpegPath).toBe("ffmpeg");
      expect(config.ffprobePath).toBe("ffprobe");
      expect(config.assemblyWorkspaceRoot).toBe("/tmp/cco-assembly");
      expect(config.s3DeliveryBucket).toBe("godzspeed-delivery");
    });

    it("parses CLI arguments correctly", () => {
      const config = parseDeliveryAssemblerRuntimeConfig({}, [
        "--control-api-url=http://api.internal:4000",
        "--worker-id=assembler-42",
        "--poll-interval-ms=1000",
        "--heartbeat-interval-ms=5000",
        "--lease-duration-ms=60000",
        "--database-url=postgres://user:pass@db:5432/cco",
        "--license-registry-path=/custom/license.json",
        "--ffmpeg-path=/usr/local/bin/ffmpeg",
        "--ffprobe-path=/usr/local/bin/ffprobe",
        "--assembly-workspace-root=/var/tmp/custom-workspace",
        "--s3-delivery-bucket=custom-delivery-bucket",
        "--s3-endpoint=http://s3.internal:9000"
      ]);
      expect(config.controlApiBaseUrl).toBe("http://api.internal:4000");
      expect(config.workerId).toBe("assembler-42");
      expect(config.pollIntervalMs).toBe(1000);
      expect(config.heartbeatIntervalMs).toBe(5000);
      expect(config.leaseDurationMs).toBe(60000);
      expect(config.databaseUrl).toBe("postgres://user:pass@db:5432/cco");
      expect(config.licenseRegistryPath).toBe("/custom/license.json");
      expect(config.ffmpegPath).toBe("/usr/local/bin/ffmpeg");
      expect(config.ffprobePath).toBe("/usr/local/bin/ffprobe");
      expect(config.assemblyWorkspaceRoot).toBe("/var/tmp/custom-workspace");
      expect(config.s3DeliveryBucket).toBe("custom-delivery-bucket");
      expect(config.s3Endpoint).toBe("http://s3.internal:9000");
    });

    it("parses environment variables correctly", () => {
      const config = parseDeliveryAssemblerRuntimeConfig(
        {
          CONTROL_API_BASE_URL: "http://api.env:4000",
          WORKER_ID: "assembler-env",
          POLL_INTERVAL_MS: "2000",
          HEARTBEAT_INTERVAL_MS: "10000",
          LEASE_DURATION_MS: "120000",
          DATABASE_URL: "postgres://envuser:envpass@envdb:5432/cco",
          LICENSE_REGISTRY_PATH: "/env/license.json",
          FFMPEG_PATH: "/opt/bin/ffmpeg",
          FFPROBE_PATH: "/opt/bin/ffprobe",
          ASSEMBLY_WORKSPACE_ROOT: "/opt/workspace",
          S3_DELIVERY_BUCKET: "env-delivery-bucket",
          S3_STORAGE_ENDPOINT: "http://minio.env:9000"
        },
        []
      );
      expect(config.controlApiBaseUrl).toBe("http://api.env:4000");
      expect(config.workerId).toBe("assembler-env");
      expect(config.pollIntervalMs).toBe(2000);
      expect(config.heartbeatIntervalMs).toBe(10000);
      expect(config.leaseDurationMs).toBe(120000);
      expect(config.databaseUrl).toBe("postgres://envuser:envpass@envdb:5432/cco");
      expect(config.licenseRegistryPath).toBe("/env/license.json");
      expect(config.ffmpegPath).toBe("/opt/bin/ffmpeg");
      expect(config.ffprobePath).toBe("/opt/bin/ffprobe");
      expect(config.assemblyWorkspaceRoot).toBe("/opt/workspace");
      expect(config.s3DeliveryBucket).toBe("env-delivery-bucket");
      expect(config.s3Endpoint).toBe("http://minio.env:9000");
    });

    it("rejects when heartbeatIntervalMs >= leaseDurationMs", () => {
      expect(() =>
        parseDeliveryAssemblerRuntimeConfig({}, [
          "--heartbeat-interval-ms=60000",
          "--lease-duration-ms=60000"
        ])
      ).toThrow(DeliveryAssemblerConfigError);
      expect(() =>
        parseDeliveryAssemblerRuntimeConfig({}, [
          "--heartbeat-interval-ms=100000",
          "--lease-duration-ms=60000"
        ])
      ).toThrow("heartbeatIntervalMs must be less than leaseDurationMs");
    });

    it("throws DeliveryAssemblerConfigError for non-positive integers", () => {
      expect(() => parseDeliveryAssemblerRuntimeConfig({}, ["--poll-interval-ms=-5"])).toThrow(
        DeliveryAssemblerConfigError
      );
      expect(() =>
        parseDeliveryAssemblerRuntimeConfig({}, ["--heartbeat-interval-ms=abc"])
      ).toThrow(DeliveryAssemblerConfigError);
    });
  });

  describe("createDeliveryReelAssembler composition root", () => {
    it("wires the composition root and eagerly resolves runtime components", async () => {
      const mockRuntimeComponents: ComponentRef[] = [
        {
          componentId: "ffmpeg",
          componentType: "runtime",
          versionOrRevision: "ffmpeg version 7.1-static"
        }
      ];

      const mockMediaAssembler: MediaAssemblerPort = {
        assemble: vi.fn(),
        getRuntimeComponents: vi.fn().mockResolvedValue(mockRuntimeComponents)
      };

      const mockGenerationManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn()
      };

      const mockObjectStorage: ObjectStoragePort = {
        getObject: vi.fn(),
        putObject: vi.fn(),
        deleteObject: vi.fn()
      };

      const mockPool = {
        query: vi.fn(),
        connect: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined)
      } as unknown as pg.Pool;

      const config = parseDeliveryAssemblerRuntimeConfig({}, []);
      const assembler = await createDeliveryReelAssembler(config, {
        pool: mockPool,
        mediaAssembler: mockMediaAssembler,
        generationManifestRepository: mockGenerationManifestRepo,
        objectStorage: mockObjectStorage,
        runtimeComponents: mockRuntimeComponents
      });

      expect(assembler.worker).toBeDefined();
      expect(assembler.runtimeComponents).toEqual(mockRuntimeComponents);
      expect(assembler.assembleDeliveryReelUseCase).toBeDefined();

      await assembler.cleanup();
      expect(mockPool.end).not.toHaveBeenCalled(); // caller owned pool
    });

    it("fails startup fast when getRuntimeComponents rejects", async () => {
      const mockMediaAssembler: MediaAssemblerPort = {
        assemble: vi.fn(),
        getRuntimeComponents: vi
          .fn()
          .mockRejectedValue(new Error("FFmpeg binary not found in PATH"))
      };

      const mockGenerationManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn()
      };

      const mockObjectStorage: ObjectStoragePort = {
        getObject: vi.fn(),
        putObject: vi.fn(),
        deleteObject: vi.fn()
      };

      const mockPool = {
        query: vi.fn(),
        connect: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined)
      } as unknown as pg.Pool;

      const config = parseDeliveryAssemblerRuntimeConfig({}, []);
      await expect(
        createDeliveryReelAssembler(config, {
          pool: mockPool,
          mediaAssembler: mockMediaAssembler,
          generationManifestRepository: mockGenerationManifestRepo,
          objectStorage: mockObjectStorage
        })
      ).rejects.toThrow("FFmpeg binary not found in PATH");
    });
  });
});
