import { describe, expect, it } from "vitest";
import {
  AssemblyExecutionResultSchema,
  type AssemblyExecutionResult
} from "./assembly-execution.js";
import { hashSubtitleCues, type SubtitleCue } from "./subtitle-cue.js";

describe("AssemblyExecutionResult contract", () => {
  const hash1 = "1".repeat(64);
  const hash2 = "2".repeat(64);
  const hashVO = "3".repeat(64);
  const hashSoundbed = "4".repeat(64);
  const hashFingerprint = "6".repeat(64);
  const hashOutput = "7".repeat(64);

  const validSubtitleCues: readonly SubtitleCue[] = [
    { startMs: 0, endMs: 5000, text: "Scene 1 dialog" },
    { startMs: 5000, endMs: 10000, text: "Scene 2 dialog" }
  ];
  const hashSubtitles = hashSubtitleCues(validSubtitleCues);

  const createValidExecutionResult = (): AssemblyExecutionResult => ({
    assemblyId: "asm-001",
    campaignId: "camp-001",
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    executedInputs: {
      videoStems: [
        {
          sceneId: "scene-1",
          generationManifestId: "gen-man-1",
          order: 0,
          media: {
            bucket: "cco-renders",
            key: "scenes/scene-1/render.mp4",
            sha256: hash1,
            contentType: "video/mp4"
          },
          actualDurationMs: 5000
        },
        {
          sceneId: "scene-2",
          generationManifestId: "gen-man-2",
          order: 1,
          media: {
            bucket: "cco-renders",
            key: "scenes/scene-2/render.mp4",
            sha256: hash2,
            contentType: "video/mp4"
          },
          actualDurationMs: 5000
        }
      ],
      voiceover: {
        assetId: "vo-1",
        kind: "voiceover",
        media: {
          bucket: "cco-audio",
          key: "audio/vo.mp3",
          sha256: hashVO,
          contentType: "audio/mpeg"
        },
        source: {
          kind: "provider",
          providerId: "elevenlabs",
          modelId: "eleven_turbo_v2_5"
        },
        startMs: 0,
        actualDurationMs: 10000,
        effectiveStartMs: 0,
        effectiveDurationMs: 10000,
        trimStartMs: 0,
        loopCount: 1,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
      },
      soundbed: {
        assetId: "sb-1",
        kind: "soundbed",
        media: {
          bucket: "cco-audio",
          key: "audio/soundbed.wav",
          sha256: hashSoundbed,
          contentType: "audio/wav"
        },
        source: {
          kind: "local"
        },
        startMs: 0,
        actualDurationMs: 10000,
        effectiveStartMs: 0,
        effectiveDurationMs: 10000,
        trimStartMs: 0,
        loopCount: 1,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: -14.0,
        duckingDb: -10.0
      }
    },
    timeline: {
      totalDurationMs: 10000,
      stemDurationsMs: [5000, 5000]
    },
    layout: {
      mode: "fit_blurred_fill"
    },
    subtitleCuesSha256: hashSubtitles,
    subtitleCues: validSubtitleCues,
    subtitleStyleProfile: "sub-profile-default-v1",
    ffmpeg: {
      executable: "ffmpeg",
      version: "7.0.1-static",
      buildInfo: "gcc 13.2.0 (Ubuntu 24.04)"
    },
    commandFingerprint: hashFingerprint,
    encoding: {
      videoCodec: "libx264",
      pixelFormat: "yuv420p",
      crf: 18,
      preset: "fast",
      audioCodec: "aac",
      audioBitrateKbps: 192,
      audioSampleRateHz: 48000,
      audioChannels: 2
    },
    streams: {
      video: {
        codecName: "h264",
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        frameRate: 30,
        durationMs: 10000
      },
      audio: {
        codecName: "aac",
        sampleRateHz: 48000,
        channels: 2,
        durationMs: 10000,
        bitrateKbps: 192
      }
    },
    output: {
      media: {
        bucket: "cco-deliveries",
        key: "campaigns/camp-001/final.mp4",
        sha256: hashOutput,
        contentType: "video/mp4"
      },
      durationMs: 10000,
      width: 1080,
      height: 1920
    },
    measuredFrameRate: 30,
    executionDurationMs: 4200
  });

  it("validates and parses a valid AssemblyExecutionResult and returns a deeply frozen object", () => {
    const result = createValidExecutionResult();
    const parsed = AssemblyExecutionResultSchema.parse(result);
    expect(parsed).toEqual(result);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.executedInputs.videoStems)).toBe(true);
  });

  it("rejects execution result when inline subtitleCues do not match subtitleCuesSha256", () => {
    const valid = createValidExecutionResult();
    const resultWithTamperedCue = {
      ...valid,
      subtitleCues: [
        { startMs: 0, endMs: 5000, text: "Tampered dialog text" },
        valid.subtitleCues![1]!
      ]
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(resultWithTamperedCue);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((issue) =>
          issue.message.includes("does not match computed hash of subtitleCues")
        )
      ).toBe(true);
    }
  });

  it("accepts execution result with omitted subtitleCues when subtitleCuesSha256 is NO_SUBTITLE_CUES_SHA256", () => {
    const valid = createValidExecutionResult();
    const resultNoCues = {
      ...valid,
      subtitleCues: undefined,
      subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    };
    const parsed = AssemblyExecutionResultSchema.parse(resultNoCues);
    expect(parsed.subtitleCues).toBeUndefined();
    expect(parsed.subtitleCuesSha256).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    );
  });

  it("rejects execution result with omitted subtitleCues when subtitleCuesSha256 is not the canonical empty hash", () => {
    const valid = createValidExecutionResult();
    const resultBadNoCues = {
      ...valid,
      subtitleCues: undefined,
      subtitleCuesSha256: hashSubtitles
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(resultBadNoCues);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((issue) =>
          issue.message.includes("does not match computed hash of subtitleCues")
        )
      ).toBe(true);
    }
  });

  it("rejects contradictory layout mode for VERTICAL_REEL_1080X1920_V1 profile", () => {
    const result = {
      ...createValidExecutionResult(),
      layout: { mode: "direct_fit" as const }
    };
    expect(AssemblyExecutionResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects contradictory output dimensions or content type", () => {
    const resultBadDim = {
      ...createValidExecutionResult(),
      output: {
        ...createValidExecutionResult().output,
        width: 720,
        height: 1280
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(resultBadDim).success).toBe(false);

    const resultBadType = {
      ...createValidExecutionResult(),
      output: {
        ...createValidExecutionResult().output,
        media: {
          ...createValidExecutionResult().output.media,
          contentType: "image/jpeg"
        }
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(resultBadType).success).toBe(false);
  });

  it("rejects contradictory measuredFrameRate for VERTICAL_REEL_1080X1920_V1 profile", () => {
    const result = {
      ...createValidExecutionResult(),
      measuredFrameRate: 60
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(result);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((issue) =>
          issue.message.includes(
            "Profile VERTICAL_REEL_1080X1920_V1 requires measuredFrameRate 30, got 60"
          )
        )
      ).toBe(true);
    }
  });

  it("rejects stem duration vs timeline mismatch", () => {
    const valid = createValidExecutionResult();
    const mismatchedResult = {
      ...valid,
      timeline: {
        totalDurationMs: 10000,
        stemDurationsMs: [6000, 4000] // Stem 0 actual is 5000, stem 1 actual is 5000
      }
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(mismatchedResult);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((i) =>
          i.message.includes("does not match video stem (order 0) actualDurationMs (5000)")
        )
      ).toBe(true);
    }
  });

  it("rejects total duration vs timeline sum mismatch", () => {
    const valid = createValidExecutionResult();
    const mismatchedSum = {
      ...valid,
      timeline: {
        totalDurationMs: 11000,
        stemDurationsMs: [5000, 5000]
      },
      output: {
        ...valid.output,
        durationMs: 11000
      }
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(mismatchedSum);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((i) =>
          i.message.includes(
            "timeline.totalDurationMs (11000) must match sum of stemDurationsMs (10000)"
          )
        )
      ).toBe(true);
    }
  });

  it("rejects output duration exceeding tolerance (250ms) and accepts within tolerance", () => {
    const valid = createValidExecutionResult();
    const withinTolerance = {
      ...valid,
      output: {
        ...valid.output,
        durationMs: 10250 // exactly +250ms
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(withinTolerance).success).toBe(true);

    const outsideTolerance = {
      ...valid,
      output: {
        ...valid.output,
        durationMs: 10251 // +251ms -> exceeds tolerance
      }
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(outsideTolerance);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((i) =>
          i.message.includes("exceeding allowed tolerance of 250ms")
        )
      ).toBe(true);
    }
  });

  it("rejects subtitle cue extending beyond executed timeline", () => {
    const valid = createValidExecutionResult();
    const badSubtitle = {
      ...valid,
      subtitleCues: [
        { startMs: 0, endMs: 5000, text: "Scene 1 dialog" },
        { startMs: 5000, endMs: 10050, text: "Scene 2 dialog overflowing" }
      ],
      subtitleCuesSha256: hashSubtitleCues([
        { startMs: 0, endMs: 5000, text: "Scene 1 dialog" },
        { startMs: 5000, endMs: 10050, text: "Scene 2 dialog overflowing" }
      ])
    };
    const parseResult = AssemblyExecutionResultSchema.safeParse(badSubtitle);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(
        parseResult.error.issues.some((i) =>
          i.message.includes("overflows timeline: endMs (10050) > totalDurationMs (10000)")
        )
      ).toBe(true);
    }
  });

  it("rejects invalid measuredFrameRate or executionDurationMs", () => {
    const valid = createValidExecutionResult();
    expect(
      AssemblyExecutionResultSchema.safeParse({ ...valid, measuredFrameRate: 0 }).success
    ).toBe(false);
    expect(
      AssemblyExecutionResultSchema.safeParse({ ...valid, measuredFrameRate: -30 }).success
    ).toBe(false);
    expect(
      AssemblyExecutionResultSchema.safeParse({ ...valid, executionDurationMs: 0 }).success
    ).toBe(false);
    expect(
      AssemblyExecutionResultSchema.safeParse({ ...valid, executionDurationMs: 1.5 }).success
    ).toBe(false);
  });

  it("rejects execution result when subtitleCues are present but subtitleStyleProfile is missing or empty", () => {
    const valid = createValidExecutionResult();
    const missingStyle = {
      ...valid,
      subtitleStyleProfile: undefined
    };
    const parseResult1 = AssemblyExecutionResultSchema.safeParse(missingStyle);
    expect(parseResult1.success).toBe(false);
    if (!parseResult1.success) {
      expect(
        parseResult1.error.issues.some((i) =>
          i.message.includes("subtitleStyleProfile is required when subtitleCues are present")
        )
      ).toBe(true);
    }

    const emptyStyle = {
      ...valid,
      subtitleStyleProfile: "   "
    };
    const parseResult2 = AssemblyExecutionResultSchema.safeParse(emptyStyle);
    expect(parseResult2.success).toBe(false);
  });

  it("accepts execution result without subtitleCues when subtitleStyleProfile is omitted", () => {
    const valid = createValidExecutionResult();
    const noCuesNoStyle = {
      ...valid,
      subtitleCues: undefined,
      subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      subtitleStyleProfile: undefined
    };
    expect(AssemblyExecutionResultSchema.safeParse(noCuesNoStyle).success).toBe(true);
  });

  it("rejects contradictory encoding or stream parameters for VERTICAL_REEL_1080X1920_V1 profile", () => {
    const valid = createValidExecutionResult();

    // Contradictory audio sample rate in encoding
    const badEncodingSampleRate = {
      ...valid,
      encoding: { ...valid.encoding, audioSampleRateHz: 44100 }
    };
    expect(AssemblyExecutionResultSchema.safeParse(badEncodingSampleRate).success).toBe(false);

    // Contradictory video codec in streams
    const badVideoStreamCodec = {
      ...valid,
      streams: {
        ...valid.streams,
        video: { ...valid.streams.video, codecName: "hevc" }
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(badVideoStreamCodec).success).toBe(false);

    // Contradictory audio codec in streams
    const badAudioStreamCodec = {
      ...valid,
      streams: {
        ...valid.streams,
        audio: { ...valid.streams.audio, codecName: "opus" }
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(badAudioStreamCodec).success).toBe(false);
  });

  it("rejects execution result with contradictory audio timing (trimStartMs >= actualDurationMs or formula mismatch)", () => {
    const valid = createValidExecutionResult();
    const badTrimVo = {
      ...valid,
      executedInputs: {
        ...valid.executedInputs,
        voiceover: {
          ...valid.executedInputs.voiceover!,
          actualDurationMs: 5000,
          trimStartMs: 6000
        }
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(badTrimVo).success).toBe(false);

    const badDurationFormulaVo = {
      ...valid,
      executedInputs: {
        ...valid.executedInputs,
        voiceover: {
          ...valid.executedInputs.voiceover!,
          actualDurationMs: 10000,
          trimStartMs: 2000,
          loopCount: 1,
          padLeadingMs: 0,
          padTrailingMs: 0,
          effectiveDurationMs: 10000 // formula expected 8000
        }
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(badDurationFormulaVo).success).toBe(false);
  });

  it("rejects execution result with omitted required audio transformation fields", () => {
    const valid = createValidExecutionResult();
    const incompleteAudioVo = {
      ...valid,
      executedInputs: {
        ...valid.executedInputs,
        voiceover: {
          assetId: "vo-1",
          kind: "voiceover" as const,
          media: {
            bucket: "cco-audio",
            key: "audio/vo.mp3",
            sha256: hashVO,
            contentType: "audio/mpeg"
          },
          source: { kind: "local" as const },
          startMs: 0,
          actualDurationMs: 10000,
          effectiveStartMs: 0,
          effectiveDurationMs: 10000
          // missing trimStartMs, loopCount, padLeadingMs, padTrailingMs, gainDb
        }
      }
    };
    expect(AssemblyExecutionResultSchema.safeParse(incompleteAudioVo).success).toBe(false);
  });
});
