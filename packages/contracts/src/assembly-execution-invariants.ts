import { z } from "zod";
import type { ExecutedSoundbedRef, ExecutedVoiceoverRef } from "./audio-asset.js";
import { type SubtitleCue, validateSubtitleTimeline } from "./subtitle-cue.js";
import type { ExecutedVideoStemRef } from "./video-stem.js";

/**
 * Phase 1 tolerance in milliseconds for container/codec timing variations
 * (e.g. keyframe rounding at 30fps) when comparing measured output duration
 * to the executed timeline total duration.
 */
export const ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS = 250;

export const AssemblyTimelineDecisionSchema = z.object({
  totalDurationMs: z.number().int().positive("totalDurationMs must be positive"),
  stemDurationsMs: z.array(z.number().int().positive()).min(1, "stemDurationsMs must not be empty")
});
export type AssemblyTimelineDecision = {
  readonly totalDurationMs: number;
  readonly stemDurationsMs: readonly number[];
};

export interface ExecutedAssemblyInvariantInputs {
  readonly videoStems: readonly ExecutedVideoStemRef[];
  readonly voiceover?: ExecutedVoiceoverRef | undefined;
  readonly soundbed?: ExecutedSoundbedRef | undefined;
}

export interface ExecutedAssemblyInvariantPayload {
  readonly timeline: AssemblyTimelineDecision;
  readonly inputs: ExecutedAssemblyInvariantInputs;
  readonly output: {
    readonly durationMs: number;
  };
  readonly subtitleCues?: readonly SubtitleCue[] | undefined;
}

export interface ValidateExecutedAssemblyInvariantsOptions {
  readonly inputsKey?: "executedInputs" | "inputs";
}

/**
 * Validates cross-field invariants for executed assembly payloads, shared between
 * AssemblyExecutionResultSchema and AssemblyManifestSchema to prevent provenance drift.
 */
export function validateExecutedAssemblyInvariants(
  payload: ExecutedAssemblyInvariantPayload,
  ctx: z.RefinementCtx,
  options: ValidateExecutedAssemblyInvariantsOptions = {}
): void {
  const inputsKey = options.inputsKey ?? "executedInputs";

  // 1. Stem count equality: timeline stem count must match inputs.videoStems count
  if (payload.timeline.stemDurationsMs.length !== payload.inputs.videoStems.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `timeline.stemDurationsMs length (${payload.timeline.stemDurationsMs.length}) does not match ${inputsKey}.videoStems length (${payload.inputs.videoStems.length})`,
      path: ["timeline", "stemDurationsMs"]
    });
  }

  // 2. Stem duration equality: for each stem, timeline.stemDurationsMs[stem.order] === stem.actualDurationMs
  for (const stem of payload.inputs.videoStems) {
    if (stem.order >= 0 && stem.order < payload.timeline.stemDurationsMs.length) {
      const timelineDuration = payload.timeline.stemDurationsMs[stem.order];
      if (timelineDuration !== stem.actualDurationMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `timeline.stemDurationsMs[${stem.order}] (${timelineDuration}) does not match video stem (order ${stem.order}) actualDurationMs (${stem.actualDurationMs})`,
          path: ["timeline", "stemDurationsMs", stem.order]
        });
      }
    }
  }

  // 3. Phase 1 total duration composition rule: totalDurationMs === sum(stemDurationsMs)
  const stemDurationsSum = payload.timeline.stemDurationsMs.reduce((acc, d) => acc + d, 0);
  if (payload.timeline.totalDurationMs !== stemDurationsSum) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `timeline.totalDurationMs (${payload.timeline.totalDurationMs}) must match sum of stemDurationsMs (${stemDurationsSum})`,
      path: ["timeline", "totalDurationMs"]
    });
  }

  // 4. Output duration tolerance: Math.abs(output.durationMs - timeline.totalDurationMs) <= ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
  const durationDifference = Math.abs(payload.output.durationMs - payload.timeline.totalDurationMs);
  if (durationDifference > ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `output.durationMs (${payload.output.durationMs}) deviates from timeline.totalDurationMs (${payload.timeline.totalDurationMs}) by ${durationDifference}ms, exceeding allowed tolerance of ${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms`,
      path: ["output", "durationMs"]
    });
  }

  // 5. Subtitle cues validated against executed timeline totalDurationMs
  if (payload.subtitleCues && payload.subtitleCues.length > 0) {
    try {
      validateSubtitleTimeline(payload.subtitleCues, payload.timeline.totalDurationMs);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (err as Error).message,
        path: ["subtitleCues"]
      });
    }
  }

  // 6. Voiceover executed audio timing provenance and timeline bounds
  if (payload.inputs.voiceover) {
    const vo = payload.inputs.voiceover;
    if (vo.trimStartMs >= vo.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover trimStartMs (${vo.trimStartMs}) must be strictly less than actualDurationMs (${vo.actualDurationMs})`,
        path: [inputsKey, "voiceover", "trimStartMs"]
      });
    }
    const expectedVoDuration =
      vo.padLeadingMs +
      (vo.actualDurationMs - vo.trimStartMs) * (vo.loopCount + 1) +
      vo.padTrailingMs;
    if (vo.effectiveDurationMs !== expectedVoDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover effectiveDurationMs (${vo.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${vo.padLeadingMs}) + (actualDurationMs (${vo.actualDurationMs}) - trimStartMs (${vo.trimStartMs})) * (loopCount (${vo.loopCount}) + 1) + padTrailingMs (${vo.padTrailingMs}) = ${expectedVoDuration}ms`,
        path: [inputsKey, "voiceover", "effectiveDurationMs"]
      });
    }
    const voEndMs = vo.effectiveStartMs + vo.effectiveDurationMs;
    if (voEndMs > payload.timeline.totalDurationMs + ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover effective timing overflows executed timeline: effectiveStartMs (${vo.effectiveStartMs}) + effectiveDurationMs (${vo.effectiveDurationMs}) = ${voEndMs}ms exceeds timeline.totalDurationMs (${payload.timeline.totalDurationMs}) + tolerance (${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms)`,
        path: [inputsKey, "voiceover"]
      });
    }
  }

  // 7. Soundbed executed audio timing provenance and timeline bounds
  if (payload.inputs.soundbed) {
    const sb = payload.inputs.soundbed;
    if (sb.trimStartMs >= sb.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed trimStartMs (${sb.trimStartMs}) must be strictly less than actualDurationMs (${sb.actualDurationMs})`,
        path: [inputsKey, "soundbed", "trimStartMs"]
      });
    }
    const expectedSbDuration =
      sb.padLeadingMs +
      (sb.actualDurationMs - sb.trimStartMs) * (sb.loopCount + 1) +
      sb.padTrailingMs;
    if (sb.effectiveDurationMs !== expectedSbDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed effectiveDurationMs (${sb.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${sb.padLeadingMs}) + (actualDurationMs (${sb.actualDurationMs}) - trimStartMs (${sb.trimStartMs})) * (loopCount (${sb.loopCount}) + 1) + padTrailingMs (${sb.padTrailingMs}) = ${expectedSbDuration}ms`,
        path: [inputsKey, "soundbed", "effectiveDurationMs"]
      });
    }
    const sbEndMs = sb.effectiveStartMs + sb.effectiveDurationMs;
    if (sbEndMs > payload.timeline.totalDurationMs + ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed effective timing overflows executed timeline: effectiveStartMs (${sb.effectiveStartMs}) + effectiveDurationMs (${sb.effectiveDurationMs}) = ${sbEndMs}ms exceeds timeline.totalDurationMs (${payload.timeline.totalDurationMs}) + tolerance (${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms)`,
        path: [inputsKey, "soundbed"]
      });
    }
  }
}
