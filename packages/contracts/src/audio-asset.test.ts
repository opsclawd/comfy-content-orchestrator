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

    it("Executed audio asset schemas accept valid executed refs with actualDurationMs", () => {
      const executedVo = {
        assetId: "audio-vo-001",
        kind: "voiceover" as const,
        media: validMedia,
        source: { kind: "local" as const },
        startMs: 0,
        actualDurationMs: 15000
      };
      expect(ExecutedVoiceoverRefSchema.parse(executedVo)).toEqual(executedVo);
      expect(
        ExecutedVoiceoverRefSchema.safeParse({ ...executedVo, kind: "soundbed" }).success
      ).toBe(false);

      const executedSb = {
        assetId: "audio-sb-001",
        kind: "soundbed" as const,
        media: validMedia,
        source: { kind: "uploaded" as const },
        startMs: 0,
        actualDurationMs: 30000
      };
      expect(ExecutedSoundbedRefSchema.parse(executedSb)).toEqual(executedSb);
      expect(
        ExecutedSoundbedRefSchema.safeParse({ ...executedSb, kind: "voiceover" }).success
      ).toBe(false);
    });

    it("rejects negative startMs or non-positive duration", () => {
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
