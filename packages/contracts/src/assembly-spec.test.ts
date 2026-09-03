import { describe, expect, it } from "vitest";
import { AssemblySpecSchema, computeAssemblyId, type AssemblySpec } from "./assembly-spec.js";

describe("AssemblySpecSchema contract", () => {
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

  it("parses valid AssemblySpec object and returns a deeply frozen object", () => {
    const spec = createValidSpec();
    const parsed = AssemblySpecSchema.parse(spec);
    expect(parsed).toEqual(spec);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.videoStems)).toBe(true);
    expect(Object.isFrozen(parsed.videoStems[0])).toBe(true);
  });

  it("rejects duplicate or gapped video stem order", () => {
    const valid = createValidSpec();
    const specDuplicate = {
      ...valid,
      videoStems: [valid.videoStems[0]!, { ...valid.videoStems[1]!, order: 0 }]
    };
    expect(AssemblySpecSchema.safeParse(specDuplicate).success).toBe(false);

    const specGap = {
      ...valid,
      videoStems: [valid.videoStems[0]!, { ...valid.videoStems[1]!, order: 5 }]
    };
    expect(AssemblySpecSchema.safeParse(specGap).success).toBe(false);
  });

  it("rejects mismatch between expectedTotalDurationMs and stems sum", () => {
    const spec = { ...createValidSpec(), expectedTotalDurationMs: 15000 };
    expect(AssemblySpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects voiceover or soundbed overflow", () => {
    const valid = createValidSpec();
    const specVO = {
      ...valid,
      voiceover: {
        ...valid.voiceover!,
        startMs: 5000,
        expectedDurationMs: 6000 // 5000 + 6000 = 11000 > 10000
      }
    };
    expect(AssemblySpecSchema.safeParse(specVO).success).toBe(false);

    const specSB = {
      ...valid,
      soundbed: {
        ...valid.soundbed!,
        startMs: 2000,
        expectedDurationMs: 9000 // 2000 + 9000 = 11000 > 10000
      }
    };
    expect(AssemblySpecSchema.safeParse(specSB).success).toBe(false);
  });

  it("rejects subtitle cue overflow", () => {
    const spec = {
      ...createValidSpec(),
      subtitleCues: [{ startMs: 0, endMs: 15000, text: "Overflow" }]
    };
    expect(AssemblySpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects swapped audio kinds (soundbed in voiceover, voiceover in soundbed)", () => {
    const valid = createValidSpec();
    const specSwappedVO = {
      ...valid,
      voiceover: {
        ...valid.voiceover!,
        kind: "soundbed" as const
      } as unknown as typeof valid.voiceover
    };
    expect(AssemblySpecSchema.safeParse(specSwappedVO).success).toBe(false);

    const specSwappedSB = {
      ...valid,
      soundbed: {
        ...valid.soundbed!,
        kind: "voiceover" as const
      } as unknown as typeof valid.soundbed
    };
    expect(AssemblySpecSchema.safeParse(specSwappedSB).success).toBe(false);
  });

  it("rejects invalid assemblyProfile version", () => {
    const specBadVersion = {
      ...createValidSpec(),
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1" as const,
        version: 2 as unknown as 1
      }
    };
    expect(AssemblySpecSchema.safeParse(specBadVersion).success).toBe(false);
  });

  it("does not cap stem count or total duration at the domain contract level", () => {
    // Stem count and total duration limits are infrastructure-level FFmpeg
    // safeguards (FfmpegMediaAssemblerAdapter's maxStemCount/maxTotalDurationMs),
    // not product/domain semantics — #122 does not specify these as contract
    // limits, so AssemblySpec itself must accept larger specs.
    const thirteenStems = Array.from({ length: 13 }, (_, i) => ({
      sceneId: `scene-${i}`,
      generationManifestId: `gen-man-${i}`,
      order: i,
      media: {
        bucket: "cco-renders",
        key: `renders/scene-${i}.mp4`,
        sha256: hash1,
        contentType: "video/mp4"
      },
      expectedDurationMs: 4000
    }));

    const specManyStems = {
      campaignId: "camp-001",
      videoStems: thirteenStems,
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1" as const,
        version: 1 as const
      },
      expectedTotalDurationMs: 52000,
      subtitleCues: []
    };
    expect(AssemblySpecSchema.safeParse(specManyStems).success).toBe(true);

    const longStem = {
      sceneId: "scene-long",
      generationManifestId: "gen-man-long",
      order: 0,
      media: {
        bucket: "cco-renders",
        key: "renders/scene-long.mp4",
        sha256: hash1,
        contentType: "video/mp4"
      },
      expectedDurationMs: 65000
    };
    const specLongDuration = {
      campaignId: "camp-001",
      videoStems: [longStem],
      assemblyProfile: {
        key: "VERTICAL_REEL_1080X1920_V1" as const,
        version: 1 as const
      },
      expectedTotalDurationMs: 65000,
      subtitleCues: []
    };
    expect(AssemblySpecSchema.safeParse(specLongDuration).success).toBe(true);
  });

  describe("computeAssemblyId", () => {
    it("returns deterministic identity for identical spec", () => {
      const spec1 = createValidSpec();
      const spec2 = createValidSpec();
      expect(computeAssemblyId(spec1)).toBe(computeAssemblyId(spec2));
      expect(computeAssemblyId(spec1)).toMatch(/^asm-[0-9a-f]{32}$/);
    });

    it("returns different identity when stem hash or order changes", () => {
      const base = createValidSpec();
      const stemChanged: AssemblySpec = {
        ...base,
        videoStems: [
          base.videoStems[0]!,
          {
            ...base.videoStems[1]!,
            media: {
              ...base.videoStems[1]!.media,
              sha256: "f".repeat(64)
            }
          }
        ]
      };
      expect(computeAssemblyId(stemChanged)).not.toBe(computeAssemblyId(base));
    });

    it("returns different identity when subtitle cues change", () => {
      const base = createValidSpec();
      const withCues: AssemblySpec = {
        ...base,
        subtitleCues: [{ startMs: 1000, endMs: 4000, text: "Hello" }]
      };
      expect(computeAssemblyId(withCues)).not.toBe(computeAssemblyId(base));
    });
  });
});
