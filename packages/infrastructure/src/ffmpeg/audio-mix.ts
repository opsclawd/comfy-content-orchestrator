import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

// Documented audio normalization and mixing constants
export const VO_TARGET_INTEGRATED_LUFS = -16.0;
export const VO_TARGET_TRUE_PEAK_DBTP = -1.5;
export const VO_TARGET_LRA = 11.0;
export const SOUNDBED_BASELINE_GAIN_DB = -18.0;
export const SOUNDBED_DUCKING_DB = -12.0;
export const AUDIO_LIMITER_CEILING_LINEAR = 0.89125; // Approx -1.0 dBTP
export const AUDIO_LIMITER_CEILING_DBTP = -1.0; // Documented true-peak target
export const AUDIO_LIMITER_OVERSAMPLE_RATE_HZ = 192000; // 4x oversampling for intersample true-peak safety
export const AUDIO_OUTPUT_SAMPLE_RATE_HZ = 48000;
export const AUDIO_OUTPUT_CHANNELS = 2;
export const AUDIO_OUTPUT_BITRATE_KBPS = 192;

export interface LoudnessAnalysisResult {
  readonly inputIntegratedLufs: number;
  readonly inputTruePeakDbtp: number;
  readonly gainDb: number;
}

export interface AnalyzeLoudnessOptions {
  readonly spawnFn: SpawnLikeFn;
  readonly ffmpegPath: string;
  readonly filePath: string;
  readonly timeoutMs?: number | undefined;
  readonly targetIntegratedLufs?: number | undefined;
}

/**
 * Runs a 1-pass loudnorm analysis on an audio file and parses measured LUFS from ffmpeg stderr.
 */
export async function analyzeLoudness(
  options: AnalyzeLoudnessOptions
): Promise<LoudnessAnalysisResult> {
  const {
    spawnFn,
    ffmpegPath,
    filePath,
    timeoutMs = 15_000,
    targetIntegratedLufs = VO_TARGET_INTEGRATED_LUFS
  } = options;

  const args = [
    "-hide_banner",
    "-nostats",
    "-i",
    filePath,
    "-af",
    `loudnorm=I=${VO_TARGET_INTEGRATED_LUFS}:TP=${VO_TARGET_TRUE_PEAK_DBTP}:LRA=${VO_TARGET_LRA}:print_format=json`,
    "-f",
    "null",
    "-"
  ];

  let runResult;
  try {
    runResult = await spawnFn(ffmpegPath, args, { timeoutMs });
  } catch (err) {
    if (err instanceof FfmpegAssemblyError) throw err;
    throw new FfmpegAssemblyError(
      "AUDIO_ANALYSIS_FAILED",
      `Audio loudness analysis failed: ${(err as Error).message}`,
      { command: ffmpegPath, args }
    );
  }

  if (runResult.exitCode !== 0) {
    throw new FfmpegAssemblyError(
      "AUDIO_ANALYSIS_FAILED",
      `Audio loudness analysis failed with exit code ${runResult.exitCode}: ${runResult.stderr}`,
      { command: ffmpegPath, args, exitCode: runResult.exitCode, stderr: runResult.stderr }
    );
  }

  const startIdx = runResult.stderr.lastIndexOf("{");
  const endIdx = runResult.stderr.lastIndexOf("}");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new FfmpegAssemblyError(
      "AUDIO_ANALYSIS_FAILED",
      "Failed to parse loudnorm analysis JSON from ffmpeg output",
      { stderr: runResult.stderr }
    );
  }

  try {
    const jsonStr = runResult.stderr.slice(startIdx, endIdx + 1);
    const parsed = JSON.parse(jsonStr) as { input_i?: string; input_tp?: string };
    const inputIntegratedLufs = parseFloat(parsed.input_i ?? "0");
    const inputTruePeakDbtp = parseFloat(parsed.input_tp ?? "0");
    const gainDb = computeStaticGainDb(inputIntegratedLufs, targetIntegratedLufs);

    return {
      inputIntegratedLufs,
      inputTruePeakDbtp,
      gainDb
    };
  } catch (err) {
    throw new FfmpegAssemblyError(
      "AUDIO_ANALYSIS_FAILED",
      `Failed to parse loudness analysis output: ${(err as Error).message}`,
      { stderr: runResult.stderr }
    );
  }
}

/**
 * Computes a static gain in dB from measured integrated LUFS to target LUFS.
 */
export function computeStaticGainDb(
  measuredIntegratedLufs: number,
  targetIntegratedLufs: number = VO_TARGET_INTEGRATED_LUFS
): number {
  if (!Number.isFinite(measuredIntegratedLufs) || measuredIntegratedLufs <= -70) {
    return 0;
  }
  const gain = targetIntegratedLufs - measuredIntegratedLufs;
  return Math.round(gain * 100) / 100;
}

/**
 * Computes executed voiceover timing and loop/pad algebra satisfying ExecutedVoiceoverRef invariants.
 */
export function computeExecutedVoiceoverMath(params: {
  readonly actualDurationMs: number;
  readonly targetDurationMs: number;
  readonly startMs: number;
  readonly gainDb: number;
}): {
  readonly trimStartMs: number;
  readonly trimEndMs: number;
  readonly loopCount: number;
  readonly partialLoopDurationMs: number;
  readonly padLeadingMs: number;
  readonly padTrailingMs: number;
  readonly effectiveDurationMs: number;
  readonly effectiveStartMs: number;
  readonly gainDb: number;
} {
  const { actualDurationMs, targetDurationMs, startMs, gainDb } = params;
  // availableTimelineMs is the window this voiceover can actually occupy —
  // buildVoiceoverFilterChain delays the signal by startMs then trims the
  // whole thing to targetDurationMs, so when startMs is at or past
  // targetDurationMs (availableTimelineMs === 0) the real rendered audio is
  // 100% silence. trimEndMs must not fall back to actualDurationMs in that
  // case: doing so previously reported a full-length effectiveDurationMs in
  // the manifest for a voiceover that produces zero seconds of audible
  // output.
  const availableTimelineMs = Math.max(0, targetDurationMs - startMs);
  const trimStartMs = 0;
  const trimEndMs = Math.min(actualDurationMs, availableTimelineMs);
  const sliceDurationMs = trimEndMs - trimStartMs;
  const padLeadingMs = 0;
  const padTrailingMs = Math.max(0, availableTimelineMs - sliceDurationMs);
  const effectiveDurationMs = padLeadingMs + sliceDurationMs + padTrailingMs;

  return {
    trimStartMs,
    trimEndMs,
    loopCount: 1,
    partialLoopDurationMs: 0,
    padLeadingMs,
    padTrailingMs,
    effectiveDurationMs,
    effectiveStartMs: startMs,
    gainDb
  };
}

/**
 * Computes executed soundbed timing and loop/pad algebra satisfying ExecutedSoundbedRef invariants.
 */
export function computeExecutedSoundbedMath(params: {
  readonly actualDurationMs: number;
  readonly targetDurationMs: number;
  readonly startMs: number;
  readonly gainDb: number;
  readonly duckingDb: number;
}): {
  readonly trimStartMs: number;
  readonly trimEndMs: number;
  readonly loopCount: number;
  readonly partialLoopDurationMs: number;
  readonly padLeadingMs: number;
  readonly padTrailingMs: number;
  readonly effectiveDurationMs: number;
  readonly effectiveStartMs: number;
  readonly gainDb: number;
  readonly duckingDb: number;
} {
  const { actualDurationMs, targetDurationMs, startMs, gainDb, duckingDb } = params;
  const activeDurationMs = Math.max(1, targetDurationMs - startMs);
  const sliceDurationMs = actualDurationMs;
  const loopCount = Math.floor(activeDurationMs / sliceDurationMs);
  const partialLoopDurationMs = activeDurationMs % sliceDurationMs;

  return {
    trimStartMs: 0,
    trimEndMs: actualDurationMs,
    loopCount,
    partialLoopDurationMs,
    padLeadingMs: 0,
    padTrailingMs: 0,
    effectiveDurationMs: activeDurationMs,
    effectiveStartMs: startMs,
    gainDb,
    duckingDb
  };
}

export interface VoiceoverFilterChainOptions {
  readonly inputIndex: number;
  readonly startMs: number;
  readonly targetDurationMs: number;
  readonly gainDb: number;
}

/**
 * Builds FFmpeg filter complex fragment for processing voiceover input.
 */
export function buildVoiceoverFilterChain(options: VoiceoverFilterChainOptions): {
  readonly filter: string;
  readonly outputLabel: string;
} {
  const { inputIndex, startMs, targetDurationMs, gainDb } = options;
  const outputLabel = "vo_proc";
  const targetSec = (targetDurationMs / 1000).toFixed(6);
  const parts: string[] = [
    "aformat=channel_layouts=stereo",
    `aresample=${AUDIO_OUTPUT_SAMPLE_RATE_HZ}`,
    `volume=${gainDb.toFixed(2)}dB`
  ];
  if (startMs > 0) {
    parts.push(`adelay=${startMs}|${startMs}`);
  }
  parts.push("apad", `atrim=0:${targetSec}`);

  const filter = `[${inputIndex}:a]${parts.join(",")}[${outputLabel}]`;
  return { filter, outputLabel };
}

export interface SoundbedFilterChainOptions {
  readonly inputIndex: number;
  readonly targetDurationMs: number;
  readonly startMs?: number | undefined;
  readonly gainDb: number;
  readonly duckingDb?: number | undefined;
  readonly voActiveWindowMs?: { readonly startMs: number; readonly durationMs: number } | undefined;
}

/**
 * Builds FFmpeg filter complex fragment for processing soundbed input with looping, trimming, baseline gain, and ducking.
 */
export function buildSoundbedFilterChain(options: SoundbedFilterChainOptions): {
  readonly filter: string;
  readonly outputLabel: string;
} {
  const {
    inputIndex,
    targetDurationMs,
    startMs = 0,
    gainDb,
    duckingDb = 0,
    voActiveWindowMs
  } = options;

  const outputLabel = "sb_proc";
  const activeDurationMs = Math.max(1, targetDurationMs - startMs);
  const activeSec = (activeDurationMs / 1000).toFixed(6);
  const targetSec = (targetDurationMs / 1000).toFixed(6);

  const parts: string[] = [
    "aloop=loop=-1:size=2147483647",
    `atrim=0:${activeSec}`,
    `volume=${gainDb.toFixed(2)}dB`
  ];

  if (startMs > 0) {
    parts.push(`adelay=${startMs}|${startMs}`, "apad", `atrim=0:${targetSec}`);
  }

  if (voActiveWindowMs && duckingDb < 0) {
    const voStartSec = (voActiveWindowMs.startMs / 1000).toFixed(3);
    const voEndSec = ((voActiveWindowMs.startMs + voActiveWindowMs.durationMs) / 1000).toFixed(3);
    const duckingLinear = Math.pow(10, duckingDb / 20).toFixed(6);
    parts.push(`volume=volume=${duckingLinear}:enable='between(t,${voStartSec},${voEndSec})'`);
  }

  parts.push("aformat=channel_layouts=stereo", `aresample=${AUDIO_OUTPUT_SAMPLE_RATE_HZ}`);

  const filter = `[${inputIndex}:a]${parts.join(",")}[${outputLabel}]`;
  return { filter, outputLabel };
}

export interface AudioMixGraphOptions {
  readonly voLabel?: string | undefined;
  readonly sbLabel?: string | undefined;
  readonly finalOutputLabel?: string | undefined;
}

/**
 * Combines processed voiceover and/or soundbed audio labels with mixing and true-peak limiting.
 * Uses 4x oversampling (192 kHz) prior to lookahead limiting (limit=-1.0 dBTP linear 0.89125, asc=1, auto-level disabled)
 * followed by resampling to standard 48 kHz to prevent intersample true-peak clipping in lossy AAC encode.
 */
export function buildAudioMixGraph(options: AudioMixGraphOptions): {
  readonly filter: string;
  readonly outputLabel: string;
} {
  const { voLabel, sbLabel, finalOutputLabel = "outa" } = options;
  const limiterChain = `aresample=${AUDIO_LIMITER_OVERSAMPLE_RATE_HZ},alimiter=limit=${AUDIO_LIMITER_CEILING_LINEAR}:asc=1:level=disabled,aresample=${AUDIO_OUTPUT_SAMPLE_RATE_HZ}`;

  if (voLabel && sbLabel) {
    const filter = `[${voLabel}][${sbLabel}]amix=inputs=2:duration=longest:normalize=0[mixed_audio];[mixed_audio]${limiterChain}[${finalOutputLabel}]`;
    return { filter, outputLabel: finalOutputLabel };
  }
  if (voLabel) {
    const filter = `[${voLabel}]${limiterChain}[${finalOutputLabel}]`;
    return { filter, outputLabel: finalOutputLabel };
  }
  if (sbLabel) {
    const filter = `[${sbLabel}]${limiterChain}[${finalOutputLabel}]`;
    return { filter, outputLabel: finalOutputLabel };
  }

  throw new Error("Cannot build audio mix graph without at least one audio source");
}
