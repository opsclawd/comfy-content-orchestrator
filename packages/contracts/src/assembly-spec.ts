import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import { AssemblyProfileIdentitySchema, type AssemblyProfileIdentity } from "./assembly-profile.js";
import {
  SoundbedAssetRefSchema,
  VoiceoverAssetRefSchema,
  type SoundbedAssetRef,
  type VoiceoverAssetRef
} from "./audio-asset.js";
import { deepFreeze } from "./deep-freeze.js";
import {
  SubtitleCueSchema,
  canonicalizeSubtitleCues,
  validateSubtitleTimeline,
  type SubtitleCue
} from "./subtitle-cue.js";
import { VideoStemRefSchema, type VideoStemRef } from "./video-stem.js";

export const AssemblySpecSchema = z
  .object({
    campaignId: z.string().min(1, "campaignId must not be empty"),
    videoStems: z.array(VideoStemRefSchema).min(1, "videoStems must contain at least one stem"),
    voiceover: VoiceoverAssetRefSchema.optional(),
    soundbed: SoundbedAssetRefSchema.optional(),
    subtitleCues: z.array(SubtitleCueSchema).default([]),
    assemblyProfile: AssemblyProfileIdentitySchema,
    expectedTotalDurationMs: z
      .number()
      .int("expectedTotalDurationMs must be an integer")
      .positive("expectedTotalDurationMs must be positive")
  })
  .superRefine((spec, ctx) => {
    // 1. Validate contiguous stem ordering: 0..n-1 without duplicates or gaps
    const orders = spec.videoStems.map((s) => s.order);
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
        message: "videoStems order must be contiguous 0..n-1 without duplicates or gaps",
        path: ["videoStems"]
      });
    }

    // 2. Validate total duration matches sum of stem durations
    const stemsTotalDuration = spec.videoStems.reduce(
      (acc, s) => acc + (s.expectedDurationMs || 0),
      0
    );
    if (stemsTotalDuration !== spec.expectedTotalDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `expectedTotalDurationMs (${spec.expectedTotalDurationMs}) must match sum of videoStem expectedDurations (${stemsTotalDuration})`,
        path: ["expectedTotalDurationMs"]
      });
    }

    // 3. Validate voiceover does not overflow total duration
    if (spec.voiceover) {
      if (
        spec.voiceover.startMs + spec.voiceover.expectedDurationMs >
        spec.expectedTotalDurationMs
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `voiceover overflows total duration: startMs (${spec.voiceover.startMs}) + duration (${spec.voiceover.expectedDurationMs}) > expectedTotalDurationMs (${spec.expectedTotalDurationMs})`,
          path: ["voiceover"]
        });
      }
    }

    // 4. Validate soundbed does not overflow total duration
    if (spec.soundbed) {
      if (spec.soundbed.startMs + spec.soundbed.expectedDurationMs > spec.expectedTotalDurationMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `soundbed overflows total duration: startMs (${spec.soundbed.startMs}) + duration (${spec.soundbed.expectedDurationMs}) > expectedTotalDurationMs (${spec.expectedTotalDurationMs})`,
          path: ["soundbed"]
        });
      }
    }

    // 5. Validate subtitle cues do not overflow timeline
    if (spec.subtitleCues && spec.subtitleCues.length > 0) {
      try {
        validateSubtitleTimeline(spec.subtitleCues, spec.expectedTotalDurationMs);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: (err as Error).message,
          path: ["subtitleCues"]
        });
      }
    }
  })
  .transform((val) => deepFreeze(val));

export type AssemblySpec = {
  readonly campaignId: string;
  readonly videoStems: readonly VideoStemRef[];
  readonly voiceover?: VoiceoverAssetRef | undefined;
  readonly soundbed?: SoundbedAssetRef | undefined;
  readonly subtitleCues: readonly SubtitleCue[];
  readonly assemblyProfile: AssemblyProfileIdentity;
  readonly expectedTotalDurationMs: number;
};

/**
 * Computes a stable, canonical assembly identity from an immutable AssemblySpec.
 * Any difference in campaign, layout profile, duration, stem order, stem hashes,
 * audio assets/timing, or subtitle cues produces a distinct assembly identity.
 */
export function computeAssemblyId(spec: AssemblySpec): string {
  const canonical = {
    campaignId: spec.campaignId,
    assemblyProfile: {
      key: spec.assemblyProfile.key,
      version: spec.assemblyProfile.version
    },
    expectedTotalDurationMs: spec.expectedTotalDurationMs,
    videoStems: [...spec.videoStems]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        sceneId: s.sceneId,
        generationManifestId: s.generationManifestId,
        order: s.order,
        expectedDurationMs: s.expectedDurationMs,
        media: {
          bucket: s.media.bucket,
          key: s.media.key,
          sha256: s.media.sha256,
          contentType: s.media.contentType
        }
      })),
    voiceover: spec.voiceover
      ? {
          assetId: spec.voiceover.assetId,
          kind: spec.voiceover.kind,
          source: spec.voiceover.source,
          startMs: spec.voiceover.startMs,
          expectedDurationMs: spec.voiceover.expectedDurationMs,
          media: {
            bucket: spec.voiceover.media.bucket,
            key: spec.voiceover.media.key,
            sha256: spec.voiceover.media.sha256,
            contentType: spec.voiceover.media.contentType
          }
        }
      : null,
    soundbed: spec.soundbed
      ? {
          assetId: spec.soundbed.assetId,
          kind: spec.soundbed.kind,
          source: spec.soundbed.source,
          startMs: spec.soundbed.startMs,
          expectedDurationMs: spec.soundbed.expectedDurationMs,
          media: {
            bucket: spec.soundbed.media.bucket,
            key: spec.soundbed.media.key,
            sha256: spec.soundbed.media.sha256,
            contentType: spec.soundbed.media.contentType
          }
        }
      : null,
    subtitleCues: canonicalizeSubtitleCues(spec.subtitleCues)
  };
  const json = JSON.stringify(canonical);
  const hash = bytesToHex(sha256(new TextEncoder().encode(json)));
  return `asm-${hash.slice(0, 32)}`;
}
