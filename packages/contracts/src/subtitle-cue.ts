import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";

export const EMPTY_SUBTITLE_CUES_CANONICAL = "[]";
export const EMPTY_SUBTITLE_CUES_SHA256 =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
export const NO_SUBTITLE_CUES_SHA256 = EMPTY_SUBTITLE_CUES_SHA256;

export const SubtitleCueSchema = z
  .object({
    startMs: z
      .number()
      .int("startMs must be an integer")
      .nonnegative("startMs must be non-negative"),
    endMs: z.number().int("endMs must be an integer").nonnegative("endMs must be non-negative"),
    text: z.string().min(1, "Subtitle cue text must not be empty")
  })
  .refine((cue) => cue.endMs > cue.startMs, {
    message: "endMs must be strictly greater than startMs",
    path: ["endMs"]
  });

export type SubtitleCue = {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
};

export function validateSubtitleTimeline(
  cues: readonly SubtitleCue[],
  totalDurationMs: number
): void {
  if (typeof totalDurationMs !== "number" || totalDurationMs <= 0) {
    throw new Error(`Total duration must be a positive number, got ${totalDurationMs}`);
  }

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]!;
    if (cue.startMs < 0) {
      throw new Error(`Subtitle cue at index ${i} has negative startMs: ${cue.startMs}`);
    }
    if (cue.endMs <= cue.startMs) {
      throw new Error(
        `Subtitle cue at index ${i} has endMs (${cue.endMs}) <= startMs (${cue.startMs})`
      );
    }
    if (cue.endMs > totalDurationMs) {
      throw new Error(
        `Subtitle cue at index ${i} overflows timeline: endMs (${cue.endMs}) > totalDurationMs (${totalDurationMs})`
      );
    }
  }
}

export function canonicalizeSubtitleCues(cues?: readonly SubtitleCue[]): string {
  if (!cues || cues.length === 0) {
    return EMPTY_SUBTITLE_CUES_CANONICAL;
  }
  const normalized = cues.map((cue) => ({
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text
  }));
  return JSON.stringify(normalized);
}

// Uses @noble/hashes (pure JS, isomorphic) rather than node:crypto so this
// module stays safe to bundle into browser code — packages/contracts is
// imported by apps/web client components, and node:crypto import cannot be
// resolved there. See PR fixing the apps/web "Review Hub" Docker build.
export function hashSubtitleCues(cues?: readonly SubtitleCue[]): string {
  const canonical = canonicalizeSubtitleCues(cues);
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}
