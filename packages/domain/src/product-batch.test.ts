import { describe, expect, it } from "vitest";
import { appendBatchFactsRevision } from "./batch-facts.js";
import { createBatchId, createClientId, createSkuId } from "./identifiers.js";
import {
  applyBatchFactsAppend,
  archiveProductBatch,
  assertBatchSelectable,
  assertNoLotCollision,
  createProductBatch,
  isBatchSelectable,
  rehydrateProductBatch,
  updateProductBatchMetadata
} from "./product-batch.js";
import {
  AccessDeniedError,
  CrossBatchSourceError,
  CrossClientViolationError,
  DuplicateLotError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";
import { archiveProductSku, createProductSku } from "./product-sku.js";

describe("ProductBatch domain model", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const otherClientId = createClientId("018f0000-0000-7000-8000-000000000002");
  const skuId = createSkuId("018f0000-0001-7000-8000-000000000001");
  const otherSkuId = createSkuId("018f0000-0001-7000-8000-000000000002");
  const batchId1 = createBatchId("018f0000-0002-7000-8000-000000000001");
  const batchId2 = createBatchId("018f0000-0002-7000-8000-000000000002");
  const actor = "lab_tech@example.com";
  const timestamp1 = "2026-10-19T10:00:00.000Z";
  const timestamp2 = "2026-10-19T11:00:00.000Z";
  const timestamp3 = "2026-10-19T12:00:00.000Z";

  const parentSku = createProductSku({
    clientId,
    skuId,
    canonicalSku: "SKU-AURORA-INDICA-01",
    displayName: "Aurora Indica 3.5g",
    timestamp: timestamp1
  });

  describe("Creation and rehydration", () => {
    it("creates ProductBatch and initial facts at version 1 / facts revision 1", () => {
      const result = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "  LOT-2026-IND-042  ",
        displayName: "  Harvest 2026 Lot 42  ",
        actorId: actor,
        timestamp: timestamp1
      });

      const { batch, initialFacts } = result;

      expect(batch.clientId).toBe(clientId);
      expect(batch.skuId).toBe(skuId);
      expect(batch.batchId).toBe(batchId1);
      expect(batch.lotIdentifier).toBe("LOT-2026-IND-042");
      expect(batch.displayName).toBe("Harvest 2026 Lot 42");
      expect(batch.version).toBe(1);
      expect(batch.currentFactsRevision).toBe(1);
      expect(batch.createdAt).toBe(timestamp1);
      expect(batch.updatedAt).toBe(timestamp1);
      expect(batch.archivedAt).toBeNull();

      expect(initialFacts.clientId).toBe(clientId);
      expect(initialFacts.batchId).toBe(batchId1);
      expect(initialFacts.revision).toBe(1);
      expect(initialFacts.originKind).toBe("unknown");
    });

    it("rejects batch creation under an archived SKU", () => {
      const { current: archivedSku } = archiveProductSku(parentSku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(() =>
        createProductBatch({
          parentSku: archivedSku,
          batchId: batchId1,
          lotIdentifier: "LOT-001",
          displayName: "Batch 1",
          actorId: actor,
          timestamp: timestamp3
        })
      ).toThrow(AccessDeniedError);
    });

    it("supports multiple batches under a single SKU", () => {
      const b1 = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-2026-001",
        displayName: "Batch 1",
        actorId: actor,
        timestamp: timestamp1
      });
      const b2 = createProductBatch({
        parentSku,
        batchId: batchId2,
        lotIdentifier: "LOT-2026-002",
        displayName: "Batch 2",
        actorId: actor,
        timestamp: timestamp1
      });

      expect(b1.batch.batchId).not.toBe(b2.batch.batchId);
      expect(b1.batch.lotIdentifier).toBe("LOT-2026-001");
      expect(b2.batch.lotIdentifier).toBe("LOT-2026-002");
    });

    it("rehydrates valid batch record", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-2026-001",
        displayName: "Batch 1",
        actorId: actor,
        timestamp: timestamp1
      });

      const rehydrated = rehydrateProductBatch(batch);
      expect(rehydrated).toEqual(batch);
    });
  });

  describe("Metadata mutation and revision fencing", () => {
    it("updates displayName, increments version, and produces audit snapshots", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Old Batch Name",
        actorId: actor,
        timestamp: timestamp1
      });

      const { previous, current } = updateProductBatchMetadata(batch, {
        expectedVersion: 1,
        displayName: "New Batch Name",
        updatedAt: timestamp2
      });

      expect(previous.version).toBe(1);
      expect(previous.displayName).toBe("Old Batch Name");
      expect(current.version).toBe(2);
      expect(current.displayName).toBe("New Batch Name");
      expect(current.lotIdentifier).toBe("LOT-042");
      expect(current.batchId).toBe(batch.batchId);
      expect(current.skuId).toBe(batch.skuId);
      expect(current.clientId).toBe(batch.clientId);
      expect(current.createdAt).toBe(timestamp1);
      expect(current.updatedAt).toBe(timestamp2);
      expect(current.currentFactsRevision).toBe(1); // facts revision unchanged
    });

    it("rejects update on version mismatch", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      expect(() =>
        updateProductBatchMetadata(batch, {
          expectedVersion: 99,
          displayName: "New Name",
          updatedAt: timestamp2
        })
      ).toThrow(StaleRevisionConflictError);
    });

    it("rejects metadata mutation on archived batch", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });
      const { current: archived } = archiveProductBatch(batch, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(() =>
        updateProductBatchMetadata(archived, {
          expectedVersion: 2,
          displayName: "Change",
          updatedAt: timestamp3
        })
      ).toThrow(AccessDeniedError);
    });
  });

  describe("Applying facts append to batch head", () => {
    it("advances batch currentFactsRevision and increments batch version", () => {
      const { batch, initialFacts } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      const nextFacts = appendBatchFactsRevision(initialFacts, {
        originKind: "own_production",
        assertedBy: "qa@example.com",
        assertedAt: timestamp2
      });

      const { previous, current } = applyBatchFactsAppend(batch, initialFacts, nextFacts, 1);

      expect(previous.version).toBe(1);
      expect(previous.currentFactsRevision).toBe(1);
      expect(current.version).toBe(2);
      expect(current.currentFactsRevision).toBe(2);
      expect(current.updatedAt).toBe(timestamp2);
    });

    it("rejects facts append if expectedVersion does not match batch head", () => {
      const { batch, initialFacts } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      const nextFacts = appendBatchFactsRevision(initialFacts, {
        originKind: "own_production",
        assertedBy: "qa@example.com",
        assertedAt: timestamp2
      });

      expect(() => applyBatchFactsAppend(batch, initialFacts, nextFacts, 99)).toThrow(
        StaleRevisionConflictError
      );
    });
  });

  describe("Availability and Selection Guards", () => {
    it("reports active batch with active parent as selectable", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      expect(isBatchSelectable(batch, parentSku)).toBe(true);
      expect(() => assertBatchSelectable(batch, parentSku)).not.toThrow();
    });

    it("makes batch unselectable if parent SKU is archived", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      const { current: archivedParent } = archiveProductSku(parentSku, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(isBatchSelectable(batch, archivedParent)).toBe(false);
      expect(() => assertBatchSelectable(batch, archivedParent)).toThrow(AccessDeniedError);
    });

    it("makes batch unselectable if batch itself is archived", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      const { current: archivedBatch } = archiveProductBatch(batch, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      expect(isBatchSelectable(archivedBatch, parentSku)).toBe(false);
      expect(() => assertBatchSelectable(archivedBatch, parentSku)).toThrow(AccessDeniedError);
    });

    it("rejects cross-client or cross-SKU checks with domain errors", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-042",
        displayName: "Name",
        actorId: actor,
        timestamp: timestamp1
      });

      const otherSku = createProductSku({
        clientId,
        skuId: otherSkuId,
        canonicalSku: "SKU-OTHER-01",
        displayName: "Other",
        timestamp: timestamp1
      });

      const foreignSku = createProductSku({
        clientId: otherClientId,
        skuId,
        canonicalSku: "SKU-AURORA-INDICA-01",
        displayName: "Foreign",
        timestamp: timestamp1
      });

      expect(() => assertBatchSelectable(batch, otherSku)).toThrow(CrossBatchSourceError);
      expect(() => assertBatchSelectable(batch, foreignSku)).toThrow(CrossClientViolationError);
    });
  });

  describe("Lot Collision Guard and ADR Collision Policy", () => {
    it("rejects duplicate lot code for same client and same SKU", () => {
      const existingLots = ["LOT-2026-IND-042", "LOT-2026-IND-043"];
      expect(() => assertNoLotCollision("LOT-2026-IND-042", existingLots, skuId)).toThrow(
        DuplicateLotError
      );
    });

    it("allows case-distinct lots under the same SKU (case-sensitive)", () => {
      const existingLots = ["LOT-alpha"];
      expect(() => assertNoLotCollision("LOT-ALPHA", existingLots, skuId)).not.toThrow();
    });

    it("allows different SKUs or different clients to reuse lot codes safely", () => {
      // Different SKU has its own set of existing lots
      const existingOtherSku: string[] = [];
      expect(() =>
        assertNoLotCollision("LOT-2026-IND-042", existingOtherSku, otherSkuId)
      ).not.toThrow();
    });

    it("retains lot reservation for archived batches", () => {
      const { batch } = createProductBatch({
        parentSku,
        batchId: batchId1,
        lotIdentifier: "LOT-ARCHIVED-001",
        displayName: "Archived Batch",
        actorId: actor,
        timestamp: timestamp1
      });
      const { current: archivedBatch } = archiveProductBatch(batch, {
        expectedVersion: 1,
        archivedAt: timestamp2
      });

      // existing lots includes archived reservation
      const existing = [archivedBatch];
      expect(() => assertNoLotCollision("LOT-ARCHIVED-001", existing, skuId)).toThrow(
        DuplicateLotError
      );
    });
  });
});
