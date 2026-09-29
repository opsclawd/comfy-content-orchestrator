import { FfmpegAssemblyError, type FfmpegAssemblyErrorContext } from "./ffmpeg-error.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

export interface ProbedVideoStream {
  readonly codecName: string;
  readonly pixelFormat: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number | null;
  readonly durationMs: number;
  readonly frameCount?: number | undefined;
  readonly avgFrameRate?: number | undefined;
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
  readonly countFrames?: boolean | undefined;
  readonly checkFrameIntervals?: boolean | undefined;
}

export interface ProbeAudioMediaOptions {
  readonly runner: SpawnLikeFn;
  readonly ffprobePath: string;
  readonly filePath: string;
  readonly errorContext?: FfmpegAssemblyErrorContext | undefined;
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

function parseFrameCount(raw: string | undefined): number | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  const parsed = parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

interface RawFfprobeStream {
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
  nb_frames?: string;
  nb_read_frames?: string;
  index?: number;
}

interface RawFfprobeFrame {
  media_type?: string;
  stream_index?: number;
  pts_time?: string;
  best_effort_timestamp_time?: string;
  duration_time?: string;
  pkt_pts_time?: string;
  pkt_duration_time?: string;
}

interface ParsedFfprobeJson {
  streams?: RawFfprobeStream[];
  format?: {
    duration?: string;
  };
  frames?: RawFfprobeFrame[];
}

async function runFfprobeAndParse(options: {
  readonly runner: SpawnLikeFn;
  readonly ffprobePath: string;
  readonly filePath: string;
  readonly failureCode: FfmpegAssemblyError["code"];
  readonly fileLabel?: string | undefined;
  readonly errorContext?: FfmpegAssemblyErrorContext | undefined;
  readonly timeoutMs?: number | undefined;
  readonly countFrames?: boolean | undefined;
  readonly checkFrameIntervals?: boolean | undefined;
}): Promise<{
  readonly streams: RawFfprobeStream[];
  readonly frames: RawFfprobeFrame[];
  readonly formatDurationMs: number;
  readonly args: string[];
}> {
  const {
    runner,
    ffprobePath,
    filePath,
    failureCode,
    fileLabel = "",
    errorContext = {},
    timeoutMs,
    countFrames = false,
    checkFrameIntervals = false
  } = options;

  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    ...(countFrames ? ["-count_frames"] : []),
    ...(checkFrameIntervals
      ? [
          "-show_entries",
          "frame=media_type,stream_index,pts_time,duration_time,best_effort_timestamp_time,pkt_pts_time,pkt_duration_time"
        ]
      : []),
    filePath
  ];
  let runResult;
  try {
    runResult = await runner(ffprobePath, args, { timeoutMs });
  } catch (err) {
    if (err instanceof FfmpegAssemblyError) {
      throw err;
    }
    const labelPrefix = fileLabel ? `${fileLabel} ` : "";
    throw new FfmpegAssemblyError(
      failureCode,
      `Failed to run ffprobe on ${labelPrefix}${filePath}: ${(err as Error).message}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  if (runResult.exitCode !== 0) {
    const labelPrefix = fileLabel ? `${fileLabel}: ` : "file: ";
    throw new FfmpegAssemblyError(
      failureCode,
      `ffprobe exited with code ${runResult.exitCode} for ${labelPrefix}${filePath}`,
      {
        ...errorContext,
        command: ffprobePath,
        args,
        exitCode: runResult.exitCode,
        stderr: runResult.stderr
      }
    );
  }

  let parsedJson: ParsedFfprobeJson;
  try {
    parsedJson = JSON.parse(runResult.stdout);
  } catch {
    const labelPrefix = fileLabel ? `${fileLabel}: ` : "file: ";
    throw new FfmpegAssemblyError(
      failureCode,
      `Unparseable JSON from ffprobe for ${labelPrefix}${filePath}`,
      { ...errorContext, command: ffprobePath, args, stderr: runResult.stderr }
    );
  }

  const streams = Array.isArray(parsedJson.streams) ? parsedJson.streams : [];
  const frames = Array.isArray(parsedJson.frames) ? parsedJson.frames : [];
  const formatDurationMs = parseDurationMs(parsedJson.format?.duration) ?? 0;

  return { streams, frames, formatDurationMs, args };
}

function determineFrameRate(rawVideoStream: RawFfprobeStream): {
  readonly frameRate: number | null;
  readonly avgFrameRate?: number | undefined;
} {
  const rFrameRate = parseFrameRate(rawVideoStream.r_frame_rate);
  const avgFrameRate = parseFrameRate(rawVideoStream.avg_frame_rate);
  const avgResult = avgFrameRate > 0 ? avgFrameRate : undefined;

  // When avg_frame_rate is explicitly "0/0" and r_frame_rate is a timebase (e.g. 90000/1)
  if (rawVideoStream.avg_frame_rate === "0/0" && (rFrameRate === 0 || rFrameRate > 1000)) {
    return { frameRate: null, avgFrameRate: undefined };
  }

  // When both rates are positive:
  if (rFrameRate > 0 && avgFrameRate > 0) {
    // If rates differ significantly (e.g. 90000/1 vs 24/1), it's variable frame rate
    if (Math.abs(rFrameRate - avgFrameRate) > 0.05) {
      return { frameRate: null, avgFrameRate: avgResult };
    }
    return { frameRate: rFrameRate, avgFrameRate: avgResult };
  }

  // If only r_frame_rate is provided and in a reasonable range (CFR or mock test)
  if (rFrameRate > 0 && rFrameRate <= 1000) {
    return { frameRate: rFrameRate, avgFrameRate: avgResult };
  }

  // If only avg_frame_rate is provided: positive avg_frame_rate alone does NOT establish constant frame spacing
  if (avgFrameRate > 0 && avgFrameRate <= 1000) {
    return { frameRate: null, avgFrameRate: avgResult };
  }

  return { frameRate: null, avgFrameRate: avgResult };
}

function parseTimestamp(frame: RawFfprobeFrame): number | undefined {
  const raw = frame.pts_time ?? frame.best_effort_timestamp_time ?? frame.pkt_pts_time;
  if (!raw || typeof raw !== "string") return undefined;
  const val = parseFloat(raw.trim());
  return Number.isFinite(val) ? val : undefined;
}

function parseFrameDuration(frame: RawFfprobeFrame): number | undefined {
  const raw = frame.duration_time ?? frame.pkt_duration_time;
  if (!raw || typeof raw !== "string") return undefined;
  const val = parseFloat(raw.trim());
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

// Tolerance for frame-to-frame timing deviation before a stream is judged
// non-constant-rate. Real CFR sources (including ComfyUI/ffmpeg-produced
// output) typically show sub-millisecond decode/timestamp jitter, so 1ms/2%
// comfortably passes genuine constant-rate video while still catching VFR
// sources whose actual frame spacing varies meaningfully.
const FRAME_INTERVAL_ABSOLUTE_TOLERANCE_SECONDS = 0.001;
const FRAME_INTERVAL_RELATIVE_TOLERANCE = 0.02;

function frameIntervalTolerance(expectedIntervalSeconds: number): number {
  return Math.max(
    FRAME_INTERVAL_ABSOLUTE_TOLERANCE_SECONDS,
    expectedIntervalSeconds * FRAME_INTERVAL_RELATIVE_TOLERANCE
  );
}

function checkFrameIntervalsConstantRate(
  frames: readonly RawFfprobeFrame[],
  candidateRate: number | null
): boolean {
  if (frames.length <= 1) {
    if (frames.length === 1 && candidateRate !== null && candidateRate > 0) {
      const dur = parseFrameDuration(frames[0]!);
      if (dur !== undefined) {
        const expected = 1 / candidateRate;
        return Math.abs(dur - expected) <= frameIntervalTolerance(expected);
      }
    }
    return true;
  }

  const timestamps = frames.map(parseTimestamp);
  const allTimestampsValid = timestamps.every((t) => t !== undefined);
  let intervals: number[] = [];

  if (allTimestampsValid) {
    const sorted = [...(timestamps as number[])].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      intervals.push(sorted[i + 1]! - sorted[i]!);
    }
  } else {
    const durations = frames.map(parseFrameDuration);
    const allDurationsValid = durations.every((d) => d !== undefined);
    if (allDurationsValid) {
      intervals = durations as number[];
    } else {
      return false;
    }
  }

  if (intervals.length === 0 || intervals.some((d) => d <= 0)) {
    return false;
  }

  const expectedInterval =
    candidateRate !== null && candidateRate > 0
      ? 1 / candidateRate
      : intervals.reduce((acc, v) => acc + v, 0) / intervals.length;

  if (expectedInterval <= 0) {
    return false;
  }

  const tolerance = frameIntervalTolerance(expectedInterval);
  for (const interval of intervals) {
    if (Math.abs(interval - expectedInterval) > tolerance) {
      return false;
    }
  }

  return true;
}

function parseAudioStream(
  rawAudioStream: RawFfprobeStream,
  formatDurationMs: number
): ProbedAudioStream {
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

  return {
    codecName: rawAudioStream.codec_name ?? "",
    sampleRateHz,
    channels,
    durationMs: audioDurationMs,
    bitrateKbps
  };
}

export async function probeMedia(options: ProbeMediaOptions): Promise<ProbedMedia> {
  const {
    runner,
    ffprobePath,
    filePath,
    errorContext = {},
    isOutput = false,
    timeoutMs,
    countFrames,
    checkFrameIntervals
  } = options;
  const failureCode = isOutput ? "OUTPUT_PROBE_FAILED" : "STEM_PROBE_FAILED";

  const { streams, frames, formatDurationMs, args } = await runFfprobeAndParse({
    runner,
    ffprobePath,
    filePath,
    failureCode,
    errorContext,
    timeoutMs,
    countFrames,
    checkFrameIntervals
  });

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

  const determined = determineFrameRate(rawVideoStream);
  let frameRate = determined.frameRate;
  const avgFrameRate = determined.avgFrameRate;

  if (checkFrameIntervals) {
    // The caller explicitly asked for cadence verification: a positive frame
    // rate must be confirmed by actual frame timing, not merely inferred from
    // stream metadata agreeing with itself. If we don't have usable frame
    // records to confirm constant spacing, fail closed to null rather than
    // silently trusting the metadata-derived candidate.
    const videoFrames = frames.filter(
      (f) =>
        (f.media_type ? f.media_type === "video" : true) &&
        (f.stream_index !== undefined && rawVideoStream.index !== undefined
          ? f.stream_index === rawVideoStream.index
          : true)
    );

    if (videoFrames.length > 0) {
      const isConstant = checkFrameIntervalsConstantRate(
        videoFrames,
        frameRate ?? avgFrameRate ?? null
      );
      if (isConstant) {
        if (frameRate === null && avgFrameRate !== undefined) {
          frameRate = avgFrameRate;
        }
      } else {
        frameRate = null;
      }
    } else {
      frameRate = null;
    }
  }

  if (frameRate === null && avgFrameRate === undefined && rawVideoStream.avg_frame_rate !== "0/0") {
    throw new FfmpegAssemblyError(
      failureCode,
      `Unable to determine frame rate for video stream in ${filePath}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  const frameCount =
    parseFrameCount(rawVideoStream.nb_read_frames) ?? parseFrameCount(rawVideoStream.nb_frames);

  const videoStream: ProbedVideoStream = {
    codecName: rawVideoStream.codec_name ?? "",
    pixelFormat: rawVideoStream.pix_fmt ?? "",
    width: rawVideoStream.width ?? 0,
    height: rawVideoStream.height ?? 0,
    frameRate,
    durationMs: videoDurationMs,
    ...(avgFrameRate !== undefined ? { avgFrameRate } : {}),
    ...(frameCount !== undefined ? { frameCount } : {})
  };

  const rawAudioStream = streams.find((s) => s.codec_type === "audio");
  const audioStream = rawAudioStream
    ? parseAudioStream(rawAudioStream, formatDurationMs)
    : undefined;

  return {
    videoStream,
    audioStream,
    formatDurationMs
  };
}

export async function probeAudioMedia(options: ProbeAudioMediaOptions): Promise<{
  readonly audioStream: ProbedAudioStream;
  readonly formatDurationMs: number;
}> {
  const { runner, ffprobePath, filePath, errorContext = {}, timeoutMs } = options;
  const failureCode = "AUDIO_PROBE_FAILED";

  const { streams, formatDurationMs, args } = await runFfprobeAndParse({
    runner,
    ffprobePath,
    filePath,
    failureCode,
    fileLabel: "audio file",
    errorContext,
    timeoutMs
  });

  const rawAudioStream = streams.find((s) => s.codec_type === "audio");
  if (!rawAudioStream) {
    throw new FfmpegAssemblyError(
      "AUDIO_NO_AUDIO_STREAM",
      `No audio stream found in probed media: ${filePath}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  const audioStream = parseAudioStream(rawAudioStream, formatDurationMs);

  if (audioStream.durationMs <= 0) {
    throw new FfmpegAssemblyError(
      failureCode,
      `Unable to determine positive duration for audio stream in ${filePath}`,
      { ...errorContext, command: ffprobePath, args }
    );
  }

  return {
    audioStream,
    formatDurationMs
  };
}
