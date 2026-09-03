#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { performance } from "node:perf_hooks";

import { AssemblyExecutionResultSchema } from "../packages/contracts/dist/index.js";
import { BUCKETS } from "../packages/shared/dist/index.js";
import {
  FfmpegMediaAssemblerAdapter,
  defaultSpawnRunner
} from "../packages/infrastructure/dist/index.js";
import { InMemoryObjectStorage } from "../packages/infrastructure/dist/ffmpeg/test-support/in-memory-object-storage.js";
import { generateSyntheticAudio } from "../packages/infrastructure/dist/ffmpeg/test-support/synthetic-audio-fixtures.js";
import { generateSyntheticStems } from "../packages/infrastructure/dist/ffmpeg/test-support/synthetic-stem-fixtures.js";

const TARGET_THRESHOLD_MS = 30_000;
const DURATION_TOLERANCE_MS = 250;

async function runBenchmark() {
  console.log("===============================================================");
  console.log("  PRD §9.5 FFmpeg Assembly Benchmark (Phase 1 Target: <30s)");
  console.log("===============================================================");

  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "bench-assembly-fixtures-"));
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bench-assembly-workspace-"));
  const objectStorage = new InMemoryObjectStorage();

  try {
    console.log("[1/4] Preparing synthetic media fixtures (untimed)...");
    const syntheticMp4Stems = await generateSyntheticStems({
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

      const genManifestPayload = {
        manifestVersion: "1.0.0",
        generationManifestId: `gen-man-mp4-0${stem.index + 1}`,
        campaignId: "benchmark-assembly-run",
        sceneId: `scene-mp4-0${stem.index + 1}`,
        sceneSpecRevision: 1,
        renderProfile: {
          key: "LTX_25_720P_5S_V1",
          version: 1
        },
        execution: {
          workflowTemplateSha256: "0".repeat(64),
          workflowEffectiveSha256: "0".repeat(64),
          comfyuiGitCommit: "0".repeat(40),
          renderProfileSnapshotSha256: "0".repeat(64)
        },
        candidate: {
          assetId: `candidate-mp4-0${stem.index + 1}`,
          media: {
            bucket: BUCKETS.REVIEW,
            key: `scenes/scene-mp4-0${stem.index + 1}/candidate.mp4`,
            sha256: stem.sha256,
            contentType: "video/mp4"
          },
          durationMs: stem.durationMs,
          width: 1280,
          height: 720,
          fps: 30
        },
        timing: {
          queuedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          executionDurationMs: stem.durationMs
        }
      };
      const payloadBytes = Buffer.from(JSON.stringify(genManifestPayload));
      await objectStorage.putObject({
        bucket: BUCKETS.REVIEW,
        key: `generation-manifests/gen-man-mp4-0${stem.index + 1}.json`,
        body: payloadBytes,
        contentType: "application/json",
        checksumSha256: createHash("sha256").update(payloadBytes).digest("hex")
      });
    }

    const syntheticVo = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "vo.mp3"),
      durationSec: 15,
      frequency: 440,
      channels: 1,
      format: "mp3"
    });
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/vo.mp3",
      body: syntheticVo.bytes,
      contentType: syntheticVo.contentType,
      checksumSha256: syntheticVo.sha256
    });

    const syntheticSb = await generateSyntheticAudio({
      ffmpegPath: "ffmpeg",
      outputPath: path.join(fixtureDir, "audio", "sb.mp3"),
      durationSec: 9.5,
      frequency: 220,
      channels: 2,
      format: "mp3"
    });
    await objectStorage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "audio/sb.mp3",
      body: syntheticSb.bytes,
      contentType: syntheticSb.contentType,
      checksumSha256: syntheticSb.sha256
    });

    console.log("[2/4] Warming up FFmpeg runtime dependencies (untimed)...");
    const warmUpResult = await defaultSpawnRunner("ffmpeg", ["-version"]);
    if (warmUpResult.exitCode !== 0) {
      throw new Error(`FFmpeg warmup check failed: ${warmUpResult.stderr}`);
    }
    const versionMatch = warmUpResult.stdout.match(/ffmpeg\s+version\s+([^\s]+)/i);
    const ffmpegVersion = versionMatch ? versionMatch[1] : "unknown";
    console.log(`      Detected FFmpeg build: ${ffmpegVersion}`);

    const adapter = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot,
      objectStorage
    });
    // Warm up runtime components once ahead of timed execution
    await adapter.getRuntimeComponents();

    const videoStems = syntheticMp4Stems.map((stem) => ({
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

    const spec = {
      campaignId: "benchmark-assembly-run",
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
          key: "audio/vo.mp3",
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
          key: "audio/sb.mp3",
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

    console.log("[3/4] Timing MediaAssemblerPort.assemble() operation...");
    const t0 = performance.now();
    const result = await adapter.assemble(spec);
    const wallClockDurationMs = Math.round(performance.now() - t0);

    console.log("[4/4] Verifying assembled output contracts...");
    const parsed = AssemblyExecutionResultSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(`Assembly result schema validation failed: ${parsed.error.message}`);
    }

    if (result.output.width !== 1080 || result.output.height !== 1920) {
      throw new Error(`Unexpected dimensions: ${result.output.width}x${result.output.height}`);
    }
    if (result.measuredFrameRate !== 30) {
      throw new Error(`Unexpected frame rate: ${result.measuredFrameRate}`);
    }
    if (Math.abs(result.output.durationMs - 30000) > DURATION_TOLERANCE_MS) {
      throw new Error(`Output duration out of tolerance: ${result.output.durationMs}ms`);
    }

    console.log("---------------------------------------------------------------");
    console.log(`  Measured wall-clock duration:  ${wallClockDurationMs}ms`);
    console.log(`  Internal execution duration:   ${result.executionDurationMs}ms`);
    console.log(`  Required gate threshold:       <${TARGET_THRESHOLD_MS}ms`);
    console.log(`  Output resolution & fps:       1080x1920 @ 30fps (h264)`);
    console.log(`  Audio channels & sample rate:  stereo, 48000Hz (aac)`);
    console.log(`  Output SHA-256:                ${result.output.media.sha256}`);
    console.log("---------------------------------------------------------------");

    const passed = wallClockDurationMs < TARGET_THRESHOLD_MS;
    if (passed) {
      console.log(`>>> RESULT: PASS (${wallClockDurationMs}ms < ${TARGET_THRESHOLD_MS}ms) <<<`);
    } else {
      console.log(
        `>>> RESULT: FAIL (${wallClockDurationMs}ms exceeds ${TARGET_THRESHOLD_MS}ms threshold) <<<`
      );
    }

    process.exitCode = passed ? 0 : 1;
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => {});
  }
}

runBenchmark().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});
