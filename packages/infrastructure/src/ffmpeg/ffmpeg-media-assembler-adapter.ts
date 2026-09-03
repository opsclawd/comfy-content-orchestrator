import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type ConcreteMediaAssemblerPort,
  type ObjectStoragePort,
  ObjectAlreadyExistsError
} from "@cco/application";
import {
  ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS,
  AssemblyExecutionResultSchema,
  VERTICAL_REEL_1080X1920_V1_PROFILE,
  hashSubtitleCues,
  computeAssemblyId,
  type AssemblyExecutionResult,
  type AssemblyFfmpegMetadata,
  type AssemblySpec,
  type ComponentRef,
  type ExecutedSoundbedRef,
  type ExecutedVideoStemRef,
  type ExecutedVoiceoverRef
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import {
  AUDIO_OUTPUT_BITRATE_KBPS,
  AUDIO_OUTPUT_CHANNELS,
  AUDIO_OUTPUT_SAMPLE_RATE_HZ,
  SOUNDBED_BASELINE_GAIN_DB,
  SOUNDBED_DUCKING_DB,
  analyzeLoudness,
  buildAudioMixGraph,
  buildSoundbedFilterChain,
  buildVoiceoverFilterChain,
  computeExecutedSoundbedMath,
  computeExecutedVoiceoverMath
} from "./audio-mix.js";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import { defaultSpawnRunner, type SpawnLikeFn } from "./ffmpeg-process-runner.js";
import { probeAudioMedia, probeMedia } from "./ffprobe-client.js";
import {
  DEFAULT_CRF,
  DEFAULT_PRESET,
  STEM_DURATION_TOLERANCE_MS,
  buildFfmpegArgs,
  computeCommandFingerprint
} from "./filter-graph.js";
import { SUBTITLE_STYLE_PROFILE_ID, buildAssDocument } from "./subtitle-renderer.js";
import { isAnimatedWebp, normalizeAnimatedWebpToMp4 } from "./webp-normalizer.js";

export const DEFAULT_MAX_STEM_INPUT_BYTES = 500 * 1024 * 1024; // 500 MiB
export const DEFAULT_MAX_AGGREGATE_INPUT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024; // 1 GiB
// These are adapter-level FFmpeg resource safeguards, not domain contract limits
export const DEFAULT_MAX_STEM_COUNT = 12;
export const DEFAULT_MAX_TOTAL_DURATION_MS = 60_000; // ms
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000; // 10s
export const DEFAULT_ENCODE_TIMEOUT_MS = 120_000; // 120s
export const DEFAULT_VERSION_TIMEOUT_MS = 10_000; // 10s

export const REQUIRED_FILTERS = [
  "scale",
  "crop",
  "gblur",
  "overlay",
  "fps",
  "format",
  "concat"
] as const;

export const REQUIRED_AUDIO_FILTERS = [
  "aformat",
  "aresample",
  "volume",
  "aloop",
  "atrim",
  "amix",
  "alimiter",
  "adelay",
  "apad"
] as const;

// loudnorm is only ever invoked by analyzeLoudness() for voiceover staging
// (see the `spec.voiceover` branch below) — a soundbed-only assembly never
// exercises it, so it must not be part of the unconditional
// REQUIRED_AUDIO_FILTERS check (that would fail soundbed-only assemblies on
// an otherwise-capable ffmpeg build that simply lacks loudnorm).
export const REQUIRED_VOICEOVER_FILTERS = ["loudnorm"] as const;

export interface FfmpegMediaAssemblerAdapterOptions {
  readonly ffmpegPath: string;
  readonly ffprobePath: string;
  readonly workspaceRoot: string;
  readonly objectStorage: ObjectStoragePort;
  readonly maxStemInputBytes?: number | undefined;
  readonly maxAggregateInputBytes?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  readonly maxStemCount?: number | undefined;
  readonly maxTotalDurationMs?: number | undefined;
  readonly probeTimeoutMs?: number | undefined;
  readonly encodeTimeoutMs?: number | undefined;
  readonly versionTimeoutMs?: number | undefined;
  readonly spawnFn?: SpawnLikeFn | undefined;
  readonly now?: (() => Date) | undefined;
  readonly defaultCrf?: number | undefined;
  readonly defaultPreset?: string | undefined;
  readonly outputBucket?: string | undefined;
  readonly createAssemblyId?: ((spec: AssemblySpec) => string) | (() => string) | undefined;
}

export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly workspaceRoot: string;
  private readonly objectStorage: ObjectStoragePort;
  private readonly maxStemInputBytes: number;
  private readonly maxAggregateInputBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxStemCount: number;
  private readonly maxTotalDurationMs: number;
  private readonly probeTimeoutMs: number;
  private readonly encodeTimeoutMs: number;
  private readonly versionTimeoutMs: number;
  private readonly spawnFn: SpawnLikeFn;
  private readonly now: () => Date;
  private readonly defaultCrf: number;
  private readonly defaultPreset: string;
  private readonly outputBucket: string;
  private readonly createAssemblyId: (spec: AssemblySpec) => string;

  private ffmpegMetadataPromise?: Promise<AssemblyFfmpegMetadata> | undefined;
  private filtersOutputPromise?: Promise<string> | undefined;
  private encodersOutputPromise?: Promise<string> | undefined;
  private encoderCheckPromise?: Promise<void> | undefined;
  private filterCheckPromise?: Promise<void> | undefined;
  private audioCapabilityCheckPromise?: Promise<void> | undefined;
  private loudnormCapabilityCheckPromise?: Promise<void> | undefined;
  private subtitleCapabilityCheckPromise?: Promise<void> | undefined;

  constructor(options: FfmpegMediaAssemblerAdapterOptions) {
    if (!options.ffmpegPath || options.ffmpegPath.trim().length === 0) {
      throw new Error("ffmpegPath must not be empty");
    }
    if (!options.ffprobePath || options.ffprobePath.trim().length === 0) {
      throw new Error("ffprobePath must not be empty");
    }
    if (!options.workspaceRoot || options.workspaceRoot.trim().length === 0) {
      throw new Error("workspaceRoot must not be empty");
    }
    if (!options.objectStorage) {
      throw new Error("objectStorage must be provided");
    }

    this.ffmpegPath = options.ffmpegPath;
    this.ffprobePath = options.ffprobePath;
    this.workspaceRoot = options.workspaceRoot;
    this.objectStorage = options.objectStorage;
    this.maxStemInputBytes = options.maxStemInputBytes ?? DEFAULT_MAX_STEM_INPUT_BYTES;
    this.maxAggregateInputBytes =
      options.maxAggregateInputBytes ?? DEFAULT_MAX_AGGREGATE_INPUT_BYTES;
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.maxStemCount = options.maxStemCount ?? DEFAULT_MAX_STEM_COUNT;
    this.maxTotalDurationMs = options.maxTotalDurationMs ?? DEFAULT_MAX_TOTAL_DURATION_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.encodeTimeoutMs = options.encodeTimeoutMs ?? DEFAULT_ENCODE_TIMEOUT_MS;
    this.versionTimeoutMs = options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS;
    this.spawnFn = options.spawnFn ?? defaultSpawnRunner;
    this.now = options.now ?? (() => new Date());
    this.defaultCrf = options.defaultCrf ?? DEFAULT_CRF;
    this.defaultPreset = options.defaultPreset ?? DEFAULT_PRESET;
    this.outputBucket = options.outputBucket ?? BUCKETS.DELIVERY;
    this.createAssemblyId = options.createAssemblyId
      ? (spec: AssemblySpec) =>
          options.createAssemblyId!.length > 0
            ? (options.createAssemblyId as (s: AssemblySpec) => string)(spec)
            : (options.createAssemblyId as () => string)()
      : (spec: AssemblySpec) => computeAssemblyId(spec);
  }

  /**
   * The exact, live-detected FFmpeg runtime identity this adapter will use
   * for its actual encode dispatch — reuses the same cached probe as
   * assemble() itself, so a license-routing guard calling this before
   * dispatch checks the identity that will actually execute, not an
   * unverified/static claim.
   */
  async getRuntimeComponents(): Promise<readonly ComponentRef[]> {
    const metadata = await this.getFfmpegMetadata();
    return [
      {
        componentId: "ffmpeg",
        componentType: "runtime",
        versionOrRevision: metadata.version
      }
    ];
  }

  private async getFfmpegMetadata(): Promise<AssemblyFfmpegMetadata> {
    if (!this.ffmpegMetadataPromise) {
      this.ffmpegMetadataPromise = (async () => {
        let runResult;
        try {
          runResult = await this.spawnFn(this.ffmpegPath, ["-version"], {
            timeoutMs: this.versionTimeoutMs
          });
        } catch (err) {
          if (err instanceof FfmpegAssemblyError) throw err;
          throw new FfmpegAssemblyError(
            "FFMPEG_EXECUTION_FAILED",
            `ffmpeg -version failed: ${(err as Error).message}`,
            { command: this.ffmpegPath, args: ["-version"] }
          );
        }

        if (runResult.exitCode !== 0) {
          throw new FfmpegAssemblyError(
            "FFMPEG_EXECUTION_FAILED",
            `ffmpeg -version failed with code ${runResult.exitCode}`,
            {
              command: this.ffmpegPath,
              args: ["-version"],
              exitCode: runResult.exitCode,
              stderr: runResult.stderr
            }
          );
        }
        const firstLine = runResult.stdout.split("\n")[0] || "";
        const versionMatch = firstLine.match(/ffmpeg\s+version\s+([^\s]+)/i);
        const version = versionMatch ? versionMatch[1] : firstLine.trim();

        return {
          executable: this.ffmpegPath,
          version: version || "unknown",
          buildInfo: runResult.stdout.trim() || firstLine
        };
      })();
    }
    return this.ffmpegMetadataPromise;
  }

  private async getFiltersOutput(): Promise<string> {
    if (!this.filtersOutputPromise) {
      this.filtersOutputPromise = (async () => {
        let runResult;
        try {
          runResult = await this.spawnFn(this.ffmpegPath, ["-hide_banner", "-filters"], {
            timeoutMs: this.versionTimeoutMs
          });
        } catch (err) {
          if (err instanceof FfmpegAssemblyError) throw err;
          throw new FfmpegAssemblyError(
            "FFMPEG_EXECUTION_FAILED",
            `ffmpeg -filters failed: ${(err as Error).message}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-filters"] }
          );
        }

        if (runResult.exitCode !== 0) {
          throw new FfmpegAssemblyError(
            "FFMPEG_EXECUTION_FAILED",
            `ffmpeg -filters failed with code ${runResult.exitCode}`,
            {
              command: this.ffmpegPath,
              args: ["-hide_banner", "-filters"],
              exitCode: runResult.exitCode,
              stderr: runResult.stderr
            }
          );
        }
        return runResult.stdout;
      })();
    }
    return this.filtersOutputPromise;
  }

  private async getEncodersOutput(): Promise<string> {
    if (!this.encodersOutputPromise) {
      this.encodersOutputPromise = (async () => {
        let runResult;
        try {
          runResult = await this.spawnFn(this.ffmpegPath, ["-hide_banner", "-encoders"], {
            timeoutMs: this.versionTimeoutMs
          });
        } catch (err) {
          if (err instanceof FfmpegAssemblyError) throw err;
          throw new FfmpegAssemblyError(
            "FFMPEG_EXECUTION_FAILED",
            `ffmpeg -encoders failed: ${(err as Error).message}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-encoders"] }
          );
        }

        if (runResult.exitCode !== 0) {
          throw new FfmpegAssemblyError(
            "FFMPEG_EXECUTION_FAILED",
            `ffmpeg -encoders failed with code ${runResult.exitCode}`,
            {
              command: this.ffmpegPath,
              args: ["-hide_banner", "-encoders"],
              exitCode: runResult.exitCode,
              stderr: runResult.stderr
            }
          );
        }
        return runResult.stdout;
      })();
    }
    return this.encodersOutputPromise;
  }

  private async assertEncoderAvailable(): Promise<void> {
    if (!this.encoderCheckPromise) {
      this.encoderCheckPromise = (async () => {
        const stdout = await this.getEncodersOutput();
        if (!stdout.includes("libx264")) {
          throw new FfmpegAssemblyError(
            "ENCODER_UNAVAILABLE",
            `Required video encoder 'libx264' is not available in ffmpeg installation: ${this.ffmpegPath}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-encoders"] }
          );
        }
      })();
    }
    return this.encoderCheckPromise;
  }

  private async assertFiltersAvailable(): Promise<void> {
    if (!this.filterCheckPromise) {
      this.filterCheckPromise = (async () => {
        const stdout = await this.getFiltersOutput();
        const missing = REQUIRED_FILTERS.filter(
          (name) => !new RegExp(`\\b${name}\\b`).test(stdout)
        );
        if (missing.length > 0) {
          throw new FfmpegAssemblyError(
            "FILTER_UNAVAILABLE",
            `Required filter(s) not available in ffmpeg installation: ${missing.join(", ")}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-filters"] }
          );
        }
      })();
    }
    return this.filterCheckPromise;
  }

  private async assertAudioCapabilityAvailable(): Promise<void> {
    if (!this.audioCapabilityCheckPromise) {
      this.audioCapabilityCheckPromise = (async () => {
        const filtersStdout = await this.getFiltersOutput();
        const missing = REQUIRED_AUDIO_FILTERS.filter(
          (name) => !new RegExp(`\\b${name}\\b`).test(filtersStdout)
        );
        if (missing.length > 0) {
          throw new FfmpegAssemblyError(
            "AUDIO_FILTER_UNAVAILABLE",
            `Required audio filter(s) not available in ffmpeg installation: ${missing.join(", ")}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-filters"] }
          );
        }

        const encodersStdout = await this.getEncodersOutput();
        if (!new RegExp(`\\baac\\b`).test(encodersStdout)) {
          throw new FfmpegAssemblyError(
            "ENCODER_UNAVAILABLE",
            `Required audio encoder 'aac' is not available in ffmpeg installation: ${this.ffmpegPath}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-encoders"] }
          );
        }
      })();
    }
    return this.audioCapabilityCheckPromise;
  }

  // Only called when spec.voiceover is present — see REQUIRED_VOICEOVER_FILTERS.
  private async assertLoudnormCapabilityAvailable(): Promise<void> {
    if (!this.loudnormCapabilityCheckPromise) {
      this.loudnormCapabilityCheckPromise = (async () => {
        const filtersStdout = await this.getFiltersOutput();
        const missing = REQUIRED_VOICEOVER_FILTERS.filter(
          (name) => !new RegExp(`\\b${name}\\b`).test(filtersStdout)
        );
        if (missing.length > 0) {
          throw new FfmpegAssemblyError(
            "AUDIO_FILTER_UNAVAILABLE",
            `Required audio filter(s) not available in ffmpeg installation: ${missing.join(", ")}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-filters"] }
          );
        }
      })();
    }
    return this.loudnormCapabilityCheckPromise;
  }

  private async assertSubtitleCapabilityAvailable(): Promise<void> {
    if (!this.subtitleCapabilityCheckPromise) {
      this.subtitleCapabilityCheckPromise = (async () => {
        const filtersStdout = await this.getFiltersOutput();
        const hasAss = /\bass\b/.test(filtersStdout);
        if (!hasAss) {
          throw new FfmpegAssemblyError(
            "SUBTITLE_CAPABILITY_UNAVAILABLE",
            `Required subtitle filter 'ass' is not available in ffmpeg installation: ${this.ffmpegPath}`,
            { command: this.ffmpegPath, args: ["-hide_banner", "-filters"] }
          );
        }
      })();
    }
    return this.subtitleCapabilityCheckPromise;
  }

  private async verifyAndFetchInput(options: {
    readonly media: {
      readonly bucket: string;
      readonly key: string;
      readonly sha256: string;
    };
    readonly kindLabel: string;
    readonly mediaKindName: string;
    readonly mediaKindTitleName: string;
    readonly fetchErrorCode: FfmpegAssemblyError["code"];
    readonly sizeErrorCode: FfmpegAssemblyError["code"];
    readonly hashErrorCode: FfmpegAssemblyError["code"];
    readonly errorContext: Record<string, unknown>;
  }): Promise<Uint8Array> {
    const {
      media,
      kindLabel,
      mediaKindName,
      mediaKindTitleName,
      fetchErrorCode,
      sizeErrorCode,
      hashErrorCode,
      errorContext
    } = options;

    let storedObject;
    try {
      storedObject = await this.objectStorage.getObject(
        {
          bucket: media.bucket,
          key: media.key
        },
        { maxBytes: this.maxStemInputBytes }
      );
    } catch (err) {
      const errMsg = (err as Error).message;
      if (errMsg.includes("exceeds maxBytes limit") || errMsg.includes("exceeds limit")) {
        throw new FfmpegAssemblyError(
          sizeErrorCode,
          `${kindLabel} exceeds max input size limit (${this.maxStemInputBytes} bytes)`,
          errorContext
        );
      }
      throw new FfmpegAssemblyError(
        fetchErrorCode,
        `Failed to fetch ${mediaKindName} at ${media.bucket}/${media.key}: ${errMsg}`,
        errorContext
      );
    }

    if (!storedObject || !storedObject.body) {
      throw new FfmpegAssemblyError(
        fetchErrorCode,
        `${mediaKindTitleName} not found in storage: ${media.bucket}/${media.key}`,
        errorContext
      );
    }

    const bytes = storedObject.body;
    if (bytes.byteLength > this.maxStemInputBytes) {
      throw new FfmpegAssemblyError(
        sizeErrorCode,
        `${kindLabel} size ${bytes.byteLength} bytes exceeds limit ${this.maxStemInputBytes} bytes`,
        errorContext
      );
    }

    const computedSha256 = createHash("sha256").update(bytes).digest("hex");
    if (computedSha256.toLowerCase() !== media.sha256.toLowerCase()) {
      throw new FfmpegAssemblyError(
        hashErrorCode,
        `${kindLabel} SHA-256 mismatch: expected ${media.sha256}, got ${computedSha256}`,
        {
          ...errorContext,
          expectedSha256: media.sha256,
          actualSha256: computedSha256
        }
      );
    }

    return bytes;
  }

  async assemble(spec: AssemblySpec): Promise<AssemblyExecutionResult> {
    if (spec.assemblyProfile.key !== "VERTICAL_REEL_1080X1920_V1") {
      throw new FfmpegAssemblyError(
        "OUTPUT_VALIDATION_FAILED",
        `Unsupported assembly profile: ${spec.assemblyProfile.key}`
      );
    }

    // Enforce stem count and duration safeguards
    if (spec.videoStems.length > this.maxStemCount) {
      throw new FfmpegAssemblyError(
        "INPUT_LIMIT_EXCEEDED",
        `Stem count ${spec.videoStems.length} exceeds limit of ${this.maxStemCount} stems`
      );
    }
    if (spec.expectedTotalDurationMs > this.maxTotalDurationMs) {
      throw new FfmpegAssemblyError(
        "INPUT_LIMIT_EXCEEDED",
        `Expected total duration ${spec.expectedTotalDurationMs}ms exceeds limit of ${this.maxTotalDurationMs}ms`
      );
    }

    // Capability preflight checks run BEFORE downloading and hashing inputs.
    // On a host with a broken/misconfigured FFmpeg, fail in milliseconds.
    await this.assertEncoderAvailable();
    await this.assertFiltersAvailable();
    if (spec.voiceover !== undefined || spec.soundbed !== undefined) {
      await this.assertAudioCapabilityAvailable();
    }
    if (spec.voiceover !== undefined) {
      await this.assertLoudnormCapabilityAvailable();
    }
    if (spec.subtitleCues && spec.subtitleCues.length > 0) {
      await this.assertSubtitleCapabilityAvailable();
    }
    const ffmpegMetadata = await this.getFfmpegMetadata();

    // Sort stems deterministically by explicit order
    const orderedStems = [...spec.videoStems].sort((a, b) => a.order - b.order);

    let aggregateStagedBytes = 0;

    // Step 3a: Input Preflight — fetch, bound, and hash-verify EVERY input (stems, VO, soundbed)
    const verifiedStems: Array<{
      stem: (typeof orderedStems)[number];
      bytes: Uint8Array;
    }> = [];

    for (const stem of orderedStems) {
      const bytes = await this.verifyAndFetchInput({
        media: stem.media,
        kindLabel: `Stem ${stem.order} (${stem.sceneId})`,
        mediaKindName: "stem",
        mediaKindTitleName: "Stem",
        fetchErrorCode: "STEM_FETCH_FAILED",
        sizeErrorCode: "STEM_TOO_LARGE",
        hashErrorCode: "STEM_HASH_MISMATCH",
        errorContext: { stemOrder: stem.order, stemSceneId: stem.sceneId }
      });

      aggregateStagedBytes += bytes.byteLength;
      if (aggregateStagedBytes > this.maxAggregateInputBytes) {
        throw new FfmpegAssemblyError(
          "AGGREGATE_INPUT_TOO_LARGE",
          `Aggregate stem input size (${aggregateStagedBytes} bytes) exceeds limit (${this.maxAggregateInputBytes} bytes)`
        );
      }

      verifiedStems.push({ stem, bytes });
    }

    // Preflight Voiceover (if requested)
    let verifiedVoiceoverBytes: Uint8Array | undefined;
    if (spec.voiceover) {
      const vo = spec.voiceover;
      const bytes = await this.verifyAndFetchInput({
        media: vo.media,
        kindLabel: `Voiceover (${vo.assetId})`,
        mediaKindName: "voiceover",
        mediaKindTitleName: "Voiceover",
        fetchErrorCode: "AUDIO_FETCH_FAILED",
        sizeErrorCode: "AUDIO_TOO_LARGE",
        hashErrorCode: "AUDIO_HASH_MISMATCH",
        errorContext: { assetKind: "voiceover", assetId: vo.assetId }
      });

      aggregateStagedBytes += bytes.byteLength;
      if (aggregateStagedBytes > this.maxAggregateInputBytes) {
        throw new FfmpegAssemblyError(
          "AGGREGATE_INPUT_TOO_LARGE",
          `Aggregate input size (${aggregateStagedBytes} bytes) exceeds limit (${this.maxAggregateInputBytes} bytes)`
        );
      }

      verifiedVoiceoverBytes = bytes;
    }

    // Preflight Soundbed (if requested)
    let verifiedSoundbedBytes: Uint8Array | undefined;
    if (spec.soundbed) {
      const sb = spec.soundbed;
      const bytes = await this.verifyAndFetchInput({
        media: sb.media,
        kindLabel: `Soundbed (${sb.assetId})`,
        mediaKindName: "soundbed",
        mediaKindTitleName: "Soundbed",
        fetchErrorCode: "AUDIO_FETCH_FAILED",
        sizeErrorCode: "AUDIO_TOO_LARGE",
        hashErrorCode: "AUDIO_HASH_MISMATCH",
        errorContext: { assetKind: "soundbed", assetId: sb.assetId }
      });

      aggregateStagedBytes += bytes.byteLength;
      if (aggregateStagedBytes > this.maxAggregateInputBytes) {
        throw new FfmpegAssemblyError(
          "AGGREGATE_INPUT_TOO_LARGE",
          `Aggregate input size (${aggregateStagedBytes} bytes) exceeds limit (${this.maxAggregateInputBytes} bytes)`
        );
      }

      verifiedSoundbedBytes = bytes;
    }

    const assemblyId = this.createAssemblyId(spec);
    const scratchDir = path.join(this.workspaceRoot, assemblyId);
    await fs.mkdir(scratchDir, { recursive: true });

    try {
      const executedStems: ExecutedVideoStemRef[] = [];
      const stagedInputPaths: string[] = [];

      // Step 3b: Staging, normalization, and per-stem probing
      for (const { stem, bytes } of verifiedStems) {
        const stagedPath = path.join(scratchDir, `stem-${stem.order}.mp4`);
        let normalization: ExecutedVideoStemRef["normalization"];
        if (
          stem.media.contentType === "image/webp" ||
          stem.media.key.endsWith(".webp") ||
          isAnimatedWebp(bytes)
        ) {
          const normalized = await normalizeAnimatedWebpToMp4({
            bytes,
            outputPath: stagedPath,
            ffmpegPath: this.ffmpegPath,
            spawnFn: this.spawnFn,
            timeoutMs: this.encodeTimeoutMs,
            stemOrder: stem.order,
            stemSceneId: stem.sceneId
          });
          normalization = {
            profile: "ANIMATED_WEBP_TO_MP4_V1",
            normalizedSha256: normalized.normalizedSha256,
            normalizedContentType: "video/mp4",
            commandFingerprint: normalized.commandFingerprint
          };
        } else {
          await fs.writeFile(stagedPath, bytes);
        }
        stagedInputPaths.push(stagedPath);

        const probed = await probeMedia({
          runner: this.spawnFn,
          ffprobePath: this.ffprobePath,
          filePath: stagedPath,
          errorContext: { stemOrder: stem.order, stemSceneId: stem.sceneId },
          isOutput: false,
          timeoutMs: this.probeTimeoutMs
        });

        const durationDiff = Math.abs(probed.videoStream.durationMs - stem.expectedDurationMs);
        if (durationDiff > STEM_DURATION_TOLERANCE_MS) {
          throw new FfmpegAssemblyError(
            "STEM_DURATION_OUT_OF_TOLERANCE",
            `Stem ${stem.order} (${stem.sceneId}) duration ${probed.videoStream.durationMs}ms deviates from expected ${stem.expectedDurationMs}ms by ${durationDiff}ms (tolerance: ${STEM_DURATION_TOLERANCE_MS}ms)`,
            {
              stemOrder: stem.order,
              stemSceneId: stem.sceneId,
              expectedDurationMs: stem.expectedDurationMs,
              actualDurationMs: probed.videoStream.durationMs,
              toleranceMs: STEM_DURATION_TOLERANCE_MS
            }
          );
        }

        executedStems.push({
          sceneId: stem.sceneId,
          generationManifestId: stem.generationManifestId,
          order: stem.order,
          media: stem.media,
          actualDurationMs: probed.videoStream.durationMs,
          ...(normalization ? { normalization } : {})
        });
      }

      const totalStemDurationMs = executedStems.reduce((acc, s) => acc + s.actualDurationMs, 0);

      // Staging Voiceover and Soundbed in parallel
      const stageVoiceoverPromise = (async () => {
        if (!spec.voiceover || !verifiedVoiceoverBytes) return undefined;
        const stagedPath = path.join(scratchDir, "voiceover.bin");
        await fs.writeFile(stagedPath, verifiedVoiceoverBytes);

        const voProbed = await probeAudioMedia({
          runner: this.spawnFn,
          ffprobePath: this.ffprobePath,
          filePath: stagedPath,
          errorContext: { assetKind: "voiceover", assetId: spec.voiceover.assetId },
          timeoutMs: this.probeTimeoutMs
        });

        const loudnessResult = await analyzeLoudness({
          spawnFn: this.spawnFn,
          ffmpegPath: this.ffmpegPath,
          filePath: stagedPath,
          timeoutMs: this.probeTimeoutMs
        });

        return {
          stagedPath,
          probedDurationMs: voProbed.audioStream.durationMs,
          gainDb: loudnessResult.gainDb
        };
      })();

      const stageSoundbedPromise = (async () => {
        if (!spec.soundbed || !verifiedSoundbedBytes) return undefined;
        const stagedPath = path.join(scratchDir, "soundbed.bin");
        await fs.writeFile(stagedPath, verifiedSoundbedBytes);

        const sbProbed = await probeAudioMedia({
          runner: this.spawnFn,
          ffprobePath: this.ffprobePath,
          filePath: stagedPath,
          errorContext: { assetKind: "soundbed", assetId: spec.soundbed.assetId },
          timeoutMs: this.probeTimeoutMs
        });

        return {
          stagedPath,
          probedDurationMs: sbProbed.audioStream.durationMs
        };
      })();

      const [voStagingResult, sbStagingResult] = await Promise.all([
        stageVoiceoverPromise,
        stageSoundbedPromise
      ]);

      let stagedVoiceoverPath: string | undefined;
      let executedVoiceover: ExecutedVoiceoverRef | undefined;
      if (voStagingResult && spec.voiceover) {
        stagedVoiceoverPath = voStagingResult.stagedPath;
        const voMath = computeExecutedVoiceoverMath({
          actualDurationMs: voStagingResult.probedDurationMs,
          targetDurationMs: totalStemDurationMs,
          startMs: spec.voiceover.startMs,
          gainDb: voStagingResult.gainDb
        });

        executedVoiceover = {
          assetId: spec.voiceover.assetId,
          kind: "voiceover",
          media: spec.voiceover.media,
          source: spec.voiceover.source,
          startMs: spec.voiceover.startMs,
          actualDurationMs: voStagingResult.probedDurationMs,
          ...voMath
        };
      }

      let stagedSoundbedPath: string | undefined;
      let executedSoundbed: ExecutedSoundbedRef | undefined;
      if (sbStagingResult && spec.soundbed) {
        stagedSoundbedPath = sbStagingResult.stagedPath;
        const duckingDb = executedVoiceover ? SOUNDBED_DUCKING_DB : 0;
        const sbMath = computeExecutedSoundbedMath({
          actualDurationMs: sbStagingResult.probedDurationMs,
          targetDurationMs: totalStemDurationMs,
          startMs: spec.soundbed.startMs,
          gainDb: SOUNDBED_BASELINE_GAIN_DB,
          duckingDb
        });

        executedSoundbed = {
          assetId: spec.soundbed.assetId,
          kind: "soundbed",
          media: spec.soundbed.media,
          source: spec.soundbed.source,
          startMs: spec.soundbed.startMs,
          actualDurationMs: sbStagingResult.probedDurationMs,
          ...sbMath
        };
      }

      // Staging Subtitles
      let subtitleAssPath: string | undefined;
      let subtitleStyleProfile: string | undefined;
      if (spec.subtitleCues && spec.subtitleCues.length > 0) {
        subtitleAssPath = path.join(scratchDir, "subtitles.ass");
        const assDocument = buildAssDocument(spec.subtitleCues);
        await fs.writeFile(subtitleAssPath, assDocument, "utf-8");
        subtitleStyleProfile = SUBTITLE_STYLE_PROFILE_ID;
      }

      // Build Audio Filter Graph (if audio inputs are present)
      let audioFilterGraph: string | undefined;
      if (executedVoiceover || executedSoundbed) {
        let nextAudioIdx = stagedInputPaths.length;
        let voIndex: number | undefined;
        let sbIndex: number | undefined;

        if (stagedVoiceoverPath) {
          voIndex = nextAudioIdx++;
        }
        if (stagedSoundbedPath) {
          sbIndex = nextAudioIdx++;
        }

        let voLabel: string | undefined;
        let sbLabel: string | undefined;
        const audioFilterParts: string[] = [];

        if (executedVoiceover && voIndex !== undefined) {
          const voChain = buildVoiceoverFilterChain({
            inputIndex: voIndex,
            startMs: executedVoiceover.effectiveStartMs,
            targetDurationMs: totalStemDurationMs,
            gainDb: executedVoiceover.gainDb
          });
          audioFilterParts.push(voChain.filter);
          voLabel = voChain.outputLabel;
        }

        if (executedSoundbed && sbIndex !== undefined) {
          const sbChain = buildSoundbedFilterChain({
            inputIndex: sbIndex,
            targetDurationMs: totalStemDurationMs,
            startMs: executedSoundbed.effectiveStartMs,
            gainDb: executedSoundbed.gainDb,
            duckingDb: executedSoundbed.duckingDb,
            voActiveWindowMs: executedVoiceover
              ? {
                  startMs: executedVoiceover.effectiveStartMs,
                  durationMs: executedVoiceover.actualDurationMs
                }
              : undefined
          });
          audioFilterParts.push(sbChain.filter);
          sbLabel = sbChain.outputLabel;
        }

        const mixGraph = buildAudioMixGraph({ voLabel, sbLabel });
        audioFilterParts.push(mixGraph.filter);
        audioFilterGraph = audioFilterParts.join(";");
      }

      // Step 4 & 5: Visual and Audio assembly and encoding
      const layoutMode = VERTICAL_REEL_1080X1920_V1_PROFILE.layoutMode;
      const outputPath = path.join(scratchDir, "output.mp4");
      const args = buildFfmpegArgs({
        stagedInputPaths,
        layoutMode,
        outputPath,
        crf: this.defaultCrf,
        preset: this.defaultPreset,
        stagedVoiceoverPath,
        stagedSoundbedPath,
        audioFilterGraph,
        subtitleAssPath,
        audioEncoding:
          executedVoiceover || executedSoundbed
            ? {
                codec: "aac",
                bitrateKbps: AUDIO_OUTPUT_BITRATE_KBPS,
                sampleRateHz: AUDIO_OUTPUT_SAMPLE_RATE_HZ,
                channels: AUDIO_OUTPUT_CHANNELS
              }
            : undefined
      });
      const commandFingerprint = computeCommandFingerprint(args, stagedInputPaths, outputPath, {
        stagedVoiceoverPath,
        stagedSoundbedPath,
        subtitleAssPath
      });

      const startTime = this.now().getTime();
      let runResult;
      try {
        runResult = await this.spawnFn(this.ffmpegPath, args, {
          timeoutMs: this.encodeTimeoutMs
        });
      } catch (err) {
        if (err instanceof FfmpegAssemblyError) throw err;
        throw new FfmpegAssemblyError(
          "FFMPEG_EXECUTION_FAILED",
          `FFmpeg execution failed: ${(err as Error).message}`,
          { command: this.ffmpegPath, args }
        );
      }
      const endTime = this.now().getTime();
      const executionDurationMs = Math.max(1, Math.round(endTime - startTime));

      if (runResult.exitCode !== 0) {
        throw new FfmpegAssemblyError(
          "FFMPEG_EXECUTION_FAILED",
          `FFmpeg execution failed with exit code ${runResult.exitCode}: ${runResult.stderr}`,
          { command: this.ffmpegPath, args, exitCode: runResult.exitCode, stderr: runResult.stderr }
        );
      }

      // Step 7: Output validation
      const outputProbed = await probeMedia({
        runner: this.spawnFn,
        ffprobePath: this.ffprobePath,
        filePath: outputPath,
        isOutput: true,
        timeoutMs: this.probeTimeoutMs
      });

      // Validate video properties against profile
      if (outputProbed.videoStream.width !== VERTICAL_REEL_1080X1920_V1_PROFILE.width) {
        throw new FfmpegAssemblyError(
          "OUTPUT_VALIDATION_FAILED",
          `Output width ${outputProbed.videoStream.width} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.width}`
        );
      }
      if (outputProbed.videoStream.height !== VERTICAL_REEL_1080X1920_V1_PROFILE.height) {
        throw new FfmpegAssemblyError(
          "OUTPUT_VALIDATION_FAILED",
          `Output height ${outputProbed.videoStream.height} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.height}`
        );
      }
      if (
        outputProbed.videoStream.codecName !== VERTICAL_REEL_1080X1920_V1_PROFILE.videoCodecFamily
      ) {
        throw new FfmpegAssemblyError(
          "OUTPUT_VALIDATION_FAILED",
          `Output codec ${outputProbed.videoStream.codecName} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.videoCodecFamily}`
        );
      }
      if (
        outputProbed.videoStream.pixelFormat !==
        VERTICAL_REEL_1080X1920_V1_PROFILE.pixelFormatFamily
      ) {
        throw new FfmpegAssemblyError(
          "OUTPUT_VALIDATION_FAILED",
          `Output pixelFormat ${outputProbed.videoStream.pixelFormat} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.pixelFormatFamily}`
        );
      }
      if (outputProbed.videoStream.frameRate !== VERTICAL_REEL_1080X1920_V1_PROFILE.frameRate) {
        throw new FfmpegAssemblyError(
          "OUTPUT_VALIDATION_FAILED",
          `Output frameRate ${outputProbed.videoStream.frameRate} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.frameRate}`
        );
      }
      if (
        Math.abs(outputProbed.videoStream.durationMs - totalStemDurationMs) >
        ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
      ) {
        throw new FfmpegAssemblyError(
          "OUTPUT_VALIDATION_FAILED",
          `Output duration ${outputProbed.videoStream.durationMs}ms deviates from total stem duration ${totalStemDurationMs}ms by more than ${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms`
        );
      }

      // Validate audio output (if audio was executed)
      if (executedVoiceover || executedSoundbed) {
        if (!outputProbed.audioStream) {
          throw new FfmpegAssemblyError(
            "OUTPUT_VALIDATION_FAILED",
            "Output file missing expected audio stream after audio assembly"
          );
        }
        if (
          outputProbed.audioStream.codecName !== VERTICAL_REEL_1080X1920_V1_PROFILE.audioCodecFamily
        ) {
          throw new FfmpegAssemblyError(
            "OUTPUT_VALIDATION_FAILED",
            `Output audio codec "${outputProbed.audioStream.codecName}" does not match profile "${VERTICAL_REEL_1080X1920_V1_PROFILE.audioCodecFamily}"`
          );
        }
        if (
          outputProbed.audioStream.sampleRateHz !==
          VERTICAL_REEL_1080X1920_V1_PROFILE.audioSampleRateHz
        ) {
          throw new FfmpegAssemblyError(
            "OUTPUT_VALIDATION_FAILED",
            `Output audio sample rate ${outputProbed.audioStream.sampleRateHz} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.audioSampleRateHz}`
          );
        }
        if (
          outputProbed.audioStream.channels !== VERTICAL_REEL_1080X1920_V1_PROFILE.audioChannels
        ) {
          throw new FfmpegAssemblyError(
            "OUTPUT_VALIDATION_FAILED",
            `Output audio channels ${outputProbed.audioStream.channels} does not match profile ${VERTICAL_REEL_1080X1920_V1_PROFILE.audioChannels}`
          );
        }
        if (
          Math.abs(outputProbed.audioStream.durationMs - totalStemDurationMs) >
          ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
        ) {
          throw new FfmpegAssemblyError(
            "OUTPUT_VALIDATION_FAILED",
            `Output audio duration ${outputProbed.audioStream.durationMs}ms deviates from total stem duration ${totalStemDurationMs}ms by more than ${ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS}ms`
          );
        }
      }

      // Step 8: Read output bytes, validate execution result, and persist to ObjectStorage
      const outputStat = await fs.stat(outputPath);
      if (outputStat.size > this.maxOutputBytes) {
        throw new FfmpegAssemblyError(
          "OUTPUT_TOO_LARGE",
          `Assembly output size (${outputStat.size} bytes) exceeds limit (${this.maxOutputBytes} bytes)`
        );
      }

      const outputBytes = await fs.readFile(outputPath);
      const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
      const outputKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/output.mp4`;

      const rawResult = {
        assemblyId,
        campaignId: spec.campaignId,
        assemblyProfile: spec.assemblyProfile,
        executedInputs: {
          videoStems: executedStems,
          voiceover: executedVoiceover,
          soundbed: executedSoundbed
        },
        timeline: {
          totalDurationMs: totalStemDurationMs,
          stemDurationsMs: executedStems.map((s) => s.actualDurationMs)
        },
        layout: {
          mode: layoutMode
        },
        subtitleCuesSha256: hashSubtitleCues(spec.subtitleCues),
        subtitleCues:
          spec.subtitleCues && spec.subtitleCues.length > 0 ? spec.subtitleCues : undefined,
        subtitleStyleProfile,
        ffmpeg: ffmpegMetadata,
        commandFingerprint,
        encoding: {
          video: {
            codec: "libx264",
            pixelFormat: "yuv420p",
            crf: this.defaultCrf,
            preset: this.defaultPreset
          },
          audio:
            executedVoiceover || executedSoundbed
              ? {
                  codec: "aac",
                  bitrateKbps: AUDIO_OUTPUT_BITRATE_KBPS,
                  sampleRateHz: AUDIO_OUTPUT_SAMPLE_RATE_HZ,
                  channels: AUDIO_OUTPUT_CHANNELS
                }
              : undefined
        },
        streams: {
          video: {
            codecName: outputProbed.videoStream.codecName,
            pixelFormat: outputProbed.videoStream.pixelFormat,
            width: outputProbed.videoStream.width,
            height: outputProbed.videoStream.height,
            frameRate: outputProbed.videoStream.frameRate,
            durationMs: outputProbed.videoStream.durationMs
          },
          audio: outputProbed.audioStream
            ? {
                codecName: outputProbed.audioStream.codecName,
                sampleRateHz: outputProbed.audioStream.sampleRateHz,
                channels: outputProbed.audioStream.channels,
                durationMs: outputProbed.audioStream.durationMs,
                ...(outputProbed.audioStream.bitrateKbps !== undefined
                  ? { bitrateKbps: outputProbed.audioStream.bitrateKbps }
                  : {})
              }
            : undefined
        },
        output: {
          media: {
            bucket: this.outputBucket,
            key: outputKey,
            sha256: outputSha256,
            contentType: "video/mp4"
          },
          durationMs: outputProbed.videoStream.durationMs,
          width: outputProbed.videoStream.width,
          height: outputProbed.videoStream.height
        },
        measuredFrameRate: outputProbed.videoStream.frameRate,
        executionDurationMs
      };

      const executionResult = AssemblyExecutionResultSchema.parse(rawResult);

      const existingOutput = await this.objectStorage.getObject({
        bucket: this.outputBucket,
        key: outputKey
      });
      if (existingOutput) {
        if (!existingOutput.body || existingOutput.body.length === 0) {
          throw new FfmpegAssemblyError(
            "ASSEMBLY_PROVENANCE_CONFLICT",
            `Delivery media for identity "${assemblyId}" already exists but is empty or unreadable`,
            { assemblyId }
          );
        }
        const existingSha256 = createHash("sha256").update(existingOutput.body).digest("hex");
        if (
          existingSha256 !== outputSha256 ||
          (existingOutput.checksumSha256 && existingOutput.checksumSha256 !== outputSha256)
        ) {
          throw new FfmpegAssemblyError(
            "ASSEMBLY_PROVENANCE_CONFLICT",
            `Delivery media for identity "${assemblyId}" already exists with conflicting checksum (expected ${existingOutput.checksumSha256 ?? existingSha256}, got ${outputSha256})`,
            {
              assemblyId,
              expectedSha256: existingOutput.checksumSha256 ?? existingSha256,
              actualSha256: outputSha256
            }
          );
        }
      } else {
        try {
          await this.objectStorage.putObject({
            bucket: this.outputBucket,
            key: outputKey,
            body: outputBytes,
            contentType: "video/mp4",
            checksumSha256: outputSha256,
            ifNoneMatch: "*"
          });
        } catch (err) {
          if (err instanceof ObjectAlreadyExistsError) {
            const concurrentOutput = await this.objectStorage.getObject({
              bucket: this.outputBucket,
              key: outputKey
            });
            if (!concurrentOutput || !concurrentOutput.body || concurrentOutput.body.length === 0) {
              throw new FfmpegAssemblyError(
                "ASSEMBLY_PROVENANCE_CONFLICT",
                `Delivery media for identity "${assemblyId}" already exists but cannot be verified`,
                { assemblyId }
              );
            }
            const concurrentSha256 = createHash("sha256")
              .update(concurrentOutput.body)
              .digest("hex");
            if (
              concurrentSha256 !== outputSha256 ||
              (concurrentOutput.checksumSha256 && concurrentOutput.checksumSha256 !== outputSha256)
            ) {
              throw new FfmpegAssemblyError(
                "ASSEMBLY_PROVENANCE_CONFLICT",
                `Delivery media for identity "${assemblyId}" already exists with conflicting checksum (expected ${concurrentOutput.checksumSha256 ?? concurrentSha256}, got ${outputSha256})`,
                {
                  assemblyId,
                  expectedSha256: concurrentOutput.checksumSha256 ?? concurrentSha256,
                  actualSha256: outputSha256
                }
              );
            }
          } else {
            throw err;
          }
        }
      }

      return executionResult;
    } finally {
      // Step 9: Clean up scratch dir
      await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
