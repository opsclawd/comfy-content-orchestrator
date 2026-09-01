import { describe, expect, it } from "vitest";
import { ExecutedSoundbedRefSchema, ExecutedVoiceoverRefSchema } from "@cco/contracts";
import type { SpawnLikeFn } from "./ffmpeg-process-runner.js";
import {
  AUDIO_LIMITER_CEILING_DBTP,
  AUDIO_LIMITER_CEILING_LINEAR,
  AUDIO_LIMITER_OVERSAMPLE_RATE_HZ,
  AUDIO_OUTPUT_BITRATE_KBPS,
  AUDIO_OUTPUT_CHANNELS,
  AUDIO_OUTPUT_SAMPLE_RATE_HZ,
  SOUNDBED_BASELINE_GAIN_DB,
  SOUNDBED_DUCKING_DB,
  VO_TARGET_INTEGRATED_LUFS,
  analyzeLoudness,
  buildAudioMixGraph,
  buildSoundbedFilterChain,
  buildVoiceoverFilterChain,
  computeExecutedSoundbedMath,
  computeExecutedVoiceoverMath,
  computeStaticGainDb
} from "./audio-mix.js";

describe("audio-mix", () => {
  describe("constants", () => {
    it("has documented audio targets", () => {
      expect(VO_TARGET_INTEGRATED_LUFS).toBe(-16.0);
      expect(SOUNDBED_BASELINE_GAIN_DB).toBe(-18.0);
      expect(SOUNDBED_DUCKING_DB).toBe(-12.0);
      expect(AUDIO_OUTPUT_SAMPLE_RATE_HZ).toBe(48000);
      expect(AUDIO_OUTPUT_CHANNELS).toBe(2);
      expect(AUDIO_OUTPUT_BITRATE_KBPS).toBe(192);
      expect(AUDIO_LIMITER_CEILING_LINEAR).toBeLessThan(1.0);
      expect(AUDIO_LIMITER_CEILING_DBTP).toBe(-1.0);
      expect(AUDIO_LIMITER_OVERSAMPLE_RATE_HZ).toBe(192000);
    });
  });

  describe("computeStaticGainDb", () => {
    it("computes correct dB adjustment to reach target LUFS", () => {
      expect(computeStaticGainDb(-24.0, -16.0)).toBe(8.0);
      expect(computeStaticGainDb(-12.0, -16.0)).toBe(-4.0);
      expect(computeStaticGainDb(-16.0, -16.0)).toBe(0);
    });

    it("handles extreme or silent values safely", () => {
      expect(computeStaticGainDb(-Infinity, -16.0)).toBe(0);
      expect(computeStaticGainDb(-80.0, -16.0)).toBe(0);
      expect(computeStaticGainDb(NaN, -16.0)).toBe(0);
    });
  });

  describe("computeExecutedVoiceoverMath", () => {
    it("computes voiceover math satisfying ExecutedVoiceoverRefSchema with trailing timeline padding", () => {
      const math = computeExecutedVoiceoverMath({
        actualDurationMs: 12000,
        targetDurationMs: 30000,
        startMs: 2000,
        gainDb: 4.5
      });

      const fullRef = {
        assetId: "vo-1",
        kind: "voiceover" as const,
        media: {
          bucket: "test-bucket",
          key: "vo.mp3",
          sha256: "a".repeat(64),
          contentType: "audio/mpeg"
        },
        source: { kind: "local" as const },
        startMs: 2000,
        actualDurationMs: 12000,
        ...math
      };

      const parsed = ExecutedVoiceoverRefSchema.safeParse(fullRef);
      expect(parsed.success).toBe(true);
      expect(math.effectiveDurationMs).toBe(28000); // 12000 + padTrailingMs 16000
      expect(math.effectiveStartMs).toBe(2000);
      expect(math.padTrailingMs).toBe(16000);
      expect(math.loopCount).toBe(1);
      expect(math.partialLoopDurationMs).toBe(0);
    });

    it("clamps voiceover trimming when source exceeds timeline window", () => {
      const math = computeExecutedVoiceoverMath({
        actualDurationMs: 35000,
        targetDurationMs: 30000,
        startMs: 2000,
        gainDb: 0
      });

      expect(math.trimEndMs).toBe(28000);
      expect(math.effectiveDurationMs).toBe(28000);
      expect(math.padTrailingMs).toBe(0);
    });

    it("reports zero effectiveDurationMs when startMs is at or past the target timeline (no audible window)", () => {
      // buildVoiceoverFilterChain delays the signal by startMs then trims to
      // targetDurationMs — when startMs >= targetDurationMs the real
      // rendered output is 100% silence, so the manifest must not claim any
      // voiceover duration.
      const math = computeExecutedVoiceoverMath({
        actualDurationMs: 15000,
        targetDurationMs: 30000,
        startMs: 30000,
        gainDb: 0
      });

      expect(math.trimEndMs).toBe(0);
      expect(math.effectiveDurationMs).toBe(0);
      expect(math.padTrailingMs).toBe(0);

      // Also holds when startMs exceeds targetDurationMs entirely.
      const mathPastEnd = computeExecutedVoiceoverMath({
        actualDurationMs: 15000,
        targetDurationMs: 30000,
        startMs: 40000,
        gainDb: 0
      });
      expect(mathPastEnd.effectiveDurationMs).toBe(0);
    });
  });

  describe("computeExecutedSoundbedMath", () => {
    it("computes looping soundbed math satisfying ExecutedSoundbedRefSchema (longer than source)", () => {
      const math = computeExecutedSoundbedMath({
        actualDurationMs: 10000,
        targetDurationMs: 25000,
        startMs: 0,
        gainDb: -18.0,
        duckingDb: -12.0
      });

      const fullRef = {
        assetId: "sb-1",
        kind: "soundbed" as const,
        media: {
          bucket: "test-bucket",
          key: "sb.mp3",
          sha256: "b".repeat(64),
          contentType: "audio/mpeg"
        },
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 10000,
        ...math
      };

      const parsed = ExecutedSoundbedRefSchema.safeParse(fullRef);
      expect(parsed.success).toBe(true);
      expect(math.effectiveDurationMs).toBe(25000);
      expect(math.loopCount).toBe(2);
      expect(math.partialLoopDurationMs).toBe(5000);
    });

    it("computes trimmed soundbed math satisfying ExecutedSoundbedRefSchema (shorter than source)", () => {
      const math = computeExecutedSoundbedMath({
        actualDurationMs: 30000,
        targetDurationMs: 10000,
        startMs: 0,
        gainDb: -18.0,
        duckingDb: 0
      });

      const fullRef = {
        assetId: "sb-2",
        kind: "soundbed" as const,
        media: {
          bucket: "test-bucket",
          key: "sb.mp3",
          sha256: "b".repeat(64),
          contentType: "audio/mpeg"
        },
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 30000,
        ...math
      };

      const parsed = ExecutedSoundbedRefSchema.safeParse(fullRef);
      expect(parsed.success).toBe(true);
      expect(math.effectiveDurationMs).toBe(10000);
      expect(math.loopCount).toBe(0);
      expect(math.partialLoopDurationMs).toBe(10000);
    });

    it("computes soundbed math with startMs > 0", () => {
      const math = computeExecutedSoundbedMath({
        actualDurationMs: 10000,
        targetDurationMs: 30000,
        startMs: 2000,
        gainDb: -18.0,
        duckingDb: -12.0
      });

      const fullRef = {
        assetId: "sb-offset",
        kind: "soundbed" as const,
        media: {
          bucket: "test-bucket",
          key: "sb.mp3",
          sha256: "b".repeat(64),
          contentType: "audio/mpeg"
        },
        source: { kind: "local" as const },
        startMs: 2000,
        actualDurationMs: 10000,
        ...math
      };

      const parsed = ExecutedSoundbedRefSchema.safeParse(fullRef);
      expect(parsed.success).toBe(true);
      expect(math.effectiveStartMs).toBe(2000);
      expect(math.effectiveDurationMs).toBe(28000);
      expect(math.loopCount).toBe(2);
      expect(math.partialLoopDurationMs).toBe(8000);
    });
  });

  describe("filter chain builders", () => {
    it("builds voiceover filter chain with adelay, apad, and atrim", () => {
      const { filter, outputLabel } = buildVoiceoverFilterChain({
        inputIndex: 6,
        startMs: 2500,
        targetDurationMs: 30000,
        gainDb: 3.2
      });

      expect(outputLabel).toBe("vo_proc");
      expect(filter).toBe(
        "[6:a]aformat=channel_layouts=stereo,aresample=48000,volume=3.20dB,adelay=2500|2500,apad,atrim=0:30.000000[vo_proc]"
      );
    });

    it("builds soundbed filter chain with aloop, atrim, and ducking", () => {
      const { filter, outputLabel } = buildSoundbedFilterChain({
        inputIndex: 7,
        targetDurationMs: 30000,
        gainDb: -18.0,
        duckingDb: -12.0,
        voActiveWindowMs: { startMs: 2000, durationMs: 10000 }
      });

      expect(outputLabel).toBe("sb_proc");
      expect(filter).toContain("[7:a]");
      expect(filter).toContain("aloop=loop=-1:size=2147483647");
      expect(filter).toContain("atrim=0:30.000000");
      expect(filter).toContain("volume=-18.00dB");
      expect(filter).toContain("enable='between(t,2.000,12.000)'");
      expect(filter).toContain("aformat=channel_layouts=stereo,aresample=48000");
      expect(filter).toContain("[sb_proc]");
    });

    it("builds soundbed filter chain with startMs > 0", () => {
      const { filter, outputLabel } = buildSoundbedFilterChain({
        inputIndex: 7,
        targetDurationMs: 30000,
        startMs: 2000,
        gainDb: -18.0,
        duckingDb: -12.0,
        voActiveWindowMs: { startMs: 5000, durationMs: 10000 }
      });

      expect(outputLabel).toBe("sb_proc");
      expect(filter).toContain("[7:a]");
      expect(filter).toContain("aloop=loop=-1:size=2147483647");
      expect(filter).toContain("atrim=0:28.000000");
      expect(filter).toContain("adelay=2000|2000,apad,atrim=0:30.000000");
      expect(filter).toContain("enable='between(t,5.000,15.000)'");
    });

    it("builds audio mix graph with both VO and soundbed", () => {
      const { filter, outputLabel } = buildAudioMixGraph({
        voLabel: "vo_proc",
        sbLabel: "sb_proc"
      });

      expect(outputLabel).toBe("outa");
      expect(filter).toBe(
        "[vo_proc][sb_proc]amix=inputs=2:duration=longest:normalize=0[mixed_audio];[mixed_audio]aresample=192000,alimiter=limit=0.89125:asc=1:level=disabled,aresample=48000[outa]"
      );
    });

    it("builds audio mix graph with only VO", () => {
      const { filter, outputLabel } = buildAudioMixGraph({
        voLabel: "vo_proc"
      });

      expect(outputLabel).toBe("outa");
      expect(filter).toBe(
        "[vo_proc]aresample=192000,alimiter=limit=0.89125:asc=1:level=disabled,aresample=48000[outa]"
      );
    });
  });

  describe("analyzeLoudness", () => {
    it("parses loudnorm JSON and returns gainDb", async () => {
      const mockSpawn: SpawnLikeFn = async () => ({
        exitCode: 0,
        stdout: "",
        stderr: `
[Parsed_loudnorm_0 @ 0x55f7e4e0] 
{
	"input_i" : "-22.50",
	"input_tp" : "-3.10",
	"input_lra" : "6.50",
	"input_thresh" : "-32.50",
	"output_i" : "-16.00",
	"output_tp" : "-1.50",
	"output_lra" : "6.00",
	"output_thresh" : "-26.50",
	"normalization_type" : "dynamic",
	"target_offset" : "0.00"
}
`
      });

      const result = await analyzeLoudness({
        spawnFn: mockSpawn,
        ffmpegPath: "ffmpeg",
        filePath: "/tmp/vo.mp3"
      });

      expect(result.inputIntegratedLufs).toBe(-22.5);
      expect(result.inputTruePeakDbtp).toBe(-3.1);
      expect(result.gainDb).toBe(6.5); // -16 - (-22.5) = +6.5 dB
    });
  });
});
