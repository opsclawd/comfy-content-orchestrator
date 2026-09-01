import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssemblySpec } from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import { FfmpegMediaAssemblerAdapter } from "./ffmpeg-media-assembler-adapter.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";
import { InMemoryObjectStorage } from "./test-support/in-memory-object-storage.js";

describe("FfmpegMediaAssemblerAdapter (unit)", () => {
  let tempDir: string;
  let objectStorage: InMemoryObjectStorage;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-adapter-unit-"));
    objectStorage = new InMemoryObjectStorage();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  function createStemMedia(payload: string): { bytes: Uint8Array; sha256: string } {
    const bytes = new TextEncoder().encode(payload);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { bytes, sha256 };
  }

  describe("Audio and Subtitle assembly support", () => {
    function createMockRunner(
      options: {
        hasLibx264?: boolean;
        hasAac?: boolean;
        filters?: string;
        loudnormOutput?: string;
        outputHasAudio?: boolean;
        corruptAudio?: boolean;
      } = {}
    ): { runner: SpawnLikeFn; spawnedCommands: string[][] } {
      const {
        hasLibx264 = true,
        hasAac = true,
        filters = "scale crop gblur overlay fps format concat aformat aresample volume aloop atrim amix alimiter adelay loudnorm ass subtitles apad",
        loudnormOutput = JSON.stringify({
          input_i: "-22.00",
          input_tp: "-3.00",
          input_lra: "6.00",
          input_thresh: "-32.00",
          output_i: "-16.00",
          output_tp: "-1.50",
          output_lra: "6.00",
          output_thresh: "-26.00",
          normalization_type: "dynamic",
          target_offset: "0.00"
        }),
        outputHasAudio = true,
        corruptAudio = false
      } = options;

      const spawnedCommands: string[][] = [];

      const runner: SpawnLikeFn = async (_cmd, args) => {
        spawnedCommands.push([...args]);

        if (args.includes("-encoders")) {
          const encoders: string[] = [];
          if (hasLibx264) encoders.push("V..... libx264");
          if (hasAac) encoders.push("A..... aac");
          return { exitCode: 0, stdout: encoders.join("\n"), stderr: "" };
        }

        if (args.includes("-filters")) {
          return { exitCode: 0, stdout: filters, stderr: "" };
        }

        if (args.includes("-version")) {
          return { exitCode: 0, stdout: "ffmpeg version 7.1", stderr: "" };
        }

        if (args.includes("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json")) {
          return { exitCode: 0, stdout: "", stderr: loudnormOutput };
        }

        if (args.includes("-show_streams")) {
          const filePath = args[args.length - 1]!;
          if (filePath.includes("voiceover") || filePath.includes("soundbed")) {
            if (corruptAudio) {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ streams: [], format: {} }),
                stderr: ""
              };
            }
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                streams: [
                  {
                    codec_type: "audio",
                    codec_name: "mp3",
                    sample_rate: "44100",
                    channels: 2,
                    bit_rate: "192000",
                    duration: filePath.includes("soundbed") ? "10.000000" : "4.000000"
                  }
                ],
                format: {
                  duration: filePath.includes("soundbed") ? "10.000000" : "4.000000"
                }
              }),
              stderr: ""
            };
          }

          if (filePath.includes("output.mp4")) {
            const streams: Record<string, unknown>[] = [
              {
                codec_type: "video",
                codec_name: "h264",
                pix_fmt: "yuv420p",
                width: 1080,
                height: 1920,
                r_frame_rate: "30/1",
                duration: "5.000000"
              }
            ];
            if (outputHasAudio) {
              streams.push({
                codec_type: "audio",
                codec_name: "aac",
                sample_rate: "48000",
                channels: 2,
                bit_rate: "192000",
                duration: "5.000000"
              });
            }
            return {
              exitCode: 0,
              stdout: JSON.stringify({ streams, format: { duration: "5.000000" } }),
              stderr: ""
            };
          }

          // Video stem
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              streams: [
                {
                  codec_type: "video",
                  codec_name: "h264",
                  pix_fmt: "yuv420p",
                  width: 1280,
                  height: 720,
                  r_frame_rate: "30/1",
                  duration: "5.000000"
                }
              ],
              format: { duration: "5.000000" }
            }),
            stderr: ""
          };
        }

        if (args.includes("-filter_complex")) {
          const outputPath = args[args.length - 1]!;
          await fs.writeFile(outputPath, "dummy-mp4-output");
          return { exitCode: 0, stdout: "", stderr: "" };
        }

        return { exitCode: 0, stdout: "", stderr: "" };
      };

      return { runner, spawnedCommands };
    }

    it("assembles reel with voiceover, soundbed, and subtitles, producing complete execution result", async () => {
      const { runner, spawnedCommands } = createMockRunner();
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const voMedia = createStemMedia("voiceover-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/vo.mp3",
        body: voMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: voMedia.sha256
      });

      const sbMedia = createStemMedia("soundbed-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/sb.wav",
        body: sbMedia.bytes,
        contentType: "audio/wav",
        checksumSha256: sbMedia.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-full-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [{ startMs: 0, endMs: 4000, text: "Welcome to {product}!" }],
        voiceover: {
          assetId: "vo-1",
          kind: "voiceover",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/vo.mp3",
            sha256: voMedia.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "provider", providerId: "p1" },
          startMs: 500,
          expectedDurationMs: 4000
        },
        soundbed: {
          assetId: "sb-1",
          kind: "soundbed",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/sb.wav",
            sha256: sbMedia.sha256,
            contentType: "audio/wav"
          },
          source: { kind: "local" },
          startMs: 0,
          expectedDurationMs: 5000
        },
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      const result = await adapter.assemble(spec);

      expect(result.assemblyId).toBeDefined();
      expect(result.executedInputs.voiceover).toBeDefined();
      expect(result.executedInputs.voiceover?.effectiveStartMs).toBe(500);
      expect(result.executedInputs.voiceover?.actualDurationMs).toBe(4000);
      expect(result.executedInputs.voiceover?.padTrailingMs).toBe(500);
      expect(result.executedInputs.voiceover?.effectiveDurationMs).toBe(4500);
      expect(result.executedInputs.voiceover?.gainDb).toBe(6.0); // -16 - (-22) = +6 dB
      expect(result.executedInputs.soundbed).toBeDefined();
      expect(result.executedInputs.soundbed?.gainDb).toBe(-18.0);
      expect(result.executedInputs.soundbed?.duckingDb).toBe(-12.0);
      expect(result.subtitleStyleProfile).toBe("VERTICAL_REEL_CENTER_V1");
      expect(result.encoding.audio).toBeDefined();
      expect(result.encoding.audio?.codec).toBe("aac");
      expect(result.encoding.audio?.bitrateKbps).toBe(192);
      expect(result.streams.audio).toBeDefined();
      expect(result.streams.audio?.channels).toBe(2);
      expect(result.streams.audio?.sampleRateHz).toBe(48000);

      // Verify FFmpeg filter_complex was invoked with audio and subtitle args
      const encodeCall = spawnedCommands.find((args) => args.includes("-filter_complex"));
      expect(encodeCall).toBeDefined();
      const filterArg = encodeCall![encodeCall!.indexOf("-filter_complex") + 1]!;
      expect(filterArg).toContain("ass=filename=");
      expect(filterArg).toContain("adelay=500|500");
      expect(filterArg).toContain("amix=inputs=2");
      expect(filterArg).toContain("alimiter=");
    });

    it("assembles reel with soundbed startMs > 0 applying offset and proper algebra", async () => {
      const { runner, spawnedCommands } = createMockRunner();
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const sbMedia = createStemMedia("soundbed-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/soundbed.mp3",
        body: sbMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: sbMedia.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-sb-offset",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        soundbed: {
          assetId: "sb-offset-1",
          kind: "soundbed",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/soundbed.mp3",
            sha256: sbMedia.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 2000,
          expectedDurationMs: 3000
        },
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      const result = await adapter.assemble(spec);
      expect(result.executedInputs.soundbed).toBeDefined();
      expect(result.executedInputs.soundbed?.effectiveStartMs).toBe(2000);
      expect(result.executedInputs.soundbed?.effectiveDurationMs).toBe(3000);

      const encodeCall = spawnedCommands.find((args) => args.includes("-filter_complex"));
      expect(encodeCall).toBeDefined();
      const filterArg = encodeCall![encodeCall!.indexOf("-filter_complex") + 1]!;
      expect(filterArg).toContain("adelay=2000|2000");
      expect(filterArg).toContain("atrim=0:3.000000");
    });

    it("assembles VO-only reel with padded voiceover matching video duration", async () => {
      const { runner, spawnedCommands } = createMockRunner();
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const voMedia = createStemMedia("voiceover-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/voiceover.mp3",
        body: voMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: voMedia.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-vo-only",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        voiceover: {
          assetId: "vo-only-1",
          kind: "voiceover",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/voiceover.mp3",
            sha256: voMedia.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 1000,
          expectedDurationMs: 4000
        },
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      const result = await adapter.assemble(spec);
      expect(result.executedInputs.voiceover).toBeDefined();
      expect(result.executedInputs.voiceover?.effectiveStartMs).toBe(1000);
      expect(result.executedInputs.voiceover?.actualDurationMs).toBe(4000);
      expect(result.executedInputs.voiceover?.effectiveDurationMs).toBe(4000); // startMs(1000) + actual(4000) = 5000
      expect(result.executedInputs.voiceover?.padTrailingMs).toBe(0);
      expect(result.executedInputs.soundbed).toBeUndefined();

      const encodeCall = spawnedCommands.find((args) => args.includes("-filter_complex"));
      expect(encodeCall).toBeDefined();
      const filterArg = encodeCall![encodeCall!.indexOf("-filter_complex") + 1]!;
      expect(filterArg).toContain("adelay=1000|1000");
      expect(filterArg).toContain("apad,atrim=0:5.000000");
      expect(filterArg).not.toContain("amix");
    });

    it("fails loudly when voiceover SHA-256 does not match storage bytes, preventing FFmpeg dispatch", async () => {
      const { runner, spawnedCommands } = createMockRunner();
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const voMedia = createStemMedia("voiceover-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/vo.mp3",
        body: voMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: voMedia.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-vo-hash-mismatch",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        voiceover: {
          assetId: "vo-tampered",
          kind: "voiceover",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/vo.mp3",
            sha256: "f".repeat(64), // tampered hash in spec
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 0,
          expectedDurationMs: 5000
        },
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "AUDIO_HASH_MISMATCH",
          context: expect.objectContaining({ assetKind: "voiceover", assetId: "vo-tampered" })
        })
      );

      // Verify no FFmpeg subprocess was dispatched at all before the hash gate
      expect(spawnedCommands).toHaveLength(0);
    });

    it("fails loudly when soundbed SHA-256 does not match storage bytes, preventing FFmpeg dispatch", async () => {
      const { runner, spawnedCommands } = createMockRunner();
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const sbMedia = createStemMedia("soundbed-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/sb.mp3",
        body: sbMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: sbMedia.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-sb-hash-mismatch",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        soundbed: {
          assetId: "sb-tampered",
          kind: "soundbed",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/sb.mp3",
            sha256: "0".repeat(64), // tampered hash
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 0,
          expectedDurationMs: 5000
        },
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "AUDIO_HASH_MISMATCH",
          context: expect.objectContaining({ assetKind: "soundbed", assetId: "sb-tampered" })
        })
      );

      // Verify no FFmpeg subprocess was dispatched at all before the hash gate
      expect(spawnedCommands).toHaveLength(0);
    });

    it("throws SUBTITLE_CAPABILITY_UNAVAILABLE only when subtitles are requested and filter is missing", async () => {
      const { runner } = createMockRunner({
        filters:
          "scale crop gblur overlay fps format concat aformat aresample volume aloop atrim amix alimiter" // missing ass/subtitles
      });
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const specWithSubtitles: AssemblySpec = {
        campaignId: "camp-sub-fail",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [{ startMs: 0, endMs: 2000, text: "Subtitles" }],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(specWithSubtitles)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "SUBTITLE_CAPABILITY_UNAVAILABLE"
        })
      );

      // Visual-only spec against the same ffmpeg instance succeeds (conditional check)
      const specWithoutSubtitles: AssemblySpec = {
        ...specWithSubtitles,
        subtitleCues: []
      };

      const result = await adapter.assemble(specWithoutSubtitles);
      expect(result.assemblyId).toBeDefined();
    });

    it("throws AUDIO_FILTER_UNAVAILABLE only when audio is requested and filter is missing", async () => {
      const { runner } = createMockRunner({
        filters: "scale crop gblur overlay fps format concat ass subtitles" // missing audio filters
      });
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const voMedia = createStemMedia("voiceover-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/vo.mp3",
        body: voMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: voMedia.sha256
      });

      const specWithVo: AssemblySpec = {
        campaignId: "camp-audio-fail",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        voiceover: {
          assetId: "vo-1",
          kind: "voiceover",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/vo.mp3",
            sha256: voMedia.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 0,
          expectedDurationMs: 5000
        },
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(specWithVo)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "AUDIO_FILTER_UNAVAILABLE"
        })
      );
    });

    it("does not require loudnorm for a soundbed-only assembly (loudnorm is only used for voiceover)", async () => {
      // loudnorm is deliberately omitted from the mocked ffmpeg -filters
      // output. A soundbed-only spec must still succeed: analyzeLoudness
      // (the only caller of loudnorm) is never invoked without a voiceover.
      const { runner } = createMockRunner({
        filters:
          "scale crop gblur overlay fps format concat aformat aresample volume aloop atrim amix alimiter adelay apad"
      });
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: runner
      });

      const stemMedia = createStemMedia("stem-video-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stemMedia.bytes,
        contentType: "video/mp4",
        checksumSha256: stemMedia.sha256
      });

      const sbMedia = createStemMedia("soundbed-audio-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "audio/soundbed-no-loudnorm.mp3",
        body: sbMedia.bytes,
        contentType: "audio/mpeg",
        checksumSha256: sbMedia.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-sb-no-loudnorm",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        soundbed: {
          assetId: "sb-no-loudnorm-1",
          kind: "soundbed",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/soundbed-no-loudnorm.mp3",
            sha256: sbMedia.sha256,
            contentType: "audio/mpeg"
          },
          source: { kind: "local" },
          startMs: 0,
          expectedDurationMs: 5000
        },
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stemMedia.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      const result = await adapter.assemble(spec);
      expect(result.executedInputs.soundbed).toBeDefined();
    });
  });

  describe("Finding 3: Resource boundaries and safeguards", () => {
    it("hard gate: stem exceeding maxStemInputBytes throws STEM_TOO_LARGE", async () => {
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        maxStemInputBytes: 10,
        spawnFn: async (_cmd, args) => {
          if (args.includes("-encoders")) return { exitCode: 0, stdout: "libx264", stderr: "" };
          if (args.includes("-filters"))
            return {
              exitCode: 0,
              stdout: "scale crop gblur overlay fps format concat",
              stderr: ""
            };
          if (args.includes("-version"))
            return { exitCode: 0, stdout: "ffmpeg version 7.1", stderr: "" };
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      });

      const stem = createStemMedia("this payload is longer than 10 bytes");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "STEM_TOO_LARGE"
        })
      );
    });

    it("hard gate: aggregate stem bytes exceeding maxAggregateInputBytes throws AGGREGATE_INPUT_TOO_LARGE", async () => {
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        maxStemInputBytes: 100,
        maxAggregateInputBytes: 30, // 2 stems of 20 bytes each = 40 bytes > 30 bytes limit
        spawnFn: async (_cmd, args) => {
          if (args.includes("-encoders")) return { exitCode: 0, stdout: "libx264", stderr: "" };
          if (args.includes("-filters"))
            return {
              exitCode: 0,
              stdout: "scale crop gblur overlay fps format concat",
              stderr: ""
            };
          if (args.includes("-version"))
            return { exitCode: 0, stdout: "ffmpeg version 7.1", stderr: "" };
          if (args.includes("-show_streams")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                streams: [
                  {
                    codec_type: "video",
                    codec_name: "h264",
                    pix_fmt: "yuv420p",
                    width: 1280,
                    height: 720,
                    r_frame_rate: "30/1",
                    duration: "2.500000"
                  }
                ],
                format: { duration: "2.500000" }
              }),
              stderr: ""
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      });

      const stem0 = createStemMedia("twenty_bytes_payload_1");
      const stem1 = createStemMedia("twenty_bytes_payload_2");

      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem0.bytes,
        contentType: "video/mp4",
        checksumSha256: stem0.sha256
      });
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem1.mp4",
        body: stem1.bytes,
        contentType: "video/mp4",
        checksumSha256: stem1.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem0.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 2500
          },
          {
            sceneId: "scene-02",
            generationManifestId: "gen-02",
            order: 1,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem1.mp4",
              sha256: stem1.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 2500
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "AGGREGATE_INPUT_TOO_LARGE"
        })
      );
    });

    it("rejects stem count exceeding maxStemCount with INPUT_LIMIT_EXCEEDED", async () => {
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        maxStemCount: 1
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 10000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: "0".repeat(64),
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          },
          {
            sceneId: "scene-02",
            generationManifestId: "gen-02",
            order: 1,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem1.mp4",
              sha256: "1".repeat(64),
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "INPUT_LIMIT_EXCEEDED"
        })
      );
    });

    it("rejects total duration exceeding maxTotalDurationMs with INPUT_LIMIT_EXCEEDED", async () => {
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        maxTotalDurationMs: 4000
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: "0".repeat(64),
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "INPUT_LIMIT_EXCEEDED"
        })
      );
    });

    it("hard gate: output file exceeding maxOutputBytes throws OUTPUT_TOO_LARGE before reading into memory", async () => {
      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        maxOutputBytes: 10, // 10 byte limit
        spawnFn: async (_cmd, args) => {
          if (args.includes("-encoders")) return { exitCode: 0, stdout: "libx264", stderr: "" };
          if (args.includes("-filters"))
            return {
              exitCode: 0,
              stdout: "scale crop gblur overlay fps format concat",
              stderr: ""
            };
          if (args.includes("-version"))
            return { exitCode: 0, stdout: "ffmpeg version 7.1", stderr: "" };
          if (args.includes("-show_streams")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                streams: [
                  {
                    codec_type: "video",
                    codec_name: "h264",
                    pix_fmt: "yuv420p",
                    width: 1080,
                    height: 1920,
                    r_frame_rate: "30/1",
                    duration: "5.000000"
                  }
                ],
                format: { duration: "5.000000" }
              }),
              stderr: ""
            };
          }
          if (args.includes("-filter_complex")) {
            // Simulate writing an output file larger than 10 bytes (e.g. 50 bytes)
            const outputPath = args[args.length - 1]!;
            await fs.writeFile(outputPath, "a".repeat(50));
            return { exitCode: 0, stdout: "", stderr: "" };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        }
      });

      const stem = createStemMedia("stem-payload");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "OUTPUT_TOO_LARGE"
        })
      );
    });
  });

  describe("Finding 4: Process timeouts & scratch cleanup", () => {
    it("cleans up scratch workspace when process times out", async () => {
      const stalledRunner: SpawnLikeFn = async (_cmd, args, options) => {
        if (args.includes("-encoders")) return { exitCode: 0, stdout: "libx264", stderr: "" };
        if (args.includes("-filters"))
          return { exitCode: 0, stdout: "scale crop gblur overlay fps format concat", stderr: "" };
        if (args.includes("-version"))
          return { exitCode: 0, stdout: "ffmpeg version 7.1", stderr: "" };
        if (args.includes("-show_streams")) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              streams: [
                {
                  codec_type: "video",
                  codec_name: "h264",
                  pix_fmt: "yuv420p",
                  width: 1280,
                  height: 720,
                  r_frame_rate: "30/1",
                  duration: "5.000000"
                }
              ],
              format: { duration: "5.000000" }
            }),
            stderr: ""
          };
        }
        if (args.includes("-filter_complex")) {
          // Simulate a stalled encoding process that exceeds timeout
          return new Promise((_, reject) => {
            setTimeout(() => {
              reject(
                new FfmpegAssemblyError(
                  "PROCESS_TIMEOUT",
                  `Process execution timed out after ${options?.timeoutMs}ms: ffmpeg`
                )
              );
            }, 10);
          });
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        encodeTimeoutMs: 50,
        spawnFn: stalledRunner
      });

      const stem = createStemMedia("stem-data");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "PROCESS_TIMEOUT"
        })
      );

      // Verify scratch workspace directory inside tempDir was cleaned up
      const remainingFiles = await fs.readdir(tempDir);
      expect(remainingFiles).toHaveLength(0);
    });
  });

  describe("Provenance and preflight gates", () => {
    it("throws ENCODER_UNAVAILABLE when libx264 is missing from ffmpeg -encoders", async () => {
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        if (args.includes("-encoders")) {
          return { exitCode: 0, stdout: " V..... other_encoder\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "ffmpeg version 7.0", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const stem = createStemMedia("stem-content");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "ENCODER_UNAVAILABLE"
        })
      );
    });

    it("throws FILTER_UNAVAILABLE when a required filter is missing from ffmpeg -filters", async () => {
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        if (args.includes("-encoders")) {
          return { exitCode: 0, stdout: " V..... libx264 H.264\n", stderr: "" };
        }
        if (args.includes("-filters")) {
          // Missing "gblur" and "concat" — the graph requires both.
          return {
            exitCode: 0,
            stdout:
              " ... scale             V->V\n ... crop              V->V\n ... overlay           VV->V\n ... fps               V->V\n ... format            V->V\n",
            stderr: ""
          };
        }
        return { exitCode: 0, stdout: "ffmpeg version 7.0", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const stem = createStemMedia("stem-content");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "FILTER_UNAVAILABLE",
          message: expect.stringContaining("gblur")
        })
      );
    });

    it("hard gate: SHA-256 mismatch prevents FFmpeg encode dispatch", async () => {
      const spawnedCommands: string[][] = [];
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        spawnedCommands.push([...args]);
        if (args.includes("-encoders")) {
          return { exitCode: 0, stdout: " V..... libx264 H.264\n", stderr: "" };
        }
        if (args.includes("-filters")) {
          return {
            exitCode: 0,
            stdout: "scale crop gblur overlay fps format concat",
            stderr: ""
          };
        }
        if (args.includes("-version")) {
          return { exitCode: 0, stdout: "ffmpeg version 7.1 Copyright\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const stem = createStemMedia("real-content");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const corruptedHash = "0".repeat(64);
      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: corruptedHash,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "STEM_HASH_MISMATCH"
        })
      );

      // Verify no FFmpeg subprocess was dispatched at all before the hash gate
      expect(spawnedCommands).toHaveLength(0);
    });

    it("hard gate: bad hash on a LATER stem prevents FFmpeg dispatch for EARLIER, already-verified-looking stems", async () => {
      // Two-phase preflight regression: stems must be fetched/bound/verified
      // in full before any stem is staged/normalized/probed. If verification
      // were interleaved with dispatch (the prior bug), stem 0 (order 0,
      // valid hash) would already have gone through ffmpeg/ffprobe by the
      // time stem 1's (order 1) bad hash is discovered.
      const spawnedCommands: string[][] = [];
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        spawnedCommands.push([...args]);
        if (args.includes("-encoders")) {
          return { exitCode: 0, stdout: " V..... libx264 H.264\n", stderr: "" };
        }
        if (args.includes("-filters")) {
          return {
            exitCode: 0,
            stdout: "scale crop gblur overlay fps format concat",
            stderr: ""
          };
        }
        if (args.includes("-version")) {
          return { exitCode: 0, stdout: "ffmpeg version 7.1 Copyright\n", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const stem0 = createStemMedia("first-stem-content");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem0.bytes,
        contentType: "video/mp4",
        checksumSha256: stem0.sha256
      });

      const stem1 = createStemMedia("second-stem-content");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem1.mp4",
        body: stem1.bytes,
        contentType: "video/mp4",
        checksumSha256: stem1.sha256
      });

      const corruptedHash = "0".repeat(64);
      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 10000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem0.sha256, // valid — order-0 stem passes its own check
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          },
          {
            sceneId: "scene-02",
            generationManifestId: "gen-02",
            order: 1,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem1.mp4",
              sha256: corruptedHash, // invalid — the later stem
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "STEM_HASH_MISMATCH",
          context: expect.objectContaining({ stemOrder: 1 })
        })
      );

      // Hard gate: zero subprocesses dispatched when a later stem fails hash verification
      expect(spawnedCommands).toHaveLength(0);
    });

    it("hard gate: probed duration out of tolerance throws STEM_DURATION_OUT_OF_TOLERANCE", async () => {
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        if (args.includes("-encoders")) return { exitCode: 0, stdout: "libx264", stderr: "" };
        if (args.includes("-filters"))
          return { exitCode: 0, stdout: "scale crop gblur overlay fps format concat", stderr: "" };
        if (args.includes("-version"))
          return { exitCode: 0, stdout: "ffmpeg version 7.1", stderr: "" };
        if (args.includes("-show_streams")) {
          // Return probed duration 6000ms when 5000ms is expected (>250ms diff)
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              streams: [
                {
                  codec_type: "video",
                  codec_name: "h264",
                  pix_fmt: "yuv420p",
                  width: 1280,
                  height: 720,
                  r_frame_rate: "30/1",
                  duration: "6.000000"
                }
              ],
              format: { duration: "6.000000" }
            }),
            stderr: ""
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const stem = createStemMedia("stem-data");
      await objectStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "scenes/s1/stem0.mp4",
        body: stem.bytes,
        contentType: "video/mp4",
        checksumSha256: stem.sha256
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        videoStems: [
          {
            sceneId: "scene-01",
            generationManifestId: "gen-01",
            order: 0,
            media: {
              bucket: BUCKETS.TEMP,
              key: "scenes/s1/stem0.mp4",
              sha256: stem.sha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5000
          }
        ]
      };

      await expect(adapter.assemble(spec)).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "STEM_DURATION_OUT_OF_TOLERANCE"
        })
      );
    });
  });
});
