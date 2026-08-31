import { createHash } from "node:crypto";
import type { AssemblyLayoutMode } from "@cco/contracts";

export const STEM_DURATION_TOLERANCE_MS = 250;
export const DEFAULT_CRF = 23;
export const DEFAULT_PRESET = "veryfast";

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
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=20,setsar=1[bg${i}]`,
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
}

export function buildFfmpegArgs(options: BuildFfmpegArgsOptions): string[] {
  const {
    stagedInputPaths,
    layoutMode,
    outputPath,
    crf = DEFAULT_CRF,
    preset = DEFAULT_PRESET
  } = options;

  const args: string[] = ["-y"];
  for (const inputPath of stagedInputPaths) {
    args.push("-i", inputPath);
  }

  const filterGraph = selectFilterGraph(layoutMode, stagedInputPaths.length);
  args.push(
    "-filter_complex",
    filterGraph,
    "-map",
    "[outv]",
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

export function computeCommandFingerprint(
  args: readonly string[],
  stagedInputPaths: readonly string[],
  outputPath: string
): string {
  const pathToPlaceholder = new Map<string, string>();
  for (let i = 0; i < stagedInputPaths.length; i++) {
    const inputPath = stagedInputPaths[i];
    if (inputPath !== undefined) {
      pathToPlaceholder.set(inputPath, `STEM_${i}`);
    }
  }
  pathToPlaceholder.set(outputPath, "OUTPUT");

  const normalizedArgs = args.map((arg) => pathToPlaceholder.get(arg) ?? arg);
  return createHash("sha256").update(JSON.stringify(normalizedArgs)).digest("hex");
}
