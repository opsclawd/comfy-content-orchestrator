import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConcreteMediaAssemblerPort, ObjectStoragePort } from "@cco/application";
import {
  ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS,
  AssemblyExecutionResultSchema,
  VERTICAL_REEL_1080X1920_V1_PROFILE,
  hashSubtitleCues,
  type AssemblyExecutionResult,
  type AssemblyFfmpegMetadata,
  type AssemblySpec,
  type ExecutedVideoStemRef
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import { defaultSpawnRunner, type SpawnLikeFn } from "./ffmpeg-process-runner.js";
import { probeMedia } from "./ffprobe-client.js";
import {
  DEFAULT_CRF,
  DEFAULT_PRESET,
  STEM_DURATION_TOLERANCE_MS,
  buildFfmpegArgs,
  computeCommandFingerprint
} from "./filter-graph.js";
import { isAnimatedWebp, normalizeAnimatedWebpToMp4 } from "./webp-normalizer.js";

export const DEFAULT_MAX_STEM_INPUT_BYTES = 500 * 1024 * 1024; // 500 MiB
export const DEFAULT_MAX_AGGREGATE_INPUT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024; // 1 GiB
// These are adapter-level FFmpeg resource safeguards, not domain contract
// limits — AssemblySpec itself does not cap stem count or total duration
// (issue #122 never specified those as product semantics).
export const DEFAULT_MAX_STEM_COUNT = 12;
export const DEFAULT_MAX_TOTAL_DURATION_MS = 60_000; // ms
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000; // 10s
export const DEFAULT_ENCODE_TIMEOUT_MS = 120_000; // 120s
export const DEFAULT_VERSION_TIMEOUT_MS = 10_000; // 10s

// Filters the VERTICAL_REEL_1080X1920_V1 filter graph actually requires
// (see filter-graph.ts). The encoder check alone (libx264) does not
// guarantee these are compiled into the ffmpeg binary.
export const REQUIRED_FILTERS = [
  "scale",
  "crop",
  "gblur",
  "overlay",
  "fps",
  "format",
  "concat"
] as const;

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
  readonly createAssemblyId?: (() => string) | undefined;
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
  private readonly createAssemblyId: () => string;

  private ffmpegMetadataPromise?: Promise<AssemblyFfmpegMetadata> | undefined;
  private encoderCheckPromise?: Promise<void> | undefined;
  private filterCheckPromise?: Promise<void> | undefined;

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
    this.createAssemblyId = options.createAssemblyId ?? (() => randomUUID());
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

  private async assertEncoderAvailable(): Promise<void> {
    if (!this.encoderCheckPromise) {
      this.encoderCheckPromise = (async () => {
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
        if (!runResult.stdout.includes("libx264")) {
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

        const missing = REQUIRED_FILTERS.filter(
          (name) => !new RegExp(`\\b${name}\\b`).test(runResult.stdout)
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

  async assemble(spec: AssemblySpec): Promise<AssemblyExecutionResult> {
    // Fail-fast checks on unsupported features for Phase 1 visual assembly (Finding 2)
    if (spec.voiceover !== undefined) {
      throw new FfmpegAssemblyError(
        "UNSUPPORTED_INPUT",
        "Voiceover is not supported in Phase 1 visual-only assembly (reserved for Issue 3)"
      );
    }
    if (spec.soundbed !== undefined) {
      throw new FfmpegAssemblyError(
        "UNSUPPORTED_INPUT",
        "Soundbed is not supported in Phase 1 visual-only assembly (reserved for Issue 3)"
      );
    }
    if (spec.subtitleCues && spec.subtitleCues.length > 0) {
      throw new FfmpegAssemblyError(
        "UNSUPPORTED_INPUT",
        "Subtitle cues are not supported in Phase 1 visual-only assembly (reserved for Issue 3)"
      );
    }

    if (spec.assemblyProfile.key !== "VERTICAL_REEL_1080X1920_V1") {
      throw new FfmpegAssemblyError(
        "OUTPUT_VALIDATION_FAILED",
        `Unsupported assembly profile: ${spec.assemblyProfile.key}`
      );
    }

    // Enforce stem count and duration safeguards (Finding 3)
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

    // Sort stems deterministically by explicit order
    const orderedStems = [...spec.videoStems].sort((a, b) => a.order - b.order);

    // Assert encoder capability & fetch FFmpeg metadata
    await this.assertEncoderAvailable();
    await this.assertFiltersAvailable();
    const ffmpegMetadata = await this.getFfmpegMetadata();

    const assemblyId = this.createAssemblyId();
    const scratchDir = path.join(this.workspaceRoot, assemblyId);
    await fs.mkdir(scratchDir, { recursive: true });

    try {
      const executedStems: ExecutedVideoStemRef[] = [];
      const stagedInputPaths: string[] = [];

      // Step 3a: Input Preflight — fetch, bound, and hash-verify every stem
      // BEFORE any normalization/probing/assembly process runs. Verifying
      // and dispatching per-stem in a single pass let a bad hash on a later
      // stem surface only after earlier stems had already gone through
      // ffmpeg (WebP normalization spawns ffmpeg); a corrupted or tampered
      // late stem must never let anything reach an ffmpeg process.
      const verifiedStems: Array<{
        stem: (typeof orderedStems)[number];
        bytes: Uint8Array;
      }> = [];
      let aggregateStagedBytes = 0;

      for (const stem of orderedStems) {
        // 1. Fetch bytes with preflight size bounds
        let storedObject;
        try {
          storedObject = await this.objectStorage.getObject(
            {
              bucket: stem.media.bucket,
              key: stem.media.key
            },
            { maxBytes: this.maxStemInputBytes }
          );
        } catch (err) {
          const errMsg = (err as Error).message;
          if (errMsg.includes("exceeds maxBytes limit") || errMsg.includes("exceeds limit")) {
            throw new FfmpegAssemblyError(
              "STEM_TOO_LARGE",
              `Stem ${stem.order} (${stem.sceneId}) exceeds max input size limit (${this.maxStemInputBytes} bytes)`,
              { stemOrder: stem.order, stemSceneId: stem.sceneId }
            );
          }
          throw new FfmpegAssemblyError(
            "STEM_FETCH_FAILED",
            `Failed to fetch stem at ${stem.media.bucket}/${stem.media.key}: ${errMsg}`,
            { stemOrder: stem.order, stemSceneId: stem.sceneId }
          );
        }

        if (!storedObject || !storedObject.body) {
          throw new FfmpegAssemblyError(
            "STEM_FETCH_FAILED",
            `Stem not found in storage: ${stem.media.bucket}/${stem.media.key}`,
            { stemOrder: stem.order, stemSceneId: stem.sceneId }
          );
        }

        // 2. Enforce per-stem and aggregate input size safeguards
        const bytes = storedObject.body;
        if (bytes.byteLength > this.maxStemInputBytes) {
          throw new FfmpegAssemblyError(
            "STEM_TOO_LARGE",
            `Stem ${stem.order} (${stem.sceneId}) size ${bytes.byteLength} bytes exceeds limit ${this.maxStemInputBytes} bytes`,
            { stemOrder: stem.order, stemSceneId: stem.sceneId }
          );
        }

        aggregateStagedBytes += bytes.byteLength;
        if (aggregateStagedBytes > this.maxAggregateInputBytes) {
          throw new FfmpegAssemblyError(
            "AGGREGATE_INPUT_TOO_LARGE",
            `Aggregate stem input size (${aggregateStagedBytes} bytes) exceeds limit (${this.maxAggregateInputBytes} bytes)`
          );
        }

        // 3. Verify SHA-256 (Hard provenance gate) — before any dispatch
        const computedSha256 = createHash("sha256").update(bytes).digest("hex");
        if (computedSha256.toLowerCase() !== stem.media.sha256.toLowerCase()) {
          throw new FfmpegAssemblyError(
            "STEM_HASH_MISMATCH",
            `Stem ${stem.order} (${stem.sceneId}) SHA-256 mismatch: expected ${stem.media.sha256}, got ${computedSha256}`,
            {
              stemOrder: stem.order,
              stemSceneId: stem.sceneId,
              expectedSha256: stem.media.sha256,
              actualSha256: computedSha256
            }
          );
        }

        verifiedStems.push({ stem, bytes });
      }

      // Step 3b: Staging, normalization, and per-stem probing — only once
      // every stem in the batch has passed hash verification above.
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

      // Step 4 & 5: Visual assembly and encoding
      const layoutMode = VERTICAL_REEL_1080X1920_V1_PROFILE.layoutMode;
      const outputPath = path.join(scratchDir, "output.mp4");
      const args = buildFfmpegArgs({
        stagedInputPaths,
        layoutMode,
        outputPath,
        crf: this.defaultCrf,
        preset: this.defaultPreset
      });
      const commandFingerprint = computeCommandFingerprint(args, stagedInputPaths, outputPath);

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

      const totalStemDurationMs = executedStems.reduce((acc, s) => acc + s.actualDurationMs, 0);

      // Validate output properties against profile
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

      // Step 8: Read output bytes and persist to ObjectStorage with size check (Finding 3)
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

      await this.objectStorage.putObject({
        bucket: this.outputBucket,
        key: outputKey,
        body: outputBytes,
        contentType: "video/mp4",
        checksumSha256: outputSha256
      });

      const rawResult = {
        assemblyId,
        campaignId: spec.campaignId,
        assemblyProfile: spec.assemblyProfile,
        executedInputs: {
          videoStems: executedStems
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
        subtitleStyleProfile: undefined,
        ffmpeg: ffmpegMetadata,
        commandFingerprint,
        encoding: {
          video: {
            codec: "libx264",
            pixelFormat: "yuv420p",
            crf: this.defaultCrf,
            preset: this.defaultPreset
          }
        },
        streams: {
          video: {
            codecName: outputProbed.videoStream.codecName,
            pixelFormat: outputProbed.videoStream.pixelFormat,
            width: outputProbed.videoStream.width,
            height: outputProbed.videoStream.height,
            frameRate: outputProbed.videoStream.frameRate,
            durationMs: outputProbed.videoStream.durationMs
          }
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

      return AssemblyExecutionResultSchema.parse(rawResult);
    } finally {
      // Step 9: Clean up scratch dir
      await fs.rm(scratchDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
