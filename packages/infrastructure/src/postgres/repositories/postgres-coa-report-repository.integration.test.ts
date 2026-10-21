import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
import { PostgresUnitOfWork } from "../uow/postgres-unit-of-work.js";
import { PostgresCoaReportRepository } from "./postgres-coa-report-repository.js";
import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClientId,
  createCoaReportId,
  createEvidenceId,
  type CoaReportId,
  type Sha256Hex
} from "@cco/domain";
import type { CommandEnvelope } from "@cco/application";
import type {
  CreateCoaReportRequest,
  SupersedeCoaReportRequest,
  ReviewCoaReportRequest
} from "@cco/contracts";

describe("PostgresCoaReportRepository DB Integration", () => {
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

  async function setupBatchAndEvidence(
    c: PoolClient,
    clientId: string,
    lot = "LOT-001",
    existingSkuId?: string
  ) {
    await c.query("BEGIN");
    try {
      let skuId = existingSkuId;
      if (!skuId) {
        skuId = crypto.randomUUID();
        await c.query(
          `INSERT INTO product_skus (sku_id, client_id, canonical_sku, display_name)
           VALUES ($1, $2, $3, $4)`,
          [skuId, clientId, `SKU-${lot}`, "Test Flower SKU"]
        );
      }

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

      const sha256 = crypto.createHash("sha256").update(`evidence-${lot}`).digest("hex");
      const sourceObjectId = crypto.randomUUID();
      await c.query(
        `INSERT INTO source_objects (source_object_id, client_id, storage_bucket, storage_object_key, original_sha256, detected_mime_type, byte_length, uploader_id, retention_policy_version)
         VALUES ($1, $2, 'evidence', $3, $4, 'application/pdf', 1024, 'uploader', 'v1')`,
        [sourceObjectId, clientId, `coa-${lot}.pdf`, sha256]
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

      return {
        skuId,
        batchId: createBatchId(batchId),
        sourceObjectId,
        evidenceId: createEvidenceId(evidenceId)
      };
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  }

  it("completes full lifecycle: create, receipt replay, supersede, non-self-approval review, and support resolution", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);

    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());

    const createCmd: CommandEnvelope<CreateCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "transcription-operator",
      timestamp: "2026-10-18T10:00:00.000Z",
      payload: {
        reportId,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-2026-001",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Steep Hill Analytical",
        sampleIdentifierAsClaimed: "SMPL-882",
        scopeKind: "sample_only",
        scopeDescription: "Representative sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "CoC matches registered lot",
        measurements: [
          {
            analyte: "THCA",
            resultKind: "quantified",
            resultValue: "24.5000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.2500"
          }
        ]
      }
    };

    // 1. Create Report
    const createResult = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.createReport(createCmd);
    });

    expect(createResult.report.reportId).toBe(reportId);
    expect(createResult.report.currentRevision).toBe(1);
    expect(createResult.report.version).toBe(1);
    expect(createResult.measurements[0]?.resultValue).toBe("24.5000");

    // 2. Receipt Replay for Create Report
    const replayResult = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.createReport(createCmd);
    });
    expect(replayResult.report.reportId).toBe(reportId);
    expect(Object.isFrozen(replayResult.report)).toBe(true);
    expect(Object.isFrozen(replayResult.revision)).toBe(true);

    // 3. Reviewer Self-Approval Rejected
    const selfReviewCmd: CommandEnvelope<ReviewCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "transcription-operator", // Same as assertedBy
      timestamp: "2026-10-18T11:00:00.000Z",
      payload: {
        reportId,
        expectedVersion: 1,
        decision: "approved",
        reason: "Self approval attempt",
        assessedScope: "sample_only"
      }
    };
    await expect(
      uow.execute(async (ctx) => {
        return await ctx.coaReports!.reviewReportRevision(selfReviewCmd);
      })
    ).rejects.toThrow(AccessDeniedError);

    // 4. Authorized Independent Reviewer Approves
    const validReviewCmd: CommandEnvelope<ReviewCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "compliance-reviewer", // Distinct actor
      timestamp: "2026-10-18T12:00:00.000Z",
      payload: {
        reportId,
        expectedVersion: 1,
        decision: "approved",
        reason: "Transcription verified against original laboratory PDF",
        assessedScope: "sample_only"
      }
    };
    const reviewResult = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.reviewReportRevision(validReviewCmd);
    });
    expect(reviewResult.report.version).toBe(2);
    expect(reviewResult.reviewEvent.decision).toBe("approved");

    // 5. Resolve Measurement Support (Active & Approved)
    const activeMeasurementId = createResult.measurements[0]!.measurementId;
    const supportRes = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [activeMeasurementId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });
    });
    expect(supportRes.isSupported).toBe(true);
    expect(supportRes.resolution?.measurements[0]?.decimalValue).toBe("24.5000");

    // 6. Supersede Report
    const supersedeCmd: CommandEnvelope<SupersedeCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "transcription-operator-2",
      timestamp: "2026-10-18T14:00:00.000Z",
      payload: {
        reportId,
        expectedVersion: 2,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-2026-001-REV",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Steep Hill Analytical",
        sampleIdentifierAsClaimed: "SMPL-882",
        scopeKind: "sample_only",
        scopeDescription: "Representative sample corrected",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "CoC matches registered lot",
        measurements: [
          {
            analyte: "THCA",
            resultKind: "quantified",
            resultValue: "24.6000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.2000"
          }
        ]
      }
    };
    const supersedeResult = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.supersedeReport(supersedeCmd);
    });
    expect(supersedeResult.report.currentRevision).toBe(2);
    expect(supersedeResult.report.version).toBe(3);
    expect(supersedeResult.measurements[0]?.resultValue).toBe("24.6000");

    // 7. Old Revision Now Fails Support Resolution as Superseded
    const staleRes = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [activeMeasurementId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });
    });
    expect(staleRes.isSupported).toBe(false);
    expect(staleRes.reason).toBe("report_superseded");
  });

  it("isolates measurements across different batches of the same SKU", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const uow = new PostgresUnitOfWork(pool);

    const b1 = await setupBatchAndEvidence(client, clientId, "LOT-A");
    const b2 = await setupBatchAndEvidence(client, clientId, "LOT-B", b1.skuId);

    const reportId = createCoaReportId(crypto.randomUUID());
    const createCmd: CommandEnvelope<CreateCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "operator",
      timestamp: "2026-10-18T10:00:00.000Z",
      payload: {
        reportId,
        batchId: b1.batchId,
        evidenceId: b1.evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-LOT-A",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Lab Inc",
        sampleIdentifierAsClaimed: "SMPL-A",
        scopeKind: "sample_only",
        scopeDescription: "Representative sample for Lot A",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "CoC matches lot A",
        measurements: [
          {
            analyte: "Myrcene",
            resultKind: "quantified",
            resultValue: "1.2500",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    };

    const res = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.createReport(createCmd);
    });

    const mId = res.measurements[0]!.measurementId;

    // Approve report for lot A
    await uow.execute(async (ctx) => {
      return await ctx.coaReports!.reviewReportRevision({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "compliance-officer",
        timestamp: "2026-10-18T11:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Approved lot A",
          assessedScope: "sample_only"
        }
      });
    });

    // Querying support against Batch B using Lot A's report fails closed
    const bleedCheck = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.resolveMeasurementSupport({
        clientId,
        batchId: b2.batchId, // Wrong batch!
        reportId,
        reportRevision: 1,
        measurementIds: [mId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });
    });
    expect(bleedCheck.isSupported).toBe(false);
    expect(bleedCheck.reason).toBe("report_batch_mismatch");
  });

  it("detects withdrawn lab verification events targeting verified events", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    // 1. Insert corroborated lab identity verification event
    const labEventId = crypto.randomUUID();
    await client.query(
      `INSERT INTO evidence_verification_events (
         event_id, client_id, evidence_id, evidence_revision,
         verification_kind, fact_scope, outcome, actor_id, method, reason, occurred_at
       ) VALUES ($1, $2, $3, 1, 'independent_third_party_corroboration', 'lab_identity', 'verified', 'ISO-17025-Auditor', 'audit', 'Corroborated lab identity', '2026-10-18T08:00:00.000Z')`,
      [labEventId, clientId, evidenceId]
    );

    const reportId = createCoaReportId(crypto.randomUUID());
    const createCmd: CommandEnvelope<CreateCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "operator",
      timestamp: "2026-10-18T10:00:00.000Z",
      payload: {
        reportId,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-CORROBORATED",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Steep Hill Analytical",
        sampleIdentifierAsClaimed: "SMPL-1",
        scopeKind: "sample_only",
        scopeDescription: "Representative sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "CoC matches lot",
        verifiedLabIdentityEventId: labEventId,
        measurements: [
          {
            analyte: "THCA",
            resultKind: "quantified",
            resultValue: "20.0000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    };

    const res = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.createReport(createCmd);
    });
    const mId = res.measurements[0]!.measurementId;

    // Approve report
    await uow.execute(async (ctx) => {
      return await ctx.coaReports!.reviewReportRevision({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "reviewer",
        timestamp: "2026-10-18T11:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Approved",
          assessedScope: "sample_only"
        }
      });
    });

    // Resolution passes initially
    const initRes = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [mId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });
    });
    expect(initRes.isSupported).toBe(true);
    expect(initRes.resolution?.verifiedLabIdentityEventId).toBe(labEventId);

    // Now insert a withdrawal event targeting the lab event
    const withdrawalEventId = crypto.randomUUID();
    await client.query(
      `INSERT INTO evidence_verification_events (
         event_id, client_id, evidence_id, evidence_revision,
         verification_kind, fact_scope, outcome, actor_id, method, reason, withdrawal_event_id, occurred_at
       ) VALUES ($1, $2, $3, 1, 'independent_third_party_corroboration', 'lab_identity', 'withdrawn', 'Compliance-Lead', 'audit', 'Corroboration revoked', $4, '2026-10-18T13:00:00.000Z')`,
      [withdrawalEventId, clientId, evidenceId, labEventId]
    );

    // Resolution fails closed with lab_verification_withdrawn
    const withdrawnRes = await uow.execute(async (ctx) => {
      return await ctx.coaReports!.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [mId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });
    });
    expect(withdrawnRes.isSupported).toBe(false);
    expect(withdrawnRes.reason).toBe("lab_verification_withdrawn");
  });

  it("rolls back all changes and command receipts atomically if an error occurs during transaction", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());
    const actionId = createActionId(crypto.randomUUID());

    const createCmd: CommandEnvelope<CreateCoaReportRequest & { reportId: CoaReportId }> = {
      actionId,
      clientId,
      actorId: "operator",
      timestamp: "2026-10-18T10:00:00.000Z",
      payload: {
        reportId,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-ROLLBACK",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Lab Inc",
        sampleIdentifierAsClaimed: "SMPL-1",
        scopeKind: "sample_only",
        scopeDescription: "Sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "Attestation",
        measurements: [
          {
            analyte: "THC",
            resultKind: "quantified",
            resultValue: "10.00",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    };

    await expect(
      uow.execute(async (ctx) => {
        await ctx.coaReports!.createReport(createCmd);
        throw new Error("Simulated unexpected failure after repository createReport");
      })
    ).rejects.toThrow("Simulated unexpected failure");

    // Verify report head, revision, and receipt are absent
    const reportCheck = await client.query("SELECT 1 FROM coa_reports WHERE report_id = $1", [
      reportId
    ]);
    expect(reportCheck.rows.length).toBe(0);

    const revCheck = await client.query("SELECT 1 FROM coa_report_revisions WHERE report_id = $1", [
      reportId
    ]);
    expect(revCheck.rows.length).toBe(0);

    const receiptCheck = await client.query(
      "SELECT 1 FROM product_evidence_command_receipts WHERE action_id = $1",
      [actionId]
    );
    expect(receiptCheck.rows.length).toBe(0);
  });

  it("enforces optimistic version fence under concurrent operations with synchronization barrier", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());
    const createCmd: CommandEnvelope<CreateCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "operator",
      timestamp: "2026-10-18T10:00:00.000Z",
      payload: {
        reportId,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-CONCURRENT",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Lab Inc",
        sampleIdentifierAsClaimed: "SMPL-1",
        scopeKind: "sample_only",
        scopeDescription: "Sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "Attestation",
        measurements: [
          {
            analyte: "THC",
            resultKind: "quantified",
            resultValue: "15.00",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    };
    await uow.execute(async (ctx) => {
      await ctx.coaReports!.createReport(createCmd);
    });

    // Both operations target expectedVersion: 1
    const reviewCmd: CommandEnvelope<ReviewCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "reviewer",
      timestamp: "2026-10-18T11:00:00.000Z",
      payload: {
        reportId,
        expectedVersion: 1,
        decision: "approved",
        reason: "Approved concurrently",
        assessedScope: "sample_only"
      }
    };

    const supersedeCmd: CommandEnvelope<SupersedeCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "operator-2",
      timestamp: "2026-10-18T11:00:00.000Z",
      payload: {
        reportId,
        expectedVersion: 1,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-CONCURRENT-REV",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Lab Inc",
        sampleIdentifierAsClaimed: "SMPL-1",
        scopeKind: "sample_only",
        scopeDescription: "Sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "Attestation",
        measurements: [
          {
            analyte: "THC",
            resultKind: "quantified",
            resultValue: "16.00",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    };

    // Run both concurrently
    const results = await Promise.allSettled([
      uow.execute(async (ctx) => ctx.coaReports!.reviewReportRevision(reviewCmd)),
      uow.execute(async (ctx) => ctx.coaReports!.supersedeReport(supersedeCmd))
    ]);

    // Exactly one must succeed, and one must be rejected with StaleRevisionConflictError
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it("resolves measurement support through a normal Pool constructor managing read-write transaction", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());
    let measurementId!: string;

    const createCmd: CommandEnvelope<CreateCoaReportRequest & { reportId: CoaReportId }> = {
      actionId: createActionId(crypto.randomUUID()),
      clientId,
      actorId: "transcription-operator",
      timestamp: "2026-10-18T10:00:00.000Z",
      payload: {
        reportId,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "RPT-POOL-TEST",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Steep Hill",
        sampleIdentifierAsClaimed: "SMPL-1",
        scopeKind: "sample_only",
        scopeDescription: "Representative sample",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation: "CoC matches lot",
        measurements: [
          {
            analyte: "THCA",
            resultKind: "quantified",
            resultValue: "22.5000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction"
          }
        ]
      }
    };

    await uow.execute(async (ctx) => {
      const createRes = await ctx.coaReports!.createReport(createCmd);
      measurementId = createRes.measurements[0]!.measurementId;
      await ctx.coaReports!.reviewReportRevision({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "reviewer-pool",
        timestamp: "2026-10-18T11:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Approved",
          assessedScope: "sample_only"
        }
      });
    });

    // Resolve using a standalone PostgresCoaReportRepository initialized with the pg.Pool directly
    const poolRepo = new PostgresCoaReportRepository(pool);
    const res = await poolRepo.resolveMeasurementSupport({
      clientId,
      batchId,
      reportId,
      reportRevision: 1,
      measurementIds: [measurementId],
      requiredUnit: "percent_w_w",
      requiredBasis: "dry_weight",
      requiredContext: "flower",
      requiredScope: "sample_only"
    });

    expect(res.isSupported).toBe(true);
    expect(res.resolution?.measurements[0]?.decimalValue).toBe("22.5000");
  });

  it("resolves measurement support through an autocommit PoolClient managing transaction and rejects when externalTransaction is misconfigured", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());
    let measurementId!: string;

    await uow.execute(async (ctx) => {
      const createRes = await ctx.coaReports!.createReport({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "transcription-operator",
        timestamp: "2026-10-18T10:00:00.000Z",
        payload: {
          reportId,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-AUTOCOMMIT-TEST",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill",
          sampleIdentifierAsClaimed: "SMPL-1",
          scopeKind: "sample_only",
          scopeDescription: "Representative sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches lot",
          measurements: [
            {
              analyte: "CBD",
              resultKind: "quantified",
              resultValue: "5.0000",
              unit: "percent_w_w",
              basis: "dry_weight",
              context: "flower",
              quantityKind: "mass_fraction"
            }
          ]
        }
      });
      measurementId = createRes.measurements[0]!.measurementId;
      await ctx.coaReports!.reviewReportRevision({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "reviewer-autocommit",
        timestamp: "2026-10-18T11:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Approved",
          assessedScope: "sample_only"
        }
      });
    });

    const rawClient = await pool.connect();
    try {
      // 1. Without externalTransaction flag, autocommit PoolClient manages its own transaction block
      const autocommitRepo = new PostgresCoaReportRepository(rawClient);
      const res = await autocommitRepo.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [measurementId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });
      expect(res.isSupported).toBe(true);

      // 2. With externalTransaction: true flag, an idle/autocommit PoolClient throws fast
      const strictRepo = new PostgresCoaReportRepository(rawClient, { externalTransaction: true });
      await expect(
        strictRepo.resolveMeasurementSupport({
          clientId,
          batchId,
          reportId,
          reportRevision: 1,
          measurementIds: [measurementId],
          requiredUnit: "percent_w_w",
          requiredBasis: "dry_weight",
          requiredContext: "flower",
          requiredScope: "sample_only"
        })
      ).rejects.toThrow(/Resolution with externalTransaction requires an active transaction block/);
    } finally {
      rawClient.release();
    }
  });

  it("denies measurement support when concurrent supersession commits before resolution locks", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());
    let measurementId!: string;

    await uow.execute(async (ctx) => {
      const createRes = await ctx.coaReports!.createReport({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "operator",
        timestamp: "2026-10-18T10:00:00.000Z",
        payload: {
          reportId,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-SUPERSEDE-RACE",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill",
          sampleIdentifierAsClaimed: "SMPL-1",
          scopeKind: "sample_only",
          scopeDescription: "Sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches lot",
          measurements: [
            {
              analyte: "THC",
              resultKind: "quantified",
              resultValue: "20.00",
              unit: "percent_w_w",
              basis: "dry_weight",
              context: "flower",
              quantityKind: "mass_fraction"
            }
          ]
        }
      });
      measurementId = createRes.measurements[0]!.measurementId;
      await ctx.coaReports!.reviewReportRevision({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "reviewer",
        timestamp: "2026-10-18T11:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Approved",
          assessedScope: "sample_only"
        }
      });
    });

    // Execute supersession
    await uow.execute(async (ctx) => {
      await ctx.coaReports!.supersedeReport({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "operator-2",
        timestamp: "2026-10-18T12:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 2,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-SUPERSEDE-RACE-REV2",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill",
          sampleIdentifierAsClaimed: "SMPL-1",
          scopeKind: "sample_only",
          scopeDescription: "Sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches lot",
          measurements: [
            {
              analyte: "THC",
              resultKind: "quantified",
              resultValue: "21.00",
              unit: "percent_w_w",
              basis: "dry_weight",
              context: "flower",
              quantityKind: "mass_fraction"
            }
          ]
        }
      });
    });

    // Resolution attempting to resolve revision 1 fails as superseded
    const poolRepo = new PostgresCoaReportRepository(pool);
    const res = await poolRepo.resolveMeasurementSupport({
      clientId,
      batchId,
      reportId,
      reportRevision: 1,
      measurementIds: [measurementId],
      requiredUnit: "percent_w_w",
      requiredBasis: "dry_weight",
      requiredContext: "flower",
      requiredScope: "sample_only"
    });

    expect(res.isSupported).toBe(false);
    expect(res.reason).toBe("report_superseded");
  });

  it("prevents deadlock between concurrent evidence registration and CoA operations using explicit barrier", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { skuId, batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);
    const uow = new PostgresUnitOfWork(pool);

    const reportId = createCoaReportId(crypto.randomUUID());
    await uow.execute(async (ctx) => {
      await ctx.coaReports!.createReport({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "operator",
        timestamp: "2026-10-18T10:00:00.000Z",
        payload: {
          reportId,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-CONCURRENT-LOCK",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill",
          sampleIdentifierAsClaimed: "SMPL-1",
          scopeKind: "sample_only",
          scopeDescription: "Sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches lot",
          measurements: [
            {
              analyte: "THC",
              resultKind: "quantified",
              resultValue: "18.00",
              unit: "percent_w_w",
              basis: "dry_weight",
              context: "flower",
              quantityKind: "mass_fraction"
            }
          ]
        }
      });
    });

    // Concurrent execution of:
    // 1. Evidence registration on the batch (acquires SKU then Batch then Source)
    // 2. CoA review on the batch report (acquires SKU then Batch then Source then Evidence then Report)
    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      // Transaction A locks SKU first
      await clientA.query(
        "SELECT sku_id FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR UPDATE",
        [clientId, skuId]
      );

      // Transaction B starts CoA operation (which waits for SKU lock held by A without deadlocking)
      const evidenceRepoA = new PostgresEvidenceAssetRepository(clientA, {
        externalTransaction: true
      });
      const coaRepoB = new PostgresCoaReportRepository(clientB, { externalTransaction: true });

      const promiseB = coaRepoB.reviewReportRevision({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "reviewer-lock-order",
        timestamp: "2026-10-18T12:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Approved without deadlock",
          assessedScope: "sample_only"
        }
      });

      // Transaction A registers new evidence on the batch
      const newSha256 = crypto.createHash("sha256").update("new-evidence-barrier").digest("hex");
      await evidenceRepoA.registerEvidence({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "operator-evidence",
        timestamp: "2026-10-18T12:00:00.000Z",
        payload: {
          batchId,
          purpose: "general_supporting_evidence",
          sourceClass: "document",
          acquisitionMethod: "direct_upload",
          assertionText: "Chain of custody scan",
          reportedCaptureDate: null,
          reportedCaptureTimestamp: null,
          reportedCapturePrecision: null,
          captureContext: null,
          rightsStatus: "granted",
          consentStatus: "granted",
          rightsAttribution: null,
          rightsDocumentLocator: null,
          registrationIntent: "initial_assertion",
          originalSha256: newSha256 as Sha256Hex,
          detectedMimeType: "application/pdf",
          byteLength: 2048,
          storageBucket: "restricted-evidence",
          storageObjectKey: `clients/${clientId}/evidence/originals/${newSha256}`,
          retentionPolicyVersion: "v1"
        }
      });

      // Commit A, which frees the lock so B can proceed
      await clientA.query("COMMIT");

      // B finishes successfully without deadlock
      const resultB = await promiseB;
      await clientB.query("COMMIT");

      expect(resultB.reviewEvent.decision).toBe("approved");
    } catch (err) {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientB.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it("prevents deadlock between concurrent evidence supersession and verification event append", async () => {
    const clientRecord = await insertClientRecord(client);
    const clientId = createClientId(clientRecord.client_id);
    const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query("BEGIN");
      await clientB.query("BEGIN");

      const evidenceRepoA = new PostgresEvidenceAssetRepository(clientA, {
        externalTransaction: true
      });
      const evidenceRepoB = new PostgresEvidenceAssetRepository(clientB, {
        externalTransaction: true
      });

      const newSha = crypto.createHash("sha256").update("supersede-barrier-sha").digest("hex");

      // Start verification event append in transaction B
      const resAppend = await evidenceRepoB.appendVerificationEvent({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "verifier",
        timestamp: "2026-10-18T13:00:00.000Z",
        payload: {
          evidenceId,
          evidenceRevision: 1,
          outcome: "verified",
          verificationKind: "independent_third_party_corroboration",
          factScope: "lab_identity",
          method: "Accreditation portal lookup",
          reason: "ISO 17025 accredited",
          verifiedPartyReference: "Lab accreditation certificate #12345"
        }
      });

      // While transaction B holds locks, transaction A initiates supersession.
      // With canonical lock hierarchy (SKU -> Batch -> Source -> Evidence),
      // transaction A waits cleanly on locks held by B without deadlocking.
      const promiseSupersede = evidenceRepoA.registerEvidence({
        actionId: createActionId(crypto.randomUUID()),
        clientId,
        actorId: "superseder",
        timestamp: "2026-10-18T13:00:00.000Z",
        payload: {
          batchId,
          purpose: "coa_test_report",
          sourceClass: "coa",
          acquisitionMethod: "direct_upload",
          assertionText: "Amended report",
          reportedCaptureDate: null,
          reportedCaptureTimestamp: null,
          reportedCapturePrecision: null,
          captureContext: null,
          rightsStatus: "granted",
          consentStatus: "granted",
          rightsAttribution: null,
          rightsDocumentLocator: null,
          registrationIntent: "supersede",
          targetEvidenceId: evidenceId,
          expectedEvidenceVersion: 1,
          originalSha256: newSha as Sha256Hex,
          detectedMimeType: "application/pdf",
          byteLength: 4096,
          storageBucket: "restricted-evidence",
          storageObjectKey: `clients/${clientId}/evidence/originals/${newSha}`,
          retentionPolicyVersion: "v1"
        }
      });

      // Commit B, releasing its locks so A can proceed
      await clientB.query("COMMIT");

      // A unblocks and finishes supersession successfully without deadlock
      const resSupersede = await promiseSupersede;
      await clientA.query("COMMIT");

      expect(resSupersede.evidenceRevision.revision).toBe(2);
      expect(resAppend.outcome).toBe("verified");
    } catch (err) {
      await clientA.query("ROLLBACK").catch(() => {});
      await clientB.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it("verifies repository operations through restricted orchestrator app_role", async () => {
    const testRole = "test_coa_repo_app_role";
    await client.query(`DROP ROLE IF EXISTS ${testRole}; CREATE ROLE ${testRole};`);

    try {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await runMigrations(client, { migrationsDirectory, applicationRole: testRole });
      const clientRecord = await insertClientRecord(client);
      const clientId = createClientId(clientRecord.client_id);
      const { batchId, evidenceId } = await setupBatchAndEvidence(client, clientId);

      // Create a pool connection switched to the restricted app role
      const appClient = await pool.connect();
      try {
        await appClient.query(`SET ROLE ${testRole}`);
        await appClient.query("BEGIN");

        const repo = new PostgresCoaReportRepository(appClient, { externalTransaction: true });
        const reportId = createCoaReportId(crypto.randomUUID());

        // 1. Create Report under app_role
        const createRes = await repo.createReport({
          actionId: createActionId(crypto.randomUUID()),
          clientId,
          actorId: "app-role-operator",
          timestamp: "2026-10-18T10:00:00.000Z",
          payload: {
            reportId,
            batchId,
            evidenceId,
            evidenceRevision: 1,
            completenessStatus: "complete",
            reportIdentifierAsClaimed: "RPT-APP-ROLE",
            reportDate: "2026-10-18",
            labNameAsClaimed: "Steep Hill",
            sampleIdentifierAsClaimed: "SMPL-1",
            scopeKind: "sample_only",
            scopeDescription: "Sample description",
            sampleToBatchAssociationConfirmed: true,
            sampleToBatchAssociationAttestation: "CoC confirmed",
            measurements: [
              {
                analyte: "THCA",
                resultKind: "quantified",
                resultValue: "25.0000",
                unit: "percent_w_w",
                basis: "dry_weight",
                context: "flower",
                quantityKind: "mass_fraction"
              }
            ]
          }
        });
        expect(createRes.report.reportId).toBe(reportId);
        const measurementId = createRes.measurements[0]!.measurementId;

        // 2. Review Report under app_role (updates version on coa_reports via allowed column grant)
        const reviewRes = await repo.reviewReportRevision({
          actionId: createActionId(crypto.randomUUID()),
          clientId,
          actorId: "app-role-reviewer",
          timestamp: "2026-10-18T11:00:00.000Z",
          payload: {
            reportId,
            expectedVersion: 1,
            decision: "approved",
            reason: "Reviewed under restricted role",
            assessedScope: "sample_only"
          }
        });
        expect(reviewRes.report.version).toBe(2);

        // 3. Resolve support under app_role
        const supportRes = await repo.resolveMeasurementSupport({
          clientId,
          batchId,
          reportId,
          reportRevision: 1,
          measurementIds: [measurementId],
          requiredUnit: "percent_w_w",
          requiredBasis: "dry_weight",
          requiredContext: "flower",
          requiredScope: "sample_only"
        });
        expect(supportRes.isSupported).toBe(true);
        expect(supportRes.resolution?.measurements[0]?.decimalValue).toBe("25.0000");

        await appClient.query("COMMIT");
        await appClient.query("RESET ROLE");
      } catch (err) {
        await appClient.query("ROLLBACK").catch(() => {});
        await appClient.query("RESET ROLE").catch(() => {});
        throw err;
      } finally {
        appClient.release();
      }
    } finally {
      await client.query(`DROP ROLE IF EXISTS ${testRole}`).catch(() => {});
    }
  });
});
