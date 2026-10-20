import { describe, expect, it } from "vitest";
import { createClientId, createSkuId } from "./identifiers.js";
import {
  AccessDeniedError,
  CrossClientViolationError,
  DuplicateSkuError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";
import {
  archiveProductSku,
  assertNoSkuCollision,
  assertSkuCanAcceptBatch,
  createProductSku,
  rehydrateProductSku,
  updateProductSkuMetadata,
  type ProductSku
} from "./product-sku.js";

describe("ProductSku domain model", () => {
  const clientA = createClientId("018f0000-0000-7000-8000-000000000001");
  const clientB = createClientId("018f0000-0000-7000-8000-000000000002");
  const skuId1 = createSkuId("018f0000-0001-7000-8000-000000000001");
  const skuId2 = createSkuId("018f0000-0001-7000-8000-000000000002");
  const skuId3 = createSkuId("018f0000-0001-7000-8000-000000000003");
  const skuId4 = createSkuId("018f0000-0001-7000-8000-000000000004");
  const timestamp1 = "2026-10-19T10:00:00.000Z";
  const timestamp2 = "2026-10-19T11:00:00.000Z";
  const timestamp3 = "2026-10-19T12:00:00.000Z";

  describe("Creation and rehydration", () => {
    it("creates active ProductSku at version 1 with matching timestamps", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "  sku-aurora-indica-01  ",
        displayName: "  Aurora Indica 3.5g  ",
        timestamp: timestamp1
      });

      expect(sku.clientId).toBe(clientA);
      expect(sku.skuId).toBe(skuId1);
      expect(sku.canonicalSku).toBe("SKU-AURORA-INDICA-01");
      expect(sku.displayName).toBe("Aurora Indica 3.5g");
      expect(sku.version).toBe(1);
      expect(sku.createdAt).toBe(timestamp1);
      expect(sku.updatedAt).toBe(timestamp1);
      expect(sku.archivedAt).toBeNull();
    });

    it("supports unbounded number of SKUs and neutral non-cannabis products", () => {
      // 4 distinct SKUs without hard-coded three-SKU ceiling
      const skuElectronics = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-HEADPHONES-PRO-X",
        displayName: "Studio Monitor Pro Headphones",
        timestamp: timestamp1
      });
      const skuCoffee = createProductSku({
        clientId: clientA,
        skuId: skuId2,
        canonicalSku: "SKU-COFFEE-YIRGACHEFFE-250G",
        displayName: "Ethiopia Yirgacheffe Washed 250g",
        timestamp: timestamp1
      });
      const skuMedical = createProductSku({
        clientId: clientA,
        skuId: skuId3,
        canonicalSku: "SKU-DIABETIC-TEST-50CT",
        displayName: "Blood Glucose Test Strips 50ct",
        timestamp: timestamp1
      });
      const skuApparel = createProductSku({
        clientId: clientA,
        skuId: skuId4,
        canonicalSku: "SKU-HOODIE-BLK-XL",
        displayName: "Organic Cotton Heavyweight Hoodie XL",
        timestamp: timestamp1
      });

      expect(skuElectronics.canonicalSku).toBe("SKU-HEADPHONES-PRO-X");
      expect(skuCoffee.canonicalSku).toBe("SKU-COFFEE-YIRGACHEFFE-250G");
      expect(skuMedical.canonicalSku).toBe("SKU-DIABETIC-TEST-50CT");
      expect(skuApparel.canonicalSku).toBe("SKU-HOODIE-BLK-XL");
    });

    it("rehydrates valid persisted SKU", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-100",
        displayName: "Item 100",
        timestamp: timestamp1
      });
      const rehydrated = rehydrateProductSku(sku);
      expect(rehydrated).toEqual(sku);
    });

    it("rejects invalid timestamps during rehydration", () => {
      const invalid = {
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-100",
        displayName: "Item 100",
        version: 1,
        createdAt: "2026-10-19T12:00:00.000Z",
        updatedAt: "2026-10-19T11:00:00.000Z", // updatedAt < createdAt
        archivedAt: null
      };
      expect(() => rehydrateProductSku(invalid as unknown as ProductSku)).toThrow(
        ProductValidationError
      );
    });
  });

  describe("Metadata mutation and revision fencing", () => {
    it("updates displayName, increments version, and records audit before/after", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Original Name",
        timestamp: timestamp1
      });

      const { previous, current } = updateProductSkuMetadata(sku, {
        expectedVersion: 1,
        displayName: "Updated Coffee Display Name",
        updatedAt: timestamp2
      });

      expect(previous.version).toBe(1);
      expect(previous.displayName).toBe("Original Name");
      expect(current.version).toBe(2);
      expect(current.displayName).toBe("Updated Coffee Display Name");
      expect(current.canonicalSku).toBe(sku.canonicalSku);
      expect(current.clientId).toBe(sku.clientId);
      expect(current.skuId).toBe(sku.skuId);
      expect(current.createdAt).toBe(timestamp1);
      expect(current.updatedAt).toBe(timestamp2);
    });

    it("increments version and is auditable even for same-name update", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Same Name",
        timestamp: timestamp1
      });

      const { previous, current } = updateProductSkuMetadata(sku, {
        expectedVersion: 1,
        displayName: "Same Name",
        updatedAt: timestamp2
      });

      expect(previous.version).toBe(1);
      expect(current.version).toBe(2);
      expect(current.displayName).toBe("Same Name");
    });

    it("fails with STALE_REVISION_CONFLICT if expectedVersion does not match", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Name",
        timestamp: timestamp1
      });

      expect(() =>
        updateProductSkuMetadata(sku, {
          expectedVersion: 99,
          displayName: "New Name",
          updatedAt: timestamp2
        })
      ).toThrow(StaleRevisionConflictError);
    });

    it("rejects update if updatedAt moves backwards", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Name",
        timestamp: timestamp2
      });

      expect(() =>
        updateProductSkuMetadata(sku, {
          expectedVersion: 1,
          displayName: "New Name",
          updatedAt: timestamp1 // earlier than timestamp2
        })
      ).toThrow(ProductValidationError);
    });
  });

  describe("Lifecycle and archive behavior", () => {
    it("archives SKU, increments version, and sets archivedAt", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Coffee",
        timestamp: timestamp1
      });

      const { previous, current } = archiveProductSku(sku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(previous.archivedAt).toBeNull();
      expect(current.archivedAt).toBe(timestamp2);
      expect(current.updatedAt).toBe(timestamp2);
      expect(current.version).toBe(2);
    });

    it("rejects re-archiving an already archived SKU", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Coffee",
        timestamp: timestamp1
      });
      const { current: archived } = archiveProductSku(sku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(() =>
        archiveProductSku(archived, {
          expectedVersion: 2,
          archivedAt: timestamp3
        })
      ).toThrow(AccessDeniedError);
    });

    it("rejects metadata mutation on archived SKU with ACCESS_DENIED", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Coffee",
        timestamp: timestamp1
      });
      const { current: archived } = archiveProductSku(sku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(() =>
        updateProductSkuMetadata(archived, {
          expectedVersion: 2,
          displayName: "Attempted Change",
          updatedAt: timestamp3
        })
      ).toThrow(AccessDeniedError);
    });

    it("assertSkuCanAcceptBatch rejects archived parent SKU", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Coffee",
        timestamp: timestamp1
      });
      const { current: archived } = archiveProductSku(sku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(() => assertSkuCanAcceptBatch(archived, clientA)).toThrow(AccessDeniedError);
    });

    it("assertSkuCanAcceptBatch rejects cross-client mismatch", () => {
      const sku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-COFFEE-01",
        displayName: "Coffee",
        timestamp: timestamp1
      });

      expect(() => assertSkuCanAcceptBatch(sku, clientB)).toThrow(CrossClientViolationError);
    });
  });

  describe("Collision guards and tenant isolation", () => {
    it("rejects duplicate canonicalSku for same client", () => {
      const existing = ["SKU-COFFEE-01", "SKU-COFFEE-02"];
      expect(() => assertNoSkuCollision("sku-coffee-01", existing, clientA)).toThrow(
        DuplicateSkuError
      );
    });

    it("allows different clients to reuse same canonicalSku code", () => {
      // In repository/domain logic, collision check is scoped per-client.
      // So existing array for client B is empty even if client A has it.
      const existingClientB: string[] = [];
      expect(() => assertNoSkuCollision("SKU-COFFEE-01", existingClientB, clientB)).not.toThrow();
    });

    it("preserves reservation for archived SKUs (cannot reuse archived SKU code)", () => {
      const archivedSku = createProductSku({
        clientId: clientA,
        skuId: skuId1,
        canonicalSku: "SKU-ARCHIVED-01",
        displayName: "Old Item",
        timestamp: timestamp1
      });
      const { current: archived } = archiveProductSku(archivedSku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      // existing includes archived records per ADR §2.1
      const existing = [archived];
      expect(() => assertNoSkuCollision("SKU-ARCHIVED-01", existing, clientA)).toThrow(
        DuplicateSkuError
      );
    });
  });
});
