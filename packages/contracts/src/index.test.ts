import { describe, expect, it } from "vitest";
import {
  AssemblyManifestSchema,
  AssemblyProfileSchema,
  AssemblySpecSchema,
  AudioAssetKindSchema,
  AudioAssetRefSchema,
  AudioAssetSourceSchema,
  contractsName,
  HealthResponseSchema,
  PersistentMediaRefSchema,
  SubtitleCueSchema,
  VERTICAL_REEL_1080X1920_V1_PROFILE,
  VideoStemRefSchema
} from "./index.js";

describe("contracts skeleton", () => {
  it("should load", () => {
    expect(contractsName).toBe("contracts");
    expect(HealthResponseSchema).toBeDefined();
    expect(PersistentMediaRefSchema).toBeDefined();
    expect(VideoStemRefSchema).toBeDefined();
    expect(AudioAssetKindSchema).toBeDefined();
    expect(AudioAssetSourceSchema).toBeDefined();
    expect(AudioAssetRefSchema).toBeDefined();
    expect(SubtitleCueSchema).toBeDefined();
    expect(AssemblyProfileSchema).toBeDefined();
    expect(VERTICAL_REEL_1080X1920_V1_PROFILE).toBeDefined();
    expect(AssemblyManifestSchema).toBeDefined();
    expect(AssemblySpecSchema).toBeDefined();
  });
});
