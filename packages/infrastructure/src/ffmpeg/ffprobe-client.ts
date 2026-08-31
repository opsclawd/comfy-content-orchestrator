import { FfmpegAssemblyError, type FfmpegAssemblyErrorContext } from "./ffmpeg-error.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

export interface ProbedVideoStream {
  readonly codecName: string;
  readonly pixelFormat: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationMs: number;
}

export interface ProbedAudioStream {
  readonly codecName: string;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly durationMs: number;
  readonly bitrateKbps?: number | undefined;
}

export interface ProbedMedia {
  readonly videoStream: ProbedVideoStream;
  readonly audioStream?: ProbedAudioStream | undefined;
  readonly formatDurationMs: number;
}

export interface ProbeMediaOptions {
  readonly runner: SpawnLikeFn;
  readonly ffprobePath: string;
  readonly filePath: string;
  readonly errorContext?: FfmpegAssemblyErrorContext | undefined;
  readonly isOutput?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
}

function parseFrameRate(raw: string | undefined): number {
  if (!raw || typeof raw !== "string") return 0;
  const trimmed = raw.trim();
  if (trimmed.includes("/")) {
    const parts = trimmed.split("/");
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return num / den;
    }
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDurationMs(durationStr: string | undefined): number | undefined {
  if (!durationStr || typeof durationStr !== "string") return undefined;
  const sec = parseFloat(durationStr.trim());
  if (Number.isFinite(sec) && sec >= 0) {
    return Math.round(sec * 1000);
  }
  return undefined;
}

export async function probeMedia(options: ProbeMediaOptions): Promise<ProbedMedia> {
  const { runner, ffprobePath, filePath, errorContext = {}, isOutput = false, timeoutMs } = options;
  const failureCode = isOutput ? "OUTPUT_PROBE_FAILED" : "STEM_PROBE_FAILED";

  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath];
  let runResult;
  try {
    runResult = await runner(ffprobePath, args, { timeoutMs });
  } catch (err) {
    if (err instanceof FfmpegAssemblyError) {
      throw err;
    }
    throw new FfmpegAssemblyError(
      failureCode,
      `Failed to run ffprobe on ${filePath}: ${(err as Error).message}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  if (runResult.exitCode !== 0) {
    throw new FfmpegAssemblyError(
      failureCode,
      `ffprobe exited with code ${runResult.exitCode} for file: ${filePath}`,
      {
        ...errorContext,
        command: ffprobePath,
        args,
        exitCode: runResult.exitCode,
        stderr: runResult.stderr
      }
    );
  }

  let parsedJson: {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      duration?: string;
      sample_rate?: string;
      channels?: number;
      bit_rate?: string;
    }>;
    format?: {
      duration?: string;
    };
  };

  try {
    parsedJson = JSON.parse(runResult.stdout);
  } catch {
    throw new FfmpegAssemblyError(
      failureCode,
      `Unparseable JSON from ffprobe for file: ${filePath}`,
      { ...errorContext, command: ffprobePath, args, stderr: runResult.stderr }
    );
  }

  const streams = Array.isArray(parsedJson.streams) ? parsedJson.streams : [];
  const formatDurationMs = parseDurationMs(parsedJson.format?.duration) ?? 0;

  const rawVideoStream = streams.find((s) => s.codec_type === "video");
  if (!rawVideoStream) {
    throw new FfmpegAssemblyError(
      isOutput ? "OUTPUT_VALIDATION_FAILED" : "STEM_NO_VIDEO_STREAM",
      `No video stream found in probed media: ${filePath}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  const streamDurationMs = parseDurationMs(rawVideoStream.duration);
  const videoDurationMs =
    streamDurationMs !== undefined && streamDurationMs > 0 ? streamDurationMs : formatDurationMs;

  if (videoDurationMs <= 0) {
    throw new FfmpegAssemblyError(
      failureCode,
      `Unable to determine positive duration for video stream in ${filePath}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  const frameRate =
    parseFrameRate(rawVideoStream.r_frame_rate) || parseFrameRate(rawVideoStream.avg_frame_rate);
  if (frameRate <= 0) {
    throw new FfmpegAssemblyError(
      failureCode,
      `Unable to determine frame rate for video stream in ${filePath}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  const videoStream: ProbedVideoStream = {
    codecName: rawVideoStream.codec_name ?? "",
    pixelFormat: rawVideoStream.pix_fmt ?? "",
    width: rawVideoStream.width ?? 0,
    height: rawVideoStream.height ?? 0,
    frameRate,
    durationMs: videoDurationMs
  };

  const rawAudioStream = streams.find((s) => s.codec_type === "audio");
  let audioStream: ProbedAudioStream | undefined;
  if (rawAudioStream) {
    const audioStreamDurationMs = parseDurationMs(rawAudioStream.duration);
    const audioDurationMs =
      audioStreamDurationMs !== undefined && audioStreamDurationMs > 0
        ? audioStreamDurationMs
        : formatDurationMs;
    const sampleRateHz = rawAudioStream.sample_rate ? parseInt(rawAudioStream.sample_rate, 10) : 0;
    const channels = rawAudioStream.channels ?? 0;
    const bitrateKbps = rawAudioStream.bit_rate
      ? Math.round(parseInt(rawAudioStream.bit_rate, 10) / 1000)
      : undefined;

    audioStream = {
      codecName: rawAudioStream.codec_name ?? "",
      sampleRateHz,
      channels,
      durationMs: audioDurationMs,
      bitrateKbps
    };
  }

  return {
    videoStream,
    audioStream,
    formatDurationMs
  };
}
