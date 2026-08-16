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

  it("accepts the measured LTX 2.5 baseline with uncertified host memory fields set to null", () => {
    const parsed = RenderProfileSchema.parse(measuredLtxFixture);
    expect(parsed).toEqual(measuredLtxFixture);
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
