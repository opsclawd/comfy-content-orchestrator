import { type SubtitleCue, SubtitleCueSchema } from "@cco/contracts";
import type { AlignedWord, ConcreteForcedAlignmentPort } from "../ports/forced-alignment-port.js";

export class GenerateSubtitleCuesValidationError extends Error {
  override readonly name = "GenerateSubtitleCuesValidationError";
  readonly details?: readonly string[] | undefined;

  constructor(message: string, details?: readonly string[], options?: ErrorOptions) {
    super(message, options);
    this.details = details;
  }
}

export interface SubtitleCueGroupingOptions {
  readonly maxChars?: number | undefined;
  readonly maxWords?: number | undefined;
  readonly maxCueDurationMs?: number | undefined;
  readonly maxDurationMs?: number | undefined;
}

const DEFAULT_MAX_CHARS = 42;
const DEFAULT_MAX_WORDS = 8;
const DEFAULT_MAX_CUE_DURATION_MS = 4000;

function endsWithSentencePunctuation(word: string): boolean {
  return /[.!?][\s"'”)]*$/.test(word.trim());
}

/**
 * Pure function to group aligned/unaligned words into SubtitleCue items.
 *
 * Enforces:
 * 1. Unaligned words (aligned: false) are interpolated across their bounding window,
 *    never dropped from the caption text (Finding 5 fix).
 * 2. If an unaligned run has a zero-width or narrow window, valid in-bounds intervals
 *    are allocated by borrowing minimal milliseconds from adjacent aligned words
 *    without breaking ordering or bounds.
 * 3. Words starting at or after maxDurationMs are filtered out before grouping,
 *    and words starting strictly before maxDurationMs have their endMs clamped to maxDurationMs.
 * 4. Cues are grouped by soft limits: maxChars (~42), maxWords (~8), maxCueDurationMs (~4000ms),
 *    and prefer breaking after sentence-ending punctuation (.!?).
 * 5. If any candidate words cannot form a standalone valid cue (endMs <= startMs), their text
 *    is attached to an adjacent valid cue so exact transcript preservation is guaranteed.
 * 6. Every emitted cue strictly satisfies SubtitleCueSchema refinement (endMs > startMs).
 */
export function groupWordsIntoSubtitleCues(
  words: readonly AlignedWord[],
  options?: SubtitleCueGroupingOptions
): SubtitleCue[] {
  if (!words || words.length === 0) {
    return [];
  }

  const maxDurationMs = options?.maxDurationMs;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;
  const maxWords = options?.maxWords ?? DEFAULT_MAX_WORDS;
  const maxCueDurationMs = options?.maxCueDurationMs ?? DEFAULT_MAX_CUE_DURATION_MS;

  // If all words are unaligned (total alignment failure), interpolate into a single full-duration cue
  if (words.every((w) => !w.aligned)) {
    const fullText = words.map((w) => w.word).join(" ");
    const duration =
      maxDurationMs !== undefined ? maxDurationMs : Math.max(...words.map((w) => w.endMs), 0);

    if (duration > 0 && fullText.trim().length > 0) {
      return [{ startMs: 0, endMs: duration, text: fullText }];
    }
    return [];
  }

  // 1. Interpolate unaligned words (when at least one word is aligned)
  const interpolatedWords: { word: string; startMs: number; endMs: number; aligned: boolean }[] =
    words.map((w) => ({ ...w }));

  let runStartIdx = -1;
  for (let i = 0; i <= interpolatedWords.length; i++) {
    const isUnaligned = i < interpolatedWords.length && !interpolatedWords[i]!.aligned;

    if (isUnaligned) {
      if (runStartIdx === -1) {
        runStartIdx = i;
      }
    } else {
      if (runStartIdx !== -1) {
        const runEndIdx = i - 1;
        const count = runEndIdx - runStartIdx + 1;

        let windowStart = runStartIdx > 0 ? interpolatedWords[runStartIdx - 1]!.endMs : 0;

        let windowEnd: number;
        if (i < interpolatedWords.length) {
          windowEnd = interpolatedWords[i]!.startMs;
        } else {
          windowEnd =
            maxDurationMs !== undefined
              ? maxDurationMs
              : (interpolatedWords[runStartIdx - 1]?.endMs ?? windowStart);
        }

        if (windowEnd < windowStart) {
          windowEnd = windowStart;
        }

        // If window is zero or narrower than count ms, allocate valid intervals
        // by borrowing minimal milliseconds from adjacent aligned words
        const needed = count - (windowEnd - windowStart);
        if (needed > 0) {
          if (runStartIdx > 0) {
            const pre = interpolatedWords[runStartIdx - 1]!;
            const maxBorrowPre = Math.max(0, pre.endMs - pre.startMs - 1);
            const borrowPre = Math.min(needed, maxBorrowPre);
            pre.endMs -= borrowPre;
            windowStart -= borrowPre;
          }
          const remainingNeeded = count - (windowEnd - windowStart);
          if (remainingNeeded > 0 && i < interpolatedWords.length) {
            const post = interpolatedWords[i]!;
            const maxBorrowPost = Math.max(0, post.endMs - post.startMs - 1);
            const borrowPost = Math.min(remainingNeeded, maxBorrowPost);
            post.startMs += borrowPost;
            windowEnd += borrowPost;
          }
        }

        const span = Math.max(0, windowEnd - windowStart);
        for (let k = 0; k < count; k++) {
          const idx = runStartIdx + k;
          interpolatedWords[idx]!.startMs = windowStart + Math.round((k * span) / count);
          interpolatedWords[idx]!.endMs = windowStart + Math.round(((k + 1) * span) / count);
        }

        runStartIdx = -1;
      }
    }
  }

  // 2. Filter out words starting at or after maxDurationMs, and clamp trailing overruns
  const wordsToGroup: { word: string; startMs: number; endMs: number; aligned: boolean }[] = [];
  if (maxDurationMs !== undefined) {
    for (const w of interpolatedWords) {
      if (w.startMs >= maxDurationMs) {
        continue;
      }
      if (w.endMs > maxDurationMs) {
        wordsToGroup.push({ ...w, endMs: maxDurationMs });
      } else {
        wordsToGroup.push(w);
      }
    }
  } else {
    wordsToGroup.push(...interpolatedWords);
  }

  // 3. Group words into cues
  const candidateCues: SubtitleCue[] = [];
  let currentWords: { word: string; startMs: number; endMs: number }[] = [];
  let pendingPrefixText = "";

  const emitCandidateCue = (wordsToEmit: { word: string; startMs: number; endMs: number }[]) => {
    if (wordsToEmit.length === 0) return;
    const cueStart = wordsToEmit[0]!.startMs;
    const cueEnd = wordsToEmit[wordsToEmit.length - 1]!.endMs;
    const text = wordsToEmit.map((w) => w.word).join(" ");

    if (cueEnd > cueStart) {
      const fullText = pendingPrefixText ? `${pendingPrefixText} ${text}` : text;
      pendingPrefixText = "";
      candidateCues.push({
        startMs: cueStart,
        endMs: cueEnd,
        text: fullText
      });
    } else {
      // Degenerate zero-width candidate: attach text to adjacent valid cue so text is never dropped
      if (candidateCues.length > 0) {
        const prev = candidateCues[candidateCues.length - 1]!;
        candidateCues[candidateCues.length - 1] = {
          ...prev,
          text: `${prev.text} ${text}`
        };
      } else {
        pendingPrefixText = pendingPrefixText ? `${pendingPrefixText} ${text}` : text;
      }
    }
  };

  for (const word of wordsToGroup) {
    if (currentWords.length === 0) {
      currentWords.push(word);
      continue;
    }

    const lastWord = currentWords[currentWords.length - 1]!;
    const wouldBreakOnPunctuation = endsWithSentencePunctuation(lastWord.word);
    const candidateWordsCount = currentWords.length + 1;
    const candidateText = [...currentWords.map((w) => w.word), word.word].join(" ");
    const candidateDuration = word.endMs - currentWords[0]!.startMs;

    if (
      wouldBreakOnPunctuation ||
      candidateWordsCount > maxWords ||
      candidateText.length > maxChars ||
      candidateDuration > maxCueDurationMs
    ) {
      emitCandidateCue(currentWords);
      currentWords = [word];
    } else {
      currentWords.push(word);
    }
  }

  if (currentWords.length > 0) {
    emitCandidateCue(currentWords);
  }

  // Attach any leftover pendingPrefixText to the last cue, or emit a fallback cue
  if (pendingPrefixText) {
    if (candidateCues.length > 0) {
      const prev = candidateCues[candidateCues.length - 1]!;
      candidateCues[candidateCues.length - 1] = {
        ...prev,
        text: `${prev.text} ${pendingPrefixText}`
      };
      pendingPrefixText = "";
    } else {
      const duration = maxDurationMs !== undefined && maxDurationMs > 0 ? maxDurationMs : 1;
      candidateCues.push({
        startMs: 0,
        endMs: duration,
        text: pendingPrefixText
      });
      pendingPrefixText = "";
    }
  }

  // 4. Invariant check: filter out any degenerate cue where endMs <= startMs
  return candidateCues.filter((cue) => cue.endMs > cue.startMs);
}

export class GenerateSubtitleCues {
  constructor(
    private readonly deps: {
      readonly forcedAlignment: ConcreteForcedAlignmentPort;
    }
  ) {}

  async generate(params: {
    readonly audio: Uint8Array;
    readonly text: string;
    readonly voiceoverStartMs: number;
    readonly voiceoverDurationMs: number;
    readonly language?: string | undefined;
    readonly cueOptions?: SubtitleCueGroupingOptions | undefined;
  }): Promise<SubtitleCue[]> {
    const errors: string[] = [];

    if (!params.text || params.text.trim().length === 0) {
      errors.push("text must not be empty");
    }
    if (!params.audio || params.audio.byteLength === 0) {
      errors.push("audio must not be empty");
    }
    if (
      typeof params.voiceoverStartMs !== "number" ||
      !Number.isInteger(params.voiceoverStartMs) ||
      params.voiceoverStartMs < 0
    ) {
      errors.push(
        `voiceoverStartMs must be a non-negative integer, got ${
          typeof params.voiceoverStartMs === "number"
            ? params.voiceoverStartMs
            : JSON.stringify(params.voiceoverStartMs)
        }`
      );
    }
    if (
      typeof params.voiceoverDurationMs !== "number" ||
      !Number.isInteger(params.voiceoverDurationMs) ||
      params.voiceoverDurationMs <= 0
    ) {
      errors.push(
        `voiceoverDurationMs must be a positive integer, got ${
          typeof params.voiceoverDurationMs === "number"
            ? params.voiceoverDurationMs
            : JSON.stringify(params.voiceoverDurationMs)
        }`
      );
    }

    if (errors.length > 0) {
      throw new GenerateSubtitleCuesValidationError(
        `GenerateSubtitleCues validation failed: ${errors.join("; ")}`,
        errors
      );
    }

    const alignmentOutput = await this.deps.forcedAlignment.align({
      audio: params.audio,
      text: params.text,
      language: params.language ?? "en"
    });

    const cues = groupWordsIntoSubtitleCues(alignmentOutput.words, {
      ...params.cueOptions,
      maxDurationMs: params.voiceoverDurationMs
    });

    const offsetCues: SubtitleCue[] = cues.map((cue) => {
      const offsetCue = {
        startMs: cue.startMs + params.voiceoverStartMs,
        endMs: cue.endMs + params.voiceoverStartMs,
        text: cue.text
      };
      SubtitleCueSchema.parse(offsetCue);
      return offsetCue;
    });

    return offsetCues;
  }
}
