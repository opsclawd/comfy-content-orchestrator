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
    loopCount: z
      .number()
      .int("loopCount must be an integer")
      .nonnegative("loopCount must be non-negative"),
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
    if (vo.trimStartMs >= vo.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trimStartMs (${vo.trimStartMs}) must be strictly less than actualDurationMs (${vo.actualDurationMs})`,
        path: ["trimStartMs"]
      });
    }
    const expectedEffectiveDuration =
      vo.padLeadingMs +
      (vo.actualDurationMs - vo.trimStartMs) * (vo.loopCount + 1) +
      vo.padTrailingMs;
    if (vo.effectiveDurationMs !== expectedEffectiveDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `effectiveDurationMs (${vo.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${vo.padLeadingMs}) + (actualDurationMs (${vo.actualDurationMs}) - trimStartMs (${vo.trimStartMs})) * (loopCount (${vo.loopCount}) + 1) + padTrailingMs (${vo.padTrailingMs}) = ${expectedEffectiveDuration}ms`,
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
  readonly loopCount: number;
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
    loopCount: z
      .number()
      .int("loopCount must be an integer")
      .nonnegative("loopCount must be non-negative"),
    padLeadingMs: z
      .number()
      .int("padLeadingMs must be an integer")
      .nonnegative("padLeadingMs must be non-negative"),
    padTrailingMs: z
      .number()
      .int("padTrailingMs must be an integer")
      .nonnegative("padTrailingMs must be non-negative"),
    gainDb: z.number().finite("gainDb must be a finite number"),
    duckingDb: z.number().finite("duckingDb must be a finite number")
  })
  .superRefine((sb, ctx) => {
    if (sb.trimStartMs >= sb.actualDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `trimStartMs (${sb.trimStartMs}) must be strictly less than actualDurationMs (${sb.actualDurationMs})`,
        path: ["trimStartMs"]
      });
    }
    const expectedEffectiveDuration =
      sb.padLeadingMs +
      (sb.actualDurationMs - sb.trimStartMs) * (sb.loopCount + 1) +
      sb.padTrailingMs;
    if (sb.effectiveDurationMs !== expectedEffectiveDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `effectiveDurationMs (${sb.effectiveDurationMs}) does not match computed audio duration from trim/loop/pad formula: padLeadingMs (${sb.padLeadingMs}) + (actualDurationMs (${sb.actualDurationMs}) - trimStartMs (${sb.trimStartMs})) * (loopCount (${sb.loopCount}) + 1) + padTrailingMs (${sb.padTrailingMs}) = ${expectedEffectiveDuration}ms`,
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
  readonly loopCount: number;
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
