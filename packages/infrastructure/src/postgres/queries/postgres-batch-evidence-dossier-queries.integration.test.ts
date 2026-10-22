import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  createActionId,
  createBatchId,
  createClientId,
  createEvidenceId,
  createSha256Hex,
  createSourceObjectId,
  NotFoundError
} from "@cco/domain";
import { BatchEvidenceDossierSchema } from "@cco/contracts";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
import { PostgresUnitOfWork } from "../uow/postgres-unit-of-work.js";
import { PostgresBatchEvidenceDossierQueries } from "./postgres-batch-evidence-dossier-queries.js";

describe("PostgresBatchEvidenceDossierQueries DB Integration", () => {
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

  it("validates statementTimeoutMs bounds in constructor", () => {
    expect(
      () => new PostgresBatchEvidenceDossierQueries(pool, { statementTimeoutMs: -1 })
    ).toThrow();
    expect(
      () => new PostgresBatchEvidenceDossierQueries(pool, { statementTimeoutMs: 0 })
    ).toThrow();
    expect(
      () => new PostgresBatchEvidenceDossierQueries(pool, { statementTimeoutMs: 300001 })
    ).toThrow();
    expect(
      new PostgresBatchEvidenceDossierQueries(pool, { statementTimeoutMs: 15000 })
    ).toBeInstanceOf(PostgresBatchEvidenceDossierQueries);
  });

  it("fails closed when batch is not found", async () => {
    const { client_id: rawClientId } = await insertClientRecord(client);
    const clientId = createClientId(rawClientId);
    const queries = new PostgresBatchEvidenceDossierQueries(pool);

    await expect(
      queries.resolveDossier(clientId, createBatchId("018e69e0-8a6a-72cb-b1b7-ec79a1f73099"))
    ).rejects.toThrow(NotFoundError);
  });

  it("resolves complete dossier for synthetic SKU -> lot -> evidence + derivative -> CoA -> claim lifecycle", async () => {
    const { client_id: rawClientId } = await insertClientRecord(client, {
      companyName: "Dossier Test Client"
    });
    const clientId = createClientId(rawClientId);
    const uow = new PostgresUnitOfWork(pool);

    // 1. Create SKU
    const sku = await uow.execute(async (ctx) => {
      return ctx.productEvidence!.createSku({
        actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-21T10:00:00.000Z",
        payload: {
          canonicalSku: "SKU-DOSSIER-100",
          displayName: "Organic Tincture 1000mg"
        }
      });
    });
    const skuId = sku.skuId;

    // 2. Create Batch with initial facts
    const batchResult = await uow.execute(async (ctx) => {
      return ctx.productEvidence!.createBatch({
        actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73002"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-21T10:05:00.000Z",
        payload: {
          skuId,
          lotIdentifier: "LOT-DOSSIER-001",
          displayName: "Batch LOT-DOSSIER-001",
          initialFacts: {
            originKind: "own_production",
            producerIdentityAsClaimed: "Botanical Farms LLC",
            productionStartDate: "2026-10-01",
            productionEndDate: "2026-10-05",
            originEvidenceId: null,
            originEvidenceRevision: null
          }
        }
      });
    });
    const batchId = batchResult.batch.batchId;

    // 3. Register Source Object & Evidence Asset
    const sourceObjectId = createSourceObjectId("018e69e0-8a6a-72cb-b1b7-ec79a1f73030");
    const evidenceId = createEvidenceId("018e69e0-8a6a-72cb-b1b7-ec79a1f73040");
    const originalSha256 = createSha256Hex(
      "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b"
    );

    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO source_objects (
          client_id, source_object_id, storage_bucket, storage_object_key,
          original_sha256, detected_mime_type, byte_length, uploader_id,
          access_class, retention_class, retention_policy_version, availability
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          clientId,
          sourceObjectId,
          "godzspeed-evidence",
          `clients/${clientId}/evidence/originals/${originalSha256}`,
          originalSha256,
          "application/pdf",
          1048576,
          "actor-1",
          "restricted_original",
          "source_evidence_archive",
          "policy-v1",
          "available"
        ]
      );

      await client.query(
        `INSERT INTO evidence_assets (
          client_id, evidence_id, current_revision, version, created_at
        ) VALUES ($1, $2, 1, 1, NOW())`,
        [clientId, evidenceId]
      );

      await client.query(
        `INSERT INTO evidence_revisions (
          client_id, evidence_id, revision, source_object_id, source_class,
          acquisition_method, submitted_by, submitted_at, assertion_text,
          rights_status, consent_status
        ) VALUES ($1, $2, 1, $3, 'coa', 'direct_upload', 'actor-1', NOW(), 'Lab test report', 'granted', 'granted')`,
        [clientId, evidenceId, sourceObjectId]
      );

      await client.query(
        `INSERT INTO batch_evidence_links (
          client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by, asserted_at
        ) VALUES ($1, $2, $3, 1, 'coa_test_report', 'actor-1', NOW())`,
        [clientId, batchId, evidenceId]
      );

      // 4. Create CoA Report & Revision & Measurement
      const reportId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73050";
      await client.query(
        `INSERT INTO coa_reports (
          client_id, report_id, batch_id, evidence_id, current_revision, version, created_at
        ) VALUES ($1, $2, $3, $4, 1, 1, NOW())`,
        [clientId, reportId, batchId, evidenceId]
      );

      await client.query(
        `INSERT INTO coa_report_revisions (
          client_id, report_id, revision, batch_id, evidence_id, evidence_revision,
          completeness_status, report_identifier_as_claimed, report_date,
          lab_name_as_claimed, sample_identifier_as_claimed, scope_kind,
          scope_description, sampling_method_description,
          sample_to_batch_association_confirmed, sample_to_batch_association_attestation,
          asserted_by, asserted_at
        ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'COA-001', '2026-10-18', 'Steep Hill Labs', 'SMP-01', 'attributed_lot', 'Chemical profile', 'Composite sample', true, 'Tag verified', 'actor-1', NOW())`,
        [clientId, reportId, batchId, evidenceId]
      );

      await client.query(
        `INSERT INTO coa_measurements (
          measurement_id, client_id, report_id, report_revision, batch_id,
          evidence_id, evidence_revision, analyte, result_kind, result_value,
          unit, basis, context, quantity_kind
        ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'CBD', 'quantified', '25.5000', 'mg_per_g', 'dry_weight', 'oil', 'mass_fraction')`,
        ["018e69e0-8a6a-72cb-b1b7-ec79a1f73060", clientId, reportId, batchId, evidenceId]
      );

      // 5. Create Claim & Revision & Evidence Link
      const claimId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73070";
      await client.query(
        `INSERT INTO product_claims (
          claim_id, client_id, sku_id, batch_id, current_revision, state,
          version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 1, 'reviewer_approved', 1, NOW(), NOW())`,
        [claimId, clientId, skuId, batchId]
      );

      await client.query(
        `INSERT INTO product_claim_revisions (
          client_id, claim_id, revision, batch_id, canonical_kind, proof_category,
          parameters_json, policy_version, asserted_by, asserted_at
        ) VALUES ($1, $2, 1, $3, 'certificate_panel_measurement', 'coa_measurement_backed', '{"kind":"certificate_panel_measurement","measurements":[{"analyte":"CBD","exactDecimalValue":"25.5000","unit":"mg_per_g","quantityKind":"mass_fraction","basis":"dry_weight","context":"oil","requiredScope":"attributed_lot"}]}', 'policy-v1', 'actor-1', NOW())`,
        [clientId, claimId, batchId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }

    // Resolve Dossier
    const queries = new PostgresBatchEvidenceDossierQueries(pool);
    const dossier = await queries.resolveDossier(clientId, batchId);

    expect(dossier.schemaVersion).toBe("1.0.0");
    expect(dossier.clientId).toBe(clientId);
    expect(dossier.sku.skuId).toBe(skuId);
    expect(dossier.batch.batchId).toBe(batchId);
    expect(dossier.factsHistory).toHaveLength(1);
    expect(dossier.evidenceLinks).toHaveLength(1);
    expect(dossier.evidence).toHaveLength(1);
    expect(dossier.evidence[0]!.sourceObjects).toHaveLength(1);
    expect(dossier.evidence[0]!.sourceObjects[0]!.originalSha256).toBe(originalSha256);
    expect(dossier.coaReports).toHaveLength(1);
    expect(dossier.coaReports[0]!.currentRevision.measurements).toHaveLength(1);
    expect(dossier.claims).toHaveLength(1);
    expect(dossier.claims[0]!.claim.state).toBe("reviewer_approved");

    // Strictly validates against BatchEvidenceDossierSchema
    expect(BatchEvidenceDossierSchema.safeParse(dossier).success).toBe(true);
  });
});
