import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import { insertClientRecord } from "./test-support/records.js";
import { PostgresUnitOfWork } from "./uow/postgres-unit-of-work.js";
import {
  createActionId,
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  createSha256Hex,
  createSourceObjectId,
  type ClaimId
} from "@cco/domain";
import type { CommandEnvelope } from "@cco/application";
import type {
  CreateClaimRequest,
  LinkClaimEvidenceRequest,
  ReviewClaimRequest
} from "@cco/contracts";

describe("PostgreSQL Product Claim Cascade Invalidation Integration", () => {
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

  async function setupApprovedClaim(c: PoolClient, clientId: string, lot = "LOT-INV-001") {
    const skuId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const sourceObjectId = crypto.randomUUID();
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const evidenceId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const measurementId = crypto.randomUUID();

    await c.query("BEGIN");
    try {
      await c.query("SET CONSTRAINTS fk_product_batches_current_facts DEFERRED");
      await c.query(
        `INSERT INTO product_skus (sku_id, client_id, canonical_sku, display_name)
         VALUES ($1, $2, $3, $4)`,
        [skuId, clientId, `SKU-${lot}`, "Test SKU"]
      );

      await c.query(
        `INSERT INTO product_batches (batch_id, client_id, sku_id, lot_identifier, display_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [batchId, clientId, skuId, lot, `Batch ${lot}`]
      );

      await c.query(
        `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by)
         VALUES ($1, $2, 1, 'own_production', 'Operator')`,
        [clientId, batchId]
      );

      await c.query(
        `INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, retention_policy_version)
         VALUES ($1, $2, 'evidence', 'coa.pdf', $3, 'application/pdf', 1024, 'uploader', 'v1')`,
        [sourceObjectId, clientId, sha256]
      );

      await c.query(
        `INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version)
         VALUES ($1, $2, 1, 1)`,
        [evidenceId, clientId]
      );

      await c.query(
        `INSERT INTO evidence_revisions (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method, submitted_by, assertion_text)
         VALUES ($1, $2, 1, $3, 'coa', 'direct_upload', 'Operator', 'Lab COA')`,
        [clientId, evidenceId, sourceObjectId]
      );

      await c.query(
        `INSERT INTO batch_evidence_links (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by)
         VALUES ($1, $2, $3, 1, 'coa_test_report', 'Operator')`,
        [clientId, batchId, evidenceId]
      );

      await c.query(
        `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version)
         VALUES ($1, $2, $3, $4, 1, 1)`,
        [reportId, clientId, batchId, evidenceId]
      );

      await c.query(
        `INSERT INTO coa_report_revisions (
           client_id, report_id, revision, batch_id, evidence_id, evidence_revision,
           completeness_status, report_identifier_as_claimed, report_date, lab_name_as_claimed,
           sample_identifier_as_claimed, scope_kind, scope_description,
           sample_to_batch_association_confirmed, sample_to_batch_association_attestation,
           asserted_by
         ) VALUES ($1, $2, 1, $3, $4, 1, 'complete', 'RPT-001', '2026-10-18', 'Steep Hill', 'SMPL-001', 'sample_only', 'Sample tested', true, 'Lot matches CoC', 'Operator')`,
        [clientId, reportId, batchId, evidenceId]
      );

      await c.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.5000', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [measurementId, clientId, reportId, batchId, evidenceId]
      );

      await c.query(
        `INSERT INTO coa_report_review_events (event_id, client_id, report_id, report_revision, decision, actor_id, reason, assessed_scope)
         VALUES ($1, $2, $3, 1, 'approved', 'compliance-lead', 'Approved CoA', 'sample_only')`,
        [crypto.randomUUID(), clientId, reportId]
      );

      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }

    const uow = new PostgresUnitOfWork(pool);
    const domainClientId = createClientId(clientId);

    // Create claim
    const createCmd: CommandEnvelope<CreateClaimRequest> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId: domainClientId,
      actorId: "author",
      timestamp: "2026-10-19T10:00:00.000Z",
      payload: {
        batchId: createBatchId(batchId),
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          measurements: [
            {
              analyte: "THCA",
              exactDecimalValue: "24.5000",
              unit: "percent_w_w",
              basis: "dry_weight",
              context: "flower",
              quantityKind: "mass_fraction",
              requiredScope: "sample_only"
            }
          ]
        }
      }
    };
    const { claim } = await uow.execute(async (ctx) => ctx.productClaims!.createClaim(createCmd));

    // Link evidence
    const linkCmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId: domainClientId,
      actorId: "author",
      timestamp: "2026-10-19T11:00:00.000Z",
      payload: {
        claimId: claim.claimId,
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Linking CoA",
        links: [
          {
            evidenceId: createEvidenceId(evidenceId),
            evidenceRevision: 1,
            sourceObjectId: createSourceObjectId(sourceObjectId),
            sourceSha256: createSha256Hex(sha256),
            supportRole: "primary_measurement",
            reportId: createCoaReportId(reportId),
            reportRevision: 1,
            measurementId: createCoaMeasurementId(measurementId)
          }
        ]
      }
    };
    await uow.execute(async (ctx) => ctx.productClaims!.linkClaimEvidence(linkCmd));

    // Review & approve
    const reviewCmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId: domainClientId,
      actorId: "distinct-reviewer",
      timestamp: "2026-10-19T12:00:00.000Z",
      payload: {
        claimId: claim.claimId,
        expectedVersion: 2,
        claimRevision: 1,
        decision: "approve",
        reason: "Evidence verified"
      }
    };
    await uow.execute(async (ctx) => ctx.productClaims!.reviewClaim(reviewCmd));

    return {
      claimId: claim.claimId,
      reportId,
      sourceObjectId,
      evidenceId,
      batchId
    };
  }

  it("atomically invalidates claim when CoA report is archived", async () => {
    const { client_id: clientId } = await insertClientRecord(client, {
      companyName: "Client Invalidation"
    });
    const { claimId, reportId } = await setupApprovedClaim(client, clientId);

    // Archiving the CoA report
    await client.query(
      `UPDATE coa_reports SET archived_at = NOW(), version = version + 1 WHERE report_id = $1`,
      [reportId]
    );

    // Verify claim state is automatically updated to invalidated
    const claimRes = await client.query(
      `SELECT state, version, invalidation_cause FROM product_claims WHERE claim_id = $1`,
      [claimId]
    );
    expect(claimRes.rows[0].state).toBe("invalidated");
    expect(claimRes.rows[0].invalidation_cause).toBe("source_archived");

    // Verify an invalidation decision event was appended
    const eventRes = await client.query(
      `SELECT decision, reason, invalidation_cause FROM claim_decision_events WHERE claim_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [claimId]
    );
    expect(eventRes.rows[0].decision).toBe("invalidate");
    expect(eventRes.rows[0].invalidation_cause).toBe("source_archived");
  });

  it("atomically invalidates claim when source object is quarantined", async () => {
    const { client_id: clientId } = await insertClientRecord(client, {
      companyName: "Client Invalidation 2"
    });
    const { claimId, sourceObjectId } = await setupApprovedClaim(client, clientId, "LOT-INV-002");

    // Quarantine the source object
    await client.query(
      `UPDATE source_objects SET availability = 'quarantined', quarantine_reason = 'Disputed sample custody by laboratory audit' WHERE source_object_id = $1`,
      [sourceObjectId]
    );

    // Verify claim state
    const claimRes = await client.query(
      `SELECT state, invalidation_cause FROM product_claims WHERE claim_id = $1`,
      [claimId]
    );
    expect(claimRes.rows[0].state).toBe("invalidated");
    expect(claimRes.rows[0].invalidation_cause).toBe("source_quarantined");
  });

  it("preserves original audit history without record rewrites upon invalidation", async () => {
    const { client_id: clientId } = await insertClientRecord(client, {
      companyName: "Client Invalidation 3"
    });
    const { claimId, reportId } = await setupApprovedClaim(client, clientId, "LOT-INV-003");

    // Archive CoA report to trigger invalidation
    await client.query(
      `UPDATE coa_reports SET archived_at = NOW(), version = version + 1 WHERE report_id = $1`,
      [reportId]
    );

    // Historical revisions and links are unchanged
    const revisionsRes = await client.query(
      `SELECT revision, canonical_kind, display_wording FROM product_claim_revisions WHERE claim_id = $1`,
      [claimId]
    );
    expect(revisionsRes.rows).toHaveLength(1);
    expect(revisionsRes.rows[0].revision).toBe(1);

    const linksRes = await client.query(
      `SELECT link_id, support_role FROM claim_source_links WHERE claim_id = $1`,
      [claimId]
    );
    expect(linksRes.rows).toHaveLength(1);

    // Resolve claim reflects blocked state with explicit block reason
    const uow = new PostgresUnitOfWork(pool);
    const resolved = await uow.execute(async (ctx) =>
      ctx.productClaims!.resolveClaim(createClientId(clientId), claimId)
    );

    expect(resolved.claim.state).toBe("invalidated");
    expect(resolved.supportEligible).toBe(false);
    expect(resolved.canRequestReview).toBe(false);
    expect(resolved.blockReasons.map((b) => b.code)).toContain("CLAIM_INVALIDATED");
  });
});
