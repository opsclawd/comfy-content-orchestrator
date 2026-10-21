import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  canonicalizeUtcTimestamp,
  compareDecimalStrings,
  isSupportedAnalyticalTuple,
  type CoaCompletenessStatus,
  type CoaResultKind,
  type CoaResultQualifier,
  type CoaReviewDecision,
  type CoaScopeKind,
  type DateOnlyString,
  type DecimalString,
  type IsoTimestampString
} from "@cco/shared";
import {
  AccessDeniedError,
  archiveCoaReport,
  createBatchId,
  createClientId,
  createCoaMeasurement,
  createCoaMeasurementId,
  createCoaReport,
  createCoaReportId,
  createCoaReportReviewEvent,
  createCoaReportRevision,
  createCoaReviewEventId,
  createEvidenceId,
  createSourceObjectId,
  createVerificationEventId,
  IdempotencyConflictError,
  NotFoundError,
  ProductValidationError,
  rehydrateCoaMeasurement,
  rehydrateCoaReport,
  rehydrateCoaReportReviewEvent,
  rehydrateCoaReportRevision,
  ReportDisputedError,
  StaleRevisionConflictError,
  supersedeCoaReport,
  type BatchId,
  type ClientId,
  type CoaMeasurement,
  type CoaReport,
  type CoaReportId,
  type CoaReportReviewEvent,
  type CoaReportRevision
} from "@cco/domain";
import type {
  ArchiveCoaReportRequest,
  CreateCoaReportRequest,
  ResolveCoaMeasurementSupportRequest,
  ResolveCoaMeasurementSupportResponse,
  ResolvedMeasurementDetail,
  ReviewCoaReportRequest,
  SupersedeCoaReportRequest
} from "@cco/contracts";
import type {
  CoaReportArchiveResult,
  CoaReportCreationResult,
  CoaReportRepositoryPort,
  CoaReportReviewResult,
  CoaReportRevisionDetail,
  CoaReportSupersessionResult,
  CommandEnvelope
} from "@cco/application";
import {
  computePayloadSha256,
  translateDatabaseError
} from "./postgres-product-evidence-repository.js";

export interface PostgresCoaReportRepositoryOptions {
  readonly externalTransaction?: boolean;
  readonly lockTimeoutMs?: number;
}

interface CoaReportRow {
  readonly report_id: string;
  readonly client_id: string;
  readonly batch_id: string;
  readonly evidence_id: string;
  readonly current_revision: number;
  readonly version: number;
  readonly created_at: Date | string;
  readonly archived_at: Date | string | null;
}

interface CoaReportRevisionRow {
  readonly client_id: string;
  readonly report_id: string;
  readonly revision: number;
  readonly batch_id: string;
  readonly evidence_id: string;
  readonly evidence_revision: number;
  readonly completeness_status: CoaCompletenessStatus;
  readonly report_identifier_as_claimed: string | null;
  readonly report_date: Date | string | null;
  readonly lab_name_as_claimed: string | null;
  readonly sample_identifier_as_claimed: string | null;
  readonly scope_kind: CoaScopeKind | null;
  readonly scope_description: string | null;
  readonly sample_date: Date | string | null;
  readonly sampling_method_description: string | null;
  readonly sample_to_batch_association_attestation: string | null;
  readonly sample_to_batch_association_confirmed: boolean | null;
  readonly verified_lab_identity_event_id: string | null;
  readonly asserted_by: string;
  readonly asserted_at: Date | string;
  readonly supersedes_revision: number | null;
}

interface CoaMeasurementRow {
  readonly measurement_id: string;
  readonly client_id: string;
  readonly report_id: string;
  readonly report_revision: number;
  readonly batch_id: string;
  readonly evidence_id: string;
  readonly evidence_revision: number;
  readonly analyte: string;
  readonly result_kind: CoaResultKind;
  readonly result_value: string | null;
  readonly result_limit: string | null;
  readonly result_qualifier: CoaResultQualifier | null;
  readonly unit: string;
  readonly basis: string;
  readonly context: string;
  readonly quantity_kind: string;
  readonly method_as_reported: string | null;
  readonly uncertainty_absolute: string | null;
  readonly detection_limit: string | null;
  readonly quantification_limit: string | null;
  readonly analytical_qualifier_code: string | null;
  readonly analytical_qualifier_explanation: string | null;
}

interface CoaReviewEventRow {
  readonly event_id: string;
  readonly client_id: string;
  readonly report_id: string;
  readonly report_revision: number;
  readonly decision: CoaReviewDecision;
  readonly actor_id: string;
  readonly occurred_at: Date | string;
  readonly reason: string;
  readonly assessed_scope: CoaScopeKind;
}

interface ReceiptRow {
  readonly client_id: string;
  readonly action_id: string;
  readonly command_name: string;
  readonly payload_sha256: string;
  readonly actor_id: string;
  readonly response_body: unknown;
  readonly committed_at: Date | string;
}

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    ("totalCount" in client && typeof (client as Pool).totalCount === "number") ||
    (typeof (client as Pool).connect === "function" &&
      typeof (client as PoolClient).release !== "function")
  );
}

function formatIsoUtcTimestamp(val: Date | string): IsoTimestampString {
  if (val instanceof Date) {
    return canonicalizeUtcTimestamp(val.toISOString());
  }
  return canonicalizeUtcTimestamp(val);
}

function formatDateOnly(val: Date | string | null): DateOnlyString | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return String(val).slice(0, 10);
}

function mapRowToCoaReport(row: CoaReportRow): CoaReport {
  return rehydrateCoaReport({
    clientId: createClientId(row.client_id),
    reportId: createCoaReportId(row.report_id),
    batchId: createBatchId(row.batch_id),
    evidenceId: createEvidenceId(row.evidence_id),
    currentRevision: row.current_revision,
    version: row.version,
    createdAt: formatIsoUtcTimestamp(row.created_at),
    archivedAt: row.archived_at ? formatIsoUtcTimestamp(row.archived_at) : null
  });
}

function mapRowToCoaReportRevision(row: CoaReportRevisionRow): CoaReportRevision {
  return rehydrateCoaReportRevision({
    clientId: createClientId(row.client_id),
    reportId: createCoaReportId(row.report_id),
    revision: row.revision,
    batchId: createBatchId(row.batch_id),
    evidenceId: createEvidenceId(row.evidence_id),
    evidenceRevision: row.evidence_revision,
    completenessStatus: row.completeness_status,
    reportIdentifierAsClaimed: row.report_identifier_as_claimed,
    reportDate: formatDateOnly(row.report_date),
    labNameAsClaimed: row.lab_name_as_claimed ?? null,
    sampleIdentifierAsClaimed: row.sample_identifier_as_claimed ?? null,
    scopeKind: row.scope_kind,
    scopeDescription: row.scope_description,
    sampleDate: formatDateOnly(row.sample_date),
    samplingMethodDescription: row.sampling_method_description,
    sampleToBatchAssociationAttestation: row.sample_to_batch_association_attestation,
    sampleToBatchAssociationConfirmed: row.sample_to_batch_association_confirmed,
    verifiedLabIdentityEventId: row.verified_lab_identity_event_id
      ? createVerificationEventId(row.verified_lab_identity_event_id)
      : null,
    assertedBy: row.asserted_by,
    assertedAt: formatIsoUtcTimestamp(row.asserted_at),
    supersedesRevision: row.supersedes_revision
  });
}

function mapRowToCoaMeasurement(row: CoaMeasurementRow): CoaMeasurement {
  return rehydrateCoaMeasurement({
    measurementId: createCoaMeasurementId(row.measurement_id),
    clientId: createClientId(row.client_id),
    reportId: createCoaReportId(row.report_id),
    reportRevision: row.report_revision,
    batchId: createBatchId(row.batch_id),
    evidenceId: createEvidenceId(row.evidence_id),
    evidenceRevision: row.evidence_revision,
    analyte: row.analyte,
    resultKind: row.result_kind,
    resultValue: row.result_value as DecimalString | null,
    resultLimit: row.result_limit as DecimalString | null,
    resultQualifier: row.result_qualifier,
    unit: row.unit,
    basis: row.basis,
    context: row.context,
    quantityKind: row.quantity_kind,
    methodAsReported: row.method_as_reported,
    uncertaintyAbsolute: row.uncertainty_absolute as DecimalString | null,
    detectionLimit: row.detection_limit as DecimalString | null,
    quantificationLimit: row.quantification_limit as DecimalString | null,
    analyticalQualifierCode: row.analytical_qualifier_code,
    analyticalQualifierExplanation: row.analytical_qualifier_explanation
  });
}

function mapRowToCoaReviewEvent(row: CoaReviewEventRow): CoaReportReviewEvent {
  return rehydrateCoaReportReviewEvent({
    eventId: createCoaReviewEventId(row.event_id),
    clientId: createClientId(row.client_id),
    reportId: createCoaReportId(row.report_id),
    reportRevision: row.report_revision,
    decision: row.decision,
    actorId: row.actor_id,
    occurredAt: formatIsoUtcTimestamp(row.occurred_at),
    reason: row.reason,
    assessedScope: row.assessed_scope
  });
}

export class PostgresCoaReportRepository implements CoaReportRepositoryPort {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly options?: PostgresCoaReportRepositoryOptions
  ) {}

  private requireTransactionClient(): PoolClient {
    if (isPool(this.client)) {
      throw new Error(
        "Mutating operations require a transaction-bound PoolClient via PostgresUnitOfWork."
      );
    }
    if (!this.options?.externalTransaction) {
      throw new Error("Mutating operations must run within an active UnitOfWork transaction.");
    }
    if (typeof (this.client as PoolClient).getTransactionStatus === "function") {
      const status = (this.client as PoolClient).getTransactionStatus();
      if (status !== "T") {
        throw new Error(
          "Mutating operations require an active transaction block ('BEGIN'). Use PostgresUnitOfWork."
        );
      }
    }
    return this.client;
  }

  private async acquireCommandAdvisoryLock(
    client: PoolClient,
    clientId: string,
    actionId: string
  ): Promise<void> {
    const timeout = this.options?.lockTimeoutMs ?? 5000;
    await client.query(`SET LOCAL lock_timeout = '${timeout}ms'`);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('product_evidence_registry'), hashtext($1 || '::' || $2))`,
      [clientId, actionId]
    );
  }

  private async checkReceipt<T, R>(
    client: PoolClient,
    cmd: CommandEnvelope<T>,
    commandName: string
  ): Promise<{ readonly replay: boolean; readonly result?: R; readonly payloadHash: string }> {
    const payloadHash = computePayloadSha256(cmd.payload);

    const receiptRes = await client.query<ReceiptRow>(
      `SELECT client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at
       FROM product_evidence_command_receipts
       WHERE client_id = $1 AND action_id = $2`,
      [cmd.clientId, cmd.actionId]
    );

    if (receiptRes.rows.length > 0) {
      const receipt = receiptRes.rows[0]!;
      if (
        receipt.command_name === commandName &&
        receipt.payload_sha256 === payloadHash &&
        receipt.actor_id === cmd.actorId
      ) {
        return {
          replay: true,
          result:
            typeof receipt.response_body === "string"
              ? JSON.parse(receipt.response_body)
              : (receipt.response_body as R),
          payloadHash
        };
      }
      throw new IdempotencyConflictError(cmd.actionId);
    }

    return { replay: false, payloadHash };
  }

  private async storeReceipt<T, R>(
    client: PoolClient,
    cmd: CommandEnvelope<T>,
    commandName: string,
    payloadHash: string,
    responseBody: R
  ): Promise<void> {
    await client.query(
      `INSERT INTO product_evidence_command_receipts
         (client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cmd.clientId,
        cmd.actionId,
        commandName,
        payloadHash,
        cmd.actorId,
        JSON.stringify(responseBody),
        cmd.timestamp
      ]
    );
  }

  /**
   * Acquires row-level locks in strict hierarchical order:
   * 1. product_skus
   * 2. product_batches
   * 3. source_objects (sorted by ID)
   * 4. evidence_assets (sorted by ID)
   * 5. coa_reports (sorted by ID)
   */
  private async acquireOrderedLocks(
    client: PoolClient,
    clientId: string,
    targets: {
      skuId: string;
      batchId: string;
      sourceObjectIds: readonly string[];
      evidenceIds: readonly string[];
      reportIds?: readonly string[];
    },
    mode: "FOR UPDATE" | "FOR SHARE" = "FOR UPDATE"
  ): Promise<void> {
    const timeout = this.options?.lockTimeoutMs ?? 5000;
    await client.query(`SET LOCAL lock_timeout = '${timeout}ms'`);

    // 1. SKU
    await client.query(
      `SELECT sku_id, archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2 ${mode}`,
      [clientId, targets.skuId]
    );

    // 2. Batch
    await client.query(
      `SELECT batch_id, archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2 ${mode}`,
      [clientId, targets.batchId]
    );

    // 3. Source objects sorted by ID
    const sortedSources = [...new Set(targets.sourceObjectIds)].sort();
    for (const sourceId of sortedSources) {
      await client.query(
        `SELECT source_object_id, availability FROM source_objects WHERE client_id = $1 AND source_object_id = $2 ${mode}`,
        [clientId, sourceId]
      );
    }

    // 4. Evidence assets sorted by ID
    const sortedEvidence = [...new Set(targets.evidenceIds)].sort();
    for (const evidenceId of sortedEvidence) {
      await client.query(
        `SELECT evidence_id, archived_at FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2 ${mode}`,
        [clientId, evidenceId]
      );
    }

    // 5. CoA reports sorted by ID if present
    if (targets.reportIds && targets.reportIds.length > 0) {
      const sortedReports = [...new Set(targets.reportIds)].sort();
      for (const reportId of sortedReports) {
        await client.query(
          `SELECT report_id, archived_at FROM coa_reports WHERE client_id = $1 AND report_id = $2 ${mode}`,
          [clientId, reportId]
        );
      }
    }
  }

  private async assertNoActiveDisputes(
    client: PoolClient,
    clientId: string,
    sourceObjectId: string
  ): Promise<void> {
    const disputeRes = await client.query<{
      event_id: string;
      outcome: string;
      withdrawal_event_id: string | null;
    }>(
      `SELECT e.event_id, e.outcome, e.withdrawal_event_id
       FROM evidence_verification_events e
       JOIN evidence_revisions r ON r.client_id = e.client_id AND r.evidence_id = e.evidence_id AND r.revision = e.evidence_revision
       WHERE r.client_id = $1 AND r.source_object_id = $2
       ORDER BY e.occurred_at ASC`,
      [clientId, sourceObjectId]
    );
    const activeDisputes = new Set<string>();
    for (const evt of disputeRes.rows) {
      if (evt.outcome === "disputed" || evt.outcome === "rejected") {
        activeDisputes.add(evt.event_id);
      } else if (evt.outcome === "withdrawn" && evt.withdrawal_event_id) {
        activeDisputes.delete(evt.withdrawal_event_id);
      }
    }
    if (activeDisputes.size > 0) {
      throw new ReportDisputedError(
        `Source object ${sourceObjectId} has an active dispute or rejection and cannot be used.`
      );
    }
  }

  private async assertValidLabVerificationEvent(
    client: PoolClient,
    clientId: string,
    evidenceId: string,
    evidenceRevision: number,
    eventId: string
  ): Promise<void> {
    const labRes = await client.query<{
      outcome: string;
      fact_scope: string;
      verification_kind: string;
    }>(
      `SELECT outcome, fact_scope, verification_kind
       FROM evidence_verification_events
       WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3 AND event_id = $4`,
      [clientId, evidenceId, evidenceRevision, eventId]
    );
    if (labRes.rows.length === 0) {
      throw new NotFoundError("EvidenceVerificationEvent", eventId);
    }
    const labEvt = labRes.rows[0]!;
    if (
      labEvt.outcome !== "verified" ||
      labEvt.fact_scope !== "lab_identity" ||
      labEvt.verification_kind !== "independent_third_party_corroboration"
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["verifiedLabIdentityEventId"],
          message:
            "verifiedLabIdentityEventId must reference an active independent_third_party_corroboration of lab_identity with outcome 'verified'."
        }
      ]);
    }

    const withdrawalRes = await client.query<{ event_id: string }>(
      `SELECT 1 FROM evidence_verification_events
       WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
         AND outcome = 'withdrawn' AND withdrawal_event_id = $4`,
      [clientId, evidenceId, evidenceRevision, eventId]
    );
    if (withdrawalRes.rows.length > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["verifiedLabIdentityEventId"],
          message:
            "Referenced verified lab identity event has been withdrawn and is no longer valid."
        }
      ]);
    }
  }

  private async validateSourceLineageEligibility(
    client: PoolClient,
    clientId: string,
    options: {
      skuId: string;
      batchId: string;
      sourceObjectId: string;
      evidenceId: string;
      evidenceRevision: number;
      verifiedLabIdentityEventId?: string | null | undefined;
      requireCurrentEvidence?: boolean | undefined;
    }
  ): Promise<void> {
    const skuCheck = await client.query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
      [clientId, options.skuId]
    );
    if (skuCheck.rows.length === 0 || skuCheck.rows[0]?.archived_at) {
      throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
    }

    const batchCheck = await client.query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
      [clientId, options.batchId]
    );
    if (batchCheck.rows.length === 0 || batchCheck.rows[0]?.archived_at) {
      throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
    }

    const sourceCheck = await client.query<{ availability: string }>(
      `SELECT availability FROM source_objects WHERE client_id = $1 AND source_object_id = $2`,
      [clientId, options.sourceObjectId]
    );
    if (sourceCheck.rows.length === 0 || sourceCheck.rows[0]?.availability !== "available") {
      throw new AccessDeniedError("Underlying source object is unavailable.");
    }

    await this.assertNoActiveDisputes(client, clientId, options.sourceObjectId);

    const evidenceCheck = await client.query<{
      archived_at: Date | null;
      current_revision: number;
    }>(
      `SELECT archived_at, current_revision FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
      [clientId, options.evidenceId]
    );
    if (evidenceCheck.rows.length === 0 || evidenceCheck.rows[0]?.archived_at) {
      throw new AccessDeniedError("Associated evidence asset is archived.", "EVIDENCE_ARCHIVED");
    }
    if (
      options.requireCurrentEvidence &&
      evidenceCheck.rows[0]!.current_revision !== options.evidenceRevision
    ) {
      throw new StaleRevisionConflictError(
        "EvidenceAsset",
        options.evidenceRevision,
        evidenceCheck.rows[0]!.current_revision
      );
    }

    if (options.verifiedLabIdentityEventId) {
      await this.assertValidLabVerificationEvent(
        client,
        clientId,
        options.evidenceId,
        options.evidenceRevision,
        options.verifiedLabIdentityEventId
      );
    }
  }

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  async createReport(
    cmd: CommandEnvelope<CreateCoaReportRequest>
  ): Promise<CoaReportCreationResult> {
    const client = this.requireTransactionClient();
    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        CreateCoaReportRequest,
        CoaReportCreationResult
      >(client, cmd, "createCoaReport");
      if (replay && result) {
        return {
          report: rehydrateCoaReport(result.report),
          revision: rehydrateCoaReportRevision(result.revision),
          measurements: result.measurements.map(rehydrateCoaMeasurement)
        };
      }

      // Discover lineage
      const batchRes = await client.query<{ sku_id: string; archived_at: Date | null }>(
        `SELECT sku_id, archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      const skuId = batchRes.rows[0]!.sku_id;

      const linkRes = await client.query<{
        purpose: string;
        source_object_id: string;
        source_class: string;
        detected_mime_type: string;
      }>(
        `SELECT l.purpose, r.source_object_id, r.source_class, s.detected_mime_type
         FROM batch_evidence_links l
         JOIN evidence_revisions r ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         JOIN source_objects s ON s.client_id = r.client_id AND s.source_object_id = r.source_object_id
         WHERE l.client_id = $1 AND l.batch_id = $2 AND l.evidence_id = $3 AND l.evidence_revision = $4`,
        [cmd.clientId, cmd.payload.batchId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
      );
      if (linkRes.rows.length === 0) {
        throw new NotFoundError(
          "BatchEvidenceLink",
          "Referenced evidence revision is not linked to this batch"
        );
      }
      const link = linkRes.rows[0]!;
      if (link.purpose !== "coa_test_report") {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["evidenceRevision"],
            message: `Batch evidence link purpose must be 'coa_test_report' (found '${link.purpose}').`
          }
        ]);
      }
      if (link.source_class !== "coa") {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["evidenceRevision"],
            message: `Source class must be 'coa' (found '${link.source_class}').`
          }
        ]);
      }
      const allowedMimes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
      if (!allowedMimes.includes(link.detected_mime_type)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["evidenceRevision"],
            message: `Detected MIME type must be PDF or image (found '${link.detected_mime_type}').`
          }
        ]);
      }

      // Acquire ordered row locks
      await this.acquireOrderedLocks(client, cmd.clientId, {
        skuId,
        batchId: cmd.payload.batchId,
        sourceObjectIds: [link.source_object_id],
        evidenceIds: [cmd.payload.evidenceId]
      });

      // Recheck states and source lineage eligibility
      await this.validateSourceLineageEligibility(client, cmd.clientId, {
        skuId,
        batchId: cmd.payload.batchId,
        sourceObjectId: link.source_object_id,
        evidenceId: cmd.payload.evidenceId,
        evidenceRevision: cmd.payload.evidenceRevision,
        verifiedLabIdentityEventId: cmd.payload.verifiedLabIdentityEventId
      });

      // Construct domain entities
      const report = createCoaReport({
        reportId: cmd.payload.reportId,
        clientId: cmd.clientId,
        batchId: cmd.payload.batchId,
        evidenceId: cmd.payload.evidenceId,
        createdAt: cmd.timestamp
      });

      const domainMeasurements = (cmd.payload.measurements ?? []).map((m) =>
        createCoaMeasurement({
          ...m,
          clientId: cmd.clientId,
          reportId: report.reportId,
          reportRevision: 1,
          batchId: cmd.payload.batchId,
          evidenceId: cmd.payload.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision
        })
      );

      const revision = createCoaReportRevision(
        {
          ...cmd.payload,
          clientId: cmd.clientId,
          reportId: report.reportId,
          revision: 1,
          batchId: cmd.payload.batchId,
          evidenceId: cmd.payload.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision,
          assertedBy: cmd.actorId,
          assertedAt: cmd.timestamp
        },
        domainMeasurements
      );

      // Insert head
      await client.query(
        `INSERT INTO coa_reports (report_id, client_id, batch_id, evidence_id, current_revision, version, created_at)
         VALUES ($1, $2, $3, $4, 1, 1, $5)`,
        [report.reportId, report.clientId, report.batchId, report.evidenceId, report.createdAt]
      );

      // Insert revision
      await client.query(
        `INSERT INTO coa_report_revisions (
           client_id, report_id, revision, batch_id, evidence_id, evidence_revision,
           completeness_status, report_identifier_as_claimed, report_date, lab_name_as_claimed,
           sample_identifier_as_claimed, scope_kind, scope_description, sample_date,
           sampling_method_description, sample_to_batch_association_attestation,
           sample_to_batch_association_confirmed, verified_lab_identity_event_id,
           asserted_by, asserted_at, supersedes_revision
         ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NULL)`,
        [
          revision.clientId,
          revision.reportId,
          revision.batchId,
          revision.evidenceId,
          revision.evidenceRevision,
          revision.completenessStatus,
          revision.reportIdentifierAsClaimed,
          revision.reportDate,
          revision.labNameAsClaimed,
          revision.sampleIdentifierAsClaimed,
          revision.scopeKind,
          revision.scopeDescription,
          revision.sampleDate,
          revision.samplingMethodDescription,
          revision.sampleToBatchAssociationAttestation,
          revision.sampleToBatchAssociationConfirmed,
          revision.verifiedLabIdentityEventId,
          revision.assertedBy,
          revision.assertedAt
        ]
      );

      // Insert measurements
      for (const m of domainMeasurements) {
        await client.query(
          `INSERT INTO coa_measurements (
             measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
             analyte, result_kind, result_value, result_limit, result_qualifier,
             unit, basis, context, quantity_kind, method_as_reported,
             uncertainty_absolute, detection_limit, quantification_limit,
             analytical_qualifier_code, analytical_qualifier_explanation
           ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
          [
            m.measurementId,
            m.clientId,
            m.reportId,
            m.batchId,
            m.evidenceId,
            m.evidenceRevision,
            m.analyte,
            m.resultKind,
            m.resultValue,
            m.resultLimit,
            m.resultQualifier,
            m.unit,
            m.basis,
            m.context,
            m.quantityKind,
            m.methodAsReported,
            m.uncertaintyAbsolute,
            m.detectionLimit,
            m.quantificationLimit,
            m.analyticalQualifierCode,
            m.analyticalQualifierExplanation
          ]
        );
      }

      const creationResult: CoaReportCreationResult = {
        report,
        revision,
        measurements: domainMeasurements
      };

      await this.storeReceipt(client, cmd, "createCoaReport", payloadHash, creationResult);
      return creationResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        batchId: cmd.payload.batchId,
        actionId: cmd.actionId
      });
    }
  }

  async supersedeReport(
    cmd: CommandEnvelope<SupersedeCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportSupersessionResult> {
    const client = this.requireTransactionClient();
    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        SupersedeCoaReportRequest,
        CoaReportSupersessionResult
      >(client, cmd, "supersedeCoaReport");
      if (replay && result) {
        return {
          report: rehydrateCoaReport(result.report),
          revision: rehydrateCoaReportRevision(result.revision),
          measurements: result.measurements.map(rehydrateCoaMeasurement),
          audit: {
            previous: rehydrateCoaReport(result.audit.previous),
            current: rehydrateCoaReport(result.audit.current)
          }
        };
      }

      // Discover report head
      const reportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [cmd.clientId, cmd.payload.reportId]
      );
      if (reportRes.rows.length === 0) {
        throw new NotFoundError("CoaReport", cmd.payload.reportId);
      }
      const currentReport = mapRowToCoaReport(reportRes.rows[0]!);

      if (currentReport.archivedAt !== null) {
        throw new AccessDeniedError("Archived CoA report cannot be superseded.");
      }
      if (currentReport.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          currentReport.version
        );
      }

      // Discover batch and evidence link
      const batchRes = await client.query<{ sku_id: string }>(
        `SELECT sku_id FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, currentReport.batchId]
      );
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", currentReport.batchId);
      }
      const skuId = batchRes.rows[0]!.sku_id;

      const linkRes = await client.query<{
        purpose: string;
        source_object_id: string;
        source_class: string;
        detected_mime_type: string;
      }>(
        `SELECT l.purpose, r.source_object_id, r.source_class, s.detected_mime_type
         FROM batch_evidence_links l
         JOIN evidence_revisions r ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         JOIN source_objects s ON s.client_id = r.client_id AND s.source_object_id = r.source_object_id
         WHERE l.client_id = $1 AND l.batch_id = $2 AND l.evidence_id = $3 AND l.evidence_revision = $4`,
        [
          cmd.clientId,
          currentReport.batchId,
          currentReport.evidenceId,
          cmd.payload.evidenceRevision
        ]
      );
      if (linkRes.rows.length === 0) {
        throw new NotFoundError(
          "BatchEvidenceLink",
          "Referenced evidence revision is not linked to this batch"
        );
      }
      const link = linkRes.rows[0]!;

      if (link.purpose !== "coa_test_report") {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["evidenceRevision"],
            message: `Batch evidence link purpose must be 'coa_test_report' (found '${link.purpose}').`
          }
        ]);
      }
      if (link.source_class !== "coa") {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["evidenceRevision"],
            message: `Source class must be 'coa' (found '${link.source_class}').`
          }
        ]);
      }
      const allowedMimes = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
      if (!allowedMimes.includes(link.detected_mime_type)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["evidenceRevision"],
            message: `Detected MIME type must be PDF or image (found '${link.detected_mime_type}').`
          }
        ]);
      }

      // Discover current revision's source object ID so both source objects are locked in sorted order
      const oldRevRes = await client.query<{ source_object_id: string }>(
        `SELECT r.source_object_id
         FROM coa_report_revisions cr
         JOIN evidence_revisions r ON r.client_id = cr.client_id AND r.evidence_id = cr.evidence_id AND r.revision = cr.evidence_revision
         WHERE cr.client_id = $1 AND cr.report_id = $2 AND cr.revision = $3`,
        [cmd.clientId, cmd.payload.reportId, currentReport.currentRevision]
      );
      const oldSourceObjectId = oldRevRes.rows[0]?.source_object_id;
      const sortedSourceIds = Array.from(
        new Set([oldSourceObjectId, link.source_object_id].filter(Boolean) as string[])
      ).sort();

      // Acquire ordered row locks
      await this.acquireOrderedLocks(client, cmd.clientId, {
        skuId,
        batchId: currentReport.batchId,
        sourceObjectIds: sortedSourceIds,
        evidenceIds: [currentReport.evidenceId],
        reportIds: [cmd.payload.reportId]
      });

      // Recheck states
      const lockedReportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [cmd.clientId, cmd.payload.reportId]
      );
      const lockedReport = mapRowToCoaReport(lockedReportRes.rows[0]!);
      if (lockedReport.archivedAt !== null) {
        throw new AccessDeniedError("Archived CoA report cannot be superseded.");
      }
      if (lockedReport.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          lockedReport.version
        );
      }

      // Recheck SKU and batch under lock
      const lockedBatchRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, currentReport.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
      }

      const lockedSkuRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
      }

      const lockedEvidenceRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
        [cmd.clientId, currentReport.evidenceId]
      );
      if (lockedEvidenceRes.rows.length === 0 || lockedEvidenceRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated evidence asset is archived.", "EVIDENCE_ARCHIVED");
      }

      await this.validateSourceLineageEligibility(client, cmd.clientId, {
        skuId,
        batchId: currentReport.batchId,
        sourceObjectId: link.source_object_id,
        evidenceId: currentReport.evidenceId,
        evidenceRevision: cmd.payload.evidenceRevision,
        verifiedLabIdentityEventId: cmd.payload.verifiedLabIdentityEventId
      });

      if (oldSourceObjectId && oldSourceObjectId !== link.source_object_id) {
        await this.assertNoActiveDisputes(client, cmd.clientId, oldSourceObjectId);
      }

      // Perform domain transition
      const { previous, current: nextReport } = supersedeCoaReport(
        lockedReport,
        cmd.payload.expectedVersion
      );

      const nextRevisionNumber = nextReport.currentRevision;

      const domainMeasurements = (cmd.payload.measurements ?? []).map((m) =>
        createCoaMeasurement({
          ...m,
          clientId: cmd.clientId,
          reportId: nextReport.reportId,
          reportRevision: nextRevisionNumber,
          batchId: currentReport.batchId,
          evidenceId: currentReport.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision
        })
      );

      const nextRev = createCoaReportRevision(
        {
          ...cmd.payload,
          clientId: cmd.clientId,
          reportId: nextReport.reportId,
          revision: nextRevisionNumber,
          batchId: currentReport.batchId,
          evidenceId: currentReport.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision,
          assertedBy: cmd.actorId,
          assertedAt: cmd.timestamp,
          supersedesRevision: lockedReport.currentRevision
        },
        domainMeasurements
      );

      // Insert next revision
      await client.query(
        `INSERT INTO coa_report_revisions (
           client_id, report_id, revision, batch_id, evidence_id, evidence_revision,
           completeness_status, report_identifier_as_claimed, report_date, lab_name_as_claimed,
           sample_identifier_as_claimed, scope_kind, scope_description, sample_date,
           sampling_method_description, sample_to_batch_association_attestation,
           sample_to_batch_association_confirmed, verified_lab_identity_event_id,
           asserted_by, asserted_at, supersedes_revision
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
        [
          nextRev.clientId,
          nextRev.reportId,
          nextRev.revision,
          nextRev.batchId,
          nextRev.evidenceId,
          nextRev.evidenceRevision,
          nextRev.completenessStatus,
          nextRev.reportIdentifierAsClaimed,
          nextRev.reportDate,
          nextRev.labNameAsClaimed,
          nextRev.sampleIdentifierAsClaimed,
          nextRev.scopeKind,
          nextRev.scopeDescription,
          nextRev.sampleDate,
          nextRev.samplingMethodDescription,
          nextRev.sampleToBatchAssociationAttestation,
          nextRev.sampleToBatchAssociationConfirmed,
          nextRev.verifiedLabIdentityEventId,
          nextRev.assertedBy,
          nextRev.assertedAt,
          nextRev.supersedesRevision
        ]
      );

      // Update head to advance current_revision and version before inserting measurements
      const updateRes = await client.query(
        `UPDATE coa_reports
         SET current_revision = $1, version = version + 1
         WHERE client_id = $2 AND report_id = $3 AND version = $4`,
        [nextRevisionNumber, cmd.clientId, cmd.payload.reportId, cmd.payload.expectedVersion]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          lockedReport.version
        );
      }

      // Insert measurements
      for (const m of domainMeasurements) {
        await client.query(
          `INSERT INTO coa_measurements (
             measurement_id, client_id, report_id, report_revision, batch_id, evidence_id, evidence_revision,
             analyte, result_kind, result_value, result_limit, result_qualifier,
             unit, basis, context, quantity_kind, method_as_reported,
             uncertainty_absolute, detection_limit, quantification_limit,
             analytical_qualifier_code, analytical_qualifier_explanation
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
          [
            m.measurementId,
            m.clientId,
            m.reportId,
            m.reportRevision,
            m.batchId,
            m.evidenceId,
            m.evidenceRevision,
            m.analyte,
            m.resultKind,
            m.resultValue,
            m.resultLimit,
            m.resultQualifier,
            m.unit,
            m.basis,
            m.context,
            m.quantityKind,
            m.methodAsReported,
            m.uncertaintyAbsolute,
            m.detectionLimit,
            m.quantificationLimit,
            m.analyticalQualifierCode,
            m.analyticalQualifierExplanation
          ]
        );
      }

      const supersessionResult: CoaReportSupersessionResult = {
        report: nextReport,
        revision: nextRev,
        measurements: domainMeasurements,
        audit: { previous, current: nextReport }
      };

      await this.storeReceipt(client, cmd, "supersedeCoaReport", payloadHash, supersessionResult);
      return supersessionResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        actionId: cmd.actionId
      });
    }
  }

  async reviewReportRevision(
    cmd: CommandEnvelope<ReviewCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportReviewResult> {
    const client = this.requireTransactionClient();
    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        ReviewCoaReportRequest,
        CoaReportReviewResult
      >(client, cmd, "reviewCoaReport");
      if (replay && result) {
        return {
          report: rehydrateCoaReport(result.report),
          reviewEvent: rehydrateCoaReportReviewEvent(result.reviewEvent)
        };
      }

      // Discover report head
      const reportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [cmd.clientId, cmd.payload.reportId]
      );
      if (reportRes.rows.length === 0) {
        throw new NotFoundError("CoaReport", cmd.payload.reportId);
      }
      const currentReport = mapRowToCoaReport(reportRes.rows[0]!);

      if (currentReport.archivedAt !== null) {
        throw new AccessDeniedError("Cannot review an archived CoA report.");
      }
      if (currentReport.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          currentReport.version
        );
      }

      // Discover revision
      const revRes = await client.query<CoaReportRevisionRow>(
        `SELECT * FROM coa_report_revisions
         WHERE client_id = $1 AND report_id = $2 AND revision = $3`,
        [cmd.clientId, cmd.payload.reportId, currentReport.currentRevision]
      );
      if (revRes.rows.length === 0) {
        throw new NotFoundError("CoaReportRevision", `${currentReport.currentRevision}`);
      }
      const targetRevision = mapRowToCoaReportRevision(revRes.rows[0]!);

      // Discover batch/sku/source
      const batchRes = await client.query<{ sku_id: string }>(
        `SELECT sku_id FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, currentReport.batchId]
      );
      const skuId = batchRes.rows[0]!.sku_id;

      const linkRes = await client.query<{ source_object_id: string }>(
        `SELECT r.source_object_id
         FROM batch_evidence_links l
         JOIN evidence_revisions r ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         WHERE l.client_id = $1 AND l.batch_id = $2 AND l.evidence_id = $3 AND l.evidence_revision = $4`,
        [
          cmd.clientId,
          currentReport.batchId,
          currentReport.evidenceId,
          targetRevision.evidenceRevision
        ]
      );
      const sourceObjectId = linkRes.rows[0]!.source_object_id;

      // Acquire ordered row locks
      await this.acquireOrderedLocks(client, cmd.clientId, {
        skuId,
        batchId: currentReport.batchId,
        sourceObjectIds: [sourceObjectId],
        evidenceIds: [currentReport.evidenceId],
        reportIds: [cmd.payload.reportId]
      });

      // Recheck states
      const lockedReportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [cmd.clientId, cmd.payload.reportId]
      );
      const lockedReport = mapRowToCoaReport(lockedReportRes.rows[0]!);
      if (lockedReport.archivedAt !== null) {
        throw new AccessDeniedError("Cannot review an archived CoA report.");
      }
      if (lockedReport.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          lockedReport.version
        );
      }

      // Recheck SKU and batch under lock
      const lockedBatchRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, currentReport.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
      }

      const lockedSkuRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
      }

      const lockedEvidenceRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
        [cmd.clientId, currentReport.evidenceId]
      );
      if (lockedEvidenceRes.rows.length === 0 || lockedEvidenceRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated evidence asset is archived.", "EVIDENCE_ARCHIVED");
      }

      // Re-read target revision under locks
      const lockedRevRes = await client.query<CoaReportRevisionRow>(
        `SELECT * FROM coa_report_revisions
         WHERE client_id = $1 AND report_id = $2 AND revision = $3`,
        [cmd.clientId, cmd.payload.reportId, lockedReport.currentRevision]
      );
      if (lockedRevRes.rows.length === 0) {
        throw new NotFoundError("CoaReportRevision", `${lockedReport.currentRevision}`);
      }
      const lockedTargetRevision = mapRowToCoaReportRevision(lockedRevRes.rows[0]!);

      // Enforce separation of duties: no self-approval
      if (
        cmd.payload.decision === "approved" &&
        cmd.actorId.trim().toLowerCase() === lockedTargetRevision.assertedBy.trim().toLowerCase()
      ) {
        throw new AccessDeniedError(
          "Self-approval forbidden: reviewer cannot be the recorder who asserted this report revision."
        );
      }

      await this.validateSourceLineageEligibility(client, cmd.clientId, {
        skuId,
        batchId: currentReport.batchId,
        sourceObjectId,
        evidenceId: currentReport.evidenceId,
        evidenceRevision: lockedTargetRevision.evidenceRevision,
        verifiedLabIdentityEventId: lockedTargetRevision.verifiedLabIdentityEventId,
        requireCurrentEvidence: cmd.payload.decision === "approved"
      });

      // Domain transition
      const { event, updatedHead } = createCoaReportReviewEvent(
        {
          clientId: cmd.clientId,
          reportId: cmd.payload.reportId,
          reportRevision: lockedTargetRevision.revision,
          decision: cmd.payload.decision,
          actorId: cmd.actorId,
          occurredAt: cmd.timestamp,
          reason: cmd.payload.reason,
          assessedScope: cmd.payload.assessedScope
        },
        lockedReport,
        lockedTargetRevision
      );

      // Insert review event
      await client.query(
        `INSERT INTO coa_report_review_events (
           event_id, client_id, report_id, report_revision, decision, actor_id, occurred_at, reason, assessed_scope
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          event.eventId,
          event.clientId,
          event.reportId,
          event.reportRevision,
          event.decision,
          event.actorId,
          event.occurredAt,
          event.reason,
          event.assessedScope
        ]
      );

      // Update report head version
      const updateRes = await client.query(
        `UPDATE coa_reports
         SET version = version + 1
         WHERE client_id = $1 AND report_id = $2 AND version = $3`,
        [cmd.clientId, cmd.payload.reportId, cmd.payload.expectedVersion]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          lockedReport.version
        );
      }

      const reviewResult: CoaReportReviewResult = {
        report: updatedHead,
        reviewEvent: event
      };

      await this.storeReceipt(client, cmd, "reviewCoaReport", payloadHash, reviewResult);
      return reviewResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        actionId: cmd.actionId
      });
    }
  }

  async archiveReport(
    cmd: CommandEnvelope<ArchiveCoaReportRequest & { readonly reportId: CoaReportId }>
  ): Promise<CoaReportArchiveResult> {
    const client = this.requireTransactionClient();
    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        ArchiveCoaReportRequest,
        CoaReportArchiveResult
      >(client, cmd, "archiveCoaReport");
      if (replay && result) {
        return {
          report: rehydrateCoaReport(result.report),
          audit: {
            previous: rehydrateCoaReport(result.audit.previous),
            current: rehydrateCoaReport(result.audit.current)
          }
        };
      }

      // Discover report head
      const reportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [cmd.clientId, cmd.payload.reportId]
      );
      if (reportRes.rows.length === 0) {
        throw new NotFoundError("CoaReport", cmd.payload.reportId);
      }
      const currentReport = mapRowToCoaReport(reportRes.rows[0]!);

      if (currentReport.archivedAt !== null) {
        throw new AccessDeniedError("CoA report is already archived.");
      }
      if (currentReport.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          currentReport.version
        );
      }

      // Discover batch/sku
      const batchRes = await client.query<{ sku_id: string }>(
        `SELECT sku_id FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, currentReport.batchId]
      );
      const skuId = batchRes.rows[0]!.sku_id;

      // Acquire ordered row locks
      await this.acquireOrderedLocks(client, cmd.clientId, {
        skuId,
        batchId: currentReport.batchId,
        sourceObjectIds: [],
        evidenceIds: [currentReport.evidenceId],
        reportIds: [cmd.payload.reportId]
      });

      // Recheck report head under locks
      const lockedReportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [cmd.clientId, cmd.payload.reportId]
      );
      if (lockedReportRes.rows.length === 0) {
        throw new NotFoundError("CoaReport", cmd.payload.reportId);
      }
      const lockedReport = mapRowToCoaReport(lockedReportRes.rows[0]!);
      if (lockedReport.archivedAt !== null) {
        throw new AccessDeniedError("CoA report is already archived.");
      }
      if (lockedReport.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          lockedReport.version
        );
      }

      // Recheck SKU and batch under lock
      const lockedBatchRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, currentReport.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
      }

      const lockedSkuRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
      }

      const lockedEvidenceRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
        [cmd.clientId, currentReport.evidenceId]
      );
      if (lockedEvidenceRes.rows.length === 0 || lockedEvidenceRes.rows[0]?.archived_at) {
        throw new AccessDeniedError("Associated evidence asset is archived.", "EVIDENCE_ARCHIVED");
      }

      // Domain transition
      const { previous, current: updatedHead } = archiveCoaReport(
        lockedReport,
        cmd.payload.expectedVersion,
        cmd.timestamp
      );

      // Update head
      const updateRes = await client.query(
        `UPDATE coa_reports
         SET version = version + 1, archived_at = $1
         WHERE client_id = $2 AND report_id = $3 AND version = $4`,
        [updatedHead.archivedAt, cmd.clientId, cmd.payload.reportId, cmd.payload.expectedVersion]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          currentReport.version
        );
      }

      const archiveResult: CoaReportArchiveResult = {
        report: updatedHead,
        audit: { previous, current: updatedHead }
      };

      await this.storeReceipt(client, cmd, "archiveCoaReport", payloadHash, archiveResult);
      return archiveResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        actionId: cmd.actionId
      });
    }
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async getReportById(clientId: ClientId, reportId: CoaReportId): Promise<CoaReport | null> {
    const res = await this.client.query<CoaReportRow>(
      `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
      [clientId, reportId]
    );
    if (res.rows.length === 0) return null;
    return mapRowToCoaReport(res.rows[0]!);
  }

  async getReportRevision(
    clientId: ClientId,
    reportId: CoaReportId,
    revision: number
  ): Promise<CoaReportRevisionDetail | null> {
    const revRes = await this.client.query<CoaReportRevisionRow>(
      `SELECT * FROM coa_report_revisions WHERE client_id = $1 AND report_id = $2 AND revision = $3`,
      [clientId, reportId, revision]
    );
    if (revRes.rows.length === 0) return null;
    const rev = mapRowToCoaReportRevision(revRes.rows[0]!);

    const mRes = await this.client.query<CoaMeasurementRow>(
      `SELECT * FROM coa_measurements
       WHERE client_id = $1 AND report_id = $2 AND report_revision = $3
       ORDER BY analyte ASC, basis ASC, context ASC`,
      [clientId, reportId, revision]
    );
    const measurements = mRes.rows.map(mapRowToCoaMeasurement);

    const eventRes = await clientQuery<CoaReviewEventRow>(
      this.client,
      `SELECT * FROM coa_report_review_events
       WHERE client_id = $1 AND report_id = $2 AND report_revision = $3`,
      [clientId, reportId, revision]
    );
    const reviewEvent = eventRes.rows.length > 0 ? mapRowToCoaReviewEvent(eventRes.rows[0]!) : null;

    return { revision: rev, measurements, reviewEvent };
  }

  async getReportHistory(
    clientId: ClientId,
    reportId: CoaReportId
  ): Promise<readonly CoaReportRevisionDetail[]> {
    const revRes = await this.client.query<CoaReportRevisionRow>(
      `SELECT * FROM coa_report_revisions WHERE client_id = $1 AND report_id = $2 ORDER BY revision ASC`,
      [clientId, reportId]
    );

    const details: CoaReportRevisionDetail[] = [];
    for (const row of revRes.rows) {
      const rev = mapRowToCoaReportRevision(row);
      const mRes = await this.client.query<CoaMeasurementRow>(
        `SELECT * FROM coa_measurements
         WHERE client_id = $1 AND report_id = $2 AND report_revision = $3
         ORDER BY analyte ASC, basis ASC, context ASC`,
        [clientId, reportId, rev.revision]
      );
      const measurements = mRes.rows.map(mapRowToCoaMeasurement);

      const eventRes = await clientQuery<CoaReviewEventRow>(
        this.client,
        `SELECT * FROM coa_report_review_events
         WHERE client_id = $1 AND report_id = $2 AND report_revision = $3`,
        [clientId, reportId, rev.revision]
      );
      const reviewEvent =
        eventRes.rows.length > 0 ? mapRowToCoaReviewEvent(eventRes.rows[0]!) : null;

      details.push({ revision: rev, measurements, reviewEvent });
    }
    return details;
  }

  async listReportsForBatch(clientId: ClientId, batchId: BatchId): Promise<readonly CoaReport[]> {
    const res = await this.client.query<CoaReportRow>(
      `SELECT * FROM coa_reports WHERE client_id = $1 AND batch_id = $2 ORDER BY created_at ASC`,
      [clientId, batchId]
    );
    return res.rows.map(mapRowToCoaReport);
  }

  // --------------------------------------------------------------------------
  // Measurement Support Resolution (KTD5)
  // --------------------------------------------------------------------------

  async resolveMeasurementSupport(
    query: ResolveCoaMeasurementSupportRequest & { readonly clientId: ClientId }
  ): Promise<ResolveCoaMeasurementSupportResponse> {
    const client = isPool(this.client) ? await this.client.connect() : this.client;
    const shouldRelease = isPool(this.client);
    let managedTransaction = false;

    try {
      if (isPool(this.client)) {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
        managedTransaction = true;
      } else {
        const clientStatus =
          typeof (this.client as PoolClient).getTransactionStatus === "function"
            ? (this.client as PoolClient).getTransactionStatus()
            : undefined;

        if (this.options?.externalTransaction) {
          if (clientStatus !== "T") {
            throw new Error(
              "Resolution with externalTransaction requires an active transaction block ('BEGIN'). Use PostgresUnitOfWork."
            );
          }
        } else {
          // Autocommit PoolClient: manage an explicit transaction block so lock lifetime is coherent
          if (clientStatus !== "T") {
            await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
            managedTransaction = true;
          }
        }
      }

      const completeAndReturn = async (
        resp: ResolveCoaMeasurementSupportResponse
      ): Promise<ResolveCoaMeasurementSupportResponse> => {
        if (managedTransaction) {
          await client.query("COMMIT");
          managedTransaction = false;
        }
        return resp;
      };

      // 1. Discover report and lineage
      const reportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [query.clientId, query.reportId]
      );
      if (reportRes.rows.length === 0) {
        return await completeAndReturn({ isSupported: false, reason: "report_not_found" });
      }
      const report = mapRowToCoaReport(reportRes.rows[0]!);

      if (report.batchId !== query.batchId) {
        return await completeAndReturn({ isSupported: false, reason: "report_batch_mismatch" });
      }
      if (report.archivedAt !== null) {
        return await completeAndReturn({ isSupported: false, reason: "report_archived" });
      }
      if (report.currentRevision !== query.reportRevision) {
        return await completeAndReturn({ isSupported: false, reason: "report_superseded" });
      }

      // Discover batch/sku
      const batchRes = await client.query<{ sku_id: string; archived_at: Date | null }>(
        `SELECT sku_id, archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [query.clientId, query.batchId]
      );
      if (batchRes.rows.length === 0 || batchRes.rows[0]!.archived_at) {
        return await completeAndReturn({ isSupported: false, reason: "batch_archived" });
      }
      const skuId = batchRes.rows[0]!.sku_id;

      const skuRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [query.clientId, skuId]
      );
      if (skuRes.rows.length === 0 || skuRes.rows[0]!.archived_at) {
        return await completeAndReturn({ isSupported: false, reason: "sku_archived" });
      }

      // Read revision
      const revRes = await client.query<CoaReportRevisionRow>(
        `SELECT * FROM coa_report_revisions
         WHERE client_id = $1 AND report_id = $2 AND revision = $3`,
        [query.clientId, query.reportId, query.reportRevision]
      );
      if (revRes.rows.length === 0) {
        return await completeAndReturn({ isSupported: false, reason: "revision_not_found" });
      }
      const revision = mapRowToCoaReportRevision(revRes.rows[0]!);

      if (revision.completenessStatus !== "complete") {
        return await completeAndReturn({ isSupported: false, reason: "report_draft_incomplete" });
      }
      if (revision.sampleToBatchAssociationConfirmed !== true) {
        return await completeAndReturn({
          isSupported: false,
          reason: "sample_association_unconfirmed"
        });
      }

      // Discover source object
      const linkRes = await client.query<{ source_object_id: string }>(
        `SELECT r.source_object_id
         FROM batch_evidence_links l
         JOIN evidence_revisions r ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         WHERE l.client_id = $1 AND l.batch_id = $2 AND l.evidence_id = $3 AND l.evidence_revision = $4`,
        [query.clientId, query.batchId, report.evidenceId, revision.evidenceRevision]
      );
      if (linkRes.rows.length === 0) {
        return await completeAndReturn({ isSupported: false, reason: "batch_link_missing" });
      }
      const sourceObjectId = linkRes.rows[0]!.source_object_id;

      // Lock in canonical order FOR SHARE
      await this.acquireOrderedLocks(
        client as PoolClient,
        query.clientId,
        {
          skuId,
          batchId: query.batchId,
          sourceObjectIds: [sourceObjectId],
          evidenceIds: [report.evidenceId],
          reportIds: [query.reportId]
        },
        "FOR SHARE"
      );

      // Re-read and re-validate all states under locks
      const lockedSkuRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [query.clientId, skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]!.archived_at) {
        return await completeAndReturn({ isSupported: false, reason: "sku_archived" });
      }

      const lockedBatchRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [query.clientId, query.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]!.archived_at) {
        return await completeAndReturn({ isSupported: false, reason: "batch_archived" });
      }

      const evidenceAssetRes = await client.query<{
        archived_at: Date | null;
        current_revision: number;
      }>(
        `SELECT archived_at, current_revision FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
        [query.clientId, report.evidenceId]
      );
      if (evidenceAssetRes.rows.length === 0 || evidenceAssetRes.rows[0]!.archived_at) {
        return await completeAndReturn({ isSupported: false, reason: "source_archived" });
      }
      if (evidenceAssetRes.rows[0]!.current_revision !== revision.evidenceRevision) {
        return await completeAndReturn({ isSupported: false, reason: "source_superseded" });
      }

      const sourceObjRes = await client.query<{ availability: string }>(
        `SELECT availability FROM source_objects WHERE client_id = $1 AND source_object_id = $2`,
        [query.clientId, sourceObjectId]
      );
      if (sourceObjRes.rows.length === 0) {
        return await completeAndReturn({ isSupported: false, reason: "source_not_found" });
      }
      const availability = sourceObjRes.rows[0]!.availability;
      if (availability === "quarantined") {
        return await completeAndReturn({ isSupported: false, reason: "source_quarantined" });
      }
      if (availability === "archived") {
        return await completeAndReturn({ isSupported: false, reason: "source_archived" });
      }
      if (availability === "deleted_under_retention") {
        return await completeAndReturn({ isSupported: false, reason: "source_deleted" });
      }
      if (availability !== "available") {
        return await completeAndReturn({ isSupported: false, reason: "source_unavailable" });
      }

      // Check disputes on source object
      const disputeRes = await client.query<{
        event_id: string;
        outcome: string;
        withdrawal_event_id: string | null;
      }>(
        `SELECT e.event_id, e.outcome, e.withdrawal_event_id
         FROM evidence_verification_events e
         JOIN evidence_revisions r ON r.client_id = e.client_id AND r.evidence_id = e.evidence_id AND r.revision = e.evidence_revision
         WHERE r.client_id = $1 AND r.source_object_id = $2
         ORDER BY e.occurred_at ASC`,
        [query.clientId, sourceObjectId]
      );
      const activeDisputes = new Set<string>();
      for (const evt of disputeRes.rows) {
        if (evt.outcome === "disputed" || evt.outcome === "rejected") {
          activeDisputes.add(evt.event_id);
        } else if (evt.outcome === "withdrawn" && evt.withdrawal_event_id) {
          activeDisputes.delete(evt.withdrawal_event_id);
        }
      }
      if (activeDisputes.size > 0) {
        return await completeAndReturn({ isSupported: false, reason: "source_disputed" });
      }

      // Re-read report head under lock
      const lockedReportRes = await client.query<CoaReportRow>(
        `SELECT * FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
        [query.clientId, query.reportId]
      );
      if (lockedReportRes.rows.length === 0) {
        return await completeAndReturn({ isSupported: false, reason: "report_not_found" });
      }
      const lockedReport = mapRowToCoaReport(lockedReportRes.rows[0]!);
      if (lockedReport.batchId !== query.batchId) {
        return await completeAndReturn({ isSupported: false, reason: "report_batch_mismatch" });
      }
      if (lockedReport.archivedAt !== null) {
        return await completeAndReturn({ isSupported: false, reason: "report_archived" });
      }
      if (lockedReport.currentRevision !== query.reportRevision) {
        return await completeAndReturn({ isSupported: false, reason: "report_superseded" });
      }

      // Check verified lab identity event if referenced (with withdrawal check)
      if (revision.verifiedLabIdentityEventId) {
        const labEvtRes = await client.query<{
          outcome: string;
          fact_scope: string;
          verification_kind: string;
        }>(
          `SELECT outcome, fact_scope, verification_kind
           FROM evidence_verification_events
           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3 AND event_id = $4`,
          [
            query.clientId,
            report.evidenceId,
            revision.evidenceRevision,
            revision.verifiedLabIdentityEventId
          ]
        );
        if (labEvtRes.rows.length === 0) {
          return await completeAndReturn({ isSupported: false, reason: "lab_identity_unverified" });
        }
        const labEvt = labEvtRes.rows[0]!;
        if (
          labEvt.outcome !== "verified" ||
          labEvt.fact_scope !== "lab_identity" ||
          labEvt.verification_kind !== "independent_third_party_corroboration"
        ) {
          return await completeAndReturn({ isSupported: false, reason: "lab_identity_unverified" });
        }

        const withdrawalRes = await client.query<{ event_id: string }>(
          `SELECT 1 FROM evidence_verification_events
           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
             AND outcome = 'withdrawn' AND withdrawal_event_id = $4`,
          [
            query.clientId,
            report.evidenceId,
            revision.evidenceRevision,
            revision.verifiedLabIdentityEventId
          ]
        );
        if (withdrawalRes.rows.length > 0) {
          return await completeAndReturn({
            isSupported: false,
            reason: "lab_verification_withdrawn"
          });
        }
      }

      // Check review event
      const reviewRes = await client.query<CoaReviewEventRow>(
        `SELECT * FROM coa_report_review_events
         WHERE client_id = $1 AND report_id = $2 AND report_revision = $3`,
        [query.clientId, query.reportId, query.reportRevision]
      );
      if (reviewRes.rows.length === 0) {
        return await completeAndReturn({ isSupported: false, reason: "report_not_approved" });
      }
      const review = mapRowToCoaReviewEvent(reviewRes.rows[0]!);
      if (review.decision !== "approved") {
        return await completeAndReturn({ isSupported: false, reason: "report_rejected" });
      }

      // Check scope requirement
      if (query.requiredScope === "attributed_lot" && review.assessedScope === "sample_only") {
        return await completeAndReturn({ isSupported: false, reason: "scope_insufficient" });
      }

      // 2. Fetch and check measurements
      if (new Set(query.measurementIds).size !== query.measurementIds.length) {
        return await completeAndReturn({ isSupported: false, reason: "duplicate_measurement_ids" });
      }

      const mRes = await client.query<CoaMeasurementRow>(
        `SELECT * FROM coa_measurements
         WHERE client_id = $1 AND report_id = $2 AND report_revision = $3 AND measurement_id = ANY($4::uuid[])`,
        [query.clientId, query.reportId, query.reportRevision, query.measurementIds]
      );
      if (mRes.rows.length !== query.measurementIds.length) {
        return await completeAndReturn({ isSupported: false, reason: "measurement_not_found" });
      }

      const resolvedDetails: ResolvedMeasurementDetail[] = [];
      for (const row of mRes.rows) {
        const m = mapRowToCoaMeasurement(row);

        if (m.resultKind !== "quantified") {
          return await completeAndReturn({
            isSupported: false,
            reason: "non_quantified_measurement"
          });
        }
        if (!m.resultValue || compareDecimalStrings(m.resultValue, "0") < 0) {
          return await completeAndReturn({
            isSupported: false,
            reason: "negative_value_not_supported"
          });
        }
        if (!isSupportedAnalyticalTuple(m.unit, m.quantityKind)) {
          return await completeAndReturn({
            isSupported: false,
            reason: "unsupported_analytical_tuple"
          });
        }
        if (m.unit !== query.requiredUnit) {
          return await completeAndReturn({ isSupported: false, reason: "unit_mismatch" });
        }
        if (m.basis !== query.requiredBasis) {
          return await completeAndReturn({ isSupported: false, reason: "basis_mismatch" });
        }
        if (m.context !== query.requiredContext) {
          return await completeAndReturn({ isSupported: false, reason: "context_mismatch" });
        }

        resolvedDetails.push({
          measurementId: m.measurementId,
          analyte: m.analyte,
          decimalValue: m.resultValue,
          unit: m.unit,
          basis: m.basis,
          context: m.context,
          quantityKind: m.quantityKind,
          uncertaintyAbsolute: m.uncertaintyAbsolute,
          detectionLimit: m.detectionLimit,
          quantificationLimit: m.quantificationLimit,
          method: m.methodAsReported,
          analyticalQualifierCode: m.analyticalQualifierCode,
          analyticalQualifierExplanation: m.analyticalQualifierExplanation
        });
      }

      // Check that all measurements in the batch have compatible units/contexts unconditionally
      if (resolvedDetails.length > 1) {
        const firstUnit = resolvedDetails[0]!.unit;
        const firstBasis = resolvedDetails[0]!.basis;
        const firstContext = resolvedDetails[0]!.context;
        const allSame = resolvedDetails.every(
          (d) => d.unit === firstUnit && d.basis === firstBasis && d.context === firstContext
        );
        if (!allSame) {
          return await completeAndReturn({
            isSupported: false,
            reason: "mixed_measurement_contexts"
          });
        }
      }

      return await completeAndReturn({
        isSupported: true,
        resolution: {
          clientId: query.clientId,
          batchId: query.batchId,
          reportId: query.reportId,
          reportRevision: query.reportRevision,
          evidenceId: report.evidenceId,
          evidenceRevision: revision.evidenceRevision,
          sourceObjectId: createSourceObjectId(sourceObjectId),
          assessedScope: review.assessedScope,
          verifiedLabIdentityEventId: revision.verifiedLabIdentityEventId ?? null,
          measurements: resolvedDetails
        }
      });
    } catch (err) {
      if (managedTransaction) {
        await client.query("ROLLBACK").catch(() => {});
        managedTransaction = false;
      }
      throw err;
    } finally {
      if (managedTransaction) {
        await client.query("ROLLBACK").catch(() => {});
      }
      if (shouldRelease && client) {
        (client as PoolClient).release();
      }
    }
  }
}

async function clientQuery<R extends QueryResultRow>(
  c: Pool | PoolClient,
  sql: string,
  values: unknown[]
): Promise<QueryResult<R>> {
  return await c.query<R>(sql, values);
}
