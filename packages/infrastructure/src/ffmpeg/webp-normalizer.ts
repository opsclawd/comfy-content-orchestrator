import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

export interface DemuxedWebp {
  readonly frames: ReadonlyArray<{
    readonly buffer: Buffer;
    readonly durationMs: number;
  }>;
  readonly totalDurationMs: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly combinedFrames: Buffer;
}

export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riff = buf.subarray(0, 4).toString("ascii");
  const webp = buf.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || webp !== "WEBP") return false;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const fourcc = buf.subarray(offset, offset + 4).toString("ascii");
    const size = buf.readUInt32LE(offset + 4);
    if (fourcc === "ANIM" || fourcc === "ANMF") {
      return true;
    }
    if (fourcc === "VP8X" && size >= 10 && offset + 12 <= buf.length) {
      const flags = buf.readUInt8(offset + 8);
      // Bit 1 (0x02) in VP8X flags is Animation flag
      if ((flags & 0x02) !== 0) {
        return true;
      }
    }
    offset += 8 + size + (size % 2);
  }
  return false;
}

export function demuxAnimatedWebp(bytes: Uint8Array): DemuxedWebp {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 12) {
    throw new FfmpegAssemblyError("STEM_PROBE_FAILED", "Invalid WebP header: buffer too small");
  }

  const riff = buf.subarray(0, 4).toString("ascii");
  const webp = buf.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || webp !== "WEBP") {
    throw new FfmpegAssemblyError(
      "STEM_PROBE_FAILED",
      "Invalid WebP header: missing RIFF/WEBP magic"
    );
  }

  let offset = 12;
  const frames: Array<{ buffer: Buffer; durationMs: number }> = [];
  let totalDurationMs = 0;
  let canvasWidth = 0;
  let canvasHeight = 0;

  while (offset + 8 <= buf.length) {
    const fourcc = buf.subarray(offset, offset + 4).toString("ascii");
    const size = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(buf.length, chunkStart + size);

    if (fourcc === "VP8X" && size >= 10 && chunkStart + 8 <= buf.length) {
      canvasWidth = 1 + buf.readUIntLE(chunkStart + 4, 3);
      canvasHeight = 1 + buf.readUIntLE(chunkStart + 7, 3);
    } else if (fourcc === "ANMF" && size >= 16 && chunkStart + 16 <= buf.length) {
      const frameDurationMs = buf.readUIntLE(chunkStart + 12, 3);
      totalDurationMs += frameDurationMs;

      const payload = buf.subarray(chunkStart + 16, chunkEnd);
      // Wrap frame payload into standalone RIFF WebP container
      const riffHeader = Buffer.alloc(12);
      riffHeader.write("RIFF", 0, 4, "ascii");
      riffHeader.writeUInt32LE(4 + payload.length, 4);
      riffHeader.write("WEBP", 8, 4, "ascii");

      const frameBuffer = Buffer.concat([riffHeader, payload]);
      frames.push({ buffer: frameBuffer, durationMs: frameDurationMs });
    }

    offset += 8 + size + (size % 2);
  }

  if (frames.length === 0) {
    throw new FfmpegAssemblyError(
      "STEM_NO_VIDEO_STREAM",
      "No animation frames found in animated WebP file"
    );
  }

  const avgDurationMs = totalDurationMs / frames.length;
  const fps = avgDurationMs > 0 ? Math.round(1000 / avgDurationMs) : 24;
  const combinedFrames = Buffer.concat(frames.map((f) => f.buffer));

  return {
    frames,
    totalDurationMs,
    fps: fps > 0 ? fps : 24,
    width: canvasWidth,
    height: canvasHeight,
    combinedFrames
  };
}

export interface NormalizeWebpOptions {
  readonly bytes: Uint8Array;
  readonly outputPath: string;
  readonly ffmpegPath: string;
  readonly spawnFn: SpawnLikeFn;
  readonly timeoutMs?: number | undefined;
  readonly stemOrder?: number | undefined;
  readonly stemSceneId?: string | undefined;
}

export interface NormalizeWebpResult {
  readonly normalizedSha256: string;
  readonly commandFingerprint: string;
}

export async function normalizeAnimatedWebpToMp4(
  options: NormalizeWebpOptions
): Promise<NormalizeWebpResult> {
  const { bytes, outputPath, ffmpegPath, spawnFn, timeoutMs, stemOrder, stemSceneId } = options;

  let demuxed: DemuxedWebp;
  try {
    demuxed = demuxAnimatedWebp(bytes);
  } catch (err) {
    if (err instanceof FfmpegAssemblyError) throw err;
    throw new FfmpegAssemblyError(
      "STEM_PROBE_FAILED",
      `Failed to demux animated WebP: ${(err as Error).message}`,
      { stemOrder, stemSceneId }
    );
  }

  // Preserve each frame's exact duration instead of collapsing the sequence
  // to a single average integer framerate (the previous "-framerate N with
  // image2pipe" approach): animated WebP frames commonly have variable,
  // non-uniform durations, and rounding to one constant fps silently drifts
  // the encoded total duration away from the sum of actual frame durations.
  // Across multiple stems that drift compounds — this is what produced the
  // observed 252ms discrepancy between measured stem durations and final
  // output duration. Using ffmpeg's concat demuxer with an explicit
  // `duration` directive per frame preserves exact per-frame timing.
  const framesDir = path.join(path.dirname(outputPath), `webp-frames-${randomUUID()}`);
  await fs.mkdir(framesDir, { recursive: true });

  try {
    const frameFileNames = await Promise.all(
      demuxed.frames.map(async (frame, index) => {
        const fileName = `frame-${String(index).padStart(5, "0")}.webp`;
        await fs.writeFile(path.join(framesDir, fileName), frame.buffer);
        return fileName;
      })
    );

    // NOTE: do not repeat the last file entry without a `duration` line.
    // That's a documented workaround for CFR-oriented concat+encode setups,
    // but combined with "-fps_mode vfr" below it produces a genuine extra
    // output frame instead of "closing out" the final frame's duration —
    // confirmed empirically: 97 source frames in, 98 frames / +39ms out with
    // the repeated entry; exactly 97 frames / source-matching duration
    // without it.
    const concatLines: string[] = ["ffconcat version 1.0"];
    demuxed.frames.forEach((frame, index) => {
      concatLines.push(`file '${frameFileNames[index]}'`);
      concatLines.push(`duration ${(frame.durationMs / 1000).toFixed(6)}`);
    });
    const concatScriptPath = path.join(framesDir, "concat.txt");
    await fs.writeFile(concatScriptPath, concatLines.join("\n") + "\n");

    const args = [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatScriptPath,
      "-fps_mode",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      outputPath
    ];

    let runResult;
    try {
      runResult = await spawnFn(ffmpegPath, args, { timeoutMs });
    } catch (err) {
      if (err instanceof FfmpegAssemblyError) throw err;
      throw new FfmpegAssemblyError(
        "FFMPEG_EXECUTION_FAILED",
        `Failed to normalize animated WebP to MP4: ${(err as Error).message}`,
        { command: ffmpegPath, args, stemOrder, stemSceneId }
      );
    }

    if (runResult.exitCode !== 0) {
      throw new FfmpegAssemblyError(
        "FFMPEG_EXECUTION_FAILED",
        `FFmpeg WebP normalization failed with exit code ${runResult.exitCode}: ${runResult.stderr}`,
        {
          command: ffmpegPath,
          args,
          exitCode: runResult.exitCode,
          stderr: runResult.stderr,
          stemOrder,
          stemSceneId
        }
      );
    }

    const outputBytes = await fs.readFile(outputPath);
    const normalizedSha256 = createHash("sha256").update(outputBytes).digest("hex");

    // Fingerprint the deterministic normalization recipe: the ffmpeg argv
    // with the volatile scratch paths replaced by stable placeholders, plus
    // the canonical per-frame timing description that drove the concat
    // script — not the temp filesystem paths themselves.
    const normalizedArgs = args.map((arg) =>
      arg === concatScriptPath ? "CONCAT_SCRIPT" : arg === outputPath ? "OUTPUT" : arg
    );
    const frameTimingDescription = demuxed.frames.map((f) => f.durationMs);
    const commandFingerprint = createHash("sha256")
      .update(JSON.stringify({ args: normalizedArgs, frameDurationsMs: frameTimingDescription }))
      .digest("hex");

    return { normalizedSha256, commandFingerprint };
  } finally {
    await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
  }
}
