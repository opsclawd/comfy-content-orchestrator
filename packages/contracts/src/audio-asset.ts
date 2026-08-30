import { z } from "zod";
import { PersistentMediaRefSchema, type PersistentMediaRef } from "./persistent-media.js";

export const AUDIO_ASSET_KINDS = ["voiceover", "soundbed"] as const;
export const AudioAssetKindSchema = z.enum(AUDIO_ASSET_KINDS);
export type AudioAssetKind = (typeof AUDIO_ASSET_KINDS)[number];

export const AudioAssetSourceLocalSchema = z.object({
  kind: z.literal("local")
});
export type AudioAssetSourceLocal = { readonly kind: "local" };

export const AudioAssetSourceUploadedSchema = z.object({
  kind: z.literal("uploaded")
});
export type AudioAssetSourceUploaded = { readonly kind: "uploaded" };

export const AudioAssetSourceProviderSchema = z.object({
  kind: z.literal("provider"),
  providerId: z.string().min(1, "providerId must not be empty"),
  modelId: z.string().min(1, "modelId must not be empty").optional()
});
export type AudioAssetSourceProvider = {
  readonly kind: "provider";
  readonly providerId: string;
  readonly modelId?: string | undefined;
};

export const AudioAssetSourceSchema = z.discriminatedUnion("kind", [
  AudioAssetSourceLocalSchema,
  AudioAssetSourceUploadedSchema,
  AudioAssetSourceProviderSchema
]);
export type AudioAssetSource =
  AudioAssetSourceLocal | AudioAssetSourceUploaded | AudioAssetSourceProvider;

export const VoiceoverAssetRefSchema = z.object({
  assetId: z.string().min(1, "assetId must not be empty"),
  kind: z.literal("voiceover"),
  media: PersistentMediaRefSchema,
  source: AudioAssetSourceSchema,
  startMs: z.number().int("startMs must be an integer").nonnegative("startMs must be non-negative"),
  expectedDurationMs: z
    .number()
    .int("expectedDurationMs must be an integer")
    .positive("expectedDurationMs must be positive")
});
export type VoiceoverAssetRef = {
  readonly assetId: string;
  readonly kind: "voiceover";
  readonly media: PersistentMediaRef;
  readonly source: AudioAssetSource;
  readonly startMs: number;
  readonly expectedDurationMs: number;
};

export const SoundbedAssetRefSchema = z.object({
  assetId: z.string().min(1, "assetId must not be empty"),
  kind: z.literal("soundbed"),
  media: PersistentMediaRefSchema,
  source: AudioAssetSourceSchema,
  startMs: z.number().int("startMs must be an integer").nonnegative("startMs must be non-negative"),
  expectedDurationMs: z
    .number()
    .int("expectedDurationMs must be an integer")
    .positive("expectedDurationMs must be positive")
});
export type SoundbedAssetRef = {
  readonly assetId: string;
  readonly kind: "soundbed";
  readonly media: PersistentMediaRef;
  readonly source: AudioAssetSource;
  readonly startMs: number;
  readonly expectedDurationMs: number;
};

export const AudioAssetRefSchema = z.discriminatedUnion("kind", [
  VoiceoverAssetRefSchema,
  SoundbedAssetRefSchema
]);
export type AudioAssetRef = VoiceoverAssetRef | SoundbedAssetRef;

export const ExecutedVoiceoverRefSchema = z
  .object({
    assetId: z.string().min(1, "assetId must not be empty"),
    kind: z.literal("voiceover"),
    media: PersistentMediaRefSchema,
    source: AudioAssetSourceSchema,
    startMs: z
      .number()
      .int("startMs must be an integer")
      .nonnegative("startMs must be non-negative"),
    actualDurationMs: z
      .number()
      .int("actualDurationMs must be an integer")
      .positive("actualDurationMs must be positive"),
    effectiveStartMs: z
      .number()
      .int("effectiveStartMs must be an integer")
      .nonnegative("effectiveStartMs must be non-negative"),
    effectiveDurationMs: z
      .number()
      .int("effectiveDurationMs must be an integer")
      .positive("effectiveDurationMs must be positive"),
    trimStartMs: z
      .number()
      .int("trimStartMs must be an integer")
      .nonnegative("trimStartMs must be non-negative"),
    trimEndMs: z
      .number()
      .int("trimEndMs must be an integer")
      .positive("trimEndMs must be positive")
      .optional(),
    loopCount: z
      .number()
      .int("loopCount must be an integer")
      .nonnegative("loopCount must be non-negative"),
    partialLoopDurationMs: z
      .number()
      .int("partialLoopDurationMs must be an integer")
      .nonnegative("partialLoopDurationMs must be non-negative")
      .optional(),
    padLeadingMs: z
      .number()
      .int("padLeadingMs must be an integer")
      .nonnegative("padLeadingMs must be non-negative"),
    padTrailingMs: z
      .number()
      .int("padTrailingMs must be an integer")
      .nonnegative("padTrailingMs must be non-negative"),
    gainDb: z.number().finite("gainDb must be a finite number")
  })
  .superRefine((vo, ctx) => {
    const trimEnd = vo.trimEndMs ?? vo.actualDurationMs;
    if (vo.trimEndMs !== undefined && vo.trimEndMs > vo.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trimEndMs (${vo.trimEndMs}) cannot exceed actualDurationMs (${vo.actualDurationMs})`,
        path: ["trimEndMs"]
      });
    }
    if (vo.trimStartMs >= trimEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trimStartMs (${vo.trimStartMs}) must be strictly less than trimEndMs/actualDurationMs (${trimEnd})`,
        path: ["trimStartMs"]
      });
    }
    const sliceDurationMs = trimEnd - vo.trimStartMs;
    const partialLoopMs = vo.partialLoopDurationMs ?? 0;
    if (partialLoopMs >= sliceDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `partialLoopDurationMs (${partialLoopMs}) must be strictly less than sliceDurationMs (${sliceDurationMs})`,
        path: ["partialLoopDurationMs"]
      });
    }
    if (vo.loopCount === 0 && partialLoopMs === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "loopCount and partialLoopDurationMs cannot both be 0 (at least one full or partial loop must be consumed)",
        path: ["loopCount"]
      });
    }
    const expectedEffectiveDuration =
      vo.padLeadingMs + (sliceDurationMs * vo.loopCount + partialLoopMs) + vo.padTrailingMs;
    if (vo.effectiveDurationMs !== expectedEffectiveDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `effectiveDurationMs (${vo.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${vo.padLeadingMs}) + (${sliceDurationMs} * ${vo.loopCount} + ${partialLoopMs}) + padTrailingMs (${vo.padTrailingMs}) = ${expectedEffectiveDuration}ms`,
        path: ["effectiveDurationMs"]
      });
    }
  });

export type ExecutedVoiceoverRef = {
  readonly assetId: string;
  readonly kind: "voiceover";
  readonly media: PersistentMediaRef;
  readonly source: AudioAssetSource;
  readonly startMs: number;
  readonly actualDurationMs: number;
  readonly effectiveStartMs: number;
  readonly effectiveDurationMs: number;
  readonly trimStartMs: number;
  readonly trimEndMs?: number | undefined;
  readonly loopCount: number;
  readonly partialLoopDurationMs?: number | undefined;
  readonly padLeadingMs: number;
  readonly padTrailingMs: number;
  readonly gainDb: number;
};

export const ExecutedSoundbedRefSchema = z
  .object({
    assetId: z.string().min(1, "assetId must not be empty"),
    kind: z.literal("soundbed"),
    media: PersistentMediaRefSchema,
    source: AudioAssetSourceSchema,
    startMs: z
      .number()
      .int("startMs must be an integer")
      .nonnegative("startMs must be non-negative"),
    actualDurationMs: z
      .number()
      .int("actualDurationMs must be an integer")
      .positive("actualDurationMs must be positive"),
    effectiveStartMs: z
      .number()
      .int("effectiveStartMs must be an integer")
      .nonnegative("effectiveStartMs must be non-negative"),
    effectiveDurationMs: z
      .number()
      .int("effectiveDurationMs must be an integer")
      .positive("effectiveDurationMs must be positive"),
    trimStartMs: z
      .number()
      .int("trimStartMs must be an integer")
      .nonnegative("trimStartMs must be non-negative"),
    trimEndMs: z
      .number()
      .int("trimEndMs must be an integer")
      .positive("trimEndMs must be positive")
      .optional(),
    loopCount: z
      .number()
      .int("loopCount must be an integer")
      .nonnegative("loopCount must be non-negative"),
    partialLoopDurationMs: z
      .number()
      .int("partialLoopDurationMs must be an integer")
      .nonnegative("partialLoopDurationMs must be non-negative")
      .optional(),
    padLeadingMs: z
      .number()
      .int("padLeadingMs must be an integer")
      .nonnegative("padLeadingMs must be non-negative"),
    padTrailingMs: z
      .number()
      .int("padTrailingMs must be an integer")
      .nonnegative("padTrailingMs must be non-negative"),
    gainDb: z.number().finite("gainDb must be a finite number"),
    duckingDb: z
      .number()
      .finite("duckingDb must be a finite number")
      .max(0, "duckingDb must be non-positive (<= 0 dB for attenuation)")
  })
  .superRefine((sb, ctx) => {
    const trimEnd = sb.trimEndMs ?? sb.actualDurationMs;
    if (sb.trimEndMs !== undefined && sb.trimEndMs > sb.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trimEndMs (${sb.trimEndMs}) cannot exceed actualDurationMs (${sb.actualDurationMs})`,
        path: ["trimEndMs"]
      });
    }
    if (sb.trimStartMs >= trimEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trimStartMs (${sb.trimStartMs}) must be strictly less than trimEndMs/actualDurationMs (${trimEnd})`,
        path: ["trimStartMs"]
      });
    }
    const sliceDurationMs = trimEnd - sb.trimStartMs;
    const partialLoopMs = sb.partialLoopDurationMs ?? 0;
    if (partialLoopMs >= sliceDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `partialLoopDurationMs (${partialLoopMs}) must be strictly less than sliceDurationMs (${sliceDurationMs})`,
        path: ["partialLoopDurationMs"]
      });
    }
    if (sb.loopCount === 0 && partialLoopMs === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "loopCount and partialLoopDurationMs cannot both be 0 (at least one full or partial loop must be consumed)",
        path: ["loopCount"]
      });
    }
    const expectedEffectiveDuration =
      sb.padLeadingMs + (sliceDurationMs * sb.loopCount + partialLoopMs) + sb.padTrailingMs;
    if (sb.effectiveDurationMs !== expectedEffectiveDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `effectiveDurationMs (${sb.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${sb.padLeadingMs}) + (${sliceDurationMs} * ${sb.loopCount} + ${partialLoopMs}) + padTrailingMs (${sb.padTrailingMs}) = ${expectedEffectiveDuration}ms`,
        path: ["effectiveDurationMs"]
      });
    }
  });

export type ExecutedSoundbedRef = {
  readonly assetId: string;
  readonly kind: "soundbed";
  readonly media: PersistentMediaRef;
  readonly source: AudioAssetSource;
  readonly startMs: number;
  readonly actualDurationMs: number;
  readonly effectiveStartMs: number;
  readonly effectiveDurationMs: number;
  readonly trimStartMs: number;
  readonly trimEndMs?: number | undefined;
  readonly loopCount: number;
  readonly partialLoopDurationMs?: number | undefined;
  readonly padLeadingMs: number;
  readonly padTrailingMs: number;
  readonly gainDb: number;
  readonly duckingDb: number;
};

export const ExecutedAudioAssetRefSchema = z.union([
  ExecutedVoiceoverRefSchema,
  ExecutedSoundbedRefSchema
]);
export type ExecutedAudioAssetRef = ExecutedVoiceoverRef | ExecutedSoundbedRef;
