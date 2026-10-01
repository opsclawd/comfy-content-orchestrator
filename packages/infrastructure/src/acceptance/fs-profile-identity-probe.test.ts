import { describe, expect, it } from "vitest";
import { FsProfileIdentityProbe } from "./fs-profile-identity-probe.js";

describe("FsProfileIdentityProbe", () => {
  it("verifies both MiniMax-H3 profiles against the real templates/provenance.json manifest", async () => {
    const probe = new FsProfileIdentityProbe();

    const result = await probe.probe();

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(2);
    for (const finding of result.findings) {
      expect(finding.matches).toBe(true);
      expect(finding.actualWorkflowHash).toBe(finding.expectedWorkflowHash);
    }
    const engines = result.findings.map((f) => f.engine).sort();
    expect(engines).toEqual(["minimax_h3_i2v", "minimax_h3_ref2v"]);
  });

  it("reports an error for an unknown profile id without throwing", async () => {
    const probe = new FsProfileIdentityProbe({ profileIds: ["does-not-exist"] });

    const result = await probe.probe();

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("does-not-exist");
  });

  it("reports a mismatch when the live workflow hash does not match the manifest's pinned hash", async () => {
    const probe = new FsProfileIdentityProbe({
      profileIds: ["minimax-h3-720p-124f-ref2v"],
      readWorkflowFile: async () => JSON.stringify({ not: "the real workflow" })
    });

    const result = await probe.probe();

    expect(result.ok).toBe(false);
    expect(result.findings[0]?.matches).toBe(false);
    expect(result.errors.some((e) => e.includes("workflow hash mismatch"))).toBe(true);
  });
});
