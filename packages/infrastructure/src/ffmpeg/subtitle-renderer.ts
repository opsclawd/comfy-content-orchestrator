import type { SubtitleCue } from "@cco/contracts";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";

export const SUBTITLE_STYLE_PROFILE_ID = "VERTICAL_REEL_CENTER_V1";
export const MAX_CUE_DURATION_MS = 10_000; // 10 seconds max duration per cue

export const DEFAULT_SUBTITLE_PLAY_RES_X = 1080;
export const DEFAULT_SUBTITLE_PLAY_RES_Y = 1920;
export const DEFAULT_SUBTITLE_FONT_SIZE = 52;
export const DEFAULT_SUBTITLE_MARGIN_V = 320; // ~16.7% bottom safe area for social UI chrome
export const DEFAULT_SUBTITLE_OUTLINE = 3;
export const DEFAULT_SUBTITLE_SHADOW = 1;

/**
 * Escapes user text for inclusion in an ASS dialogue line.
 * Replaces backslashes, braces, and converts newlines to the ASS \N sequence.
 */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r\n|\r|\n/g, "\\N");
}

/**
 * Formats a duration in milliseconds to ASS timestamp format: H:MM:SS.cc
 */
export function formatAssTimestamp(ms: number): string {
  if (ms < 0) {
    throw new Error(`Subtitle timestamp cannot be negative: ${ms}`);
  }
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centiseconds = Math.floor((ms % 1000) / 10);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const cc = String(centiseconds).padStart(2, "0");

  return `${hours}:${mm}:${ss}.${cc}`;
}

export interface BuildAssDocumentOptions {
  readonly playResX?: number | undefined;
  readonly playResY?: number | undefined;
  readonly fontSize?: number | undefined;
  readonly marginV?: number | undefined;
  readonly maxCueDurationMs?: number | undefined;
}

/**
 * Builds a deterministic ASS document string from validated SubtitleCue array.
 */
export function buildAssDocument(
  cues: readonly SubtitleCue[],
  options: BuildAssDocumentOptions = {}
): string {
  const {
    playResX = DEFAULT_SUBTITLE_PLAY_RES_X,
    playResY = DEFAULT_SUBTITLE_PLAY_RES_Y,
    fontSize = DEFAULT_SUBTITLE_FONT_SIZE,
    marginV = DEFAULT_SUBTITLE_MARGIN_V,
    maxCueDurationMs = MAX_CUE_DURATION_MS
  } = options;

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    const duration = cue.endMs - cue.startMs;
    if (duration > maxCueDurationMs) {
      throw new FfmpegAssemblyError(
        "SUBTITLE_RENDER_FAILED",
        `Subtitle cue at index ${i} duration ${duration}ms exceeds maximum allowed cue duration of ${maxCueDurationMs}ms`,
        { details: { cueIndex: i, durationMs: duration, maxCueDurationMs } }
      );
    }
  }

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${DEFAULT_SUBTITLE_OUTLINE},${DEFAULT_SUBTITLE_SHADOW},2,80,80,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ];

  for (const cue of cues) {
    const startStr = formatAssTimestamp(cue.startMs);
    const endStr = formatAssTimestamp(cue.endMs);
    const escapedText = escapeAssText(cue.text);
    lines.push(`Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${escapedText}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Escapes file paths for safe usage in FFmpeg filter parameters.
 */
export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}
