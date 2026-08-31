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

  describe("Finding 2: Unsupported input fail-fast", () => {
    it("rejects voiceover with UNSUPPORTED_INPUT before capability checks or storage access", async () => {
      let spawnCalled = false;
      const fakeRunner: SpawnLikeFn = async () => {
        spawnCalled = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        voiceover: {
          assetId: "vo-1",
          kind: "voiceover",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/vo.mp3",
            sha256: "0".repeat(64),
            contentType: "audio/mpeg"
          },
          source: { kind: "provider", providerId: "p", modelId: "m" },
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
          code: "UNSUPPORTED_INPUT"
        })
      );

      expect(spawnCalled).toBe(false);
    });

    it("rejects soundbed with UNSUPPORTED_INPUT before capability checks or storage access", async () => {
      let spawnCalled = false;
      const fakeRunner: SpawnLikeFn = async () => {
        spawnCalled = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [],
        soundbed: {
          assetId: "sb-1",
          kind: "soundbed",
          media: {
            bucket: BUCKETS.TEMP,
            key: "audio/sb.wav",
            sha256: "0".repeat(64),
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
          code: "UNSUPPORTED_INPUT"
        })
      );

      expect(spawnCalled).toBe(false);
    });

    it("rejects non-empty subtitleCues with UNSUPPORTED_INPUT before capability checks or storage access", async () => {
      let spawnCalled = false;
      const fakeRunner: SpawnLikeFn = async () => {
        spawnCalled = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const adapter = new FfmpegMediaAssemblerAdapter({
        ffmpegPath: "ffmpeg",
        ffprobePath: "ffprobe",
        workspaceRoot: tempDir,
        objectStorage,
        spawnFn: fakeRunner
      });

      const spec: AssemblySpec = {
        campaignId: "camp-001",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 5000,
        subtitleCues: [{ startMs: 0, endMs: 5000, text: "Subtitle dialogue" }],
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
          code: "UNSUPPORTED_INPUT"
        })
      );

      expect(spawnCalled).toBe(false);
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

    it("hard gate: SHA-256 mismatch prevents FFmpeg encode dispatch", async () => {
      const spawnedCommands: string[][] = [];
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        spawnedCommands.push([...args]);
        if (args.includes("-encoders")) {
          return { exitCode: 0, stdout: " V..... libx264 H.264\n", stderr: "" };
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

      // Verify FFmpeg filter_complex encode was NEVER dispatched
      const encodeCommandDispatched = spawnedCommands.some((args) =>
        args.includes("-filter_complex")
      );
      expect(encodeCommandDispatched).toBe(false);
    });

    it("hard gate: probed duration out of tolerance throws STEM_DURATION_OUT_OF_TOLERANCE", async () => {
      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        if (args.includes("-encoders")) return { exitCode: 0, stdout: "libx264", stderr: "" };
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
