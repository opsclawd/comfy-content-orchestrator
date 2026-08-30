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

export const ExecutedVoiceoverRefSchema = z.object({
  assetId: z.string().min(1, "assetId must not be empty"),
  kind: z.literal("voiceover"),
  media: PersistentMediaRefSchema,
  source: AudioAssetSourceSchema,
  startMs: z.number().int("startMs must be an integer").nonnegative("startMs must be non-negative"),
  actualDurationMs: z
    .number()
    .int("actualDurationMs must be an integer")
    .positive("actualDurationMs must be positive")
});
export type ExecutedVoiceoverRef = {
  readonly assetId: string;
  readonly kind: "voiceover";
  readonly media: PersistentMediaRef;
  readonly source: AudioAssetSource;
  readonly startMs: number;
  readonly actualDurationMs: number;
};

export const ExecutedSoundbedRefSchema = z.object({
  assetId: z.string().min(1, "assetId must not be empty"),
  kind: z.literal("soundbed"),
  media: PersistentMediaRefSchema,
  source: AudioAssetSourceSchema,
  startMs: z.number().int("startMs must be an integer").nonnegative("startMs must be non-negative"),
  actualDurationMs: z
    .number()
    .int("actualDurationMs must be an integer")
    .positive("actualDurationMs must be positive")
});
export type ExecutedSoundbedRef = {
  readonly assetId: string;
  readonly kind: "soundbed";
  readonly media: PersistentMediaRef;
  readonly source: AudioAssetSource;
  readonly startMs: number;
  readonly actualDurationMs: number;
};

export const ExecutedAudioAssetRefSchema = z.discriminatedUnion("kind", [
  ExecutedVoiceoverRefSchema,
  ExecutedSoundbedRefSchema
]);
export type ExecutedAudioAssetRef = ExecutedVoiceoverRef | ExecutedSoundbedRef;
