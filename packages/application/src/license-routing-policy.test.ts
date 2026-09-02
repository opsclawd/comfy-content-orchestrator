import { describe, expect, it } from "vitest";
import type { ComponentLicenseRegistrySnapshot, ComponentRef } from "@cco/contracts";
import { evaluateLicenseRouting } from "./license-routing-policy.js";

describe("evaluateLicenseRouting", () => {
  const sampleSnapshot: ComponentLicenseRegistrySnapshot = {
    registryRevision: "2026-08-29.1",
    generatedAt: "2026-08-29T12:00:00.000Z",
    entries: [
      {
        componentId: "FLUX_SCHNELL_DRAFT_V1",
        componentType: "model",
        versionOrRevision: "1",
        status: "approved",
        licenseId: "Apache-2.0",
        licenseSource: "docs/prd.md §3.5",
        reviewedAt: "2026-08-29T12:00:00.000Z",
        policyRevision: "1"
      },
      {
        componentId: "minio",
        componentType: "service",
        versionOrRevision: "RELEASE.2024-01-18T22-51-28Z",
        status: "approved",
        licenseId: "AGPL-3.0",
        licenseSource: "docs/component-governance.md",
        reviewedAt: "2026-08-26T00:00:00.000Z",
        policyRevision: "1"
      },
      {
        componentId: "LTX_25_720P_5S_V1",
        componentType: "model",
        versionOrRevision: "1",
        status: "review_required",
        licenseSource: "docs/prd.md §3.5",
        reviewedAt: "2026-08-29T12:00:00.000Z",
        policyRevision: "1"
      },
      {
        componentId: "flux-1-dev",
        componentType: "model",
        versionOrRevision: "unpinned",
        status: "restricted",
        licenseSource: "docs/prd.md §3.5",
        reviewedAt: "2026-08-29T12:00:00.000Z",
        policyRevision: "1"
      },
      {
        componentId: "blocked-component",
        componentType: "library",
        versionOrRevision: "1.0.0",
        status: "blocked",
        licenseSource: "internal-security-policy",
        reviewedAt: "2026-08-29T12:00:00.000Z",
        policyRevision: "1"
      }
    ]
  };

  it("permits when all required components are approved", () => {
    const required: ComponentRef[] = [
      {
        componentId: "FLUX_SCHNELL_DRAFT_V1",
        componentType: "model",
        versionOrRevision: "1"
      },
      {
        componentId: "minio",
        componentType: "service",
        versionOrRevision: "RELEASE.2024-01-18T22-51-28Z"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(true);
    expect(result.deniedReasons).toBeUndefined();
    expect(result.evaluated).toHaveLength(2);
    expect(result.evaluated[0]?.status).toBe("approved");
    expect(result.evaluated[0]?.licenseId).toBe("Apache-2.0");
    expect(result.evaluated[1]?.status).toBe("approved");
    expect(result.evaluated[1]?.licenseId).toBe("AGPL-3.0");
  });

  it("denies when any component is review_required", () => {
    const required: ComponentRef[] = [
      {
        componentId: "LTX_25_720P_5S_V1",
        componentType: "model",
        versionOrRevision: "1"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.deniedReasons).toHaveLength(1);
    expect(result.deniedReasons![0]).toContain('has policy status "review_required"');
    expect(result.evaluated[0]?.status).toBe("review_required");
  });

  it("denies when any component is restricted", () => {
    const required: ComponentRef[] = [
      {
        componentId: "flux-1-dev",
        componentType: "model",
        versionOrRevision: "unpinned"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.deniedReasons).toHaveLength(1);
    expect(result.deniedReasons![0]).toContain('has policy status "restricted"');
    expect(result.evaluated[0]?.status).toBe("restricted");
  });

  it("denies when any component is blocked", () => {
    const required: ComponentRef[] = [
      {
        componentId: "blocked-component",
        componentType: "library",
        versionOrRevision: "1.0.0"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.deniedReasons).toHaveLength(1);
    expect(result.deniedReasons![0]).toContain('has policy status "blocked"');
    expect(result.evaluated[0]?.status).toBe("blocked");
  });

  it("denies when a component is unknown/unregistered", () => {
    const required: ComponentRef[] = [
      {
        componentId: "unregistered-model",
        componentType: "model",
        versionOrRevision: "1"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.deniedReasons).toHaveLength(1);
    expect(result.deniedReasons![0]).toContain("is not registered in license registry");
    expect(result.evaluated[0]?.status).toBe("unknown_component");
  });

  it("denies when version does not match exactly", () => {
    const required: ComponentRef[] = [
      {
        componentId: "FLUX_SCHNELL_DRAFT_V1",
        componentType: "model",
        versionOrRevision: "2" // registry only has "1"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.evaluated[0]?.status).toBe("unknown_component");
  });

  it("denies when componentType does not match", () => {
    const required: ComponentRef[] = [
      {
        componentId: "minio",
        componentType: "library", // registry has "service"
        versionOrRevision: "RELEASE.2024-01-18T22-51-28Z"
      }
    ];

    const result = evaluateLicenseRouting(required, sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.evaluated[0]?.status).toBe("unknown_component");
  });

  it("denies when requiredComponents is empty (no implicit allow-list fallback)", () => {
    const result = evaluateLicenseRouting([], sampleSnapshot);
    expect(result.permitted).toBe(false);
    expect(result.deniedReasons![0]).toContain(
      "No required components specified for license routing evaluation"
    );
  });
});
