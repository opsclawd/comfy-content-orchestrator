import { describe, expect, it } from "vitest";
import {
  ArchiveSkuRequestSchema,
  CreateSkuRequestSchema,
  ProductSkuListResponseSchema,
  ProductSkuResponseSchema,
  UpdateSkuMetadataRequestSchema
} from "./product-sku.js";

describe("ProductSku Wire Contracts", () => {
  const validActionId = "018f0000-0000-7000-8000-000000000001";
  const validClientId = "018f0000-0000-7000-8000-000000000002";
  const validSkuId = "018f0000-0001-7000-8000-000000000001";

  describe("CreateSkuRequestSchema", () => {
    it("accepts valid create payload", () => {
      const valid = {
        actionId: validActionId,
        canonicalSku: "SKU-AURORA-INDICA-01",
        displayName: "Aurora Indica 3.5g"
      };
      expect(CreateSkuRequestSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects illegal SKU characters or controls", () => {
      const invalid = {
        actionId: validActionId,
        canonicalSku: "SKU/INVALID/01",
        displayName: "Name"
      };
      expect(CreateSkuRequestSchema.safeParse(invalid).success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const withUnknown = {
        actionId: validActionId,
        canonicalSku: "SKU-01",
        displayName: "Name",
        version: 5,
        clientId: validClientId
      };
      expect(CreateSkuRequestSchema.safeParse(withUnknown).success).toBe(false);
    });
  });

  describe("UpdateSkuMetadataRequestSchema", () => {
    it("accepts valid expectedVersion and displayName", () => {
      const valid = {
        actionId: validActionId,
        expectedVersion: 1,
        displayName: "Updated Display Name"
      };
      expect(UpdateSkuMetadataRequestSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects attempt to alter canonicalSku or clientId via metadata update", () => {
      const invalid = {
        actionId: validActionId,
        expectedVersion: 1,
        displayName: "New Name",
        canonicalSku: "ATTEMPTED-REWRITE"
      };
      expect(UpdateSkuMetadataRequestSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("ArchiveSkuRequestSchema", () => {
    it("accepts valid archive payload", () => {
      const valid = {
        actionId: validActionId,
        expectedVersion: 2
      };
      expect(ArchiveSkuRequestSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("ProductSkuResponseSchema and allowlist safety", () => {
    it("serializes valid SKU response with explicit null archivedAt", () => {
      const response = {
        clientId: validClientId,
        skuId: validSkuId,
        canonicalSku: "SKU-INDICA-01",
        displayName: "Aurora Indica 3.5g",
        version: 1,
        createdAt: "2026-10-19T17:00:00.000Z",
        updatedAt: "2026-10-19T17:00:00.000Z",
        archivedAt: null
      };

      const parsed = ProductSkuResponseSchema.safeParse(response);
      expect(parsed.success).toBe(true);
      expect(JSON.parse(JSON.stringify(response))).toEqual(response);
    });

    it("rejects missing archivedAt field (must be explicitly null)", () => {
      const missingNull = {
        clientId: validClientId,
        skuId: validSkuId,
        canonicalSku: "SKU-INDICA-01",
        displayName: "Aurora Indica 3.5g",
        version: 1,
        createdAt: "2026-10-19T17:00:00.000Z",
        updatedAt: "2026-10-19T17:00:00.000Z"
      };

      expect(ProductSkuResponseSchema.safeParse(missingNull).success).toBe(false);
    });

    it("rejects injected storage keys and private fields", () => {
      const withStorage = {
        clientId: validClientId,
        skuId: validSkuId,
        canonicalSku: "SKU-INDICA-01",
        displayName: "Aurora Indica 3.5g",
        version: 1,
        createdAt: "2026-10-19T17:00:00.000Z",
        updatedAt: "2026-10-19T17:00:00.000Z",
        archivedAt: null,
        storageBucket: "unsafe-bucket",
        storageObjectKey: "unsafe-key",
        presignedUrl: "https://secret.s3.amazonaws.com/xyz"
      };

      expect(ProductSkuResponseSchema.safeParse(withStorage).success).toBe(false);
    });

    it("validates ProductSkuListResponseSchema", () => {
      const list = {
        skus: [
          {
            clientId: validClientId,
            skuId: validSkuId,
            canonicalSku: "SKU-INDICA-01",
            displayName: "Aurora Indica 3.5g",
            version: 1,
            createdAt: "2026-10-19T17:00:00.000Z",
            updatedAt: "2026-10-19T17:00:00.000Z",
            archivedAt: null
          }
        ]
      };
      expect(ProductSkuListResponseSchema.safeParse(list).success).toBe(true);
    });
  });
});
