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

  it("parses frameCount from nb_frames or nb_read_frames and passes countFrames", async () => {
    let capturedArgs: readonly string[] = [];
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "24/1",
          duration: "5.000000",
          nb_frames: "120",
          nb_read_frames: "124"
        }
      ],
      format: {
        duration: "5.000000"
      }
    });

    const runner: SpawnLikeFn = async (_cmd, args) => {
      capturedArgs = args;
      return {
        exitCode: 0,
        stdout: jsonOutput,
        stderr: ""
      };
    };

    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/output.mp4",
      countFrames: true
    });

    expect(capturedArgs).toContain("-count_frames");
    expect(result.videoStream.frameCount).toBe(124);
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

  it("emits null frameRate and preserves avgFrameRate when the two rates differ", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "90000/1",
          avg_frame_rate: "24/1",
          duration: "5.000000",
          nb_frames: "120"
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
      filePath: "/fake/path/vfr.mp4"
    });

    expect(result.videoStream.frameRate).toBeNull();
    expect(result.videoStream.avgFrameRate).toBe(24);
  });

  it("does not substitute r_frame_rate when avg_frame_rate is 0/0 for variable frame rate", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "90000/1",
          avg_frame_rate: "0/0",
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
      filePath: "/fake/path/unknown_fps.mp4"
    });

    expect(result.videoStream.frameRate).toBeNull();
    expect(result.videoStream.avgFrameRate).toBeUndefined();
  });

  it("emits positive frameRate when rates match (CFR)", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "25/1",
          avg_frame_rate: "25/1",
          duration: "1.000000",
          nb_frames: "4"
        }
      ],
      format: {
        duration: "1.000000"
      }
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/cfr_uniform.mp4"
    });

    expect(result.videoStream.frameRate).toBe(25);
    expect(result.videoStream.avgFrameRate).toBe(25);
  });

  it("emits null frameRate and preserves avgFrameRate when frame presentation intervals are non-uniform despite positive avg_frame_rate", async () => {
    let capturedArgs: readonly string[] = [];
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "24/1",
          avg_frame_rate: "24/1",
          duration: "1.000000",
          nb_frames: "4"
        }
      ],
      frames: [
        { pts_time: "0.000000" },
        { pts_time: "0.030000" },
        { pts_time: "0.080000" },
        { pts_time: "0.125000" }
      ],
      format: {
        duration: "1.000000"
      }
    });

    const runner: SpawnLikeFn = async (_cmd, args) => {
      capturedArgs = args;
      return {
        exitCode: 0,
        stdout: jsonOutput,
        stderr: ""
      };
    };

    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/vfr_positive_avg.mp4",
      checkFrameIntervals: true
    });

    expect(capturedArgs).toContain("-show_entries");
    expect(result.videoStream.frameRate).toBeNull();
    expect(result.videoStream.avgFrameRate).toBe(24);
  });

  it("emits positive frameRate when frame presentation intervals are uniform and match frame rate", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "25/1",
          avg_frame_rate: "25/1",
          duration: "1.000000",
          nb_frames: "4"
        }
      ],
      frames: [
        { pts_time: "0.000000" },
        { pts_time: "0.040000" },
        { pts_time: "0.080000" },
        { pts_time: "0.120000" }
      ],
      format: {
        duration: "1.000000"
      }
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/cfr_frames.mp4",
      checkFrameIntervals: true
    });

    expect(result.videoStream.frameRate).toBe(25);
    expect(result.videoStream.avgFrameRate).toBe(25);
  });

  it("emits positive frameRate for a real CFR stream with sub-millisecond decode jitter, not incorrectly rejected as VFR by the tightened tolerance", async () => {
    // 24fps => expected interval ~0.0416667s. Each interval below is jittered
    // by roughly +/-0.0003s (0.3ms), well inside the 1ms/2% tolerance, mirroring
    // realistic decode/timestamp jitter on genuinely constant-rate output.
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "24/1",
          avg_frame_rate: "24/1",
          duration: "1.000000",
          nb_frames: "5"
        }
      ],
      frames: [
        { pts_time: "0.000000" },
        { pts_time: "0.041950" },
        { pts_time: "0.083383" },
        { pts_time: "0.125300" },
        { pts_time: "0.166650" }
      ],
      format: {
        duration: "1.000000"
      }
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/cfr_jitter.mp4",
      checkFrameIntervals: true
    });

    expect(result.videoStream.frameRate).toBe(24);
    expect(result.videoStream.avgFrameRate).toBe(24);
  });

  it("emits null frameRate when checkFrameIntervals is requested but ffprobe returns no frame records to confirm cadence, even though metadata rates agree", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          r_frame_rate: "25/1",
          avg_frame_rate: "25/1",
          duration: "1.000000",
          nb_frames: "4"
        }
      ],
      frames: [],
      format: {
        duration: "1.000000"
      }
    });

    const runner = fakeRunnerWithJson(jsonOutput);
    const result = await probeMedia({
      runner,
      ffprobePath: "ffprobe",
      filePath: "/fake/path/no_frame_records.mp4",
      checkFrameIntervals: true
    });

    expect(result.videoStream.frameRate).toBeNull();
    expect(result.videoStream.avgFrameRate).toBe(25);
  });

  it("emits null frameRate when only avg_frame_rate is provided without frame intervals to prove constant rate", async () => {
    const jsonOutput = JSON.stringify({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          pix_fmt: "yuv420p",
          width: 1280,
          height: 720,
          avg_frame_rate: "24/1",
          duration: "5.000000",
          nb_frames: "120"
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
      filePath: "/fake/path/only_avg_rate.mp4"
    });

    expect(result.videoStream.frameRate).toBeNull();
    expect(result.videoStream.avgFrameRate).toBe(24);
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

  describe("probeAudioMedia", () => {
    it("probes audio stream correctly", async () => {
      const jsonOutput = JSON.stringify({
        streams: [
          {
            codec_type: "audio",
            codec_name: "mp3",
            sample_rate: "44100",
            channels: 1,
            bit_rate: "128000",
            duration: "8.500000"
          }
        ],
        format: {
          duration: "8.500000"
        }
      });

      const runner = fakeRunnerWithJson(jsonOutput);
      const { audioStream, formatDurationMs } = await (
        await import("./ffprobe-client.js")
      ).probeAudioMedia({
        runner,
        ffprobePath: "ffprobe",
        filePath: "/fake/audio.mp3"
      });

      expect(audioStream.codecName).toBe("mp3");
      expect(audioStream.sampleRateHz).toBe(44100);
      expect(audioStream.channels).toBe(1);
      expect(audioStream.durationMs).toBe(8500);
      expect(audioStream.bitrateKbps).toBe(128);
      expect(formatDurationMs).toBe(8500);
    });

    it("throws AUDIO_NO_AUDIO_STREAM when no audio stream is present", async () => {
      const jsonOutput = JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264"
          }
        ]
      });

      const runner = fakeRunnerWithJson(jsonOutput);
      await expect(
        (await import("./ffprobe-client.js")).probeAudioMedia({
          runner,
          ffprobePath: "ffprobe",
          filePath: "/fake/video_only.mp4"
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          name: "FfmpegAssemblyError",
          code: "AUDIO_NO_AUDIO_STREAM"
        })
      );
    });
  });
});
