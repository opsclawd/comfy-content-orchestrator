import { describe, it, expect } from "vitest";
import {
  REFERENCE_ROLES,
  type ReferenceAsset,
  type ReferenceAssetId,
  type ReferenceGroup,
  type ReferenceGroupId,
  type SceneReferenceBinding,
  type SceneId,
  CrossClientReferenceBindingError,
  ArchivedReferenceBindingError,
  InvalidReferenceRoleError,
  InvalidReferenceWeightError,
  isReferenceRole,
  assertValidReferenceRole,
  assertValidReferenceWeight,
  assertReferenceAssetSelectable
} from "./index.js";

describe("ReferenceAsset Domain Modeling & Invariants", () => {
  it("defines the five canonical reference roles per ADR 0006", () => {
    expect(REFERENCE_ROLES).toEqual([
      "subject_identity",
      "product",
      "location",
      "style",
      "composition"
    ]);
  });

  describe("Role Validation", () => {
    it("isReferenceRole correctly identifies valid roles", () => {
      expect(isReferenceRole("subject_identity")).toBe(true);
      expect(isReferenceRole("product")).toBe(true);
      expect(isReferenceRole("location")).toBe(true);
      expect(isReferenceRole("style")).toBe(true);
      expect(isReferenceRole("composition")).toBe(true);
      expect(isReferenceRole("invalid_role")).toBe(false);
      expect(isReferenceRole("")).toBe(false);
    });

    it("assertValidReferenceRole succeeds for valid roles and throws for invalid", () => {
      expect(() => assertValidReferenceRole("subject_identity")).not.toThrow();
      expect(() => assertValidReferenceRole("product")).not.toThrow();
      expect(() => assertValidReferenceRole("location")).not.toThrow();
      expect(() => assertValidReferenceRole("style")).not.toThrow();
      expect(() => assertValidReferenceRole("composition")).not.toThrow();

      expect(() => assertValidReferenceRole("unknown")).toThrow(InvalidReferenceRoleError);
      expect(() => assertValidReferenceRole("unknown")).toThrow(
        /Invalid reference role: "unknown"/
      );
    });
  });

  describe("Weight Validation", () => {
    it("accepts valid weights in [0.0, 1.0] and null/undefined", () => {
      expect(() => assertValidReferenceWeight(undefined)).not.toThrow();
      expect(() => assertValidReferenceWeight(null)).not.toThrow();
      expect(() => assertValidReferenceWeight(0.0)).not.toThrow();
      expect(() => assertValidReferenceWeight(0.5)).not.toThrow();
      expect(() => assertValidReferenceWeight(1.0)).not.toThrow();
    });

    it("rejects weights outside [0.0, 1.0] or NaN", () => {
      expect(() => assertValidReferenceWeight(-0.1)).toThrow(InvalidReferenceWeightError);
      expect(() => assertValidReferenceWeight(1.01)).toThrow(InvalidReferenceWeightError);
      expect(() => assertValidReferenceWeight(Number.NaN)).toThrow(InvalidReferenceWeightError);
    });
  });

  describe("assertReferenceAssetSelectable", () => {
    const validAsset: ReferenceAsset = {
      id: "asset-1" as ReferenceAssetId,
      clientId: "client-a",
      storageBucket: "ref-bucket",
      storageObjectKey: "refs/asset-1.png",
      contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Elena Close-up"
    };

    it("passes for active reference asset matching the campaign client", () => {
      expect(() => assertReferenceAssetSelectable(validAsset, "client-a")).not.toThrow();
    });

    it("throws CrossClientReferenceBindingError when asset client does not match campaign client", () => {
      expect(() => assertReferenceAssetSelectable(validAsset, "client-b")).toThrow(
        CrossClientReferenceBindingError
      );
      try {
        assertReferenceAssetSelectable(validAsset, "client-b");
      } catch (err) {
        expect(err).toBeInstanceOf(CrossClientReferenceBindingError);
        const crossErr = err as CrossClientReferenceBindingError;
        expect(crossErr.campaignClientId).toBe("client-b");
        expect(crossErr.assetId).toBe("asset-1");
        expect(crossErr.assetClientId).toBe("client-a");
      }
    });

    it("throws ArchivedReferenceBindingError when asset is archived", () => {
      const archivedAsset: ReferenceAsset = {
        ...validAsset,
        archivedAt: "2026-09-24T12:00:00.000Z"
      };

      expect(() => assertReferenceAssetSelectable(archivedAsset, "client-a")).toThrow(
        ArchivedReferenceBindingError
      );
      try {
        assertReferenceAssetSelectable(archivedAsset, "client-a");
      } catch (err) {
        expect(err).toBeInstanceOf(ArchivedReferenceBindingError);
        const archErr = err as ArchivedReferenceBindingError;
        expect(archErr.assetId).toBe("asset-1");
      }
    });
  });

  describe("Type Structure Verification", () => {
    it("allows constructing valid ReferenceGroup and SceneReferenceBinding structures", () => {
      const group: ReferenceGroup = {
        id: "group-1" as ReferenceGroupId,
        clientId: "client-a",
        name: "Brand Assets 2026",
        description: "Official logos and color cards",
        createdAt: "2026-09-24T00:00:00.000Z"
      };
      expect(group.id).toBe("group-1");
      expect(group.clientId).toBe("client-a");

      const binding: SceneReferenceBinding = {
        sceneId: "scene-1" as SceneId,
        specRevision: 2,
        referenceAssetId: "asset-1" as ReferenceAssetId,
        role: "subject_identity",
        weight: 0.85,
        hints: { boundingBox: [0, 0, 100, 100] }
      };
      expect(binding.role).toBe("subject_identity");
      expect(binding.weight).toBe(0.85);
      expect(binding.specRevision).toBe(2);
    });
  });
});
