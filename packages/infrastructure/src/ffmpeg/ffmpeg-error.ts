export type FfmpegAssemblyFailureCode =
  | "FFMPEG_NOT_FOUND"
  | "FFPROBE_NOT_FOUND"
  | "ENCODER_UNAVAILABLE"
  | "STEM_FETCH_FAILED"
  | "STEM_TOO_LARGE"
  | "STEM_HASH_MISMATCH"
  | "STEM_PROBE_FAILED"
  | "STEM_NO_VIDEO_STREAM"
  | "STEM_DURATION_OUT_OF_TOLERANCE"
  | "FFMPEG_EXECUTION_FAILED"
  | "OUTPUT_PROBE_FAILED"
  | "OUTPUT_VALIDATION_FAILED"
  | "UNSUPPORTED_INPUT"
  | "AGGREGATE_INPUT_TOO_LARGE"
  | "OUTPUT_TOO_LARGE"
  | "INPUT_LIMIT_EXCEEDED"
  | "PROCESS_TIMEOUT";

export interface FfmpegAssemblyErrorContext {
  readonly command?: string | undefined;
  readonly args?: readonly string[] | undefined;
  readonly exitCode?: number | null | undefined;
  readonly stderr?: string | undefined;
  readonly stemOrder?: number | undefined;
  readonly stemSceneId?: string | undefined;
  readonly expectedSha256?: string | undefined;
  readonly actualSha256?: string | undefined;
  readonly expectedDurationMs?: number | undefined;
  readonly actualDurationMs?: number | undefined;
  readonly toleranceMs?: number | undefined;
  readonly details?: unknown;
}

export class FfmpegAssemblyError extends Error {
  override readonly name = "FfmpegAssemblyError";

  constructor(
    readonly code: FfmpegAssemblyFailureCode,
    message: string,
    readonly context: FfmpegAssemblyErrorContext = {}
  ) {
    super(message);
  }
}
