import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AssemblyExecutionResultSchema,
  type AssemblySpec,
  type VideoStemRef
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import { FfmpegMediaAssemblerAdapter } from "./ffmpeg-media-assembler-adapter.js";
import { InMemoryObjectStorage } from "./test-support/in-memory-object-storage.js";
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
  }, 120_000);

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
  }, 90_000);

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

    // Verify timeline durations within tolerance
    expect(result.timeline.totalDurationMs).toBe(totalExpectedDurationMs);
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
  }, 90_000);

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
  }, 60_000);

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
          generationManifestId: "gen-man-01",
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
});
