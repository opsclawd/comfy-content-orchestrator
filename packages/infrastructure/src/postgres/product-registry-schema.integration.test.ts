import { mkdtemp, cp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import { insertClientRecord } from "./test-support/records.js";

describe("PostgreSQL product registry schema and protection integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../migrations/", import.meta.url);

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
  });

  afterEach(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
  });

  it("applies migration 026 and registers exact tables and constraints", async () => {
    const applied = await runMigrations(client, { migrationsDirectory });
    expect(applied.some((m) => m.version === "026")).toBe(true);

    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'product!_%' ESCAPE '!'
       ORDER BY table_name ASC`
    );

    expect(tablesRes.rows.map((r) => r.table_name)).toEqual([
      "product_batch_facts",
      "product_batches",
      "product_evidence_command_receipts",
      "product_skus"
    ]);
  });

  it("enforces canonical SKU lexical format constraint at database boundary", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    // Valid canonical SKU
    await client.query(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3)`,
      [clientRecord.client_id, "SKU-VALID_01", "Valid Display Name"]
    );

    // Invalid: lowercase letters
    await expect(
      client.query(
        `INSERT INTO product_skus (client_id, canonical_sku, display_name)
         VALUES ($1, $2, $3)`,
        [clientRecord.client_id, "sku-lowercase", "Invalid SKU"]
      )
    ).rejects.toThrow(/chk_canonical_sku_format/);

    // Invalid: too short (< 3 chars)
    await expect(
      client.query(
        `INSERT INTO product_skus (client_id, canonical_sku, display_name)
         VALUES ($1, $2, $3)`,
        [clientRecord.client_id, "AB", "Too Short"]
      )
    ).rejects.toThrow(/chk_canonical_sku_format/);
  });

  it("enforces lot identifier lexical format constraint at database boundary", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-PRO-01", "Parent SKU"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // Direct insert with invalid lot code (contains spaces or illegal symbols)
    await expect(
      client.query(
        `INSERT INTO product_batches (client_id, sku_id, lot_identifier, display_name)
         VALUES ($1, $2, $3, $4)`,
        [clientRecord.client_id, skuId, "LOT WITH SPACES", "Bad Lot"]
      )
    ).rejects.toThrow(/chk_lot_identifier_format/);
  });

  it("enforces circular deferred FK on batch creation and rejects committed head without facts", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-TEA-01", "Green Tea"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // Transaction that inserts head but forgets to insert initial facts revision 1
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, $3, $4, 1, 1)`,
      [clientRecord.client_id, skuId, "LOT-01", "Batch 1"]
    );

    // Commit must fail on deferred constraint fk_product_batches_current_facts
    await expect(client.query("COMMIT")).rejects.toThrow(/fk_product_batches_current_facts/);
    await client.query("ROLLBACK").catch(() => {});
  });

  it("enforces contiguous predecessor on batch facts", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-TEA-01", "Green Tea"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, $3, $4, 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId, "LOT-01", "Batch 1"]
    );
    const batchId = batchRes.rows[0]!.batch_id;

    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'system', NULL)`,
      [clientRecord.client_id, batchId]
    );
    await client.query("COMMIT");

    // Attempt to insert non-contiguous revision (revision 3 skipping 2, or superseding 0)
    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
         VALUES ($1, $2, 3, 'unknown', 'system', 1)`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/chk_batch_facts_monotonic_rev/);
  });

  it("enforces rejection of origin evidence links without batch evidence link via foreign key constraint", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-TEA-01", "Green Tea"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, $3, $4, 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId, "LOT-01", "Batch 1"]
    );
    const batchId = batchRes.rows[0]!.batch_id;

    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, origin_evidence_id, origin_evidence_revision, asserted_by)
         VALUES ($1, $2, 1, 'own_production', uuidv7(), 1, 'tester')`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/fk_batch_facts_origin_evidence/);
    await client.query("ROLLBACK");
  });

  it("rejects cross-client foreign key linkage at database boundary", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientA = await insertClientRecord(client);
    const clientB = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientA.client_id, "SKU-A-01", "Client A SKU"]
    );
    const skuIdA = skuRes.rows[0]!.sku_id;

    // Client B attempts to create a batch pointing to Client A's SKU
    await expect(
      client.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name)
         VALUES (uuidv7(), $1, $2, $3, $4)`,
        [clientB.client_id, skuIdA, "LOT-01", "Cross Client Batch"]
      )
    ).rejects.toThrow(/fk_product_batches_sku/);
  });

  it("rejects direct SQL mutation of immutable columns on SKU and Batch heads", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-IMMUTABLE", "Original Name"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // Create batch under SKU
    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, 'LOT-IMMUTABLE', 'Original Batch', 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId]
    );
    const batchId = batchRes.rows[0]!.batch_id;
    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'tester', NULL)`,
      [clientRecord.client_id, batchId]
    );
    await client.query("COMMIT");

    // 1. Attempt to update canonical_sku on product_skus
    await expect(
      client.query(
        `UPDATE product_skus SET canonical_sku = 'SKU-MUTATED', version = 2 WHERE sku_id = $1`,
        [skuId]
      )
    ).rejects.toThrow(/Permanent SKU identity columns cannot be updated/);

    // 2. Attempt to update client_id on product_skus
    await expect(
      client.query(`UPDATE product_skus SET client_id = uuidv7(), version = 2 WHERE sku_id = $1`, [
        skuId
      ])
    ).rejects.toThrow(/Permanent SKU identity columns cannot be updated/);

    // 3. Attempt to update sku_id on product_skus
    await expect(
      client.query(`UPDATE product_skus SET sku_id = uuidv7(), version = 2 WHERE sku_id = $1`, [
        skuId
      ])
    ).rejects.toThrow(/Permanent SKU identity columns cannot be updated/);

    // 4. Attempt to update created_at on product_skus
    await expect(
      client.query(
        `UPDATE product_skus SET created_at = CURRENT_TIMESTAMP, version = 2 WHERE sku_id = $1`,
        [skuId]
      )
    ).rejects.toThrow(/Permanent SKU identity columns cannot be updated/);

    // 5. Attempt to update client_id on product_batches
    await expect(
      client.query(
        `UPDATE product_batches SET client_id = uuidv7(), version = 2 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Permanent Batch identity columns cannot be updated/);

    // 6. Attempt to update sku_id on product_batches
    await expect(
      client.query(
        `UPDATE product_batches SET sku_id = uuidv7(), version = 2 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Permanent Batch identity columns cannot be updated/);

    // 7. Attempt to update batch_id on product_batches
    await expect(
      client.query(
        `UPDATE product_batches SET batch_id = uuidv7(), version = 2 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Permanent Batch identity columns cannot be updated/);

    // 8. Attempt to update lot_identifier on product_batches
    await expect(
      client.query(
        `UPDATE product_batches SET lot_identifier = 'LOT-MUTATED', version = 2 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Permanent Batch identity columns cannot be updated/);

    // 9. Attempt to update created_at on product_batches
    await expect(
      client.query(
        `UPDATE product_batches SET created_at = CURRENT_TIMESTAMP, version = 2 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Permanent Batch identity columns cannot be updated/);
  });

  it("rejects direct SQL unarchive or mutation of archived SKU or Batch", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-ARCH", "To Archive"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // Create batch under SKU
    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, 'LOT-ARCH', 'Batch to Archive', 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId]
    );
    const batchId = batchRes.rows[0]!.batch_id;
    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'tester', NULL)`,
      [clientRecord.client_id, batchId]
    );
    await client.query("COMMIT");

    // Archive SKU legally
    await client.query(
      `UPDATE product_skus SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = 2 WHERE sku_id = $1`,
      [skuId]
    );

    // Direct attempt to unarchive SKU
    await expect(
      client.query(`UPDATE product_skus SET archived_at = NULL, version = 3 WHERE sku_id = $1`, [
        skuId
      ])
    ).rejects.toThrow(/Archived SKU cannot be unarchived/);

    // Direct attempt to mutate display_name of archived SKU
    await expect(
      client.query(
        `UPDATE product_skus SET display_name = 'Renamed', version = 3 WHERE sku_id = $1`,
        [skuId]
      )
    ).rejects.toThrow(/Archived SKU metadata cannot be updated/);

    // Archive Batch legally
    await client.query(
      `UPDATE product_batches SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = 2 WHERE batch_id = $1`,
      [batchId]
    );

    // Direct attempt to unarchive Batch
    await expect(
      client.query(
        `UPDATE product_batches SET archived_at = NULL, version = 3 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Archived Batch cannot be unarchived/);

    // Direct attempt to mutate display_name of archived Batch
    await expect(
      client.query(
        `UPDATE product_batches SET display_name = 'Renamed Batch', version = 3 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(/Archived Batch metadata cannot be updated/);
  });

  it("rejects direct SQL DELETE and UPDATE on heads, facts, and command receipts", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-DEL", "Del Test"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, 'LOT-DEL', 'Batch Del Test', 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId]
    );
    const batchId = batchRes.rows[0]!.batch_id;

    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'tester', NULL)`,
      [clientRecord.client_id, batchId]
    );

    const actionId = "018f0000-0001-7000-8000-000000000001";
    await client.query(
      `INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body)
       VALUES ($1, $2, 'createBatch', repeat('a', 64), 'tester', '{}'::jsonb)`,
      [clientRecord.client_id, actionId]
    );
    await client.query("COMMIT");

    // 1. DELETE on product_skus
    await expect(
      client.query(`DELETE FROM product_skus WHERE sku_id = $1`, [skuId])
    ).rejects.toThrow(/CANNOT_DELETE_HEAD_ENTITY/);

    // 2. DELETE on product_batches
    await expect(
      client.query(`DELETE FROM product_batches WHERE batch_id = $1`, [batchId])
    ).rejects.toThrow(/CANNOT_DELETE_HEAD_ENTITY/);

    // 3. DELETE on product_batch_facts
    await expect(
      client.query(`DELETE FROM product_batch_facts WHERE batch_id = $1`, [batchId])
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);

    // 4. UPDATE on product_batch_facts
    await expect(
      client.query(`UPDATE product_batch_facts SET asserted_by = 'tampered' WHERE batch_id = $1`, [
        batchId
      ])
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);

    // 5. DELETE on product_evidence_command_receipts
    await expect(
      client.query(`DELETE FROM product_evidence_command_receipts WHERE action_id = $1`, [actionId])
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);

    // 6. UPDATE on product_evidence_command_receipts
    await expect(
      client.query(
        `UPDATE product_evidence_command_receipts SET actor_id = 'tampered' WHERE action_id = $1`,
        [actionId]
      )
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);
  });

  it("rejects creating batch under archived SKU and appending facts to archived batch", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, $2, $3) RETURNING sku_id`,
      [clientRecord.client_id, "SKU-PAR-ARCH", "Parent"]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // Create active batch under SKU before archiving
    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, 'LOT-01', 'Batch 1', 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId]
    );
    const batchId = batchRes.rows[0]!.batch_id;

    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'tester', NULL)`,
      [clientRecord.client_id, batchId]
    );
    await client.query("COMMIT");

    // Archive the batch
    await client.query(
      `UPDATE product_batches SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = 2 WHERE batch_id = $1`,
      [batchId]
    );

    // Appending facts to archived batch fails trigger
    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
         VALUES ($1, $2, 2, 'unknown', 'tester', 1)`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/Cannot append facts to archived batch/);

    // Archive parent SKU
    await client.query(
      `UPDATE product_skus SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, version = 2 WHERE sku_id = $1`,
      [skuId]
    );

    // Batch insert under archived SKU fails trigger
    await expect(
      client.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name)
         VALUES (uuidv7(), $1, $2, 'LOT-02', 'Batch 2')`,
        [clientRecord.client_id, skuId]
      )
    ).rejects.toThrow(/Cannot create batch under archived SKU/);
  });

  it("rejects non-finite, infinite, and out-of-range timestamps and dates across all registry tables", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    // 1. Infinity created_at on product_skus
    await expect(
      client.query(
        `INSERT INTO product_skus (client_id, canonical_sku, display_name, created_at)
         VALUES ($1, 'SKU-INF-1', 'Name', 'infinity')`,
        [clientRecord.client_id]
      )
    ).rejects.toThrow(/chk_product_skus_created_at/);

    // 2. Infinity updated_at on product_skus
    await expect(
      client.query(
        `INSERT INTO product_skus (client_id, canonical_sku, display_name, updated_at)
         VALUES ($1, 'SKU-INF-2', 'Name', 'infinity')`,
        [clientRecord.client_id]
      )
    ).rejects.toThrow(/chk_product_skus_updated_at/);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, 'SKU-FINITE', 'Finite Name') RETURNING sku_id`,
      [clientRecord.client_id]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // 3. Infinity created_at on product_batches
    await expect(
      client.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, created_at)
         VALUES (uuidv7(), $1, $2, 'LOT-INF-1', 'Name', 'infinity')`,
        [clientRecord.client_id, skuId]
      )
    ).rejects.toThrow(/chk_product_batches_created_at/);

    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, 'LOT-FINITE', 'Finite Batch', 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId]
    );
    const batchId = batchRes.rows[0]!.batch_id;
    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'tester', NULL)`,
      [clientRecord.client_id, batchId]
    );
    await client.query("COMMIT");

    // 4. Infinity asserted_at on product_batch_facts
    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, asserted_at, supersedes_revision)
         VALUES ($1, $2, 2, 'unknown', 'tester', 'infinity', 1)`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/chk_batch_facts_asserted_at/);

    // 5. Infinity production_start_date on product_batch_facts
    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, production_start_date, supersedes_revision)
         VALUES ($1, $2, 2, 'unknown', 'tester', 'infinity', 1)`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/chk_batch_facts_production_start_date/);

    // 6. Infinity committed_at on product_evidence_command_receipts
    await expect(
      client.query(
        `INSERT INTO product_evidence_command_receipts (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
         VALUES ($1, uuidv7(), 'createSku', repeat('a', 64), 'tester', '{}'::jsonb, 'infinity')`,
        [clientRecord.client_id]
      )
    ).rejects.toThrow(/chk_receipt_committed_at/);
  });

  it("enforces timestamp ordering and batch facts check constraints", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);

    // 1. archived_at > updated_at on product_skus
    await expect(
      client.query(
        `INSERT INTO product_skus (client_id, canonical_sku, display_name, created_at, updated_at, archived_at)
         VALUES ($1, 'SKU-ORDER-ERR', 'Name', '2026-01-01 00:00:00Z', '2026-01-02 00:00:00Z', '2026-01-03 00:00:00Z')`,
        [clientRecord.client_id]
      )
    ).rejects.toThrow(/chk_product_skus_archived_at/);

    const skuRes = await client.query<{ sku_id: string }>(
      `INSERT INTO product_skus (client_id, canonical_sku, display_name)
       VALUES ($1, 'SKU-CHECK-1', 'Name') RETURNING sku_id`,
      [clientRecord.client_id]
    );
    const skuId = skuRes.rows[0]!.sku_id;

    // 2. archived_at > updated_at on product_batches
    await expect(
      client.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, created_at, updated_at, archived_at)
         VALUES (uuidv7(), $1, $2, 'LOT-ORDER-ERR', 'Name', '2026-01-01 00:00:00Z', '2026-01-02 00:00:00Z', '2026-01-03 00:00:00Z')`,
        [clientRecord.client_id, skuId]
      )
    ).rejects.toThrow(/chk_product_batches_archived_at/);

    await client.query("BEGIN");
    const batchRes = await client.query<{ batch_id: string }>(
      `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision)
       VALUES (uuidv7(), $1, $2, 'LOT-CHECK-1', 'Name', 1, 1) RETURNING batch_id`,
      [clientRecord.client_id, skuId]
    );
    const batchId = batchRes.rows[0]!.batch_id;
    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 1, 'unknown', 'tester', NULL)`,
      [clientRecord.client_id, batchId]
    );
    await client.query("COMMIT");

    // 3. Empty producer_identity_as_claimed rejects
    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, producer_identity_as_claimed, supersedes_revision)
         VALUES ($1, $2, 2, 'unknown', 'tester', '', 1)`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/chk_batch_facts_producer_identity/);

    // 4. Non-positive origin_evidence_revision rejects (0 or -1)
    await expect(
      client.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, origin_evidence_revision, supersedes_revision)
         VALUES ($1, $2, 2, 'unknown', 'tester', 0, 1)`,
        [clientRecord.client_id, batchId]
      )
    ).rejects.toThrow(/chk_batch_facts_origin_evidence_(all_or_none|revision)/);

    // 5. Head facts pointer skipping revision rejects in trigger
    await expect(
      client.query(
        `UPDATE product_batches SET current_facts_revision = 3, version = 2 WHERE batch_id = $1`,
        [batchId]
      )
    ).rejects.toThrow(
      /Batch facts pointer must be monotonically nondecreasing and advance by at most 1/
    );
  });

  it("verifies forward-upgrade applying 001-025, seeding data, then applying 026 cleanly", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "migration-upgrade-"));
    const srcDir = fileURLToPath(migrationsDirectory);

    const allFiles = await readdir(srcDir);

    // Copy migrations 001-025 only
    for (let i = 1; i <= 25; i++) {
      const prefix = String(i).padStart(3, "0");
      const filename = allFiles.find((f: string) => f.startsWith(prefix));
      if (filename) {
        await cp(join(srcDir, filename), join(tempDir, filename));
      }
    }

    const partialMigrationsDir = pathToFileURL(tempDir + "/");

    try {
      const initialApplied = await runMigrations(client, {
        migrationsDirectory: partialMigrationsDir
      });
      expect(initialApplied).toHaveLength(25);

      // Seed data into baseline tables
      const clientRecord = await insertClientRecord(client);
      expect(clientRecord.client_id).toBeDefined();

      // Now copy 026 into temp dir and run migrations again
      const file026 = allFiles.find((f: string) => f.startsWith("026"));
      if (file026) {
        await cp(join(srcDir, file026), join(tempDir, file026));
      }

      const upgraded = await runMigrations(client, {
        migrationsDirectory: partialMigrationsDir
      });
      expect(upgraded).toHaveLength(1);
      expect(upgraded[0]?.version).toBe("026");

      // Verify seeded client still intact
      const checkClient = await client.query("SELECT client_id FROM clients WHERE client_id = $1", [
        clientRecord.client_id
      ]);
      expect(checkClient.rows).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
