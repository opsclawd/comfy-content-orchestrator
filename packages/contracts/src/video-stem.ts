import { z } from "zod";
import {
  PersistentMediaRefSchema,
  sha256HashSchema,
  type PersistentMediaRef
} from "./persistent-media.js";

export const VideoStemRefSchema = z.object({
  sceneId: z.string().min(1, "sceneId must not be empty"),
  generationManifestId: z.string().min(1, "generationManifestId must not be empty"),
  order: z.number().int("order must be an integer").nonnegative("order must be non-negative"),
  media: PersistentMediaRefSchema,
  expectedDurationMs: z
    .number()
    .int("expectedDurationMs must be an integer")
    .positive("expectedDurationMs must be positive")
});

export type VideoStemRef = {
  readonly sceneId: string;
  readonly generationManifestId: string;
  readonly order: number;
  readonly media: PersistentMediaRef;
  readonly expectedDurationMs: number;
};

// Normalization provenance for stems that were transformed before final
// assembly (e.g. animated WebP demuxed/re-encoded to MP4). Additive only:
// `media` on ExecutedVideoStemRef always stays the immutable source asset
// identity — this records what was derived from it, it never replaces it.
export const StemNormalizationProvenanceSchema = z.object({
  profile: z.literal("ANIMATED_WEBP_TO_MP4_V1"),
  normalizedSha256: sha256HashSchema,
  normalizedContentType: z.literal("video/mp4"),
  commandFingerprint: z.string().min(1, "commandFingerprint must not be empty")
});

export type StemNormalizationProvenance = {
  readonly profile: "ANIMATED_WEBP_TO_MP4_V1";
  readonly normalizedSha256: string;
  readonly normalizedContentType: "video/mp4";
  readonly commandFingerprint: string;
};

export const ExecutedVideoStemRefSchema = z.object({
  sceneId: z.string().min(1, "sceneId must not be empty"),
  generationManifestId: z.string().min(1, "generationManifestId must not be empty"),
  order: z.number().int("order must be an integer").nonnegative("order must be non-negative"),
  media: PersistentMediaRefSchema,
  actualDurationMs: z
    .number()
    .int("actualDurationMs must be an integer")
    .positive("actualDurationMs must be positive"),
  normalization: StemNormalizationProvenanceSchema.optional()
});

export type ExecutedVideoStemRef = {
  readonly sceneId: string;
  readonly generationManifestId: string;
  readonly order: number;
  readonly media: PersistentMediaRef;
  readonly actualDurationMs: number;
  readonly normalization?: StemNormalizationProvenance | undefined;
};
