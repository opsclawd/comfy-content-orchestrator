import { describe, expect, it } from "vitest";
import { RenderProfileSchema } from "./render-profile.js";

describe("RenderProfileSchema", () => {
  const measuredLtxFixture = {
    key: "LTX_25_720P_5S_V1",
    version: 1,
    engine: "ltx_25",
    workflowHash: "a".repeat(64),
    modelHashes: { checkpoint: "b".repeat(64), textEncoder: "c".repeat(64), vae: "d".repeat(64) },
    frames: 97,
    steps: 8,
    runnerProfile: "dynamicvram-offload-v1",
    runnerStartupArgs: [
      "/home/gpoontip/ComfyUI/venv/bin/python",
      "main.py",
      "--listen",
      "0.0.0.0",
      "--port",
      "8188"
    ],
    measuredPeakVramMb: 24028,
    measuredTotalDurationMs: 46000,
    measuredSamplingDurationMs: 12000,
    measuredDiskFootprintGb: 68.8,
    measuredPeakHostRamMb: null,
    measuredPeakProcessRssMb: null,
    measuredSwapUsedMb: null,
    measuredMajorPageFaults: null,
    measuredSwapActivity: 0,
    measuredHostRamTotalMb: 31233,
    measuredPostUnloadFreeVramMb: 23487,
    minPostUnloadFreeVramMb: 23000,
    minimumHostRamMb: 32768,
    minFreeDiskGb: 100,
    maxConcurrentGpuJobs: 1,
    requiresModelOffloading: true,
    certificationArtifactPath:
      "certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json"
  };

  it("accepts the measured LTX 2.5 baseline with uncertified host memory fields set to null", () => {
    const parsed = RenderProfileSchema.parse(measuredLtxFixture);
    expect(parsed).toEqual(measuredLtxFixture);
  });

  it("accepts arbitrary profile key and integer version", () => {
    const customProfile = {
      ...measuredLtxFixture,
      key: "FLUX_SCHNELL_1024_V2",
      version: 2
    };
    const parsed = RenderProfileSchema.parse(customProfile);
    expect(parsed.key).toBe("FLUX_SCHNELL_1024_V2");
    expect(parsed.version).toBe(2);

    expect(RenderProfileSchema.safeParse({ ...measuredLtxFixture, key: "" }).success).toBe(false);
    expect(RenderProfileSchema.safeParse({ ...measuredLtxFixture, version: 0 }).success).toBe(
      false
    );
    expect(RenderProfileSchema.safeParse({ ...measuredLtxFixture, version: -1 }).success).toBe(
      false
    );
    expect(RenderProfileSchema.safeParse({ ...measuredLtxFixture, version: 1.5 }).success).toBe(
      false
    );
  });

  it("requires certified soak linkage and measured host fields on RenderProfile", () => {
    // Missing runnerStartupArgs
    const withoutStartupArgs: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutStartupArgs["runnerStartupArgs"];
    expect(RenderProfileSchema.safeParse(withoutStartupArgs).success).toBe(false);

    // Missing measuredHostRamTotalMb
    const withoutHostRamTotal: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutHostRamTotal["measuredHostRamTotalMb"];
    expect(RenderProfileSchema.safeParse(withoutHostRamTotal).success).toBe(false);

    // Missing measuredSwapActivity
    const withoutSwapActivity: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutSwapActivity["measuredSwapActivity"];
    expect(RenderProfileSchema.safeParse(withoutSwapActivity).success).toBe(false);

    // Missing measuredPostUnloadFreeVramMb
    const withoutMeasuredPostUnload: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutMeasuredPostUnload["measuredPostUnloadFreeVramMb"];
    expect(RenderProfileSchema.safeParse(withoutMeasuredPostUnload).success).toBe(false);

    // Missing minPostUnloadFreeVramMb
    const withoutMinPostUnload: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutMinPostUnload["minPostUnloadFreeVramMb"];
    expect(RenderProfileSchema.safeParse(withoutMinPostUnload).success).toBe(false);

    // Missing minimumHostRamMb
    const withoutMinimumHostRam: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutMinimumHostRam["minimumHostRamMb"];
    expect(RenderProfileSchema.safeParse(withoutMinimumHostRam).success).toBe(false);

    // Missing certificationArtifactPath
    const withoutArtifactPath: Record<string, unknown> = { ...measuredLtxFixture };
    delete withoutArtifactPath["certificationArtifactPath"];
    expect(RenderProfileSchema.safeParse(withoutArtifactPath).success).toBe(false);

    // Allows measuredSamplingDurationMs to be null
    const withNullSampling = { ...measuredLtxFixture, measuredSamplingDurationMs: null };
    expect(RenderProfileSchema.safeParse(withNullSampling).success).toBe(true);
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
});
