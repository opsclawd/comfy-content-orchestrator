import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import { insertClientRecord } from "./test-support/records.js";

describe("PostgreSQL Product Claim Schema & Protection Integration", () => {
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
    await runMigrations(client, { migrationsDirectory });
  });

  afterEach(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
  });

  async function setupBatch(c: PoolClient, clientId: string) {
    await c.query("BEGIN");
    try {
      await c.query("SET CONSTRAINTS fk_product_batches_current_facts DEFERRED");
      const skuId = crypto.randomUUID();
      await c.query(
        `INSERT INTO product_skus (sku_id, client_id, canonical_sku, display_name)
         VALUES ($1, $2, $3, $4)`,
        [skuId, clientId, "SKU-CLAIM-001", "Flower SKU"]
      );

      const batchId = crypto.randomUUID();
      await c.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [batchId, clientId, skuId, "LOT-CLAIM-001", "Batch 001"]
      );

      await c.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by)
         VALUES ($1, $2, 1, 'own_production', 'Compliance Officer')`,
        [clientId, batchId]
      );

      await c.query("COMMIT");
      return { skuId, batchId };
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  }

  it("applies migration 029 and verifies product_claims tables exist", async () => {
    const tablesRes = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN (
        'product_claims', 'product_claim_revisions', 'claim_source_links', 'claim_decision_events'
      )`
    );
    const tableNames = tablesRes.rows.map((r) => r.table_name);
    expect(tableNames).toContain("product_claims");
    expect(tableNames).toContain("product_claim_revisions");
    expect(tableNames).toContain("claim_source_links");
    expect(tableNames).toContain("claim_decision_events");
  });

  it("prevents UPDATE or DELETE on immutable claim_decision_events table", async () => {
    const { client_id: clientId } = await insertClientRecord(client, { companyName: "Client A" });
    const { skuId, batchId } = await setupBatch(client, clientId);
    const claimId = crypto.randomUUID();

    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO product_claims (claim_id, client_id, sku_id, batch_id, current_revision, state, version)
         VALUES ($1, $2, $3, $4, 1, 'draft', 1)`,
        [claimId, clientId, skuId, batchId]
      );

      await client.query(
        `INSERT INTO product_claim_revisions (client_id, claim_id, revision, batch_id, canonical_kind, proof_category, parameters_json, display_wording, policy_version, asserted_by)
         VALUES ($1, $2, 1, $3, 'factual_lot_identifier', 'production_record_backed', '{"kind":"factual_lot_identifier","lotIdentifier":"LOT-CLAIM-001"}', 'Lot identifier', '2026-03-31', 'analyst')`,
        [clientId, claimId, batchId]
      );

      const eventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO claim_decision_events (event_id, client_id, claim_id, claim_revision, decision, actor_id, reason, policy_version)
         VALUES ($1, $2, $3, 1, 'link_evidence', 'analyst', 'Evidence linked', '2026-03-31')`,
        [eventId, clientId, claimId]
      );
      await client.query("COMMIT");

      // Attempt UPDATE on immutable event
      await expect(
        client.query(`UPDATE claim_decision_events SET reason = 'Tampered' WHERE event_id = $1`, [
          eventId
        ])
      ).rejects.toThrow();

      // Attempt DELETE on immutable event
      await expect(
        client.query(`DELETE FROM claim_decision_events WHERE event_id = $1`, [eventId])
      ).rejects.toThrow();
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });

  it("prevents UPDATE or DELETE on immutable claim_source_links table", async () => {
    const { client_id: clientId } = await insertClientRecord(client, { companyName: "Client A" });
    const { skuId, batchId } = await setupBatch(client, clientId);
    const claimId = crypto.randomUUID();

    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO product_claims (claim_id, client_id, sku_id, batch_id, current_revision, state, version)
         VALUES ($1, $2, $3, $4, 1, 'draft', 1)`,
        [claimId, clientId, skuId, batchId]
      );

      await client.query(
        `INSERT INTO product_claim_revisions (client_id, claim_id, revision, batch_id, canonical_kind, proof_category, parameters_json, display_wording, policy_version, asserted_by)
         VALUES ($1, $2, 1, $3, 'factual_lot_identifier', 'production_record_backed', '{"kind":"factual_lot_identifier","lotIdentifier":"LOT-CLAIM-001"}', 'Lot identifier', '2026-03-31', 'analyst')`,
        [clientId, claimId, batchId]
      );

      const sourceObjectId = crypto.randomUUID();
      await client.query(
        `INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, retention_policy_version)
         VALUES ($1, $2, 'evidence', 'photo.jpg', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'image/jpeg', 1024, 'uploader', 'v1')`,
        [sourceObjectId, clientId]
      );

      const evidenceId = crypto.randomUUID();
      await client.query(
        `INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version)
         VALUES ($1, $2, 1, 1)`,
        [evidenceId, clientId]
      );

      await client.query(
        `INSERT INTO evidence_revisions (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method, submitted_by, assertion_text)
         VALUES ($1, $2, 1, $3, 'photo', 'direct_upload', 'Operator', 'Package photo')`,
        [clientId, evidenceId, sourceObjectId]
      );

      await client.query(
        `INSERT INTO batch_evidence_links (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by)
         VALUES ($1, $2, $3, 1, 'general_supporting_evidence', 'Operator')`,
        [clientId, batchId, evidenceId]
      );

      const linkId = crypto.randomUUID();
      await client.query(
        `INSERT INTO claim_source_links (link_id, client_id, claim_id, claim_revision, batch_id, evidence_id, evidence_revision, source_object_id, source_sha256, support_role)
         VALUES ($1, $2, $3, 1, $4, $5, 1, $6, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'visual_reference')`,
        [linkId, clientId, claimId, batchId, evidenceId, sourceObjectId]
      );
      await client.query("COMMIT");

      // Attempt UPDATE on immutable link
      await expect(
        client.query(
          `UPDATE claim_source_links SET support_role = 'primary_measurement' WHERE link_id = $1`,
          [linkId]
        )
      ).rejects.toThrow();

      // Attempt DELETE on immutable link
      await expect(
        client.query(`DELETE FROM claim_source_links WHERE link_id = $1`, [linkId])
      ).rejects.toThrow();
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  });

  it("enforces tenant boundary on claim creation", async () => {
    const { client_id: clientA } = await insertClientRecord(client, { companyName: "Client A" });
    const { client_id: clientB } = await insertClientRecord(client, { companyName: "Client B" });
    const { skuId, batchId } = await setupBatch(client, clientA);
    const claimId = crypto.randomUUID();

    // Client B attempts to create claim referencing Client A's batch
    await expect(
      client.query(
        `INSERT INTO product_claims (claim_id, client_id, sku_id, batch_id, current_revision, state, version)
         VALUES ($1, $2, $3, $4, 1, 'draft', 1)`,
        [claimId, clientB, skuId, batchId]
      )
    ).rejects.toThrow();
  });
});
