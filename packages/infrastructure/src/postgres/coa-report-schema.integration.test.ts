import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import { insertClientRecord } from "./test-support/records.js";

describe("PostgreSQL CoA report schema and protection integration", () => {
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

  async function setupBatchAndEvidence(c: PoolClient, clientId: string) {
    await c.query("BEGIN");
    try {
      const skuId = crypto.randomUUID();
      await c.query(
        `INSERT INTO product_skus (sku_id, client_id, canonical_sku, display_name)
         VALUES ($1, $2, $3, $4)`,
        [skuId, clientId, "SKU-COA-001", "Test Flower SKU"]
      );

      const batchId = crypto.randomUUID();
      await c.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [batchId, clientId, skuId, "LOT-COA-001", "Batch 001"]
      );

      await c.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by)
         VALUES ($1, $2, 1, 'own_production', 'Operator')`,
        [clientId, batchId]
      );

      const sourceObjectId = crypto.randomUUID();
      await c.query(
        `INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, retention_policy_version)
         VALUES ($1, $2, 'evidence', 'coa.pdf', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'application/pdf', 1024, 'uploader', 'v1')`,
        [sourceObjectId, clientId]
      );

      const evidenceId = crypto.randomUUID();
      await c.query(
        `INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version)
         VALUES ($1, $2, 1, 1)`,
        [evidenceId, clientId]
      );

      await c.query(
        `INSERT INTO evidence_revisions (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method, submitted_by, assertion_text)
         VALUES ($1, $2, 1, $3, 'coa', 'direct_upload', 'Operator', 'Original lab report PDF')`,
        [clientId, evidenceId, sourceObjectId]
      );

      await c.query(
        `INSERT INTO batch_evidence_links (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by)
         VALUES ($1, $2, $3, 1, 'coa_test_report', 'Operator')`,
        [clientId, batchId, evidenceId]
      );

      await c.query("COMMIT");
      return { skuId, batchId, sourceObjectId, evidenceId };
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  }

  it("applies migration 028 and creates all CoA tables and constraints", async () => {
    const applied = await runMigrations(client, { migrationsDirectory });
    expect(applied.some((m) => m.version === "028")).toBe(true);

    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'coa!_%' ESCAPE '!'
       ORDER BY table_name ASC`
    );

    expect(tablesRes.rows.map((r) => r.table_name)).toEqual([
      "coa_measurements",
      "coa_report_review_events",
      "coa_report_revisions",
      "coa_reports"
    ]);
  });

  it("allows transactional creation of report head, revision, and measurement with deferred current_rev FK", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();
    const measurementId = crypto.randomUUID();

    await client.query("BEGIN");

    // Insert head first (current_revision = 1 deferred FK)
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );

    // Insert revision
    await client.query(
      `INSERT INTO coa_report_revisions (
         client_id, report_id, revision, batch_id, evidence_id, evidence_revision,
         completeness_status, report_identifier_as_claimed, report_date, lab_name_as_claimed,
         sample_identifier_as_claimed, scope_kind, scope_description,
         sample_to_batch_association_confirmed, sample_to_batch_association_attestation,
         asserted_by
       ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Steep Hill', 'SMPL-1', 'sample_only', 'Sample tested', true, 'Lot matches CoC', 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );

    // Insert measurement
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.5000', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [measurementId, clientRecord.client_id, reportId, batchId, evidenceId]
    );

    await client.query("COMMIT");

    const reportCheck = await client.query(
      `SELECT current_revision, version FROM coa_reports WHERE report_id = $1`,
      [reportId]
    );
    expect(reportCheck.rows[0]?.current_revision).toBe(1);
  });

  it("enforces unique (client_id, batch_id, evidence_id) to prevent duplicate reports for same lineage", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const report1 = crypto.randomUUID();
    const report2 = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [report1, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, report1, batchId, evidenceId]
    );
    await client.query("COMMIT");

    // Second report with identical (client_id, batch_id, evidence_id) must be rejected
    await expect(
      client.query(
        `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
         VALUES ($1, $2, $3, $4, 1, 1)`,
        [report2, clientRecord.client_id, batchId, evidenceId]
      )
    ).rejects.toThrow(/uq_coa_reports_client_batch_evidence/);
  });

  it("enforces complete report revision requires at least one measurement at commit time", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );

    // Complete report without measurement
    await client.query(
      `INSERT INTO coa_report_revisions (
         client_id, report_id, revision, batch_id, evidence_id, evidence_revision,
         completeness_status, report_identifier_as_claimed, report_date, lab_name_as_claimed,
         sample_identifier_as_claimed, scope_kind, scope_description,
         sample_to_batch_association_confirmed, sample_to_batch_association_attestation,
         asserted_by
       ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Steep Hill', 'SMPL-1', 'sample_only', 'Sample tested', true, 'Lot matches CoC', 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );

    await expect(client.query("COMMIT")).rejects.toThrow(/must contain at least one measurement/);
  });

  it("enforces unique parameter context (analyte + basis + context) within report revision", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );

    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
    );

    // Duplicate analyte THCA with same basis and context
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '25.00', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/uq_coa_measurements_analyte_context/);

    await client.query("ROLLBACK");
  });

  it("enforces immutability triggers on coa_report_revisions and coa_measurements", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();
    const measurementId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [measurementId, clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query("COMMIT");

    // UPDATE on revision rejected
    await expect(
      client.query(`UPDATE coa_report_revisions SET asserted_by = 'Hacker' WHERE report_id = $1`, [
        reportId
      ])
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);

    // DELETE on measurement rejected
    await expect(
      client.query(`DELETE FROM coa_measurements WHERE measurement_id = $1`, [measurementId])
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);
  });

  it("enforces review event invariants: cannot approve draft report, exactly one decision per revision", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, completeness_status, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'draft', 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query("COMMIT");

    // Attempt to approve a draft revision
    await expect(
      client.query(
        `INSERT INTO coa_report_review_events (event_id, client_id, report_id, report_revision, decision, actor_id, reason, assessed_scope)
         VALUES ($1, $2, $3, 1, 'approved', 'Reviewer', 'Approved', 'sample_only')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId]
      )
    ).rejects.toThrow(/Cannot approve a draft CoA report revision/);
  });

  it("enforces fraction bounds (0..1) on fraction_w_w measurements", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );

    // Valid fraction (0.245)
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '0.2450', 'fraction_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
    );

    // Invalid fraction > 1 (1.0001)
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBDA', 'quantified', '1.0001', 'fraction_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_measurement_fraction_bounds/);

    await client.query("ROLLBACK");
  });

  it("enforces sample_to_batch_association_confirmed IS TRUE for complete reports", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );

    // Attempt complete revision with unconfirmed sample-to-batch association
    await expect(
      client.query(
        `INSERT INTO coa_report_revisions (
           client_id, report_id, revision, batch_id, evidence_id, evidence_revision, completeness_status,
           report_identifier_as_claimed, report_date, lab_name_as_claimed, sample_identifier_as_claimed,
           scope_kind, scope_description, sample_to_batch_association_attestation, sample_to_batch_association_confirmed, asserted_by
         ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Lab Inc', 'SMPL-1', 'sample_only', 'Sample description', 'Attestation', FALSE, 'Operator')`,
        [clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_report_complete_requirements/);

    await client.query("ROLLBACK");
  });

  it("enforces panel sealing trigger trg_enforce_coa_measurements_insert preventing insert after review", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (
         client_id, report_id, revision, batch_id, evidence_id, evidence_revision, completeness_status,
         report_identifier_as_claimed, report_date, lab_name_as_claimed, sample_identifier_as_claimed,
         scope_kind, scope_description, sample_to_batch_association_attestation, sample_to_batch_association_confirmed, asserted_by
       ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Lab Inc', 'SMPL-1', 'sample_only', 'Sample description', 'Attestation', TRUE, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBD', 'quantified', '1.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_review_events (
         event_id, client_id, report_id, report_revision, decision, actor_id, reason, assessed_scope
       ) VALUES ($1, $2, $3, 1, 'approved', 'Reviewer', 'Approved transcription', 'sample_only')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId]
    );
    await client.query("COMMIT");

    // Attempt to insert measurement into already-reviewed revision
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/Cannot insert measurements into an already reviewed CoA report revision/);
  });

  it("enforces non-self-approval at SQL level when reviewer actor_id matches asserted_by", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (
         client_id, report_id, revision, batch_id, evidence_id, evidence_revision, completeness_status,
         report_identifier_as_claimed, report_date, lab_name_as_claimed, sample_identifier_as_claimed,
         scope_kind, scope_description, sample_to_batch_association_attestation, sample_to_batch_association_confirmed, asserted_by
       ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Lab Inc', 'SMPL-1', 'sample_only', 'Sample description', 'Attestation', TRUE, 'Operator123')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBD', 'quantified', '1.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query("COMMIT");

    // Self-approval by Operator123 rejected by trigger
    await expect(
      client.query(
        `INSERT INTO coa_report_review_events (
           event_id, client_id, report_id, report_revision, decision, actor_id, reason, assessed_scope
         ) VALUES ($1, $2, $3, 1, 'approved', 'Operator123', 'Self-approving', 'sample_only')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId]
      )
    ).rejects.toThrow(/Self-approval forbidden/);
  });

  it("enforces panel sealing trigger preventing measurement insert into previously committed revision", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    // Transaction 1: Create report and revision 1 with initial measurement
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (
         client_id, report_id, revision, batch_id, evidence_id, evidence_revision, completeness_status,
         report_identifier_as_claimed, report_date, lab_name_as_claimed, sample_identifier_as_claimed,
         scope_kind, scope_description, sample_to_batch_association_attestation, sample_to_batch_association_confirmed, asserted_by
       ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Lab Inc', 'SMPL-1', 'sample_only', 'Sample description', 'Attestation', TRUE, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBD', 'quantified', '1.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query("COMMIT");

    // Transaction 2: Attempt to insert another measurement into committed revision 1
    await client.query("BEGIN");
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBG', 'quantified', '0.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/Cannot insert measurements into a previously committed CoA report revision/);
    await client.query("ROLLBACK");
  });

  it("enforces normalized parameter context uniqueness across casing and whitespace variations", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_measurements (
         measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
         analyte, result_kind, result_value, unit, basis, context, quantity_kind
       ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.50', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
      [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
    );

    // Variation in casing: 'thca', 'DRY_WEIGHT', 'FLOWER'
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'thca', 'quantified', '24.50', 'percent_w_w', 'DRY_WEIGHT', 'FLOWER', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/uq_coa_measurements_analyte_context_norm/);

    await client.query("ROLLBACK");
  });

  it("verifies restricted orchestrator app_role privileges and column-level UPDATE restrictions", async () => {
    const testRole = "test_coa_app_role";
    await client.query(`DROP ROLE IF EXISTS ${testRole}; CREATE ROLE ${testRole};`);

    try {
      await runMigrations(client, { migrationsDirectory, applicationRole: testRole });
      const clientRecord = await insertClientRecord(client);
      const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

      const reportId = crypto.randomUUID();

      // Check grants through the restricted role
      await client.query(`SET ROLE ${testRole}`);

      // 1. SELECT works
      const selRes = await client.query("SELECT count(*) FROM coa_reports");
      expect(selRes.rows).toBeDefined();

      // 2. INSERT works
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
         VALUES ($1, $2, $3, $4, 1, 1)`,
        [reportId, clientRecord.client_id, batchId, evidenceId]
      );
      await client.query(
        `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
         VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
        [clientRecord.client_id, reportId, batchId, evidenceId]
      );
      await client.query("COMMIT");

      // 3. UPDATE on immutable tables is denied
      await expect(
        client.query(`UPDATE coa_report_revisions SET completeness_status = 'complete'`)
      ).rejects.toThrow(/permission denied/);

      await expect(client.query(`UPDATE coa_measurements SET analyte = 'Hacked'`)).rejects.toThrow(
        /permission denied/
      );

      await expect(
        client.query(`UPDATE coa_report_review_events SET decision = 'approved'`)
      ).rejects.toThrow(/permission denied/);

      // 4. DELETE on any table is denied
      await expect(
        client.query(`DELETE FROM coa_reports WHERE report_id = $1`, [reportId])
      ).rejects.toThrow(/permission denied/);

      // 5. UPDATE on permanent identity columns of coa_reports is denied
      await expect(
        client.query(`UPDATE coa_reports SET client_id = $1 WHERE report_id = $2`, [
          crypto.randomUUID(),
          reportId
        ])
      ).rejects.toThrow(/permission denied/);

      // 6. UPDATE on allowed mutable columns of coa_reports is permitted
      await client.query(`UPDATE coa_reports SET version = 2 WHERE report_id = $1`, [reportId]);

      await client.query("RESET ROLE");
    } finally {
      await client.query("RESET ROLE").catch(() => {});
      await client.query(`DROP ROLE IF EXISTS ${testRole}`).catch(() => {});
    }
  });

  it("enforces head update trigger trg_enforce_coa_report_head_update preventing invalid version/revision jumps and unarchiving", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );
    await client.query("COMMIT");

    // 1. Version must advance by exactly 1 (skipping 1 -> 3 rejected)
    await expect(
      client.query(`UPDATE coa_reports SET version = 3 WHERE report_id = $1`, [reportId])
    ).rejects.toThrow(/CoA report version must advance by exactly 1/);

    // 2. Current revision must not decrease (1 -> 0 rejected)
    await expect(
      client.query(
        `UPDATE coa_reports SET version = 2, current_revision = 0 WHERE report_id = $1`,
        [reportId]
      )
    ).rejects.toThrow(/current_revision must be monotonically nondecreasing/);

    // 3. Current revision must not jump by more than 1 (1 -> 3 rejected)
    await expect(
      client.query(
        `UPDATE coa_reports SET version = 2, current_revision = 3 WHERE report_id = $1`,
        [reportId]
      )
    ).rejects.toThrow(/current_revision must be monotonically nondecreasing/);

    // 4. Archive report (legal update: version = 2, archived_at = NOW())
    await client.query(
      `UPDATE coa_reports SET version = 2, archived_at = NOW() WHERE report_id = $1`,
      [reportId]
    );

    // 5. Unarchiving an archived report is rejected
    await expect(
      client.query(`UPDATE coa_reports SET version = 3, archived_at = NULL WHERE report_id = $1`, [
        reportId
      ])
    ).rejects.toThrow(/Archived CoA report cannot be unarchived/);

    // 6. Modifying archived_at on an archived report is rejected
    await expect(
      client.query(
        `UPDATE coa_reports SET version = 3, archived_at = '9999-12-31' WHERE report_id = $1`,
        [reportId]
      )
    ).rejects.toThrow(/Archived CoA report cannot be unarchived or have archived_at modified/);
  });

  it("enforces measurement check constraints: result_kind variants, limits ordering, and unit contradictions", async () => {
    await runMigrations(client, { migrationsDirectory });
    const clientRecord = await insertClientRecord(client);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientRecord.client_id);

    const reportId = crypto.randomUUID();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
       VALUES ($1, $2, $3, $4, 1, 1)`,
      [reportId, clientRecord.client_id, batchId, evidenceId]
    );
    await client.query(
      `INSERT INTO coa_report_revisions (client_id, report_id, revision, batch_id, evidence_id, evidence_revision, asserted_by)
       VALUES ($1, $2, 1, $3, $4, 1, 'Operator')`,
      [clientRecord.client_id, reportId, batchId, evidenceId]
    );

    // 1. quantified measurement with result_limit is rejected
    await client.query("SAVEPOINT sp1");
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, result_limit, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THC', 'quantified', '20.0', '1.0', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_measurement_quantified/);
    await client.query("ROLLBACK TO SAVEPOINT sp1");

    // 2. below_limit measurement without result_qualifier is rejected
    await client.query("SAVEPOINT sp2");
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_limit, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBD', 'below_limit', '0.05', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_measurement_below_limit/);
    await client.query("ROLLBACK TO SAVEPOINT sp2");

    // 3. not_detected measurement with result_value is rejected
    await client.query("SAVEPOINT sp3");
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBN', 'not_detected', '0.0', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_measurement_not_detected/);
    await client.query("ROLLBACK TO SAVEPOINT sp3");

    // 4. limits ordering: detection_limit > quantification_limit is rejected
    await client.query("SAVEPOINT sp4");
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, detection_limit, quantification_limit, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBG', 'quantified', '2.0', '0.50', '0.10', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_measurement_metadata/);
    await client.query("ROLLBACK TO SAVEPOINT sp4");

    // 5. unit contradiction: percent_w_w with volume_fraction is rejected
    await client.query("SAVEPOINT sp5");
    await expect(
      client.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBC', 'quantified', '1.0', 'percent_w_w', 'dry_weight', 'flower', 'volume_fraction')`,
        [crypto.randomUUID(), clientRecord.client_id, reportId, batchId, evidenceId]
      )
    ).rejects.toThrow(/chk_coa_measurement_unit_contradictions/);
    await client.query("ROLLBACK TO SAVEPOINT sp5");

    await client.query("ROLLBACK");
  });
});
