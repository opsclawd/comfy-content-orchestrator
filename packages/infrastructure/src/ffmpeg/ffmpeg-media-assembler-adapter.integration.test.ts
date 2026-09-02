import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssembleDeliveryReel, EnforceLicenseRouting } from "@cco/application";
import {
  ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS,
  AssemblyExecutionResultSchema,
  AssemblyManifestSchema,
  type AssemblySpec,
  type VideoStemRef
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import { AUDIO_LIMITER_CEILING_DBTP } from "./audio-mix.js";
import { FfmpegMediaAssemblerAdapter } from "./ffmpeg-media-assembler-adapter.js";
import { InMemoryObjectStorage } from "./test-support/in-memory-object-storage.js";
import { generateSyntheticAudio } from "./test-support/synthetic-audio-fixtures.js";
import {
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

    const licenseRegistry = {
      getSnapshot: () => ({
        schemaVersion: 1 as const,
        registryRevision: "2026-08-29.1",
        generatedAt: "2026-08-29T12:00:00.000Z",
        entries: [
          {
            componentId: "ffmpeg",
            componentType: "runtime" as const,
            versionOrRevision: "n8.0.1",
            status: "approved" as const,
            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          },
          {
            componentId: "azure-tts",
            componentType: "provider" as const,
            versionOrRevision: "1",
            status: "approved" as const,
            licenseSource: "Sprint 3.5 Assembly Integration Test",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          },
          {
            componentId: "ltx-fake-profile",
            componentType: "model" as const,
            versionOrRevision: "1",
            status: "approved" as const,
            licenseSource: "Sprint 3.5 Assembly Integration Test",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          }
        ]
      })
    };
    const enforceLicenseRouting = new EnforceLicenseRouting({ registry: licenseRegistry });

    const deliveryReelUseCase = new AssembleDeliveryReel({
      runtimeComponents: [],
      mediaAssembler: adapter,
      objectStorage,
      enforceLicenseRouting,
      generationManifestRepository: {
        getComponentIdentityById: async () => ({
          renderProfile: "ltx-fake-profile",
          renderProfileVersion: 1
        })
      }
    });

    const { manifest, executionResult } = await deliveryReelUseCase.assemble({
      spec,
      requiredComponents: [
        {
          componentId: "ffmpeg",
          componentType: "runtime",
          versionOrRevision: "n8.0.1"
        }
      ]
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
});
