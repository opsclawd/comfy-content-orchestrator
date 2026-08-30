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
        actualDurationMs: 10000
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
        actualDurationMs: 10000
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
    ffmpeg: {
      executable: "ffmpeg",
      version: "7.0.1-static",
      buildInfo: "gcc 13.2.0 (Ubuntu 24.04)"
    },
    commandFingerprint: hashFingerprint,
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
    }
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
});
