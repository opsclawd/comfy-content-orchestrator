import type { AssemblySpec as ContractsAssemblySpec } from "@cco/contracts";
import { validateSubtitleTimeline } from "@cco/contracts";

export class AssemblySpecValidationError extends Error {
  override readonly name = "AssemblySpecValidationError";
  readonly details?: readonly string[] | undefined;

  constructor(message: string, details?: readonly string[], options?: ErrorOptions) {
    super(message, options);
    this.details = details;
  }
}

export type AssemblySpec = ContractsAssemblySpec;

export function validateAssemblySpec(spec: AssemblySpec): void {
  const errors: string[] = [];

  if (!spec.campaignId || spec.campaignId.trim().length === 0) {
    errors.push("campaignId must not be empty");
  }

  if (!spec.videoStems || spec.videoStems.length === 0) {
    errors.push("videoStems must contain at least one stem");
  } else {
    // Check contiguous ordering 0..n-1 without duplicates or gaps
    const orders = spec.videoStems.map((s) => s.order);
    const seen = new Set<number>();
    for (const order of orders) {
      if (typeof order !== "number" || !Number.isInteger(order) || order < 0) {
        errors.push(`Stem order must be a non-negative integer, got ${order}`);
      } else if (seen.has(order)) {
        errors.push(`Duplicate stem order: ${order}`);
      }
      seen.add(order);
    }
    const sorted = [...orders].sort((a, b) => a - b);
    if (!sorted.every((val, idx) => val === idx)) {
      errors.push(
        `Stem orders must be contiguous from 0 to ${spec.videoStems.length - 1} without gaps`
      );
    }

    // Check individual stem fields
    for (let i = 0; i < spec.videoStems.length; i++) {
      const stem = spec.videoStems[i]!;
      if (!stem.sceneId || stem.sceneId.trim().length === 0) {
        errors.push(`videoStems[${i}].sceneId must not be empty`);
      }
      if (!stem.generationManifestId || stem.generationManifestId.trim().length === 0) {
        errors.push(`videoStems[${i}].generationManifestId must not be empty`);
      }
      if (!stem.media?.sha256 || !/^[0-9a-f]{64}$/.test(stem.media.sha256)) {
        errors.push(
          `videoStems[${i}].media.sha256 must be a valid 64-character lowercase hex hash`
        );
      }
      if (!stem.expectedDurationMs || stem.expectedDurationMs <= 0) {
        errors.push(`videoStems[${i}].expectedDurationMs must be positive`);
      }
    }
  }

  if (!spec.expectedTotalDurationMs || spec.expectedTotalDurationMs <= 0) {
    errors.push(`expectedTotalDurationMs must be positive, got ${spec.expectedTotalDurationMs}`);
  } else if (spec.videoStems && spec.videoStems.length > 0) {
    const stemsTotalDuration = spec.videoStems.reduce(
      (acc, s) => acc + (s.expectedDurationMs || 0),
      0
    );
    if (stemsTotalDuration !== spec.expectedTotalDurationMs) {
      errors.push(
        `expectedTotalDurationMs (${spec.expectedTotalDurationMs}) must match sum of videoStem expectedDurations (${stemsTotalDuration})`
      );
    }
  }

  // Voiceover validation
  if (spec.voiceover) {
    if (spec.voiceover.kind !== "voiceover") {
      errors.push(`voiceover.kind must be 'voiceover', got '${spec.voiceover.kind}'`);
    }
    if (!spec.voiceover.assetId || spec.voiceover.assetId.trim().length === 0) {
      errors.push("voiceover.assetId must not be empty");
    }
    if (!spec.voiceover.media?.sha256 || !/^[0-9a-f]{64}$/.test(spec.voiceover.media.sha256)) {
      errors.push("voiceover.media.sha256 must be a valid 64-character lowercase hex hash");
    }
    if (spec.voiceover.startMs < 0) {
      errors.push(`voiceover.startMs must be non-negative, got ${spec.voiceover.startMs}`);
    }
    if (spec.voiceover.expectedDurationMs <= 0) {
      errors.push(
        `voiceover.expectedDurationMs must be positive, got ${spec.voiceover.expectedDurationMs}`
      );
    }
    if (
      spec.expectedTotalDurationMs > 0 &&
      spec.voiceover.startMs + spec.voiceover.expectedDurationMs > spec.expectedTotalDurationMs
    ) {
      errors.push(
        `voiceover overflows total duration: startMs (${spec.voiceover.startMs}) + duration (${spec.voiceover.expectedDurationMs}) > expectedTotalDurationMs (${spec.expectedTotalDurationMs})`
      );
    }
  }

  // Soundbed validation
  if (spec.soundbed) {
    if (spec.soundbed.kind !== "soundbed") {
      errors.push(`soundbed.kind must be 'soundbed', got '${spec.soundbed.kind}'`);
    }
    if (!spec.soundbed.assetId || spec.soundbed.assetId.trim().length === 0) {
      errors.push("soundbed.assetId must not be empty");
    }
    if (!spec.soundbed.media?.sha256 || !/^[0-9a-f]{64}$/.test(spec.soundbed.media.sha256)) {
      errors.push("soundbed.media.sha256 must be a valid 64-character lowercase hex hash");
    }
    if (spec.soundbed.startMs < 0) {
      errors.push(`soundbed.startMs must be non-negative, got ${spec.soundbed.startMs}`);
    }
    if (spec.soundbed.expectedDurationMs <= 0) {
      errors.push(
        `soundbed.expectedDurationMs must be positive, got ${spec.soundbed.expectedDurationMs}`
      );
    }
    if (
      spec.expectedTotalDurationMs > 0 &&
      spec.soundbed.startMs + spec.soundbed.expectedDurationMs > spec.expectedTotalDurationMs
    ) {
      errors.push(
        `soundbed overflows total duration: startMs (${spec.soundbed.startMs}) + duration (${spec.soundbed.expectedDurationMs}) > expectedTotalDurationMs (${spec.expectedTotalDurationMs})`
      );
    }
  }

  // Subtitle cues timeline validation
  if (spec.subtitleCues && spec.subtitleCues.length > 0 && spec.expectedTotalDurationMs > 0) {
    try {
      validateSubtitleTimeline(spec.subtitleCues, spec.expectedTotalDurationMs);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  // Assembly profile identity validation
  if (!spec.assemblyProfile?.key || spec.assemblyProfile.key !== "VERTICAL_REEL_1080X1920_V1") {
    errors.push(
      `assemblyProfile.key must be VERTICAL_REEL_1080X1920_V1, got '${spec.assemblyProfile?.key}'`
    );
  }
  if (!spec.assemblyProfile?.version || spec.assemblyProfile.version !== 1) {
    errors.push(`assemblyProfile.version must be 1, got '${spec.assemblyProfile?.version}'`);
  }

  if (errors.length > 0) {
    throw new AssemblySpecValidationError(`Invalid AssemblySpec: ${errors.join("; ")}`, errors);
  }
}
