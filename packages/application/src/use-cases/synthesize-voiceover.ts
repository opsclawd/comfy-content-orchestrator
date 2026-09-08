import { createHash } from "node:crypto";
import type { AudioAssetSource, VoiceoverAssetRef } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import { BUCKETS, type BucketName } from "@cco/shared";
import type { ConcreteVoiceSynthesisPort } from "../ports/voice-synthesis-port.js";
import { type ObjectStoragePort, ObjectAlreadyExistsError } from "../ports/object-storage-port.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";

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

export class VoiceSynthesisNotAuthorizedError extends Error {
  override readonly name = "VoiceSynthesisNotAuthorizedError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export interface VoiceAuthorizationPolicy {
  readonly allowCloudVoice: boolean;
  readonly allowedProviders: ReadonlySet<string>;
  readonly sensitiveDataMasking: boolean;
}

export function decodeVoiceAuthorizationPolicy(
  raw?: Record<string, unknown> | null
): VoiceAuthorizationPolicy {
  if (!raw || typeof raw !== "object") {
    return {
      allowCloudVoice: false,
      allowedProviders: new Set<string>(),
      sensitiveDataMasking: true
    };
  }

  const allowCloudVoice = raw.allowCloudVoice === true;

  let allowedProviders: Set<string>;
  if (Array.isArray(raw.allowedProviders)) {
    allowedProviders = new Set<string>(
      raw.allowedProviders.filter((p): p is string => typeof p === "string")
    );
  } else {
    allowedProviders = new Set<string>();
  }

  const sensitiveDataMasking = raw.sensitiveDataMasking !== false;

  return {
    allowCloudVoice,
    allowedProviders,
    sensitiveDataMasking
  };
}

export interface ManualAudioUpload {
  readonly audio: Uint8Array;
  readonly durationMs: number;
  readonly contentType?: string | undefined;
}

export interface SynthesizeVoiceoverDependencies {
  readonly voiceSynthesis: ConcreteVoiceSynthesisPort;
  readonly objectStorage: ObjectStoragePort;
  readonly bucket?: BucketName | undefined;
  readonly uow?: UnitOfWork | undefined;
  readonly resolveClientPolicy?: (
    campaignId: string
  ) => Promise<VoiceAuthorizationPolicy | undefined>;
  readonly policy?: VoiceAuthorizationPolicy | (() => VoiceAuthorizationPolicy) | undefined;
}

export interface SynthesizeVoiceoverParams {
  readonly campaignId: string;
  readonly assetId: string;
  readonly text: string;
  readonly voiceId: string;
  readonly speed?: number | undefined;
  readonly startMs?: number | undefined;
  readonly manualAudioUpload?: ManualAudioUpload | undefined;
  readonly clientPolicy?: VoiceAuthorizationPolicy | Record<string, unknown> | undefined;
  readonly externalProcessingPolicy?: Record<string, unknown> | undefined;
}

export class SynthesizeVoiceover {
  private readonly defaultBucket: BucketName;

  constructor(private readonly deps: SynthesizeVoiceoverDependencies) {
    this.defaultBucket = deps.bucket ?? BUCKETS.REVIEW;
  }

  async synthesize(params: SynthesizeVoiceoverParams): Promise<VoiceoverAssetRef> {
    const { ref } = await this.synthesizeInternal(params);
    return ref;
  }

  async synthesizeWithAudio(
    params: SynthesizeVoiceoverParams
  ): Promise<{ ref: VoiceoverAssetRef; audio: Uint8Array }> {
    return this.synthesizeInternal(params);
  }

  private async synthesizeInternal(
    params: SynthesizeVoiceoverParams
  ): Promise<{ ref: VoiceoverAssetRef; audio: Uint8Array }> {
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
      if (
        typeof params.speed !== "number" ||
        !Number.isFinite(params.speed) ||
        params.speed <= 0 ||
        !Number.isFinite(1.0 / params.speed) ||
        1.0 / params.speed <= 0
      ) {
        errors.push(`speed must be a positive finite number, got ${params.speed}`);
      }
    }

    if (params.manualAudioUpload !== undefined) {
      if (
        !params.manualAudioUpload.audio ||
        !(params.manualAudioUpload.audio instanceof Uint8Array) ||
        params.manualAudioUpload.audio.byteLength === 0
      ) {
        errors.push("manualAudioUpload.audio must be a non-empty Uint8Array");
      }
      if (
        typeof params.manualAudioUpload.durationMs !== "number" ||
        !Number.isInteger(params.manualAudioUpload.durationMs) ||
        params.manualAudioUpload.durationMs <= 0
      ) {
        errors.push(
          `manualAudioUpload.durationMs must be a positive integer, got ${params.manualAudioUpload.durationMs}`
        );
      }
    }

    if (errors.length > 0) {
      throw new SynthesizeVoiceoverValidationError(
        `SynthesizeVoiceover validation failed: ${errors.join("; ")}`,
        errors
      );
    }

    let policy: VoiceAuthorizationPolicy | undefined;

    if (this.deps.resolveClientPolicy) {
      policy = await this.deps.resolveClientPolicy(params.campaignId);
    } else if (this.deps.uow) {
      policy = await this.deps.uow.execute(async (ctx) => {
        if (!ctx.campaigns || !ctx.clients) {
          return undefined;
        }
        const campaign = await ctx.campaigns.findById(params.campaignId as CampaignId);
        if (!campaign) {
          return undefined;
        }
        const client = await ctx.clients.findById(campaign.clientId);
        if (!client) {
          return undefined;
        }
        return decodeVoiceAuthorizationPolicy(client.externalProcessingPolicy);
      });
    } else if (this.deps.policy) {
      policy = typeof this.deps.policy === "function" ? this.deps.policy() : this.deps.policy;
    } else if (params.clientPolicy) {
      if (
        typeof params.clientPolicy === "object" &&
        "allowCloudVoice" in params.clientPolicy &&
        typeof (params.clientPolicy as VoiceAuthorizationPolicy).allowCloudVoice === "boolean" &&
        (params.clientPolicy as VoiceAuthorizationPolicy).allowedProviders instanceof Set
      ) {
        policy = params.clientPolicy as VoiceAuthorizationPolicy;
      } else {
        policy = decodeVoiceAuthorizationPolicy(params.clientPolicy as Record<string, unknown>);
      }
    } else if (params.externalProcessingPolicy) {
      policy = decodeVoiceAuthorizationPolicy(params.externalProcessingPolicy);
    }

    const isCloudProvider = this.deps.voiceSynthesis.providerLocality === "cloud";

    let audio: Uint8Array;
    let contentType: string;
    let durationMs: number;
    let source: AudioAssetSource;

    if (params.manualAudioUpload) {
      audio = params.manualAudioUpload.audio;
      contentType = params.manualAudioUpload.contentType ?? "audio/wav";
      durationMs = params.manualAudioUpload.durationMs;
      source = { kind: "uploaded" };
    } else {
      if (isCloudProvider) {
        const effectivePolicy = policy ?? decodeVoiceAuthorizationPolicy(undefined);
        if (!effectivePolicy.allowCloudVoice) {
          throw new VoiceSynthesisNotAuthorizedError(
            "allowCloudVoice is disabled for this client; human/local audio upload required"
          );
        }

        if (
          (this.deps.resolveClientPolicy || this.deps.uow) &&
          (params.clientPolicy !== undefined || params.externalProcessingPolicy !== undefined)
        ) {
          throw new VoiceSynthesisNotAuthorizedError(
            "Client policy overrides via request parameters are prohibited when owning-client policy resolution is configured"
          );
        }

        if (
          this.deps.voiceSynthesis.providerName &&
          effectivePolicy.allowedProviders.size > 0 &&
          !effectivePolicy.allowedProviders.has(this.deps.voiceSynthesis.providerName)
        ) {
          throw new VoiceSynthesisNotAuthorizedError(
            `Voice synthesis provider '${this.deps.voiceSynthesis.providerName}' is not in allowedProviders`
          );
        }
      }

      const output = await this.deps.voiceSynthesis.synthesize({
        text: params.text,
        voiceId: params.voiceId,
        ...(params.speed !== undefined ? { speed: params.speed } : {})
      });

      audio = output.audio;
      contentType = output.contentType;
      durationMs = output.durationMs;
      source = isCloudProvider
        ? {
            kind: "provider",
            providerId: this.deps.voiceSynthesis.providerName ?? "cloud-voice"
          }
        : { kind: "local" };
    }

    const sha256 = createHash("sha256").update(audio).digest("hex");
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
        ref: {
          assetId: params.assetId,
          kind: "voiceover",
          media: {
            bucket: targetBucket,
            key,
            sha256,
            contentType
          },
          source,
          startMs,
          expectedDurationMs: durationMs
        },
        audio
      };
    }

    try {
      await this.deps.objectStorage.putObject({
        bucket: targetBucket,
        key,
        body: audio,
        contentType,
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
            ref: {
              assetId: params.assetId,
              kind: "voiceover",
              media: {
                bucket: targetBucket,
                key,
                sha256,
                contentType
              },
              source,
              startMs,
              expectedDurationMs: durationMs
            },
            audio
          };
        }
      }
      throw err;
    }

    return {
      ref: {
        assetId: params.assetId,
        kind: "voiceover",
        media: {
          bucket: targetBucket,
          key,
          sha256,
          contentType
        },
        source,
        startMs,
        expectedDurationMs: durationMs
      },
      audio
    };
  }
}
