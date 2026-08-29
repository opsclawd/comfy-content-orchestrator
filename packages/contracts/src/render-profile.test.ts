import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RenderProfileSchema,
  LtxRenderProfileSchema,
  LTX_25_720P_5S_V1_PROFILE,
  getProfileInjectionTopology
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

  it("accepts the measured LTX 2.5 baseline with uncertified host memory fields set to null", () => {
    const parsed = RenderProfileSchema.parse(measuredLtxFixture);
    expect(parsed).toEqual(measuredLtxFixture);
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
    it("returns explicit topology for LTX profile with audioPrompt set to null", () => {
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
    });

    it("returns explicit topology for Flux profile with audioPrompt set to null", () => {
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
    });

    it("returns undefined for unknown profile keys", () => {
      expect(getProfileInjectionTopology("unknown_profile")).toBeUndefined();
      expect(getProfileInjectionTopology(undefined)).toBeUndefined();
    });
  });
});
