import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { MinimaxH3ProbeResult } from "@cco/contracts";
import type { MinimaxH3OutputProberPort } from "@cco/application";

const execFileAsync = promisify(execFile);

export function parseDurationMs(durationStr?: string | null): number | null {
  if (!durationStr || durationStr === "N/A") return null;
  const num = parseFloat(durationStr);
  if (Number.isNaN(num) || num <= 0) return null;
  return Math.round(num * 1000);
}

export function parseFrameRate(rateStr?: string | null): number | null {
  if (!rateStr || rateStr === "0/0" || rateStr === "N/A") return null;
  if (rateStr.includes("/")) {
    const [num, den] = rateStr.split("/").map(Number);
    if (num && den && den > 0) {
      return num / den;
    }
    return null;
  }
  const parsed = parseFloat(rateStr);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function parsePositiveInt(val?: number | string | null): number | null {
  if (val === undefined || val === null || val === "" || val === "N/A") return null;
  const num = typeof val === "number" ? val : parseInt(val, 10);
  if (Number.isNaN(num) || !Number.isSafeInteger(num) || num <= 0) return null;
  return num;
}

function parseNonNegativeInt(val?: number | string | null): number | null {
  if (val === undefined || val === null || val === "" || val === "N/A") return null;
  const num = typeof val === "number" ? val : parseInt(val, 10);
  if (Number.isNaN(num) || !Number.isSafeInteger(num) || num < 0) return null;
  return num;
}

export class MinimaxH3OutputProber implements MinimaxH3OutputProberPort {
  private readonly ffprobePath: string;

  constructor(ffprobePath = "ffprobe") {
    this.ffprobePath = ffprobePath;
  }

  async probeOutput(
    filePath: string,
    timeoutMs = 60000,
    expectedContainingDir?: string
  ): Promise<MinimaxH3ProbeResult> {
    const resolvedPath = resolve(filePath);
    const errors: Array<{ message: string; stage?: string }> = [];
    const discrepancyFlags: string[] = [];

    let outputSizeBytes: number | null = null;
    let outputSha256: string | null = null;

    try {
      // Canonical containment check: resolvedPath's own real (symlink-
      // followed) location must still be inside expectedContainingDir.
      // Without this, a symlink planted at the expected output path (by a
      // compromised render step, or by filesystem corruption) would be
      // transparently followed by stat()/createReadStream() below, letting
      // probeOutput hash and report metadata for an arbitrary file outside
      // the run's own output directory.
      if (expectedContainingDir !== undefined) {
        const realResolvedPath = await realpath(resolvedPath);
        const realContainingDir = await realpath(resolve(expectedContainingDir));
        const withinContainingDir =
          realResolvedPath === realContainingDir ||
          realResolvedPath.startsWith(realContainingDir + sep);
        if (!withinContainingDir) {
          throw new Error(
            `Output target "${resolvedPath}" resolves to "${realResolvedPath}", which is outside the expected output directory "${realContainingDir}" (symlink escape?).`
          );
        }
      }

      const st = await stat(resolvedPath);
      if (!st.isFile()) {
        throw new Error(`Output target is not a regular file: ${resolvedPath}`);
      }
      outputSizeBytes = st.size;
      outputSha256 = await new Promise<string>((resolvePromise, rejectPromise) => {
        const hash = createHash("sha256");
        const stream = createReadStream(resolvedPath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolvePromise(hash.digest("hex")));
        stream.on("error", (err) => rejectPromise(err));
      });
      const st2 = await stat(resolvedPath);
      if (
        st2.size !== st.size ||
        st2.mtimeMs !== st.mtimeMs ||
        st2.ino !== st.ino ||
        st2.dev !== st.dev
      ) {
        throw new Error(`Output file was modified during hashing: ${resolvedPath}`);
      }
    } catch (err) {
      return {
        status: "failed",
        outputFile: basename(resolvedPath),
        outputSha256: null,
        outputSizeBytes: null,
        measuredFacts: {
          measuredFrames: null,
          countedFramesSource: null,
          declaredNbFrames: null,
          measuredVideoDurationMs: null,
          measuredContainerDurationMs: null,
          width: null,
          height: null,
          fps: null,
          rFrameRate: null,
          avgFrameRate: null,
          videoCodec: null,
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: ["file_access_error"],
        toolIdentity: { ffprobePath: this.ffprobePath },
        rawStdout: undefined,
        rawStderr: undefined,
        exitCode: null,
        errors: [{ message: `Failed to access output file: ${(err as Error).message}` }]
      };
    }

    const args = [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-count_frames",
      "-print_format",
      "json",
      resolvedPath
    ];

    let version: string | undefined = undefined;
    try {
      const verRes = await execFileAsync(this.ffprobePath, ["-version"], { timeout: 5000 });
      const firstLine = verRes.stdout.split("\n")[0];
      if (firstLine) version = firstLine.trim();
    } catch {
      // ignore if ffprobe -version is unavailable
    }

    const toolIdentity = {
      ffprobePath: this.ffprobePath,
      ...(version ? { version } : {}),
      argv: [...args]
    };

    let stdout = "";
    let stderr = "";
    let exitCode: number | null = 0;
    try {
      const result = await execFileAsync(this.ffprobePath, args, {
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024
      });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = 0;
    } catch (err: unknown) {
      const errorObj = err as {
        killed?: boolean;
        signal?: string;
        message?: string;
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      stdout = errorObj.stdout ?? "";
      stderr = errorObj.stderr ?? "";
      exitCode = errorObj.code ?? null;
      if (errorObj.killed || errorObj.signal === "SIGTERM") {
        discrepancyFlags.push("probe_timed_out");
        errors.push({
          message: `ffprobe timed out after ${timeoutMs}ms`,
          stage: "execution"
        });
      } else {
        errors.push({
          message: `ffprobe execution failed: ${errorObj.message ?? String(err)}`,
          stage: "execution"
        });
      }

      return {
        status: "failed",
        outputFile: basename(resolvedPath),
        outputSha256,
        outputSizeBytes,
        measuredFacts: {
          measuredFrames: null,
          countedFramesSource: null,
          declaredNbFrames: null,
          measuredVideoDurationMs: null,
          measuredContainerDurationMs: null,
          width: null,
          height: null,
          fps: null,
          rFrameRate: null,
          avgFrameRate: null,
          videoCodec: null,
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags,
        toolIdentity,
        errors
      };
    }

    interface FfprobeStream {
      codec_type?: string;
      nb_read_frames?: string;
      nb_frames?: string;
      duration?: string;
      width?: number | string;
      height?: number | string;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      codec_name?: string;
      channels?: number | string;
      sample_rate?: string;
    }

    interface FfprobeOutput {
      streams?: FfprobeStream[];
      format?: {
        duration?: string;
        [key: string]: unknown;
      };
    }

    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeOutput;
    } catch (err) {
      return {
        status: "failed",
        outputFile: basename(resolvedPath),
        outputSha256,
        outputSizeBytes,
        measuredFacts: {
          measuredFrames: null,
          countedFramesSource: null,
          declaredNbFrames: null,
          measuredVideoDurationMs: null,
          measuredContainerDurationMs: null,
          width: null,
          height: null,
          fps: null,
          rFrameRate: null,
          avgFrameRate: null,
          videoCodec: null,
          audioCodec: null,
          audioChannels: null,
          audioSampleRate: null
        },
        discrepancyFlags: ["json_parse_error"],
        toolIdentity,
        errors: [{ message: `ffprobe JSON parse error: ${(err as Error).message}` }]
      };
    }

    const streams: FfprobeStream[] = parsed.streams || [];
    const format = parsed.format || {};

    const videoStream = streams.find((s) => s.codec_type === "video");
    const audioStream = streams.find((s) => s.codec_type === "audio");

    if (!videoStream) {
      discrepancyFlags.push("missing_video_stream");
      errors.push({ message: "No video stream found in probed media" });
    }
    if (!audioStream) {
      discrepancyFlags.push("missing_audio_stream");
    }

    // Frames: require nb_read_frames
    let measuredFrames: number | null = null;
    let countedFramesSource: "nb_read_frames" | null = null;
    if (videoStream?.nb_read_frames && videoStream.nb_read_frames !== "N/A") {
      const parsedCount = parseInt(videoStream.nb_read_frames, 10);
      if (!Number.isNaN(parsedCount) && parsedCount >= 0) {
        measuredFrames = parsedCount;
        countedFramesSource = "nb_read_frames";
      }
    }

    let declaredNbFrames: number | null = null;
    if (videoStream?.nb_frames && videoStream.nb_frames !== "N/A") {
      const parsedDeclared = parseInt(videoStream.nb_frames, 10);
      if (!Number.isNaN(parsedDeclared) && parsedDeclared >= 0) {
        declaredNbFrames = parsedDeclared;
      }
    }

    if (
      measuredFrames !== null &&
      declaredNbFrames !== null &&
      measuredFrames !== declaredNbFrames
    ) {
      discrepancyFlags.push("nb_frames_differs_from_nb_read_frames");
    }

    const measuredVideoDurationMs = videoStream ? parseDurationMs(videoStream.duration) : null;
    const measuredContainerDurationMs = format ? parseDurationMs(format.duration) : null;

    if (
      measuredVideoDurationMs !== null &&
      measuredContainerDurationMs !== null &&
      Math.abs(measuredVideoDurationMs - measuredContainerDurationMs) > 200
    ) {
      discrepancyFlags.push("stream_container_duration_divergence");
    }

    const rFrameRate = videoStream?.r_frame_rate ?? null;
    const avgFrameRate = videoStream?.avg_frame_rate ?? null;
    const fps = videoStream ? (parseFrameRate(rFrameRate) ?? parseFrameRate(avgFrameRate)) : null;

    if (measuredFrames !== null && fps !== null && measuredVideoDurationMs !== null) {
      const expectedDurationMs = Math.round((measuredFrames / fps) * 1000);
      if (Math.abs(expectedDurationMs - measuredVideoDurationMs) > 200) {
        discrepancyFlags.push("duration_frame_count_mismatch");
      }
    }

    const width = parsePositiveInt(videoStream?.width);
    const height = parsePositiveInt(videoStream?.height);
    const videoCodec = videoStream?.codec_name ?? null;

    const audioCodec = audioStream?.codec_name ?? null;
    const audioChannels = parseNonNegativeInt(audioStream?.channels);
    const audioSampleRate = parseNonNegativeInt(audioStream?.sample_rate);

    return {
      status: videoStream ? "succeeded" : "partial",
      outputFile: basename(resolvedPath),
      outputSha256,
      outputSizeBytes,
      measuredFacts: {
        measuredFrames,
        countedFramesSource,
        declaredNbFrames,
        measuredVideoDurationMs,
        measuredContainerDurationMs,
        width,
        height,
        fps,
        rFrameRate,
        avgFrameRate,
        videoCodec,
        audioCodec,
        audioChannels,
        audioSampleRate
      },
      discrepancyFlags,
      toolIdentity,
      rawStdout: stdout,
      rawStderr: stderr,
      exitCode,
      errors
    };
  }
}
