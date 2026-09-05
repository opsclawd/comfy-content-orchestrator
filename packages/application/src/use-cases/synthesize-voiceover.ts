import { createHash } from "node:crypto";
import type { VoiceoverAssetRef } from "@cco/contracts";
import { BUCKETS, type BucketName } from "@cco/shared";
import type { ConcreteVoiceSynthesisPort } from "../ports/voice-synthesis-port.js";
import { type ObjectStoragePort, ObjectAlreadyExistsError } from "../ports/object-storage-port.js";

export class SynthesizeVoiceoverValidationError extends Error {
  override readonly name = "SynthesizeVoiceoverValidationError";
  readonly details?: readonly string[] | undefined;

  constructor(message: string, details?: readonly string[], options?: ErrorOptions) {
    super(message, options);
    this.details = details;
  }
}

export class VoiceoverProvenanceConflictError extends Error {
  override readonly name = "VoiceoverProvenanceConflictError";
  readonly campaignId: string;
  readonly assetId: string;
  readonly existingKey: string;
  readonly existingSha256?: string | undefined;
  readonly attemptedSha256: string;

  constructor(
    message: string,
    context: {
      campaignId: string;
      assetId: string;
      existingKey: string;
      existingSha256?: string | undefined;
      attemptedSha256: string;
    },
    options?: ErrorOptions
  ) {
    super(message, options);
    this.campaignId = context.campaignId;
    this.assetId = context.assetId;
    this.existingKey = context.existingKey;
    this.existingSha256 = context.existingSha256;
    this.attemptedSha256 = context.attemptedSha256;
  }
}

export interface SynthesizeVoiceoverDependencies {
  readonly voiceSynthesis: ConcreteVoiceSynthesisPort;
  readonly objectStorage: ObjectStoragePort;
  readonly bucket?: BucketName | undefined;
}

export interface SynthesizeVoiceoverParams {
  readonly campaignId: string;
  readonly assetId: string;
  readonly text: string;
  readonly voiceId: string;
  readonly speed?: number | undefined;
  readonly startMs?: number | undefined;
}

export class SynthesizeVoiceover {
  private readonly defaultBucket: BucketName;

  constructor(private readonly deps: SynthesizeVoiceoverDependencies) {
    this.defaultBucket = deps.bucket ?? BUCKETS.REVIEW;
  }

  async synthesize(params: SynthesizeVoiceoverParams): Promise<VoiceoverAssetRef> {
    const errors: string[] = [];

    if (!params.campaignId || params.campaignId.trim().length === 0) {
      errors.push("campaignId must not be empty");
    }
    if (!params.assetId || params.assetId.trim().length === 0) {
      errors.push("assetId must not be empty");
    }
    if (!params.text || params.text.trim().length === 0) {
      errors.push("text must not be empty");
    }
    if (!params.voiceId || params.voiceId.trim().length === 0) {
      errors.push("voiceId must not be empty");
    }

    const startMs = params.startMs ?? 0;
    if (typeof startMs !== "number" || !Number.isInteger(startMs) || startMs < 0) {
      errors.push(
        `startMs must be a non-negative integer, got ${typeof params.startMs === "number" ? params.startMs : JSON.stringify(params.startMs)}`
      );
    }

    if (params.speed !== undefined) {
      if (typeof params.speed !== "number" || !Number.isFinite(params.speed) || params.speed <= 0) {
        errors.push(`speed must be a positive finite number, got ${params.speed}`);
      }
    }

    if (errors.length > 0) {
      throw new SynthesizeVoiceoverValidationError(
        `SynthesizeVoiceover validation failed: ${errors.join("; ")}`,
        errors
      );
    }

    const output = await this.deps.voiceSynthesis.synthesize({
      text: params.text,
      voiceId: params.voiceId,
      ...(params.speed !== undefined ? { speed: params.speed } : {})
    });

    const sha256 = createHash("sha256").update(output.audio).digest("hex");
    const key = `campaigns/${params.campaignId}/voiceovers/${params.assetId}-${sha256}.wav`;
    const targetBucket = this.defaultBucket;

    // Check if an object already exists at this content-addressed key (idempotency & conflict prevention)
    const existingObj = await this.deps.objectStorage.getObject({
      bucket: targetBucket,
      key
    });

    if (existingObj) {
      if (existingObj.checksumSha256 && existingObj.checksumSha256 !== sha256) {
        throw new VoiceoverProvenanceConflictError(
          `Voiceover object at ${targetBucket}/${key} already exists with conflicting checksum`,
          {
            campaignId: params.campaignId,
            assetId: params.assetId,
            existingKey: key,
            existingSha256: existingObj.checksumSha256,
            attemptedSha256: sha256
          }
        );
      }

      // Idempotent replay: return reference to existing immutable media
      return {
        assetId: params.assetId,
        kind: "voiceover",
        media: {
          bucket: targetBucket,
          key,
          sha256,
          contentType: output.contentType
        },
        source: {
          kind: "local"
        },
        startMs,
        expectedDurationMs: output.durationMs
      };
    }

    try {
      await this.deps.objectStorage.putObject({
        bucket: targetBucket,
        key,
        body: output.audio,
        contentType: output.contentType,
        checksumSha256: sha256,
        ifNoneMatch: "*"
      });
    } catch (err: unknown) {
      if (err instanceof ObjectAlreadyExistsError) {
        const concurrentObj = await this.deps.objectStorage.getObject({
          bucket: targetBucket,
          key
        });
        if (concurrentObj) {
          if (concurrentObj.checksumSha256 && concurrentObj.checksumSha256 !== sha256) {
            throw new VoiceoverProvenanceConflictError(
              `Voiceover object at ${targetBucket}/${key} was published concurrently with conflicting checksum`,
              {
                campaignId: params.campaignId,
                assetId: params.assetId,
                existingKey: key,
                existingSha256: concurrentObj.checksumSha256,
                attemptedSha256: sha256
              },
              { cause: err }
            );
          }
          return {
            assetId: params.assetId,
            kind: "voiceover",
            media: {
              bucket: targetBucket,
              key,
              sha256,
              contentType: output.contentType
            },
            source: {
              kind: "local"
            },
            startMs,
            expectedDurationMs: output.durationMs
          };
        }
      }
      throw err;
    }

    return {
      assetId: params.assetId,
      kind: "voiceover",
      media: {
        bucket: targetBucket,
        key,
        sha256,
        contentType: output.contentType
      },
      source: {
        kind: "local"
      },
      startMs,
      expectedDurationMs: output.durationMs
    };
  }
}
