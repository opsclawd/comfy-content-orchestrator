import { describe, expect, it } from "vitest";
import {
  AudioAssetKindSchema,
  AudioAssetRefSchema,
  AudioAssetSourceSchema,
  ExecutedSoundbedRefSchema,
  ExecutedVoiceoverRefSchema,
  SoundbedAssetRefSchema,
  VoiceoverAssetRefSchema
} from "./audio-asset.js";

describe("AudioAsset contracts", () => {
  const validMedia = {
    bucket: "cco-audio",
    key: "assets/vo-1.mp3",
    sha256: "c".repeat(64),
    contentType: "audio/mpeg"
  };

  describe("AudioAssetKindSchema", () => {
    it("accepts voiceover and soundbed", () => {
      expect(AudioAssetKindSchema.parse("voiceover")).toBe("voiceover");
      expect(AudioAssetKindSchema.parse("soundbed")).toBe("soundbed");
    });

    it("rejects unknown kinds", () => {
      expect(AudioAssetKindSchema.safeParse("foley").success).toBe(false);
      expect(AudioAssetKindSchema.safeParse("music").success).toBe(false);
    });
  });

  describe("AudioAssetSourceSchema", () => {
    it("accepts local audio source", () => {
      const source = { kind: "local" as const };
      expect(AudioAssetSourceSchema.parse(source)).toEqual(source);
    });

    it("accepts uploaded audio source", () => {
      const source = { kind: "uploaded" as const };
      expect(AudioAssetSourceSchema.parse(source)).toEqual(source);
    });

    it("accepts provider audio source with and without modelId", () => {
      const withModel = {
        kind: "provider" as const,
        providerId: "elevenlabs",
        modelId: "eleven_multilingual_v2"
      };
      expect(AudioAssetSourceSchema.parse(withModel)).toEqual(withModel);

      const withoutModel = {
        kind: "provider" as const,
        providerId: "azure-speech"
      };
      expect(AudioAssetSourceSchema.parse(withoutModel)).toEqual(withoutModel);
    });

    it("rejects provider source with empty providerId or empty modelId", () => {
      expect(
        AudioAssetSourceSchema.safeParse({
          kind: "provider",
          providerId: ""
        }).success
      ).toBe(false);

      expect(
        AudioAssetSourceSchema.safeParse({
          kind: "provider",
          providerId: "elevenlabs",
          modelId: ""
        }).success
      ).toBe(false);
    });
  });

  describe("Role-specific AudioAssetRef schemas", () => {
    const validVo = {
      assetId: "audio-vo-001",
      kind: "voiceover" as const,
      media: validMedia,
      source: {
        kind: "provider" as const,
        providerId: "elevenlabs",
        modelId: "eleven_turbo_v2_5"
      },
      startMs: 0,
      expectedDurationMs: 15000
    };

    const validSoundbed = {
      assetId: "audio-sb-001",
      kind: "soundbed" as const,
      media: validMedia,
      source: { kind: "local" as const },
      startMs: 0,
      expectedDurationMs: 30000
    };

    it("VoiceoverAssetRefSchema accepts voiceover and rejects soundbed", () => {
      expect(VoiceoverAssetRefSchema.parse(validVo)).toEqual(validVo);
      expect(VoiceoverAssetRefSchema.safeParse(validSoundbed).success).toBe(false);
    });

    it("SoundbedAssetRefSchema accepts soundbed and rejects voiceover", () => {
      expect(SoundbedAssetRefSchema.parse(validSoundbed)).toEqual(validSoundbed);
      expect(SoundbedAssetRefSchema.safeParse(validVo).success).toBe(false);
    });

    it("AudioAssetRefSchema accepts both voiceover and soundbed", () => {
      expect(AudioAssetRefSchema.parse(validVo)).toEqual(validVo);
      expect(AudioAssetRefSchema.parse(validSoundbed)).toEqual(validSoundbed);
    });

    it("Executed audio asset schemas accept valid executed refs with explicit timing, padding, and mix fields", () => {
      const executedVo = {
        assetId: "audio-vo-001",
        kind: "voiceover" as const,
        media: validMedia,
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 15000,
        effectiveStartMs: 0,
        effectiveDurationMs: 15000,
        trimStartMs: 0,
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
      };
      const parsedVo = ExecutedVoiceoverRefSchema.parse(executedVo);
      expect(parsedVo).toEqual(executedVo);
      expect(
        ExecutedVoiceoverRefSchema.safeParse({ ...executedVo, kind: "soundbed" }).success
      ).toBe(false);

      const executedSb = {
        assetId: "audio-sb-001",
        kind: "soundbed" as const,
        media: validMedia,
        source: { kind: "uploaded" as const },
        startMs: 0,
        actualDurationMs: 10000,
        effectiveStartMs: 500,
        effectiveDurationMs: 29000, // padLeadingMs(1000) + (10000 - 1000) * (2 + 1) + padTrailingMs(1000) = 1000 + 27000 + 1000 = 29000
        trimStartMs: 1000,
        loopCount: 2,
        padLeadingMs: 1000,
        padTrailingMs: 1000,
        gainDb: -14.0,
        duckingDb: -10.0
      };
      expect(ExecutedSoundbedRefSchema.parse(executedSb)).toEqual(executedSb);
      expect(
        ExecutedSoundbedRefSchema.safeParse({ ...executedSb, kind: "voiceover" }).success
      ).toBe(false);
    });

    it("rejects executed audio ref with omitted required fields (no synthesized defaults)", () => {
      const incompleteVo = {
        assetId: "audio-vo-001",
        kind: "voiceover" as const,
        media: validMedia,
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 15000,
        effectiveStartMs: 0,
        effectiveDurationMs: 15000
        // missing trimStartMs, loopCount, padLeadingMs, padTrailingMs, gainDb
      };
      expect(ExecutedVoiceoverRefSchema.safeParse(incompleteVo).success).toBe(false);

      const incompleteSb = {
        assetId: "audio-sb-001",
        kind: "soundbed" as const,
        media: validMedia,
        source: { kind: "uploaded" as const },
        startMs: 0,
        actualDurationMs: 15000,
        effectiveStartMs: 0,
        effectiveDurationMs: 15000,
        trimStartMs: 0,
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
        // missing duckingDb
      };
      expect(ExecutedSoundbedRefSchema.safeParse(incompleteSb).success).toBe(false);
    });

    it("rejects executed audio ref when trimStartMs >= actualDurationMs", () => {
      const baseVo = {
        assetId: "audio-vo-001",
        kind: "voiceover" as const,
        media: validMedia,
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 15000,
        effectiveStartMs: 0,
        effectiveDurationMs: 15000,
        trimStartMs: 15000, // equal to actualDurationMs
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
      };

      const equalParse = ExecutedVoiceoverRefSchema.safeParse(baseVo);
      expect(equalParse.success).toBe(false);
      if (!equalParse.success) {
        expect(
          equalParse.error.issues.some((i) =>
            i.message.includes(
              "trimStartMs (15000) must be strictly less than actualDurationMs (15000)"
            )
          )
        ).toBe(true);
      }

      const greaterParse = ExecutedVoiceoverRefSchema.safeParse({
        ...baseVo,
        trimStartMs: 16000
      });
      expect(greaterParse.success).toBe(false);
      if (!greaterParse.success) {
        expect(
          greaterParse.error.issues.some((i) =>
            i.message.includes(
              "trimStartMs (16000) must be strictly less than actualDurationMs (15000)"
            )
          )
        ).toBe(true);
      }
    });

    it("rejects executed audio ref when effectiveDurationMs does not match trim/loop/pad formula", () => {
      const baseVo = {
        assetId: "audio-vo-001",
        kind: "voiceover" as const,
        media: validMedia,
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 10000,
        effectiveStartMs: 0,
        effectiveDurationMs: 10000, // expected: padLeadingMs(0) + (10000 - 2000) * (0 + 1) + padTrailingMs(0) = 8000
        trimStartMs: 2000,
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
      };

      const parseResult = ExecutedVoiceoverRefSchema.safeParse(baseVo);
      expect(parseResult.success).toBe(false);
      if (!parseResult.success) {
        expect(
          parseResult.error.issues.some((i) =>
            i.message.includes("effectiveDurationMs (10000) does not match computed audio duration")
          )
        ).toBe(true);
      }
    });

    it("rejects executed audio ref with invalid timing fields or non-finite mix parameters", () => {
      const baseVo = {
        assetId: "audio-vo-001",
        kind: "voiceover" as const,
        media: validMedia,
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 15000,
        effectiveStartMs: 0,
        effectiveDurationMs: 15000,
        trimStartMs: 0,
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
      };

      expect(
        ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, effectiveStartMs: -1 }).success
      ).toBe(false);
      expect(
        ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, effectiveDurationMs: 0 }).success
      ).toBe(false);
      expect(ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, trimStartMs: -5 }).success).toBe(
        false
      );
      expect(ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, loopCount: -1 }).success).toBe(
        false
      );
      expect(ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, padLeadingMs: -10 }).success).toBe(
        false
      );
      expect(ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, padTrailingMs: -10 }).success).toBe(
        false
      );
      expect(ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, gainDb: Number.NaN }).success).toBe(
        false
      );
      expect(
        ExecutedVoiceoverRefSchema.safeParse({ ...baseVo, gainDb: Number.POSITIVE_INFINITY })
          .success
      ).toBe(false);
    });

    it("rejects negative startMs or non-positive duration in request-time ref", () => {
      expect(
        VoiceoverAssetRefSchema.safeParse({
          ...validVo,
          startMs: -10
        }).success
      ).toBe(false);

      expect(
        VoiceoverAssetRefSchema.safeParse({
          ...validVo,
          expectedDurationMs: 0
        }).success
      ).toBe(false);
    });
  });
});
