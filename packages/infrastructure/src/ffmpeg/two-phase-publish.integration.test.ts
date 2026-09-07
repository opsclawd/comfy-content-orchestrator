import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CreateBucketCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  AssembleDeliveryReel,
  AssemblyManifestPublicationError,
  AssemblyVideoCommitError,
  EnforceLicenseRouting,
  type ObjectStoragePort
} from "@cco/application";
import { computeAssemblyId, type AssemblySpec, type VideoStemRef } from "@cco/contracts";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import { FfmpegMediaAssemblerAdapter } from "./ffmpeg-media-assembler-adapter.js";
import { StorageBackedGenerationManifestRepository } from "../storage/storage-backed-generation-manifest-repository.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { startMinioContainer, type StartedMinioContainer } from "../storage/test-support/minio.js";
import { buildApprovedAcceptanceRegistrySnapshot } from "./test-support/component-license-registry-fixtures.js";
import {
  buildSyntheticGenerationManifestPayload,
  generateSyntheticStems,
  type SyntheticStemResult
} from "./test-support/synthetic-stem-fixtures.js";

describe("Two-Phase Publish for AssembleDeliveryReel (integration with real MinIO & FFmpeg)", () => {
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let storage: S3ObjectStorage;
  let fixtureDir: string;
  let workspaceRoot: string;
  let syntheticStem: SyntheticStemResult;
  let realFfmpegVersion: string | undefined;
  let generationManifestRepo: StorageBackedGenerationManifestRepository;

  beforeAll(async () => {
    // 1. Start MinIO testcontainer
    minioContainer = await startMinioContainer();
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

    storage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    // 2. Setup temp directories
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "two-phase-fixtures-"));
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "two-phase-workspaces-"));

    // 3. Generate 1 lightweight synthetic MP4 stem (2 seconds)
    const stems = await generateSyntheticStems({
      ffmpegPath: "ffmpeg",
      outputDir: path.join(fixtureDir, "mp4"),
      count: 1,
      durationSec: 2,
      width: 1280,
      height: 720,
      fps: 30,
      format: "mp4"
    });
    syntheticStem = stems[0]!;

    // 4. Probe real FFmpeg runtime
    const probeAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage: storage
    });
    const runtimeComponents = await probeAdapter.getRuntimeComponents();
    realFfmpegVersion = runtimeComponents.find(
      (c) => c.componentId === "ffmpeg"
    )?.versionOrRevision;

    generationManifestRepo = new StorageBackedGenerationManifestRepository(storage);
  }, 180_000);

  afterAll(async () => {
    rawS3Client?.destroy();
    if (minioContainer) {
      await minioContainer.stop();
    }
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  });

  function createTestSetup(campaignId: string) {
    const sceneId = `scene-${campaignId}`;
    const genManifestId = `gen-man-${campaignId}`;
    const stemKey = `scenes/${sceneId}/candidate.mp4`;

    const seedPromise = (async () => {
      // Seed stem media
      await storage.putObject({
        bucket: BUCKETS.REVIEW,
        key: stemKey,
        body: syntheticStem.bytes,
        contentType: "video/mp4",
        checksumSha256: syntheticStem.sha256
      });

      // Seed generation manifest
      const genPayload = buildSyntheticGenerationManifestPayload({
        campaignId,
        manifestId: genManifestId,
        sceneId,
        stemSha256: syntheticStem.sha256,
        durationMs: syntheticStem.durationMs,
        renderProfile: "LTX_25_720P_5S_V1"
      });
      await storage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `generation-manifests/${genManifestId}.json`,
        body: Buffer.from(JSON.stringify(genPayload)),
        contentType: "application/json"
      });
    })();

    const videoStems: VideoStemRef[] = [
      {
        sceneId,
        generationManifestId: genManifestId,
        order: 0,
        media: {
          bucket: BUCKETS.REVIEW,
          key: stemKey,
          sha256: syntheticStem.sha256,
          contentType: "video/mp4"
        },
        expectedDurationMs: syntheticStem.durationMs
      }
    ];

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: syntheticStem.durationMs,
      subtitleCues: [],
      videoStems
    };

    const registrySnapshot = buildApprovedAcceptanceRegistrySnapshot({
      ffmpegVersion: realFfmpegVersion,
      additionalEntries: [
        {
          componentId: "LTX_25_720P_5S_V1",
          componentType: "model",
          versionOrRevision: "1",
          status: "approved",
          licenseSource: "Lightricks LTX Video Model License",
          reviewedAt: "2026-08-29T12:00:00.000Z",
          policyRevision: "2026-08-29.1"
        }
      ]
    });

    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => registrySnapshot }
    });

    const requiredComponents = [
      {
        componentId: "ffmpeg",
        componentType: "runtime" as const,
        versionOrRevision: realFfmpegVersion ?? "n8.0.1"
      }
    ];

    return {
      spec,
      seedPromise,
      enforceLicenseRouting,
      requiredComponents
    };
  }

  function wrapStorage(overrides: Partial<ObjectStoragePort>): ObjectStoragePort {
    return {
      putObject: (input) =>
        overrides.putObject ? overrides.putObject(input) : storage.putObject(input),
      getObject: (loc) => (overrides.getObject ? overrides.getObject(loc) : storage.getObject(loc)),
      copyObject: (from, to, opts) =>
        overrides.copyObject
          ? overrides.copyObject(from, to, opts)
          : storage.copyObject(from, to, opts),
      headObject: (loc) =>
        overrides.headObject ? overrides.headObject(loc) : storage.headObject(loc),
      deleteObject: (loc) =>
        overrides.deleteObject ? overrides.deleteObject(loc) : storage.deleteObject(loc)
    };
  }

  it("1. Orphan window eliminated: manifest put failure leaves zero video visible at final delivery key, staging video preserved", async () => {
    const campaignId = "camp-orphan-eliminated-001";
    const setup = createTestSetup(campaignId);
    await setup.seedPromise;

    const assemblyId = computeAssemblyId(setup.spec);
    const manifestKey = `campaigns/${campaignId}/assemblies/${assemblyId}/manifest.json`;
    const finalVideoKey = `campaigns/${campaignId}/assemblies/${assemblyId}/output.mp4`;

    const failingStorage = wrapStorage({
      putObject: async (input) => {
        if (input.key === manifestKey) {
          throw new Error("Simulated S3 failure during manifest publication");
        }
        return storage.putObject(input);
      }
    });

    const adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage: storage
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapter,
      objectStorage: failingStorage,
      enforceLicenseRouting: setup.enforceLicenseRouting,
      generationManifestRepository: generationManifestRepo
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({
        spec: setup.spec,
        requiredComponents: setup.requiredComponents
      });
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeInstanceOf(AssemblyManifestPublicationError);
    const pubErr = thrownError as AssemblyManifestPublicationError;

    // CRITICAL: Final delivery key must have ZERO video visible
    const finalVideoObj = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: finalVideoKey
    });
    expect(finalVideoObj).toBeUndefined();

    // Verify raw MinIO also sees 404 for final key
    await expect(
      rawS3Client.send(new HeadObjectCommand({ Bucket: BUCKETS.DELIVERY, Key: finalVideoKey }))
    ).rejects.toThrow();

    // Staging video must exist where the worker left it
    const actualStagingKey = pubErr.executionResult?.stagingMedia?.key;
    expect(actualStagingKey).toBeDefined();
    const stagingVideoObj = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: actualStagingKey!
    });
    expect(stagingVideoObj).toBeDefined();
    expect(stagingVideoObj?.body.byteLength).toBeGreaterThan(0);
  }, 120_000);

  it("2. Successful assembly: publishes manifest first, commits video to final key, and deletes staging", async () => {
    const campaignId = "camp-successful-assembly-002";
    const setup = createTestSetup(campaignId);
    await setup.seedPromise;

    const assemblyId = computeAssemblyId(setup.spec);
    const manifestKey = `campaigns/${campaignId}/assemblies/${assemblyId}/manifest.json`;
    const finalVideoKey = `campaigns/${campaignId}/assemblies/${assemblyId}/output.mp4`;

    const adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage: storage
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapter,
      objectStorage: storage,
      enforceLicenseRouting: setup.enforceLicenseRouting,
      generationManifestRepository: generationManifestRepo
    });

    const result = await useCase.assemble({
      spec: setup.spec,
      requiredComponents: setup.requiredComponents
    });

    expect(result.manifest.assemblyId).toBe(assemblyId);

    // 1. Manifest exists in MinIO
    const storedManifest = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKey
    });
    expect(storedManifest).toBeDefined();
    expect(storedManifest?.contentType).toBe("application/json");

    // 2. Final video exists in MinIO
    const storedVideo = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: finalVideoKey
    });
    expect(storedVideo).toBeDefined();
    expect(storedVideo?.contentType).toBe("video/mp4");
    const videoSha = createHash("sha256").update(storedVideo!.body).digest("hex");
    expect(videoSha).toBe(result.manifest.output.media.sha256);

    // 3. Staging video was cleaned up
    const actualStagingKey = result.executionResult.stagingMedia?.key;
    if (actualStagingKey) {
      const stagingVideo = await storage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: actualStagingKey
      });
      expect(stagingVideo).toBeUndefined();
    }
  }, 120_000);

  it("3. Idempotent replay: second assemble() call with identical spec returns existing delivery with zero FFmpeg spawns", async () => {
    const campaignId = "camp-idempotent-replay-003";
    const setup = createTestSetup(campaignId);
    await setup.seedPromise;

    const adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage: storage
    });

    const assembleSpy = vi.spyOn(adapter, "assemble");

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapter,
      objectStorage: storage,
      enforceLicenseRouting: setup.enforceLicenseRouting,
      generationManifestRepository: generationManifestRepo
    });

    // Run 1: initial encode and publish
    const run1 = await useCase.assemble({
      spec: setup.spec,
      requiredComponents: setup.requiredComponents
    });
    expect(assembleSpy).toHaveBeenCalledTimes(1);

    // Run 2: idempotent replay
    const run2 = await useCase.assemble({
      spec: setup.spec,
      requiredComponents: setup.requiredComponents
    });

    // Step 1 existence check short-circuited: ZERO additional calls to assembler
    expect(assembleSpy).toHaveBeenCalledTimes(1);
    expect(run2.manifest.assemblyId).toBe(run1.manifest.assemblyId);
    expect(run2.manifest.governanceDecisionId).toBe(run1.manifest.governanceDecisionId);
    expect(run2.executionResult.output.media.sha256).toBe(run1.executionResult.output.media.sha256);
  }, 120_000);

  it("4. Crash recovery: first call fails during video commit (manifest exists but video missing); retry re-encodes, finds equivalent manifest at Step 4a, and commits video", async () => {
    const campaignId = "camp-crash-recovery-004";
    const setup = createTestSetup(campaignId);
    await setup.seedPromise;

    const assemblyId = computeAssemblyId(setup.spec);
    const manifestKey = `campaigns/${campaignId}/assemblies/${assemblyId}/manifest.json`;
    const finalVideoKey = `campaigns/${campaignId}/assemblies/${assemblyId}/output.mp4`;

    let copyFail = true;
    const flakyStorage = wrapStorage({
      copyObject: async (from, to, options) => {
        if (copyFail) {
          throw new Error("Simulated worker crash or storage outage during copyObject");
        }
        return storage.copyObject(from, to, options);
      }
    });

    const adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage: storage
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapter,
      objectStorage: flakyStorage,
      enforceLicenseRouting: setup.enforceLicenseRouting,
      generationManifestRepository: generationManifestRepo
    });

    // Run 1: fails at copyObject after manifest was written
    await expect(
      useCase.assemble({
        spec: setup.spec,
        requiredComponents: setup.requiredComponents
      })
    ).rejects.toThrow(AssemblyVideoCommitError);

    // In MinIO: manifest is written, but final video is NOT committed
    const manifestAfterCrash = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKey
    });
    expect(manifestAfterCrash).toBeDefined();

    const videoAfterCrash = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: finalVideoKey
    });
    expect(videoAfterCrash).toBeUndefined();

    // Now recovery run: heal storage
    copyFail = false;

    // Run 2: Step 1 notices video is missing despite manifest existence -> falls through to re-encode ->
    // Step 4a detects equivalent manifest and commits video via copyObject!
    const recovered = await useCase.assemble({
      spec: setup.spec,
      requiredComponents: setup.requiredComponents
    });

    expect(recovered.manifest.assemblyId).toBe(assemblyId);

    // Final video is now committed in MinIO
    const finalVideo = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: finalVideoKey
    });
    expect(finalVideo).toBeDefined();
    const finalSha = createHash("sha256").update(finalVideo!.body).digest("hex");
    expect(finalSha).toBe(recovered.manifest.output.media.sha256);

    // Staging is cleaned up
    const actualStagingKey = recovered.executionResult.stagingMedia?.key;
    if (actualStagingKey) {
      const stagingVideo = await storage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: actualStagingKey
      });
      expect(stagingVideo).toBeUndefined();
    }
  }, 150_000);

  it("5. Concurrent publication: two callers racing the same assemblyId converge through checksum equivalence/conflict detection on manifest and video publication", async () => {
    const campaignId = "camp-concurrent-pub-005";
    const setup = createTestSetup(campaignId);
    await setup.seedPromise;

    const assemblyId = computeAssemblyId(setup.spec);
    const manifestKey = `campaigns/${campaignId}/assemblies/${assemblyId}/manifest.json`;
    const finalVideoKey = `campaigns/${campaignId}/assemblies/${assemblyId}/output.mp4`;

    const workerDirA = path.join(workspaceRoot, "worker-a");
    const workerDirB = path.join(workspaceRoot, "worker-b");
    await fs.mkdir(workerDirA, { recursive: true });
    await fs.mkdir(workerDirB, { recursive: true });

    const adapterA = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot: workerDirA,
      objectStorage: storage
    });

    const adapterB = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot: workerDirB,
      objectStorage: storage
    });

    const useCaseA = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapterA,
      objectStorage: storage,
      enforceLicenseRouting: setup.enforceLicenseRouting,
      generationManifestRepository: generationManifestRepo
    });

    const useCaseB = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapterB,
      objectStorage: storage,
      enforceLicenseRouting: setup.enforceLicenseRouting,
      generationManifestRepository: generationManifestRepo
    });

    const results = await Promise.allSettled([
      useCaseA.assemble({
        spec: setup.spec,
        requiredComponents: setup.requiredComponents
      }),
      useCaseB.assemble({
        spec: setup.spec,
        requiredComponents: setup.requiredComponents
      })
    ]);

    const firstResult = results[0];
    const secondResult = results[1];
    expect(firstResult.status).toBe("fulfilled");
    expect(secondResult.status).toBe("fulfilled");
    if (firstResult.status !== "fulfilled" || secondResult.status !== "fulfilled") {
      throw new Error("Expected both assemble calls to fulfill");
    }

    const resA = firstResult.value;
    const resB = secondResult.value;

    expect(resA.manifest.assemblyId).toBe(assemblyId);
    expect(resB.manifest.assemblyId).toBe(assemblyId);
    expect(resA.manifest.output.media.sha256).toBe(resB.manifest.output.media.sha256);

    // Final video is committed in MinIO
    const finalVideo = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: finalVideoKey
    });
    expect(finalVideo).toBeDefined();
    expect(finalVideo?.contentType).toBe("video/mp4");
    const finalSha = createHash("sha256").update(finalVideo!.body).digest("hex");
    expect(finalSha).toBe(resA.manifest.output.media.sha256);

    // Manifest is committed in MinIO
    const finalManifest = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: manifestKey
    });
    expect(finalManifest).toBeDefined();

    // Both callers' staging videos are cleaned up
    if (resA.executionResult.stagingMedia?.key) {
      const stagingA = await storage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: resA.executionResult.stagingMedia.key
      });
      expect(stagingA).toBeUndefined();
    }
    if (resB.executionResult.stagingMedia?.key) {
      const stagingB = await storage.getObject({
        bucket: BUCKETS.DELIVERY,
        key: resB.executionResult.stagingMedia.key
      });
      expect(stagingB).toBeUndefined();
    }
  }, 180_000);
});
