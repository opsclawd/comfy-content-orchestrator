import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  demuxAnimatedWebp,
  isAnimatedWebp,
  normalizeAnimatedWebpToMp4
} from "./webp-normalizer.js";
import { FfmpegAssemblyError } from "./ffmpeg-error.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

describe("webp-normalizer", () => {
  // Builds a single-frame animated WebP with an explicitly controllable
  // ANMF frame rectangle, blend flag, and payload sub-chunk type — used to
  // exercise the fail-closed ANMF compositing-subset validation directly
  // against real-artifact-derived cases (issue #131).
  function createAnimatedWebpWithFrame(opts: {
    canvasWidth: number;
    canvasHeight: number;
    frameX: number;
    frameY: number;
    frameWidth: number;
    frameHeight: number;
    blend: 0 | 1;
    hasAlpha: boolean;
  }): Buffer {
    const vp8xChunk = Buffer.alloc(18);
    vp8xChunk.write("VP8X", 0);
    vp8xChunk.writeUInt32LE(10, 4);
    vp8xChunk.writeUInt8(0x02, 8); // Animation flag
    vp8xChunk.writeUIntLE(opts.canvasWidth - 1, 12, 3);
    vp8xChunk.writeUIntLE(opts.canvasHeight - 1, 15, 3);

    const animChunk = Buffer.alloc(14);
    animChunk.write("ANIM", 0);
    animChunk.writeUInt32LE(6, 4);
    animChunk.writeUInt32LE(0xffffffff, 8);
    animChunk.writeUInt16LE(0, 12);

    const payload = opts.hasAlpha
      ? Buffer.concat([Buffer.from("ALPH", "ascii"), Buffer.from([0, 0, 0, 0])])
      : Buffer.concat([Buffer.from("VP8 ", "ascii"), Buffer.from([0, 0, 0, 0])]);

    const anmfHeader = Buffer.alloc(16);
    anmfHeader.writeUIntLE(opts.frameX / 2, 0, 3);
    anmfHeader.writeUIntLE(opts.frameY / 2, 3, 3);
    anmfHeader.writeUIntLE(opts.frameWidth - 1, 6, 3);
    anmfHeader.writeUIntLE(opts.frameHeight - 1, 9, 3);
    anmfHeader.writeUIntLE(41, 12, 3); // duration: 41ms
    anmfHeader.writeUInt8(opts.blend << 1, 15); // disposal=0, blend as given

    const anmfBody = Buffer.concat([anmfHeader, payload]);
    const anmfChunk = Buffer.concat([
      Buffer.from("ANMF", "ascii"),
      (() => {
        const sizeBuf = Buffer.alloc(4);
        sizeBuf.writeUInt32LE(anmfBody.length, 0);
        return sizeBuf;
      })(),
      anmfBody
    ]);

    const body = Buffer.concat([vp8xChunk, animChunk, anmfChunk]);
    const riffHeader = Buffer.alloc(12);
    riffHeader.write("RIFF", 0);
    riffHeader.writeUInt32LE(4 + body.length, 4);
    riffHeader.write("WEBP", 8);

    return Buffer.concat([riffHeader, body]);
  }

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

  describe("ANMF compositing-subset validation (issue #131)", () => {
    // The bounds validated below (full-canvas/origin-(0,0) frames; blend=1
    // only ever co-occurring with fully-opaque, non-alpha frames) were
    // empirically confirmed against a real LTX_25_720P_5S_V1 certification
    // artifact (ltx_25_720p_97f_00002_.webp, 97 frames): 97/97 frames were
    // full-canvas/origin-(0,0), and every blend=1 frame lacked an alpha
    // channel (making the blend flag a no-op), while every frame that did
    // carry alpha was blend=0 (overwrite, no compositing needed). Anything
    // outside that subset must fail closed rather than silently mis-render.

    it("accepts a full-canvas, origin-(0,0), blend=0 frame with no alpha", () => {
      const buf = createAnimatedWebpWithFrame({
        canvasWidth: 1280,
        canvasHeight: 704,
        frameX: 0,
        frameY: 0,
        frameWidth: 1280,
        frameHeight: 704,
        blend: 0,
        hasAlpha: false
      });
      expect(() => demuxAnimatedWebp(buf)).not.toThrow();
    });

    it("accepts a full-canvas, origin-(0,0), blend=0 frame that carries alpha (no compositing needed)", () => {
      const buf = createAnimatedWebpWithFrame({
        canvasWidth: 1280,
        canvasHeight: 704,
        frameX: 0,
        frameY: 0,
        frameWidth: 1280,
        frameHeight: 704,
        blend: 0,
        hasAlpha: true
      });
      expect(() => demuxAnimatedWebp(buf)).not.toThrow();
    });

    it("accepts a full-canvas, origin-(0,0), blend=1 frame with no alpha (overwrite-equivalent no-op)", () => {
      const buf = createAnimatedWebpWithFrame({
        canvasWidth: 1280,
        canvasHeight: 704,
        frameX: 0,
        frameY: 0,
        frameWidth: 1280,
        frameHeight: 704,
        blend: 1,
        hasAlpha: false
      });
      expect(() => demuxAnimatedWebp(buf)).not.toThrow();
    });

    it("fails closed on a frame that isn't full-canvas at origin (0,0)", () => {
      const buf = createAnimatedWebpWithFrame({
        canvasWidth: 1280,
        canvasHeight: 704,
        frameX: 100,
        frameY: 50,
        frameWidth: 800,
        frameHeight: 600,
        blend: 0,
        hasAlpha: false
      });
      expect(() => demuxAnimatedWebp(buf)).toThrow(FfmpegAssemblyError);
      expect(() => demuxAnimatedWebp(buf)).toThrow(/not full-canvas at origin/);
    });

    it("fails closed on a blend=1 frame that carries an alpha channel (real compositing required)", () => {
      const buf = createAnimatedWebpWithFrame({
        canvasWidth: 1280,
        canvasHeight: 704,
        frameX: 0,
        frameY: 0,
        frameWidth: 1280,
        frameHeight: 704,
        blend: 1,
        hasAlpha: true
      });
      expect(() => demuxAnimatedWebp(buf)).toThrow(FfmpegAssemblyError);
      expect(() => demuxAnimatedWebp(buf)).toThrow(/alpha-blending compositing/);
    });
  });

  describe("normalizeAnimatedWebpToMp4", () => {
    let scratchDir: string;

    beforeEach(async () => {
      scratchDir = await mkdtemp(join(tmpdir(), "webp-normalizer-test-"));
    });

    afterEach(async () => {
      await rm(scratchDir, { recursive: true, force: true });
    });

    it("drives ffmpeg via the concat demuxer with an explicit per-frame duration, not a constant framerate", async () => {
      const animBuf = createSyntheticAnimatedWebpBuffer();
      let passedArgs: readonly string[] = [];
      let concatScript = "";

      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        passedArgs = args;
        const concatScriptPath = args[args.indexOf("-i") + 1]!;
        // Read while the scratch dir still exists — normalizeAnimatedWebpToMp4
        // cleans it up in a `finally` block once spawnFn resolves.
        concatScript = await readFile(concatScriptPath, "utf-8");
        await writeFile(args[args.length - 1]!, "fake-mp4-bytes");
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      const result = await normalizeAnimatedWebpToMp4({
        bytes: animBuf,
        outputPath: join(scratchDir, "output.mp4"),
        ffmpegPath: "ffmpeg",
        spawnFn: fakeRunner
      });

      expect(result.normalizedSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);

      // No longer collapses variable per-frame durations into one constant
      // "-framerate" value fed via image2pipe — that's the mechanism that
      // caused drift. Must use the concat demuxer with vfr output instead.
      expect(passedArgs).toContain("concat");
      expect(passedArgs).toContain("-fps_mode");
      expect(passedArgs).toContain("vfr");
      expect(passedArgs).not.toContain("image2pipe");
      expect(passedArgs).not.toContain("-framerate");

      // Each frame's own duration (41ms, 42ms) must be preserved exactly —
      // not replaced by a single rounded average.
      expect(concatScript).toContain("duration 0.041000");
      expect(concatScript).toContain("duration 0.042000");
      // Exactly one "file" entry per source frame — no trailing duplicate.
      // A duplicated final entry (a documented workaround for CFR-oriented
      // concat+encode setups) produces a genuine extra output frame when
      // combined with "-fps_mode vfr", confirmed empirically against real
      // ffmpeg: 97 source frames in, 98 frames / +39ms out with the
      // duplicate; exactly 97 frames / source-matching duration without it.
      const fileLines = concatScript.split("\n").filter((l) => l.startsWith("file "));
      expect(fileLines).toHaveLength(2);
    });

    it("writes each demuxed frame to its own file consumed by the concat script, then cleans up", async () => {
      const animBuf = createSyntheticAnimatedWebpBuffer();
      let capturedConcatDir: string | undefined;

      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        const concatScriptPath = args[args.indexOf("-i") + 1]!;
        capturedConcatDir = concatScriptPath.slice(0, concatScriptPath.lastIndexOf("/"));
        const script = await readFile(concatScriptPath, "utf-8");
        // Referenced frame files must actually exist on disk while ffmpeg runs.
        for (const line of script.split("\n")) {
          if (line.startsWith("file '")) {
            const fileName = line.slice(6, -1);
            await expect(readFile(join(capturedConcatDir!, fileName))).resolves.toBeInstanceOf(
              Buffer
            );
          }
        }
        await writeFile(args[args.length - 1]!, "fake-mp4-bytes");
        return { exitCode: 0, stdout: "", stderr: "" };
      };

      await normalizeAnimatedWebpToMp4({
        bytes: animBuf,
        outputPath: join(scratchDir, "output.mp4"),
        ffmpegPath: "ffmpeg",
        spawnFn: fakeRunner
      });

      // The scratch frames directory is removed once normalization finishes.
      expect(capturedConcatDir).toBeDefined();
      await expect(readFile(join(capturedConcatDir!, "concat.txt"))).rejects.toThrow();
    });

    it("throws FFMPEG_EXECUTION_FAILED on non-zero exit and still cleans up scratch files", async () => {
      const animBuf = createSyntheticAnimatedWebpBuffer();
      let capturedConcatDir: string | undefined;

      const fakeRunner: SpawnLikeFn = async (_cmd, args) => {
        const concatScriptPath = args[args.indexOf("-i") + 1]!;
        capturedConcatDir = concatScriptPath.slice(0, concatScriptPath.lastIndexOf("/"));
        return { exitCode: 1, stdout: "", stderr: "boom" };
      };

      await expect(
        normalizeAnimatedWebpToMp4({
          bytes: animBuf,
          outputPath: join(scratchDir, "output.mp4"),
          ffmpegPath: "ffmpeg",
          spawnFn: fakeRunner
        })
      ).rejects.toThrow(/FFmpeg WebP normalization failed/);

      expect(capturedConcatDir).toBeDefined();
      await expect(readFile(join(capturedConcatDir!, "concat.txt"))).rejects.toThrow();
    });
  });
});
