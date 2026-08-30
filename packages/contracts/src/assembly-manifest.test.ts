import { describe, expect, it } from "vitest";
import type { AssemblyExecutionResult } from "./assembly-execution.js";
import {
  type AssemblyManifest,
  AssemblyManifestSchema,
  createAssemblyManifest
} from "./assembly-manifest.js";
import { NO_SUBTITLE_CUES_SHA256, hashSubtitleCues, type SubtitleCue } from "./subtitle-cue.js";

describe("AssemblyManifest contract", () => {
  const hash1 = "1".repeat(64);
  const hash2 = "2".repeat(64);
  const hash3 = "3".repeat(64);
  const hashVO = "4".repeat(64);
  const hashSoundbed = "5".repeat(64);
  const hashFingerprint = "7".repeat(64);
  const hashOutput = "8".repeat(64);

  const validSubtitleCues: readonly SubtitleCue[] = [
    { startMs: 0, endMs: 5000, text: "In the year 2088..." },
    { startMs: 5000, endMs: 10000, text: "The city never sleeps." },
    { startMs: 10000, endMs: 15000, text: "Only the strongest survive." }
  ];
  const hashSubtitles = hashSubtitleCues(validSubtitleCues);

  const createValidManifest = (): AssemblyManifest => ({
    assemblyId: "asm-20260829-001",
    createdAt: "2026-08-29T12:00:00.000Z",
    campaignId: "camp-cyberpunk-001",
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    generationManifestIds: ["gen-man-1", "gen-man-2", "gen-man-3"],
    inputs: {
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
        },
        {
          sceneId: "scene-3",
          generationManifestId: "gen-man-3",
          order: 2,
          media: {
            bucket: "cco-renders",
            key: "scenes/scene-3/render.mp4",
            sha256: hash3,
            contentType: "video/mp4"
          },
          actualDurationMs: 5000
        }
      ],
      voiceover: {
        assetId: "vo-asset-01",
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
        actualDurationMs: 15000
      },
      soundbed: {
        assetId: "soundbed-asset-01",
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
        actualDurationMs: 15000
      }
    },
    subtitleCuesSha256: hashSubtitles,
    subtitleCues: validSubtitleCues,
    layout: {
      mode: "fit_blurred_fill"
    },
    ffmpeg: {
      executable: "ffmpeg",
      version: "7.0.1-static",
      buildInfo: "gcc 13.2.0 (Ubuntu 24.04)"
    },
    commandFingerprint: hashFingerprint,
    output: {
      media: {
        bucket: "cco-deliveries",
        key: "campaigns/camp-cyberpunk-001/final_1080x1920.mp4",
        sha256: hashOutput,
        contentType: "video/mp4"
      },
      durationMs: 15000,
      width: 1080,
      height: 1920
    },
    governanceDecisionId: "gov-dec-001"
  });

  const createValidExecutionResult = (): AssemblyExecutionResult => ({
    assemblyId: "asm-20260829-001",
    campaignId: "camp-cyberpunk-001",
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    executedInputs: createValidManifest().inputs,
    timeline: {
      totalDurationMs: 15000,
      stemDurationsMs: [5000, 5000, 5000]
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
        key: "campaigns/camp-cyberpunk-001/final_1080x1920.mp4",
        sha256: hashOutput,
        contentType: "video/mp4"
      },
      durationMs: 15000,
      width: 1080,
      height: 1920
    }
  });

  it("accepts a fully populated realistic AssemblyManifest and deeply freezes it", () => {
    const manifest = createValidManifest();
    const parsed = AssemblyManifestSchema.parse(manifest);
    expect(parsed).toEqual(manifest);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.inputs.videoStems)).toBe(true);
    expect(Object.isFrozen(parsed.inputs.videoStems[0])).toBe(true);
  });

  it("constructs an AssemblyManifest faithfully from AssemblyExecutionResult via createAssemblyManifest", () => {
    const executionResult = createValidExecutionResult();
    const manifest = createAssemblyManifest({
      executionResult,
      governanceDecisionId: "gov-dec-001",
      createdAt: "2026-08-29T12:00:00.000Z"
    });

    expect(manifest.assemblyId).toBe(executionResult.assemblyId);
    expect(manifest.campaignId).toBe(executionResult.campaignId);
    expect(manifest.generationManifestIds).toEqual(["gen-man-1", "gen-man-2", "gen-man-3"]);
    expect(manifest.inputs).toEqual(executionResult.executedInputs);
    expect(manifest.governanceDecisionId).toBe("gov-dec-001");
    expect(manifest.output).toEqual(executionResult.output);
  });

  it("accepts manifest without optional voiceover, soundbed, or inline subtitleCues", () => {
    const valid = createValidManifest();
    const manifest = {
      ...valid,
      inputs: {
        videoStems: valid.inputs.videoStems
      },
      subtitleCues: undefined,
      subtitleCuesSha256: NO_SUBTITLE_CUES_SHA256
    };

    const parsed = AssemblyManifestSchema.parse(manifest);
    expect(parsed.inputs.voiceover).toBeUndefined();
    expect(parsed.inputs.soundbed).toBeUndefined();
    expect(parsed.subtitleCues).toBeUndefined();
    expect(parsed.subtitleCuesSha256).toBe(NO_SUBTITLE_CUES_SHA256);
  });

  it("rejects manifest when generationManifestIds count does not match videoStems count", () => {
    const manifest = {
      ...createValidManifest(),
      generationManifestIds: ["gen-man-1", "gen-man-2"] // 2 IDs for 3 stems
    };

    const result = AssemblyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(
        /generationManifestIds length \(2\) does not match inputs.videoStems length \(3\)/
      );
    }
  });

  it("rejects manifest when generationManifestIds do not match stem generationManifestId values in order", () => {
    const manifest = {
      ...createValidManifest(),
      generationManifestIds: ["gen-man-1", "gen-man-3", "gen-man-2"] // Swapped order
    };

    const result = AssemblyManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("does not match"))).toBe(true);
    }
  });

  it("rejects manifest when video stems have duplicate or missing (gapped) orders", () => {
    const valid = createValidManifest();
    const duplicateStems = [
      valid.inputs.videoStems[0]!,
      { ...valid.inputs.videoStems[1]!, order: 0 },
      valid.inputs.videoStems[2]!
    ];
    const manifestDuplicate = {
      ...valid,
      inputs: {
        ...valid.inputs,
        videoStems: duplicateStems
      }
    };

    const resultDuplicate = AssemblyManifestSchema.safeParse(manifestDuplicate);
    expect(resultDuplicate.success).toBe(false);
    if (!resultDuplicate.success) {
      expect(
        resultDuplicate.error.issues.some((i) =>
          i.message.includes("inputs.videoStems order must be contiguous")
        )
      ).toBe(true);
    }

    const gapStems = [
      valid.inputs.videoStems[0]!,
      { ...valid.inputs.videoStems[1]!, order: 3 },
      valid.inputs.videoStems[2]!
    ];
    const manifestGap = {
      ...valid,
      inputs: {
        ...valid.inputs,
        videoStems: gapStems
      }
    };
    const resultGap = AssemblyManifestSchema.safeParse(manifestGap);
    expect(resultGap.success).toBe(false);
  });

  it("rejects manifest when profile version is not 1", () => {
    const manifestBadVersion = {
      ...createValidManifest(),
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1" as const,
        version: 2 as unknown as 1
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadVersion).success).toBe(false);
  });

  it("rejects manifest with contradictory layout mode for VERTICAL_REEL_1080X1920_V1", () => {
    const manifestBadLayout = {
      ...createValidManifest(),
      layout: { mode: "direct_fit" as const }
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadLayout).success).toBe(false);
  });

  it("rejects manifest with contradictory output dimensions or content type for VERTICAL_REEL_1080X1920_V1", () => {
    const manifestBadDim = {
      ...createValidManifest(),
      output: {
        ...createValidManifest().output,
        width: 720,
        height: 1280
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadDim).success).toBe(false);

    const manifestBadContentType = {
      ...createValidManifest(),
      output: {
        ...createValidManifest().output,
        media: {
          ...createValidManifest().output.media,
          contentType: "image/jpeg"
        }
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadContentType).success).toBe(false);
  });

  it("rejects manifest when audio kinds are swapped in voiceover or soundbed", () => {
    const valid = createValidManifest();
    const manifestSwappedVO = {
      ...valid,
      inputs: {
        ...valid.inputs,
        voiceover: {
          ...valid.inputs.voiceover!,
          kind: "soundbed" as const
        } as unknown as typeof valid.inputs.voiceover
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestSwappedVO).success).toBe(false);

    const manifestSwappedSoundbed = {
      ...valid,
      inputs: {
        ...valid.inputs,
        soundbed: {
          ...valid.inputs.soundbed!,
          kind: "voiceover" as const
        } as unknown as typeof valid.inputs.soundbed
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestSwappedSoundbed).success).toBe(false);
  });

  it("rejects manifest when any input or output media sha256 is missing or invalid", () => {
    const valid = createValidManifest();
    const badStems = [
      {
        ...valid.inputs.videoStems[0]!,
        media: {
          ...valid.inputs.videoStems[0]!.media,
          sha256: "short"
        }
      },
      valid.inputs.videoStems[1]!,
      valid.inputs.videoStems[2]!
    ];
    const manifestBadStemSha = {
      ...valid,
      inputs: {
        ...valid.inputs,
        videoStems: badStems
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadStemSha).success).toBe(false);

    const manifestOutputBad = {
      ...valid,
      output: {
        ...valid.output,
        media: {
          ...valid.output.media,
          sha256: ""
        }
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestOutputBad).success).toBe(false);
  });

  it("rejects manifest with empty governanceDecisionId or empty ffmpeg executable", () => {
    const manifestBadGov = {
      ...createValidManifest(),
      governanceDecisionId: ""
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadGov).success).toBe(false);

    const manifestBadFfmpeg = {
      ...createValidManifest(),
      ffmpeg: {
        executable: "",
        version: "7.0.1",
        buildInfo: "gcc"
      }
    };
    expect(AssemblyManifestSchema.safeParse(manifestBadFfmpeg).success).toBe(false);
  });

  it("rejects manifest when inline subtitleCues do not match subtitleCuesSha256", () => {
    const valid = createValidManifest();
    const manifestWithTamperedCue = {
      ...valid,
      subtitleCues: [
        { startMs: 0, endMs: 5000, text: "Tampered cue content" },
        valid.subtitleCues![1]!,
        valid.subtitleCues![2]!
      ]
    };

    const result = AssemblyManifestSchema.safeParse(manifestWithTamperedCue);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("does not match computed hash of subtitleCues")
        )
      ).toBe(true);
    }
  });

  it("rejects manifest when subtitleCues is omitted but subtitleCuesSha256 is not the canonical empty hash", () => {
    const valid = createValidManifest();
    const manifestBadNoCues = {
      ...valid,
      subtitleCues: undefined,
      subtitleCuesSha256: hashSubtitles
    };

    const result = AssemblyManifestSchema.safeParse(manifestBadNoCues);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.message.includes("does not match computed hash of subtitleCues")
        )
      ).toBe(true);
    }
  });

  it("rejects createAssemblyManifest when executionResult inline subtitleCues do not match subtitleCuesSha256", () => {
    const executionResult = {
      ...createValidExecutionResult(),
      subtitleCues: [
        { startMs: 0, endMs: 5000, text: "Tampered cue in execution result" },
        createValidExecutionResult().subtitleCues![1]!,
        createValidExecutionResult().subtitleCues![2]!
      ]
    };

    expect(() =>
      createAssemblyManifest({
        executionResult,
        governanceDecisionId: "gov-dec-001"
      })
    ).toThrow(/does not match computed hash of subtitle cues/);
  });

  it("rejects createAssemblyManifest when subtitleCues is omitted but subtitleCuesSha256 is not the canonical empty hash", () => {
    const executionResult = {
      ...createValidExecutionResult(),
      subtitleCues: undefined,
      subtitleCuesSha256: hashSubtitles
    };

    expect(() =>
      createAssemblyManifest({
        executionResult,
        governanceDecisionId: "gov-dec-001"
      })
    ).toThrow(/does not match computed hash of subtitle cues/);
  });
});
