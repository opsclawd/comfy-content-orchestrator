import { describe, expect, it } from "vitest";
import { sortKeysDeep } from "@cco/shared";
import {
  ProductBatchCreationResultResponseSchema,
  ProductBatchResponseSchema,
  ProductSkuResponseSchema
} from "@cco/contracts";
import {
  archiveProductBatch,
  archiveProductSku,
  assertNoLotCollision,
  assertNoSkuCollision,
  createActionId,
  createBatchId,
  createClientId,
  createProductBatch,
  createProductSku,
  createSkuId,
  DuplicateLotError,
  DuplicateSkuError,
  IdempotencyConflictError,
  NotFoundError,
  StaleRevisionConflictError,
  updateProductBatchMetadata,
  updateProductSkuMetadata,
  type ActionId,
  type BatchFactsRevision,
  type BatchId,
  type ClientId,
  type ProductBatch,
  type ProductBatchCreationResult,
  type ProductSku,
  type SkuId
} from "@cco/domain";
import { appendBatchFactsRevision } from "@cco/domain";
import { applyBatchFactsAppend, assertSkuCanAcceptBatch } from "@cco/domain";
import type {
  AppendBatchFactsCommand,
  ArchiveBatchCommand,
  ArchiveSkuCommand,
  CommandEnvelope,
  CreateBatchCommand,
  CreateSkuCommand,
  ProductBatchArchiveResult,
  ProductBatchUpdateResult,
  ProductEvidenceRepositoryPort,
  ProductSkuArchiveResult,
  ProductSkuUpdateResult,
  UpdateBatchMetadataCommand,
  UpdateSkuMetadataCommand
} from "./product-evidence-repository.js";
import {
  serializeProductBatch,
  serializeProductBatchCreationResult,
  serializeProductSku
} from "./product-evidence-serializers.js";

// ============================================================================
// Compile-time Brand Invariance Test
// ============================================================================

type AssertNotAssignable<A, B> = A extends B ? false : true;
const _skuNotBatch: AssertNotAssignable<SkuId, BatchId> = true;
const _batchNotSku: AssertNotAssignable<BatchId, SkuId> = true;
expect(_skuNotBatch).toBe(true);
expect(_batchNotSku).toBe(true);

// ============================================================================
// In-Memory Contract Double (Validating Repository Guarantees)
// ============================================================================

class InMemoryProductEvidenceRepository implements ProductEvidenceRepositoryPort {
  private readonly skus = new Map<string, ProductSku>();
  private readonly batches = new Map<string, ProductBatch>();
  private readonly facts = new Map<string, BatchFactsRevision[]>();
  private readonly receipts = new Map<
    string,
    { readonly payloadSha256: string; readonly response: unknown }
  >();

  private receiptKey(clientId: ClientId, actionId: ActionId): string {
    return `${clientId}::${actionId}`;
  }

  private skuKey(clientId: ClientId, skuId: SkuId): string {
    return `${clientId}::${skuId}`;
  }

  private batchKey(clientId: ClientId, batchId: BatchId): string {
    return `${clientId}::${batchId}`;
  }

  private checkIdempotency<T, R>(cmd: CommandEnvelope<T>, execute: () => R): R {
    const key = this.receiptKey(cmd.clientId, cmd.actionId);
    const payloadHash = JSON.stringify(sortKeysDeep(cmd.payload));
    const existing = this.receipts.get(key);

    if (existing) {
      if (existing.payloadSha256 === payloadHash) {
        return existing.response as R;
      }
      throw new IdempotencyConflictError(cmd.actionId);
    }

    const result = execute();
    this.receipts.set(key, { payloadSha256: payloadHash, response: result });
    return result;
  }

  async createSku(cmd: CommandEnvelope<CreateSkuCommand>): Promise<ProductSku> {
    return this.checkIdempotency(cmd, () => {
      const existingClientSkus = Array.from(this.skus.values()).filter(
        (s) => s.clientId === cmd.clientId
      );
      assertNoSkuCollision(cmd.payload.canonicalSku, existingClientSkus, cmd.clientId);

      const skuId = createSkuId(cmd.actionId);
      const sku = createProductSku({
        clientId: cmd.clientId,
        skuId,
        canonicalSku: cmd.payload.canonicalSku,
        displayName: cmd.payload.displayName,
        timestamp: cmd.timestamp
      });

      this.skus.set(this.skuKey(cmd.clientId, skuId), sku);
      return sku;
    });
  }

  async createBatch(cmd: CommandEnvelope<CreateBatchCommand>): Promise<ProductBatchCreationResult> {
    return this.checkIdempotency(cmd, () => {
      const parentSku = this.skus.get(this.skuKey(cmd.clientId, cmd.payload.skuId));
      if (!parentSku) {
        throw new NotFoundError("ProductSku", cmd.payload.skuId);
      }
      assertSkuCanAcceptBatch(parentSku, cmd.clientId);

      const existingLots = Array.from(this.batches.values()).filter(
        (b) => b.clientId === cmd.clientId && b.skuId === cmd.payload.skuId
      );
      assertNoLotCollision(cmd.payload.lotIdentifier, existingLots, cmd.payload.skuId);

      const batchId = createBatchId(cmd.actionId);
      const result = createProductBatch({
        parentSku,
        batchId,
        lotIdentifier: cmd.payload.lotIdentifier,
        displayName: cmd.payload.displayName,
        initialFacts: cmd.payload.initialFacts,
        actorId: cmd.actorId,
        timestamp: cmd.timestamp
      });

      this.batches.set(this.batchKey(cmd.clientId, batchId), result.batch);
      this.facts.set(this.batchKey(cmd.clientId, batchId), [result.initialFacts]);
      return result;
    });
  }

  async appendBatchFacts(
    cmd: CommandEnvelope<AppendBatchFactsCommand>
  ): Promise<BatchFactsRevision> {
    return this.checkIdempotency(cmd, () => {
      const batchKey = this.batchKey(cmd.clientId, cmd.payload.batchId);
      const currentBatch = this.batches.get(batchKey);
      if (!currentBatch) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }

      const history = this.facts.get(batchKey) ?? [];
      const previousFacts = history[history.length - 1];
      if (!previousFacts) {
        throw new NotFoundError(
          "BatchFactsRevision",
          `Batch ${cmd.payload.batchId} has no initial facts`
        );
      }

      const nextFacts = appendBatchFactsRevision(previousFacts, {
        originKind: cmd.payload.originKind,
        producerIdentityAsClaimed: cmd.payload.producerIdentityAsClaimed,
        productionStartDate: cmd.payload.productionStartDate,
        productionEndDate: cmd.payload.productionEndDate,
        originEvidenceId: cmd.payload.originEvidenceId,
        originEvidenceRevision: cmd.payload.originEvidenceRevision,
        assertedBy: cmd.actorId,
        assertedAt: cmd.timestamp
      });

      const { current: nextBatch } = applyBatchFactsAppend(
        currentBatch,
        previousFacts,
        nextFacts,
        cmd.payload.expectedVersion
      );

      this.batches.set(batchKey, nextBatch);
      history.push(nextFacts);
      return nextFacts;
    });
  }

  async updateSkuMetadata(
    cmd: CommandEnvelope<UpdateSkuMetadataCommand>
  ): Promise<ProductSkuUpdateResult> {
    return this.checkIdempotency(cmd, () => {
      const key = this.skuKey(cmd.clientId, cmd.payload.skuId);
      const current = this.skus.get(key);
      if (!current) {
        throw new NotFoundError("ProductSku", cmd.payload.skuId);
      }

      const { previous, current: next } = updateProductSkuMetadata(current, {
        expectedVersion: cmd.payload.expectedVersion,
        displayName: cmd.payload.displayName,
        updatedAt: cmd.timestamp
      });

      this.skus.set(key, next);
      return { sku: next, audit: { previous, current: next } };
    });
  }

  async updateBatchMetadata(
    cmd: CommandEnvelope<UpdateBatchMetadataCommand>
  ): Promise<ProductBatchUpdateResult> {
    return this.checkIdempotency(cmd, () => {
      const key = this.batchKey(cmd.clientId, cmd.payload.batchId);
      const current = this.batches.get(key);
      if (!current) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }

      const { previous, current: next } = updateProductBatchMetadata(current, {
        expectedVersion: cmd.payload.expectedVersion,
        displayName: cmd.payload.displayName,
        updatedAt: cmd.timestamp
      });

      this.batches.set(key, next);
      return { batch: next, audit: { previous, current: next } };
    });
  }

  async archiveSku(cmd: CommandEnvelope<ArchiveSkuCommand>): Promise<ProductSkuArchiveResult> {
    return this.checkIdempotency(cmd, () => {
      const key = this.skuKey(cmd.clientId, cmd.payload.skuId);
      const current = this.skus.get(key);
      if (!current) {
        throw new NotFoundError("ProductSku", cmd.payload.skuId);
      }

      const { previous, current: next } = archiveProductSku(current, {
        expectedVersion: cmd.payload.expectedVersion,
        archivedAt: cmd.timestamp
      });

      this.skus.set(key, next);
      return { sku: next, audit: { previous, current: next } };
    });
  }

  async archiveBatch(
    cmd: CommandEnvelope<ArchiveBatchCommand>
  ): Promise<ProductBatchArchiveResult> {
    return this.checkIdempotency(cmd, () => {
      const key = this.batchKey(cmd.clientId, cmd.payload.batchId);
      const current = this.batches.get(key);
      if (!current) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }

      const { previous, current: next } = archiveProductBatch(current, {
        expectedVersion: cmd.payload.expectedVersion,
        archivedAt: cmd.timestamp
      });

      this.batches.set(key, next);
      return { batch: next, audit: { previous, current: next } };
    });
  }

  async getSkuById(clientId: ClientId, skuId: SkuId): Promise<ProductSku | null> {
    return this.skus.get(this.skuKey(clientId, skuId)) ?? null;
  }

  async listSkus(
    clientId: ClientId,
    filter?: { readonly includeArchived?: boolean }
  ): Promise<readonly ProductSku[]> {
    const all = Array.from(this.skus.values()).filter((s) => s.clientId === clientId);
    if (filter?.includeArchived) {
      return all;
    }
    return all.filter((s) => s.archivedAt === null);
  }

  async getBatchById(clientId: ClientId, batchId: BatchId): Promise<ProductBatch | null> {
    return this.batches.get(this.batchKey(clientId, batchId)) ?? null;
  }

  async getBatchHistory(
    clientId: ClientId,
    batchId: BatchId
  ): Promise<readonly BatchFactsRevision[]> {
    return this.facts.get(this.batchKey(clientId, batchId)) ?? [];
  }

  async listBatches(
    clientId: ClientId,
    filter?: {
      readonly skuId?: SkuId;
      readonly includeArchived?: boolean;
    }
  ): Promise<readonly ProductBatch[]> {
    let all = Array.from(this.batches.values()).filter((b) => b.clientId === clientId);
    if (filter?.skuId) {
      all = all.filter((b) => b.skuId === filter.skuId);
    }
    if (!filter?.includeArchived) {
      all = all.filter((b) => b.archivedAt === null);
    }
    return all;
  }
}

// ============================================================================
// Repository Port Contract Tests
// ============================================================================

describe("ProductEvidenceRepositoryPort contracts and double", () => {
  const clientA = createClientId("018f0000-0000-7000-8000-000000000001");
  const clientB = createClientId("018f0000-0000-7000-8000-000000000002");
  const action1 = createActionId("018f0000-0001-7000-8000-000000000001");
  const action2 = createActionId("018f0000-0001-7000-8000-000000000002");
  const action3 = createActionId("018f0000-0001-7000-8000-000000000003");
  const actor = "ops@example.com";
  const timestamp1 = "2026-10-19T10:00:00.000Z";
  const timestamp2 = "2026-10-19T11:00:00.000Z";
  const timestamp3 = "2026-10-19T12:00:00.000Z";

  it("creates SKU and prevents collision in same client while allowing reuse across clients", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const skuA = await repo.createSku({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: {
        canonicalSku: "SKU-PRO-01",
        displayName: "Client A Product"
      }
    });

    expect(skuA.canonicalSku).toBe("SKU-PRO-01");

    // Same client attempting duplicate canonicalSku -> DUPLICATE_SKU
    await expect(
      repo.createSku({
        actionId: action2,
        clientId: clientA,
        actorId: actor,
        timestamp: timestamp2,
        payload: {
          canonicalSku: "sku-pro-01",
          displayName: "Duplicate Attempt"
        }
      })
    ).rejects.toThrow(DuplicateSkuError);

    // Different client reusing same canonicalSku -> allowed!
    const skuB = await repo.createSku({
      actionId: action2,
      clientId: clientB,
      actorId: actor,
      timestamp: timestamp2,
      payload: {
        canonicalSku: "SKU-PRO-01",
        displayName: "Client B Product"
      }
    });

    expect(skuB.canonicalSku).toBe("SKU-PRO-01");
    expect(skuB.clientId).toBe(clientB);
  });

  it("creates batch with initial facts atomically", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const sku = await repo.createSku({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: {
        canonicalSku: "SKU-TEA-01",
        displayName: "Green Tea"
      }
    });

    const result = await repo.createBatch({
      actionId: action2,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: {
        skuId: sku.skuId,
        lotIdentifier: "LOT-TEA-2026",
        displayName: "Harvest Spring 2026"
      }
    });

    expect(result.batch.lotIdentifier).toBe("LOT-TEA-2026");
    expect(result.batch.version).toBe(1);
    expect(result.batch.currentFactsRevision).toBe(1);
    expect(result.initialFacts.revision).toBe(1);
    expect(result.initialFacts.originKind).toBe("unknown");

    const history = await repo.getBatchHistory(clientA, result.batch.batchId);
    expect(history.length).toBe(1);
    expect(history[0]?.revision).toBe(1);

    // Duplicate lot for same client and same SKU throws DuplicateLotError
    await expect(
      repo.createBatch({
        actionId: action3,
        clientId: clientA,
        actorId: actor,
        timestamp: timestamp2,
        payload: {
          skuId: sku.skuId,
          lotIdentifier: "LOT-TEA-2026",
          displayName: "Duplicate Lot Attempt"
        }
      })
    ).rejects.toThrow(DuplicateLotError);
  });

  it("applies facts append and advances batch head under version fencing", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const sku = await repo.createSku({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-TEA-01", displayName: "Green Tea" }
    });

    const { batch } = await repo.createBatch({
      actionId: action2,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { skuId: sku.skuId, lotIdentifier: "LOT-TEA-01", displayName: "B1" }
    });

    const factsRev2 = await repo.appendBatchFacts({
      actionId: action3,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp2,
      payload: {
        batchId: batch.batchId,
        expectedVersion: 1,
        originKind: "own_production",
        producerIdentityAsClaimed: "Tea Estate Kyoto",
        productionStartDate: "2026-03-01",
        productionEndDate: "2026-03-15",
        originEvidenceId: null,
        originEvidenceRevision: null
      }
    });

    expect(factsRev2.revision).toBe(2);
    expect(factsRev2.supersedesRevision).toBe(1);

    const updatedBatch = await repo.getBatchById(clientA, batch.batchId);
    expect(updatedBatch?.version).toBe(2);
    expect(updatedBatch?.currentFactsRevision).toBe(2);
    expect(updatedBatch?.updatedAt).toBe(timestamp2);
  });

  it("handles concurrent commands on the same version: first succeeds, second fails with STALE_REVISION_CONFLICT", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const sku = await repo.createSku({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-TEA-01", displayName: "Original" }
    });

    // Command 1 based on version 1
    const res1 = await repo.updateSkuMetadata({
      actionId: action2,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp2,
      payload: {
        skuId: sku.skuId,
        expectedVersion: 1,
        displayName: "First Update"
      }
    });
    expect(res1.sku.version).toBe(2);
    expect(res1.audit.previous.displayName).toBe("Original");
    expect(res1.audit.current.displayName).toBe("First Update");

    // Command 2 concurrently attempted based on stale version 1 -> STALE_REVISION_CONFLICT
    await expect(
      repo.updateSkuMetadata({
        actionId: action3,
        clientId: clientA,
        actorId: actor,
        timestamp: timestamp3,
        payload: {
          skuId: sku.skuId,
          expectedVersion: 1, // Stale!
          displayName: "Second Update"
        }
      })
    ).rejects.toThrow(StaleRevisionConflictError);

    // Verify sku was not mutated by the failed command
    const current = await repo.getSkuById(clientA, sku.skuId);
    expect(current?.version).toBe(2);
    expect(current?.displayName).toBe("First Update");
  });

  it("idempotently replays result on identical actionId and payload, conflicts on altered payload", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const cmd: CommandEnvelope<CreateSkuCommand> = {
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-TEA-01", displayName: "Green Tea" }
    };

    const first = await repo.createSku(cmd);
    const second = await repo.createSku(cmd);
    expect(second).toEqual(first);

    // Same actionId with altered payload -> IDEMPOTENCY_CONFLICT
    const alteredCmd: CommandEnvelope<CreateSkuCommand> = {
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-COFFEE-01", displayName: "Coffee" }
    };

    await expect(repo.createSku(alteredCmd)).rejects.toThrow(IdempotencyConflictError);
  });

  it("lists SKUs and batches excluding archived by default, includes with filter", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const sku1 = await repo.createSku({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-A", displayName: "A" }
    });
    await repo.createSku({
      actionId: action2,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-B", displayName: "B" }
    });

    await repo.archiveSku({
      actionId: action3,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp2,
      payload: { skuId: sku1.skuId, expectedVersion: 1 }
    });

    const activeList = await repo.listSkus(clientA);
    expect(activeList.length).toBe(1);
    expect(activeList[0]?.canonicalSku).toBe("SKU-B");

    const fullList = await repo.listSkus(clientA, { includeArchived: true });
    expect(fullList.length).toBe(2);
  });

  it("serializes domain models into safe wire contracts conforming to Zod response schemas", async () => {
    const repo = new InMemoryProductEvidenceRepository();

    const sku = await repo.createSku({
      actionId: action1,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: { canonicalSku: "SKU-SER-01", displayName: "Serializer Test" }
    });

    const skuResponse = serializeProductSku(sku);
    expect(ProductSkuResponseSchema.safeParse(skuResponse).success).toBe(true);

    const batchResult = await repo.createBatch({
      actionId: action2,
      clientId: clientA,
      actorId: actor,
      timestamp: timestamp1,
      payload: {
        skuId: sku.skuId,
        lotIdentifier: "LOT-SER-01",
        displayName: "Batch Serializer Test"
      }
    });

    const batchResponse = serializeProductBatch(batchResult.batch);
    expect(ProductBatchResponseSchema.safeParse(batchResponse).success).toBe(true);

    const resultResponse = serializeProductBatchCreationResult(batchResult);
    expect(ProductBatchCreationResultResponseSchema.safeParse(resultResponse).success).toBe(true);
  });
});
