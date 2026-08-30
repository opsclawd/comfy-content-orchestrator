import { describe, expect, it } from "vitest";
import {
  type AssemblySpec,
  AssemblySpecValidationError,
  validateAssemblySpec
} from "./assembly-spec.js";

describe("AssemblySpec application port contract and validation", () => {
  const hash1 = "1".repeat(64);
  const hash2 = "2".repeat(64);
  const hashVO = "3".repeat(64);
  const hashSoundbed = "4".repeat(64);

  const createValidSpec = (): AssemblySpec => ({
    campaignId: "camp-001",
    videoStems: [
      {
        sceneId: "scene-1",
        generationManifestId: "gen-man-1",
        order: 0,
        media: {
          bucket: "cco-renders",
          key: "renders/scene-1.mp4",
          sha256: hash1,
          contentType: "video/mp4"
        },
        expectedDurationMs: 5000
      },
      {
        sceneId: "scene-2",
        generationManifestId: "gen-man-2",
        order: 1,
        media: {
          bucket: "cco-renders",
          key: "renders/scene-2.mp4",
          sha256: hash2,
          contentType: "video/mp4"
        },
        expectedDurationMs: 5000
      }
    ],
    voiceover: {
      assetId: "vo-1",
      kind: "voiceover",
      media: {
        bucket: "cco-audio",
        key: "audio/vo-1.mp3",
        sha256: hashVO,
        contentType: "audio/mpeg"
      },
      source: {
        kind: "provider",
        providerId: "elevenlabs",
        modelId: "eleven_turbo_v2_5"
      },
      startMs: 0,
      expectedDurationMs: 10000
    },
    soundbed: {
      assetId: "sb-1",
      kind: "soundbed",
      media: {
        bucket: "cco-audio",
        key: "audio/soundbed-1.wav",
        sha256: hashSoundbed,
        contentType: "audio/wav"
      },
      source: { kind: "local" },
      startMs: 0,
      expectedDurationMs: 10000
    },
    subtitleCues: [
      { startMs: 0, endMs: 5000, text: "Scene one dialog" },
      { startMs: 5000, endMs: 10000, text: "Scene two dialog" }
    ],
    assemblyProfile: {
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1
    },
    expectedTotalDurationMs: 10000
  });

  it("passes validation with a valid spec", () => {
    const spec = createValidSpec();
    expect(() => validateAssemblySpec(spec)).not.toThrow();
  });

  it("passes validation without optional voiceover or soundbed", () => {
    const spec = createValidSpec();
    const specWithoutAudio = {
      ...spec,
      voiceover: undefined,
      soundbed: undefined
    };
    expect(() => validateAssemblySpec(specWithoutAudio)).not.toThrow();
  });

  it("rejects empty campaignId", () => {
    const spec = { ...createValidSpec(), campaignId: "" };
    expect(() => validateAssemblySpec(spec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(spec)).toThrow(/campaignId must not be empty/);
  });

  it("rejects empty videoStems", () => {
    const spec = { ...createValidSpec(), videoStems: [] };
    expect(() => validateAssemblySpec(spec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(spec)).toThrow(/videoStems must contain at least one stem/);
  });

  it("rejects duplicate videoStem order", () => {
    const valid = createValidSpec();
    const stems = [valid.videoStems[0]!, { ...valid.videoStems[1]!, order: 0 }];
    const invalidSpec = { ...valid, videoStems: stems };

    expect(() => validateAssemblySpec(invalidSpec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(invalidSpec)).toThrow(/Duplicate stem order: 0/);
  });

  it("rejects gaps in videoStem order", () => {
    const valid = createValidSpec();
    const stems = [valid.videoStems[0]!, { ...valid.videoStems[1]!, order: 2 }]; // Orders are 0 and 2 (missing 1)
    const invalidSpec = { ...valid, videoStems: stems };

    expect(() => validateAssemblySpec(invalidSpec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(invalidSpec)).toThrow(/Stem orders must be contiguous/);
  });

  it("rejects negative stem order", () => {
    const valid = createValidSpec();
    const stems = [{ ...valid.videoStems[0]!, order: -1 }, valid.videoStems[1]!];
    const invalidSpec = { ...valid, videoStems: stems };

    expect(() => validateAssemblySpec(invalidSpec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(invalidSpec)).toThrow(
      /Stem order must be a non-negative integer/
    );
  });

  it("rejects missing or malformed sha256 in stem media", () => {
    const valid = createValidSpec();
    const stems = [
      {
        ...valid.videoStems[0]!,
        media: {
          ...valid.videoStems[0]!.media,
          sha256: "not-a-valid-sha256-hash"
        }
      },
      valid.videoStems[1]!
    ];
    const invalidSpec = { ...valid, videoStems: stems };

    expect(() => validateAssemblySpec(invalidSpec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(invalidSpec)).toThrow(
      /must be a valid 64-character lowercase hex hash/
    );
  });

  it("rejects expectedTotalDurationMs mismatch with sum of video stems", () => {
    const spec = { ...createValidSpec(), expectedTotalDurationMs: 12000 }; // stems sum to 10000
    expect(() => validateAssemblySpec(spec)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(spec)).toThrow(
      /expectedTotalDurationMs \(12000\) must match sum of videoStem expectedDurations \(10000\)/
    );
  });

  it("rejects voiceover or soundbed that overflows total duration", () => {
    const valid = createValidSpec();
    const specVOOverflow = {
      ...valid,
      voiceover: {
        ...valid.voiceover!,
        startMs: 2000,
        expectedDurationMs: 9000 // 2000 + 9000 = 11000 > 10000
      }
    };
    expect(() => validateAssemblySpec(specVOOverflow)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specVOOverflow)).toThrow(
      /voiceover overflows total duration/
    );

    const specSoundbedOverflow = {
      ...valid,
      soundbed: {
        ...valid.soundbed!,
        startMs: 5000,
        expectedDurationMs: 6000 // 5000 + 6000 = 11000 > 10000
      }
    };
    expect(() => validateAssemblySpec(specSoundbedOverflow)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specSoundbedOverflow)).toThrow(
      /soundbed overflows total duration/
    );
  });

  it("rejects swapped audio kinds in voiceover and soundbed", () => {
    const valid = createValidSpec();
    const specSwappedVO = {
      ...valid,
      voiceover: {
        ...valid.voiceover!,
        kind: "soundbed" as const
      } as unknown as typeof valid.voiceover
    };
    expect(() => validateAssemblySpec(specSwappedVO)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specSwappedVO)).toThrow(
      /voiceover\.kind must be 'voiceover'/
    );

    const specSwappedSB = {
      ...valid,
      soundbed: {
        ...valid.soundbed!,
        kind: "voiceover" as const
      } as unknown as typeof valid.soundbed
    };
    expect(() => validateAssemblySpec(specSwappedSB)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specSwappedSB)).toThrow(/soundbed\.kind must be 'soundbed'/);
  });

  it("rejects invalid profile version or unknown profile key", () => {
    const valid = createValidSpec();
    const specBadVersion = {
      ...valid,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1" as const,
        version: 2 as unknown as 1
      }
    };
    expect(() => validateAssemblySpec(specBadVersion)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specBadVersion)).toThrow(
      /assemblyProfile\.version must be 1/
    );
  });

  it("rejects subtitle cues that overflow timeline or have invalid times", () => {
    const specOverflow = {
      ...createValidSpec(),
      subtitleCues: [{ startMs: 8000, endMs: 12000, text: "Overflow cue" }]
    };
    expect(() => validateAssemblySpec(specOverflow)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specOverflow)).toThrow(/overflows timeline/);

    const specInverted = {
      ...createValidSpec(),
      subtitleCues: [{ startMs: 5000, endMs: 3000, text: "Inverted cue" }]
    };
    expect(() => validateAssemblySpec(specInverted)).toThrow(AssemblySpecValidationError);
    expect(() => validateAssemblySpec(specInverted)).toThrow(/endMs \(3000\) <= startMs \(5000\)/);
  });
});
