import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AssembleDeliveryReel,
  AssembleGenerationManifest,
  AssemblyProvenanceConflictError,
  EnforceLicenseRouting,
  type ObjectStoragePort
} from "@cco/application";
import { Scene, type CampaignId, type CandidateId, type JobId, type SceneId } from "@cco/domain";
import {
  ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS,
  AssemblyExecutionResultSchema,
  AssemblyManifestSchema,
  computeAssemblyId,
  hashSubtitleCues,
  type AssemblySpec,
  type VideoStemRef
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import { StorageBackedGenerationManifestRepository } from "../storage/storage-backed-generation-manifest-repository.js";
import { AUDIO_LIMITER_CEILING_DBTP } from "./audio-mix.js";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import { FfmpegMediaAssemblerAdapter } from "./ffmpeg-media-assembler-adapter.js";
import { defaultSpawnRunner, type SpawnLikeFn } from "./ffmpeg-process-runner.js";
import {
  buildApprovedAcceptanceRegistrySnapshot,
  withRegistryRevision
} from "./test-support/component-license-registry-fixtures.js";
import { InMemoryObjectStorage } from "./test-support/in-memory-object-storage.js";
import { generateSyntheticAudio } from "./test-support/synthetic-audio-fixtures.js";
import {
  buildSyntheticGenerationManifestPayload,
  generateSyntheticStems,
  type SyntheticStemResult
} from "./test-support/synthetic-stem-fixtures.js";

describe("FfmpegMediaAssemblerAdapter (integration)", () => {
  let fixtureDir: string;
  let workspaceRoot: string;
  let objectStorage: InMemoryObjectStorage;
  let adapter: FfmpegMediaAssemblerAdapter;
  let syntheticWebpStems: SyntheticStemResult[];
  let syntheticMp4Stems: SyntheticStemResult[];
  // The actual host FFmpeg version, as real-probed by getRuntimeComponents()
  // (not a hardcoded default) -- registered into the acceptance-only license
  // fixture so tests using `adapter.getRuntimeComponents()` pass under
  // whichever real FFmpeg build the current environment (local dev, CI)
  // happens to have installed, rather than only the version the fixture
  // author's own machine reported.
  let realFfmpegVersion: string | undefined;

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-fixtures-"));
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-assembly-workspaces-"));
    objectStorage = new InMemoryObjectStorage();

    adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage
    });

    const runtimeComponents = await adapter.getRuntimeComponents();
    realFfmpegVersion = runtimeComponents.find(
      (c) => c.componentId === "ffmpeg"
    )?.versionOrRevision;

    // 1. Generate 6 synthetic animated WebP stems (authoritative LTX artifact format: 97f @ 24fps = ~4042ms)
    syntheticWebpStems = await generateSyntheticStems({
      ffmpegPath: "ffmpeg",
      outputDir: path.join(fixtureDir, "webp"),
      count: 6,
      durationSec: 4.041666,
      width: 1280,
      height: 720,
      fps: 24,
      format: "webp"
    });

    for (const stem of syntheticWebpStems) {
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-0${stem.index + 1}/candidate.webp`,
        body: stem.bytes,
        contentType: "image/webp",
        checksumSha256: stem.sha256
      });
    }

    // 2. Generate 6 synthetic MP4 stems (6x5s = 30s acceptance gate)
    syntheticMp4Stems = await generateSyntheticStems({
      ffmpegPath: "ffmpeg",
      outputDir: path.join(fixtureDir, "mp4"),
      count: 6,
      durationSec: 5,
      width: 1280,
      height: 720,
      fps: 30,
      format: "mp4"
    });

    for (const stem of syntheticMp4Stems) {
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const genManifestPayload = buildSyntheticGenerationManifestPayload({
        manifestId: `gen-man-mp4-0${stem.index + 1}`,
        campaignId: "campaign-122-mp4-6x5s-acceptance",
        sceneId: `scene-mp4-0${stem.index + 1}`,
        stemSha256: stem.sha256,
        renderProfile: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        durationMs: stem.durationMs
      });
      const payloadBytes = Buffer.from(JSON.stringify(genManifestPayload));
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `generation-manifests/gen-man-mp4-0${stem.index + 1}.json`,
        body: payloadBytes,
        contentType: "application/json",
        checksumSha256: createHash("sha256").update(payloadBytes).digest("hex")
      });
    }
  }, 300_000);

  afterAll(async () => {
    if (fixtureDir) {
      await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
    }
    if (workspaceRoot) {
      await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("assembles six synthetic 5s 1280x720 MP4 stems into ~30s 1080x1920 30fps vertical MP4", async () => {
    const videoStems: VideoStemRef[] = syntheticMp4Stems.map((stem) => ({
      sceneId: `scene-mp4-0${stem.index + 1}`,
      generationManifestId: `gen-man-mp4-0${stem.index + 1}`,
      order: stem.index,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: stem.durationMs
    }));

    const totalExpectedDurationMs = videoStems.reduce((acc, s) => acc + s.expectedDurationMs, 0);

    const spec: AssemblySpec = {
      campaignId: "campaign-122-mp4-6x5s-acceptance",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: totalExpectedDurationMs,
      subtitleCues: [],
      videoStems
    };

    const startTime = Date.now();
    const result = await adapter.assemble(spec);
    const totalAssemblyDuration = Date.now() - startTime;

    // Verify result conforms to the frozen AssemblyExecutionResult schema
    const parsed = AssemblyExecutionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);

    // Verify video dimensions & frame rate (normalized to 30fps yuv420p)
    expect(result.output.width).toBe(1080);
    expect(result.output.height).toBe(1920);
    expect(result.measuredFrameRate).toBe(30);
    expect(result.streams.video.width).toBe(1080);
    expect(result.streams.video.height).toBe(1920);
    expect(result.streams.video.frameRate).toBe(30);
    expect(result.streams.video.codecName).toBe("h264");
    expect(result.streams.video.pixelFormat).toBe("yuv420p");

    // Verify timeline durations within tolerance (~30s total)
    expect(result.timeline.totalDurationMs).toBe(30000);
    expect(result.timeline.stemDurationsMs).toHaveLength(6);
    expect(
      Math.abs(result.output.durationMs - result.timeline.totalDurationMs)
    ).toBeLessThanOrEqual(250);
    expect(Math.abs(result.output.durationMs - 30000)).toBeLessThanOrEqual(250);

    // Verify execution provenance metadata
    expect(result.ffmpeg.executable).toBe("ffmpeg");
    expect(result.ffmpeg.version).toBeTruthy();
    expect(result.ffmpeg.buildInfo).toBeTruthy();
    expect(result.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.commandFingerprint).not.toContain(workspaceRoot);
    expect(result.executionDurationMs).toBeGreaterThan(0);
    expect(result.executionDurationMs).toBeLessThanOrEqual(totalAssemblyDuration + 50);

    // Verify layout mode
    expect(result.layout.mode).toBe("fit_blurred_fill");

    // Verify output object persisted in delivery storage
    expect(result.output.media.bucket).toBe(BUCKETS.DELIVERY);
    expect(result.output.media.contentType).toBe("video/mp4");
    expect(result.output.media.sha256).toMatch(/^[0-9a-f]{64}$/);

    const storedOutput = await objectStorage.getObject({
      bucket: result.output.media.bucket,
      key: result.output.media.key
    });
    expect(storedOutput).toBeDefined();
    expect(storedOutput?.body.byteLength).toBeGreaterThan(0);

    // Native MP4 stems must omit normalization provenance entirely.
    for (const executedStem of result.executedInputs.videoStems) {
      expect(executedStem.normalization).toBeUndefined();
    }
  }, 300_000);

  it("assembles six authoritative animated WebP LTX stems (~4.04s 24fps) into ~24.25s 1080x1920 30fps vertical MP4 with provenance", async () => {
    const videoStems: VideoStemRef[] = syntheticWebpStems.map((stem) => ({
      sceneId: `scene-0${stem.index + 1}`,
      generationManifestId: `gen-man-0${stem.index + 1}`,
      order: stem.index,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-0${stem.index + 1}/candidate.webp`,
        sha256: stem.sha256,
        contentType: "image/webp"
      },
      expectedDurationMs: stem.durationMs
    }));

    const totalExpectedDurationMs = videoStems.reduce((acc, s) => acc + s.expectedDurationMs, 0);

    const spec: AssemblySpec = {
      campaignId: "campaign-122-ltx-webp-integration",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: totalExpectedDurationMs,
      subtitleCues: [],
      videoStems
    };

    const startTime = Date.now();
    const result = await adapter.assemble(spec);
    const totalAssemblyDuration = Date.now() - startTime;

    // Verify result conforms to the frozen AssemblyExecutionResult schema
    const parsed = AssemblyExecutionResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);

    // Verify video dimensions & frame rate (normalized to 30fps yuv420p)
    expect(result.output.width).toBe(1080);
    expect(result.output.height).toBe(1920);
    expect(result.measuredFrameRate).toBe(30);
    expect(result.streams.video.width).toBe(1080);
    expect(result.streams.video.height).toBe(1920);
    expect(result.streams.video.frameRate).toBe(30);
    expect(result.streams.video.codecName).toBe("h264");
    expect(result.streams.video.pixelFormat).toBe("yuv420p");

    // Verify timeline durations within tolerance. Real H.264/MP4 encoding
    // introduces sub-frame container-timebase quantization even when every
    // source WebP frame's exact duration is preserved end-to-end (see
    // webp-normalizer.ts) — exact millisecond equality against real encoder
    // output isn't achievable for any lossy codec/container pipeline, and
    // the production code itself validates this with the same tolerance
    // (ffmpeg-media-assembler-adapter.ts's output-duration check), not exact
    // equality. This must stay well inside the tolerance, not merely under it.
    expect(Math.abs(result.timeline.totalDurationMs - totalExpectedDurationMs)).toBeLessThanOrEqual(
      ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
    );
    expect(result.timeline.stemDurationsMs).toHaveLength(6);
    expect(
      Math.abs(result.output.durationMs - result.timeline.totalDurationMs)
    ).toBeLessThanOrEqual(250);

    // Verify execution provenance metadata
    expect(result.ffmpeg.executable).toBe("ffmpeg");
    expect(result.ffmpeg.version).toBeTruthy();
    expect(result.ffmpeg.buildInfo).toBeTruthy();
    expect(result.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.commandFingerprint).not.toContain(workspaceRoot);
    expect(result.executionDurationMs).toBeGreaterThan(0);
    expect(result.executionDurationMs).toBeLessThanOrEqual(totalAssemblyDuration + 50);

    // Verify layout mode
    expect(result.layout.mode).toBe("fit_blurred_fill");

    // Verify output object persisted in delivery storage
    expect(result.output.media.bucket).toBe(BUCKETS.DELIVERY);
    expect(result.output.media.contentType).toBe("video/mp4");
    expect(result.output.media.sha256).toMatch(/^[0-9a-f]{64}$/);

    const storedOutput = await objectStorage.getObject({
      bucket: result.output.media.bucket,
      key: result.output.media.key
    });
    expect(storedOutput).toBeDefined();
    expect(storedOutput?.body.byteLength).toBeGreaterThan(0);

    // Verify normalization provenance: every WebP stem must record what it
    // was normalized into, while `media` keeps pointing at the original
    // source WebP asset (additive, not a replacement of source identity).
    expect(result.executedInputs.videoStems).toHaveLength(6);
    for (const [i, executedStem] of result.executedInputs.videoStems.entries()) {
      expect(executedStem.media.contentType).toBe("image/webp");
      expect(executedStem.media.sha256).toBe(syntheticWebpStems[i]!.sha256);
      expect(executedStem.normalization).toBeDefined();
      expect(executedStem.normalization?.profile).toBe("ANIMATED_WEBP_TO_MP4_V1");
      expect(executedStem.normalization?.normalizedContentType).toBe("video/mp4");
      expect(executedStem.normalization?.normalizedSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(executedStem.normalization?.normalizedSha256).not.toBe(executedStem.media.sha256);
      expect(executedStem.normalization?.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(executedStem.normalization?.commandFingerprint).not.toContain(workspaceRoot);
    }
  }, 300_000);

  it("preserves stem order regardless of array ordering in input spec", async () => {
    // Reverse the array order of stems in spec
    const reversedStems: VideoStemRef[] = [...syntheticWebpStems].reverse().map((stem) => ({
      sceneId: `scene-0${stem.index + 1}`,
      generationManifestId: `gen-man-0${stem.index + 1}`,
      order: stem.index,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-0${stem.index + 1}/candidate.webp`,
        sha256: stem.sha256,
        contentType: "image/webp"
      },
      expectedDurationMs: stem.durationMs
    }));

    const totalExpectedDurationMs = reversedStems.reduce((acc, s) => acc + s.expectedDurationMs, 0);

    const spec: AssemblySpec = {
      campaignId: "campaign-order-test",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: totalExpectedDurationMs,
      subtitleCues: [],
      videoStems: reversedStems
    };

    const result = await adapter.assemble(spec);

    // Assert executed stems are in sequential order 0..5
    expect(result.executedInputs.videoStems.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.executedInputs.videoStems.map((s) => s.sceneId)).toEqual([
      "scene-01",
      "scene-02",
      "scene-03",
      "scene-04",
      "scene-05",
      "scene-06"
    ]);
  }, 300_000);

  it("fails loudly when stem SHA-256 does not match staged bytes", async () => {
    const videoStems: VideoStemRef[] = syntheticWebpStems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-0${stem.index + 1}`,
      generationManifestId: `gen-man-0${stem.index + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-0${stem.index + 1}/candidate.webp`,
        sha256: idx === 1 ? "1".repeat(64) : stem.sha256, // Corrupt 2nd stem hash
        contentType: "image/webp"
      },
      expectedDurationMs: stem.durationMs
    }));

    const spec: AssemblySpec = {
      campaignId: "campaign-hash-fail",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: videoStems.reduce((acc, s) => acc + s.expectedDurationMs, 0),
      subtitleCues: [],
      videoStems
    };

    await expect(adapter.assemble(spec)).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_HASH_MISMATCH"
      })
    );
  });

  it("rejects tampered video bytes when the spec still carries the original immutable hash", async () => {
    const sourceStem = syntheticMp4Stems[0]!;
    const tamperedBytes = Buffer.from(sourceStem.bytes);
    const lastByteIndex = tamperedBytes.length - 1;
    tamperedBytes[lastByteIndex] = tamperedBytes[lastByteIndex]! ^ 0xff;
    const tamperedKey = "scenes/scene-tampered/candidate.mp4";

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: tamperedKey,
      body: tamperedBytes,
      contentType: "video/mp4",
      // Deliberately retain the source object's hash as the immutable expectation.
      checksumSha256: sourceStem.sha256
    });

    const spec: AssemblySpec = {
      campaignId: "campaign-tampered-video-bytes",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-tampered",
          generationManifestId: "gen-man-tampered",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: tamperedKey,
            sha256: sourceStem.sha256,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    await expect(adapter.assemble(spec)).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_HASH_MISMATCH"
      })
    );
  });

  it("fails with typed error on corrupt/unreadable input media", async () => {
    const corruptBytes = new TextEncoder().encode("NOT_A_VALID_MP4_OR_WEBP");
    const realSha256 = (await import("node:crypto"))
      .createHash("sha256")
      .update(corruptBytes)
      .digest("hex");

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "scenes/scene-corrupt/candidate.mp4",
      body: corruptBytes,
      contentType: "video/mp4",
      checksumSha256: realSha256
    });

    const spec: AssemblySpec = {
      campaignId: "campaign-corrupt-fail",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-corrupt",
          generationManifestId: "gen-man-corrupt",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: "scenes/scene-corrupt/candidate.mp4",
            sha256: realSha256,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    await expect(adapter.assemble(spec)).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_PROBE_FAILED"
      })
    );
  });

  it("fails with typed error when stem duration is out of tolerance", async () => {
    const stem = syntheticWebpStems[0]!;
    const spec: AssemblySpec = {
      campaignId: "campaign-tolerance-fail",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 8000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-01",
          generationManifestId: "gen-01",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: `scenes/scene-01/candidate.webp`,
            sha256: stem.sha256,
            contentType: "image/webp"
          },
          expectedDurationMs: 8000 // Actual is ~4042ms; ~3958ms diff > 250ms tolerance
        }
      ]
    };

    await expect(adapter.assemble(spec)).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_DURATION_OUT_OF_TOLERANCE"
      })
    );
  });

  it("assembles six MP4 stems with voiceover, soundbed, and subtitles into delivery reel and persists immutable AssemblyManifest", async () => {
    // Generate synthetic voiceover (15s @ 440 Hz) and soundbed (10s @ 220 Hz stereo)
    const syntheticVo = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "vo.mp3"),
      durationSec: 15,
      frequency: 440,
      channels: 1,
      format: "mp3"
    });

    const syntheticSb = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      // Deliberately not an exact divisor of the 30s target (10s would be):
      // loopCount = Math.floor(activeDurationMs / actualDurationMs) is
      // computed from ffprobe's real measurement of the encoded fixture,
      // which carries sub-frame container-timebase quantization that varies
      // slightly across real ffmpeg builds/versions. An exact-multiple
      // duration sits exactly on Math.floor's integer boundary, so any
      // positive measurement noise (observed: ~50ms between ffmpeg 8.0.1 and
      // 6.1.1) flips the loop count. 9.5s keeps loopCount at 3 with ~500ms
      // of margin on both sides.
      outputPath: path.join(fixtureDir, "audio", "sb.mp3"),
      durationSec: 9.5,
      frequency: 220,
      channels: 2,
      format: "mp3"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/vo-full.mp3",
      body: syntheticVo.bytes,
      contentType: "audio/mpeg",
      checksumSha256: syntheticVo.sha256
    });

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/sb-full.mp3",
      body: syntheticSb.bytes,
      contentType: "audio/mpeg",
      checksumSha256: syntheticSb.sha256
    });

    const videoStems: VideoStemRef[] = syntheticMp4Stems.map((stem) => ({
      sceneId: `scene-mp4-0${stem.index + 1}`,
      generationManifestId: `gen-man-mp4-0${stem.index + 1}`,
      order: stem.index,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: stem.durationMs
    }));

    const spec: AssemblySpec = {
      campaignId: "campaign-123-audiovisual-delivery",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 30000,
      voiceover: {
        assetId: "vo-asset-001",
        kind: "voiceover",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/vo-full.mp3",
          sha256: syntheticVo.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "provider", providerId: "azure-tts" },
        startMs: 2000,
        expectedDurationMs: 15000
      },
      soundbed: {
        assetId: "sb-asset-001",
        kind: "soundbed",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/sb-full.mp3",
          sha256: syntheticSb.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "local" },
        startMs: 0,
        expectedDurationMs: 30000
      },
      subtitleCues: [
        { startMs: 2500, endMs: 7000, text: "First subtitle line with {safe} text" },
        { startMs: 8000, endMs: 14000, text: "Second subtitle dialogue line" }
      ],
      videoStems
    };

    // Persist 6 real GenerationManifest fixtures into object storage for the acceptance slice
    for (const stem of syntheticMp4Stems) {
      const genManifestPayload = buildSyntheticGenerationManifestPayload({
        manifestId: `gen-man-mp4-0${stem.index + 1}`,
        campaignId: spec.campaignId,
        sceneId: `scene-mp4-0${stem.index + 1}`,
        stemSha256: stem.sha256,
        renderProfile: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        durationMs: stem.durationMs
      });
      const payloadBytes = Buffer.from(JSON.stringify(genManifestPayload));
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `generation-manifests/gen-man-mp4-0${stem.index + 1}.json`,
        body: payloadBytes,
        contentType: "application/json",
        checksumSha256: createHash("sha256").update(payloadBytes).digest("hex")
      });
    }

    const generationManifestRepository = new StorageBackedGenerationManifestRepository(
      objectStorage,
      BUCKETS.REVIEW
    );

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const deliveryReelUseCase = new AssembleDeliveryReel({
      runtimeComponents: await adapter.getRuntimeComponents(),
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository
    });

    const { manifest, executionResult } = await deliveryReelUseCase.assemble({
      spec
    });

    // 1. Verify executionResult conforms to schema & requirements
    expect(executionResult.output.width).toBe(1080);
    expect(executionResult.output.height).toBe(1920);
    expect(executionResult.measuredFrameRate).toBe(30);
    expect(Math.abs(executionResult.output.durationMs - 30000)).toBeLessThanOrEqual(
      ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
    );

    // Audio stream verification
    expect(executionResult.streams.audio).toBeDefined();
    expect(executionResult.streams.audio?.codecName).toBe("aac");
    expect(executionResult.streams.audio?.sampleRateHz).toBe(48000);
    expect(executionResult.streams.audio?.channels).toBe(2);
    expect(Math.abs(executionResult.streams.audio!.durationMs - 30000)).toBeLessThanOrEqual(
      ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
    );

    // Executed audio algebra verification
    expect(executionResult.executedInputs.voiceover).toBeDefined();
    expect(executionResult.executedInputs.voiceover?.effectiveStartMs).toBe(2000);
    // actualDurationMs is ffprobe's real measurement of the staged voiceover
    // input, and padTrailingMs is algebraically derived from it
    // (totalTimelineMs - startMs - actualDurationMs) — both inherit
    // sub-frame container-timebase quantization that varies slightly across
    // real ffmpeg builds/versions (observed: a consistent ~47ms difference
    // between ffmpeg 8.0.1 and 6.1.1 for the same synthetic fixture), so
    // neither can be asserted with exact equality against a real encoder,
    // same reasoning as the output-duration checks above.
    expect(
      Math.abs(executionResult.executedInputs.voiceover!.actualDurationMs - syntheticVo.durationMs)
    ).toBeLessThanOrEqual(ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS);
    expect(
      Math.abs(executionResult.executedInputs.voiceover!.padTrailingMs - 13000)
    ).toBeLessThanOrEqual(ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS);
    expect(executionResult.executedInputs.voiceover?.effectiveDurationMs).toBe(28000);
    expect(executionResult.executedInputs.voiceover?.gainDb).toBeDefined();

    expect(executionResult.executedInputs.soundbed).toBeDefined();
    expect(executionResult.executedInputs.soundbed?.effectiveDurationMs).toBe(30000);
    expect(executionResult.executedInputs.soundbed?.gainDb).toBe(-18.0);
    expect(executionResult.executedInputs.soundbed?.duckingDb).toBe(-12.0);
    expect(executionResult.executedInputs.soundbed?.loopCount).toBe(3); // floor(30s / ~9.5s) = 3 loops, with real margin either side

    // Subtitle verification
    expect(executionResult.subtitleStyleProfile).toBe("VERTICAL_REEL_CENTER_V1");
    expect(executionResult.subtitleCues).toHaveLength(2);

    // 2. Verify immutable AssemblyManifest
    expect(manifest.assemblyId).toBe(executionResult.assemblyId);
    expect(manifest.governanceDecisionId).toMatch(/^gov-dec-/);
    expect(manifest.generationManifestIds).toHaveLength(6);
    expect(manifest.generationManifestIds).toEqual(videoStems.map((s) => s.generationManifestId));
    for (const genId of manifest.generationManifestIds) {
      const storedGen = await objectStorage.getObject({
        bucket: BUCKETS.REVIEW,
        key: `generation-manifests/${genId}.json`
      });
      expect(storedGen).toBeDefined();
    }
    expect(manifest.inputs.voiceover?.assetId).toBe("vo-asset-001");
    expect(manifest.inputs.soundbed?.assetId).toBe("sb-asset-001");
    expect(manifest.subtitleStyleProfile).toBe("VERTICAL_REEL_CENTER_V1");

    // 3. Verify persistent objects in storage
    const storedMedia = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${spec.campaignId}/assemblies/${executionResult.assemblyId}/output.mp4`
    });
    expect(storedMedia).toBeDefined();
    expect(storedMedia?.body.byteLength).toBeGreaterThan(0);

    const storedManifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${spec.campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`
    });
    expect(storedManifestObj).toBeDefined();
    expect(storedManifestObj?.contentType).toBe("application/json");

    const parsedManifest = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(storedManifestObj?.body))
    );
    expect(parsedManifest.assemblyId).toBe(executionResult.assemblyId);
    expect(parsedManifest.governanceDecisionId).toMatch(/^gov-dec-/);

    // 4. AC-4: Measure produced output audio with true-peak analysis (ebur128=peak=true) to verify true-peak ceiling (no clipping)
    const outputTestPath = path.join(fixtureDir, "test-output-audio.mp4");
    await fs.writeFile(outputTestPath, storedMedia!.body);

    const truePeakCheck = await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        outputTestPath,
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-"
      ],
      { timeoutMs: 30_000 }
    );
    expect(truePeakCheck.exitCode).toBe(0);
    const truePeakMatch = truePeakCheck.stderr.match(/True peak:\s*\n\s*Peak:\s*([-\d.]+)\s*dBFS/i);
    expect(truePeakMatch).toBeTruthy();
    const measuredTruePeakDbfs = parseFloat(truePeakMatch![1]!);
    expect(measuredTruePeakDbfs).toBeLessThanOrEqual(AUDIO_LIMITER_CEILING_DBTP); // Output does not clip beyond documented -1.0 dBTP ceiling

    // 5. AC-3: Verify soundbed ducking behavior (audio level of 220Hz soundbed during VO window [2s..17s] is measurably ducked vs outside [20s..25s])
    const insideVoSlice = await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-ss",
        "5",
        "-t",
        "5",
        "-i",
        outputTestPath,
        "-af",
        "bandpass=f=220:width_type=q:w=10,bandpass=f=220:width_type=q:w=10,astats",
        "-f",
        "null",
        "-"
      ],
      { timeoutMs: 30_000 }
    );
    const outsideVoSlice = await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-ss",
        "20",
        "-t",
        "5",
        "-i",
        outputTestPath,
        "-af",
        "bandpass=f=220:width_type=q:w=10,bandpass=f=220:width_type=q:w=10,astats",
        "-f",
        "null",
        "-"
      ],
      { timeoutMs: 30_000 }
    );

    const insideRmsMatch = insideVoSlice.stderr.match(/RMS level dB:\s+([-\d.]+)/);
    const insidePeakMatch = insideVoSlice.stderr.match(/Peak level dB:\s+([-\d.]+)/);
    const outsideRmsMatch = outsideVoSlice.stderr.match(/RMS level dB:\s+([-\d.]+)/);
    const outsidePeakMatch = outsideVoSlice.stderr.match(/Peak level dB:\s+([-\d.]+)/);

    expect(insideRmsMatch).toBeTruthy();
    expect(insidePeakMatch).toBeTruthy();
    expect(outsideRmsMatch).toBeTruthy();
    expect(outsidePeakMatch).toBeTruthy();

    const insideRmsDb = parseFloat(insideRmsMatch![1]!);
    const insidePeakDb = parseFloat(insidePeakMatch![1]!);
    const outsideRmsDb = parseFloat(outsideRmsMatch![1]!);
    const outsidePeakDb = parseFloat(outsidePeakMatch![1]!);

    // In-window ducked soundbed is attenuated compared to outside-window soundbed (both RMS and Peak)
    expect(insideRmsDb).toBeLessThan(outsideRmsDb - 3.0);
    expect(insidePeakDb).toBeLessThan(outsidePeakDb - 3.0);

    // 6. AC-2: Behavioral subtitle burn-in verification
    // Sample frames in the subtitle-safe region (MarginV=320 per VERTICAL_REEL_CENTER_V1)
    // at t=4.0s (during active cue 1: 2.5s..7.0s) vs t=1.0s (before any cue).
    const cueFrameStats = await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-ss",
        "4.0",
        "-i",
        outputTestPath,
        "-frames:v",
        "1",
        "-vf",
        "crop=1080:300:0:1450,signalstats,metadata=print:file=-",
        "-f",
        "null",
        "-"
      ],
      { timeoutMs: 30_000 }
    );
    const noCueFrameStats = await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-ss",
        "1.0",
        "-i",
        outputTestPath,
        "-frames:v",
        "1",
        "-vf",
        "crop=1080:300:0:1450,signalstats,metadata=print:file=-",
        "-f",
        "null",
        "-"
      ],
      { timeoutMs: 30_000 }
    );

    const cueYmaxMatch = cueFrameStats.stdout.match(/lavfi\.signalstats\.YMAX=(\d+)/);
    const cueYminMatch = cueFrameStats.stdout.match(/lavfi\.signalstats\.YMIN=(\d+)/);
    const noCueYmaxMatch = noCueFrameStats.stdout.match(/lavfi\.signalstats\.YMAX=(\d+)/);
    const noCueYminMatch = noCueFrameStats.stdout.match(/lavfi\.signalstats\.YMIN=(\d+)/);

    expect(cueYmaxMatch).toBeTruthy();
    expect(noCueYmaxMatch).toBeTruthy();
    const cueYmax = parseInt(cueYmaxMatch![1]!, 10);
    const noCueYmax = parseInt(noCueYmaxMatch![1]!, 10);
    const cueYmin = parseInt(cueYminMatch![1]!, 10);
    const noCueYmin = parseInt(noCueYminMatch![1]!, 10);

    // Burned-in white subtitle text produces near-peak luminance (YMAX >= 230)
    // distinctly higher than the blurred background alone
    expect(cueYmax).toBeGreaterThanOrEqual(230);
    expect(cueYmax).toBeGreaterThan(noCueYmax);
    expect(cueYmin).toBeLessThanOrEqual(noCueYmin);

    // Also extract frame PNGs to behaviorally prove byte-level image differences in the subtitle window
    const cuePngPath = path.join(fixtureDir, "frame-cue-active.png");
    const noCuePngPath = path.join(fixtureDir, "frame-cue-inactive.png");
    await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner("ffmpeg", [
      "-y",
      "-ss",
      "4.0",
      "-i",
      outputTestPath,
      "-frames:v",
      "1",
      "-vf",
      "crop=1080:300:0:1450",
      cuePngPath
    ]);
    await (
      await import("./ffmpeg-process-runner.js")
    ).defaultSpawnRunner("ffmpeg", [
      "-y",
      "-ss",
      "1.0",
      "-i",
      outputTestPath,
      "-frames:v",
      "1",
      "-vf",
      "crop=1080:300:0:1450",
      noCuePngPath
    ]);
    const cuePngBytes = await fs.readFile(cuePngPath);
    const noCuePngBytes = await fs.readFile(noCuePngPath);
    const cuePngSha256 = createHash("sha256").update(cuePngBytes).digest("hex");
    const noCuePngSha256 = createHash("sha256").update(noCuePngBytes).digest("hex");
    expect(cuePngSha256).not.toBe(noCuePngSha256);

    // PRD §9.5: Record measured execution duration
    console.info(
      `[PRD §9.5 Assembly Gate] Measured executionDurationMs: ${executionResult.executionDurationMs}ms`
    );
    expect(executionResult.executionDurationMs).toBeGreaterThan(0);
  }, 300_000);

  it("assembles six MP4 stems with VO-only (padded to full 30s duration)", async () => {
    const syntheticVo = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "vo-only.mp3"),
      durationSec: 15,
      frequency: 440,
      channels: 1,
      format: "mp3"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/vo-only.mp3",
      body: syntheticVo.bytes,
      contentType: "audio/mpeg",
      checksumSha256: syntheticVo.sha256
    });

    const videoStems: VideoStemRef[] = syntheticMp4Stems.map((stem) => ({
      sceneId: `scene-mp4-0${stem.index + 1}`,
      generationManifestId: `gen-man-mp4-0${stem.index + 1}`,
      order: stem.index,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: stem.durationMs
    }));

    const spec: AssemblySpec = {
      campaignId: "campaign-vo-only-30s",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 30000,
      voiceover: {
        assetId: "vo-only-001",
        kind: "voiceover",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/vo-only.mp3",
          sha256: syntheticVo.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "local" },
        startMs: 2000,
        expectedDurationMs: 15000
      },
      subtitleCues: [],
      videoStems
    };

    const result = await adapter.assemble(spec);
    expect(result.executedInputs.voiceover).toBeDefined();
    expect(result.executedInputs.voiceover?.effectiveStartMs).toBe(2000);
    // padTrailingMs is algebraically derived from ffprobe's real measurement
    // of the staged voiceover input (totalTimelineMs - startMs -
    // actualDurationMs), which carries sub-frame container-timebase
    // quantization that varies slightly across real ffmpeg builds/versions —
    // same reasoning as the other real-encoder duration checks in this file.
    expect(Math.abs(result.executedInputs.voiceover!.padTrailingMs - 13000)).toBeLessThanOrEqual(
      ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
    );
    expect(result.executedInputs.voiceover?.effectiveDurationMs).toBe(28000);
    expect(result.executedInputs.soundbed).toBeUndefined();

    // Verify audio stream duration matches video duration within tolerance
    expect(result.streams.audio).toBeDefined();
    expect(result.streams.audio?.channels).toBe(2);
    expect(result.streams.audio?.sampleRateHz).toBe(48000);
    expect(Math.abs(result.streams.audio!.durationMs - 30000)).toBeLessThanOrEqual(
      ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
    );
  }, 300_000);

  it("assembles reel with soundbed startMs > 0 properly offset and looped", async () => {
    const syntheticSb = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "sb-offset.mp3"),
      durationSec: 10,
      frequency: 220,
      channels: 2,
      format: "mp3"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/sb-offset.mp3",
      body: syntheticSb.bytes,
      contentType: "audio/mpeg",
      checksumSha256: syntheticSb.sha256
    });

    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-mp4-0${idx + 1}`,
      generationManifestId: `gen-man-mp4-0${idx + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${idx + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const spec: AssemblySpec = {
      campaignId: "campaign-sb-offset-test",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 10000,
      soundbed: {
        assetId: "sb-offset-001",
        kind: "soundbed",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/sb-offset.mp3",
          sha256: syntheticSb.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "local" },
        startMs: 2000,
        expectedDurationMs: 8000
      },
      subtitleCues: [],
      videoStems
    };

    const result = await adapter.assemble(spec);
    expect(result.executedInputs.soundbed).toBeDefined();
    expect(result.executedInputs.soundbed?.effectiveStartMs).toBe(2000);
    expect(result.executedInputs.soundbed?.effectiveDurationMs).toBe(8000);
    expect(result.streams.audio).toBeDefined();
    expect(Math.abs(result.streams.audio!.durationMs - 10000)).toBeLessThanOrEqual(
      ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
    );
  }, 300_000);

  it("negative test: corrupted voiceover SHA-256 throws AUDIO_HASH_MISMATCH and publishes no delivery media", async () => {
    const syntheticVo = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "vo-corrupt.mp3"),
      durationSec: 5,
      frequency: 440,
      channels: 1,
      format: "mp3"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/vo-corrupt.mp3",
      body: syntheticVo.bytes,
      contentType: "audio/mpeg",
      checksumSha256: syntheticVo.sha256
    });

    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 1).map((stem) => ({
      sceneId: `scene-mp4-01`,
      generationManifestId: `gen-man-mp4-01`,
      order: 0,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-01/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const spec: AssemblySpec = {
      campaignId: "campaign-vo-hash-fail",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      voiceover: {
        assetId: "vo-corrupted-hash",
        kind: "voiceover",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/vo-corrupt.mp3",
          sha256: "9".repeat(64), // tampered hash
          contentType: "audio/mpeg"
        },
        source: { kind: "local" },
        startMs: 0,
        expectedDurationMs: 5000
      },
      subtitleCues: [],
      videoStems
    };

    await expect(adapter.assemble(spec)).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "AUDIO_HASH_MISMATCH"
      })
    );
  });

  it("negative test: corrupted soundbed SHA-256 throws AUDIO_HASH_MISMATCH and publishes no delivery media", async () => {
    const corruptSb = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "sb-corrupt.mp3"),
      durationSec: 5,
      frequency: 220,
      channels: 2,
      format: "mp3"
    });

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/sb-corrupt.mp3",
      body: corruptSb.bytes,
      contentType: "audio/mpeg",
      checksumSha256: corruptSb.sha256
    });

    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 1).map((stem) => ({
      sceneId: "scene-mp4-01",
      generationManifestId: "gen-man-mp4-01",
      order: 0,
      media: {
        bucket: BUCKETS.REVIEW,
        key: "scenes/scene-mp4-01/candidate.mp4",
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const spec: AssemblySpec = {
      campaignId: "campaign-sb-corrupt-fail",
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      soundbed: {
        assetId: "sb-corrupted-hash",
        kind: "soundbed",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/sb-corrupt.mp3",
          sha256: "8".repeat(64), // tampered hash
          contentType: "audio/mpeg"
        },
        source: { kind: "local" },
        startMs: 0,
        expectedDurationMs: 5000
      },
      subtitleCues: [],
      videoStems
    };

    await expect(adapter.assemble(spec)).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "AUDIO_HASH_MISMATCH"
      })
    );

    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes("campaign-sb-corrupt-fail"));
    expect(deliveryKeys).toEqual([]);
  });

  it("proves semantic execution inputs are reconstructable given only persisted AssemblyManifest and referenced media objects", async () => {
    const campaignId = "campaign-reconstruction-proof";
    const expectedStemHashes = syntheticMp4Stems.map((s) => s.sha256);
    const expectedStemIds = Array.from({ length: 6 }, () => randomUUID());
    const expectedGenerationManifestHashes: string[] = [];

    // Create and persist 6 authoritative GenerationManifest fixtures into object storage using the real AssembleGenerationManifest use case
    const genManifestAssembler = new AssembleGenerationManifest({
      hashBytes: { hashBytes: async (b) => createHash("sha256").update(b).digest("hex") },
      sceneRepository: {
        findById: async (id) =>
          Scene.reconstitute({
            id,
            campaignId: campaignId as CampaignId,
            status: "completed",
            specRevision: 1,
            configuration: {
              prompt: `Cinematic scene ${id}`,
              referenceIds: [],
              engineProfileId: "LTX_25_720P_5S_V1",
              durationMs: 5000
            },
            selectedCandidateId: `cand-${id}` as CandidateId,
            selectedCandidateRevision: 1
          }),
        save: async () => {}
      },
      referenceAssetRepository: {
        listBySceneId: async () => []
      },
      storyboardCandidateRepository: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      }
    });

    for (let i = 0; i < syntheticMp4Stems.length; i++) {
      const stem = syntheticMp4Stems[i]!;
      const manifestId = expectedStemIds[i]! as JobId;
      const sceneId = `scene-mp4-0${i + 1}` as SceneId;
      const { manifestPayload } = await genManifestAssembler.assemble({
        job: {
          jobId: manifestId,
          sceneId,
          jobKind: "production",
          status: "rendering",
          workflowTemplate: "LTX_25_720P_5S_V1",
          injectedPayload: { prompt: `Scene ${sceneId}`, seed: 42 },
          workerId: "render-worker-1",
          leaseToken: null,
          leaseExpiresAt: null,
          retryCount: 0,
          maxRetries: 3,
          errorTrace: null,
          createdAt: new Date("2026-08-29T12:00:00Z"),
          updatedAt: new Date("2026-08-29T12:00:00Z")
        },
        profile: {
          id: "LTX_25_720P_5S_V1",
          engine: "ltx_25",
          runnerProfile: "dynamicvram-offload-v1",
          renderProfileIdentity: { key: "LTX_25_720P_5S_V1", version: 1 },
          source: { kind: "local", license: "docs/prd.md §3.5" },
          baseline: { width: 1280, height: 720, frames: 150, approximateDurationSeconds: 5 }
        },
        provenance: {
          generatedAt: "2026-08-29T12:00:00.000Z",
          workflow: { sha256: "2".repeat(64) },
          models: [
            { key: "checkpoint", category: "checkpoints", sha256: "1".repeat(64), bytes: 1024000 }
          ],
          git: {
            comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
            customNodes: []
          }
        },
        renderResult: {
          status: "succeeded",
          promptId: `prompt-comfy-${manifestId}`,
          outputObjectKeys: [`scenes/${sceneId}/candidate.mp4`],
          durationMs: stem.durationMs,
          profile: {
            profileId: "LTX_25_720P_5S_V1",
            renderProfileKey: "LTX_25_720P_5S_V1",
            renderProfileVersion: 1,
            engine: "ltx_25",
            workflowSha256: "2".repeat(64),
            modelSha256: {},
            runnerProfile: "dynamicvram-offload-v1",
            comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
          },
          preDispatchGpu: {
            totalVramMb: 24576,
            usedVramMb: 4096,
            freeVramMb: 20480,
            reservedVramMb: 4096,
            measuredAt: "2026-08-29T10:04:55.000Z"
          }
        },
        workflow: {
          "1": {
            class_type: "KSampler",
            inputs: {
              seed: 42,
              steps: 8,
              cfg: 1,
              sampler_name: "euler",
              scheduler: "simple",
              denoise: 1
            }
          },
          "3": { class_type: "CLIPTextEncode", inputs: { text: `Cinematic scene ${sceneId}` } },
          "4": { class_type: "CLIPTextEncode", inputs: { text: "low quality, blurry" } }
        },
        mediaObjects: [
          {
            bucket: BUCKETS.REVIEW,
            key: `scenes/${sceneId}/candidate.mp4`,
            body: stem.bytes,
            checksumSha256: stem.sha256,
            contentType: "video/mp4"
          }
        ]
      });

      const payloadJson = JSON.stringify(manifestPayload, null, 2);
      const payloadBytes = Buffer.from(payloadJson, "utf-8");
      const payloadSha = createHash("sha256").update(payloadBytes).digest("hex");
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `generation-manifests/${manifestId}.json`,
        body: payloadBytes,
        contentType: "application/json",
        checksumSha256: payloadSha
      });
      expectedGenerationManifestHashes.push(payloadSha);
    }

    const generationManifestRepository = new StorageBackedGenerationManifestRepository(
      objectStorage
    );

    // Isolated writer phase: creates inputs, executes assembly, and returns ONLY immutable expectations
    interface ColdReconstructionExpectations {
      readonly manifestLocator: { readonly bucket: string; readonly key: string };
      readonly campaignId: string;
      readonly expectedStemIds: readonly string[];
      readonly expectedStemHashes: readonly string[];
      readonly expectedGenerationManifestHashes: readonly string[];
      readonly expectedVoHash: string;
      readonly expectedVoStartMs: number;
      readonly expectedVoDurationMs: number;
      readonly expectedSbHash: string;
      readonly expectedTotalDurationMs: number;
      readonly expectedSubtitleCues: readonly {
        readonly startMs: number;
        readonly endMs: number;
        readonly text: string;
      }[];
      readonly expectedSubtitleCuesSha256: string;
    }

    async function executeWriterPhase(): Promise<ColdReconstructionExpectations> {
      const syntheticVo = await generateSyntheticAudio({
        ffmpegPath: "ffmpeg",
        outputPath: path.join(fixtureDir, "audio", "vo-recon.mp3"),
        durationSec: 15,
        frequency: 440,
        channels: 1,
        format: "mp3"
      });
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: "audio/vo-recon.mp3",
        body: syntheticVo.bytes,
        contentType: "audio/mpeg",
        checksumSha256: syntheticVo.sha256
      });

      const syntheticSb = await generateSyntheticAudio({
        ffmpegPath: "ffmpeg",
        outputPath: path.join(fixtureDir, "audio", "sb-recon.mp3"),
        durationSec: 9.5,
        frequency: 220,
        channels: 2,
        format: "mp3"
      });
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: "audio/sb-recon.mp3",
        body: syntheticSb.bytes,
        contentType: "audio/mpeg",
        checksumSha256: syntheticSb.sha256
      });

      const videoStems: VideoStemRef[] = syntheticMp4Stems.map((stem) => ({
        sceneId: `scene-mp4-0${stem.index + 1}`,
        generationManifestId: expectedStemIds[stem.index]!,
        order: stem.index,
        media: {
          bucket: BUCKETS.REVIEW,
          key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
          sha256: stem.sha256,
          contentType: "video/mp4"
        },
        expectedDurationMs: stem.durationMs
      }));

      const subtitleCues = [
        { startMs: 2500, endMs: 7000, text: "First subtitle line with {safe} text" },
        { startMs: 8000, endMs: 14000, text: "Second subtitle dialogue line" }
      ];

      const spec: AssemblySpec = {
        campaignId,
        assemblyProfile: {
          key: "VERTICAL_REEL_1080X1920_V1",
          version: 1
        },
        expectedTotalDurationMs: 30000,
        voiceover: {
          assetId: "vo-recon-001",
          kind: "voiceover",
          media: {
            bucket: BUCKETS.REVIEW,
            key: "audio/vo-recon.mp3",
            sha256: syntheticVo.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "provider", providerId: "azure-tts" },
          startMs: 2000,
          expectedDurationMs: 15000
        },
        soundbed: {
          assetId: "sb-recon-001",
          kind: "soundbed",
          media: {
            bucket: BUCKETS.REVIEW,
            key: "audio/sb-recon.mp3",
            sha256: syntheticSb.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 0,
          expectedDurationMs: 30000
        },
        subtitleCues,
        videoStems
      };

      const snapshot = buildApprovedAcceptanceRegistrySnapshot(
        realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
      );
      const enforceLicenseRouting = new EnforceLicenseRouting({
        registry: { getSnapshot: () => snapshot }
      });

      const deliveryReelUseCase = new AssembleDeliveryReel({
        runtimeComponents: await adapter.getRuntimeComponents(),
        mediaAssembler: adapter,
        objectStorage,
        enforceLicenseRouting,
        generationManifestRepository
      });

      const targetAssemblyId = computeAssemblyId(spec);
      await deliveryReelUseCase.assemble({ spec });

      return {
        manifestLocator: {
          bucket: BUCKETS.DELIVERY,
          key: `campaigns/${campaignId}/assemblies/${targetAssemblyId}/manifest.json`
        },
        campaignId,
        expectedStemIds,
        expectedStemHashes,
        expectedGenerationManifestHashes,
        expectedVoHash: syntheticVo.sha256,
        expectedVoStartMs: 2000,
        expectedVoDurationMs: 28000,
        expectedSbHash: syntheticSb.sha256,
        expectedTotalDurationMs: 30000,
        expectedSubtitleCues: subtitleCues,
        expectedSubtitleCuesSha256: hashSubtitleCues(subtitleCues)
      };
    }

    async function verifyColdReconstructionReader(
      storage: ObjectStoragePort,
      exp: ColdReconstructionExpectations
    ): Promise<void> {
      // Reader phase: reads strictly cold JSON from object storage without in-scope execution or spec references
      const storedManifestObj = await storage.getObject(exp.manifestLocator);
      expect(storedManifestObj).toBeDefined();

      const reconstructed = AssemblyManifestSchema.parse(
        JSON.parse(new TextDecoder().decode(storedManifestObj!.body))
      );

      // 1. Validate ordered stem identities and hashes against persisted GenerationManifest objects and media
      expect(reconstructed.inputs.videoStems).toHaveLength(6);
      expect(reconstructed.generationManifestIds).toEqual(exp.expectedStemIds);

      for (let i = 0; i < 6; i++) {
        const stemInput = reconstructed.inputs.videoStems[i]!;
        expect(stemInput.generationManifestId).toBe(exp.expectedStemIds[i]);
        expect(stemInput.order).toBe(i);
        expect(stemInput.media.sha256).toBe(exp.expectedStemHashes[i]);

        // Read persisted GenerationManifest object from storage and assert contents match
        const genManifestObj = await storage.getObject({
          bucket: BUCKETS.REVIEW,
          key: `generation-manifests/${stemInput.generationManifestId}.json`
        });
        expect(genManifestObj).toBeDefined();
        expect(createHash("sha256").update(genManifestObj!.body).digest("hex")).toBe(
          exp.expectedGenerationManifestHashes[i]
        );
        const genManifestPayload = JSON.parse(new TextDecoder().decode(genManifestObj!.body));
        expect(genManifestPayload.manifestId).toBe(stemInput.generationManifestId);
        expect(genManifestPayload.renderProfile).toBe("LTX_25_720P_5S_V1");
        expect(genManifestPayload.renderProfileVersion).toBe(1);
        expect(genManifestPayload.outputs[0].checksumSha256).toBe(exp.expectedStemHashes[i]);

        // Read referenced video stem media object from storage and verify SHA-256
        const stemStorageObj = await storage.getObject({
          bucket: stemInput.media.bucket,
          key: stemInput.media.key
        });
        expect(stemStorageObj).toBeDefined();
        expect(createHash("sha256").update(stemStorageObj!.body).digest("hex")).toBe(
          exp.expectedStemHashes[i]
        );
      }

      // 2. Assembly profile and layout mode
      expect(reconstructed.assemblyProfile).toEqual({
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      });
      expect(reconstructed.layout.mode).toBe("fit_blurred_fill");

      // 3. Voiceover & soundbed identities/hashes and timing
      expect(reconstructed.inputs.voiceover).toBeDefined();
      expect(reconstructed.inputs.voiceover?.media.sha256).toBe(exp.expectedVoHash);
      expect(reconstructed.inputs.voiceover?.effectiveStartMs).toBe(exp.expectedVoStartMs);
      expect(reconstructed.inputs.voiceover?.effectiveDurationMs).toBe(exp.expectedVoDurationMs);

      const voStorageObj = await storage.getObject({
        bucket: reconstructed.inputs.voiceover!.media.bucket,
        key: reconstructed.inputs.voiceover!.media.key
      });
      expect(voStorageObj).toBeDefined();
      expect(createHash("sha256").update(voStorageObj!.body).digest("hex")).toBe(
        exp.expectedVoHash
      );

      expect(reconstructed.inputs.soundbed).toBeDefined();
      expect(reconstructed.inputs.soundbed?.media.sha256).toBe(exp.expectedSbHash);
      expect(reconstructed.inputs.soundbed?.effectiveDurationMs).toBe(exp.expectedTotalDurationMs);
      expect(reconstructed.inputs.soundbed?.loopCount).toBeGreaterThan(0);

      const sbStorageObj = await storage.getObject({
        bucket: reconstructed.inputs.soundbed!.media.bucket,
        key: reconstructed.inputs.soundbed!.media.key
      });
      expect(sbStorageObj).toBeDefined();
      expect(createHash("sha256").update(sbStorageObj!.body).digest("hex")).toBe(
        exp.expectedSbHash
      );

      // 4. Subtitle cue payload hash and style identity
      expect(reconstructed.subtitleStyleProfile).toBe("VERTICAL_REEL_CENTER_V1");
      expect(reconstructed.subtitleCuesSha256).toBe(exp.expectedSubtitleCuesSha256);
      expect(reconstructed.subtitleCues).toEqual(exp.expectedSubtitleCues);

      // 5. FFmpeg runtime identity and command/filter fingerprint
      expect(reconstructed.ffmpeg.executable).toBe("ffmpeg");
      expect(reconstructed.ffmpeg.version.length).toBeGreaterThan(0);
      expect(reconstructed.ffmpeg.buildInfo.length).toBeGreaterThan(0);
      expect(reconstructed.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);

      // 6. Governance decision provenance
      expect(reconstructed.governanceDecisionId).toMatch(/^gov-dec-/);

      // 7. Final output identity and hash
      expect(reconstructed.output.media.bucket).toBe(BUCKETS.DELIVERY);
      expect(reconstructed.output.media.key).toBe(
        `campaigns/${exp.campaignId}/assemblies/${reconstructed.assemblyId}/output.mp4`
      );
      expect(reconstructed.output.media.sha256).toMatch(/^[0-9a-f]{64}$/);

      const deliveryOutput = await storage.getObject({
        bucket: reconstructed.output.media.bucket,
        key: reconstructed.output.media.key
      });
      expect(deliveryOutput).toBeDefined();
      const computedOutputSha = createHash("sha256").update(deliveryOutput!.body).digest("hex");
      expect(computedOutputSha).toBe(reconstructed.output.media.sha256);
      expect(deliveryOutput?.checksumSha256).toBe(reconstructed.output.media.sha256);
    }

    const expectations = await executeWriterPhase();
    await verifyColdReconstructionReader(objectStorage, expectations);
  }, 300_000);

  it("negative test: missing or unresolvable GenerationManifest in storage halts assembly closed before FFmpeg dispatch", async () => {
    const campaignId = "campaign-missing-gen-manifest-test";
    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-mp4-01",
          generationManifestId: "gen-man-does-not-exist-in-storage",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: "scenes/scene-mp4-01/candidate.mp4",
            sha256: syntheticMp4Stems[0]!.sha256,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    let spawnCount = 0;
    const countingSpawn: SpawnLikeFn = async (cmd, args, opts) => {
      spawnCount++;
      return defaultSpawnRunner(cmd, args, opts);
    };

    const monitoredAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: countingSpawn
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const storageBackedGenManifestRepo = new StorageBackedGenerationManifestRepository(
      objectStorage
    );

    const runtimeComponents = await monitoredAdapter.getRuntimeComponents();
    spawnCount = 0; // reset probe count

    const useCase = new AssembleDeliveryReel({
      runtimeComponents,
      mediaAssembler: monitoredAdapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: storageBackedGenManifestRepo
    });

    await expect(useCase.assemble({ spec })).rejects.toThrow();
    expect(spawnCount).toBe(0);

    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}`));
    expect(deliveryKeys).toEqual([]);
  });

  it("negative test: input probe failure through AssembleDeliveryReel publishes no AssemblyManifest", async () => {
    const campaignId = "campaign-exec-failure-no-manifest";
    const corruptKey = "scenes/scene-corrupt-mp4/candidate.mp4";
    const corruptBytes = Buffer.from("NOT_A_VALID_MP4_VIDEO_FILE");
    const corruptSha = createHash("sha256").update(corruptBytes).digest("hex");

    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: corruptKey,
      body: corruptBytes,
      contentType: "video/mp4",
      checksumSha256: corruptSha
    });

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-corrupt-01",
          generationManifestId: "gen-man-corrupt-01",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: corruptKey,
            sha256: corruptSha,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: await adapter.getRuntimeComponents(),
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    await expect(useCase.assemble({ spec })).rejects.toThrow();

    const manifests = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(manifests).toEqual([]);
  });

  it("negative test: FFmpeg process failure through AssembleDeliveryReel publishes no AssemblyManifest", async () => {
    const campaignId = "campaign-ffmpeg-proc-failure-no-manifest";
    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-mp4-01",
          generationManifestId: "gen-man-mp4-01",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: "scenes/scene-mp4-01/candidate.mp4",
            sha256: syntheticMp4Stems[0]!.sha256,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    const failingSpawn: SpawnLikeFn = async (cmd, args, opts) => {
      if (cmd === "ffmpeg" && args.some((a) => a.includes("filter_complex"))) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Simulated ffmpeg process failure during encode"
        };
      }
      return defaultSpawnRunner(cmd, args, opts);
    };

    const failingAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: failingSpawn
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: await adapter.getRuntimeComponents(),
      mediaAssembler: failingAdapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    await expect(useCase.assemble({ spec })).rejects.toThrow();

    const manifests = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(manifests).toEqual([]);
  });

  it("negative test: final ffprobe contract mismatch through AssembleDeliveryReel publishes no AssemblyManifest and fails with OUTPUT_VALIDATION_FAILED", async () => {
    const campaignId = "campaign-output-probe-mismatch";
    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-mp4-01",
          generationManifestId: "gen-man-mp4-01",
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: "scenes/scene-mp4-01/candidate.mp4",
            sha256: syntheticMp4Stems[0]!.sha256,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    // Intercept the final ffprobe run on output.mp4 to report a width mismatch (1920 instead of 1080)
    const mismatchedProbeSpawn: SpawnLikeFn = async (cmd, args, opts) => {
      const res = await defaultSpawnRunner(cmd, args, opts);
      if (cmd === "ffprobe" && args.some((a) => a.includes("output.mp4"))) {
        const parsed = JSON.parse(res.stdout);
        if (parsed.streams?.[0]) {
          parsed.streams[0].width = 1920; // Violates VERTICAL_REEL_1080X1920_V1 profile width 1080
        }
        return { exitCode: 0, stdout: JSON.stringify(parsed), stderr: res.stderr };
      }
      return res;
    };

    const mismatchAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: mismatchedProbeSpawn
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: await adapter.getRuntimeComponents(),
      mediaAssembler: mismatchAdapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    let thrownError: unknown;
    try {
      await useCase.assemble({ spec });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(FfmpegAssemblyError);
    expect((thrownError as FfmpegAssemblyError).code).toBe("OUTPUT_VALIDATION_FAILED");

    const manifests = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}/assemblies/`));
    expect(manifests).toEqual([]);
  });

  it("idempotent rerun with identical spec converges on same identity, preserves original manifest, and short-circuits with zero FFmpeg spawns", async () => {
    const campaignId = "campaign-idempotent-rerun";
    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-mp4-0${idx + 1}`,
      generationManifestId: `gen-man-mp4-0${idx + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${idx + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 10000,
      subtitleCues: [],
      videoStems
    };

    let spawnCount = 0;
    const countingSpawn: SpawnLikeFn = async (cmd, args, opts) => {
      spawnCount++;
      return defaultSpawnRunner(cmd, args, opts);
    };

    const monitoredAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: countingSpawn
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const runtimeComponents = await monitoredAdapter.getRuntimeComponents();
    spawnCount = 0; // reset probe count

    const useCase = new AssembleDeliveryReel({
      runtimeComponents,
      mediaAssembler: monitoredAdapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    const firstRun = await useCase.assemble({ spec });
    const firstRunSpawns = spawnCount;
    expect(firstRunSpawns).toBeGreaterThan(0);

    spawnCount = 0;
    const secondRun = await useCase.assemble({ spec });

    expect(spawnCount).toBe(0); // Early existence check short-circuits with zero FFmpeg spawns
    expect(firstRun.executionResult.assemblyId).toBe(secondRun.executionResult.assemblyId);
    expect(firstRun.manifest.assemblyId).toBe(secondRun.manifest.assemblyId);
    expect(firstRun.manifest.createdAt).toBe(secondRun.manifest.createdAt);
    expect(firstRun.manifest.governanceDecisionId).toBe(secondRun.manifest.governanceDecisionId);
    expect(firstRun.manifest.output.media.sha256).toBe(secondRun.manifest.output.media.sha256);
    expect(firstRun.manifest.generationManifestIds).toEqual(
      secondRun.manifest.generationManifestIds
    );
    expect(firstRun.manifest.commandFingerprint).toBe(secondRun.manifest.commandFingerprint);

    const storedManifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${firstRun.manifest.assemblyId}/manifest.json`
    });
    expect(storedManifestObj).toBeDefined();
    const parsed = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(storedManifestObj?.body))
    );
    expect(parsed.createdAt).toBe(firstRun.manifest.createdAt);
    expect(parsed.governanceDecisionId).toBe(firstRun.manifest.governanceDecisionId);
  }, 300_000);

  it("conflicting rerun with same assembly identity but altered spec raises AssemblyProvenanceConflictError with zero overwrite", async () => {
    const campaignId = "campaign-conflict-provenance-test";
    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-mp4-0${idx + 1}`,
      generationManifestId: `gen-man-mp4-0${idx + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${idx + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const specA: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 10000,
      subtitleCues: [],
      videoStems
    };

    const fixedConflictId = "fixed-conflict-assembly-id-001";
    const fixedAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      createAssemblyId: () => fixedConflictId
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const useCase = new AssembleDeliveryReel({
      runtimeComponents: await fixedAdapter.getRuntimeComponents(),
      mediaAssembler: fixedAdapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    const runA = await useCase.assemble({ spec: specA });
    expect(runA.manifest.assemblyId).toBe(fixedConflictId);

    // Create specB with altered stem order (violates semantic equivalence of the same identity)
    const specB: AssemblySpec = {
      ...specA,
      videoStems: [
        { ...specA.videoStems[1]!, order: 0 },
        { ...specA.videoStems[0]!, order: 1 }
      ]
    };

    let conflictError: unknown;
    try {
      await useCase.assemble({ spec: specB });
    } catch (err) {
      conflictError = err;
    }

    expect(conflictError).toBeInstanceOf(AssemblyProvenanceConflictError);
    expect((conflictError as AssemblyProvenanceConflictError).assemblyId).toBe(fixedConflictId);

    // Stored manifest must remain runA's original manifest with zero overwrite
    const storedManifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${fixedConflictId}/manifest.json`
    });
    expect(storedManifestObj).toBeDefined();
    const parsed = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(storedManifestObj?.body))
    );
    expect(parsed.inputs.videoStems[0]!.sceneId).toBe("scene-mp4-01");
    expect(parsed.createdAt).toBe(runA.manifest.createdAt);
  }, 300_000);

  it("conflicting rerun with same assembly identity but altered governance decision raises AssemblyProvenanceConflictError with zero overwrite", async () => {
    const campaignId = "campaign-conflict-governance-test";
    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-mp4-0${idx + 1}`,
      generationManifestId: `gen-man-mp4-0${idx + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${idx + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 10000,
      subtitleCues: [],
      videoStems
    };

    const fixedConflictId = "fixed-conflict-gov-id-001";
    const fixedAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      createAssemblyId: () => fixedConflictId
    });

    const snapshotA = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const useCaseA = new AssembleDeliveryReel({
      runtimeComponents: await fixedAdapter.getRuntimeComponents(),
      mediaAssembler: fixedAdapter,
      objectStorage,
      enforceLicenseRouting: new EnforceLicenseRouting({
        registry: { getSnapshot: () => snapshotA }
      }),
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    const runA = await useCaseA.assemble({ spec });
    expect(runA.manifest.assemblyId).toBe(fixedConflictId);

    // Run B under an altered registry revision
    const snapshotB = withRegistryRevision(snapshotA, "2026-08-30.acceptance-2");
    const useCaseB = new AssembleDeliveryReel({
      runtimeComponents: await fixedAdapter.getRuntimeComponents(),
      mediaAssembler: fixedAdapter,
      objectStorage,
      enforceLicenseRouting: new EnforceLicenseRouting({
        registry: { getSnapshot: () => snapshotB }
      }),
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    await expect(useCaseB.assemble({ spec })).rejects.toThrow(AssemblyProvenanceConflictError);

    const storedManifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${fixedConflictId}/manifest.json`
    });
    expect(storedManifestObj).toBeDefined();
    const parsed = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(storedManifestObj?.body))
    );
    expect(parsed.governanceDecisionId).toBe(runA.manifest.governanceDecisionId);
    expect(parsed.createdAt).toBe(runA.manifest.createdAt);
  }, 300_000);

  it("conflicting rerun with same assembly identity but altered runtime build raises AssemblyProvenanceConflictError with zero overwrite", async () => {
    const campaignId = "campaign-conflict-runtime-test";
    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-mp4-0${idx + 1}`,
      generationManifestId: `gen-man-mp4-0${idx + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${idx + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 10000,
      subtitleCues: [],
      videoStems
    };

    const fixedConflictId = "fixed-conflict-runtime-id-001";
    const fixedAdapterA = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      createAssemblyId: () => fixedConflictId
    });

    const runtimeComponentsA = await fixedAdapterA.getRuntimeComponents();
    const realFfmpegVersion = runtimeComponentsA.find(
      (c) => c.componentId === "ffmpeg"
    )?.versionOrRevision;
    const snapshotA = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const useCaseA = new AssembleDeliveryReel({
      runtimeComponents: runtimeComponentsA,
      mediaAssembler: fixedAdapterA,
      objectStorage,
      enforceLicenseRouting: new EnforceLicenseRouting({
        registry: { getSnapshot: () => snapshotA }
      }),
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    const runA = await useCaseA.assemble({ spec });
    expect(runA.manifest.assemblyId).toBe(fixedConflictId);

    // Adapter B with altered version output
    const alteredSpawn: SpawnLikeFn = async (cmd, args, opts) => {
      if (cmd === "ffmpeg" && args.length === 1 && args[0] === "-version") {
        return {
          exitCode: 0,
          stdout: "ffmpeg version 7.1-updated-build Copyright (c) 2000-2024 the FFmpeg developers",
          stderr: ""
        };
      }
      return defaultSpawnRunner(cmd, args, opts);
    };

    const fixedAdapterB = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: alteredSpawn,
      createAssemblyId: () => fixedConflictId
    });

    const snapshotB = buildApprovedAcceptanceRegistrySnapshot({
      ffmpegVersion: "7.1-updated-build"
    });
    const useCaseB = new AssembleDeliveryReel({
      runtimeComponents: await fixedAdapterB.getRuntimeComponents(),
      mediaAssembler: fixedAdapterB,
      objectStorage,
      enforceLicenseRouting: new EnforceLicenseRouting({
        registry: { getSnapshot: () => snapshotB }
      }),
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    await expect(useCaseB.assemble({ spec })).rejects.toThrow(AssemblyProvenanceConflictError);

    const storedManifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${fixedConflictId}/manifest.json`
    });
    expect(storedManifestObj).toBeDefined();
    const parsed = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(storedManifestObj?.body))
    );
    expect(parsed.ffmpeg.version).toBe(runA.manifest.ffmpeg.version);
    expect(parsed.createdAt).toBe(runA.manifest.createdAt);
  }, 300_000);

  it("conflicting rerun with same assembly identity but altered audio timing raises AssemblyProvenanceConflictError with zero overwrite", async () => {
    const campaignId = "campaign-conflict-audio-timing-test";
    const syntheticVo = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "vo-conflict-timing.mp3"),
      durationSec: 5,
      frequency: 440,
      channels: 1,
      format: "mp3"
    });
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/vo-conflict-timing.mp3",
      body: syntheticVo.bytes,
      contentType: "audio/mpeg",
      checksumSha256: syntheticVo.sha256
    });

    const videoStems: VideoStemRef[] = syntheticMp4Stems.slice(0, 2).map((stem, idx) => ({
      sceneId: `scene-mp4-0${idx + 1}`,
      generationManifestId: `gen-man-mp4-0${idx + 1}`,
      order: idx,
      media: {
        bucket: BUCKETS.REVIEW,
        key: `scenes/scene-mp4-0${idx + 1}/candidate.mp4`,
        sha256: stem.sha256,
        contentType: "video/mp4"
      },
      expectedDurationMs: 5000
    }));

    const specA: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 10000,
      voiceover: {
        assetId: "vo-conflict-timing-001",
        kind: "voiceover",
        media: {
          bucket: BUCKETS.REVIEW,
          key: "audio/vo-conflict-timing.mp3",
          sha256: syntheticVo.sha256,
          contentType: "audio/mpeg"
        },
        source: { kind: "provider", providerId: "azure-tts" },
        startMs: 1000,
        expectedDurationMs: 5000
      },
      subtitleCues: [],
      videoStems
    };

    const fixedConflictId = "fixed-conflict-audio-timing-id-001";
    const fixedAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      createAssemblyId: () => fixedConflictId
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const useCase = new AssembleDeliveryReel({
      runtimeComponents: await fixedAdapter.getRuntimeComponents(),
      mediaAssembler: fixedAdapter,
      objectStorage,
      enforceLicenseRouting: new EnforceLicenseRouting({
        registry: { getSnapshot: () => snapshot }
      }),
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "LTX_25_720P_5S_V1",
          renderProfileVersion: 1
        })
      }
    });

    const runA = await useCase.assemble({ spec: specA });
    expect(runA.manifest.assemblyId).toBe(fixedConflictId);

    // Spec B has altered voiceover startMs (2000ms instead of 1000ms)
    const specB: AssemblySpec = {
      ...specA,
      voiceover: {
        ...specA.voiceover!,
        startMs: 2000
      }
    };

    await expect(useCase.assemble({ spec: specB })).rejects.toThrow(
      AssemblyProvenanceConflictError
    );

    const storedManifestObj = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: `campaigns/${campaignId}/assemblies/${fixedConflictId}/manifest.json`
    });
    expect(storedManifestObj).toBeDefined();
    const parsed = AssemblyManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(storedManifestObj?.body))
    );
    expect(parsed.inputs.voiceover?.effectiveStartMs).toBe(1000);
    expect(parsed.createdAt).toBe(runA.manifest.createdAt);
  }, 300_000);

  it("rejects with ASSEMBLY_PROVENANCE_CONFLICT when existing delivery output in storage lacks checksumSha256 metadata and has tampered bytes", async () => {
    const campaignId = "campaign-existing-tampered-bytes-no-metadata";
    const fixedAssemblyId = "fixed-tampered-output-id-001";
    const deliveryKey = `campaigns/${campaignId}/assemblies/${fixedAssemblyId}/output.mp4`;

    // Seed existing delivery object with tampered bytes and NO checksumSha256 metadata
    await objectStorage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: deliveryKey,
      body: Buffer.from("corrupted or tampered mp4 video stream bytes that do not match encode"),
      contentType: "video/mp4"
      // checksumSha256 intentionally omitted
    });

    const fixedAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      createAssemblyId: () => fixedAssemblyId
    });

    const videoStems: VideoStemRef[] = [
      {
        sceneId: "scene-mp4-01",
        generationManifestId: "gen-man-01",
        order: 0,
        media: {
          bucket: BUCKETS.REVIEW,
          key: `scenes/scene-mp4-01/candidate.mp4`,
          sha256: syntheticMp4Stems[0]!.sha256,
          contentType: "video/mp4"
        },
        expectedDurationMs: 5000
      }
    ];

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems
    };

    const err = await fixedAdapter.assemble(spec).catch((e) => e);
    expect(err).toBeInstanceOf(FfmpegAssemblyError);
    expect((err as FfmpegAssemblyError).code).toBe("ASSEMBLY_PROVENANCE_CONFLICT");
    expect((err as FfmpegAssemblyError).message).toContain(
      "already exists with conflicting checksum"
    );

    // Existing object was NOT overwritten
    const retrieved = await objectStorage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: deliveryKey
    });
    expect(retrieved).toBeDefined();
    expect(Buffer.from(retrieved!.body).toString("utf-8")).toBe(
      "corrupted or tampered mp4 video stream bytes that do not match encode"
    );
  }, 300_000);

  it("negative test: inconsistent GenerationManifest in storage (output hash mismatch) halts assembly closed before FFmpeg dispatch", async () => {
    const campaignId = "campaign-inconsistent-gen-manifest-test";
    const manifestId = "gen-man-inconsistent-01";
    const realStemSha = syntheticMp4Stems[0]!.sha256;
    const differentManifestSha = "f".repeat(64);

    const payload = buildSyntheticGenerationManifestPayload({
      manifestId,
      campaignId,
      sceneId: "scene-mp4-01",
      stemSha256: differentManifestSha // Does NOT match stem media sha256
    });

    const payloadBytes = Buffer.from(JSON.stringify(payload, null, 2), "utf-8");
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: `generation-manifests/${manifestId}.json`,
      body: payloadBytes,
      contentType: "application/json",
      checksumSha256: createHash("sha256").update(payloadBytes).digest("hex")
    });

    const spec: AssemblySpec = {
      campaignId,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 1
      },
      expectedTotalDurationMs: 5000,
      subtitleCues: [],
      videoStems: [
        {
          sceneId: "scene-mp4-01",
          generationManifestId: manifestId,
          order: 0,
          media: {
            bucket: BUCKETS.REVIEW,
            key: "scenes/scene-mp4-01/candidate.mp4",
            sha256: realStemSha,
            contentType: "video/mp4"
          },
          expectedDurationMs: 5000
        }
      ]
    };

    let spawnCount = 0;
    const countingSpawn: SpawnLikeFn = async (cmd, args, opts) => {
      spawnCount++;
      return defaultSpawnRunner(cmd, args, opts);
    };

    const monitoredAdapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage,
      spawnFn: countingSpawn
    });

    const snapshot = buildApprovedAcceptanceRegistrySnapshot(
      realFfmpegVersion ? { ffmpegVersion: realFfmpegVersion } : undefined
    );
    const enforceLicenseRouting = new EnforceLicenseRouting({
      registry: { getSnapshot: () => snapshot }
    });

    const storageBackedGenManifestRepo = new StorageBackedGenerationManifestRepository(
      objectStorage
    );

    const runtimeComponents = await monitoredAdapter.getRuntimeComponents();
    spawnCount = 0; // reset probe count

    const useCase = new AssembleDeliveryReel({
      runtimeComponents,
      mediaAssembler: monitoredAdapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: storageBackedGenManifestRepo
    });

    await expect(useCase.assemble({ spec })).rejects.toThrow();
    expect(spawnCount).toBe(0);

    const deliveryKeys = objectStorage
      .getAllKeys()
      .filter((k) => k.includes(`campaigns/${campaignId}`));
    expect(deliveryKeys).toEqual([]);
  });
});
