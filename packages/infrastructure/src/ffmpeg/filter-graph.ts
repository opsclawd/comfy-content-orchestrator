import { createHash } from "node:crypto";
import type { AssemblyLayoutMode } from "@cco/contracts";
import { escapeFfmpegFilterPath } from "./subtitle-renderer.js";

export const STEM_DURATION_TOLERANCE_MS = 250;
export const DEFAULT_CRF = 23;
export const DEFAULT_PRESET = "veryfast";
export const FIT_BLURRED_FILL_BLUR_SIGMA = 20;

/**
 * Builds the filter_complex string for fit_blurred_fill mode.
 *
 * For each input stem i:
 * 1. Background: scale to 1080x1920 with increase ratio, crop to 1080x1920, apply gblur sigma=20, setsar=1
 * 2. Foreground: scale to 1080:-2 with decrease ratio, setsar=1
 * 3. Overlay: center (W-w)/2:(H-h)/2, shortest=1, fps=30, format=yuv420p
 *
 * Then concatenate all stems in order.
 */
export function buildFitBlurredFillGraph(stemCount: number): string {
  if (stemCount <= 0) {
    throw new Error("stemCount must be at least 1");
  }
  const parts: string[] = [];
  const vLabels: string[] = [];

  for (let i = 0; i < stemCount; i++) {
    parts.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=${FIT_BLURRED_FILL_BLUR_SIGMA},setsar=1[bg${i}]`,
      `[${i}:v]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg${i}]`,
      `[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2:shortest=1,fps=30,format=yuv420p[v${i}]`
    );
    vLabels.push(`[v${i}]`);
  }

  parts.push(`${vLabels.join("")}concat=n=${stemCount}:v=1:a=0[outv]`);
  return parts.join(";");
}

/**
 * Builds the filter_complex string for direct_fit mode.
 */
export function buildDirectFitGraph(stemCount: number): string {
  if (stemCount <= 0) {
    throw new Error("stemCount must be at least 1");
  }
  const parts: string[] = [];
  const vLabels: string[] = [];

  for (let i = 0; i < stemCount; i++) {
    parts.push(`[${i}:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`);
    vLabels.push(`[v${i}]`);
  }

  parts.push(`${vLabels.join("")}concat=n=${stemCount}:v=1:a=0[outv]`);
  return parts.join(";");
}

export function selectFilterGraph(layoutMode: AssemblyLayoutMode, stemCount: number): string {
  if (layoutMode === "fit_blurred_fill") {
    return buildFitBlurredFillGraph(stemCount);
  }
  if (layoutMode === "direct_fit") {
    return buildDirectFitGraph(stemCount);
  }
  throw new Error(`Unsupported layout mode: ${layoutMode}`);
}

export interface BuildFfmpegArgsOptions {
  readonly stagedInputPaths: readonly string[];
  readonly layoutMode: AssemblyLayoutMode;
  readonly outputPath: string;
  readonly crf?: number | undefined;
  readonly preset?: string | undefined;
  readonly stagedVoiceoverPath?: string | undefined;
  readonly stagedSoundbedPath?: string | undefined;
  readonly audioFilterGraph?: string | undefined;
  readonly subtitleAssPath?: string | undefined;
  readonly audioEncoding?:
    | {
        readonly codec?: string | undefined;
        readonly bitrateKbps?: number | undefined;
        readonly sampleRateHz?: number | undefined;
        readonly channels?: number | undefined;
      }
    | undefined;
}

export function buildFfmpegArgs(options: BuildFfmpegArgsOptions): string[] {
  const {
    stagedInputPaths,
    layoutMode,
    outputPath,
    crf = DEFAULT_CRF,
    preset = DEFAULT_PRESET,
    stagedVoiceoverPath,
    stagedSoundbedPath,
    audioFilterGraph,
    subtitleAssPath,
    audioEncoding
  } = options;

  const args: string[] = ["-y"];

  // Add video inputs
  for (const inputPath of stagedInputPaths) {
    args.push("-i", inputPath);
  }

  // Add optional audio inputs
  if (stagedVoiceoverPath) {
    args.push("-i", stagedVoiceoverPath);
  }
  if (stagedSoundbedPath) {
    args.push("-i", stagedSoundbedPath);
  }

  // Build filter_complex
  const videoGraph = selectFilterGraph(layoutMode, stagedInputPaths.length);
  let fullVideoGraph = videoGraph;
  let videoOutputLabel = "[outv]";

  if (subtitleAssPath) {
    const escapedAssPath = escapeFfmpegFilterPath(subtitleAssPath);
    fullVideoGraph = `${videoGraph};[outv]ass=filename='${escapedAssPath}'[outv_sub]`;
    videoOutputLabel = "[outv_sub]";
  }

  const filterComplexParts = [fullVideoGraph];
  if (audioFilterGraph) {
    filterComplexParts.push(audioFilterGraph);
  }

  args.push(
    "-filter_complex",
    filterComplexParts.join(";"),
    "-map",
    videoOutputLabel,
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30"
  );

  if (crf !== undefined) {
    args.push("-crf", String(crf));
  }

  if (audioFilterGraph) {
    const codec = audioEncoding?.codec ?? "aac";
    const bitrateKbps = audioEncoding?.bitrateKbps ?? 192;
    const sampleRateHz = audioEncoding?.sampleRateHz ?? 48000;
    const channels = audioEncoding?.channels ?? 2;

    args.push(
      "-map",
      "[outa]",
      "-c:a",
      codec,
      "-b:a",
      `${bitrateKbps}k`,
      "-ar",
      String(sampleRateHz),
      "-ac",
      String(channels)
    );
  }

  args.push(
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    "-metadata:s:v:0",
    "rotate=0",
    outputPath
  );

  return args;
}

export interface ComputeCommandFingerprintOptions {
  readonly stagedVoiceoverPath?: string | undefined;
  readonly stagedSoundbedPath?: string | undefined;
  readonly subtitleAssPath?: string | undefined;
}

export function computeCommandFingerprint(
  args: readonly string[],
  stagedInputPaths: readonly string[],
  outputPath: string,
  extraOptions: ComputeCommandFingerprintOptions = {}
): string {
  const pathToPlaceholder = new Map<string, string>();
  for (let i = 0; i < stagedInputPaths.length; i++) {
    const inputPath = stagedInputPaths[i];
    if (inputPath !== undefined) {
      pathToPlaceholder.set(inputPath, `STEM_${i}`);
    }
  }
  if (extraOptions.stagedVoiceoverPath) {
    pathToPlaceholder.set(extraOptions.stagedVoiceoverPath, "VOICEOVER");
  }
  if (extraOptions.stagedSoundbedPath) {
    pathToPlaceholder.set(extraOptions.stagedSoundbedPath, "SOUNDBED");
  }
  if (extraOptions.subtitleAssPath) {
    pathToPlaceholder.set(extraOptions.subtitleAssPath, "SUBTITLES_ASS");
    // Also add escaped version of subtitle path
    pathToPlaceholder.set(escapeFfmpegFilterPath(extraOptions.subtitleAssPath), "SUBTITLES_ASS");
  }
  pathToPlaceholder.set(outputPath, "OUTPUT");

  const normalizedArgs = args.map((arg) => {
    let normalized = arg;
    for (const [rawPath, placeholder] of pathToPlaceholder.entries()) {
      if (normalized.includes(rawPath)) {
        normalized = normalized.split(rawPath).join(placeholder);
      }
    }
    return normalized;
  });

  return createHash("sha256").update(JSON.stringify(normalizedArgs)).digest("hex");
}
