import { spawn as spawnChild } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

export interface DemuxedFrame {
  readonly buffer: Buffer;
  readonly durationMs: number;
  readonly frameX?: number | undefined;
  readonly frameY?: number | undefined;
  readonly frameWidth?: number | undefined;
  readonly frameHeight?: number | undefined;
  readonly isFullCanvas?: boolean | undefined;
}

export interface DemuxedWebp {
  readonly frames: ReadonlyArray<DemuxedFrame>;
  readonly totalDurationMs: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly combinedFrames: Buffer;
}

export interface DemuxAnimatedWebpOptions {
  readonly allowSubRectangles?: boolean | undefined;
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

export function demuxAnimatedWebp(
  bytes: Uint8Array,
  options?: DemuxAnimatedWebpOptions
): DemuxedWebp {
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
  const frames: Array<DemuxedFrame> = [];
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
      // Per-frame x/y (in units of 2 pixels) and width-1/height-1, per the
      // WebP ANMF chunk layout.
      const frameX = 2 * buf.readUIntLE(chunkStart + 0, 3);
      const frameY = 2 * buf.readUIntLE(chunkStart + 3, 3);
      const frameWidth = 1 + buf.readUIntLE(chunkStart + 6, 3);
      const frameHeight = 1 + buf.readUIntLE(chunkStart + 9, 3);
      const frameDurationMs = buf.readUIntLE(chunkStart + 12, 3);
      const flagsByte = buf.readUInt8(chunkStart + 15);
      const blendingMethod = (flagsByte >> 1) & 0x01; // 0 = overwrite, 1 = alpha-blend with prior canvas
      totalDurationMs += frameDurationMs;

      const isFullCanvas =
        frameX === 0 && frameY === 0 && frameWidth === canvasWidth && frameHeight === canvasHeight;

      if (!options?.allowSubRectangles && !isFullCanvas) {
        throw new FfmpegAssemblyError(
          "UNSUPPORTED_INPUT",
          `Animated WebP frame ${frames.length} is not full-canvas at origin (0,0) ` +
            `(frame ${frameWidth}x${frameHeight}+${frameX}+${frameY} vs canvas ` +
            `${canvasWidth}x${canvasHeight}); independent-frame extraction does not ` +
            `implement ANMF sub-rectangle compositing`
        );
      }

      const payload = buf.subarray(chunkStart + 16, chunkEnd);
      const payloadSubChunk = payload.subarray(0, 4).toString("ascii");
      const hasAlpha = payloadSubChunk === "ALPH";

      if (blendingMethod === 1 && hasAlpha) {
        // Blend=1 is only a safe no-op when the frame is fully opaque
        // (overwriting a full-canvas frame is identical to blending it
        // when there's no alpha to blend with). A frame that both carries
        // an alpha channel and requests blending needs real alpha
        // compositing against the previous canvas, which this extractor
        // does not implement.
        throw new FfmpegAssemblyError(
          "UNSUPPORTED_INPUT",
          `Animated WebP frame ${frames.length} uses alpha-blending compositing ` +
            `(blend=1) with an alpha channel present; independent-frame extraction ` +
            `only supports overwrite-composited or fully-opaque frames`
        );
      }

      // Wrap frame payload into standalone RIFF WebP container
      const riffHeader = Buffer.alloc(12);
      riffHeader.write("RIFF", 0, 4, "ascii");
      riffHeader.writeUInt32LE(4 + payload.length, 4);
      riffHeader.write("WEBP", 8, 4, "ascii");

      const frameBuffer = Buffer.concat([riffHeader, payload]);
      frames.push({
        buffer: frameBuffer,
        durationMs: frameDurationMs,
        frameX,
        frameY,
        frameWidth,
        frameHeight,
        isFullCanvas
      });
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
  readonly pythonPath?: string | undefined;
  readonly disablePython?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly stemOrder?: number | undefined;
  readonly stemSceneId?: string | undefined;
}

export interface NormalizeWebpResult {
  readonly normalizedSha256: string;
  readonly commandFingerprint: string;
}

function findExtractScriptPath(): string | undefined {
  try {
    const fromModule = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../scripts/extract_webp_frames.py"
    );
    if (existsSync(fromModule)) return fromModule;
  } catch {
    // Ignore resolution errors if import.meta.url cannot be resolved
  }
  const fromCwd = path.resolve(process.cwd(), "scripts/extract_webp_frames.py");
  if (existsSync(fromCwd)) return fromCwd;
  return undefined;
}

function resolvePythonPath(pythonPathOverride?: string): string | undefined {
  if (pythonPathOverride && existsSync(pythonPathOverride)) {
    return pythonPathOverride;
  }
  if (process.env.WEBP_PYTHON_PATH && existsSync(process.env.WEBP_PYTHON_PATH)) {
    return process.env.WEBP_PYTHON_PATH;
  }
  if (process.env.WHISPERX_PYTHON_PATH && existsSync(process.env.WHISPERX_PYTHON_PATH)) {
    return process.env.WHISPERX_PYTHON_PATH;
  }
  const venvPython = path.resolve(process.cwd(), "node_modules/.cache/whisperx-venv/bin/python3");
  if (existsSync(venvPython)) {
    return venvPython;
  }
  if (existsSync("/usr/bin/python3")) {
    return "/usr/bin/python3";
  }
  return "python3";
}

interface PythonExtractionResult {
  readonly frameDurationsMs: number[];
  readonly concatScriptPath: string;
}

async function extractWithPython(
  bytes: Uint8Array,
  framesDir: string,
  pythonPathOverride?: string,
  timeoutMs: number = 60_000
): Promise<PythonExtractionResult | null> {
  const scriptPath = findExtractScriptPath();
  if (!scriptPath) {
    return null;
  }
  const pythonBin = resolvePythonPath(pythonPathOverride);
  if (!pythonBin) {
    return null;
  }

  const inputWebpPath = path.join(framesDir, "input.webp");
  await fs.writeFile(inputWebpPath, bytes);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawnChild(pythonBin, [scriptPath, inputWebpPath, framesDir], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs
      });

      let stderr = "";
      proc.stderr?.on("data", (d) => {
        stderr += d.toString();
      });

      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`extract_webp_frames.py exited with code ${code}: ${stderr}`));
        }
      });
    });

    const concatScriptPath = path.join(framesDir, "concat.txt");
    if (!existsSync(concatScriptPath)) {
      return null;
    }

    const concatContent = await fs.readFile(concatScriptPath, "utf-8");
    const frameDurationsMs: number[] = [];
    for (const line of concatContent.split("\n")) {
      if (line.startsWith("duration ")) {
        const durSec = parseFloat(line.slice(9).trim());
        if (!Number.isNaN(durSec)) {
          frameDurationsMs.push(Math.round(durSec * 1000));
        }
      }
    }

    if (frameDurationsMs.length === 0) {
      return null;
    }

    return { frameDurationsMs, concatScriptPath };
  } catch {
    return null;
  } finally {
    await fs.unlink(inputWebpPath).catch(() => {});
  }
}

export async function normalizeAnimatedWebpToMp4(
  options: NormalizeWebpOptions
): Promise<NormalizeWebpResult> {
  const { bytes, outputPath, ffmpegPath, spawnFn, timeoutMs, stemOrder, stemSceneId } = options;

  const framesDir = path.join(path.dirname(outputPath), `webp-frames-${randomUUID()}`);
  await fs.mkdir(framesDir, { recursive: true });

  try {
    let concatScriptPath: string;
    let frameDurationsMs: number[];

    let pythonExtraction: PythonExtractionResult | null = null;
    if (!options.disablePython) {
      pythonExtraction = await extractWithPython(bytes, framesDir, options.pythonPath, timeoutMs);
    }

    if (pythonExtraction) {
      concatScriptPath = pythonExtraction.concatScriptPath;
      frameDurationsMs = pythonExtraction.frameDurationsMs;
    } else {
      let demuxed: DemuxedWebp;
      try {
        demuxed = demuxAnimatedWebp(bytes, { allowSubRectangles: true });
      } catch (err) {
        if (err instanceof FfmpegAssemblyError) throw err;
        throw new FfmpegAssemblyError(
          "STEM_PROBE_FAILED",
          `Failed to demux animated WebP: ${(err as Error).message}`,
          { stemOrder, stemSceneId }
        );
      }

      const hasSubRectangles = demuxed.frames.some((f) => f.isFullCanvas === false);

      let frameFileNames: string[];
      if (!hasSubRectangles) {
        frameFileNames = await Promise.all(
          demuxed.frames.map(async (frame, index) => {
            const fileName = `frame-${String(index).padStart(5, "0")}.webp`;
            await fs.writeFile(path.join(framesDir, fileName), frame.buffer);
            return fileName;
          })
        );
      } else {
        frameFileNames = [];
        for (let i = 0; i < demuxed.frames.length; i++) {
          const frame = demuxed.frames[i]!;
          const frameFileName = `frame-${String(i).padStart(5, "0")}.bmp`;
          const frameFilePath = path.join(framesDir, frameFileName);
          const subFileName = `sub-${String(i).padStart(5, "0")}.webp`;
          const subFilePath = path.join(framesDir, subFileName);
          await fs.writeFile(subFilePath, frame.buffer);

          if (i === 0) {
            await spawnFn(ffmpegPath, ["-y", "-v", "error", "-i", subFilePath, frameFilePath], {
              timeoutMs
            });
          } else {
            const prevFileName = `frame-${String(i - 1).padStart(5, "0")}.bmp`;
            const prevFilePath = path.join(framesDir, prevFileName);
            await spawnFn(
              ffmpegPath,
              [
                "-y",
                "-v",
                "error",
                "-i",
                prevFilePath,
                "-i",
                subFilePath,
                "-filter_complex",
                `[0:v][1:v]overlay=x=${frame.frameX ?? 0}:y=${frame.frameY ?? 0}`,
                frameFilePath
              ],
              { timeoutMs }
            );
          }
          await fs.unlink(subFilePath).catch(() => {});
          frameFileNames.push(frameFileName);
        }
      }

      const concatLines: string[] = ["ffconcat version 1.0"];
      demuxed.frames.forEach((frame, index) => {
        concatLines.push(`file '${frameFileNames[index]}'`);
        concatLines.push(`duration ${(frame.durationMs / 1000).toFixed(6)}`);
      });
      concatScriptPath = path.join(framesDir, "concat.txt");
      await fs.writeFile(concatScriptPath, concatLines.join("\n") + "\n");
      frameDurationsMs = demuxed.frames.map((f) => f.durationMs);
    }

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
    const commandFingerprint = createHash("sha256")
      .update(JSON.stringify({ args: normalizedArgs, frameDurationsMs }))
      .digest("hex");

    return { normalizedSha256, commandFingerprint };
  } finally {
    await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
  }
}
