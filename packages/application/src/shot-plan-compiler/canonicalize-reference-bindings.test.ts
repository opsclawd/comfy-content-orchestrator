import { describe, expect, it } from "vitest";
import {
  canonicalizeReferenceBindings,
  ReferenceCanonicalizationError,
  type ReferenceAssetLike,
  type ReferenceBindingLike
} from "./canonicalize-reference-bindings.js";

function makeAsset(id: string, overrides: Partial<ReferenceAssetLike> = {}): ReferenceAssetLike {
  return {
    id,
    clientId: "client-001",
    storageBucket: "cco-test",
    storageObjectKey: `refs/${id}.png`,
    contentHashSha256: `hash-${id}`.padEnd(64, "0"),
    mimeType: "image/png",
    assetType: "reference_image",
    ...overrides
  };
}

describe("canonicalizeReferenceBindings", () => {
  it("enforces canonical role priority ordering", () => {
    // Priority order: subject_identity (0) < product (1) < location (2) < style (3) < composition (4)
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-comp", role: "composition" },
      { referenceAssetId: "asset-sub", role: "subject_identity" },
      { referenceAssetId: "asset-style", role: "style" },
      { referenceAssetId: "asset-prod", role: "product" },
      { referenceAssetId: "asset-loc", role: "location" }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([
      ["asset-comp", makeAsset("asset-comp")],
      ["asset-sub", makeAsset("asset-sub")],
      ["asset-style", makeAsset("asset-style")],
      ["asset-prod", makeAsset("asset-prod")],
      ["asset-loc", makeAsset("asset-loc")]
    ]);

    const result = canonicalizeReferenceBindings({ bindings, assetsById });

    expect(result).toHaveLength(5);
    expect(result.map((r) => r.role)).toEqual([
      "subject_identity",
      "product",
      "location",
      "style",
      "composition"
    ]);

    // Check slot indices and prompt tags
    expect(result[0]!.slotIndex).toBe(1);
    expect(result[0]!.promptTag).toBe("<Picture 1>");
    expect(result[4]!.slotIndex).toBe(5);
    expect(result[4]!.promptTag).toBe("<Picture 5>");
  });

  it("sorts by ascending referenceAssetId in Unicode code-point order within the same role", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-c", role: "subject_identity" },
      { referenceAssetId: "asset-a", role: "subject_identity" },
      { referenceAssetId: "asset-B", role: "subject_identity" }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([
      ["asset-c", makeAsset("asset-c")],
      ["asset-a", makeAsset("asset-a")],
      ["asset-b", makeAsset("asset-B")]
    ]);

    const result = canonicalizeReferenceBindings({ bindings, assetsById });

    // In canonical lowercase UUID comparison: asset-a < asset-b < asset-c
    expect(result.map((r) => r.referenceAssetId)).toEqual(["asset-a", "asset-B", "asset-c"]);
  });

  it("filters out archived bindings", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-1", role: "subject_identity" },
      { referenceAssetId: "asset-2", role: "style", archivedAt: "2026-09-20T00:00:00Z" }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([
      ["asset-1", makeAsset("asset-1")],
      ["asset-2", makeAsset("asset-2")]
    ]);

    const result = canonicalizeReferenceBindings({ bindings, assetsById });
    expect(result).toHaveLength(1);
    expect(result[0]!.referenceAssetId).toBe("asset-1");
  });

  it("throws REFERENCE_LIMIT_EXCEEDED when active bindings exceed 9", () => {
    const bindings: ReferenceBindingLike[] = Array.from({ length: 10 }, (_, i) => ({
      referenceAssetId: `asset-${i}`,
      role: "subject_identity"
    }));

    const assetsById = new Map<string, ReferenceAssetLike>(
      Array.from({ length: 10 }, (_, i) => [`asset-${i}`, makeAsset(`asset-${i}`)])
    );

    expect(() => canonicalizeReferenceBindings({ bindings, assetsById })).toThrow(
      ReferenceCanonicalizationError
    );
    try {
      canonicalizeReferenceBindings({ bindings, assetsById });
    } catch (err) {
      expect((err as ReferenceCanonicalizationError).code).toBe("REFERENCE_LIMIT_EXCEEDED");
    }
  });

  it("throws DUPLICATE_REFERENCE_BINDING when identical (role, referenceAssetId) pairs exist", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-1", role: "subject_identity" },
      { referenceAssetId: "asset-1", role: "subject_identity" }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([["asset-1", makeAsset("asset-1")]]);

    expect(() => canonicalizeReferenceBindings({ bindings, assetsById })).toThrow(
      ReferenceCanonicalizationError
    );
    try {
      canonicalizeReferenceBindings({ bindings, assetsById });
    } catch (err) {
      expect((err as ReferenceCanonicalizationError).code).toBe("DUPLICATE_REFERENCE_BINDING");
    }
  });

  it("throws UNSUPPORTED_REFERENCE_WEIGHT when weight is defined and not 1", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-1", role: "subject_identity", weight: 0.8 }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([["asset-1", makeAsset("asset-1")]]);

    expect(() => canonicalizeReferenceBindings({ bindings, assetsById })).toThrow(
      ReferenceCanonicalizationError
    );
    try {
      canonicalizeReferenceBindings({ bindings, assetsById });
    } catch (err) {
      expect((err as ReferenceCanonicalizationError).code).toBe("UNSUPPORTED_REFERENCE_WEIGHT");
    }
  });

  it("throws UNSUPPORTED_REFERENCE_HINTS when hints are provided", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-1", role: "subject_identity", hints: { crop: "square" } }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([["asset-1", makeAsset("asset-1")]]);

    expect(() => canonicalizeReferenceBindings({ bindings, assetsById })).toThrow(
      ReferenceCanonicalizationError
    );
    try {
      canonicalizeReferenceBindings({ bindings, assetsById });
    } catch (err) {
      expect((err as ReferenceCanonicalizationError).code).toBe("UNSUPPORTED_REFERENCE_HINTS");
    }
  });

  it("throws UNSUPPORTED_REFERENCE_MEDIA when asset is not an image", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-video", role: "subject_identity" }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>([
      ["asset-video", makeAsset("asset-video", { mimeType: "video/mp4", assetType: "video" })]
    ]);

    expect(() => canonicalizeReferenceBindings({ bindings, assetsById })).toThrow(
      ReferenceCanonicalizationError
    );
    try {
      canonicalizeReferenceBindings({ bindings, assetsById });
    } catch (err) {
      expect((err as ReferenceCanonicalizationError).code).toBe("UNSUPPORTED_REFERENCE_MEDIA");
    }
  });

  it("throws REFERENCE_ASSET_NOT_FOUND when bound asset is missing from map", () => {
    const bindings: ReferenceBindingLike[] = [
      { referenceAssetId: "asset-missing", role: "subject_identity" }
    ];

    const assetsById = new Map<string, ReferenceAssetLike>();

    expect(() => canonicalizeReferenceBindings({ bindings, assetsById })).toThrow(
      ReferenceCanonicalizationError
    );
    try {
      canonicalizeReferenceBindings({ bindings, assetsById });
    } catch (err) {
      expect((err as ReferenceCanonicalizationError).code).toBe("REFERENCE_ASSET_NOT_FOUND");
    }
  });

  it("handles zero references deterministically", () => {
    const result = canonicalizeReferenceBindings({ bindings: [], assetsById: new Map() });
    expect(result).toEqual([]);
  });
});
