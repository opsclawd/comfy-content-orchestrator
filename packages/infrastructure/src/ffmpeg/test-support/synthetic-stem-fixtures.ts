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

// libwebp's animation encoder (ffmpeg's `libwebp_anim`) always computes a
// minimal per-frame bounding rectangle internally — none of its exposed
// options (lossless, cr_threshold, cr_size) disable this. That produces
// ANMF frames with non-zero offsets and sub-canvas dimensions, which does
// not match real LTX_25_720P_5S_V1 output: a confirmed-real certification
// artifact was empirically verified (issue #131) to always emit full-canvas,
// origin-(0,0) frames. Testing against ffmpeg's auto-cropped output would
// exercise an ANMF shape that real production input never produces (and
// that the fail-closed compositing-subset validation correctly rejects).
// So instead of the animated encoder, each frame is generated and encoded
// as an independent full-canvas static WebP, then manually muxed into an
// ANIM/ANMF container with explicit x=0,y=0,full-canvas dimensions,
// blend=0, disposal=0 — matching the validated real-artifact geometry.
async function buildFullCanvasAnimatedWebpStem(params: {
  readonly ffmpegPath: string;
  readonly frameDir: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSec: number;
  readonly hueOffset: number;
  readonly spawnFn: SpawnLikeFn;
}): Promise<Buffer> {
  const { ffmpegPath, frameDir, width, height, fps, durationSec, hueOffset, spawnFn } = params;
  await fs.mkdir(frameDir, { recursive: true });

  const pngPattern = path.join(frameDir, "frame_%04d.png");
  const pngResult = await spawnFn(ffmpegPath, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=${fps}:duration=${durationSec}`,
    "-vf",
    `hue=h=${hueOffset}:s=1.5`,
    pngPattern
  ]);
  if (pngResult.exitCode !== 0) {
    throw new Error(`Failed to generate synthetic WebP source frames: ${pngResult.stderr}`);
  }

  const webpPattern = path.join(frameDir, "static_%04d.webp");
  const webpResult = await spawnFn(ffmpegPath, [
    "-y",
    "-i",
    pngPattern,
    "-vcodec",
    "libwebp",
    "-q:v",
    "80",
    webpPattern
  ]);
  if (webpResult.exitCode !== 0) {
    throw new Error(`Failed to encode synthetic WebP source frames: ${webpResult.stderr}`);
  }

  const frameFiles = (await fs.readdir(frameDir))
    .filter((f) => f.startsWith("static_") && f.endsWith(".webp"))
    .sort();
  if (frameFiles.length === 0) {
    throw new Error("No static WebP frames were produced for synthetic animated WebP stem");
  }

  const frameDurationMs = Math.max(1, Math.round(1000 / fps));
  const anmfChunks: Buffer[] = [];
  for (const frameFile of frameFiles) {
    const staticWebp = await fs.readFile(path.join(frameDir, frameFile));
    // A single-image WebP produced by ffmpeg's plain `libwebp` encoder is
    // just RIFF/WEBP (12 bytes) followed directly by its "VP8 "/"VP8L"
    // chunk — no VP8X wrapper, since no extended feature (alpha/animation)
    // is in play. That inner chunk is exactly what an ANMF frame payload
    // expects (demuxAnimatedWebp slices this same region back out).
    if (staticWebp.subarray(0, 4).toString("ascii") !== "RIFF") {
      throw new Error(`Synthetic WebP frame ${frameFile} is missing RIFF magic`);
    }
    const payload = staticWebp.subarray(12);

    const anmfHeader = Buffer.alloc(16);
    anmfHeader.writeUIntLE(0, 0, 3); // frame x
    anmfHeader.writeUIntLE(0, 3, 3); // frame y
    anmfHeader.writeUIntLE(width - 1, 6, 3);
    anmfHeader.writeUIntLE(height - 1, 9, 3);
    anmfHeader.writeUIntLE(frameDurationMs, 12, 3);
    anmfHeader.writeUInt8(0, 15); // blend=0 (overwrite), disposal=0 (no dispose)

    const anmfBody = Buffer.concat([anmfHeader, payload]);
    const anmfSize = Buffer.alloc(4);
    anmfSize.writeUInt32LE(anmfBody.length, 0);
    const padding = anmfBody.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0);
    anmfChunks.push(Buffer.concat([Buffer.from("ANMF", "ascii"), anmfSize, anmfBody, padding]));
  }

  const vp8xChunk = Buffer.alloc(18);
  vp8xChunk.write("VP8X", 0, 4, "ascii");
  vp8xChunk.writeUInt32LE(10, 4);
  vp8xChunk.writeUInt8(0x02, 8); // Animation flag
  vp8xChunk.writeUIntLE(width - 1, 12, 3);
  vp8xChunk.writeUIntLE(height - 1, 15, 3);

  const animChunk = Buffer.alloc(14);
  animChunk.write("ANIM", 0, 4, "ascii");
  animChunk.writeUInt32LE(6, 4);
  animChunk.writeUInt32LE(0x00000000, 8); // bgcolor
  animChunk.writeUInt16LE(0, 12); // loop forever

  const body = Buffer.concat([vp8xChunk, animChunk, ...anmfChunks]);
  const riffHeader = Buffer.alloc(12);
  riffHeader.write("RIFF", 0, 4, "ascii");
  riffHeader.writeUInt32LE(4 + body.length, 4);
  riffHeader.write("WEBP", 8, 4, "ascii");

  return Buffer.concat([riffHeader, body]);
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

    let bytes: Buffer;
    if (format === "webp") {
      bytes = await buildFullCanvasAnimatedWebpStem({
        ffmpegPath,
        frameDir: path.join(outputDir, `frames-${i}`),
        width,
        height,
        fps,
        durationSec,
        hueOffset,
        spawnFn
      });
      await fs.writeFile(filePath, bytes);
    } else {
      const args = [
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

      bytes = await fs.readFile(filePath);
    }

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
