import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  canonicalizeUtcTimestamp,
  compareDateOnly,
  isValidDateOnly,
  isValidPositiveInt,
  isValidUuid,
  normalizeAssertedBy,
  normalizeCanonicalSku,
  normalizeDisplayName,
  normalizeLotIdentifier,
  normalizeProducerIdentity,
  sortKeysDeep,
  type BatchOriginKind,
  type DateOnlyString,
  type IsoTimestampString
} from "@cco/shared";
import {
  AccessDeniedError,
  appendBatchFactsRevision,
  applyBatchFactsAppend,
  archiveProductBatch,
  archiveProductSku,
  assertSkuCanAcceptBatch,
  ConcurrencyConflictError,
  createBatchId,
  createClientId,
  createProductBatch,
  createProductSku,
  createSkuId,
  CrossBatchSourceError,
  CrossClientViolationError,
  DuplicateLotError,
  DuplicateSkuError,
  IdempotencyConflictError,
  NonMonotonicRevisionError,
  NotFoundError,
  ProductValidationError,
  rehydrateBatchFactsRevision,
  rehydrateProductBatch,
  rehydrateProductSku,
  ReportDisputedError,
  StaleRevisionConflictError,
  updateProductBatchMetadata,
  updateProductSkuMetadata,
  type ActionId,
  type BatchFactsRevision,
  type BatchId,
  type ClientId,
  type EvidenceId,
  type ProductBatch,
  type ProductBatchCreationResult,
  type ProductSku,
  type SkuId
} from "@cco/domain";
import type {
  AppendBatchFactsCommand,
  ArchiveBatchCommand,
  ArchiveSkuCommand,
  CommandEnvelope,
  CreateBatchCommand,
  CreateSkuCommand,
  ProductBatchArchiveResult,
  ProductBatchUpdateResult,
  ProductEvidenceRepositoryPort,
  ProductSkuArchiveResult,
  ProductSkuUpdateResult,
  UpdateBatchMetadataCommand,
  UpdateSkuMetadataCommand
} from "@cco/application";

// ============================================================================
// Repository Options
// ============================================================================

export interface PostgresProductEvidenceRepositoryOptions {
  /**
   * If true, mutations are permitted because an external transaction
   * lifecycle (e.g. PostgresUnitOfWork) is active and manages commit/rollback.
   */
  readonly externalTransaction?: boolean;
  /**
   * Transaction-local lock timeout in milliseconds (defaults to 5000ms).
   */
  readonly lockTimeoutMs?: number;
}

// ============================================================================
// Row Interfaces
// ============================================================================

interface SkuRow {
  readonly sku_id: string;
  readonly client_id: string;
  readonly canonical_sku: string;
  readonly display_name: string;
  readonly version: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
}

interface BatchRow {
  readonly batch_id: string;
  readonly client_id: string;
  readonly sku_id: string;
  readonly lot_identifier: string;
  readonly display_name: string;
  readonly version: number;
  readonly current_facts_revision: number;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
}

interface BatchFactsRow {
  readonly client_id: string;
  readonly batch_id: string;
  readonly revision: number;
  readonly origin_kind: string;
  readonly producer_identity_as_claimed: string | null;
  readonly production_start_date: Date | string | null;
  readonly production_end_date: Date | string | null;
  readonly origin_evidence_id: string | null;
  readonly origin_evidence_revision: number | null;
  readonly asserted_by: string;
  readonly asserted_at: Date | string;
  readonly supersedes_revision: number | null;
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

// ============================================================================
// Row Mappers & Helpers
// ============================================================================

function isPool(client: Pool | PoolClient): client is Pool {
  return (
    typeof (client as Pool).connect === "function" &&
    typeof (client as PoolClient).release !== "function"
  );
}

function formatIsoUtcTimestamp(ts: Date | string): IsoTimestampString {
  if (ts instanceof Date) {
    if (isNaN(ts.getTime())) {
      throw new ProductValidationError([
        {
          code: "INVALID_TIMESTAMP",
          path: [],
          message: "Timestamp is not a valid date."
        }
      ]);
    }
    return canonicalizeUtcTimestamp(ts.toISOString());
  }
  return canonicalizeUtcTimestamp(ts);
}

function formatDateOnly(d: unknown): DateOnlyString | null {
  if (d === null || d === undefined) {
    return null;
  }
  let dateStr: string;
  if (d instanceof Date) {
    if (isNaN(d.getTime())) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: [],
          message: "Date is not a valid date."
        }
      ]);
    }
    const year = String(d.getUTCFullYear()).padStart(4, "0");
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    dateStr = `${year}-${month}-${day}`;
  } else if (typeof d === "string") {
    dateStr = d.slice(0, 10);
  } else {
    dateStr = String(d).slice(0, 10);
  }

  if (!isValidDateOnly(dateStr)) {
    throw new ProductValidationError([
      {
        code: "INVALID_DATE",
        path: [],
        message: `Invalid date format: ${dateStr}`
      }
    ]);
  }
  return dateStr;
}

function mapRowToSku(row: SkuRow): ProductSku {
  return rehydrateProductSku({
    clientId: createClientId(row.client_id),
    skuId: createSkuId(row.sku_id),
    canonicalSku: row.canonical_sku,
    displayName: row.display_name,
    version: Number(row.version),
    createdAt: formatIsoUtcTimestamp(row.created_at),
    updatedAt: formatIsoUtcTimestamp(row.updated_at),
    archivedAt: row.archived_at ? formatIsoUtcTimestamp(row.archived_at) : null
  });
}

function mapRowToBatch(row: BatchRow): ProductBatch {
  return rehydrateProductBatch({
    clientId: createClientId(row.client_id),
    batchId: createBatchId(row.batch_id),
    skuId: createSkuId(row.sku_id),
    lotIdentifier: row.lot_identifier,
    displayName: row.display_name,
    version: Number(row.version),
    currentFactsRevision: Number(row.current_facts_revision),
    createdAt: formatIsoUtcTimestamp(row.created_at),
    updatedAt: formatIsoUtcTimestamp(row.updated_at),
    archivedAt: row.archived_at ? formatIsoUtcTimestamp(row.archived_at) : null
  });
}

function mapRowToFacts(row: BatchFactsRow): BatchFactsRevision {
  return rehydrateBatchFactsRevision({
    clientId: createClientId(row.client_id),
    batchId: createBatchId(row.batch_id),
    revision: Number(row.revision),
    originKind: row.origin_kind as BatchOriginKind,
    producerIdentityAsClaimed: row.producer_identity_as_claimed,
    productionStartDate: formatDateOnly(row.production_start_date),
    productionEndDate: formatDateOnly(row.production_end_date),
    originEvidenceId: row.origin_evidence_id as EvidenceId | null,
    originEvidenceRevision:
      row.origin_evidence_revision !== null ? Number(row.origin_evidence_revision) : null,
    assertedBy: row.asserted_by,
    assertedAt: formatIsoUtcTimestamp(row.asserted_at),
    supersedesRevision: row.supersedes_revision !== null ? Number(row.supersedes_revision) : null
  });
}

export function computePayloadSha256(payload: unknown): string {
  const canonicalJson = JSON.stringify(sortKeysDeep(payload));
  return createHash("sha256").update(canonicalJson).digest("hex");
}

const UUID_V7_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const ALLOWED_ENVELOPE_KEYS = new Set(["actionId", "clientId", "actorId", "timestamp", "payload"]);

const ALLOWED_CREATE_SKU_PAYLOAD_KEYS = new Set(["canonicalSku", "displayName"]);

const ALLOWED_CREATE_BATCH_PAYLOAD_KEYS = new Set([
  "skuId",
  "lotIdentifier",
  "displayName",
  "initialFacts"
]);

const ALLOWED_INITIAL_FACTS_KEYS = new Set([
  "originKind",
  "producerIdentityAsClaimed",
  "productionStartDate",
  "productionEndDate",
  "originEvidenceId",
  "originEvidenceRevision"
]);

const ALLOWED_APPEND_FACTS_PAYLOAD_KEYS = new Set([
  "batchId",
  "expectedVersion",
  "originKind",
  "producerIdentityAsClaimed",
  "productionStartDate",
  "productionEndDate",
  "originEvidenceId",
  "originEvidenceRevision"
]);

const ALLOWED_UPDATE_SKU_PAYLOAD_KEYS = new Set(["skuId", "expectedVersion", "displayName"]);

const ALLOWED_UPDATE_BATCH_PAYLOAD_KEYS = new Set(["batchId", "expectedVersion", "displayName"]);

const ALLOWED_ARCHIVE_SKU_PAYLOAD_KEYS = new Set(["skuId", "expectedVersion"]);

const ALLOWED_ARCHIVE_BATCH_PAYLOAD_KEYS = new Set(["batchId", "expectedVersion"]);

const ALLOWED_ORIGIN_KINDS = new Set<BatchOriginKind>([
  "own_production",
  "partner_origin",
  "unknown"
]);

function assertNoUnknownKeys(obj: unknown, allowed: Set<string>, pathPrefix: string[] = []): void {
  if (typeof obj !== "object" || obj === null) {
    return;
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: [...pathPrefix, key],
          message: `Unknown or unexpected field: "${key}".`
        }
      ]);
    }
  }
}

function validateEnvelope<T>(cmd: CommandEnvelope<T>): void {
  if (typeof cmd !== "object" || cmd === null) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: [],
        message: "Command envelope must be an object."
      }
    ]);
  }
  assertNoUnknownKeys(cmd, ALLOWED_ENVELOPE_KEYS);

  if (!cmd.actionId || !UUID_V7_REGEX.test(cmd.actionId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["actionId"],
        message: "actionId must be a valid UUIDv7 string."
      }
    ]);
  }
  if (!cmd.clientId || !isValidUuid(cmd.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "clientId must be a valid UUID string."
      }
    ]);
  }
  try {
    normalizeAssertedBy(cmd.actorId, "actorId");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["actorId"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }
  try {
    canonicalizeUtcTimestamp(cmd.timestamp);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["timestamp"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }
}

// ============================================================================
// PostgreSQL Error Translation
// ============================================================================

export interface DatabaseErrorTranslationContext {
  readonly clientId?: string;
  readonly skuId?: string;
  readonly batchId?: string;
  readonly actionId?: string;
  readonly canonicalSku?: string;
  readonly lotIdentifier?: string;
}

const PRODUCT_REGISTRY_TABLES = new Set<string>([
  "product_skus",
  "product_batches",
  "product_batch_facts",
  "product_evidence_command_receipts",
  "source_objects",
  "evidence_assets",
  "evidence_revisions",
  "batch_evidence_links",
  "evidence_derivatives",
  "evidence_verification_events",
  "evidence_ingest_reservations",
  "coa_reports",
  "coa_report_revisions",
  "coa_measurements",
  "coa_report_review_events"
]);

const REGISTRY_CONSTRAINTS = new Set<string>([
  "uq_product_skus_canonical",
  "uq_product_batches_lot",
  "product_evidence_command_receipts_pkey",
  "uq_batch_facts_predecessor",
  "product_batch_facts_pkey",
  "fk_product_batches_sku",
  "fk_product_batches_current_facts",
  "fk_batch_facts_batch",
  "fk_batch_facts_predecessor",
  "fk_product_skus_client",
  "product_skus_client_id_fkey",
  "fk_receipts_client",
  "product_evidence_command_receipts_client_id_fkey",
  "chk_canonical_sku_format",
  "chk_lot_identifier_format",
  "chk_product_skus_display_name",
  "chk_product_batches_display_name",
  "chk_batch_facts_monotonic_rev",
  "chk_batch_facts_origin_evidence_all_or_none",
  "fk_batch_facts_origin_evidence",
  "chk_batch_facts_origin_evidence_deferred",
  "chk_batch_facts_dates",
  "chk_batch_facts_asserted_by_nonempty",
  "chk_batch_facts_asserted_at",
  "chk_batch_facts_production_start_date",
  "chk_batch_facts_production_end_date",
  "chk_batch_facts_producer_identity",
  "chk_batch_facts_origin_evidence_revision",
  "chk_receipt_hash_format",
  "chk_receipt_command_nonempty",
  "chk_receipt_actor_nonempty",
  "chk_receipt_committed_at",
  "chk_product_skus_created_at",
  "chk_product_skus_updated_at",
  "chk_product_skus_archived_at",
  "chk_product_batches_created_at",
  "chk_product_batches_updated_at",
  "chk_product_batches_archived_at",
  "uq_reference_assets_client_asset",
  "source_objects_pkey",
  "uq_source_objects_client_obj",
  "uq_source_objects_client_hash",
  "uq_source_objects_storage",
  "uq_source_objects_storage_location",
  "source_objects_byte_length_check",
  "source_objects_access_class_check",
  "source_objects_retention_class_check",
  "source_objects_availability_check",
  "source_objects_client_id_fkey",
  "chk_sha256_format",
  "chk_source_objects_uploader_nonempty",
  "chk_source_objects_policy_nonempty",
  "chk_source_objects_mime_nonempty",
  "chk_source_objects_bucket_nonempty",
  "chk_source_objects_key_nonempty",
  "chk_source_objects_uploaded_at",
  "chk_source_object_hash_format",
  "chk_source_object_bucket_nonempty",
  "chk_source_object_key_nonempty",
  "chk_source_object_mime_nonempty",
  "chk_source_object_uploader_nonempty",
  "chk_source_object_policy_nonempty",
  "chk_source_object_timestamps",
  "evidence_assets_pkey",
  "uq_evidence_assets_client_evidence",
  "evidence_assets_current_revision_check",
  "evidence_assets_version_check",
  "evidence_assets_client_id_fkey",
  "chk_evidence_assets_created_at",
  "chk_evidence_assets_archived_at",
  "chk_evidence_asset_revision_pos",
  "chk_evidence_asset_version_pos",
  "chk_evidence_asset_timestamps",
  "fk_evidence_assets_current_rev",
  "fk_evidence_assets_client",
  "evidence_revisions_pkey",
  "uq_evidence_revisions_client_revision",
  "uq_evidence_revisions_predecessor",
  "uq_evidence_rev_predecessor",
  "fk_evidence_revisions_asset",
  "fk_evidence_revisions_source",
  "fk_evidence_revisions_predecessor",
  "chk_evidence_rev_monotonic",
  "chk_evidence_revision_supersedes_not_self",
  "chk_evidence_revisions_assertion_nonempty",
  "chk_evidence_revisions_submitted_by_nonempty",
  "chk_evidence_revisions_submitted_at",
  "chk_evidence_revisions_capture_date",
  "chk_evidence_revisions_capture_timestamp",
  "chk_evidence_revisions_capture_date_match",
  "chk_evidence_revision_number_pos",
  "chk_evidence_revision_submitted_by_nonempty",
  "chk_evidence_revision_assertion_nonempty",
  "chk_evidence_revision_submitted_at",
  "chk_evidence_revision_capture_dates",
  "chk_evidence_revision_rights_attribution",
  "chk_evidence_revision_rights_document",
  "evidence_revisions_revision_check",
  "evidence_revisions_source_class_check",
  "evidence_revisions_acquisition_method_check",
  "evidence_revisions_rights_status_check",
  "evidence_revisions_consent_status_check",
  "evidence_revisions_reported_capture_precision_check",
  "batch_evidence_links_pkey",
  "uq_batch_evidence_links_full",
  "uq_batch_evidence_links_client_link",
  "fk_batch_evidence_batch",
  "fk_batch_evidence_revision",
  "batch_evidence_links_purpose_check",
  "chk_batch_evidence_asserted_by_nonempty",
  "chk_batch_evidence_asserted_at",
  "chk_batch_evidence_purpose_nonempty",
  "evidence_derivatives_pkey",
  "uq_evidence_derivatives_client_deriv",
  "uq_evidence_derivatives_bridge",
  "fk_evidence_derivatives_revision",
  "fk_evidence_derivatives_reference",
  "chk_derivative_sha256_format",
  "chk_derivative_transform_nonempty",
  "chk_derivative_created_by_nonempty",
  "chk_derivative_created_at",
  "evidence_verification_events_pkey",
  "uq_verification_events_client_event",
  "uq_verification_events_full",
  "fk_verification_events_revision",
  "fk_verification_events_withdrawal",
  "evidence_verification_events_outcome_check",
  "evidence_verification_events_verification_kind_check",
  "evidence_verification_events_fact_scope_check",
  "chk_verification_events_withdrawal_no_self",
  "chk_verification_events_method_nonempty",
  "chk_verification_events_reason_nonempty",
  "chk_verification_events_actor_nonempty",
  "chk_verification_events_occurred_at",
  "evidence_ingest_reservations_pkey",
  "evidence_ingest_reservations_client_id_fkey",
  "evidence_ingest_reservations_reserved_bytes_check",
  "evidence_ingest_reservations_status_check",
  "chk_reservation_sha256_format",
  "chk_reservation_timestamps",
  "coa_reports_pkey",
  "uq_coa_reports_client_report",
  "uq_coa_reports_client_batch_evidence",
  "uq_coa_reports_head_identity",
  "fk_coa_reports_batch",
  "fk_coa_reports_evidence",
  "fk_coa_reports_current_rev",
  "chk_coa_reports_created_at",
  "chk_coa_reports_archived_at",
  "coa_report_revisions_pkey",
  "uq_coa_report_revisions_lineage",
  "fk_coa_report_revisions_head",
  "fk_coa_report_revisions_head_identity",
  "fk_coa_report_batch_evidence",
  "fk_coa_report_verified_lab",
  "fk_coa_report_predecessor",
  "chk_coa_report_rev_monotonic",
  "uq_coa_report_rev_predecessor",
  "chk_coa_report_asserted_by_nonempty",
  "chk_coa_report_asserted_at",
  "chk_coa_report_dates_range",
  "chk_coa_report_sample_date_le_report_date",
  "chk_coa_report_dates_le_asserted_at",
  "chk_coa_report_complete_requirements",
  "trg_check_coa_report_complete_measurements",
  "coa_measurements_pkey",
  "uq_coa_measurements_full",
  "uq_coa_measurements_lineage",
  "uq_coa_measurements_analyte_context",
  "fk_coa_measurements_report",
  "chk_coa_measurement_strings_nonempty",
  "chk_coa_measurement_quantified",
  "chk_coa_measurement_below_limit",
  "chk_coa_measurement_not_detected",
  "chk_coa_measurement_metadata",
  "chk_coa_measurement_percent_bounds",
  "chk_coa_measurement_fraction_bounds",
  "chk_coa_measurement_unit_contradictions",
  "trg_enforce_coa_measurements_insert",
  "coa_report_review_events_pkey",
  "uq_coa_review_events_client_event",
  "uq_coa_review_events_decision_per_rev",
  "fk_coa_review_events_revision",
  "chk_coa_review_events_reason_nonempty",
  "chk_coa_review_events_actor_nonempty",
  "chk_coa_review_events_occurred_at",
  "trg_check_coa_report_review_event_invariants"
]);

export function translateDatabaseError(
  err: unknown,
  context?: DatabaseErrorTranslationContext
): never {
  if (err instanceof Error && "code" in err) {
    const dbErr = err as {
      code: string;
      constraint?: string;
      message: string;
      detail?: string;
      table?: string;
    };

    switch (dbErr.code) {
      case "23505": {
        if (dbErr.constraint === "uq_evidence_derivatives_bridge") {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["derivative"],
              message: "A derivative link already exists for this revision and reference asset."
            }
          ]);
        }
        if (
          dbErr.constraint === "uq_evidence_revisions_client_revision" ||
          dbErr.constraint === "uq_evidence_revisions_predecessor" ||
          dbErr.constraint === "uq_evidence_rev_predecessor" ||
          dbErr.constraint === "evidence_revisions_pkey"
        ) {
          throw new NonMonotonicRevisionError(
            "Evidence revision conflict: duplicate or forked revision"
          );
        }
        if (
          dbErr.constraint === "uq_source_objects_client_hash" ||
          dbErr.constraint === "uq_source_objects_storage" ||
          dbErr.constraint === "uq_source_objects_storage_location" ||
          dbErr.constraint === "uq_source_objects_client_obj" ||
          dbErr.constraint === "source_objects_pkey"
        ) {
          throw new ConcurrencyConflictError(`Duplicate source object conflict: ${dbErr.message}`);
        }
        if (
          dbErr.constraint === "uq_batch_evidence_links_client_link" ||
          dbErr.constraint === "uq_batch_evidence_links_full" ||
          dbErr.constraint === "batch_evidence_links_pkey"
        ) {
          throw new ConcurrencyConflictError(
            `Evidence revision is already linked to this batch: ${dbErr.message}`
          );
        }
        if (dbErr.constraint === "uq_product_skus_canonical") {
          throw new DuplicateSkuError(context?.canonicalSku ?? "unknown", context?.clientId);
        }
        if (dbErr.constraint === "uq_product_batches_lot") {
          throw new DuplicateLotError(context?.lotIdentifier ?? "unknown", context?.skuId);
        }
        if (dbErr.constraint === "product_evidence_command_receipts_pkey") {
          throw new IdempotencyConflictError(context?.actionId ?? "unknown");
        }
        if (
          dbErr.constraint === "uq_batch_facts_predecessor" ||
          dbErr.constraint === "product_batch_facts_pkey"
        ) {
          throw new NonMonotonicRevisionError(
            "Predecessor revision conflict: duplicate or forked predecessor"
          );
        }
        if (
          dbErr.constraint === "uq_verification_events_client_event" ||
          dbErr.constraint === "uq_verification_events_full" ||
          dbErr.constraint === "evidence_verification_events_pkey"
        ) {
          throw new ConcurrencyConflictError(
            `Duplicate verification event conflict: ${dbErr.message}`
          );
        }
        if (
          dbErr.constraint === "uq_evidence_assets_client_evidence" ||
          dbErr.constraint === "evidence_assets_pkey"
        ) {
          throw new ConcurrencyConflictError(`Duplicate evidence asset conflict: ${dbErr.message}`);
        }
        if (
          dbErr.constraint === "uq_evidence_derivatives_client_deriv" ||
          dbErr.constraint === "evidence_derivatives_pkey"
        ) {
          throw new ConcurrencyConflictError(
            `Duplicate evidence derivative conflict: ${dbErr.message}`
          );
        }
        if (dbErr.constraint === "evidence_ingest_reservations_pkey") {
          throw new ConcurrencyConflictError(
            `Duplicate evidence ingest reservation conflict: ${dbErr.message}`
          );
        }
        if (dbErr.constraint === "uq_coa_reports_client_batch_evidence") {
          throw new ConcurrencyConflictError(
            "A CoA report already exists for this client, batch, and evidence asset."
          );
        }
        if (
          dbErr.constraint === "uq_coa_reports_client_report" ||
          dbErr.constraint === "coa_reports_pkey"
        ) {
          throw new ConcurrencyConflictError(`Duplicate CoA report conflict: ${dbErr.message}`);
        }
        if (
          dbErr.constraint === "uq_coa_report_rev_predecessor" ||
          dbErr.constraint === "coa_report_revisions_pkey"
        ) {
          throw new NonMonotonicRevisionError(
            "CoA report revision conflict: duplicate or forked revision"
          );
        }
        if (dbErr.constraint === "uq_coa_measurements_analyte_context") {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["measurements"],
              message: "Duplicate analyte + basis + context in report revision"
            }
          ]);
        }
        if (
          dbErr.constraint === "uq_coa_review_events_decision_per_rev" ||
          dbErr.constraint === "coa_report_review_events_pkey"
        ) {
          throw new ConcurrencyConflictError(
            "A review decision already exists for this report revision."
          );
        }
        if (
          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
        ) {
          throw new ConcurrencyConflictError(`Unique constraint conflict: ${dbErr.message}`);
        }
        break;
      }
      case "23503": {
        if (dbErr.constraint === "fk_evidence_assets_current_rev") {
          throw new StaleRevisionConflictError("EvidenceAsset", 0, 0);
        }
        if (dbErr.constraint === "fk_evidence_derivatives_reference") {
          throw new NotFoundError(
            "ReferenceAsset",
            "Referenced derivative reference asset does not exist"
          );
        }
        if (dbErr.constraint === "fk_evidence_derivatives_revision") {
          throw new NotFoundError(
            "EvidenceRevision",
            "Referenced evidence revision does not exist"
          );
        }
        if (dbErr.constraint === "fk_evidence_revisions_source") {
          throw new NotFoundError("SourceObject", "Referenced source object does not exist");
        }
        if (dbErr.constraint === "fk_batch_evidence_revision") {
          throw new NotFoundError(
            "EvidenceRevision",
            "Referenced evidence revision does not exist"
          );
        }
        if (dbErr.constraint === "fk_batch_evidence_batch") {
          throw new NotFoundError("ProductBatch", "Referenced product batch does not exist");
        }
        if (
          dbErr.constraint === "fk_source_objects_client" ||
          dbErr.constraint === "fk_evidence_assets_client"
        ) {
          throw new NotFoundError("Client", context?.clientId ?? "unknown");
        }
        if (dbErr.constraint === "fk_product_batches_sku") {
          throw new CrossClientViolationError(
            "Referenced SKU does not exist or belongs to a different client"
          );
        }
        if (dbErr.constraint === "fk_product_batches_current_facts") {
          throw new NotFoundError(
            "BatchFactsRevision",
            "Referenced current facts revision does not exist"
          );
        }
        if (dbErr.constraint === "fk_batch_facts_batch") {
          throw new NotFoundError("ProductBatch", context?.batchId ?? "unknown");
        }
        if (dbErr.constraint === "fk_batch_facts_predecessor") {
          throw new NonMonotonicRevisionError("Predecessor facts revision does not exist");
        }
        if (dbErr.constraint === "fk_batch_facts_origin_evidence") {
          throw new NotFoundError(
            "BatchEvidenceLink",
            "Referenced origin evidence revision is not linked to this batch"
          );
        }
        if (
          dbErr.constraint === "fk_product_skus_client" ||
          dbErr.constraint === "product_skus_client_id_fkey" ||
          dbErr.constraint === "fk_receipts_client" ||
          dbErr.constraint === "product_evidence_command_receipts_client_id_fkey"
        ) {
          if (
            dbErr.detail?.includes("is still referenced") ||
            dbErr.message.includes("is still referenced")
          ) {
            throw new AccessDeniedError(
              "Referenced entity cannot be deleted: restricted by foreign key",
              "RESTRICT_VIOLATION"
            );
          }
          throw new NotFoundError("Client", context?.clientId ?? "unknown");
        }
        if (
          (dbErr.detail?.includes("is still referenced") ||
            dbErr.message.includes("is still referenced")) &&
          ((dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
            (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)))
        ) {
          throw new AccessDeniedError(
            `Referenced entity cannot be deleted or updated: ${dbErr.message}`,
            "RESTRICT_VIOLATION"
          );
        }
        if (
          dbErr.constraint === "fk_evidence_revisions_asset" ||
          dbErr.constraint === "evidence_revisions_client_id_fkey"
        ) {
          throw new NotFoundError("EvidenceAsset", "Referenced evidence asset does not exist");
        }
        if (dbErr.constraint === "fk_evidence_revisions_predecessor") {
          throw new NonMonotonicRevisionError("Predecessor evidence revision does not exist");
        }
        if (dbErr.constraint === "fk_verification_events_revision") {
          throw new NotFoundError(
            "EvidenceRevision",
            "Referenced evidence revision does not exist"
          );
        }
        if (dbErr.constraint === "fk_verification_events_withdrawal") {
          throw new NotFoundError(
            "EvidenceVerificationEvent",
            "Referenced withdrawal event does not exist"
          );
        }
        if (dbErr.constraint === "fk_coa_reports_current_rev") {
          throw new StaleRevisionConflictError("CoaReport", 0, 0);
        }
        if (dbErr.constraint === "fk_coa_reports_batch") {
          throw new NotFoundError("ProductBatch", context?.batchId ?? "unknown");
        }
        if (dbErr.constraint === "fk_coa_reports_evidence") {
          throw new NotFoundError("EvidenceAsset", "Referenced evidence asset does not exist");
        }
        if (dbErr.constraint === "fk_coa_report_batch_evidence") {
          throw new NotFoundError(
            "BatchEvidenceLink",
            "Referenced evidence revision is not linked to this batch"
          );
        }
        if (dbErr.constraint === "fk_coa_report_verified_lab") {
          throw new NotFoundError(
            "EvidenceVerificationEvent",
            "Referenced verified lab identity event does not exist"
          );
        }
        if (dbErr.constraint === "fk_coa_report_revisions_head") {
          throw new NotFoundError("CoaReport", "Referenced CoA report head does not exist");
        }
        if (dbErr.constraint === "fk_coa_report_revisions_head_identity") {
          throw new CrossBatchSourceError(
            "CoA report revision batch or evidence does not match report head"
          );
        }
        if (dbErr.constraint === "fk_coa_measurements_report") {
          throw new NotFoundError(
            "CoaReportRevision",
            "Referenced CoA report revision does not exist"
          );
        }
        if (dbErr.constraint === "fk_coa_report_predecessor") {
          throw new NonMonotonicRevisionError("Predecessor CoA report revision does not exist");
        }
        if (dbErr.constraint === "fk_coa_review_events_revision") {
          throw new NotFoundError(
            "CoaReportRevision",
            "Referenced CoA report revision does not exist"
          );
        }
        if (
          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
        ) {
          throw new NotFoundError("Entity", `Referenced entity does not exist: ${dbErr.message}`);
        }
        break;
      }
      case "23001": {
        if (
          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
        ) {
          throw new AccessDeniedError(
            `Referenced entity cannot be deleted or updated: ${dbErr.message}`,
            "RESTRICT_VIOLATION"
          );
        }
        break;
      }
      case "23506": {
        // Immutability trigger exceptions
        if (
          dbErr.message.includes("Permanent SKU identity") ||
          dbErr.message.includes("Permanent Batch identity") ||
          dbErr.message.includes("CANNOT_DELETE_HEAD_ENTITY") ||
          dbErr.message.includes("CANNOT_MODIFY_IMMUTABLE_ENTITY") ||
          dbErr.message.includes("forbids DELETE") ||
          dbErr.message.includes("forbids UPDATE or DELETE") ||
          dbErr.message.includes("append-only") ||
          dbErr.message.includes("Archived SKU") ||
          dbErr.message.includes("Archived Batch") ||
          dbErr.message.includes("updated_at must be nondecreasing") ||
          dbErr.message.includes("Permanent evidence asset identity") ||
          dbErr.message.includes("Permanent source object binary columns") ||
          dbErr.message.includes("Permanent CoA report identity") ||
          dbErr.message.includes("Archived evidence asset") ||
          dbErr.message.includes("Archived CoA report") ||
          dbErr.message.includes("Archived source objects") ||
          dbErr.message.includes("Deleted source objects") ||
          dbErr.message.includes("Quarantined, archived, or deleted") ||
          dbErr.message.includes("cannot be reactivated") ||
          dbErr.message.includes("Storage version ID cannot be changed")
        ) {
          throw new AccessDeniedError(dbErr.message);
        }
        if (
          dbErr.message.includes("Cannot create batch under archived SKU") ||
          dbErr.message.includes("Cannot append facts to archived batch")
        ) {
          throw new AccessDeniedError(dbErr.message, "PARENT_ARCHIVED");
        }
        if (dbErr.message.includes("version must advance")) {
          throw new StaleRevisionConflictError("Head", 0, 0);
        }
        if (dbErr.message.includes("facts pointer")) {
          throw new NonMonotonicRevisionError(dbErr.message);
        }
        if (
          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)) ||
          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
          dbErr.message
        ) {
          throw new AccessDeniedError(dbErr.message);
        }
        break;
      }
      case "23514": {
        // Check constraints - strictly allowlisted registry checks only
        if (
          dbErr.constraint === "chk_evidence_rev_monotonic" ||
          dbErr.constraint === "chk_evidence_revision_supersedes_not_self" ||
          dbErr.constraint === "chk_coa_report_rev_monotonic"
        ) {
          throw new NonMonotonicRevisionError("Revision must be contiguous and monotonic");
        }
        if (
          dbErr.constraint === "trg_check_coa_report_complete_measurements" ||
          dbErr.message.includes("must contain at least one measurement")
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["measurements"],
              message: "Complete CoA report revisions must contain at least one measurement."
            }
          ]);
        }
        if (
          dbErr.constraint === "trg_enforce_coa_measurements_insert" ||
          dbErr.message.includes("Cannot insert measurements into")
        ) {
          throw new AccessDeniedError(dbErr.message);
        }
        if (
          dbErr.constraint === "trg_check_coa_report_review_event_invariants" ||
          dbErr.message.includes("Cannot approve a draft") ||
          dbErr.message.includes("Assessed scope cannot be attributed_lot") ||
          dbErr.message.includes("Self-approval forbidden")
        ) {
          if (dbErr.message.includes("Self-approval forbidden")) {
            throw new AccessDeniedError(dbErr.message);
          }
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["decision"],
              message: dbErr.message
            }
          ]);
        }
        if (dbErr.constraint === "chk_batch_facts_monotonic_rev") {
          throw new NonMonotonicRevisionError(
            "Batch facts revision must be contiguous and monotonic"
          );
        }
        if (dbErr.constraint === "chk_batch_facts_dates") {
          throw new ProductValidationError([
            {
              code: "INVALID_DATE",
              path: ["productionDates"],
              message: "productionStartDate cannot be later than productionEndDate"
            }
          ]);
        }
        if (dbErr.constraint === "chk_canonical_sku_format") {
          throw new ProductValidationError([
            {
              code: "INVALID_IDENTIFIER",
              path: ["canonicalSku"],
              message: "canonicalSku must match ^[A-Z0-9_-]{3,64}$"
            }
          ]);
        }
        if (dbErr.constraint === "chk_lot_identifier_format") {
          throw new ProductValidationError([
            {
              code: "INVALID_IDENTIFIER",
              path: ["lotIdentifier"],
              message: "lotIdentifier must match ^[A-Za-z0-9_.-]{1,128}$"
            }
          ]);
        }
        if (
          dbErr.constraint === "chk_batch_facts_origin_evidence_deferred" ||
          dbErr.constraint === "chk_batch_facts_origin_evidence_all_or_none"
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["originEvidenceId"],
              message:
                "originEvidenceId and originEvidenceRevision must either both be specified or both be omitted."
            }
          ]);
        }
        if (dbErr.constraint === "chk_product_skus_display_name") {
          throw new ProductValidationError([
            {
              code: "INVALID_TEXT",
              path: ["displayName"],
              message: "displayName cannot be empty."
            }
          ]);
        }
        if (dbErr.constraint === "chk_product_batches_display_name") {
          throw new ProductValidationError([
            {
              code: "INVALID_TEXT",
              path: ["displayName"],
              message: "displayName cannot be empty."
            }
          ]);
        }
        if (dbErr.constraint === "chk_batch_facts_asserted_by_nonempty") {
          throw new ProductValidationError([
            {
              code: "INVALID_TEXT",
              path: ["assertedBy"],
              message: "assertedBy cannot be empty."
            }
          ]);
        }
        if (dbErr.constraint === "chk_batch_facts_producer_identity") {
          throw new ProductValidationError([
            {
              code: "INVALID_TEXT",
              path: ["producerIdentityAsClaimed"],
              message: "producerIdentityAsClaimed must be non-empty if provided."
            }
          ]);
        }
        if (dbErr.constraint === "chk_batch_facts_origin_evidence_revision") {
          throw new ProductValidationError([
            {
              code: "INVALID_REVISION",
              path: ["originEvidenceRevision"],
              message: "originEvidenceRevision must be positive if provided."
            }
          ]);
        }
        if (
          dbErr.constraint === "chk_batch_facts_production_start_date" ||
          dbErr.constraint === "chk_batch_facts_production_end_date"
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_DATE",
              path: [
                dbErr.constraint === "chk_batch_facts_production_start_date"
                  ? "productionStartDate"
                  : "productionEndDate"
              ],
              message: "Date must be a finite valid date between 0001-01-01 and 9999-12-31."
            }
          ]);
        }
        if (
          dbErr.constraint === "chk_product_skus_created_at" ||
          dbErr.constraint === "chk_product_skus_updated_at" ||
          dbErr.constraint === "chk_product_skus_archived_at" ||
          dbErr.constraint === "chk_product_batches_created_at" ||
          dbErr.constraint === "chk_product_batches_updated_at" ||
          dbErr.constraint === "chk_product_batches_archived_at" ||
          dbErr.constraint === "chk_batch_facts_asserted_at" ||
          dbErr.constraint === "chk_receipt_committed_at"
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_TIMESTAMP",
              path: [],
              message: "Timestamp must be finite and within valid range."
            }
          ]);
        }
        if (
          dbErr.constraint === "chk_receipt_hash_format" ||
          dbErr.constraint === "chk_receipt_command_nonempty" ||
          dbErr.constraint === "chk_receipt_actor_nonempty"
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: [],
              message: dbErr.message
            }
          ]);
        }
        if (
          (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) ||
          dbErr.constraint?.startsWith("chk_source_object") ||
          dbErr.constraint?.startsWith("chk_evidence_") ||
          dbErr.constraint?.startsWith("chk_batch_evidence_") ||
          dbErr.constraint?.startsWith("chk_derivative_") ||
          dbErr.constraint?.startsWith("chk_verification_events_") ||
          dbErr.constraint?.startsWith("chk_reservation_") ||
          dbErr.constraint?.startsWith("chk_coa_") ||
          dbErr.constraint === "chk_sha256_format" ||
          (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table))
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: [],
              message: dbErr.message
            }
          ]);
        }
        break;
      }
      case "40001":
      case "40P01":
      case "55P03": {
        throw new ConcurrencyConflictError(
          `PostgreSQL transaction concurrency failure (${dbErr.code}): ${dbErr.message}`
        );
      }
    }
  }

  throw err;
}

export function isProductRegistryDatabaseError(err: unknown): boolean {
  if (err instanceof Error && "code" in err) {
    const dbErr = err as {
      code: string;
      constraint?: string;
      message: string;
      table?: string;
    };
    if (dbErr.code === "40001" || dbErr.code === "40P01" || dbErr.code === "55P03") {
      return true;
    }
    if (dbErr.code === "23506") {
      return true;
    }
    if (dbErr.constraint && REGISTRY_CONSTRAINTS.has(dbErr.constraint)) {
      return true;
    }
    if (dbErr.table && PRODUCT_REGISTRY_TABLES.has(dbErr.table)) {
      return true;
    }
    return (
      dbErr.message.includes("Permanent SKU identity") ||
      dbErr.message.includes("Permanent Batch identity") ||
      dbErr.message.includes("CANNOT_DELETE_HEAD_ENTITY") ||
      dbErr.message.includes("CANNOT_MODIFY_IMMUTABLE_ENTITY") ||
      dbErr.message.includes("Archived SKU") ||
      dbErr.message.includes("Archived Batch") ||
      dbErr.message.includes("Cannot create batch under archived SKU") ||
      dbErr.message.includes("Cannot append facts to archived batch") ||
      dbErr.message.includes("version must advance") ||
      dbErr.message.includes("facts pointer") ||
      dbErr.message.includes("updated_at must be nondecreasing") ||
      dbErr.message.includes("Permanent source object binary columns") ||
      dbErr.message.includes("cannot be reactivated") ||
      dbErr.message.includes("Storage version ID cannot be changed") ||
      dbErr.message.includes("forbids UPDATE or DELETE") ||
      dbErr.message.includes("forbids DELETE")
    );
  }
  return false;
}

// ============================================================================
// Repository Adapter Implementation
// ============================================================================

export class PostgresProductEvidenceRepository implements ProductEvidenceRepositoryPort {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly options?: PostgresProductEvidenceRepositoryOptions
  ) {}

  private requireTransactionClient(): PoolClient {
    if (isPool(this.client) || !this.options?.externalTransaction) {
      throw new Error(
        "PostgresProductEvidenceRepository: mutations require a transaction-bound PoolClient with externalTransaction: true"
      );
    }
    const clientWithTx = this.client as { getTransactionStatus?: () => string | null };
    if (typeof clientWithTx.getTransactionStatus === "function") {
      const status = clientWithTx.getTransactionStatus();
      if (status !== "T") {
        throw new Error(
          "PostgresProductEvidenceRepository: mutations require an active transaction block ('BEGIN')"
        );
      }
    }
    return this.client;
  }

  private async acquireAdvisoryLock(
    client: PoolClient,
    clientId: ClientId,
    actionId: ActionId
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
          result: receipt.response_body as R,
          payloadHash
        };
      }
      throw new IdempotencyConflictError(cmd.actionId);
    }

    return { replay: false, payloadHash };
  }

  private async storeReceipt(
    client: PoolClient,
    cmd: CommandEnvelope<unknown>,
    commandName: string,
    payloadHash: string,
    responseBody: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO product_evidence_command_receipts (
        client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
      [
        cmd.clientId,
        cmd.actionId,
        commandName,
        payloadHash,
        cmd.actorId,
        JSON.stringify(responseBody)
      ]
    );
  }

  // --------------------------------------------------------------------------
  // Mutations
  // --------------------------------------------------------------------------

  async createSku(cmd: CommandEnvelope<CreateSkuCommand>): Promise<ProductSku> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_CREATE_SKU_PAYLOAD_KEYS, ["payload"]);
    normalizeCanonicalSku(cmd.payload.canonicalSku);
    normalizeDisplayName(cmd.payload.displayName, "displayName");

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<CreateSkuCommand, ProductSku>(
        client,
        cmd,
        "createSku"
      );
      if (replay && result) {
        return rehydrateProductSku(result);
      }

      // Generate server UUIDv7 identity for new SKU
      const idRes = await client.query<{ id: string }>("SELECT uuidv7() AS id");
      const skuId = createSkuId(idRes.rows[0]!.id);

      const sku = createProductSku({
        clientId: cmd.clientId,
        skuId,
        canonicalSku: cmd.payload.canonicalSku,
        displayName: cmd.payload.displayName,
        timestamp: cmd.timestamp
      });

      await client.query(
        `INSERT INTO product_skus (
          sku_id, client_id, canonical_sku, display_name, version, created_at, updated_at, archived_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [
          sku.skuId,
          sku.clientId,
          sku.canonicalSku,
          sku.displayName,
          sku.version,
          sku.createdAt,
          sku.updatedAt
        ]
      );

      await this.storeReceipt(client, cmd, "createSku", payloadHash, sku);
      return sku;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        canonicalSku: cmd.payload.canonicalSku,
        actionId: cmd.actionId
      });
    }
  }

  async createBatch(cmd: CommandEnvelope<CreateBatchCommand>): Promise<ProductBatchCreationResult> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_CREATE_BATCH_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    normalizeLotIdentifier(cmd.payload.lotIdentifier);
    normalizeDisplayName(cmd.payload.displayName, "displayName");

    if (cmd.payload.initialFacts !== undefined && cmd.payload.initialFacts !== null) {
      assertNoUnknownKeys(cmd.payload.initialFacts, ALLOWED_INITIAL_FACTS_KEYS, [
        "payload",
        "initialFacts"
      ]);
      const facts = cmd.payload.initialFacts;
      if (
        facts.originEvidenceId !== null &&
        facts.originEvidenceId !== undefined &&
        (facts.originEvidenceRevision === null || facts.originEvidenceRevision === undefined)
      ) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["initialFacts", "originEvidenceRevision"],
            message: "originEvidenceRevision must be specified when originEvidenceId is present."
          }
        ]);
      }
      if (
        (facts.originEvidenceId === null || facts.originEvidenceId === undefined) &&
        facts.originEvidenceRevision !== null &&
        facts.originEvidenceRevision !== undefined
      ) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["initialFacts", "originEvidenceRevision"],
            message: "originEvidenceRevision cannot be specified without originEvidenceId."
          }
        ]);
      }
      if (facts.originEvidenceId !== null && facts.originEvidenceId !== undefined) {
        if (!isValidUuid(facts.originEvidenceId)) {
          throw new ProductValidationError([
            {
              code: "INVALID_IDENTIFIER",
              path: ["initialFacts", "originEvidenceId"],
              message: "originEvidenceId must be a valid UUID string."
            }
          ]);
        }
      }
      if (facts.originEvidenceRevision !== null && facts.originEvidenceRevision !== undefined) {
        if (!isValidPositiveInt(facts.originEvidenceRevision)) {
          throw new ProductValidationError([
            {
              code: "INVALID_REVISION",
              path: ["initialFacts", "originEvidenceRevision"],
              message: "originEvidenceRevision must be a positive integer."
            }
          ]);
        }
      }
      if (!facts.originKind || !ALLOWED_ORIGIN_KINDS.has(facts.originKind)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["initialFacts", "originKind"],
            message: `originKind must be one of: ${Array.from(ALLOWED_ORIGIN_KINDS).join(", ")}.`
          }
        ]);
      }
      if (
        facts.producerIdentityAsClaimed !== undefined &&
        facts.producerIdentityAsClaimed !== null
      ) {
        normalizeProducerIdentity(facts.producerIdentityAsClaimed);
      }
      if (facts.productionStartDate !== undefined && facts.productionStartDate !== null) {
        if (!isValidDateOnly(facts.productionStartDate)) {
          throw new ProductValidationError([
            {
              code: "INVALID_DATE",
              path: ["initialFacts", "productionStartDate"],
              message: "productionStartDate must be a valid YYYY-MM-DD date."
            }
          ]);
        }
      }
      if (facts.productionEndDate !== undefined && facts.productionEndDate !== null) {
        if (!isValidDateOnly(facts.productionEndDate)) {
          throw new ProductValidationError([
            {
              code: "INVALID_DATE",
              path: ["initialFacts", "productionEndDate"],
              message: "productionEndDate must be a valid YYYY-MM-DD date."
            }
          ]);
        }
      }
      if (
        facts.productionStartDate &&
        facts.productionEndDate &&
        compareDateOnly(facts.productionStartDate, facts.productionEndDate) > 0
      ) {
        throw new ProductValidationError([
          {
            code: "INVALID_DATE",
            path: ["initialFacts", "productionDates"],
            message: "productionStartDate cannot be later than productionEndDate."
          }
        ]);
      }
    }

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        CreateBatchCommand,
        ProductBatchCreationResult
      >(client, cmd, "createBatch");
      if (replay && result) {
        return {
          batch: rehydrateProductBatch(result.batch),
          initialFacts: rehydrateBatchFactsRevision(result.initialFacts)
        };
      }

      // Lock parent SKU under deterministic hierarchy
      const skuRes = await client.query<SkuRow>(
        `SELECT sku_id, client_id, canonical_sku, display_name, version, created_at, updated_at, archived_at
         FROM product_skus
         WHERE client_id = $1 AND sku_id = $2
         FOR UPDATE`,
        [cmd.clientId, cmd.payload.skuId]
      );

      if (skuRes.rows.length === 0) {
        throw new NotFoundError("ProductSku", cmd.payload.skuId);
      }
      const parentSku = mapRowToSku(skuRes.rows[0]!);
      assertSkuCanAcceptBatch(parentSku, cmd.clientId);

      // Generate server UUIDv7 identity for new Batch
      const idRes = await client.query<{ id: string }>("SELECT uuidv7() AS id");
      const batchId = createBatchId(idRes.rows[0]!.id);

      if (
        cmd.payload.initialFacts?.originEvidenceId != null &&
        cmd.payload.initialFacts?.originEvidenceRevision != null
      ) {
        const linkRes = await client.query<{ batch_id: string }>(
          `SELECT batch_id FROM batch_evidence_links
           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3`,
          [
            cmd.clientId,
            cmd.payload.initialFacts.originEvidenceId,
            cmd.payload.initialFacts.originEvidenceRevision
          ]
        );
        if (linkRes.rows.length === 0) {
          throw new NotFoundError(
            "BatchEvidenceLink",
            `${cmd.payload.initialFacts.originEvidenceId}#${cmd.payload.initialFacts.originEvidenceRevision}`
          );
        }
        throw new CrossBatchSourceError(
          `Evidence ${cmd.payload.initialFacts.originEvidenceId} revision ${cmd.payload.initialFacts.originEvidenceRevision} is linked to batch ${linkRes.rows[0]!.batch_id} but not batch ${batchId}. Explicit fresh batch evidence link is required.`,
          {
            sha256: cmd.payload.initialFacts.originEvidenceId,
            existingBatchId: linkRes.rows[0]!.batch_id
          }
        );
      }

      const creation = createProductBatch({
        parentSku,
        batchId,
        lotIdentifier: cmd.payload.lotIdentifier,
        displayName: cmd.payload.displayName,
        initialFacts: cmd.payload.initialFacts,
        actorId: cmd.actorId,
        timestamp: cmd.timestamp
      });

      // Insert batch head (version 1, current_facts_revision 1)
      await client.query(
        `INSERT INTO product_batches (
          batch_id, client_id, sku_id, lot_identifier, display_name, version, current_facts_revision, created_at, updated_at, archived_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)`,
        [
          creation.batch.batchId,
          creation.batch.clientId,
          creation.batch.skuId,
          creation.batch.lotIdentifier,
          creation.batch.displayName,
          creation.batch.version,
          creation.batch.currentFactsRevision,
          creation.batch.createdAt,
          creation.batch.updatedAt
        ]
      );

      // Insert initial facts revision 1
      await client.query(
        `INSERT INTO product_batch_facts (
          client_id, batch_id, revision, origin_kind, producer_identity_as_claimed,
          production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision,
          asserted_by, asserted_at, supersedes_revision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL)`,
        [
          creation.initialFacts.clientId,
          creation.initialFacts.batchId,
          creation.initialFacts.revision,
          creation.initialFacts.originKind,
          creation.initialFacts.producerIdentityAsClaimed,
          creation.initialFacts.productionStartDate,
          creation.initialFacts.productionEndDate,
          creation.initialFacts.originEvidenceId,
          creation.initialFacts.originEvidenceRevision,
          creation.initialFacts.assertedBy,
          creation.initialFacts.assertedAt
        ]
      );

      await this.storeReceipt(client, cmd, "createBatch", payloadHash, creation);
      return creation;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        skuId: cmd.payload.skuId,
        lotIdentifier: cmd.payload.lotIdentifier,
        actionId: cmd.actionId
      });
    }
  }

  async appendBatchFacts(
    cmd: CommandEnvelope<AppendBatchFactsCommand>
  ): Promise<BatchFactsRevision> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_APPEND_FACTS_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }

    if (
      cmd.payload.originEvidenceId !== null &&
      cmd.payload.originEvidenceId !== undefined &&
      (cmd.payload.originEvidenceRevision === null ||
        cmd.payload.originEvidenceRevision === undefined)
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["originEvidenceRevision"],
          message: "originEvidenceRevision must be specified when originEvidenceId is present."
        }
      ]);
    }
    if (
      (cmd.payload.originEvidenceId === null || cmd.payload.originEvidenceId === undefined) &&
      cmd.payload.originEvidenceRevision !== null &&
      cmd.payload.originEvidenceRevision !== undefined
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["originEvidenceRevision"],
          message: "originEvidenceRevision cannot be specified without originEvidenceId."
        }
      ]);
    }
    if (cmd.payload.originEvidenceId !== null && cmd.payload.originEvidenceId !== undefined) {
      if (!isValidUuid(cmd.payload.originEvidenceId)) {
        throw new ProductValidationError([
          {
            code: "INVALID_IDENTIFIER",
            path: ["originEvidenceId"],
            message: "originEvidenceId must be a valid UUID string."
          }
        ]);
      }
    }
    if (
      cmd.payload.originEvidenceRevision !== null &&
      cmd.payload.originEvidenceRevision !== undefined
    ) {
      if (!isValidPositiveInt(cmd.payload.originEvidenceRevision)) {
        throw new ProductValidationError([
          {
            code: "INVALID_REVISION",
            path: ["originEvidenceRevision"],
            message: "originEvidenceRevision must be a positive integer."
          }
        ]);
      }
    }

    if (!cmd.payload.originKind || !ALLOWED_ORIGIN_KINDS.has(cmd.payload.originKind)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["originKind"],
          message: `originKind must be one of: ${Array.from(ALLOWED_ORIGIN_KINDS).join(", ")}.`
        }
      ]);
    }

    if (
      cmd.payload.producerIdentityAsClaimed !== undefined &&
      cmd.payload.producerIdentityAsClaimed !== null
    ) {
      normalizeProducerIdentity(cmd.payload.producerIdentityAsClaimed);
    }

    if (cmd.payload.productionStartDate !== undefined && cmd.payload.productionStartDate !== null) {
      if (!isValidDateOnly(cmd.payload.productionStartDate)) {
        throw new ProductValidationError([
          {
            code: "INVALID_DATE",
            path: ["productionStartDate"],
            message: "productionStartDate must be a valid YYYY-MM-DD date."
          }
        ]);
      }
    }

    if (cmd.payload.productionEndDate !== undefined && cmd.payload.productionEndDate !== null) {
      if (!isValidDateOnly(cmd.payload.productionEndDate)) {
        throw new ProductValidationError([
          {
            code: "INVALID_DATE",
            path: ["productionEndDate"],
            message: "productionEndDate must be a valid YYYY-MM-DD date."
          }
        ]);
      }
    }

    if (
      cmd.payload.productionStartDate &&
      cmd.payload.productionEndDate &&
      compareDateOnly(cmd.payload.productionStartDate, cmd.payload.productionEndDate) > 0
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["productionDates"],
          message: "productionStartDate cannot be later than productionEndDate."
        }
      ]);
    }

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        AppendBatchFactsCommand,
        BatchFactsRevision
      >(client, cmd, "appendBatchFacts");
      if (replay && result) {
        return rehydrateBatchFactsRevision(result);
      }

      // Read batch to discover parent skuId
      const probeRes = await client.query<{ sku_id: string }>(
        `SELECT sku_id FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (probeRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      const skuId = probeRes.rows[0]!.sku_id;

      // Lock SKU then Batch in hierarchical order
      const skuRes = await client.query<SkuRow>(
        `SELECT * FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
        [cmd.clientId, skuId]
      );
      const batchRes = await client.query<BatchRow>(
        `SELECT * FROM product_batches WHERE client_id = $1 AND batch_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.batchId]
      );

      if (skuRes.rows.length === 0) {
        throw new NotFoundError("ProductSku", skuId);
      }
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }

      const parentSku = mapRowToSku(skuRes.rows[0]!);
      const currentBatch = mapRowToBatch(batchRes.rows[0]!);

      if (parentSku.archivedAt !== null) {
        throw new AccessDeniedError(
          "Cannot append facts to batch under archived SKU",
          "SKU_ARCHIVED"
        );
      }
      if (currentBatch.archivedAt !== null) {
        throw new AccessDeniedError("Cannot append facts to archived batch", "BATCH_ARCHIVED");
      }
      if (currentBatch.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductBatch",
          cmd.payload.expectedVersion,
          currentBatch.version
        );
      }

      // Fetch predecessor facts
      const factsRes = await client.query<BatchFactsRow>(
        `SELECT * FROM product_batch_facts
         WHERE client_id = $1 AND batch_id = $2 AND revision = $3`,
        [cmd.clientId, cmd.payload.batchId, currentBatch.currentFactsRevision]
      );
      if (factsRes.rows.length === 0) {
        throw new NotFoundError(
          "BatchFactsRevision",
          `Batch ${cmd.payload.batchId} has no initial facts revision ${currentBatch.currentFactsRevision}`
        );
      }
      const previousFacts = mapRowToFacts(factsRes.rows[0]!);

      if (cmd.payload.originEvidenceId != null && cmd.payload.originEvidenceRevision != null) {
        const linkRes = await client.query<{ batch_id: string; source_object_id: string }>(
          `SELECT l.batch_id, r.source_object_id
           FROM batch_evidence_links l
           JOIN evidence_revisions r
             ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
           WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3
           FOR SHARE OF l, r`,
          [cmd.clientId, cmd.payload.originEvidenceId, cmd.payload.originEvidenceRevision]
        );
        if (linkRes.rows.length === 0) {
          throw new NotFoundError(
            "BatchEvidenceLink",
            `${cmd.payload.originEvidenceId}#${cmd.payload.originEvidenceRevision}`
          );
        }
        if (!linkRes.rows.some((r) => r.batch_id === cmd.payload.batchId)) {
          throw new CrossBatchSourceError(
            `Evidence ${cmd.payload.originEvidenceId} revision ${cmd.payload.originEvidenceRevision} is linked to batch ${linkRes.rows[0]!.batch_id} but not batch ${cmd.payload.batchId}. Explicit fresh batch evidence link is required.`,
            {
              sha256: cmd.payload.originEvidenceId,
              existingBatchId: linkRes.rows[0]!.batch_id
            }
          );
        }

        // Check EvidenceAsset is not archived
        const assetRes = await client.query<{ archived_at: Date | null }>(
          `SELECT archived_at FROM evidence_assets
           WHERE client_id = $1 AND evidence_id = $2 FOR SHARE`,
          [cmd.clientId, cmd.payload.originEvidenceId]
        );
        if (assetRes.rows.length === 0) {
          throw new NotFoundError("EvidenceAsset", cmd.payload.originEvidenceId);
        }
        if (assetRes.rows[0]!.archived_at !== null) {
          throw new AccessDeniedError(
            "Referenced evidence asset is archived.",
            "EVIDENCE_ARCHIVED"
          );
        }

        // Check SourceObject is available
        const sourceRes = await client.query<{ availability: string }>(
          `SELECT availability FROM source_objects
           WHERE client_id = $1 AND source_object_id = $2 FOR SHARE`,
          [cmd.clientId, linkRes.rows[0]!.source_object_id]
        );
        if (sourceRes.rows.length === 0) {
          throw new NotFoundError("SourceObject", linkRes.rows[0]!.source_object_id);
        }
        if (sourceRes.rows[0]!.availability !== "available") {
          throw new AccessDeniedError(
            `Referenced source object is unavailable (${sourceRes.rows[0]!.availability}).`,
            "SOURCE_UNAVAILABLE"
          );
        }

        // Check for active disputes on this revision
        const disputeRes = await client.query<{
          event_id: string;
          outcome: string;
          withdrawal_event_id: string | null;
        }>(
          `SELECT event_id, outcome, withdrawal_event_id
           FROM evidence_verification_events
           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
           ORDER BY occurred_at ASC FOR SHARE`,
          [cmd.clientId, cmd.payload.originEvidenceId, cmd.payload.originEvidenceRevision]
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
            `Referenced evidence revision ${cmd.payload.originEvidenceId}#${cmd.payload.originEvidenceRevision} has an active dispute or rejection and cannot be linked as batch origin.`
          );
        }
      }

      const nextFacts = appendBatchFactsRevision(previousFacts, {
        originKind: cmd.payload.originKind,
        producerIdentityAsClaimed: cmd.payload.producerIdentityAsClaimed,
        productionStartDate: cmd.payload.productionStartDate,
        productionEndDate: cmd.payload.productionEndDate,
        originEvidenceId: cmd.payload.originEvidenceId ?? null,
        originEvidenceRevision: cmd.payload.originEvidenceRevision ?? null,
        assertedBy: cmd.actorId,
        assertedAt: cmd.timestamp
      });

      const { current: nextBatch } = applyBatchFactsAppend(
        currentBatch,
        previousFacts,
        nextFacts,
        cmd.payload.expectedVersion
      );

      // Insert new facts revision
      await client.query(
        `INSERT INTO product_batch_facts (
          client_id, batch_id, revision, origin_kind, producer_identity_as_claimed,
          production_start_date, production_end_date, origin_evidence_id, origin_evidence_revision,
          asserted_by, asserted_at, supersedes_revision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          nextFacts.clientId,
          nextFacts.batchId,
          nextFacts.revision,
          nextFacts.originKind,
          nextFacts.producerIdentityAsClaimed,
          nextFacts.productionStartDate,
          nextFacts.productionEndDate,
          nextFacts.originEvidenceId,
          nextFacts.originEvidenceRevision,
          nextFacts.assertedBy,
          nextFacts.assertedAt,
          nextFacts.supersedesRevision
        ]
      );

      // Update batch head version and current facts pointer
      const updateRes = await client.query(
        `UPDATE product_batches
         SET version = $1,
             current_facts_revision = $2,
             updated_at = $3
         WHERE client_id = $4
           AND batch_id = $5
           AND version = $6
           AND archived_at IS NULL`,
        [
          nextBatch.version,
          nextBatch.currentFactsRevision,
          nextBatch.updatedAt,
          cmd.clientId,
          cmd.payload.batchId,
          cmd.payload.expectedVersion
        ]
      );

      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductBatch",
          cmd.payload.expectedVersion,
          currentBatch.version
        );
      }

      await this.storeReceipt(client, cmd, "appendBatchFacts", payloadHash, nextFacts);
      return nextFacts;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        batchId: cmd.payload.batchId,
        actionId: cmd.actionId
      });
    }
  }

  async updateSkuMetadata(
    cmd: CommandEnvelope<UpdateSkuMetadataCommand>
  ): Promise<ProductSkuUpdateResult> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_UPDATE_SKU_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }
    normalizeDisplayName(cmd.payload.displayName, "displayName");

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        UpdateSkuMetadataCommand,
        ProductSkuUpdateResult
      >(client, cmd, "updateSkuMetadata");
      if (replay && result) {
        return {
          sku: rehydrateProductSku(result.sku),
          audit: {
            previous: rehydrateProductSku(result.audit.previous),
            current: rehydrateProductSku(result.audit.current)
          }
        };
      }

      const skuRes = await client.query<SkuRow>(
        `SELECT * FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.skuId]
      );
      if (skuRes.rows.length === 0) {
        throw new NotFoundError("ProductSku", cmd.payload.skuId);
      }
      const current = mapRowToSku(skuRes.rows[0]!);

      if (current.archivedAt !== null) {
        throw new AccessDeniedError("Cannot update metadata on archived SKU", "SKU_ARCHIVED");
      }
      if (current.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductSku",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const { previous, current: nextSku } = updateProductSkuMetadata(current, {
        expectedVersion: cmd.payload.expectedVersion,
        displayName: cmd.payload.displayName,
        updatedAt: cmd.timestamp
      });

      const updateRes = await client.query(
        `UPDATE product_skus
         SET display_name = $1,
             version = $2,
             updated_at = $3
         WHERE client_id = $4
           AND sku_id = $5
           AND version = $6
           AND archived_at IS NULL`,
        [
          nextSku.displayName,
          nextSku.version,
          nextSku.updatedAt,
          cmd.clientId,
          cmd.payload.skuId,
          cmd.payload.expectedVersion
        ]
      );

      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductSku",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const transitionResult: ProductSkuUpdateResult = {
        sku: nextSku,
        audit: { previous, current: nextSku }
      };

      await this.storeReceipt(client, cmd, "updateSkuMetadata", payloadHash, transitionResult);
      return transitionResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        skuId: cmd.payload.skuId,
        actionId: cmd.actionId
      });
    }
  }

  async updateBatchMetadata(
    cmd: CommandEnvelope<UpdateBatchMetadataCommand>
  ): Promise<ProductBatchUpdateResult> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_UPDATE_BATCH_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }
    normalizeDisplayName(cmd.payload.displayName, "displayName");

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        UpdateBatchMetadataCommand,
        ProductBatchUpdateResult
      >(client, cmd, "updateBatchMetadata");
      if (replay && result) {
        return {
          batch: rehydrateProductBatch(result.batch),
          audit: {
            previous: rehydrateProductBatch(result.audit.previous),
            current: rehydrateProductBatch(result.audit.current)
          }
        };
      }

      const probeRes = await client.query<{ sku_id: string }>(
        `SELECT sku_id FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (probeRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      const skuId = probeRes.rows[0]!.sku_id;

      // Lock SKU then Batch
      const skuRes = await client.query<SkuRow>(
        `SELECT * FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
        [cmd.clientId, skuId]
      );
      const batchRes = await client.query<BatchRow>(
        `SELECT * FROM product_batches WHERE client_id = $1 AND batch_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.batchId]
      );

      if (skuRes.rows.length === 0) {
        throw new NotFoundError("ProductSku", skuId);
      }
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }

      const parentSku = mapRowToSku(skuRes.rows[0]!);
      const current = mapRowToBatch(batchRes.rows[0]!);

      if (parentSku.archivedAt !== null) {
        throw new AccessDeniedError(
          "Cannot update metadata on batch under archived SKU",
          "SKU_ARCHIVED"
        );
      }
      if (current.archivedAt !== null) {
        throw new AccessDeniedError("Cannot update metadata on archived batch", "BATCH_ARCHIVED");
      }
      if (current.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductBatch",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const { previous, current: nextBatch } = updateProductBatchMetadata(current, {
        expectedVersion: cmd.payload.expectedVersion,
        displayName: cmd.payload.displayName,
        updatedAt: cmd.timestamp
      });

      const updateRes = await client.query(
        `UPDATE product_batches
         SET display_name = $1,
             version = $2,
             updated_at = $3
         WHERE client_id = $4
           AND batch_id = $5
           AND version = $6
           AND archived_at IS NULL`,
        [
          nextBatch.displayName,
          nextBatch.version,
          nextBatch.updatedAt,
          cmd.clientId,
          cmd.payload.batchId,
          cmd.payload.expectedVersion
        ]
      );

      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductBatch",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const transitionResult: ProductBatchUpdateResult = {
        batch: nextBatch,
        audit: { previous, current: nextBatch }
      };

      await this.storeReceipt(client, cmd, "updateBatchMetadata", payloadHash, transitionResult);
      return transitionResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        batchId: cmd.payload.batchId,
        actionId: cmd.actionId
      });
    }
  }

  async archiveSku(cmd: CommandEnvelope<ArchiveSkuCommand>): Promise<ProductSkuArchiveResult> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_ARCHIVE_SKU_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        ArchiveSkuCommand,
        ProductSkuArchiveResult
      >(client, cmd, "archiveSku");
      if (replay && result) {
        return {
          sku: rehydrateProductSku(result.sku),
          audit: {
            previous: rehydrateProductSku(result.audit.previous),
            current: rehydrateProductSku(result.audit.current)
          }
        };
      }

      const skuRes = await client.query<SkuRow>(
        `SELECT * FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.skuId]
      );
      if (skuRes.rows.length === 0) {
        throw new NotFoundError("ProductSku", cmd.payload.skuId);
      }
      const current = mapRowToSku(skuRes.rows[0]!);

      if (current.archivedAt !== null) {
        throw new AccessDeniedError("SKU is already archived", "ALREADY_ARCHIVED");
      }
      if (current.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductSku",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const { previous, current: nextSku } = archiveProductSku(current, {
        expectedVersion: cmd.payload.expectedVersion,
        archivedAt: cmd.timestamp
      });

      const updateRes = await client.query(
        `UPDATE product_skus
         SET version = $1,
             updated_at = $2,
             archived_at = $3
         WHERE client_id = $4
           AND sku_id = $5
           AND version = $6
           AND archived_at IS NULL`,
        [
          nextSku.version,
          nextSku.updatedAt,
          nextSku.archivedAt,
          cmd.clientId,
          cmd.payload.skuId,
          cmd.payload.expectedVersion
        ]
      );

      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductSku",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const transitionResult: ProductSkuArchiveResult = {
        sku: nextSku,
        audit: { previous, current: nextSku }
      };

      await this.storeReceipt(client, cmd, "archiveSku", payloadHash, transitionResult);
      return transitionResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        skuId: cmd.payload.skuId,
        actionId: cmd.actionId
      });
    }
  }

  async archiveBatch(
    cmd: CommandEnvelope<ArchiveBatchCommand>
  ): Promise<ProductBatchArchiveResult> {
    const client = this.requireTransactionClient();
    validateEnvelope(cmd);
    assertNoUnknownKeys(cmd.payload, ALLOWED_ARCHIVE_BATCH_PAYLOAD_KEYS, ["payload"]);
    if (!isValidUuid(cmd.payload.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(cmd.payload.expectedVersion)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedVersion"],
          message: "expectedVersion must be a positive integer."
        }
      ]);
    }

    try {
      await this.acquireAdvisoryLock(client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } = await this.checkReceipt<
        ArchiveBatchCommand,
        ProductBatchArchiveResult
      >(client, cmd, "archiveBatch");
      if (replay && result) {
        return {
          batch: rehydrateProductBatch(result.batch),
          audit: {
            previous: rehydrateProductBatch(result.audit.previous),
            current: rehydrateProductBatch(result.audit.current)
          }
        };
      }

      const probeRes = await client.query<{ sku_id: string }>(
        `SELECT sku_id FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (probeRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      const skuId = probeRes.rows[0]!.sku_id;

      // Lock SKU then Batch
      await client.query(
        `SELECT * FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR UPDATE`,
        [cmd.clientId, skuId]
      );
      const batchRes = await client.query<BatchRow>(
        `SELECT * FROM product_batches WHERE client_id = $1 AND batch_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      const current = mapRowToBatch(batchRes.rows[0]!);

      if (current.archivedAt !== null) {
        throw new AccessDeniedError("Batch is already archived", "ALREADY_ARCHIVED");
      }
      if (current.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductBatch",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const { previous, current: nextBatch } = archiveProductBatch(current, {
        expectedVersion: cmd.payload.expectedVersion,
        archivedAt: cmd.timestamp
      });

      const updateRes = await client.query(
        `UPDATE product_batches
         SET version = $1,
             updated_at = $2,
             archived_at = $3
         WHERE client_id = $4
           AND batch_id = $5
           AND version = $6
           AND archived_at IS NULL`,
        [
          nextBatch.version,
          nextBatch.updatedAt,
          nextBatch.archivedAt,
          cmd.clientId,
          cmd.payload.batchId,
          cmd.payload.expectedVersion
        ]
      );

      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductBatch",
          cmd.payload.expectedVersion,
          current.version
        );
      }

      const transitionResult: ProductBatchArchiveResult = {
        batch: nextBatch,
        audit: { previous, current: nextBatch }
      };

      await this.storeReceipt(client, cmd, "archiveBatch", payloadHash, transitionResult);
      return transitionResult;
    } catch (err) {
      translateDatabaseError(err, {
        clientId: cmd.clientId,
        batchId: cmd.payload.batchId,
        actionId: cmd.actionId
      });
    }
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async getSkuById(clientId: ClientId, skuId: SkuId): Promise<ProductSku | null> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID string."
        }
      ]);
    }
    const res = await this.client.query<SkuRow>(
      `SELECT * FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
      [clientId, skuId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToSku(res.rows[0]!);
  }

  async listSkus(
    clientId: ClientId,
    filter?: { readonly includeArchived?: boolean | undefined }
  ): Promise<readonly ProductSku[]> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    const query = filter?.includeArchived
      ? `SELECT * FROM product_skus WHERE client_id = $1 ORDER BY created_at ASC, sku_id ASC`
      : `SELECT * FROM product_skus WHERE client_id = $1 AND archived_at IS NULL ORDER BY created_at ASC, sku_id ASC`;

    const res = await this.client.query<SkuRow>(query, [clientId]);
    return res.rows.map(mapRowToSku);
  }

  async getBatchById(clientId: ClientId, batchId: BatchId): Promise<ProductBatch | null> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    const res = await this.client.query<BatchRow>(
      `SELECT * FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
      [clientId, batchId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToBatch(res.rows[0]!);
  }

  async getBatchHistory(
    clientId: ClientId,
    batchId: BatchId
  ): Promise<readonly BatchFactsRevision[]> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    const res = await this.client.query<BatchFactsRow>(
      `SELECT * FROM product_batch_facts
       WHERE client_id = $1 AND batch_id = $2
       ORDER BY revision ASC`,
      [clientId, batchId]
    );
    return res.rows.map(mapRowToFacts);
  }

  async listBatches(
    clientId: ClientId,
    filter?: {
      readonly skuId?: SkuId | undefined;
      readonly includeArchived?: boolean | undefined;
    }
  ): Promise<readonly ProductBatch[]> {
    if (!isValidUuid(clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (filter?.skuId && !isValidUuid(filter.skuId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["filter", "skuId"],
          message: "skuId filter must be a valid UUID string."
        }
      ]);
    }
    if (filter?.includeArchived) {
      if (filter.skuId) {
        const res = await this.client.query<BatchRow>(
          `SELECT b.* FROM product_batches b
           WHERE b.client_id = $1 AND b.sku_id = $2
           ORDER BY b.created_at ASC, b.batch_id ASC`,
          [clientId, filter.skuId]
        );
        return res.rows.map(mapRowToBatch);
      }
      const res = await this.client.query<BatchRow>(
        `SELECT b.* FROM product_batches b
         WHERE b.client_id = $1
         ORDER BY b.created_at ASC, b.batch_id ASC`,
        [clientId]
      );
      return res.rows.map(mapRowToBatch);
    }

    // Default: active/selectable batches excluding batches under archived SKUs
    if (filter?.skuId) {
      const res = await this.client.query<BatchRow>(
        `SELECT b.* FROM product_batches b
         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
         WHERE b.client_id = $1
           AND b.sku_id = $2
           AND b.archived_at IS NULL
           AND s.archived_at IS NULL
         ORDER BY b.created_at ASC, b.batch_id ASC`,
        [clientId, filter.skuId]
      );
      return res.rows.map(mapRowToBatch);
    }

    const res = await this.client.query<BatchRow>(
      `SELECT b.* FROM product_batches b
       JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
       WHERE b.client_id = $1
         AND b.archived_at IS NULL
         AND s.archived_at IS NULL
       ORDER BY b.created_at ASC, b.batch_id ASC`,
      [clientId]
    );
    return res.rows.map(mapRowToBatch);
  }
}
