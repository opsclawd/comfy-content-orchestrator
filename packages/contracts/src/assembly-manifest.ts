import { z } from "zod";
import type { AssemblyExecutionResult } from "./assembly-execution.js";
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

export const AssemblyManifestFfmpegSchema = z.object({
  executable: z.string().min(1, "FFmpeg executable must not be empty"),
  version: z.string().min(1, "FFmpeg version must not be empty"),
  buildInfo: z.string().min(1, "FFmpeg buildInfo must not be empty")
});
export type AssemblyManifestFfmpeg = {
  readonly executable: string;
  readonly version: string;
  readonly buildInfo: string;
};

export const AssemblyManifestInputsSchema = z.object({
  videoStems: z.array(ExecutedVideoStemRefSchema).min(1, "At least one video stem is required"),
  voiceover: ExecutedVoiceoverRefSchema.optional(),
  soundbed: ExecutedSoundbedRefSchema.optional()
});
export type AssemblyManifestInputs = {
  readonly videoStems: readonly ExecutedVideoStemRef[];
  readonly voiceover?: ExecutedVoiceoverRef | undefined;
  readonly soundbed?: ExecutedSoundbedRef | undefined;
};

export const AssemblyManifestLayoutSchema = z.object({
  mode: AssemblyLayoutModeSchema
});
export type AssemblyManifestLayout = {
  readonly mode: AssemblyLayoutMode;
};

export const AssemblyManifestOutputSchema = z.object({
  media: PersistentMediaRefSchema,
  durationMs: z
    .number()
    .int("durationMs must be an integer")
    .positive("durationMs must be positive"),
  width: z.number().int("width must be an integer").positive("width must be positive"),
  height: z.number().int("height must be an integer").positive("height must be positive")
});
export type AssemblyManifestOutput = {
  readonly media: PersistentMediaRef;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
};

export const AssemblyManifestSchema = z
  .object({
    assemblyId: z.string().min(1, "assemblyId must not be empty"),
    createdAt: z.string().datetime({ message: "createdAt must be an ISO 8601 datetime string" }),
    campaignId: z.string().min(1, "campaignId must not be empty"),
    assemblyProfile: AssemblyProfileIdentitySchema,
    generationManifestIds: z
      .array(z.string().min(1))
      .min(1, "generationManifestIds must contain at least one ID"),
    inputs: AssemblyManifestInputsSchema,
    timeline: AssemblyTimelineDecisionSchema,
    subtitleCuesSha256: sha256HashSchema,
    subtitleCues: z.array(SubtitleCueSchema).optional(),
    subtitleStyleProfile: z.string().min(1, "subtitleStyleProfile must not be empty").optional(),
    layout: AssemblyManifestLayoutSchema,
    ffmpeg: AssemblyManifestFfmpegSchema,
    commandFingerprint: sha256HashSchema,
    output: AssemblyManifestOutputSchema,
    measuredFrameRate: z.number().positive("measuredFrameRate must be positive"),
    executionDurationMs: z
      .number()
      .int("executionDurationMs must be an integer")
      .positive("executionDurationMs must be positive"),
    governanceDecisionId: z.string().min(1, "governanceDecisionId must not be empty")
  })
  .superRefine((manifest, ctx) => {
    // 1. generationManifestIds length matches inputs.videoStems length
    if (manifest.generationManifestIds.length !== manifest.inputs.videoStems.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `generationManifestIds length (${manifest.generationManifestIds.length}) does not match inputs.videoStems length (${manifest.inputs.videoStems.length})`,
        path: ["generationManifestIds"]
      });
    } else {
      // 2. generationManifestIds exact match in stem order
      for (let i = 0; i < manifest.generationManifestIds.length; i++) {
        const expected = manifest.inputs.videoStems[i]?.generationManifestId;
        if (manifest.generationManifestIds[i] !== expected) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `generationManifestIds[${i}] ("${manifest.generationManifestIds[i]}") does not match inputs.videoStems[${i}].generationManifestId ("${expected}")`,
            path: ["generationManifestIds", i]
          });
        }
      }
    }

    // 3. Stems ordering: 0..n-1 contiguous without duplicates or gaps
    const orders = manifest.inputs.videoStems.map((s) => s.order);
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
        message: "inputs.videoStems order must be contiguous 0..n-1 without duplicates or gaps",
        path: ["inputs", "videoStems"]
      });
    }

    // 4. Shared executed-state invariant validation
    validateExecutedAssemblyInvariants(
      {
        timeline: manifest.timeline,
        inputs: manifest.inputs,
        output: manifest.output,
        subtitleCues: manifest.subtitleCues
      },
      ctx,
      { inputsKey: "inputs" }
    );

    // 5. Subtitle cues hash check: deterministic canonical hash must match (including NO_SUBTITLE_CUES_SHA256 when cues are omitted/empty)
    const expectedSubtitleHash = hashSubtitleCues(manifest.subtitleCues);
    if (manifest.subtitleCuesSha256 !== expectedSubtitleHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `subtitleCuesSha256 ("${manifest.subtitleCuesSha256}") does not match computed hash of subtitleCues ("${expectedSubtitleHash}")`,
        path: ["subtitleCuesSha256"]
      });
    }

    // 6. Profile-aware checks for VERTICAL_REEL_1080X1920_V1
    if (manifest.assemblyProfile.key === "VERTICAL_REEL_1080X1920_V1") {
      if (manifest.layout.mode !== "fit_blurred_fill") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires layout mode "fit_blurred_fill", got "${manifest.layout.mode}"`,
          path: ["layout", "mode"]
        });
      }
      if (manifest.output.width !== 1080) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires output width 1080, got ${manifest.output.width}`,
          path: ["output", "width"]
        });
      }
      if (manifest.output.height !== 1920) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires output height 1920, got ${manifest.output.height}`,
          path: ["output", "height"]
        });
      }
      if (manifest.output.media.contentType !== "video/mp4") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires output contentType "video/mp4", got "${manifest.output.media.contentType}"`,
          path: ["output", "media", "contentType"]
        });
      }
      if (manifest.measuredFrameRate !== VERTICAL_REEL_1080X1920_V1_PROFILE.frameRate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Profile VERTICAL_REEL_1080X1920_V1 requires measuredFrameRate ${VERTICAL_REEL_1080X1920_V1_PROFILE.frameRate}, got ${manifest.measuredFrameRate}`,
          path: ["measuredFrameRate"]
        });
      }
    }
  })
  .transform((val) => deepFreeze(val));

export type AssemblyManifest = {
  readonly assemblyId: string;
  readonly createdAt: string;
  readonly campaignId: string;
  readonly assemblyProfile: AssemblyProfileIdentity;
  readonly generationManifestIds: readonly string[];
  readonly inputs: AssemblyManifestInputs;
  readonly timeline: AssemblyTimelineDecision;
  readonly subtitleCuesSha256: string;
  readonly subtitleCues?: readonly SubtitleCue[] | undefined;
  readonly subtitleStyleProfile?: string | undefined;
  readonly layout: AssemblyManifestLayout;
  readonly ffmpeg: AssemblyManifestFfmpeg;
  readonly commandFingerprint: string;
  readonly output: AssemblyManifestOutput;
  readonly measuredFrameRate: number;
  readonly executionDurationMs: number;
  readonly governanceDecisionId: string;
};

export function createAssemblyManifest(params: {
  readonly executionResult: AssemblyExecutionResult;
  readonly governanceDecisionId: string;
  readonly createdAt?: string;
}): AssemblyManifest {
  const { executionResult, governanceDecisionId, createdAt = new Date().toISOString() } = params;

  const computedHash = hashSubtitleCues(executionResult.subtitleCues);
  if (executionResult.subtitleCuesSha256 !== computedHash) {
    throw new Error(
      `Execution result subtitleCuesSha256 ("${executionResult.subtitleCuesSha256}") does not match computed hash of subtitle cues ("${computedHash}")`
    );
  }

  const manifestPayload = {
    assemblyId: executionResult.assemblyId,
    createdAt,
    campaignId: executionResult.campaignId,
    assemblyProfile: executionResult.assemblyProfile,
    generationManifestIds: executionResult.executedInputs.videoStems.map(
      (s) => s.generationManifestId
    ),
    inputs: executionResult.executedInputs,
    timeline: executionResult.timeline,
    subtitleCuesSha256: executionResult.subtitleCuesSha256,
    ...(executionResult.subtitleCues !== undefined
      ? { subtitleCues: executionResult.subtitleCues }
      : {}),
    ...(executionResult.subtitleStyleProfile !== undefined
      ? { subtitleStyleProfile: executionResult.subtitleStyleProfile }
      : {}),
    layout: executionResult.layout,
    ffmpeg: executionResult.ffmpeg,
    commandFingerprint: executionResult.commandFingerprint,
    output: executionResult.output,
    measuredFrameRate: executionResult.measuredFrameRate,
    executionDurationMs: executionResult.executionDurationMs,
    governanceDecisionId
  };
  return AssemblyManifestSchema.parse(manifestPayload);
}
