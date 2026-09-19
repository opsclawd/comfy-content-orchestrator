import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RenderProfileSchema,
  LtxRenderProfileSchema,
  LtxI2vRenderProfileSchema,
  MinimaxH3I2vRenderProfileSchema,
  RenderProfileKeySchema,
  LTX_25_720P_5S_V1_PROFILE,
  LTX_25_720P_5S_I2V_V1_PROFILE,
  MINIMAX_H3_720P_5S_I2V_V1_PROFILE,
  MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY,
  getProfileInjectionTopology,
  LTX_FPS,
  LTX_FRAME_STEP,
  LTX_SUPPORTED_FRAME_RANGE,
  LTX_FRAME_QUANTIZATION_TOLERANCE_MS,
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  MINIMAX_H3_SUPPORTED_FRAME_RANGE,
  MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS
} from "./render-profile.js";

describe("RenderProfileSchema", () => {
  const measuredLtxFixture = {
    key: "LTX_25_720P_5S_V1" as const,
    version: 1 as const,
    engine: "ltx_25" as const,
    workflowHash: "a".repeat(64),
    modelHashes: { checkpoint: "b".repeat(64), textEncoder: "c".repeat(64), vae: "d".repeat(64) },
    frames: 97 as const,
    steps: 8 as const,
    runnerProfile: "dynamicvram-offload-v1",
    measuredPeakVramMb: 24028,
    measuredTotalDurationMs: 46000,
    measuredSamplingDurationMs: 12000,
    measuredDiskFootprintGb: 68.8,
    measuredPeakHostRamMb: null,
    measuredPeakProcessRssMb: null,
    measuredSwapUsedMb: null,
    measuredMajorPageFaults: null,
    minFreeDiskGb: 100,
    maxConcurrentGpuJobs: 1,
    requiresModelOffloading: true
  };

  const measuredFluxFixture = {
    key: "FLUX_SCHNELL_DRAFT_V1" as const,
    version: 1 as const,
    engine: "flux_schnell" as const,
    workflowHash: "e".repeat(64),
    modelHashes: { clip: "f".repeat(64), unet: "a".repeat(64), vae: "b".repeat(64) },
    frames: 1 as const,
    steps: 4 as const,
    runnerProfile: "dynamicvram-offload-v1",
    measuredPeakVramMb: 23810,
    measuredTotalDurationMs: 10270,
    measuredSamplingDurationMs: 8000,
    measuredDiskFootprintGb: 29.25,
    measuredPeakHostRamMb: 29124,
    measuredPeakProcessRssMb: 26924,
    measuredSwapUsedMb: 0,
    measuredMajorPageFaults: 0,
    minFreeDiskGb: 0,
    maxConcurrentGpuJobs: 1,
    requiresModelOffloading: true
  };

  const measuredLtxI2vFixture = {
    key: "LTX_25_720P_5S_I2V_V1" as const,
    version: 1 as const,
    engine: "ltx_25_i2v" as const,
    workflowHash: "c".repeat(64),
    modelHashes: { checkpoint: "b".repeat(64), textEncoder: "c".repeat(64), vae: "d".repeat(64) },
    frames: 97 as const,
    steps: 8 as const,
    runnerProfile: "dynamicvram-offload-v1",
    measuredPeakVramMb: 24028,
    measuredTotalDurationMs: 46000,
    measuredSamplingDurationMs: 12000,
    measuredDiskFootprintGb: 68.8,
    measuredPeakHostRamMb: null,
    measuredPeakProcessRssMb: null,
    measuredSwapUsedMb: null,
    measuredMajorPageFaults: null,
    minFreeDiskGb: 100,
    maxConcurrentGpuJobs: 1,
    requiresModelOffloading: true
  };

  const measuredMinimaxH3Fixture = {
    key: "MINIMAX_H3_720P_5S_I2V_V1" as const,
    version: 1 as const,
    engine: "minimax_h3_i2v" as const,
    workflowHash: "d".repeat(64),
    modelHashes: {
      diffusion: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      textEncoder: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
      videoVae: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
      audioVae: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
    },
    frames: 124 as const,
    steps: 20 as const,
    runnerProfile: "dynamicvram-offload-v1",
    measuredPeakVramMb: 23500,
    measuredTotalDurationMs: 65000,
    measuredSamplingDurationMs: null,
    measuredDiskFootprintGb: 40.08,
    measuredPeakHostRamMb: null,
    measuredPeakProcessRssMb: null,
    measuredSwapUsedMb: null,
    measuredMajorPageFaults: null,
    minFreeDiskGb: 100,
    maxConcurrentGpuJobs: 1,
    requiresModelOffloading: true
  };

  it("accepts canonical profile keys including LTX_25_720P_5S_I2V_V1 and MINIMAX_H3_720P_5S_I2V_V1 and rejects unknown keys", () => {
    expect(RenderProfileKeySchema.parse("LTX_25_720P_5S_V1")).toBe("LTX_25_720P_5S_V1");
    expect(RenderProfileKeySchema.parse("FLUX_SCHNELL_DRAFT_V1")).toBe("FLUX_SCHNELL_DRAFT_V1");
    expect(RenderProfileKeySchema.parse("LTX_25_720P_5S_I2V_V1")).toBe("LTX_25_720P_5S_I2V_V1");
    expect(RenderProfileKeySchema.parse("MINIMAX_H3_720P_5S_I2V_V1")).toBe(
      "MINIMAX_H3_720P_5S_I2V_V1"
    );
    expect(() => RenderProfileKeySchema.parse("UNKNOWN_PROFILE_KEY")).toThrow();
  });

  it("accepts the measured LTX 2.5 baseline with uncertified host memory fields set to null", () => {
    const parsed = RenderProfileSchema.parse(measuredLtxFixture);
    expect(parsed).toEqual(measuredLtxFixture);
  });

  it("accepts a compliant LTX I2V profile", () => {
    const parsed = RenderProfileSchema.parse(measuredLtxI2vFixture);
    expect(parsed).toEqual(measuredLtxI2vFixture);
    const parsedLtxI2v = LtxI2vRenderProfileSchema.parse(measuredLtxI2vFixture);
    expect(parsedLtxI2v).toEqual(measuredLtxI2vFixture);
  });

  it("accepts a compliant MiniMax-H3 I2V profile", () => {
    const parsed = RenderProfileSchema.parse(measuredMinimaxH3Fixture);
    expect(parsed).toEqual(measuredMinimaxH3Fixture);
    const parsedMinimax = MinimaxH3I2vRenderProfileSchema.parse(measuredMinimaxH3Fixture);
    expect(parsedMinimax).toEqual(measuredMinimaxH3Fixture);
  });

  it("accepts the frozen production LTX_25_720P_5S_V1_PROFILE constant", () => {
    const parsed = RenderProfileSchema.parse(LTX_25_720P_5S_V1_PROFILE);
    expect(parsed).toEqual(LTX_25_720P_5S_V1_PROFILE);
  });

  it("validates that config/render-profiles/LTX_25_720P_5S_V1.json matches schema and constant", async () => {
    const jsonPath = resolve(
      fileURLToPath(
        new URL("../../../config/render-profiles/LTX_25_720P_5S_V1.json", import.meta.url)
      )
    );
    const content = await readFile(jsonPath, "utf8");
    const parsedJson = JSON.parse(content);

    const validated = LtxRenderProfileSchema.parse(parsedJson);
    expect(validated).toEqual(LTX_25_720P_5S_V1_PROFILE);
  });

  it("verifies frozen modelHashes strictly match host-validated ltx-cert-run-002 artifact", async () => {
    const certPath = resolve(
      fileURLToPath(
        new URL("../../../certification/ltx-25/ltx-cert-run-002/result.json", import.meta.url)
      )
    );
    const certContent = await readFile(certPath, "utf8");
    const certJson = JSON.parse(certContent);

    expect(LTX_25_720P_5S_V1_PROFILE.modelHashes).toEqual(certJson.identity.modelSha256);
  });

  it("validates that config/render-profiles/LTX_25_720P_5S_I2V_V1.json matches schema and constant", async () => {
    const jsonPath = resolve(
      fileURLToPath(
        new URL("../../../config/render-profiles/LTX_25_720P_5S_I2V_V1.json", import.meta.url)
      )
    );
    const content = await readFile(jsonPath, "utf8");
    const parsedJson = JSON.parse(content);

    const validated = LtxI2vRenderProfileSchema.parse(parsedJson);
    expect(validated).toEqual(LTX_25_720P_5S_I2V_V1_PROFILE);
  });

  it("verifies frozen I2V modelHashes strictly match host-validated ltx-i2v-cert-run-001 artifact", async () => {
    const certPath = resolve(
      fileURLToPath(
        new URL("../../../certification/ltx-25/ltx-i2v-cert-run-001/result.json", import.meta.url)
      )
    );
    const certContent = await readFile(certPath, "utf8");
    const certJson = JSON.parse(certContent);

    expect(LTX_25_720P_5S_I2V_V1_PROFILE.modelHashes).toEqual(certJson.identity.modelSha256);
  });

  it("validates that config/render-profiles/MINIMAX_H3_720P_5S_I2V_V1.json matches schema and constant", async () => {
    const jsonPath = resolve(
      fileURLToPath(
        new URL("../../../config/render-profiles/MINIMAX_H3_720P_5S_I2V_V1.json", import.meta.url)
      )
    );
    const content = await readFile(jsonPath, "utf8");
    const parsedJson = JSON.parse(content);

    const validated = MinimaxH3I2vRenderProfileSchema.parse(parsedJson);
    expect(validated).toEqual(MINIMAX_H3_720P_5S_I2V_V1_PROFILE);
  });

  it("verifies frozen MiniMax-H3 modelHashes strictly match host-validated minimax-h3-cert-run-001 artifact", async () => {
    const certPath = resolve(
      fileURLToPath(
        new URL(
          "../../../certification/minimax-h3/minimax-h3-cert-run-001/result.json",
          import.meta.url
        )
      )
    );
    const certContent = await readFile(certPath, "utf8");
    const certJson = JSON.parse(certContent);

    expect(MINIMAX_H3_720P_5S_I2V_V1_PROFILE.modelHashes).toEqual(certJson.identity.modelSha256);
  });

  it("accepts a compliant FLUX profile", () => {
    const parsed = RenderProfileSchema.parse(measuredFluxFixture);
    expect(parsed).toEqual(measuredFluxFixture);
  });

  it("rejects unknown render profile keys", () => {
    expect(
      RenderProfileSchema.safeParse({
        ...measuredLtxFixture,
        key: "UNKNOWN_PROFILE_KEY"
      }).success
    ).toBe(false);
  });

  it("rejects engine mismatch for key", () => {
    expect(
      RenderProfileSchema.safeParse({
        ...measuredLtxFixture,
        engine: "flux_schnell"
      }).success
    ).toBe(false);

    expect(
      RenderProfileSchema.safeParse({
        ...measuredFluxFixture,
        engine: "ltx_25"
      }).success
    ).toBe(false);

    expect(
      RenderProfileSchema.safeParse({
        ...measuredLtxI2vFixture,
        engine: "ltx_25"
      }).success
    ).toBe(false);
  });

  it("rejects a render profile when maxConcurrentGpuJobs is not positive", () => {
    const withZero = { ...measuredLtxFixture, maxConcurrentGpuJobs: 0 };
    const withNegative = { ...measuredLtxFixture, maxConcurrentGpuJobs: -1 };

    expect(RenderProfileSchema.safeParse(withZero).success).toBe(false);
    expect(RenderProfileSchema.safeParse(withNegative).success).toBe(false);
  });

  it("rejects malformed workflow and model SHA-256 hashes", () => {
    // Malformed workflowHash (too short, uppercase, non-hex)
    expect(
      RenderProfileSchema.safeParse({ ...measuredLtxFixture, workflowHash: "abc" }).success
    ).toBe(false);
    expect(
      RenderProfileSchema.safeParse({ ...measuredLtxFixture, workflowHash: "A".repeat(64) }).success
    ).toBe(false);
    expect(
      RenderProfileSchema.safeParse({ ...measuredLtxFixture, workflowHash: "z".repeat(64) }).success
    ).toBe(false);

    // Malformed modelHashes
    expect(
      RenderProfileSchema.safeParse({
        ...measuredLtxFixture,
        modelHashes: { checkpoint: "not-a-hash" }
      }).success
    ).toBe(false);
    expect(
      RenderProfileSchema.safeParse({
        ...measuredLtxFixture,
        modelHashes: { checkpoint: "B".repeat(64) }
      }).success
    ).toBe(false);
  });

  it("requires explicit nulls for host measurements that are not yet certified", () => {
    // Omitting host metrics (undefined) must be rejected
    const withoutHostRam: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutHostRam["measuredPeakHostRamMb"];

    const withoutProcessRss: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutProcessRss["measuredPeakProcessRssMb"];

    const withoutSwap: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutSwap["measuredSwapUsedMb"];

    const withoutPageFaults: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutPageFaults["measuredMajorPageFaults"];

    expect(RenderProfileSchema.safeParse(withoutHostRam).success).toBe(false);
    expect(RenderProfileSchema.safeParse(withoutProcessRss).success).toBe(false);
    expect(RenderProfileSchema.safeParse(withoutSwap).success).toBe(false);
    expect(RenderProfileSchema.safeParse(withoutPageFaults).success).toBe(false);
  });

  describe("declarative injection topology", () => {
    it("returns explicit topology for LTX profile with audioPrompt set to null and referenceImage undefined", () => {
      const topology = getProfileInjectionTopology("LTX_25_720P_5S_V1");
      expect(topology).toBeDefined();
      expect(topology?.prompt).toEqual({
        nodeId: "3",
        classType: "CLIPTextEncode",
        inputField: "text"
      });
      expect(topology?.negativePrompt).toEqual({
        nodeId: "4",
        classType: "CLIPTextEncode",
        inputField: "text"
      });
      expect(topology?.seed).toEqual({
        nodeId: "1",
        classType: "KSampler",
        inputField: "seed"
      });
      expect(topology?.audioPrompt).toBeNull();
      expect(topology?.frameCount).toEqual({
        nodeId: "5",
        classType: "EmptyLTXVLatentVideo",
        inputField: "length"
      });
      expect(topology?.referenceImage).toBeUndefined();
    });

    it("returns explicit topology for Flux profile with audioPrompt, frameCount, and referenceImage undefined/null", () => {
      const topology = getProfileInjectionTopology("flux-schnell-draft");
      expect(topology).toBeDefined();
      expect(topology?.prompt).toEqual({
        nodeId: "3",
        classType: "CLIPTextEncode",
        inputField: "text"
      });
      expect(topology?.seed).toEqual({
        nodeId: "1",
        classType: "KSampler",
        inputField: "seed"
      });
      expect(topology?.audioPrompt).toBeNull();
      expect(topology?.frameCount).toBeUndefined();
      expect(topology?.referenceImage).toBeUndefined();
    });

    it("returns explicit topology for LTX I2V profile with referenceImage target", () => {
      const topology = getProfileInjectionTopology("LTX_25_720P_5S_I2V_V1");
      expect(topology).toBeDefined();
      expect(topology?.prompt).toEqual({
        nodeId: "3",
        classType: "CLIPTextEncode",
        inputField: "text"
      });
      expect(topology?.negativePrompt).toEqual({
        nodeId: "4",
        classType: "CLIPTextEncode",
        inputField: "text"
      });
      expect(topology?.seed).toEqual({
        nodeId: "1",
        classType: "KSampler",
        inputField: "seed"
      });
      expect(topology?.audioPrompt).toBeNull();
      expect(topology?.frameCount).toBeUndefined();
      expect(topology?.referenceImage).toEqual({
        nodeId: "20",
        classType: "LoadImage",
        inputField: "image"
      });

      // Alias resolution
      const aliasTopology = getProfileInjectionTopology("ltx-25-720p-97f-i2v");
      expect(aliasTopology).toEqual(topology);
      const shortAliasTopology = getProfileInjectionTopology("ltx_25_i2v");
      expect(shortAliasTopology).toEqual(topology);
    });

    it("verifies LTX frame rate, quantization constants and tolerance", () => {
      expect(LTX_FPS).toBe(24);
      expect(LTX_FRAME_STEP).toBe(8);
      expect(LTX_SUPPORTED_FRAME_RANGE).toEqual([97, 97]);
      expect(LTX_FRAME_QUANTIZATION_TOLERANCE_MS).toBe(167);
    });

    it("returns explicit topology for MiniMax-H3 I2V profile with prompt, seed, referenceImage, and frameCount targets", () => {
      const topology = getProfileInjectionTopology("MINIMAX_H3_720P_5S_I2V_V1");
      expect(topology).toBeDefined();
      expect(topology).toEqual(MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY);
      expect(topology?.prompt).toEqual({
        nodeId: "104",
        classType: "MiniMaxH3ImageToVideo",
        inputField: "prompt"
      });
      expect(topology?.negativePrompt).toBeUndefined();
      expect(topology?.seed).toEqual({
        nodeId: "15",
        classType: "RandomNoise",
        inputField: "noise_seed"
      });
      expect(topology?.audioPrompt).toBeNull();
      expect(topology?.frameCount).toEqual({
        nodeId: "104",
        classType: "MiniMaxH3ImageToVideo",
        inputField: "length"
      });
      expect(topology?.referenceImage).toEqual({
        nodeId: "20",
        classType: "LoadImage",
        inputField: "image"
      });

      // Alias resolution
      expect(getProfileInjectionTopology("minimax_h3_720p_5s_i2v_v1")).toEqual(topology);
      expect(getProfileInjectionTopology("minimax-h3-720p-5s-i2v-v1")).toEqual(topology);
      expect(getProfileInjectionTopology("minimax_h3_i2v")).toEqual(topology);
      expect(getProfileInjectionTopology("minimax_h3")).toEqual(topology);
    });

    it("verifies MiniMax-H3 frame rate, quantization constants and tolerance", () => {
      expect(MINIMAX_H3_FPS).toBe(24);
      expect(MINIMAX_H3_FRAME_GRID_BASE).toBe(5);
      expect(MINIMAX_H3_FRAME_GRID_STEP).toBe(17);
      expect(MINIMAX_H3_SUPPORTED_FRAME_RANGE).toEqual([124, 124]);
      expect(MINIMAX_H3_FRAME_QUANTIZATION_TOLERANCE_MS).toBe(355);
    });

    it("returns undefined for unknown profile keys", () => {
      expect(getProfileInjectionTopology("unknown_profile")).toBeUndefined();
      expect(getProfileInjectionTopology(undefined)).toBeUndefined();
    });
  });
});
