import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
import { PostgresUnitOfWork } from "../uow/postgres-unit-of-work.js";
import { PostgresProductEvidenceRepository } from "./postgres-product-evidence-repository.js";
import {
  AccessDeniedError,
  ConcurrencyConflictError,
  createActionId,
  createClientId,
  DuplicateLotError,
  DuplicateSkuError,
  IdempotencyConflictError,
  NonMonotonicRevisionError,
  NotFoundError,
  StaleRevisionConflictError
} from "@cco/domain";

function createBarrier(count: number) {
  let remaining = count;
  let release: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait(): Promise<void> {
      remaining--;
      if (remaining <= 0) {
        release();
      }
      await promise;
    }
  };
}

describe("PostgresProductEvidenceRepository and UoW integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri()
    });
  }, 120_000);

  afterAll(async () => {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  it("proves client scoping, lot independence across SKUs, and permanent uniqueness including archived rows", async () => {
    const clientRecordA = await insertClientRecord(client);
    const clientRecordB = await insertClientRecord(client);
    const clientA = createClientId(clientRecordA.client_id);
    const clientB = createClientId(clientRecordB.client_id);

    const uow = new PostgresUnitOfWork(pool);

    // 1. Two clients can have the same canonical SKU
    const skuA = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-SHARED-01", displayName: "Client A Shared" }
      })
    );

    const skuB = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
        clientId: clientB,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-SHARED-01", displayName: "Client B Shared" }
      })
    );

    expect(skuA.canonicalSku).toBe("SKU-SHARED-01");
    expect(skuB.canonicalSku).toBe("SKU-SHARED-01");
    expect(skuA.clientId).not.toBe(skuB.clientId);

    // 2. Duplicate SKU conflict in same client throws DuplicateSkuError
    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createSku({
          actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
          clientId: clientA,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:01:00.000Z",
          payload: { canonicalSku: "sku-shared-01", displayName: "Duplicate Attempt" }
        })
      )
    ).rejects.toThrow(DuplicateSkuError);

    // 3. One SKU can have multiple lots
    const batch1 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000004"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:02:00.000Z",
        payload: { skuId: skuA.skuId, lotIdentifier: "LOT-001", displayName: "Lot 1" }
      })
    );

    const batch2 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000005"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:03:00.000Z",
        payload: { skuId: skuA.skuId, lotIdentifier: "LOT-002", displayName: "Lot 2" }
      })
    );
    expect(batch1.batch.lotIdentifier).toBe("LOT-001");
    expect(batch2.batch.lotIdentifier).toBe("LOT-002");

    // 4. Duplicate lot under same SKU throws DuplicateLotError
    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createBatch({
          actionId: createActionId("018f0000-0001-7000-8000-000000000006"),
          clientId: clientA,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:04:00.000Z",
          payload: { skuId: skuA.skuId, lotIdentifier: "LOT-001", displayName: "Duplicate Lot" }
        })
      )
    ).rejects.toThrow(DuplicateLotError);

    // 5. Same lot under a DIFFERENT SKU in same client is allowed
    const skuA2 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000007"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:05:00.000Z",
        payload: { canonicalSku: "SKU-DIFFERENT-02", displayName: "Second SKU" }
      })
    );

    const batchUnderOtherSku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000008"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:06:00.000Z",
        payload: {
          skuId: skuA2.skuId,
          lotIdentifier: "LOT-001",
          displayName: "Same Lot Different SKU"
        }
      })
    );
    expect(batchUnderOtherSku.batch.lotIdentifier).toBe("LOT-001");

    // 6. Permanent uniqueness: archiving SKU does not release the canonical SKU name
    await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000009"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:07:00.000Z",
        payload: { skuId: skuA2.skuId, expectedVersion: 1 }
      })
    );

    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createSku({
          actionId: createActionId("018f0000-0001-7000-8000-000000000010"),
          clientId: clientA,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:08:00.000Z",
          payload: { canonicalSku: "SKU-DIFFERENT-02", displayName: "Reuse Archived Name" }
        })
      )
    ).rejects.toThrow(DuplicateSkuError);
  });

  it("strictly enforces parent client boundary and prevents cross-client data leakage", async () => {
    const clientRecordA = await insertClientRecord(client);
    const clientRecordB = await insertClientRecord(client);
    const clientA = createClientId(clientRecordA.client_id);
    const clientB = createClientId(clientRecordB.client_id);

    const uow = new PostgresUnitOfWork(pool);

    const skuA = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: clientA,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-CLIENT-A", displayName: "A SKU" }
      })
    );

    // Client B attempting to query Client A's SKU by ID returns null (no ID disclosure)
    const readSkuFromB = await uow.execute(async (ctx) =>
      ctx.productEvidence!.getSkuById(clientB, skuA.skuId)
    );
    expect(readSkuFromB).toBeNull();

    // Client B attempting to create a batch under Client A's SKU throws NotFoundError
    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createBatch({
          actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
          clientId: clientB,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:01:00.000Z",
          payload: {
            skuId: skuA.skuId,
            lotIdentifier: "LOT-01",
            displayName: "Cross-client Attempt"
          }
        })
      )
    ).rejects.toThrow(NotFoundError);
  });

  it("creates batch and initial facts revision 1 atomically; rolled back failure leaves zero rows", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const sku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-ATOM-01", displayName: "Atomic SKU" }
      })
    );

    // Forced failure after batch creation inside transaction
    await expect(
      uow.execute(async (ctx) => {
        await ctx.productEvidence!.createBatch({
          actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
          clientId,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:01:00.000Z",
          payload: { skuId: sku.skuId, lotIdentifier: "LOT-FAIL", displayName: "Failing Batch" }
        });
        throw new Error("Forced simulated failure");
      })
    ).rejects.toThrow("Forced simulated failure");

    // Verify no batch, facts, or receipt were committed
    const batches = await uow.execute(async (ctx) =>
      ctx.productEvidence!.listBatches(clientId, { includeArchived: true })
    );
    expect(batches).toHaveLength(0);

    const receipts = await client.query(
      "SELECT * FROM product_evidence_command_receipts WHERE client_id = $1",
      [clientId]
    );
    // Only the SKU receipt should exist
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]?.command_name).toBe("createSku");
  });

  it("handles revision winners: two concurrent commands on the same expected version serialize with exactly one winner", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const sku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-RACE-01", displayName: "Initial Name" }
      })
    );

    const barrier = createBarrier(2);
    // Two competing updateSkuMetadata commands targeting version 1
    const p1 = uow.execute(async (ctx) => {
      await barrier.wait();
      return ctx.productEvidence!.updateSkuMetadata({
        actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: { skuId: sku.skuId, expectedVersion: 1, displayName: "Update Candidate 1" }
      });
    });

    const p2 = uow.execute(async (ctx) => {
      await barrier.wait();
      return ctx.productEvidence!.updateSkuMetadata({
        actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: { skuId: sku.skuId, expectedVersion: 1, displayName: "Update Candidate 2" }
      });
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectedReason).toBeInstanceOf(StaleRevisionConflictError);

    // Version must have advanced to exactly 2
    const finalSku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.getSkuById(clientId, sku.skuId)
    );
    expect(finalSku?.version).toBe(2);
  });

  it("handles concurrent facts-vs-facts and metadata-vs-facts on product batch", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const sku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-BATCH-RACE", displayName: "Race Parent" }
      })
    );

    const { batch } = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { skuId: sku.skuId, lotIdentifier: "LOT-RACE", displayName: "Batch 1" }
      })
    );

    const barrier = createBarrier(2);
    // Metadata update vs Facts append concurrently targeting version 1
    const pMeta = uow.execute(async (ctx) => {
      await barrier.wait();
      return ctx.productEvidence!.updateBatchMetadata({
        actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: { batchId: batch.batchId, expectedVersion: 1, displayName: "New Name" }
      });
    });

    const pFacts = uow.execute(async (ctx) => {
      await barrier.wait();
      return ctx.productEvidence!.appendBatchFacts({
        actionId: createActionId("018f0000-0001-7000-8000-000000000004"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: {
          batchId: batch.batchId,
          expectedVersion: 1,
          originKind: "own_production",
          producerIdentityAsClaimed: "Organic Farm",
          productionStartDate: null,
          productionEndDate: null,
          originEvidenceId: null,
          originEvidenceRevision: null
        }
      });
    });

    const results = await Promise.allSettled([pMeta, pFacts]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      StaleRevisionConflictError
    );

    // Final batch version is 2
    const finalBatch = await uow.execute(async (ctx) =>
      ctx.productEvidence!.getBatchById(clientId, batch.batchId)
    );
    expect(finalBatch?.version).toBe(2);
  });

  it("handles simultaneous identical retries via receipt-first replay without duplicate database writes", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const actionId = createActionId("018f0000-0001-7000-8000-000000000001");
    const cmd = {
      actionId,
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:00:00.000Z",
      payload: { canonicalSku: "SKU-IDEMPOTENT-01", displayName: "Idempotent SKU" }
    };

    // Run identical command concurrently
    const [res1, res2] = await Promise.all([
      uow.execute(async (ctx) => ctx.productEvidence!.createSku(cmd)),
      uow.execute(async (ctx) => ctx.productEvidence!.createSku(cmd))
    ]);

    expect(res1.skuId).toBe(res2.skuId);
    expect(res1.canonicalSku).toBe(res2.canonicalSku);

    // Receipt count in database is exactly 1
    const receiptRes = await client.query(
      "SELECT * FROM product_evidence_command_receipts WHERE client_id = $1 AND action_id = $2",
      [clientId, actionId]
    );
    expect(receiptRes.rows).toHaveLength(1);

    // Replay with altered payload throws IdempotencyConflictError
    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createSku({
          ...cmd,
          payload: { canonicalSku: "SKU-ALTERED-01", displayName: "Altered" }
        })
      )
    ).rejects.toThrow(IdempotencyConflictError);

    // Replay with altered actor throws IdempotencyConflictError
    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createSku({
          ...cmd,
          actorId: "actor-different"
        })
      )
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("replays committed receipt even after state has moved forward or been archived", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const createAction = createActionId("018f0000-0001-7000-8000-000000000001");
    const updateAction = createActionId("018f0000-0001-7000-8000-000000000002");
    const archiveAction = createActionId("018f0000-0001-7000-8000-000000000003");

    const sku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createAction,
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-REPLAY-01", displayName: "Original Name" }
      })
    );

    const updateCmd = {
      actionId: updateAction,
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:01:00.000Z",
      payload: { skuId: sku.skuId, expectedVersion: 1, displayName: "Updated Name" }
    };
    const updateResult = await uow.execute(async (ctx) =>
      ctx.productEvidence!.updateSkuMetadata(updateCmd)
    );
    expect(updateResult.sku.version).toBe(2);

    // Now archive the SKU (moves version to 3)
    await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveSku({
        actionId: archiveAction,
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:02:00.000Z",
        payload: { skuId: sku.skuId, expectedVersion: 2 }
      })
    );

    // Replay updateCmd (which had expectedVersion: 1).
    // Because a receipt exists, it should replay the stored result without checking expectedVersion or archive status!
    const replayed = await uow.execute(async (ctx) =>
      ctx.productEvidence!.updateSkuMetadata(updateCmd)
    );
    expect(replayed.sku.version).toBe(2);
    expect(replayed.sku.displayName).toBe("Updated Name");
  });

  it("enforces archive constraints and default list filtering", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-ACTIVE", displayName: "Active SKU" }
      })
    );

    const sku2 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-TO-ARCHIVE", displayName: "Archive SKU" }
      })
    );

    const batchUnderSku2 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { skuId: sku2.skuId, lotIdentifier: "LOT-UNDER-SKU2", displayName: "Child Batch" }
      })
    );

    // Archive sku2
    await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000004"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:05:00.000Z",
        payload: { skuId: sku2.skuId, expectedVersion: 1 }
      })
    );

    // Attempting to create new batch under archived SKU throws AccessDeniedError
    await expect(
      uow.execute(async (ctx) =>
        ctx.productEvidence!.createBatch({
          actionId: createActionId("018f0000-0001-7000-8000-000000000005"),
          clientId,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:06:00.000Z",
          payload: {
            skuId: sku2.skuId,
            lotIdentifier: "LOT-REJECTED",
            displayName: "Rejected Batch"
          }
        })
      )
    ).rejects.toThrow(AccessDeniedError);

    // Default listSkus excludes archived SKU
    const activeSkus = await uow.execute(async (ctx) => ctx.productEvidence!.listSkus(clientId));
    expect(activeSkus).toHaveLength(1);
    expect(activeSkus[0]?.canonicalSku).toBe("SKU-ACTIVE");

    const allSkus = await uow.execute(async (ctx) =>
      ctx.productEvidence!.listSkus(clientId, { includeArchived: true })
    );
    expect(allSkus).toHaveLength(2);

    // Default listBatches excludes batches under archived parent SKU
    const activeBatches = await uow.execute(async (ctx) =>
      ctx.productEvidence!.listBatches(clientId)
    );
    expect(activeBatches).toHaveLength(0);

    const allBatches = await uow.execute(async (ctx) =>
      ctx.productEvidence!.listBatches(clientId, { includeArchived: true })
    );
    expect(allBatches).toHaveLength(1);
    expect(allBatches[0]?.lotIdentifier).toBe("LOT-UNDER-SKU2");

    // History of batch under archived SKU is still fully accessible
    const history = await uow.execute(async (ctx) =>
      ctx.productEvidence!.getBatchHistory(clientId, batchUnderSku2.batch.batchId)
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.revision).toBe(1);
  });

  it("handles concurrent facts-vs-facts append commands on product batch with exactly one winner", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const sku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-FACTS-RACE", displayName: "Race Parent" }
      })
    );

    const { batch } = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { skuId: sku.skuId, lotIdentifier: "LOT-FACTS-RACE", displayName: "Batch 1" }
      })
    );

    const barrier = createBarrier(2);
    // Two competing appendBatchFacts targeting expectedVersion 1
    const pFacts1 = uow.execute(async (ctx) => {
      await barrier.wait();
      return ctx.productEvidence!.appendBatchFacts({
        actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: {
          batchId: batch.batchId,
          expectedVersion: 1,
          originKind: "own_production",
          producerIdentityAsClaimed: "Farm 1",
          productionStartDate: null,
          productionEndDate: null,
          originEvidenceId: null,
          originEvidenceRevision: null
        }
      });
    });

    const pFacts2 = uow.execute(async (ctx) => {
      await barrier.wait();
      return ctx.productEvidence!.appendBatchFacts({
        actionId: createActionId("018f0000-0001-7000-8000-000000000004"),
        clientId,
        actorId: "actor-2",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: {
          batchId: batch.batchId,
          expectedVersion: 1,
          originKind: "partner_origin",
          producerIdentityAsClaimed: "Farm 2",
          productionStartDate: null,
          productionEndDate: null,
          originEvidenceId: null,
          originEvidenceRevision: null
        }
      });
    });

    const results = await Promise.allSettled([pFacts1, pFacts2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const err = (rejected[0] as PromiseRejectedResult).reason;
    expect(
      err instanceof StaleRevisionConflictError ||
        err instanceof NonMonotonicRevisionError ||
        err instanceof ConcurrencyConflictError
    ).toBe(true);

    const updatedBatch = await uow.execute(async (ctx) =>
      ctx.productEvidence!.getBatchById(clientId, batch.batchId)
    );
    expect(updatedBatch?.version).toBe(2);
    expect(updatedBatch?.currentFactsRevision).toBe(2);

    const batchHistory = await uow.execute(async (ctx) =>
      ctx.productEvidence!.getBatchHistory(clientId, batch.batchId)
    );
    expect(batchHistory).toHaveLength(2);
  });

  it("enforces archive-vs-create race behavior in both commit orders", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    // Scenario 1: Archive holds SKU lock and commits first -> Create batch rejected with AccessDeniedError
    const sku1 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-ORDER-1", displayName: "Order 1" }
      })
    );

    const lockingClientA = await pool.connect();
    try {
      await lockingClientA.query("BEGIN");
      const skuRepoA = new PostgresProductEvidenceRepository(lockingClientA, {
        externalTransaction: true
      });
      await skuRepoA.archiveSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: { skuId: sku1.skuId, expectedVersion: 1 }
      });

      const pCreate = uow.execute(async (ctx) =>
        ctx.productEvidence!.createBatch({
          actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
          clientId,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:02:00.000Z",
          payload: { skuId: sku1.skuId, lotIdentifier: "LOT-LATE", displayName: "Late Batch" }
        })
      );

      await lockingClientA.query("COMMIT");
      await expect(pCreate).rejects.toThrow(AccessDeniedError);
    } finally {
      lockingClientA.release();
    }

    // Scenario 2: Create batch holds SKU lock and commits first -> Batch created, then archive SKU succeeds
    const sku2 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000004"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-ORDER-2", displayName: "Order 2" }
      })
    );

    const lockingClientB = await pool.connect();
    try {
      await lockingClientB.query("BEGIN");
      const batchRepoB = new PostgresProductEvidenceRepository(lockingClientB, {
        externalTransaction: true
      });
      const batchCreated = await batchRepoB.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000005"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:01:00.000Z",
        payload: { skuId: sku2.skuId, lotIdentifier: "LOT-FIRST", displayName: "First Batch" }
      });
      expect(batchCreated.batch.lotIdentifier).toBe("LOT-FIRST");

      const pArchive = uow.execute(async (ctx) =>
        ctx.productEvidence!.archiveSku({
          actionId: createActionId("018f0000-0001-7000-8000-000000000006"),
          clientId,
          actorId: "actor-1",
          timestamp: "2026-10-19T10:02:00.000Z",
          payload: { skuId: sku2.skuId, expectedVersion: 1 }
        })
      );

      await lockingClientB.query("COMMIT");
      const archivedSku2 = await pArchive;
      expect(archivedSku2.sku.archivedAt).not.toBeNull();
    } finally {
      lockingClientB.release();
    }
  });

  it("enforces bounded lock_timeout on contention instead of hanging", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const sku = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: { canonicalSku: "SKU-LOCK-TEST", displayName: "Lock Test" }
      })
    );

    // Open connection holding an exclusive lock on the SKU row
    const lockingClient = await pool.connect();
    try {
      await lockingClient.query("BEGIN");
      await lockingClient.query("SELECT * FROM product_skus WHERE sku_id = $1 FOR UPDATE", [
        sku.skuId
      ]);

      // Using repo with very short lock timeout (100ms)
      const contendingClient = await pool.connect();
      try {
        await contendingClient.query("BEGIN");
        const contendingRepo = new PostgresProductEvidenceRepository(contendingClient, {
          externalTransaction: true,
          lockTimeoutMs: 100
        });

        await expect(
          contendingRepo.updateSkuMetadata({
            actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
            clientId,
            actorId: "actor-1",
            timestamp: "2026-10-19T10:01:00.000Z",
            payload: { skuId: sku.skuId, expectedVersion: 1, displayName: "Blocked Name" }
          })
        ).rejects.toThrow(ConcurrencyConflictError);

        await contendingClient.query("ROLLBACK").catch(() => {});
      } finally {
        contendingClient.release();
      }

      await lockingClient.query("ROLLBACK");
    } finally {
      lockingClient.release();
    }
  });

  it("verifies idempotency receipt replay across all 7 mutation operations", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    // 1. createSku replay
    const createSkuCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:00:00.000Z",
      payload: { canonicalSku: "SKU-REPLAY-7", displayName: "Original Sku" }
    };
    const sku1 = await uow.execute(async (ctx) => ctx.productEvidence!.createSku(createSkuCmd));
    const sku1Replay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createSku(createSkuCmd)
    );
    expect(sku1Replay.skuId).toBe(sku1.skuId);

    // 2. updateSkuMetadata replay
    const updateSkuCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000002"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:01:00.000Z",
      payload: { skuId: sku1.skuId, expectedVersion: 1, displayName: "Updated Sku" }
    };
    const skuUpdated = await uow.execute(async (ctx) =>
      ctx.productEvidence!.updateSkuMetadata(updateSkuCmd)
    );
    const skuUpdateReplay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.updateSkuMetadata(updateSkuCmd)
    );
    expect(skuUpdateReplay.sku.displayName).toBe(skuUpdated.sku.displayName);

    // 3. createBatch replay
    const createBatchCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000003"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:02:00.000Z",
      payload: { skuId: sku1.skuId, lotIdentifier: "LOT-REPLAY-7", displayName: "Original Batch" }
    };
    const batch1 = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch(createBatchCmd)
    );
    const batch1Replay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.createBatch(createBatchCmd)
    );
    expect(batch1Replay.batch.batchId).toBe(batch1.batch.batchId);

    // 4. updateBatchMetadata replay
    const updateBatchCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000004"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:03:00.000Z",
      payload: { batchId: batch1.batch.batchId, expectedVersion: 1, displayName: "Updated Batch" }
    };
    const batchUpdated = await uow.execute(async (ctx) =>
      ctx.productEvidence!.updateBatchMetadata(updateBatchCmd)
    );
    const batchUpdateReplay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.updateBatchMetadata(updateBatchCmd)
    );
    expect(batchUpdateReplay.batch.displayName).toBe(batchUpdated.batch.displayName);

    // 5. appendBatchFacts replay
    const appendFactsCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000005"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:04:00.000Z",
      payload: {
        batchId: batch1.batch.batchId,
        expectedVersion: 2,
        originKind: "own_production" as const,
        producerIdentityAsClaimed: "Farm Replay",
        productionStartDate: "2026-01-01",
        productionEndDate: "2026-01-10",
        originEvidenceId: null,
        originEvidenceRevision: null
      }
    };
    const factsAppended = await uow.execute(async (ctx) =>
      ctx.productEvidence!.appendBatchFacts(appendFactsCmd)
    );
    const factsAppendReplay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.appendBatchFacts(appendFactsCmd)
    );
    expect(factsAppendReplay.revision).toBe(factsAppended.revision);

    // 6. archiveBatch replay
    const archiveBatchCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000006"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:05:00.000Z",
      payload: { batchId: batch1.batch.batchId, expectedVersion: 3 }
    };
    const batchArchived = await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveBatch(archiveBatchCmd)
    );
    const batchArchiveReplay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveBatch(archiveBatchCmd)
    );
    expect(batchArchiveReplay.batch.archivedAt).toBe(batchArchived.batch.archivedAt);

    // 7. archiveSku replay
    const archiveSkuCmd = {
      actionId: createActionId("018f0000-0001-7000-8000-000000000007"),
      clientId,
      actorId: "actor-1",
      timestamp: "2026-10-19T10:06:00.000Z",
      payload: { skuId: sku1.skuId, expectedVersion: 2 }
    };
    const skuArchived = await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveSku(archiveSkuCmd)
    );
    const skuArchiveReplay = await uow.execute(async (ctx) =>
      ctx.productEvidence!.archiveSku(archiveSkuCmd)
    );
    expect(skuArchiveReplay.sku.archivedAt).toBe(skuArchived.sku.archivedAt);
  });

  it("rejects mutations invoked on an unbound or autocommit PoolClient before executing any SQL", async () => {
    const rawClient = await pool.connect();
    try {
      // 1. Without externalTransaction option
      const unboundRepo = new PostgresProductEvidenceRepository(rawClient);
      await expect(
        unboundRepo.createSku({
          actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
          clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
          actorId: "tester",
          timestamp: "2026-10-19T10:00:00.000Z",
          payload: { canonicalSku: "SKU-UNBOUND", displayName: "Unbound" }
        })
      ).rejects.toThrow(
        /mutations require a transaction-bound PoolClient with externalTransaction: true/
      );

      // 2. With externalTransaction: true but idle client (not inside BEGIN block)
      const idleRepo = new PostgresProductEvidenceRepository(rawClient, {
        externalTransaction: true
      });
      await expect(
        idleRepo.createSku({
          actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
          clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
          actorId: "tester",
          timestamp: "2026-10-19T10:00:00.000Z",
          payload: { canonicalSku: "SKU-UNBOUND", displayName: "Unbound" }
        })
      ).rejects.toThrow(/mutations require an active transaction block/);
    } finally {
      rawClient.release();
    }
  });
});
