import { describe, expect, it } from "vitest";
import {
  AssemblyEncodingExecutionSchema,
  AssemblyManifestSchema,
  AssemblyProfileSchema,
  AssemblySpecSchema,
  AssemblyTimelineDecisionSchema,
  ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS,
  AudioAssetKindSchema,
  AudioAssetRefSchema,
  AudioAssetSourceSchema,
  contractsName,
  HealthResponseSchema,
  MeasuredAudioStreamSchema,
  MeasuredOutputStreamsSchema,
  MeasuredVideoStreamSchema,
  PersistentMediaRefSchema,
  SubtitleCueSchema,
  VERTICAL_REEL_1080X1920_V1_PROFILE,
  validateExecutedAssemblyInvariants,
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
    expect(AssemblyTimelineDecisionSchema).toBeDefined();
    expect(AssemblyEncodingExecutionSchema).toBeDefined();
    expect(MeasuredVideoStreamSchema).toBeDefined();
    expect(MeasuredAudioStreamSchema).toBeDefined();
    expect(MeasuredOutputStreamsSchema).toBeDefined();
    expect(validateExecutedAssemblyInvariants).toBeDefined();
    expect(ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS).toBe(250);
  });
});
