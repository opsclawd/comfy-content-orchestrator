import { describe, expect, it } from "vitest";
import { probeMedia } from "./ffprobe-client.js";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";

describe("ffprobe-client", () => {
  const fakeRunnerWithJson = (stdout: string, exitCode = 0, stderr = ""): SpawnLikeFn => {
    return async () => ({
      exitCode,
      stdout,
      stderr
    });
  };

  it("parses valid probed video media", async () => {
    const jsonOutput = JSON.stringify({
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
      format: {
        duration: "5.000000"
      }
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/stem.mp4"
    });

    expect(result.videoStream).toEqual({
      codecName: "h264",
      pixelFormat: "yuv420p",
      width: 1280,
      height: 720,
      frameRate: 30,
      durationMs: 5000
    });
    expect(result.audioStream).toBeUndefined();
    expect(result.formatDurationMs).toBe(5000);
  });

  it("parses video and audio streams when present", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1080,
          height: 1920,
          r_frame_rate: "30000/1001",
          duration: "30.000000"
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          sample_rate: "48000",
          channels: 2,
          bit_rate: "192000",
          duration: "30.000000"
        }
      ],
      format: {
        duration: "30.000000"
      }
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/output.mp4"
    });

    expect(result.videoStream.width).toBe(1080);
    expect(result.videoStream.height).toBe(1920);
    expect(result.videoStream.frameRate).toBeCloseTo(29.97, 2);
    expect(result.audioStream).toBeDefined();
    expect(result.audioStream?.codecName).toBe("aac");
    expect(result.audioStream?.sampleRateHz).toBe(48000);
    expect(result.audioStream?.channels).toBe(2);
    expect(result.audioStream?.bitrateKbps).toBe(192);
  });

  it("throws STEM_NO_VIDEO_STREAM when no video stream is present", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "audio",
          codec_name: "mp3",
          duration: "5.0"
        }
      ]
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    await expect(
      probeMedia({
        runner,
        ffprobePath: "ffprobe",
        filePath: "/fake/audio.mp3"
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_NO_VIDEO_STREAM"
      })
    );
  });

  it("throws STEM_PROBE_FAILED on unparseable JSON", async () => {
    const runner = fakeRunnerWithJson("not valid json at all");
    await expect(
      probeMedia({
        runner,
        ffprobePath: "ffprobe",
        filePath: "/fake/corrupt.mp4"
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_PROBE_FAILED"
      })
    );
  });

  it("throws STEM_PROBE_FAILED when exitCode is non-zero", async () => {
    const runner = fakeRunnerWithJson("", 1, "ffprobe error");
    await expect(
      probeMedia({
        runner,
        ffprobePath: "ffprobe",
        filePath: "/fake/invalid.mp4"
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "FfmpegAssemblyError",
        code: "STEM_PROBE_FAILED"
      })
    );
  });
});
