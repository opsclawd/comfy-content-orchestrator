import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
import { PostgresUnitOfWork } from "../uow/postgres-unit-of-work.js";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  createSha256Hex,
  createSourceObjectId,
  ProductValidationError,
  StaleRevisionConflictError,
  type ClaimId
} from "@cco/domain";
import type { CommandEnvelope } from "@cco/application";
import type {
  CreateClaimRequest,
  InvalidateClaimRequest,
  LinkClaimEvidenceRequest,
  ReviewClaimRequest
} from "@cco/contracts";

describe("PostgresProductClaimRepository DB Integration", () => {
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

  afterEach(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
  });

  async function setupBatchAndCoa(c: PoolClient, clientId: string, lot = "LOT-001") {
    await c.query("BEGIN");
    try {
      await c.query("SET CONSTRAINTS fk_product_batches_current_facts DEFERRED");
      const skuId = crypto.randomUUID();
      await c.query(
        `INSERT INTO product_skus (sku_id, client_id, canonical_sku, display_name)
         VALUES ($1, $2, $3, $4)`,
        [skuId, clientId, `SKU-${lot}`, "Test SKU"]
      );

      const batchId = crypto.randomUUID();
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

      const sourceObjectId = crypto.randomUUID();
      const sha256 = crypto
        .createHash("sha256")
        .update(Buffer.from(`${clientId}:${lot}:${sourceObjectId}`))
        .digest("hex");
      await c.query(
        `INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, retention_policy_version)
         VALUES ($1, $2, 'evidence', $4, $3, 'application/pdf', 1024, 'uploader', 'v1')`,
        [sourceObjectId, clientId, sha256, `coa-${sourceObjectId}.pdf`]
      );

      const evidenceId = crypto.randomUUID();
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

      const reportId = crypto.randomUUID();
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

      const measurementId = crypto.randomUUID();
      await c.query(
        `INSERT INTO coa_measurements (
           measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
           analyte, result_kind, result_value, unit, basis, context, quantity_kind
         ) VALUES ($1, $2, $3, 1, $4, $5, 1, 'THCA', 'quantified', '24.5000', 'percent_w_w', 'dry_weight', 'flower', 'mass_fraction')`,
        [measurementId, clientId, reportId, batchId, evidenceId]
      );

      const reviewEventId = crypto.randomUUID();
      await c.query(
        `INSERT INTO coa_report_review_events (event_id, client_id, report_id, report_revision, decision, actor_id, reason, assessed_scope)
         VALUES ($1, $2, $3, 1, 'approved', 'compliance-lead', 'Approved CoA', 'sample_only')`,
        [reviewEventId, clientId, reportId]
      );

      await c.query("COMMIT");
      return { skuId, batchId, evidenceId, sourceObjectId, sha256, reportId, measurementId };
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  }

  it("handles full claim lifecycle: create -> link -> review -> resolve", async () => {
    const { client_id: rawClientId } = await insertClientRecord(client, {
      companyName: "Client A"
    });
    const clientId = createClientId(rawClientId);
    const setup = await setupBatchAndCoa(client, rawClientId, "LOT-LIFECYCLE-001");
    const uow = new PostgresUnitOfWork(pool);

    // 1. Create claim
    const createCmd: CommandEnvelope<CreateClaimRequest> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T10:00:00.000Z",
      payload: {
        batchId: createBatchId(setup.batchId),
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          panelName: "Cannabinoids",
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
        },
        displayWording: "Tested at 24.5% THCA"
      }
    };

    const createResult = await uow.execute(async (ctx) => {
      return ctx.productClaims!.createClaim(createCmd);
    });

    expect(createResult.claim.state).toBe("draft");
    expect(createResult.claim.version).toBe(1);
    expect(createResult.revision.revision).toBe(1);
    const claimId = createResult.claim.claimId;

    // 2. Link claim evidence
    const linkCmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T11:00:00.000Z",
      payload: {
        claimId,
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Attached laboratory certificate",
        links: [
          {
            evidenceId: createEvidenceId(setup.evidenceId),
            evidenceRevision: 1,
            sourceObjectId: createSourceObjectId(setup.sourceObjectId),
            sourceSha256: createSha256Hex(setup.sha256),
            supportRole: "primary_measurement",
            reportId: createCoaReportId(setup.reportId),
            reportRevision: 1,
            measurementId: createCoaMeasurementId(setup.measurementId)
          }
        ]
      }
    };

    const linkResult = await uow.execute(async (ctx) => {
      return ctx.productClaims!.linkClaimEvidence(linkCmd);
    });

    expect(linkResult.claim.state).toBe("evidence_linked");
    expect(linkResult.claim.version).toBe(2);
    expect(linkResult.links).toHaveLength(1);

    // 3. Review claim - reviewer cannot be author (separation of duties)
    const selfReviewCmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "compliance-author", // Same as assertedBy
      timestamp: "2026-10-19T12:00:00.000Z",
      payload: {
        claimId,
        expectedVersion: 2,
        claimRevision: 1,
        decision: "approve",
        reason: "Self approval attempt"
      }
    };

    await expect(
      uow.execute(async (ctx) => ctx.productClaims!.reviewClaim(selfReviewCmd))
    ).rejects.toThrow(AccessDeniedError);

    // Review claim by distinct reviewer
    const validReviewCmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "distinct-reviewer",
      timestamp: "2026-10-19T12:30:00.000Z",
      payload: {
        claimId,
        expectedVersion: 2,
        claimRevision: 1,
        decision: "approve",
        reason: "Verified laboratory evidence linkage"
      }
    };

    const reviewResult = await uow.execute(async (ctx) => {
      return ctx.productClaims!.reviewClaim(validReviewCmd);
    });

    expect(reviewResult.claim.state).toBe("reviewer_approved");
    expect(reviewResult.claim.version).toBe(3);

    // 4. Resolve claim
    const resolution = await uow.execute(async (ctx) => {
      return ctx.productClaims!.resolveClaim(clientId, claimId);
    });

    expect(resolution.claim.state).toBe("reviewer_approved");
    expect(resolution.supportEligible).toBe(true);
    expect(resolution.evidenceLinkApproved).toBe(true);
    expect(resolution.provenanceCategory).toBe("lab_reported");
    expect(resolution.blockReasons).toHaveLength(0);
    expect(resolution.links).toHaveLength(1);
    expect(resolution.reviewEvents).toHaveLength(2); // evidence_linked + reviewer_approved
  });

  it("rejects review with stale expectedVersion", async () => {
    const { client_id: rawClientId } = await insertClientRecord(client, {
      companyName: "Client A"
    });
    const clientId = createClientId(rawClientId);
    const setup = await setupBatchAndCoa(client, rawClientId, "LOT-STALE-001");
    const uow = new PostgresUnitOfWork(pool);

    const createCmd: CommandEnvelope<CreateClaimRequest> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T10:00:00.000Z",
      payload: {
        batchId: createBatchId(setup.batchId),
        canonicalKind: "factual_lot_identifier",
        proofCategory: "production_record_backed",
        parameters: {
          kind: "factual_lot_identifier",
          lotIdentifier: "LOT-STALE-001"
        }
      }
    };

    const createResult = await uow.execute(async (ctx) =>
      ctx.productClaims!.createClaim(createCmd)
    );
    const claimId = createResult.claim.claimId;

    // Review with wrong expectedVersion (5 instead of 1)
    const reviewCmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "distinct-reviewer",
      timestamp: "2026-10-19T11:00:00.000Z",
      payload: {
        claimId,
        expectedVersion: 5,
        claimRevision: 1,
        decision: "approve",
        reason: "Approval"
      }
    };

    await expect(
      uow.execute(async (ctx) => ctx.productClaims!.reviewClaim(reviewCmd))
    ).rejects.toThrow(StaleRevisionConflictError);
  });

  it("successfully invalidates a claim and updates claim state and decision event", async () => {
    const { client_id: rawClientId } = await insertClientRecord(client, {
      companyName: "Client Invalidate"
    });
    const clientId = createClientId(rawClientId);
    const setup = await setupBatchAndCoa(client, rawClientId, "LOT-INV-001");
    const uow = new PostgresUnitOfWork(pool);

    const createCmd: CommandEnvelope<CreateClaimRequest> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73001"),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T10:00:00.000Z",
      payload: {
        batchId: createBatchId(setup.batchId),
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          panelName: "Cannabinoids",
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
        },
        displayWording: "Tested at 24.5% THCA"
      }
    };

    const createResult = await uow.execute(async (ctx) =>
      ctx.productClaims!.createClaim(createCmd)
    );
    const claimId = createResult.claim.claimId;

    const linkCmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73003"),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T10:30:00.000Z",
      payload: {
        claimId,
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Attached laboratory certificate",
        links: [
          {
            evidenceId: createEvidenceId(setup.evidenceId),
            evidenceRevision: 1,
            sourceObjectId: createSourceObjectId(setup.sourceObjectId),
            sourceSha256: createSha256Hex(setup.sha256),
            supportRole: "primary_measurement",
            reportId: createCoaReportId(setup.reportId),
            reportRevision: 1,
            measurementId: createCoaMeasurementId(setup.measurementId),
            pinnedFactsRevision: 1
          }
        ]
      }
    };

    await uow.execute(async (ctx) => ctx.productClaims!.linkClaimEvidence(linkCmd));

    // 1. Invalidation of a healthy claim is rejected without writes
    const healthyInvCmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73002"),
      clientId,
      actorId: "compliance-reviewer",
      timestamp: "2026-10-19T11:00:00.000Z",
      payload: {
        claimId,
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73002",
        expectedVersion: 2,
        claimRevision: 1,
        invalidationCause: "batch_facts_changed",
        reason: "Facts have changed"
      }
    };

    await expect(
      uow.execute(async (ctx) => ctx.productClaims!.invalidateClaim(healthyInvCmd))
    ).rejects.toThrow(ProductValidationError);

    // Verify rollback: state and version remain unchanged
    const unmutated = await uow.execute(async (ctx) =>
      ctx.productClaims!.getClaimById(clientId, claimId)
    );
    expect(unmutated?.state).toBe("evidence_linked");
    expect(unmutated?.version).toBe(2);

    // 2. Introduce genuine dependency failure: corrupt source digest on link
    await client.query(
      "ALTER TABLE claim_source_links DISABLE TRIGGER trg_protect_claim_source_links"
    );
    await client.query(
      `UPDATE claim_source_links
       SET source_sha256 = '0000000000000000000000000000000000000000000000000000000000000000'
       WHERE client_id = $1 AND claim_id = $2`,
      [rawClientId, claimId]
    );
    await client.query(
      "ALTER TABLE claim_source_links ENABLE TRIGGER trg_protect_claim_source_links"
    );

    // 3. Mismatched invalidation cause on corrupted claim is rejected without writes
    const mismatchedCmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73007"),
      clientId,
      actorId: "compliance-reviewer",
      timestamp: "2026-10-19T11:10:00.000Z",
      payload: {
        claimId,
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73007",
        expectedVersion: 2,
        claimRevision: 1,
        invalidationCause: "source_superseded",
        reason: "Wrong cause assertion"
      }
    };
    await expect(
      uow.execute(async (ctx) => ctx.productClaims!.invalidateClaim(mismatchedCmd))
    ).rejects.toThrow(ProductValidationError);

    // 4. Invalidate with matching cause (integrity_failure) derives real source ref and succeeds
    const validInvCmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73004"),
      clientId,
      actorId: "compliance-reviewer",
      timestamp: "2026-10-19T11:15:00.000Z",
      payload: {
        claimId,
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73004",
        expectedVersion: 2,
        claimRevision: 1,
        invalidationCause: "integrity_failure",
        reason: "Source digest mismatch detected on primary evidence"
      }
    };

    const invResult = await uow.execute(async (ctx) =>
      ctx.productClaims!.invalidateClaim(validInvCmd)
    );
    expect(invResult.claim.state).toBe("invalidated");
    expect(invResult.claim.version).toBe(3);
    expect(invResult.claim.invalidationCause).toBe("integrity_failure");
    expect(invResult.claim.invalidationSourceRef).toBe(setup.sourceObjectId);
    expect(invResult.decisionEvent.decision).toBe("invalidate");
    expect(invResult.decisionEvent.invalidationCause).toBe("integrity_failure");

    // 5. Idempotent replay with identical actionId returns stored receipt before terminal-state check
    const replayResult = await uow.execute(async (ctx) =>
      ctx.productClaims!.invalidateClaim(validInvCmd)
    );
    expect(replayResult.claim.state).toBe("invalidated");
    expect(replayResult.claim.version).toBe(3);
    expect(replayResult.decisionEvent.eventId).toBe(invResult.decisionEvent.eventId);

    // 6. Stale expectedVersion conflict on terminal claim is rejected
    const staleCmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73005"),
      clientId,
      actorId: "compliance-reviewer",
      timestamp: "2026-10-19T11:20:00.000Z",
      payload: {
        claimId,
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73005",
        expectedVersion: 2,
        claimRevision: 1,
        invalidationCause: "integrity_failure",
        reason: "Stale version invalidation"
      }
    };
    await expect(
      uow.execute(async (ctx) => ctx.productClaims!.invalidateClaim(staleCmd))
    ).rejects.toThrow(StaleRevisionConflictError);

    // 7. Invalidation of already terminal claim with a new actionId is rejected without writes
    const terminalInvCmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }> =
      {
        actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73006"),
        clientId,
        actorId: "compliance-reviewer",
        timestamp: "2026-10-19T11:25:00.000Z",
        payload: {
          claimId,
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73006",
          expectedVersion: 3,
          claimRevision: 1,
          invalidationCause: "integrity_failure",
          reason: "Terminal claim re-invalidation"
        }
      };
    await expect(
      uow.execute(async (ctx) => ctx.productClaims!.invalidateClaim(terminalInvCmd))
    ).rejects.toThrow(ProductValidationError);

    // 8. Automatic cascade invalidation on batch facts update
    const setup2 = await setupBatchAndCoa(client, rawClientId, "LOT-INV-002");
    const createCmd2: CommandEnvelope<CreateClaimRequest> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73010"),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T12:00:00.000Z",
      payload: {
        batchId: createBatchId(setup2.batchId),
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          panelName: "Cannabinoids",
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
        },
        displayWording: "Tested at 24.5% THCA"
      }
    };
    const createRes2 = await uow.execute(async (ctx) => ctx.productClaims!.createClaim(createCmd2));
    const claimId2 = createRes2.claim.claimId;

    const linkCmd2: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018e69e0-8a6a-72cb-b1b7-ec79a1f73011"),
      clientId,
      actorId: "compliance-author",
      timestamp: "2026-10-19T12:05:00.000Z",
      payload: {
        claimId: claimId2,
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Attached laboratory certificate",
        links: [
          {
            evidenceId: createEvidenceId(setup2.evidenceId),
            evidenceRevision: 1,
            sourceObjectId: createSourceObjectId(setup2.sourceObjectId),
            sourceSha256: createSha256Hex(setup2.sha256),
            supportRole: "primary_measurement",
            reportId: createCoaReportId(setup2.reportId),
            reportRevision: 1,
            measurementId: createCoaMeasurementId(setup2.measurementId),
            pinnedFactsRevision: 1
          }
        ]
      }
    };
    await uow.execute(async (ctx) => ctx.productClaims!.linkClaimEvidence(linkCmd2));

    await client.query(
      `INSERT INTO product_batch_facts (client_id, batch_id, revision, origin_kind, asserted_by, supersedes_revision)
       VALUES ($1, $2, 2, 'own_production', 'Operator', 1)`,
      [rawClientId, setup2.batchId]
    );
    await client.query(
      `UPDATE product_batches SET current_facts_revision = 2, version = version + 1 WHERE batch_id = $1`,
      [setup2.batchId]
    );

    const autoInvalidated = await uow.execute(async (ctx) =>
      ctx.productClaims!.getClaimById(clientId, claimId2)
    );
    expect(autoInvalidated?.state).toBe("invalidated");
    expect(autoInvalidated?.version).toBe(3);
    expect(autoInvalidated?.invalidationCause).toBe("batch_facts_changed");
  });
});
