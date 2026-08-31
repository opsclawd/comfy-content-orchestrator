import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultSpawnRunner, type SpawnLikeFn } from "../ffmpeg-process-runner.js";

export interface SyntheticStemOptions {
  readonly ffmpegPath?: string | undefined;
  readonly outputDir: string;
  readonly count?: number | undefined;
  readonly durationSec?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly fps?: number | undefined;
  readonly format?: "mp4" | "webp" | undefined;
  readonly spawnFn?: SpawnLikeFn | undefined;
}

export interface SyntheticStemResult {
  readonly index: number;
  readonly filePath: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly contentType: string;
}

export async function generateSyntheticStems(
  options: SyntheticStemOptions
): Promise<SyntheticStemResult[]> {
  const {
    ffmpegPath = "ffmpeg",
    outputDir,
    count = 6,
    durationSec = 4.041666,
    width = 1280,
    height = 720,
    fps = 24,
    format = "webp",
    spawnFn = defaultSpawnRunner
  } = options;

  await fs.mkdir(outputDir, { recursive: true });
  const results: SyntheticStemResult[] = [];

  for (let i = 0; i < count; i++) {
    const ext = format === "webp" ? "webp" : "mp4";
    const filePath = path.join(outputDir, `synthetic-stem-${i}.${ext}`);
    const hueOffset = (i * 60) % 360;

    const args =
      format === "webp"
        ? [
            "-y",
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSec}`,
            "-vf",
            `hue=h=${hueOffset}:s=1.5`,
            "-vcodec",
            "libwebp_anim",
            "-loop",
            "0",
            filePath
          ]
        : [
            "-y",
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSec}`,
            "-vf",
            `hue=h=${hueOffset}:s=1.5`,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            filePath
          ];

    const runResult = await spawnFn(ffmpegPath, args);
    if (runResult.exitCode !== 0) {
      throw new Error(
        `Failed to generate synthetic stem ${i}: exit code ${runResult.exitCode}, stderr: ${runResult.stderr}`
      );
    }

    const bytes = await fs.readFile(filePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const durationMs = Math.round(durationSec * 1000);

    results.push({
      index: i,
      filePath,
      bytes,
      sha256,
      durationMs,
      width,
      height,
      fps,
      contentType: format === "webp" ? "image/webp" : "video/mp4"
    });
  }

  return results;
}
