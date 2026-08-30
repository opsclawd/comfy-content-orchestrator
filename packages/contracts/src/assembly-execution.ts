import { z } from "zod";
import {
  AssemblyTimelineDecisionSchema,
  validateExecutedAssemblyInvariants,
  type AssemblyTimelineDecision
} from "./assembly-execution-invariants.js";
import {
  AssemblyLayoutModeSchema,
  AssemblyProfileIdentitySchema,
  VERTICAL_REEL_1080X1920_V1_PROFILE,
  type AssemblyLayoutMode,
  type AssemblyProfileIdentity
} from "./assembly-profile.js";
import {
  ExecutedSoundbedRefSchema,
  ExecutedVoiceoverRefSchema,
  type ExecutedSoundbedRef,
  type ExecutedVoiceoverRef
} from "./audio-asset.js";
import { deepFreeze } from "./deep-freeze.js";
import {
  PersistentMediaRefSchema,
  sha256HashSchema,
  type PersistentMediaRef
} from "./persistent-media.js";
import { SubtitleCueSchema, hashSubtitleCues, type SubtitleCue } from "./subtitle-cue.js";
import { ExecutedVideoStemRefSchema, type ExecutedVideoStemRef } from "./video-stem.js";

export { AssemblyTimelineDecisionSchema, type AssemblyTimelineDecision };

export const AssemblyFfmpegMetadataSchema = z.object({
  executable: z.string().min(1, "FFmpeg executable must not be empty"),
  version: z.string().min(1, "FFmpeg version must not be empty"),
  buildInfo: z.string().min(1, "FFmpeg buildInfo must not be empty")
});
export type AssemblyFfmpegMetadata = {
  readonly executable: string;
  readonly version: string;
  readonly buildInfo: string;
};

export const ExecutedAssemblyInputsSchema = z.object({
  videoStems: z.array(ExecutedVideoStemRefSchema).min(1, "At least one video stem is required"),
  voiceover: ExecutedVoiceoverRefSchema.optional(),
  soundbed: ExecutedSoundbedRefSchema.optional()
});
export type ExecutedAssemblyInputs = {
  readonly videoStems: readonly ExecutedVideoStemRef[];
  readonly voiceover?: ExecutedVoiceoverRef | undefined;
  readonly soundbed?: ExecutedSoundbedRef | undefined;
};

export const AssemblyExecutionResultSchema = z
  .object({
    assemblyId: z.string().min(1, "assemblyId must not be empty"),
    campaignId: z.string().min(1, "campaignId must not be empty"),
    assemblyProfile: AssemblyProfileIdentitySchema,
    executedInputs: ExecutedAssemblyInputsSchema,
    timeline: AssemblyTimelineDecisionSchema,
    layout: z.object({
      mode: AssemblyLayoutModeSchema
    }),
    subtitleCuesSha256: sha256HashSchema,
    subtitleCues: z.array(SubtitleCueSchema).optional(),
    subtitleStyleProfile: z.string().min(1, "subtitleStyleProfile must not be empty").optional(),
    ffmpeg: AssemblyFfmpegMetadataSchema,
    commandFingerprint: sha256HashSchema,
    output: z.object({
      media: PersistentMediaRefSchema,
      durationMs: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }),
    measuredFrameRate: z.number().positive("measuredFrameRate must be positive"),
    executionDurationMs: z
      .number()
      .int("executionDurationMs must be an integer")
      .positive("executionDurationMs must be positive")
  })
  .superRefine((res, ctx) => {
    // Stem ordering: contiguous 0..n-1
    const orders = res.executedInputs.videoStems.map((s) => s.order);
    const seen = new Set<number>();
    let hasDuplicates = false;
    for (const order of orders) {
      if (seen.has(order)) {
        hasDuplicates = true;
        break;
      }
      seen.add(order);
    }
    const sorted = [...orders].sort((a, b) => a - b);
    const isContiguous = sorted.every((val, idx) => val === idx);
    if (hasDuplicates || !isContiguous) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "executedInputs.videoStems order must be contiguous 0..n-1 without duplicates or gaps",
        path: ["executedInputs", "videoStems"]
      });
    }

    // Shared executed-state invariant validation
    validateExecutedAssemblyInvariants(
      {
        timeline: res.timeline,
        inputs: res.executedInputs,
        output: res.output,
        subtitleCues: res.subtitleCues
      },
      ctx,
      { inputsKey: "executedInputs" }
    );

    // Subtitle cues hash check: deterministic canonical hash must match (including NO_SUBTITLE_CUES_SHA256 when cues are omitted/empty)
    const expectedSubtitleHash = hashSubtitleCues(res.subtitleCues);
    if (res.subtitleCuesSha256 !== expectedSubtitleHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `subtitleCuesSha256 ("${res.subtitleCuesSha256}") does not match computed hash of subtitleCues ("${expectedSubtitleHash}")`,
        path: ["subtitleCuesSha256"]
      });
    }

    // Profile-aware checks:
    if (res.assemblyProfile.key === "VERTICAL_REEL_1080X1920_V1") {
      if (res.layout.mode !== "fit_blurred_fill") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires layout mode "fit_blurred_fill", got "${res.layout.mode}"`,
          path: ["layout", "mode"]
        });
      }
      if (res.output.width !== 1080) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires output width 1080, got ${res.output.width}`,
          path: ["output", "width"]
        });
      }
      if (res.output.height !== 1920) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires output height 1920, got ${res.output.height}`,
          path: ["output", "height"]
        });
      }
      if (res.output.media.contentType !== "video/mp4") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires output contentType "video/mp4", got "${res.output.media.contentType}"`,
          path: ["output", "media", "contentType"]
        });
      }
      if (res.measuredFrameRate !== VERTICAL_REEL_1080X1920_V1_PROFILE.frameRate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires measuredFrameRate ${VERTICAL_REEL_1080X1920_V1_PROFILE.frameRate}, got ${res.measuredFrameRate}`,
          path: ["measuredFrameRate"]
        });
      }
    }
  })
  .transform((val) => deepFreeze(val));

export type AssemblyExecutionResult = {
  readonly assemblyId: string;
  readonly campaignId: string;
  readonly assemblyProfile: AssemblyProfileIdentity;
  readonly executedInputs: ExecutedAssemblyInputs;
  readonly timeline: AssemblyTimelineDecision;
  readonly layout: {
    readonly mode: AssemblyLayoutMode;
  };
  readonly subtitleCuesSha256: string;
  readonly subtitleCues?: readonly SubtitleCue[] | undefined;
  readonly subtitleStyleProfile?: string | undefined;
  readonly ffmpeg: AssemblyFfmpegMetadata;
  readonly commandFingerprint: string;
  readonly output: {
    readonly media: PersistentMediaRef;
    readonly durationMs: number;
    readonly width: number;
    readonly height: number;
  };
  readonly measuredFrameRate: number;
  readonly executionDurationMs: number;
};
