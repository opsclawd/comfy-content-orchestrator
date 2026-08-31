import { describe, expect, it } from "vitest";
import {
  demuxAnimatedWebp,
  isAnimatedWebp,
  normalizeAnimatedWebpToMp4
} from "./webp-normalizer.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

describe("webp-normalizer", () => {
  function createSyntheticAnimatedWebpBuffer(): Buffer {
    // RIFF header
    // Total size will be calculated
    const vp8xChunk = Buffer.alloc(18);
    vp8xChunk.write("VP8X", 0);
    vp8xChunk.writeUInt32LE(10, 4);
    vp8xChunk.writeUInt8(0x02, 8); // Animation flag
    vp8xChunk.writeUIntLE(1279, 12, 3); // 1280 width
    vp8xChunk.writeUIntLE(719, 15, 3); // 720 height

    const animChunk = Buffer.alloc(14);
    animChunk.write("ANIM", 0);
    animChunk.writeUInt32LE(6, 4);
    animChunk.writeUInt32LE(0xffffffff, 8);
    animChunk.writeUInt16LE(0, 12);

    // Create 2 ANMF frames
    const anmf1 = Buffer.alloc(32);
    anmf1.write("ANMF", 0);
    anmf1.writeUInt32LE(24, 4);
    anmf1.writeUIntLE(0, 8, 3); // x
    anmf1.writeUIntLE(0, 11, 3); // y
    anmf1.writeUIntLE(1279, 14, 3); // w
    anmf1.writeUIntLE(719, 17, 3); // h
    anmf1.writeUIntLE(41, 20, 3); // duration: 41ms (~24fps)
    anmf1.writeUInt8(0, 23); // flags
    anmf1.write("VP8 ", 24);
    anmf1.writeUInt32LE(0, 28);

    const anmf2 = Buffer.alloc(32);
    anmf2.write("ANMF", 0);
    anmf2.writeUInt32LE(24, 4);
    anmf2.writeUIntLE(0, 8, 3);
    anmf2.writeUIntLE(0, 11, 3);
    anmf2.writeUIntLE(1279, 14, 3);
    anmf2.writeUIntLE(719, 17, 3);
    anmf2.writeUIntLE(42, 20, 3); // duration: 42ms
    anmf2.writeUInt8(0, 23);
    anmf2.write("VP8 ", 24);
    anmf2.writeUInt32LE(0, 28);

    const body = Buffer.concat([vp8xChunk, animChunk, anmf1, anmf2]);
    const riffHeader = Buffer.alloc(12);
    riffHeader.write("RIFF", 0);
    riffHeader.writeUInt32LE(4 + body.length, 4);
    riffHeader.write("WEBP", 8);

    return Buffer.concat([riffHeader, body]);
  }

  it("identifies animated WebP correctly and rejects non-webp or static webp", () => {
    const animBuf = createSyntheticAnimatedWebpBuffer();
    expect(isAnimatedWebp(animBuf)).toBe(true);

    const mp4Buf = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]);
    expect(isAnimatedWebp(mp4Buf)).toBe(false);

    const smallBuf = Buffer.from("short");
    expect(isAnimatedWebp(smallBuf)).toBe(false);
  });

  it("demuxes animated WebP into individual frame buffers with correct metadata", () => {
    const animBuf = createSyntheticAnimatedWebpBuffer();
    const demuxed = demuxAnimatedWebp(animBuf);

    expect(demuxed.frames).toHaveLength(2);
    expect(demuxed.totalDurationMs).toBe(83); // 41 + 42
    expect(demuxed.width).toBe(1280);
    expect(demuxed.height).toBe(720);
    expect(demuxed.fps).toBe(24);
    expect(demuxed.combinedFrames.length).toBeGreaterThan(0);

    // Check that each frame has RIFF WEBP magic
    for (const frame of demuxed.frames) {
      expect(frame.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(frame.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
    }
  });

  it("normalizes animated WebP using spawn runner with stdin stream", async () => {
    const animBuf = createSyntheticAnimatedWebpBuffer();
    let passedStdin: Buffer | undefined;
    let passedArgs: readonly string[] = [];

    const fakeRunner: SpawnLikeFn = async (_cmd, args, options) => {
      passedArgs = args;
      if (options?.stdin) {
        passedStdin = Buffer.isBuffer(options.stdin) ? options.stdin : Buffer.from(options.stdin);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await normalizeAnimatedWebpToMp4({
      bytes: animBuf,
      outputPath: "/tmp/output.mp4",
      ffmpegPath: "ffmpeg",
      spawnFn: fakeRunner
    });

    expect(passedArgs).toContain("image2pipe");
    expect(passedArgs).toContain("webp");
    expect(passedStdin).toBeDefined();
    expect(passedStdin?.length).toBeGreaterThan(0);
  });
});
