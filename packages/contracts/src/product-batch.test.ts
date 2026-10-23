import { describe, expect, it } from "vitest";
import {
  AppendBatchFactsRequestSchema,
  ArchiveBatchRequestSchema,
  BatchFactsRevisionResponseSchema,
  CreateBatchRequestSchema,
  InitialBatchFactsInputSchema,
  ProductBatchCreationResultResponseSchema,
  ProductBatchHistoryResponseSchema,
  ProductBatchListResponseSchema,
  ProductBatchResponseSchema,
  UpdateBatchMetadataRequestSchema
} from "./product-batch.js";

describe("ProductBatch Wire Contracts", () => {
  const validActionId = "018f0000-0000-7000-8000-000000000001";
  const validClientId = "018f0000-0000-7000-8000-000000000002";
  const validSkuId = "018f0000-0001-7000-8000-000000000001";
  const validBatchId = "018f0000-0002-7000-8000-000000000001";
  const validEvidenceId = "018f0000-0007-7000-8000-000000000001";

  describe("InitialBatchFactsInputSchema", () => {
    it("accepts valid initial facts input with own_production", () => {
      const valid = {
        originKind: "own_production",
        producerIdentityAsClaimed: "Internal Greenhouse #2",
        productionStartDate: "2026-05-01",
        productionEndDate: "2026-05-15",
        originEvidenceId: validEvidenceId,
        originEvidenceRevision: 1
      };
      expect(InitialBatchFactsInputSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects unpaired originEvidenceId and originEvidenceRevision", () => {
      const missingRev = {
        originKind: "own_production",
        originEvidenceId: validEvidenceId
      };
      expect(InitialBatchFactsInputSchema.safeParse(missingRev).success).toBe(false);

      const missingId = {
        originKind: "own_production",
        originEvidenceRevision: 1
      };
      expect(InitialBatchFactsInputSchema.safeParse(missingId).success).toBe(false);
    });

    it("rejects inverted date ordering", () => {
      const invertedDates = {
        originKind: "own_production",
        productionStartDate: "2026-06-01",
        productionEndDate: "2026-05-01"
      };
      expect(InitialBatchFactsInputSchema.safeParse(invertedDates).success).toBe(false);
    });
  });

  describe("CreateBatchRequestSchema", () => {
    it("accepts valid batch creation payload", () => {
      const valid = {
        actionId: validActionId,
        skuId: validSkuId,
        lotIdentifier: "LOT-2026-IND-042",
        displayName: "Batch 042 Harvest",
        initialFacts: {
          originKind: "partner_origin",
          producerIdentityAsClaimed: "Partner Grower Inc."
        }
      };
      expect(CreateBatchRequestSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects unknown keys at root", () => {
      const withUnknown = {
        actionId: validActionId,
        skuId: validSkuId,
        lotIdentifier: "LOT-042",
        displayName: "Batch",
        unexpectedKey: "malicious"
      };
      expect(CreateBatchRequestSchema.safeParse(withUnknown).success).toBe(false);
    });
  });

  describe("AppendBatchFactsRequestSchema", () => {
    it("accepts valid append payload with expectedVersion", () => {
      const valid = {
        actionId: validActionId,
        expectedVersion: 1,
        originKind: "own_production",
        producerIdentityAsClaimed: "Acme Cultivation",
        productionStartDate: "2026-01-01",
        productionEndDate: "2026-01-10",
        originEvidenceId: null,
        originEvidenceRevision: null
      };
      expect(AppendBatchFactsRequestSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("UpdateBatchMetadataRequestSchema and ArchiveBatchRequestSchema", () => {
    it("validates update metadata request", () => {
      const valid = {
        actionId: validActionId,
        expectedVersion: 2,
        displayName: "New Display Name"
      };
      expect(UpdateBatchMetadataRequestSchema.safeParse(valid).success).toBe(true);
    });

    it("validates archive batch request", () => {
      const valid = {
        actionId: validActionId,
        expectedVersion: 3
      };
      expect(ArchiveBatchRequestSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("Response serialization and allowlist safety", () => {
    it("serializes ProductBatchResponse with explicit null archivedAt", () => {
      const response = {
        clientId: validClientId,
        batchId: validBatchId,
        skuId: validSkuId,
        lotIdentifier: "LOT-2026-IND-042",
        displayName: "Harvest 42",
        version: 1,
        currentFactsRevision: 1,
        createdAt: "2026-10-19T17:00:00.000Z",
        updatedAt: "2026-10-19T17:00:00.000Z",
        archivedAt: null
      };

      expect(ProductBatchResponseSchema.safeParse(response).success).toBe(true);
    });

    it("rejects injected storage keys in batch and facts responses", () => {
      const injectedBatch = {
        clientId: validClientId,
        batchId: validBatchId,
        skuId: validSkuId,
        lotIdentifier: "LOT-042",
        displayName: "Harvest",
        version: 1,
        currentFactsRevision: 1,
        createdAt: "2026-10-19T17:00:00.000Z",
        updatedAt: "2026-10-19T17:00:00.000Z",
        archivedAt: null,
        storageBucket: "secret",
        storageObjectKey: "secret/file"
      };

      expect(ProductBatchResponseSchema.safeParse(injectedBatch).success).toBe(false);

      const injectedFacts = {
        clientId: validClientId,
        batchId: validBatchId,
        revision: 1,
        originKind: "unknown",
        producerIdentityAsClaimed: null,
        productionStartDate: null,
        productionEndDate: null,
        originEvidenceId: null,
        originEvidenceRevision: null,
        assertedBy: "admin",
        assertedAt: "2026-10-19T17:00:00.000Z",
        supersedesRevision: null,
        rawS3Url: "https://s3.amazonaws.com/private"
      };

      expect(BatchFactsRevisionResponseSchema.safeParse(injectedFacts).success).toBe(false);
    });

    it("validates ProductBatchCreationResultResponseSchema", () => {
      const creationResult = {
        batch: {
          clientId: validClientId,
          batchId: validBatchId,
          skuId: validSkuId,
          lotIdentifier: "LOT-2026-IND-042",
          displayName: "Harvest 42",
          version: 1,
          currentFactsRevision: 1,
          createdAt: "2026-10-19T17:00:00.000Z",
          updatedAt: "2026-10-19T17:00:00.000Z",
          archivedAt: null
        },
        initialFacts: {
          clientId: validClientId,
          batchId: validBatchId,
          revision: 1,
          originKind: "unknown",
          producerIdentityAsClaimed: null,
          productionStartDate: null,
          productionEndDate: null,
          originEvidenceId: null,
          originEvidenceRevision: null,
          assertedBy: "tech@example.com",
          assertedAt: "2026-10-19T17:00:00.000Z",
          supersedesRevision: null
        }
      };

      expect(ProductBatchCreationResultResponseSchema.safeParse(creationResult).success).toBe(true);
    });

    it("validates ProductBatchListResponseSchema and HistoryResponseSchema", () => {
      const list = {
        batches: [
          {
            clientId: validClientId,
            batchId: validBatchId,
            skuId: validSkuId,
            lotIdentifier: "LOT-042",
            displayName: "Harvest",
            version: 1,
            currentFactsRevision: 1,
            createdAt: "2026-10-19T17:00:00.000Z",
            updatedAt: "2026-10-19T17:00:00.000Z",
            archivedAt: null
          }
        ]
      };
      expect(ProductBatchListResponseSchema.safeParse(list).success).toBe(true);

      const history = {
        revisions: [
          {
            clientId: validClientId,
            batchId: validBatchId,
            revision: 1,
            originKind: "unknown",
            producerIdentityAsClaimed: null,
            productionStartDate: null,
            productionEndDate: null,
            originEvidenceId: null,
            originEvidenceRevision: null,
            assertedBy: "admin",
            assertedAt: "2026-10-19T17:00:00.000Z",
            supersedesRevision: null
          }
        ]
      };
      expect(ProductBatchHistoryResponseSchema.safeParse(history).success).toBe(true);
    });
  });
});
