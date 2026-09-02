import { describe, expect, it } from "vitest";
import type { ComponentLicenseRegistrySnapshot, ComponentRef } from "@cco/contracts";
import type { LicenseRegistryPort } from "../ports/index.js";
import {
  EnforceLicenseRouting,
  type LicenseRoutingOperationContext
} from "./enforce-license-routing.js";
import { LicenseRoutingError } from "./license-routing-error.js";

describe("EnforceLicenseRouting use case", () => {
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

  const createMockRegistry = (
    snapshot: ComponentLicenseRegistrySnapshot = sampleSnapshot
  ): LicenseRegistryPort => ({
    getSnapshot: () => snapshot
  });

  it("permits approved components and returns a deterministic decision record", () => {
    const registry = createMockRegistry();
    const fixedDate = new Date("2026-08-29T14:00:00.000Z");
    const guard = new EnforceLicenseRouting({
      registry,
      now: () => fixedDate,
      generateDecisionId: () => "gov-dec-deterministic-123"
    });

    const requiredComponents: ComponentRef[] = [
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

    const decision = guard.enforce({
      requiredComponents,
      operation: { kind: "generation", renderJobId: "job-101", sceneId: "scene-202" }
    });

    expect(decision.decisionId).toBe("gov-dec-deterministic-123");
    expect(decision.registryRevision).toBe("2026-08-29.1");
    expect(decision.evaluatedAt).toBe("2026-08-29T14:00:00.000Z");
    expect(decision.components).toHaveLength(2);
    expect(decision.components[0]?.status).toBe("approved");
    expect(decision.components[1]?.status).toBe("approved");
    expect(decision.operation).toEqual({
      kind: "generation",
      renderJobId: "job-101",
      sceneId: "scene-202"
    });
  });

  it("denies with typed LicenseRoutingError on restricted component", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    const requiredComponents: ComponentRef[] = [
      {
        componentId: "flux-1-dev",
        componentType: "model",
        versionOrRevision: "unpinned"
      }
    ];

    expect(() =>
      guard.enforce({
        requiredComponents,
        operation: { kind: "generation", renderJobId: "job-102" }
      })
    ).toThrow(LicenseRoutingError);

    try {
      guard.enforce({
        requiredComponents,
        operation: { kind: "generation", renderJobId: "job-102" }
      });
    } catch (err) {
      expect(err).toBeInstanceOf(LicenseRoutingError);
      const routingErr = err as LicenseRoutingError;
      expect(routingErr.name).toBe("LicenseRoutingError");
      expect(routingErr.code).toBe("license_routing_denied");
      expect(routingErr.decisionId).toBeDefined();
      expect(routingErr.decisionId).toMatch(/^gov-dec-/);
      expect(routingErr.registryRevision).toBe("2026-08-29.1");
      expect(routingErr.evaluatedComponents[0]?.status).toBe("restricted");
      expect(routingErr.deniedReasons[0]).toContain('has policy status "restricted"');
      expect(routingErr.operation).toEqual({ kind: "generation", renderJobId: "job-102" });
    }
  });

  it("denies on review_required component", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    const requiredComponents: ComponentRef[] = [
      {
        componentId: "LTX_25_720P_5S_V1",
        componentType: "model",
        versionOrRevision: "1"
      }
    ];

    expect(() => guard.enforce({ requiredComponents })).toThrow(LicenseRoutingError);
  });

  it("denies on blocked component", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    const requiredComponents: ComponentRef[] = [
      {
        componentId: "blocked-component",
        componentType: "library",
        versionOrRevision: "1.0.0"
      }
    ];

    expect(() => guard.enforce({ requiredComponents })).toThrow(LicenseRoutingError);
  });

  it("denies on unknown/unregistered component", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    const requiredComponents: ComponentRef[] = [
      {
        componentId: "some-unknown-model",
        componentType: "model",
        versionOrRevision: "1"
      }
    ];

    expect(() => guard.enforce({ requiredComponents })).toThrow(LicenseRoutingError);
  });

  it("denies on empty requirements list", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    expect(() => guard.enforce({ requiredComponents: [] })).toThrow(LicenseRoutingError);
  });

  it("denies on missing or empty versionOrRevision without wildcard fallback", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    // Component with empty string version
    const emptyVersionRef: ComponentRef = {
      componentId: "FLUX_SCHNELL_DRAFT_V1",
      componentType: "model",
      versionOrRevision: ""
    };

    let thrownError: unknown;
    try {
      guard.enforce({ requiredComponents: [emptyVersionRef] });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(LicenseRoutingError);
    const routingErr = thrownError as LicenseRoutingError;
    expect(routingErr.deniedReasons).toContain(
      "Invalid component reference: missing required fields"
    );
    expect(routingErr.evaluatedComponents[0]?.status).toBe("unknown_component");

    // Component with undefined/missing version (runtime malformed)
    const missingVersionRef = {
      componentId: "FLUX_SCHNELL_DRAFT_V1",
      componentType: "model"
    } as unknown as ComponentRef;

    expect(() => guard.enforce({ requiredComponents: [missingVersionRef] })).toThrow(
      LicenseRoutingError
    );
  });

  it("sanitizes operation context to prevent secret leakage into decisions and errors", () => {
    const registry = createMockRegistry();
    const guard = new EnforceLicenseRouting({ registry });

    // Success path with extra secret fields in operation
    const dirtyOperation = {
      kind: "generation" as const,
      renderJobId: "job-secret-test",
      sceneId: "scene-secret-test",
      apiSecretKey: "super-secret-token",
      password: "secret-password"
    } as unknown as LicenseRoutingOperationContext;

    const decision = guard.enforce({
      requiredComponents: [
        {
          componentId: "FLUX_SCHNELL_DRAFT_V1",
          componentType: "model",
          versionOrRevision: "1"
        }
      ],
      operation: dirtyOperation
    });

    expect(decision.operation).toEqual({
      kind: "generation",
      renderJobId: "job-secret-test",
      sceneId: "scene-secret-test"
    });
    expect((decision.operation as Record<string, unknown>)["apiSecretKey"]).toBeUndefined();
    expect((decision.operation as Record<string, unknown>)["password"]).toBeUndefined();

    // Denial path with extra secret fields
    try {
      guard.enforce({
        requiredComponents: [
          {
            componentId: "LTX_25_720P_5S_V1",
            componentType: "model",
            versionOrRevision: "1"
          }
        ],
        operation: dirtyOperation
      });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LicenseRoutingError);
      const routingErr = err as LicenseRoutingError;
      expect(routingErr.operation).toEqual({
        kind: "generation",
        renderJobId: "job-secret-test",
        sceneId: "scene-secret-test"
      });
      expect((routingErr.operation as Record<string, unknown>)["apiSecretKey"]).toBeUndefined();
    }
  });
});
