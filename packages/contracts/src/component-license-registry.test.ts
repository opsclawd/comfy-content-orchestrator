import { describe, expect, it } from "vitest";
import {
  ComponentLicenseEntrySchema,
  ComponentLicenseRegistrySchema,
  ComponentRefSchema,
  LicensePolicyStatusSchema,
  type ComponentLicenseEntry
} from "./component-license-registry.js";

describe("ComponentLicenseRegistry contracts", () => {
  const validEntry: ComponentLicenseEntry = {
    componentId: "LTX_25_720P_5S_V1",
    componentType: "model",
    versionOrRevision: "1",
    status: "review_required",
    licenseId: "Lightricks-Research-v1",
    licenseSource: "docs/prd.md §3.5",
    reviewedAt: "2026-08-29T12:00:00.000Z",
    policyRevision: "1",
    notes: "Requires formal commercial review"
  };

  const validRegistryPayload = {
    registryRevision: "2026-08-29.1",
    generatedAt: "2026-08-29T12:00:00.000Z",
    entries: [validEntry]
  };

  it("parses a valid registry and returns a deep-frozen structure", () => {
    const registry = ComponentLicenseRegistrySchema.parse(validRegistryPayload);
    expect(registry.registryRevision).toBe("2026-08-29.1");
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]?.componentId).toBe("LTX_25_720P_5S_V1");
    expect(registry.entries[0]?.status).toBe("review_required");

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.entries)).toBe(true);
    expect(Object.isFrozen(registry.entries[0])).toBe(true);
  });

  it("validates all LicensePolicyStatus enum values", () => {
    const statuses = ["approved", "restricted", "review_required", "blocked"] as const;
    for (const status of statuses) {
      expect(LicensePolicyStatusSchema.parse(status)).toBe(status);
      const entry = ComponentLicenseEntrySchema.parse({
        ...validEntry,
        status
      });
      expect(entry.status).toBe(status);
    }

    expect(() => LicensePolicyStatusSchema.parse("invalid_status")).toThrow();
  });

  it("validates all ComponentType enum values", () => {
    const types = ["model", "service", "runtime", "library", "provider"] as const;
    for (const componentType of types) {
      const entry = ComponentLicenseEntrySchema.parse({
        ...validEntry,
        componentType
      });
      expect(entry.componentType).toBe(componentType);
    }
  });

  it("validates ComponentRefSchema", () => {
    const ref = ComponentRefSchema.parse({
      componentId: "minio",
      componentType: "service",
      versionOrRevision: "RELEASE.2024-01-18T22-51-28Z"
    });
    expect(ref.componentId).toBe("minio");
    expect(ref.componentType).toBe("service");
    expect(ref.versionOrRevision).toBe("RELEASE.2024-01-18T22-51-28Z");

    expect(() =>
      ComponentRefSchema.parse({
        componentId: "",
        componentType: "service",
        versionOrRevision: "v1"
      })
    ).toThrow();

    expect(() =>
      ComponentRefSchema.parse({
        componentId: "minio",
        componentType: "unknown_type",
        versionOrRevision: "v1"
      })
    ).toThrow();
  });

  it("rejects unknown/extra fields because of strict mode", () => {
    expect(() =>
      ComponentLicenseEntrySchema.parse({
        ...validEntry,
        unexpectedProperty: "should_fail"
      })
    ).toThrow();

    expect(() =>
      ComponentLicenseRegistrySchema.parse({
        ...validRegistryPayload,
        extraRootProperty: 123
      })
    ).toThrow();
  });

  it("rejects empty entries array in registry", () => {
    expect(() =>
      ComponentLicenseRegistrySchema.parse({
        ...validRegistryPayload,
        entries: []
      })
    ).toThrow("entries must contain at least one entry");
  });

  it("rejects non-datetime strings for reviewedAt and generatedAt", () => {
    expect(() =>
      ComponentLicenseEntrySchema.parse({
        ...validEntry,
        reviewedAt: "not-a-datetime"
      })
    ).toThrow("reviewedAt must be an ISO 8601 datetime string");

    expect(() =>
      ComponentLicenseRegistrySchema.parse({
        ...validRegistryPayload,
        generatedAt: "2026-08-29"
      })
    ).toThrow("generatedAt must be an ISO 8601 datetime string");
  });

  it("supports optional Phase 2 extensibility fields without requiring them", () => {
    const entryWithExt = ComponentLicenseEntrySchema.parse({
      ...validEntry,
      territoryPolicy: "global_commercial",
      revenueThresholdUsd: 1000000,
      attributionRequired: true,
      approver: "legal@godzspeed.ai"
    });
    expect(entryWithExt.territoryPolicy).toBe("global_commercial");
    expect(entryWithExt.revenueThresholdUsd).toBe(1000000);
    expect(entryWithExt.attributionRequired).toBe(true);
    expect(entryWithExt.approver).toBe("legal@godzspeed.ai");
  });
});
