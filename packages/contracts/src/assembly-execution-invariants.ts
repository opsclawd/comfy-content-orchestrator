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

export const VideoEncodingExecutionSchema = z.object({
  codec: z.string().min(1, "codec must not be empty"),
  pixelFormat: z.string().min(1, "pixelFormat must not be empty"),
  crf: z.number().int().nonnegative("crf must be non-negative").optional(),
  preset: z.string().min(1, "preset must not be empty").optional()
});
export type VideoEncodingExecution = {
  readonly codec: string;
  readonly pixelFormat: string;
  readonly crf?: number | undefined;
  readonly preset?: string | undefined;
};

export const AudioEncodingExecutionSchema = z.object({
  codec: z.string().min(1, "codec must not be empty"),
  bitrateKbps: z.number().int().positive("bitrateKbps must be positive"),
  sampleRateHz: z.number().int().positive("sampleRateHz must be positive"),
  channels: z.number().int().positive("channels must be positive")
});
export type AudioEncodingExecution = {
  readonly codec: string;
  readonly bitrateKbps: number;
  readonly sampleRateHz: number;
  readonly channels: number;
};

export const AssemblyEncodingExecutionSchema = z.object({
  video: VideoEncodingExecutionSchema,
  audio: AudioEncodingExecutionSchema.optional()
});
export type AssemblyEncodingExecution = {
  readonly video: VideoEncodingExecution;
  readonly audio?: AudioEncodingExecution | undefined;
};

export const MeasuredVideoStreamSchema = z.object({
  codecName: z.string().min(1, "codecName must not be empty"),
  pixelFormat: z.string().min(1, "pixelFormat must not be empty"),
  width: z.number().int().positive("width must be positive"),
  height: z.number().int().positive("height must be positive"),
  frameRate: z.number().positive("frameRate must be positive"),
  durationMs: z.number().int().positive("durationMs must be positive")
});
export type MeasuredVideoStream = {
  readonly codecName: string;
  readonly pixelFormat: string;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly durationMs: number;
};

export const MeasuredAudioStreamSchema = z.object({
  codecName: z.string().min(1, "codecName must not be empty"),
  sampleRateHz: z.number().int().positive("sampleRateHz must be positive"),
  channels: z.number().int().positive("channels must be positive"),
  durationMs: z.number().int().positive("durationMs must be positive"),
  bitrateKbps: z.number().int().positive("bitrateKbps must be positive").optional()
});
export type MeasuredAudioStream = {
  readonly codecName: string;
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly durationMs: number;
  readonly bitrateKbps?: number | undefined;
};

export const MeasuredOutputStreamsSchema = z.object({
  video: MeasuredVideoStreamSchema,
  audio: MeasuredAudioStreamSchema.optional()
});
export type MeasuredOutputStreams = {
  readonly video: MeasuredVideoStream;
  readonly audio?: MeasuredAudioStream | undefined;
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
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  };
  readonly encoding?: AssemblyEncodingExecution | undefined;
  readonly streams?: MeasuredOutputStreams | undefined;
  readonly subtitleCues?: readonly SubtitleCue[] | undefined;
  readonly subtitleStyleProfile?: string | undefined;
  readonly measuredFrameRate?: number | undefined;
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

  // 5. Subtitle cues validated against executed timeline totalDurationMs & subtitle style profile required when cues present
  if (payload.subtitleCues && payload.subtitleCues.length > 0) {
    if (!payload.subtitleStyleProfile || payload.subtitleStyleProfile.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "subtitleStyleProfile is required when subtitleCues are present",
        path: ["subtitleStyleProfile"]
      });
    }
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
    const trimEnd = vo.trimEndMs ?? vo.actualDurationMs;
    if (vo.trimEndMs !== undefined && vo.trimEndMs > vo.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover trimEndMs (${vo.trimEndMs}) cannot exceed actualDurationMs (${vo.actualDurationMs})`,
        path: [inputsKey, "voiceover", "trimEndMs"]
      });
    }
    if (vo.trimStartMs >= trimEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover trimStartMs (${vo.trimStartMs}) must be strictly less than trimEndMs/actualDurationMs (${trimEnd})`,
        path: [inputsKey, "voiceover", "trimStartMs"]
      });
    }
    const sliceDurationMs = trimEnd - vo.trimStartMs;
    const partialLoopMs = vo.partialLoopDurationMs ?? 0;
    if (partialLoopMs >= sliceDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover partialLoopDurationMs (${partialLoopMs}) must be strictly less than sliceDurationMs (${sliceDurationMs})`,
        path: [inputsKey, "voiceover", "partialLoopDurationMs"]
      });
    }
    if (vo.loopCount === 0 && partialLoopMs === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "voiceover loopCount and partialLoopDurationMs cannot both be 0",
        path: [inputsKey, "voiceover", "loopCount"]
      });
    }
    const expectedVoDuration =
      vo.padLeadingMs + (sliceDurationMs * vo.loopCount + partialLoopMs) + vo.padTrailingMs;
    if (vo.effectiveDurationMs !== expectedVoDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `voiceover effectiveDurationMs (${vo.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${vo.padLeadingMs}) + (${sliceDurationMs} * ${vo.loopCount} + ${partialLoopMs}) + padTrailingMs (${vo.padTrailingMs}) = ${expectedVoDuration}ms`,
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
    const trimEnd = sb.trimEndMs ?? sb.actualDurationMs;
    if (sb.trimEndMs !== undefined && sb.trimEndMs > sb.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed trimEndMs (${sb.trimEndMs}) cannot exceed actualDurationMs (${sb.actualDurationMs})`,
        path: [inputsKey, "soundbed", "trimEndMs"]
      });
    }
    if (sb.trimStartMs >= trimEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed trimStartMs (${sb.trimStartMs}) must be strictly less than trimEndMs/actualDurationMs (${trimEnd})`,
        path: [inputsKey, "soundbed", "trimStartMs"]
      });
    }
    const sliceDurationMs = trimEnd - sb.trimStartMs;
    const partialLoopMs = sb.partialLoopDurationMs ?? 0;
    if (partialLoopMs >= sliceDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed partialLoopDurationMs (${partialLoopMs}) must be strictly less than sliceDurationMs (${sliceDurationMs})`,
        path: [inputsKey, "soundbed", "partialLoopDurationMs"]
      });
    }
    if (sb.loopCount === 0 && partialLoopMs === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "soundbed loopCount and partialLoopDurationMs cannot both be 0",
        path: [inputsKey, "soundbed", "loopCount"]
      });
    }
    const expectedSbDuration =
      sb.padLeadingMs + (sliceDurationMs * sb.loopCount + partialLoopMs) + sb.padTrailingMs;
    if (sb.effectiveDurationMs !== expectedSbDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `soundbed effectiveDurationMs (${sb.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${sb.padLeadingMs}) + (${sliceDurationMs} * ${sb.loopCount} + ${partialLoopMs}) + padTrailingMs (${sb.padTrailingMs}) = ${expectedSbDuration}ms`,
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

  // 8. Executed audio provenance requirement
  const hasExecutedAudio = Boolean(payload.inputs.voiceover || payload.inputs.soundbed);
  if (hasExecutedAudio) {
    if (payload.encoding && !payload.encoding.audio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "encoding.audio is required when voiceover or soundbed is executed",
        path: ["encoding", "audio"]
      });
    }
    if (payload.streams && !payload.streams.audio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "streams.audio is required when voiceover or soundbed is executed",
        path: ["streams", "audio"]
      });
    }
  }

  // 9. Measured streams cross-validation
  if (payload.streams) {
    const { video, audio } = payload.streams;
    const videoDurationDiff = Math.abs(video.durationMs - payload.timeline.totalDurationMs);
    if (videoDurationDiff > ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `streams.video.durationMs (${video.durationMs}) deviates from timeline.totalDurationMs (${payload.timeline.totalDurationMs}) by ${videoDurationDiff}ms, exceeding allowed tolerance of ${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms`,
        path: ["streams", "video", "durationMs"]
      });
    }
    if (audio) {
      const audioDurationDiff = Math.abs(audio.durationMs - payload.timeline.totalDurationMs);
      if (audioDurationDiff > ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `streams.audio.durationMs (${audio.durationMs}) deviates from timeline.totalDurationMs (${payload.timeline.totalDurationMs}) by ${audioDurationDiff}ms, exceeding allowed tolerance of ${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms`,
          path: ["streams", "audio", "durationMs"]
        });
      }
    }
    if (payload.output.width !== undefined && video.width !== payload.output.width) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `streams.video.width (${video.width}) does not match output.width (${payload.output.width})`,
        path: ["streams", "video", "width"]
      });
    }
    if (payload.output.height !== undefined && video.height !== payload.output.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `streams.video.height (${video.height}) does not match output.height (${payload.output.height})`,
        path: ["streams", "video", "height"]
      });
    }
    if (
      payload.measuredFrameRate !== undefined &&
      Math.abs(video.frameRate - payload.measuredFrameRate) > 0.01
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `streams.video.frameRate (${video.frameRate}) does not match measuredFrameRate (${payload.measuredFrameRate})`,
        path: ["streams", "video", "frameRate"]
      });
    }
  }
}
