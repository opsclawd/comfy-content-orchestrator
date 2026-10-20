import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { PostgresUnitOfWork } from "../uow/postgres-unit-of-work.js";
import {
  computePayloadSha256,
  isProductRegistryDatabaseError,
  PostgresProductEvidenceRepository,
  translateDatabaseError
} from "./postgres-product-evidence-repository.js";
import {
  AccessDeniedError,
  ConcurrencyConflictError,
  createActionId,
  createClientId,
  createSkuId,
  CrossClientViolationError,
  DuplicateLotError,
  DuplicateSkuError,
  IdempotencyConflictError,
  NonMonotonicRevisionError,
  NotFoundError,
  ProductValidationError
} from "@cco/domain";
import type { CommandEnvelope, CreateSkuCommand } from "@cco/application";

describe("PostgresProductEvidenceRepository unit tests", () => {
  it("calculates canonical payload hash consistently regardless of key order", () => {
    const payload1 = {
      displayName: "Product Green",
      canonicalSku: "SKU-GREEN",
      details: { b: 2, a: 1 }
    };
    const payload2 = {
      canonicalSku: "SKU-GREEN",
      details: { a: 1, b: 2 },
      displayName: "Product Green"
    };

    const hash1 = computePayloadSha256(payload1);
    const hash2 = computePayloadSha256(payload2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails fast if mutations are executed against a Pool instead of a transaction PoolClient", async () => {
    // Fake Pool instance
    const fakePool = {
      connect: async () => ({}),
      query: async () => ({ rows: [] })
    } as unknown as Pool;

    const repo = new PostgresProductEvidenceRepository(fakePool);

    await expect(
      repo.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      })
    ).rejects.toThrow(
      /mutations require a transaction-bound PoolClient with externalTransaction: true/
    );
  });

  it("fails fast if mutations are executed against a PoolClient without externalTransaction: true", async () => {
    const fakeClient = {
      query: async () => ({ rows: [] }),
      getTransactionStatus: () => "T"
    } as unknown as PoolClient;

    const repo = new PostgresProductEvidenceRepository(fakeClient);

    await expect(
      repo.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      })
    ).rejects.toThrow(
      /mutations require a transaction-bound PoolClient with externalTransaction: true/
    );
  });

  it("fails fast if mutations are executed against an idle PoolClient (getTransactionStatus !== 'T')", async () => {
    const fakeClient = {
      query: async () => ({ rows: [] }),
      getTransactionStatus: () => "I"
    } as unknown as PoolClient;

    const repo = new PostgresProductEvidenceRepository(fakeClient, { externalTransaction: true });

    await expect(
      repo.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      })
    ).rejects.toThrow(/mutations require an active transaction block \('BEGIN'\)/);
  });

  it("rejects unknown keys on CommandEnvelope and mutation payloads", async () => {
    const fakeClient = {
      query: async () => ({ rows: [] }),
      getTransactionStatus: () => "T"
    } as unknown as PoolClient;
    const repo = new PostgresProductEvidenceRepository(fakeClient, { externalTransaction: true });

    // Unknown envelope key
    await expect(
      repo.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        extraEnvelopeKey: "bad",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      } as unknown as CommandEnvelope<CreateSkuCommand>)
    ).rejects.toThrow(ProductValidationError);

    // Injected actorId on payload
    await expect(
      repo.createSku({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test",
          actorId: "spoofed"
        } as unknown as CreateSkuCommand
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects non-null originEvidenceRevision when originEvidenceId is null or omitted", async () => {
    const fakeClient = {
      query: async () => ({ rows: [] }),
      getTransactionStatus: () => "T"
    } as unknown as PoolClient;
    const repo = new PostgresProductEvidenceRepository(fakeClient, { externalTransaction: true });

    await expect(
      repo.createBatch({
        actionId: createActionId("018f0000-0001-7000-8000-000000000001"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: {
          skuId: createSkuId("018f0000-0002-7000-8000-000000000001"),
          lotIdentifier: "LOT-01",
          displayName: "Batch 1",
          initialFacts: {
            originKind: "unknown",
            originEvidenceRevision: 1
          }
        }
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("validates that actionId must be UUIDv7", async () => {
    const fakeClient = {
      query: async () => ({ rows: [] }),
      getTransactionStatus: () => "T"
    } as unknown as PoolClient;
    const repo = new PostgresProductEvidenceRepository(fakeClient, { externalTransaction: true });

    // Using a UUIDv4 actionId (has '4' at version position instead of '7')
    await expect(
      repo.createSku({
        actionId: createActionId("a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d"),
        clientId: createClientId("018f0000-0000-7000-8000-000000000001"),
        actorId: "tester",
        timestamp: "2026-10-19T10:00:00.000Z",
        payload: {
          canonicalSku: "SKU-TEST-01",
          displayName: "Test"
        }
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("translates PostgreSQL unique constraint errors into domain exceptions", () => {
    // 23505 uq_product_skus_canonical
    try {
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "uq_product_skus_canonical"
        }),
        { clientId: "018f0000-0000-7000-8000-000000000001", canonicalSku: "SKU-GREEN" }
      );
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateSkuError);
      expect((e as DuplicateSkuError).details).toEqual({
        clientId: "018f0000-0000-7000-8000-000000000001",
        canonicalSku: "SKU-GREEN"
      });
    }

    // 23505 uq_product_batches_lot
    try {
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "uq_product_batches_lot"
        }),
        { skuId: "018f0000-0002-7000-8000-000000000001", lotIdentifier: "LOT-01" }
      );
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateLotError);
      expect((e as DuplicateLotError).details).toEqual({
        skuId: "018f0000-0002-7000-8000-000000000001",
        lotIdentifier: "LOT-01"
      });
    }

    // 23505 product_evidence_command_receipts_pkey
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "product_evidence_command_receipts_pkey"
        })
      )
    ).toThrow(IdempotencyConflictError);

    // 23505 uq_batch_facts_predecessor
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "uq_batch_facts_predecessor"
        })
      )
    ).toThrow(NonMonotonicRevisionError);

    // 23505 product_batch_facts_pkey
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "product_batch_facts_pkey"
        })
      )
    ).toThrow(NonMonotonicRevisionError);
  });

  it("translates foreign key and trigger protection errors", () => {
    // 23503 fk_product_batches_current_facts
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("fk violation"), {
          code: "23503",
          constraint: "fk_product_batches_current_facts"
        })
      )
    ).toThrow(NotFoundError);

    // 23503 fk_batch_facts_batch
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("fk violation"), {
          code: "23503",
          constraint: "fk_batch_facts_batch"
        }),
        { batchId: "018f0000-0002-7000-8000-000000000001" }
      )
    ).toThrow(NotFoundError);

    // 23503 fk_batch_facts_predecessor
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("fk violation"), {
          code: "23503",
          constraint: "fk_batch_facts_predecessor"
        })
      )
    ).toThrow(NonMonotonicRevisionError);

    // 23503 fk_product_batches_sku
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("fk violation"), {
          code: "23503",
          constraint: "fk_product_batches_sku"
        })
      )
    ).toThrow(CrossClientViolationError);

    // 23503 fk_product_skus_client RESTRICT delete violation
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("update or delete on table violates foreign key constraint"), {
          code: "23503",
          constraint: "fk_product_skus_client",
          detail: 'Key (client_id)=(018f...) is still referenced from table "product_skus".'
        })
      )
    ).toThrow(AccessDeniedError);

    // 23506 immutability trigger
    expect(() =>
      translateDatabaseError(
        Object.assign(
          new Error("CANNOT_MODIFY_IMMUTABLE_ENTITY: Table product_batch_facts is append-only"),
          {
            code: "23506"
          }
        )
      )
    ).toThrow(AccessDeniedError);

    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("Cannot create batch under archived SKU"), {
          code: "23506"
        })
      )
    ).toThrow(AccessDeniedError);

    // 23514 check violations
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("check violation"), {
          code: "23514",
          constraint: "chk_batch_facts_monotonic_rev"
        })
      )
    ).toThrow(NonMonotonicRevisionError);

    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("check violation"), {
          code: "23514",
          constraint: "chk_canonical_sku_format"
        })
      )
    ).toThrow(ProductValidationError);
  });

  it("translates concurrency conflicts (40001, 40P01, 55P03)", () => {
    const ctx = { clientId: "018f0000-0000-7000-8000-000000000001" };
    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("could not obtain lock on row in relation"), {
          code: "55P03"
        }),
        ctx
      )
    ).toThrow(ConcurrencyConflictError);

    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("deadlock detected"), {
          code: "40P01",
          table: "product_skus"
        })
      )
    ).toThrow(ConcurrencyConflictError);

    expect(() =>
      translateDatabaseError(
        Object.assign(new Error("could not serialize access"), {
          code: "40001"
        }),
        ctx
      )
    ).toThrow(ConcurrencyConflictError);
  });

  it("re-throws unhandled or non-registry database errors unchanged", () => {
    const unhandledUniqueErr = Object.assign(new Error("unhandled unique error"), {
      code: "23505",
      constraint: "unrelated_table_unique_idx"
    });
    expect(() => translateDatabaseError(unhandledUniqueErr)).toThrow(unhandledUniqueErr);

    const unhandledCheckErr = Object.assign(new Error("unhandled check constraint"), {
      code: "23514",
      constraint: "unrelated_scene_check"
    });
    expect(() => translateDatabaseError(unhandledCheckErr)).toThrow(unhandledCheckErr);

    const unhandledFkErr = Object.assign(new Error("unhandled fk error"), {
      code: "23503",
      constraint: "unrelated_fk_constraint"
    });
    expect(() => translateDatabaseError(unhandledFkErr)).toThrow(unhandledFkErr);

    const genericErr = new Error("syntax error");
    expect(() => translateDatabaseError(genericErr)).toThrow(genericErr);
  });

  it("passes identifiers into DuplicateSkuError and DuplicateLotError", () => {
    try {
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "uq_product_skus_canonical"
        }),
        { canonicalSku: "SKU-IDENT", clientId: "018f0000-0000-7000-8000-000000000001" }
      );
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateSkuError);
      const dup = err as DuplicateSkuError;
      expect(dup.details?.canonicalSku).toBe("SKU-IDENT");
      expect(dup.details?.clientId).toBe("018f0000-0000-7000-8000-000000000001");
    }

    try {
      translateDatabaseError(
        Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "uq_product_batches_lot"
        }),
        { lotIdentifier: "LOT-IDENT", skuId: "018f0000-0002-7000-8000-000000000001" }
      );
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateLotError);
      const dup = err as DuplicateLotError;
      expect(dup.details?.lotIdentifier).toBe("LOT-IDENT");
      expect(dup.details?.skuId).toBe("018f0000-0002-7000-8000-000000000001");
    }
  });

  it("isProductRegistryDatabaseError accurately classifies registry errors", () => {
    expect(
      isProductRegistryDatabaseError(
        Object.assign(new Error("duplicate"), {
          code: "23505",
          constraint: "uq_product_skus_canonical"
        })
      )
    ).toBe(true);

    expect(
      isProductRegistryDatabaseError(
        Object.assign(new Error("fk violation"), {
          code: "23503",
          constraint: "fk_batch_facts_batch"
        })
      )
    ).toBe(true);

    expect(
      isProductRegistryDatabaseError(
        Object.assign(new Error("table error"), { code: "23505", table: "product_skus" })
      )
    ).toBe(true);

    expect(
      isProductRegistryDatabaseError(
        Object.assign(new Error("immutable trigger"), {
          code: "23506",
          message: "CANNOT_MODIFY_IMMUTABLE_ENTITY: Table product_batch_facts is append-only"
        })
      )
    ).toBe(true);

    expect(
      isProductRegistryDatabaseError(
        Object.assign(new Error("unrelated error"), { code: "23505", constraint: "campaigns_pkey" })
      )
    ).toBe(false);

    expect(isProductRegistryDatabaseError(new Error("arbitrary error"))).toBe(false);
  });

  it("preserves unrelated repository errors crossing the PostgresUnitOfWork boundary", async () => {
    const fakeClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
      getTransactionStatus: () => "T"
    } as unknown as PoolClient;

    const fakePool = {
      connect: vi.fn().mockResolvedValue(fakeClient)
    } as unknown as Pool;

    const uow = new PostgresUnitOfWork(fakePool);
    const unrelatedCheckError = Object.assign(new Error("check constraint violation"), {
      code: "23514",
      constraint: "unrelated_scene_check"
    });

    await expect(
      uow.execute(async () => {
        throw unrelatedCheckError;
      })
    ).rejects.toThrow(unrelatedCheckError);
  });
});
