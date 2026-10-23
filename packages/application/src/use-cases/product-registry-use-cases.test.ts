import { describe, expect, it, vi } from "vitest";
import {
  AppendBatchFactsUseCase,
  ArchiveProductBatchUseCase,
  ArchiveProductSkuUseCase,
  CreateProductBatchUseCase,
  CreateProductSkuUseCase,
  GetBatchFactsHistoryUseCase,
  GetProductBatchUseCase,
  GetProductSkuUseCase,
  ListProductBatchesUseCase,
  ListProductSkusUseCase,
  UpdateProductBatchMetadataUseCase,
  UpdateProductSkuMetadataUseCase
} from "./product-registry-use-cases.js";
import {
  createActionId,
  createBatchId,
  createClientId,
  createSkuId,
  ProductValidationError,
  type ClientId,
  type EvidenceId,
  type ProductSku,
  type SkuId
} from "@cco/domain";
import type { BatchOriginKind } from "@cco/shared";
import type {
  CommandEnvelope,
  ProductBatchArchiveResult,
  ProductBatchUpdateResult,
  ProductEvidenceRepositoryPort,
  ProductSkuArchiveResult,
  ProductSkuUpdateResult,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";

describe("Product registry use cases unit tests", () => {
  const clientA = createClientId("018f0000-0000-7000-8000-000000000001");
  const action1 = createActionId("018f0000-0001-7000-8000-000000000001");
  const actor = "qa@example.com";
  const timestamp = "2026-10-19T10:00:00.000Z";

  function createMockUow(mockRepo?: Partial<ProductEvidenceRepositoryPort>): UnitOfWork {
    return {
      execute: async <T>(work: (context: UnitOfWorkContext) => Promise<T>): Promise<T> => {
        const context = {
          productEvidence: mockRepo as ProductEvidenceRepositoryPort | undefined
        } as unknown as UnitOfWorkContext;
        return work(context);
      }
    };
  }

  it("CreateProductSkuUseCase: validates envelope, rejects non-UUIDv7 actionId", async () => {
    const uow = createMockUow({});
    const useCase = new CreateProductSkuUseCase(uow);

    await expect(
      useCase.execute({
        actionId: createActionId("a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d"), // UUIDv4
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("CreateProductSkuUseCase: fails with descriptive error if productEvidence capability is missing from context", async () => {
    const uow: UnitOfWork = {
      execute: async (work) => work({} as UnitOfWorkContext)
    };
    const useCase = new CreateProductSkuUseCase(uow);

    await expect(
      useCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      })
    ).rejects.toThrow(/UnitOfWorkContext\.productEvidence is not configured/);
  });

  it("CreateProductSkuUseCase: delegates validated command to repository", async () => {
    const mockCreatedSku: ProductSku = {
      clientId: clientA,
      skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
      canonicalSku: "SKU-TEST-01",
      displayName: "Test SKU",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null
    };

    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
      createSku: vi.fn().mockResolvedValue(mockCreatedSku)
    };

    const uow = createMockUow(mockRepo);
    const useCase = new CreateProductSkuUseCase(uow);

    const result = await useCase.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        canonicalSku: "SKU-TEST-01",
        displayName: "Test SKU"
      }
    });

    expect(result).toBe(mockCreatedSku);
    expect(mockRepo.createSku).toHaveBeenCalledTimes(1);
  });

  it("CreateProductBatchUseCase: accepts valid origin evidence links and delegates to repository", async () => {
    const mockBatch = {
      batch: {
        clientId: clientA,
        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
        skuId: createSkuId("018f0000-0002-7000-8000-000000000002"),
        lotIdentifier: "LOT-01",
        displayName: "Lot 01",
        version: 1,
        currentFactsRevision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: null
      },
      facts: null
    };
    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
      createBatch: vi.fn().mockResolvedValue(mockBatch)
    };
    const uow = createMockUow(mockRepo);
    const useCase = new CreateProductBatchUseCase(uow);

    const result = await useCase.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
        lotIdentifier: "LOT-01",
        displayName: "Lot 01",
        initialFacts: {
          originKind: "unknown",
          originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
          originEvidenceRevision: 1
        }
      }
    });
    expect(result).toBe(mockBatch);
    expect(mockRepo.createBatch).toHaveBeenCalledTimes(1);
  });

  it("AppendBatchFactsUseCase: accepts valid origin evidence references and delegates to repository", async () => {
    const mockFacts = {
      clientId: clientA,
      batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
      revision: 2,
      originKind: "own_production",
      producerIdentityAsClaimed: "Farm",
      productionStartDate: "2026-03-01",
      productionEndDate: "2026-03-10",
      originEvidenceId: "018f0000-0003-7000-8000-000000000001",
      originEvidenceRevision: 1,
      assertedBy: actor,
      assertedAt: timestamp,
      supersedesRevision: 1
    };
    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
      appendBatchFacts: vi.fn().mockResolvedValue(mockFacts)
    };
    const uow = createMockUow(mockRepo);
    const useCase = new AppendBatchFactsUseCase(uow);

    const result = await useCase.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
        expectedVersion: 1,
        originKind: "own_production",
        producerIdentityAsClaimed: "Farm",
        productionStartDate: "2026-03-01",
        productionEndDate: "2026-03-10",
        originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
        originEvidenceRevision: 1
      }
    });
    expect(result).toBe(mockFacts);
    expect(mockRepo.appendBatchFacts).toHaveBeenCalledTimes(1);
  });

  it("UpdateProductSkuMetadataUseCase and UpdateProductBatchMetadataUseCase delegate through UoW", async () => {
    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
      updateSkuMetadata: vi.fn().mockResolvedValue({} as unknown as ProductSkuUpdateResult),
      updateBatchMetadata: vi.fn().mockResolvedValue({} as unknown as ProductBatchUpdateResult)
    };
    const uow = createMockUow(mockRepo);

    const updateSku = new UpdateProductSkuMetadataUseCase(uow);
    await updateSku.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
        expectedVersion: 1,
        displayName: "Updated SKU"
      }
    });
    expect(mockRepo.updateSkuMetadata).toHaveBeenCalledTimes(1);

    const updateBatch = new UpdateProductBatchMetadataUseCase(uow);
    await updateBatch.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
        expectedVersion: 1,
        displayName: "Updated Batch"
      }
    });
    expect(mockRepo.updateBatchMetadata).toHaveBeenCalledTimes(1);
  });

  it("ArchiveProductSkuUseCase and ArchiveProductBatchUseCase delegate through UoW", async () => {
    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
      archiveSku: vi.fn().mockResolvedValue({} as unknown as ProductSkuArchiveResult),
      archiveBatch: vi.fn().mockResolvedValue({} as unknown as ProductBatchArchiveResult)
    };
    const uow = createMockUow(mockRepo);

    const archiveSku = new ArchiveProductSkuUseCase(uow);
    await archiveSku.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
        expectedVersion: 1
      }
    });
    expect(mockRepo.archiveSku).toHaveBeenCalledTimes(1);

    const archiveBatch = new ArchiveProductBatchUseCase(uow);
    await archiveBatch.execute({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp,
      payload: {
        batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
        expectedVersion: 1
      }
    });
    expect(mockRepo.archiveBatch).toHaveBeenCalledTimes(1);
  });

  it("Query use cases delegate to repository methods directly", async () => {
    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {
      getSkuById: vi.fn().mockResolvedValue(null),
      listSkus: vi.fn().mockResolvedValue([]),
      getBatchById: vi.fn().mockResolvedValue(null),
      getBatchHistory: vi.fn().mockResolvedValue([]),
      listBatches: vi.fn().mockResolvedValue([])
    };

    const getSku = new GetProductSkuUseCase(mockRepo as ProductEvidenceRepositoryPort);
    await getSku.execute(clientA, createSkuId("018f0000-0002-7000-8000-000000000001"));
    expect(mockRepo.getSkuById).toHaveBeenCalledTimes(1);

    const listSkus = new ListProductSkusUseCase(mockRepo as ProductEvidenceRepositoryPort);
    await listSkus.execute(clientA, { includeArchived: true });
    expect(mockRepo.listSkus).toHaveBeenCalledTimes(1);

    const getBatch = new GetProductBatchUseCase(mockRepo as ProductEvidenceRepositoryPort);
    await getBatch.execute(clientA, createBatchId("018f0000-0002-7000-8000-000000000001"));
    expect(mockRepo.getBatchById).toHaveBeenCalledTimes(1);

    const getHistory = new GetBatchFactsHistoryUseCase(mockRepo as ProductEvidenceRepositoryPort);
    await getHistory.execute(clientA, createBatchId("018f0000-0002-7000-8000-000000000001"));
    expect(mockRepo.getBatchHistory).toHaveBeenCalledTimes(1);

    const listBatches = new ListProductBatchesUseCase(mockRepo as ProductEvidenceRepositoryPort);
    await listBatches.execute(clientA, { includeArchived: false });
    expect(mockRepo.listBatches).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown keys on CommandEnvelope and command payloads", async () => {
    const uow = createMockUow({});
    const createSkuUseCase = new CreateProductSkuUseCase(uow);

    // Unknown key on envelope
    await expect(
      createSkuUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        extraAuthorityField: "spoof",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      } as unknown as CommandEnvelope<{ canonicalSku: string; displayName: string }>)
    ).rejects.toThrow(ProductValidationError);

    // Injected actorId/clientId/timestamp on payload
    await expect(
      createSkuUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test",
          clientId: "spoof-client",
          actorId: "spoof-actor"
        } as unknown as { canonicalSku: string; displayName: string }
      })
    ).rejects.toThrow(ProductValidationError);

    const createBatchUseCase = new CreateProductBatchUseCase(uow);
    // Unknown key on createBatch payload
    await expect(
      createBatchUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
          lotIdentifier: "LOT-01",
          displayName: "Batch 1",
          extraField: "invalid"
        } as unknown as { skuId: SkuId; lotIdentifier: string; displayName: string }
      })
    ).rejects.toThrow(ProductValidationError);

    // Unknown key on initialFacts
    await expect(
      createBatchUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
          lotIdentifier: "LOT-01",
          displayName: "Batch 1",
          initialFacts: {
            originKind: "unknown",
            spoofedKey: "invalid"
          } as unknown as { originKind: BatchOriginKind }
        }
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects non-null originEvidenceRevision when originEvidenceId is null or omitted", async () => {
    const uow = createMockUow({});
    const createBatchUseCase = new CreateProductBatchUseCase(uow);

    try {
      await createBatchUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
          lotIdentifier: "LOT-01",
          displayName: "Batch 1",
          initialFacts: {
            originKind: "unknown",
            originEvidenceRevision: 5
          }
        }
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProductValidationError);
      expect((err as ProductValidationError).issues[0]?.path).toEqual([
        "initialFacts",
        "originEvidenceRevision"
      ]);
    }

    const appendFactsUseCase = new AppendBatchFactsUseCase(uow);
    try {
      await appendFactsUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
          expectedVersion: 1,
          originKind: "unknown",
          originEvidenceId: null,
          originEvidenceRevision: 3,
          producerIdentityAsClaimed: null,
          productionStartDate: null,
          productionEndDate: null
        }
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProductValidationError);
      expect((err as ProductValidationError).issues[0]?.path).toEqual(["originEvidenceRevision"]);
    }

    try {
      await appendFactsUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
          expectedVersion: 1,
          originKind: "unknown",
          originEvidenceId: "018f0000-0003-7000-8000-000000000001" as unknown as EvidenceId,
          originEvidenceRevision: null,
          producerIdentityAsClaimed: null,
          productionStartDate: null,
          productionEndDate: null
        }
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProductValidationError);
      expect((err as ProductValidationError).issues[0]?.path).toEqual(["originEvidenceId"]);
    }
  });

  it("validates facts fields and date ordering", async () => {
    const uow = createMockUow({});
    const appendFactsUseCase = new AppendBatchFactsUseCase(uow);

    // Invalid originKind
    await expect(
      appendFactsUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
          expectedVersion: 1,
          originKind: "alien_origin" as unknown as BatchOriginKind,
          originEvidenceId: null,
          originEvidenceRevision: null,
          producerIdentityAsClaimed: null,
          productionStartDate: null,
          productionEndDate: null
        }
      })
    ).rejects.toThrow(ProductValidationError);

    // Invalid productionStartDate
    await expect(
      appendFactsUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
          expectedVersion: 1,
          originKind: "unknown",
          originEvidenceId: null,
          originEvidenceRevision: null,
          producerIdentityAsClaimed: null,
          productionStartDate: "not-a-date",
          productionEndDate: null
        }
      })
    ).rejects.toThrow(ProductValidationError);

    // Start date > end date
    await expect(
      appendFactsUseCase.execute({
        actionId: action1,
        clientId: clientA,
        actorId: actor,
        timestamp,
        payload: {
          batchId: createBatchId("018f0000-0002-7000-8000-000000000001"),
          expectedVersion: 1,
          originKind: "unknown",
          originEvidenceId: null,
          originEvidenceRevision: null,
          producerIdentityAsClaimed: null,
          productionStartDate: "2026-05-10",
          productionEndDate: "2026-05-01"
        }
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects non-positive or non-integer expectedVersion with ProductValidationError", async () => {
    const uow = createMockUow({});
    const updateSku = new UpdateProductSkuMetadataUseCase(uow);

    for (const invalidVer of [0, -1, 1.5, NaN]) {
      await expect(
        updateSku.execute({
          actionId: action1,
          clientId: clientA,
          actorId: actor,
          timestamp,
          payload: {
            skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
            expectedVersion: invalidVer,
            displayName: "Test"
          }
        })
      ).rejects.toThrow(ProductValidationError);
    }
  });

  it("validates UUIDs in query use cases", async () => {
    const mockRepo: Partial<ProductEvidenceRepositoryPort> = {};
    const getSku = new GetProductSkuUseCase(mockRepo as ProductEvidenceRepositoryPort);

    await expect(
      getSku.execute(
        "not-a-uuid" as unknown as ClientId,
        createSkuId("018f0000-0002-7000-8000-000000000001")
      )
    ).rejects.toThrow(ProductValidationError);
    await expect(getSku.execute(clientA, "not-a-uuid" as unknown as SkuId)).rejects.toThrow(
      ProductValidationError
    );
  });
});
