import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  canonicalizeUtcTimestamp,
  sortKeysDeep,
  type BatchEvidencePurpose,
  type ConsentStatus,
  type DateOnlyString,
  type EvidenceAcquisitionMethod,
  type EvidenceSourceClass,
  type IsoTimestampString,
  type LegalRightsStatus,
  type ReportedCapturePrecision,
  type VerificationFactScope,
  type VerificationKind,
  type VerificationOutcome
} from "@cco/shared";
import {
  AccessDeniedError,
  ConcurrencyConflictError,
  createSourceObjectId,
  CrossBatchSourceError,
  evaluateEvidenceEligibility,
  IdempotencyConflictError,
  MimeConflictError,
  NotFoundError,
  ProductValidationError,
  rehydrateBatchEvidenceLink,
  rehydrateEvidenceAsset,
  rehydrateEvidenceDerivative,
  rehydrateEvidenceRevision,
  rehydrateEvidenceVerificationEvent,
  rehydrateSourceObject,
  ReportDisputedError,
  SourceSupersededError,
  StaleRevisionConflictError,
  type ActionId,
  type BatchEvidenceLink,
  type BatchId,
  type ClientId,
  type DerivativeId,
  type EvidenceAsset,
  type EvidenceDerivative,
  type EvidenceEligibilityResult,
  type EvidenceId,
  type EvidenceRevision,
  type EvidenceVerificationEvent,
  type Sha256Hex,
  type SourceObject,
  type SourceObjectId,
  type VerificationEventId
} from "@cco/domain";
import { translateDatabaseError } from "../postgres/repositories/postgres-product-evidence-repository.js";
import type {
  AppendVerificationEventCommandPayload,
  CommandEnvelope,
  EvidenceAssetRepositoryPort,
  LinkEvidenceDerivativeCommandPayload,
  RegisterEvidenceCommandPayload,
  RegisterEvidenceResult
} from "@cco/application";

export interface PostgresEvidenceAssetRepositoryOptions {
  readonly externalTransaction?: boolean;
  readonly lockTimeoutMs?: number;
}

interface SourceObjectRow {
  readonly source_object_id: string;
  readonly client_id: string;
  readonly storage_bucket: string;
  readonly storage_object_key: string;
  readonly original_sha256: string;
  readonly detected_mime_type: string;
  readonly byte_length: string | number;
  readonly uploaded_at: Date | string;
  readonly uploader_id: string;
  readonly access_class: "restricted_original";
  readonly retention_class: "source_evidence_archive";
  readonly retention_policy_version: string;
  readonly availability: "available" | "archived" | "quarantined" | "deleted_under_retention";
  readonly storage_version_id: string | null;
}

interface EvidenceAssetRow {
  readonly evidence_id: string;
  readonly client_id: string;
  readonly current_revision: number;
  readonly version: number;
  readonly created_at: Date | string;
  readonly archived_at: Date | string | null;
}

interface EvidenceRevisionRow {
  readonly client_id: string;
  readonly evidence_id: string;
  readonly revision: number;
  readonly source_object_id: string;
  readonly source_class: string;
  readonly acquisition_method: string;
  readonly submitted_by: string;
  readonly submitted_at: Date | string;
  readonly assertion_text: string;
  readonly reported_capture_date: Date | string | null;
  readonly reported_capture_timestamp: Date | string | null;
  readonly reported_capture_precision: string | null;
  readonly capture_context: string | null;
  readonly rights_status: string;
  readonly consent_status: string;
  readonly rights_attribution: string | null;
  readonly rights_document_locator: string | null;
  readonly supersedes_revision: number | null;
}

interface BatchEvidenceLinkRow {
  readonly client_id: string;
  readonly batch_id: string;
  readonly evidence_id: string;
  readonly evidence_revision: number;
  readonly purpose: string;
  readonly asserted_by: string;
  readonly asserted_at: Date | string;
}

interface EvidenceDerivativeRow {
  readonly derivative_id: string;
  readonly client_id: string;
  readonly evidence_id: string;
  readonly evidence_revision: number;
  readonly reference_asset_id: string;
  readonly derivative_sha256: string;
  readonly transform_description: string;
  readonly transform_tool_version: string | null;
  readonly created_by: string;
  readonly created_at: Date | string;
}

interface EvidenceVerificationEventRow {
  readonly event_id: string;
  readonly client_id: string;
  readonly evidence_id: string;
  readonly evidence_revision: number;
  readonly outcome: string;
  readonly verification_kind: string;
  readonly fact_scope: string;
  readonly actor_id: string;
  readonly occurred_at: Date | string;
  readonly method: string;
  readonly reason: string;
  readonly verified_party_reference: string | null;
  readonly withdrawal_event_id: string | null;
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

export function computeEvidencePayloadSha256(commandName: string, payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const copy = { ...(payload as Record<string, unknown>) };
    if (commandName === "registerEvidence") {
      delete copy.sourceObjectId;
    }
    const sorted = sortKeysDeep(copy);
    return createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
  }
  const sorted = sortKeysDeep(payload);
  const json = JSON.stringify(sorted);
  return createHash("sha256").update(json, "utf8").digest("hex");
}

function computePayloadSha256(commandName: string, payload: unknown): string {
  return computeEvidencePayloadSha256(commandName, payload);
}

function mapRowToSourceObject(row: SourceObjectRow): SourceObject {
  return rehydrateSourceObject({
    clientId: row.client_id as ClientId,
    sourceObjectId: row.source_object_id as SourceObjectId,
    storageBucket: row.storage_bucket,
    storageObjectKey: row.storage_object_key,
    originalSha256: row.original_sha256 as Sha256Hex,
    detectedMimeType: row.detected_mime_type,
    byteLength: Number(row.byte_length),
    uploadedAt: formatIsoUtcTimestamp(row.uploaded_at),
    uploaderId: row.uploader_id,
    accessClass: "restricted_original",
    retentionClass: "source_evidence_archive",
    retentionPolicyVersion: row.retention_policy_version,
    availability: row.availability,
    storageVersionId: row.storage_version_id
  });
}

function mapRowToEvidenceAsset(row: EvidenceAssetRow): EvidenceAsset {
  return rehydrateEvidenceAsset({
    clientId: row.client_id as ClientId,
    evidenceId: row.evidence_id as EvidenceId,
    currentRevision: row.current_revision,
    version: row.version,
    createdAt: formatIsoUtcTimestamp(row.created_at),
    archivedAt: row.archived_at ? formatIsoUtcTimestamp(row.archived_at) : null
  });
}

function mapRowToEvidenceRevision(row: EvidenceRevisionRow): EvidenceRevision {
  let captureDate: string | null = null;
  if (row.reported_capture_date) {
    if (row.reported_capture_date instanceof Date) {
      captureDate = row.reported_capture_date.toISOString().slice(0, 10);
    } else {
      captureDate = String(row.reported_capture_date).slice(0, 10);
    }
  }

  return rehydrateEvidenceRevision({
    clientId: row.client_id as ClientId,
    evidenceId: row.evidence_id as EvidenceId,
    revision: row.revision,
    sourceObjectId: row.source_object_id as SourceObjectId,
    sourceClass: row.source_class as EvidenceSourceClass,
    acquisitionMethod: row.acquisition_method as EvidenceAcquisitionMethod,
    submittedBy: row.submitted_by,
    submittedAt: formatIsoUtcTimestamp(row.submitted_at),
    assertionText: row.assertion_text,
    reportedCaptureDate: captureDate as DateOnlyString | null,
    reportedCaptureTimestamp: row.reported_capture_timestamp
      ? formatIsoUtcTimestamp(row.reported_capture_timestamp)
      : null,
    reportedCapturePrecision: row.reported_capture_precision as ReportedCapturePrecision | null,
    captureContext: row.capture_context,
    rightsStatus: row.rights_status as LegalRightsStatus,
    consentStatus: row.consent_status as ConsentStatus,
    rightsAttribution: row.rights_attribution,
    rightsDocumentLocator: row.rights_document_locator,
    supersedesRevision: row.supersedes_revision
  });
}

function mapRowToBatchEvidenceLink(row: BatchEvidenceLinkRow): BatchEvidenceLink {
  return rehydrateBatchEvidenceLink({
    clientId: row.client_id as ClientId,
    batchId: row.batch_id as BatchId,
    evidenceId: row.evidence_id as EvidenceId,
    evidenceRevision: row.evidence_revision,
    purpose: row.purpose as BatchEvidencePurpose,
    assertedBy: row.asserted_by,
    assertedAt: formatIsoUtcTimestamp(row.asserted_at)
  });
}

function mapRowToEvidenceDerivative(row: EvidenceDerivativeRow): EvidenceDerivative {
  return rehydrateEvidenceDerivative({
    clientId: row.client_id as ClientId,
    derivativeId: row.derivative_id as DerivativeId,
    evidenceId: row.evidence_id as EvidenceId,
    evidenceRevision: row.evidence_revision,
    referenceAssetId: row.reference_asset_id,
    derivativeSha256: row.derivative_sha256 as Sha256Hex,
    transformDescription: row.transform_description,
    transformToolVersion: row.transform_tool_version,
    createdBy: row.created_by,
    createdAt: formatIsoUtcTimestamp(row.created_at)
  });
}

function mapRowToEvidenceVerificationEvent(
  row: EvidenceVerificationEventRow
): EvidenceVerificationEvent {
  return rehydrateEvidenceVerificationEvent({
    clientId: row.client_id as ClientId,
    eventId: row.event_id as VerificationEventId,
    evidenceId: row.evidence_id as EvidenceId,
    evidenceRevision: row.evidence_revision,
    outcome: row.outcome as VerificationOutcome,
    verificationKind: row.verification_kind as VerificationKind,
    factScope: row.fact_scope as VerificationFactScope,
    actorId: row.actor_id,
    occurredAt: formatIsoUtcTimestamp(row.occurred_at),
    method: row.method,
    reason: row.reason,
    verifiedPartyReference: row.verified_party_reference,
    withdrawalEventId: row.withdrawal_event_id
      ? (row.withdrawal_event_id as VerificationEventId)
      : null
  });
}

export class PostgresEvidenceAssetRepository implements EvidenceAssetRepositoryPort {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly options?: PostgresEvidenceAssetRepositoryOptions
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

  async getCommandReceipt(
    clientId: ClientId,
    actionId: ActionId
  ): Promise<{
    readonly commandName: string;
    readonly payloadSha256: string;
    readonly actorId: string;
    readonly responseBody: unknown;
  } | null> {
    try {
      if (!isPool(this.client) && this.options?.externalTransaction) {
        await this.acquireCommandAdvisoryLock(this.client, clientId, actionId);
      }
      const res = await this.client.query<ReceiptRow>(
        `SELECT client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at
         FROM product_evidence_command_receipts
         WHERE client_id = $1 AND action_id = $2`,
        [clientId, actionId]
      );
      if (res.rows.length === 0) {
        return null;
      }
      const row = res.rows[0]!;
      return {
        commandName: row.command_name,
        payloadSha256: row.payload_sha256,
        actorId: row.actor_id,
        responseBody:
          typeof row.response_body === "string" ? JSON.parse(row.response_body) : row.response_body
      };
    } catch (err) {
      translateDatabaseError(err, { clientId, actionId });
    }
  }

  private async assertNoActiveDisputes(
    client: PoolClient,
    clientId: ClientId,
    sourceObjectId: SourceObjectId
  ): Promise<void> {
    await client.query(
      `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR SHARE`,
      [clientId, sourceObjectId]
    );

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

  private async checkReceipt<T, R>(
    client: PoolClient,
    cmd: CommandEnvelope<T>,
    commandName: string
  ): Promise<{ readonly replay: boolean; readonly result?: R; readonly payloadHash: string }> {
    const payloadHash = computePayloadSha256(commandName, cmd.payload);

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

  // --------------------------------------------------------------------------
  // Quota & Ingest Reservations
  // --------------------------------------------------------------------------

  async createIngestReservation(
    clientId: ClientId,
    sha256: Sha256Hex,
    byteLength: number,
    ttlSeconds: number
  ): Promise<string> {
    try {
      const resId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

      await this.client.query(
        `SELECT pg_advisory_xact_lock(hashtext('evidence_quota_lock'), hashtext($1))`,
        [clientId]
      );

      await this.client.query(
        `INSERT INTO evidence_ingest_reservations
           (reservation_id, client_id, sha256, reserved_bytes, status, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5)`,
        [resId, clientId, sha256, byteLength, expiresAt]
      );

      return resId;
    } catch (err) {
      translateDatabaseError(err, { clientId });
    }
  }

  async completeIngestReservation(
    reservationId: string,
    status: "committed" | "released" | "abandoned"
  ): Promise<void> {
    try {
      await this.client.query(
        `UPDATE evidence_ingest_reservations
         SET status = $1, updated_at = NOW()
         WHERE reservation_id = $2`,
        [status, reservationId]
      );
    } catch (err) {
      translateDatabaseError(err);
    }
  }

  async getClientStorageUsage(clientId: ClientId): Promise<{
    readonly totalStoredBytes: number;
    readonly activeReservedBytes: number;
    readonly concurrentInflightCount: number;
  }> {
    try {
      await this.client.query(
        `SELECT pg_advisory_xact_lock(hashtext('evidence_quota_lock'), hashtext($1))`,
        [clientId]
      );

      const storedRes = await this.client.query<{ total_bytes: string | null }>(
        `SELECT COALESCE(SUM(byte_length), 0) AS total_bytes
         FROM source_objects
         WHERE client_id = $1 AND availability != 'deleted_under_retention'`,
        [clientId]
      );
      const totalStoredBytes = Number(storedRes.rows[0]?.total_bytes ?? 0);

      const activeRes = await this.client.query<{
        reserved_bytes: string | null;
        inflight_count: string | null;
      }>(
        `SELECT COALESCE(SUM(reserved_bytes), 0) AS reserved_bytes,
                COUNT(*) FILTER (WHERE status = 'active') AS inflight_count
         FROM evidence_ingest_reservations
         WHERE client_id = $1 AND (
           (status = 'active' AND expires_at > NOW()) OR
           status = 'abandoned'
         )`,
        [clientId]
      );
      const activeReservedBytes = Number(activeRes.rows[0]?.reserved_bytes ?? 0);
      const concurrentInflightCount = Number(activeRes.rows[0]?.inflight_count ?? 0);

      return { totalStoredBytes, activeReservedBytes, concurrentInflightCount };
    } catch (err) {
      translateDatabaseError(err, { clientId });
    }
  }

  async quarantineSourceObject(
    clientId: ClientId,
    sourceObjectId: SourceObjectId,
    _reason: string
  ): Promise<void> {
    try {
      await this.client.query(
        `UPDATE source_objects
         SET availability = 'quarantined'
         WHERE client_id = $1 AND source_object_id = $2`,
        [clientId, sourceObjectId]
      );
    } catch (err) {
      translateDatabaseError(err, { clientId });
    }
  }

  // --------------------------------------------------------------------------
  // Mutating Commands
  // --------------------------------------------------------------------------

  async registerEvidence(
    cmd: CommandEnvelope<RegisterEvidenceCommandPayload>
  ): Promise<RegisterEvidenceResult> {
    const client = this.requireTransactionClient();

    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);
      const { replay, result, payloadHash } = await this.checkReceipt<
        RegisterEvidenceCommandPayload,
        RegisterEvidenceResult
      >(client, cmd, "registerEvidence");
      if (replay && result) {
        return {
          evidenceAsset: rehydrateEvidenceAsset(result.evidenceAsset),
          evidenceRevision: rehydrateEvidenceRevision(result.evidenceRevision),
          sourceObject: rehydrateSourceObject(result.sourceObject),
          batchEvidenceLink: rehydrateBatchEvidenceLink(result.batchEvidenceLink),
          derivative: result.derivative ? rehydrateEvidenceDerivative(result.derivative) : null
        };
      }

      // 1. Lock and verify batch and SKU rows
      const batchRes = await client.query<{
        batch_id: string;
        archived_at: Date | null;
        sku_id: string;
        sku_archived_at: Date | null;
      }>(
        `SELECT b.batch_id, b.archived_at, s.sku_id, s.archived_at AS sku_archived_at
         FROM product_batches b
         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
         WHERE b.client_id = $1 AND b.batch_id = $2 FOR UPDATE OF b, s`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      if (batchRes.rows[0]!.archived_at !== null) {
        throw new AccessDeniedError("Cannot link evidence to an archived batch", "BATCH_ARCHIVED");
      }
      if (batchRes.rows[0]!.sku_archived_at !== null) {
        throw new AccessDeniedError(
          "Cannot link evidence to a batch under an archived SKU",
          "SKU_ARCHIVED"
        );
      }

      // 2. Resolve or insert SourceObject
      let sourceObject: SourceObject;
      let isNewSourceObject = false;
      if (cmd.payload.reusedSourceObjectId) {
        const sourceRes = await client.query<SourceObjectRow>(
          `SELECT * FROM source_objects
           WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
          [cmd.clientId, cmd.payload.reusedSourceObjectId]
        );
        if (sourceRes.rows.length === 0) {
          throw new NotFoundError("SourceObject", cmd.payload.reusedSourceObjectId);
        }
        const existing = sourceRes.rows[0]!;
        if (existing.availability !== "available") {
          throw new AccessDeniedError(
            `Source object ${cmd.payload.reusedSourceObjectId} is unavailable (${existing.availability}) and cannot be reused or registered.`,
            "SOURCE_UNAVAILABLE"
          );
        }
        if (existing.original_sha256 !== cmd.payload.originalSha256) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["originalSha256"],
              message: `Reused source object originalSha256 mismatch: expected ${existing.original_sha256}, got ${cmd.payload.originalSha256}`
            }
          ]);
        }
        if (
          existing.detected_mime_type !== cmd.payload.detectedMimeType ||
          Number(existing.byte_length) !== cmd.payload.byteLength
        ) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: [],
              message: "detectedMimeType or byteLength does not match reused source object."
            }
          ]);
        }
        sourceObject = mapRowToSourceObject(existing);
        isNewSourceObject = false;
      } else {
        const existingSourceRes = await client.query<SourceObjectRow>(
          `SELECT * FROM source_objects
           WHERE client_id = $1 AND original_sha256 = $2 FOR UPDATE`,
          [cmd.clientId, cmd.payload.originalSha256]
        );

        if (existingSourceRes.rows.length > 0) {
          const existing = existingSourceRes.rows[0]!;
          if (existing.availability !== "available") {
            throw new AccessDeniedError(
              `Source object with hash "${cmd.payload.originalSha256}" is unavailable (${existing.availability}) and cannot be reused or registered.`,
              "SOURCE_UNAVAILABLE"
            );
          }
          if (
            existing.detected_mime_type !== cmd.payload.detectedMimeType ||
            Number(existing.byte_length) !== cmd.payload.byteLength
          ) {
            throw new ProductValidationError([
              {
                code: "INVALID_FIELD_COMBINATION",
                path: [],
                message: "detectedMimeType or byteLength does not match existing source object."
              }
            ]);
          }
          sourceObject = mapRowToSourceObject(existing);
          isNewSourceObject = false;
        } else {
          const sourceObjectId =
            cmd.payload.sourceObjectId ?? createSourceObjectId(crypto.randomUUID());
          const insertSourceRes = await client.query<SourceObjectRow>(
            `INSERT INTO source_objects
               (source_object_id, client_id, storage_bucket, storage_object_key,
                original_sha256, detected_mime_type, byte_length, uploader_id,
                access_class, retention_class, retention_policy_version, availability)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'restricted_original', 'source_evidence_archive', $9, 'available')
             RETURNING *`,
            [
              sourceObjectId,
              cmd.clientId,
              cmd.payload.storageBucket,
              cmd.payload.storageObjectKey,
              cmd.payload.originalSha256,
              cmd.payload.detectedMimeType,
              cmd.payload.byteLength,
              cmd.actorId,
              cmd.payload.retentionPolicyVersion
            ]
          );
          sourceObject = mapRowToSourceObject(insertSourceRes.rows[0]!);
          isNewSourceObject = true;
        }
      }

      // 3. Process Registration Intent
      let evidenceAsset: EvidenceAsset;
      let evidenceRevision: EvidenceRevision;

      if (cmd.payload.registrationIntent === "initial_assertion") {
        // Check if this source hash is already associated with another batch
        const crossBatchRes = await client.query<{ batch_id: string }>(
          `SELECT DISTINCT l.batch_id
         FROM batch_evidence_links l
         JOIN evidence_revisions r
           ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         WHERE l.client_id = $1
           AND r.source_object_id = $2
           AND l.batch_id != $3`,
          [cmd.clientId, sourceObject.sourceObjectId, cmd.payload.batchId]
        );

        if (crossBatchRes.rows.length > 0) {
          throw new CrossBatchSourceError(
            `Source hash "${cmd.payload.originalSha256}" is already associated with another batch (${crossBatchRes.rows[0]!.batch_id}). Explicit new_batch_assertion intent with fresh lot attestation is required.`,
            {
              sha256: cmd.payload.originalSha256,
              existingBatchId: crossBatchRes.rows[0]!.batch_id
            }
          );
        }

        if (!isNewSourceObject) {
          await this.assertNoActiveDisputes(client, cmd.clientId, sourceObject.sourceObjectId);
        }

        // Check if already linked to THIS batch with this source object
        const sameBatchRes = await client.query<{ evidence_id: string }>(
          `SELECT DISTINCT l.evidence_id
         FROM batch_evidence_links l
         JOIN evidence_revisions r
           ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         WHERE l.client_id = $1
           AND r.source_object_id = $2
           AND l.batch_id = $3`,
          [cmd.clientId, sourceObject.sourceObjectId, cmd.payload.batchId]
        );

        if (sameBatchRes.rows.length > 0) {
          throw new ConcurrencyConflictError(
            `Source hash "${cmd.payload.originalSha256}" is already linked to batch "${cmd.payload.batchId}". Duplicate assertion without supersession is rejected.`
          );
        }

        // Create new evidence asset head
        const evidenceId = crypto.randomUUID();
        const assetRes = await client.query<EvidenceAssetRow>(
          `INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version, created_at)
         VALUES ($1, $2, 1, 1, $3)
         RETURNING *`,
          [evidenceId, cmd.clientId, cmd.timestamp]
        );
        evidenceAsset = mapRowToEvidenceAsset(assetRes.rows[0]!);

        // Insert revision 1
        const revRes = await client.query<EvidenceRevisionRow>(
          `INSERT INTO evidence_revisions
           (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method,
            submitted_by, submitted_at, assertion_text, reported_capture_date,
            reported_capture_timestamp, reported_capture_precision, capture_context,
            rights_status, consent_status, rights_attribution, rights_document_locator, supersedes_revision)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NULL)
         RETURNING *`,
          [
            cmd.clientId,
            evidenceId,
            sourceObject.sourceObjectId,
            cmd.payload.sourceClass,
            cmd.payload.acquisitionMethod,
            cmd.actorId,
            cmd.timestamp,
            cmd.payload.assertionText,
            cmd.payload.reportedCaptureDate,
            cmd.payload.reportedCaptureTimestamp,
            cmd.payload.reportedCapturePrecision,
            cmd.payload.captureContext ?? null,
            cmd.payload.rightsStatus,
            cmd.payload.consentStatus,
            cmd.payload.rightsAttribution ?? null,
            cmd.payload.rightsDocumentLocator ?? null
          ]
        );
        evidenceRevision = mapRowToEvidenceRevision(revRes.rows[0]!);
      } else if (cmd.payload.registrationIntent === "new_batch_assertion") {
        await this.assertNoActiveDisputes(client, cmd.clientId, sourceObject.sourceObjectId);

        // Check if already linked to THIS batch with this source object
        const sameBatchRes = await client.query<{ evidence_id: string }>(
          `SELECT DISTINCT l.evidence_id
         FROM batch_evidence_links l
         JOIN evidence_revisions r
           ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
         WHERE l.client_id = $1
           AND r.source_object_id = $2
           AND l.batch_id = $3`,
          [cmd.clientId, sourceObject.sourceObjectId, cmd.payload.batchId]
        );

        if (sameBatchRes.rows.length > 0) {
          throw new ConcurrencyConflictError(
            `Source hash "${cmd.payload.originalSha256}" is already linked to batch "${cmd.payload.batchId}". Duplicate assertion without supersession is rejected.`
          );
        }

        // Create new evidence asset head for the new batch
        const evidenceId = crypto.randomUUID();
        const assetRes = await client.query<EvidenceAssetRow>(
          `INSERT INTO evidence_assets (evidence_id, client_id, current_revision, version, created_at)
         VALUES ($1, $2, 1, 1, $3)
         RETURNING *`,
          [evidenceId, cmd.clientId, cmd.timestamp]
        );
        evidenceAsset = mapRowToEvidenceAsset(assetRes.rows[0]!);

        // Insert revision 1 for new batch with fresh explicit lot-specific attestation
        const revRes = await client.query<EvidenceRevisionRow>(
          `INSERT INTO evidence_revisions
           (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method,
            submitted_by, submitted_at, assertion_text, reported_capture_date,
            reported_capture_timestamp, reported_capture_precision, capture_context,
            rights_status, consent_status, rights_attribution, rights_document_locator, supersedes_revision)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NULL)
         RETURNING *`,
          [
            cmd.clientId,
            evidenceId,
            sourceObject.sourceObjectId,
            cmd.payload.sourceClass,
            cmd.payload.acquisitionMethod,
            cmd.actorId,
            cmd.timestamp,
            cmd.payload.assertionText,
            cmd.payload.reportedCaptureDate,
            cmd.payload.reportedCaptureTimestamp,
            cmd.payload.reportedCapturePrecision,
            cmd.payload.captureContext ?? null,
            cmd.payload.rightsStatus,
            cmd.payload.consentStatus,
            cmd.payload.rightsAttribution ?? null,
            cmd.payload.rightsDocumentLocator ?? null
          ]
        );
        evidenceRevision = mapRowToEvidenceRevision(revRes.rows[0]!);
      } else if (cmd.payload.registrationIntent === "supersede") {
        if (!cmd.payload.targetEvidenceId || cmd.payload.expectedEvidenceVersion === undefined) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["targetEvidenceId"],
              message: "targetEvidenceId and expectedEvidenceVersion are required for supersede."
            }
          ]);
        }

        // Lock target evidence asset
        const targetRes = await client.query<EvidenceAssetRow>(
          `SELECT * FROM evidence_assets
         WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
          [cmd.clientId, cmd.payload.targetEvidenceId]
        );
        if (targetRes.rows.length === 0) {
          throw new NotFoundError("EvidenceAsset", cmd.payload.targetEvidenceId);
        }
        const targetAsset = mapRowToEvidenceAsset(targetRes.rows[0]!);
        if (targetAsset.archivedAt !== null) {
          throw new AccessDeniedError("Archived evidence asset cannot be superseded.");
        }
        if (targetAsset.version !== cmd.payload.expectedEvidenceVersion) {
          throw new StaleRevisionConflictError(
            "EvidenceAsset",
            cmd.payload.expectedEvidenceVersion,
            targetAsset.version
          );
        }

        // Check if the target evidence asset has an active dispute across any revisions
        const assetDisputeRes = await client.query<{
          event_id: string;
          outcome: string;
          withdrawal_event_id: string | null;
        }>(
          `SELECT event_id, outcome, withdrawal_event_id
           FROM evidence_verification_events
           WHERE client_id = $1 AND evidence_id = $2
           ORDER BY occurred_at ASC`,
          [cmd.clientId, cmd.payload.targetEvidenceId]
        );
        const activeAssetDisputes = new Set<string>();
        for (const evt of assetDisputeRes.rows) {
          if (evt.outcome === "disputed" || evt.outcome === "rejected") {
            activeAssetDisputes.add(evt.event_id);
          } else if (evt.outcome === "withdrawn" && evt.withdrawal_event_id) {
            activeAssetDisputes.delete(evt.withdrawal_event_id);
          }
        }
        if (activeAssetDisputes.size > 0) {
          throw new ReportDisputedError(
            `Target evidence asset ${cmd.payload.targetEvidenceId} has an active dispute or rejection and cannot be superseded.`
          );
        }

        // Check if the target evidence asset's current source object has an active dispute
        const targetRevRes = await client.query<{ source_object_id: string }>(
          `SELECT source_object_id FROM evidence_revisions
           WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
          [cmd.clientId, cmd.payload.targetEvidenceId, targetAsset.currentRevision]
        );
        if (targetRevRes.rows.length > 0) {
          await this.assertNoActiveDisputes(
            client,
            cmd.clientId,
            createSourceObjectId(targetRevRes.rows[0]!.source_object_id)
          );
        }

        // Check if the new source object has an active dispute across any revisions
        await this.assertNoActiveDisputes(client, cmd.clientId, sourceObject.sourceObjectId);

        // Fence supersession to the target evidence existing batch association
        const targetBatchRes = await client.query<{ batch_id: string }>(
          `SELECT DISTINCT batch_id
           FROM batch_evidence_links
           WHERE client_id = $1 AND evidence_id = $2`,
          [cmd.clientId, cmd.payload.targetEvidenceId]
        );
        if (targetBatchRes.rows.length > 0) {
          const existingBatchId = targetBatchRes.rows[0]!.batch_id;
          if (existingBatchId !== cmd.payload.batchId) {
            throw new CrossBatchSourceError(
              `Target evidence asset "${cmd.payload.targetEvidenceId}" is associated with batch "${existingBatchId}". Cannot supersede it under batch "${cmd.payload.batchId}". A different lot requires a separate evidence identity via new_batch_assertion.`,
              {
                sha256: cmd.payload.originalSha256,
                existingBatchId
              }
            );
          }
        }

        // Check if the source object is already associated with another batch
        const crossBatchRes = await client.query<{ batch_id: string }>(
          `SELECT DISTINCT l.batch_id
           FROM batch_evidence_links l
           JOIN evidence_revisions r
             ON r.client_id = l.client_id AND r.evidence_id = l.evidence_id AND r.revision = l.evidence_revision
           WHERE l.client_id = $1
             AND r.source_object_id = $2
             AND l.batch_id != $3`,
          [cmd.clientId, sourceObject.sourceObjectId, cmd.payload.batchId]
        );
        if (crossBatchRes.rows.length > 0) {
          throw new CrossBatchSourceError(
            `Source hash "${cmd.payload.originalSha256}" is already associated with another batch (${crossBatchRes.rows[0]!.batch_id}). Explicit new_batch_assertion intent with fresh lot attestation is required.`,
            {
              sha256: cmd.payload.originalSha256,
              existingBatchId: crossBatchRes.rows[0]!.batch_id
            }
          );
        }

        const nextRevision = targetAsset.currentRevision + 1;

        // Insert next revision row
        const revRes = await client.query<EvidenceRevisionRow>(
          `INSERT INTO evidence_revisions
           (client_id, evidence_id, revision, source_object_id, source_class, acquisition_method,
            submitted_by, submitted_at, assertion_text, reported_capture_date,
            reported_capture_timestamp, reported_capture_precision, capture_context,
            rights_status, consent_status, rights_attribution, rights_document_locator, supersedes_revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
          [
            cmd.clientId,
            cmd.payload.targetEvidenceId,
            nextRevision,
            sourceObject.sourceObjectId,
            cmd.payload.sourceClass,
            cmd.payload.acquisitionMethod,
            cmd.actorId,
            cmd.timestamp,
            cmd.payload.assertionText,
            cmd.payload.reportedCaptureDate,
            cmd.payload.reportedCaptureTimestamp,
            cmd.payload.reportedCapturePrecision,
            cmd.payload.captureContext ?? null,
            cmd.payload.rightsStatus,
            cmd.payload.consentStatus,
            cmd.payload.rightsAttribution ?? null,
            cmd.payload.rightsDocumentLocator ?? null,
            targetAsset.currentRevision
          ]
        );
        evidenceRevision = mapRowToEvidenceRevision(revRes.rows[0]!);

        // Advance head pointer
        const updateAssetRes = await client.query<EvidenceAssetRow>(
          `UPDATE evidence_assets
         SET current_revision = $1, version = version + 1
         WHERE client_id = $2 AND evidence_id = $3 AND version = $4
         RETURNING *`,
          [
            nextRevision,
            cmd.clientId,
            cmd.payload.targetEvidenceId,
            cmd.payload.expectedEvidenceVersion
          ]
        );
        evidenceAsset = mapRowToEvidenceAsset(updateAssetRes.rows[0]!);
      } else {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["registrationIntent"],
            message: `Unknown registrationIntent: "${String(cmd.payload.registrationIntent)}".`
          }
        ]);
      }

      // 4. Insert Batch Evidence Link
      const linkRes = await client.query<BatchEvidenceLinkRow>(
        `INSERT INTO batch_evidence_links
         (client_id, batch_id, evidence_id, evidence_revision, purpose, asserted_by, asserted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
        [
          cmd.clientId,
          cmd.payload.batchId,
          evidenceAsset.evidenceId,
          evidenceRevision.revision,
          cmd.payload.purpose,
          cmd.actorId,
          cmd.timestamp
        ]
      );
      const batchEvidenceLink = mapRowToBatchEvidenceLink(linkRes.rows[0]!);

      // 5. Optional Derivative Bridge
      let derivative: EvidenceDerivative | null = null;
      if (cmd.payload.derivative) {
        const d = cmd.payload.derivative;
        // Lock and verify ReferenceAsset
        const refRes = await client.query<{
          asset_id: string;
          content_hash_sha256: string;
          archived_at: Date | null;
        }>(
          `SELECT asset_id, content_hash_sha256, archived_at
         FROM reference_assets
         WHERE client_id = $1 AND asset_id = $2 FOR SHARE`,
          [cmd.clientId, d.referenceAssetId]
        );
        if (refRes.rows.length === 0) {
          throw new NotFoundError("ReferenceAsset", d.referenceAssetId);
        }
        if (refRes.rows[0]!.archived_at !== null) {
          throw new AccessDeniedError("Target reference asset is archived.", "REFERENCE_ARCHIVED");
        }
        if (refRes.rows[0]!.content_hash_sha256 !== d.derivativeSha256) {
          throw new MimeConflictError(
            `Derivative SHA-256 "${d.derivativeSha256}" does not match referenced ReferenceAsset hash "${refRes.rows[0]!.content_hash_sha256}".`
          );
        }

        const derivRes = await client.query<EvidenceDerivativeRow>(
          `INSERT INTO evidence_derivatives
           (derivative_id, client_id, evidence_id, evidence_revision, reference_asset_id,
            derivative_sha256, transform_description, transform_tool_version, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
          [
            crypto.randomUUID(),
            cmd.clientId,
            evidenceAsset.evidenceId,
            evidenceRevision.revision,
            d.referenceAssetId,
            d.derivativeSha256,
            d.transformDescription,
            d.transformToolVersion ?? null,
            cmd.actorId,
            cmd.timestamp
          ]
        );
        derivative = mapRowToEvidenceDerivative(derivRes.rows[0]!);
      }

      const finalResult: RegisterEvidenceResult = {
        evidenceAsset,
        evidenceRevision,
        sourceObject,
        batchEvidenceLink,
        derivative,
        isNewSourceObject
      };

      await this.storeReceipt(client, cmd, "registerEvidence", payloadHash, finalResult);
      return finalResult;
    } catch (err) {
      translateDatabaseError(err, { clientId: cmd.clientId, actionId: cmd.actionId });
    }
  }

  async linkDerivative(
    cmd: CommandEnvelope<LinkEvidenceDerivativeCommandPayload>
  ): Promise<EvidenceDerivative> {
    const client = this.requireTransactionClient();

    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);
      const { replay, result, payloadHash } = await this.checkReceipt<
        LinkEvidenceDerivativeCommandPayload,
        EvidenceDerivative
      >(client, cmd, "linkDerivative");
      if (replay && result) {
        return rehydrateEvidenceDerivative(result);
      }

      // Verify EvidenceAsset exists, belongs to client, and is not archived
      const assetRes = await client.query<EvidenceAssetRow>(
        `SELECT * FROM evidence_assets
         WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.evidenceId]
      );
      if (assetRes.rows.length === 0) {
        throw new NotFoundError("EvidenceAsset", cmd.payload.evidenceId);
      }
      const asset = mapRowToEvidenceAsset(assetRes.rows[0]!);
      if (asset.archivedAt !== null) {
        throw new AccessDeniedError("Target evidence asset is archived.", "EVIDENCE_ARCHIVED");
      }

      // Check current revision: must not link to superseded revision
      if (cmd.payload.evidenceRevision !== asset.currentRevision) {
        throw new SourceSupersededError(
          `Evidence revision ${cmd.payload.evidenceRevision} has been superseded by revision ${asset.currentRevision}. Derivatives can only be linked to the current revision.`,
          {
            evidenceId: cmd.payload.evidenceId,
            currentRevision: asset.currentRevision,
            attemptedRevision: cmd.payload.evidenceRevision
          }
        );
      }

      // Verify EvidenceRevision exists
      const revRes = await client.query<EvidenceRevisionRow>(
        `SELECT * FROM evidence_revisions
         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3 FOR UPDATE`,
        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
      );
      if (revRes.rows.length === 0) {
        throw new NotFoundError(
          "EvidenceRevision",
          `${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision}`
        );
      }

      // Verify associated batch and SKU are not archived (lock SKU and batch rows for share)
      const skuRes = await client.query<{
        sku_archived_at: Date | null;
        batch_archived_at: Date | null;
      }>(
        `SELECT s.archived_at AS sku_archived_at, b.archived_at AS batch_archived_at
         FROM batch_evidence_links l
         JOIN product_batches b ON b.client_id = l.client_id AND b.batch_id = l.batch_id
         JOIN product_skus s ON s.client_id = b.client_id AND s.sku_id = b.sku_id
         WHERE l.client_id = $1 AND l.evidence_id = $2 AND l.evidence_revision = $3
         FOR SHARE OF s, b`,
        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
      );
      if (skuRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", "Associated batch link not found");
      }
      if (skuRes.rows.some((r) => r.batch_archived_at !== null)) {
        throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
      }
      if (skuRes.rows.some((r) => r.sku_archived_at !== null)) {
        throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
      }

      // Verify underlying source object availability (lock source_objects row for update)
      const sourceRes = await client.query<SourceObjectRow>(
        `SELECT * FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
        [cmd.clientId, revRes.rows[0]!.source_object_id]
      );
      if (sourceRes.rows.length === 0 || sourceRes.rows[0]!.availability !== "available") {
        throw new AccessDeniedError(
          "Underlying source object is unavailable.",
          "SOURCE_UNAVAILABLE"
        );
      }

      await this.assertNoActiveDisputes(
        client,
        cmd.clientId,
        createSourceObjectId(revRes.rows[0]!.source_object_id)
      );

      // Verify dispute status on this evidence asset
      const disputeRes = await client.query<{
        event_id: string;
        outcome: string;
        withdrawal_event_id: string | null;
      }>(
        `SELECT event_id, outcome, withdrawal_event_id
         FROM evidence_verification_events
         WHERE client_id = $1 AND evidence_id = $2
         ORDER BY occurred_at ASC`,
        [cmd.clientId, cmd.payload.evidenceId]
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
          `Evidence asset ${cmd.payload.evidenceId} has an active dispute or rejection and cannot be linked to derivatives.`
        );
      }

      // Verify ReferenceAsset exists, belongs to client, is not archived, matches hash
      const refRes = await client.query<{
        asset_id: string;
        content_hash_sha256: string;
        archived_at: Date | null;
      }>(
        `SELECT asset_id, content_hash_sha256, archived_at
         FROM reference_assets
         WHERE client_id = $1 AND asset_id = $2 FOR SHARE`,
        [cmd.clientId, cmd.payload.referenceAssetId]
      );
      if (refRes.rows.length === 0) {
        throw new NotFoundError("ReferenceAsset", cmd.payload.referenceAssetId);
      }
      if (refRes.rows[0]!.archived_at !== null) {
        throw new AccessDeniedError("Target reference asset is archived.", "REFERENCE_ARCHIVED");
      }
      if (refRes.rows[0]!.content_hash_sha256 !== cmd.payload.derivativeSha256) {
        throw new MimeConflictError(
          `Derivative SHA-256 "${cmd.payload.derivativeSha256}" does not match referenced ReferenceAsset hash "${refRes.rows[0]!.content_hash_sha256}".`
        );
      }

      const derivRes = await client.query<EvidenceDerivativeRow>(
        `INSERT INTO evidence_derivatives
           (derivative_id, client_id, evidence_id, evidence_revision, reference_asset_id,
            derivative_sha256, transform_description, transform_tool_version, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          crypto.randomUUID(),
          cmd.clientId,
          cmd.payload.evidenceId,
          cmd.payload.evidenceRevision,
          cmd.payload.referenceAssetId,
          cmd.payload.derivativeSha256,
          cmd.payload.transformDescription,
          cmd.payload.transformToolVersion ?? null,
          cmd.actorId,
          cmd.timestamp
        ]
      );
      const derivative = mapRowToEvidenceDerivative(derivRes.rows[0]!);

      await this.storeReceipt(client, cmd, "linkDerivative", payloadHash, derivative);
      return derivative;
    } catch (err) {
      translateDatabaseError(err, { clientId: cmd.clientId, actionId: cmd.actionId });
    }
  }

  async appendVerificationEvent(
    cmd: CommandEnvelope<AppendVerificationEventCommandPayload>
  ): Promise<EvidenceVerificationEvent> {
    const client = this.requireTransactionClient();

    try {
      await this.acquireCommandAdvisoryLock(client, cmd.clientId, cmd.actionId);
      const { replay, result, payloadHash } = await this.checkReceipt<
        AppendVerificationEventCommandPayload,
        EvidenceVerificationEvent
      >(client, cmd, "appendVerificationEvent");
      if (replay && result) {
        return rehydrateEvidenceVerificationEvent(result);
      }

      // Verify EvidenceAsset exists, belongs to client, and is not archived
      const assetRes = await client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM evidence_assets
         WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE`,
        [cmd.clientId, cmd.payload.evidenceId]
      );
      if (assetRes.rows.length === 0) {
        throw new NotFoundError("EvidenceAsset", cmd.payload.evidenceId);
      }
      if (assetRes.rows[0]!.archived_at !== null) {
        throw new AccessDeniedError("Target evidence asset is archived.", "EVIDENCE_ARCHIVED");
      }

      // Verify EvidenceRevision exists
      const revRes = await client.query<EvidenceRevisionRow>(
        `SELECT * FROM evidence_revisions
         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3 FOR UPDATE`,
        [cmd.clientId, cmd.payload.evidenceId, cmd.payload.evidenceRevision]
      );
      if (revRes.rows.length === 0) {
        throw new NotFoundError(
          "EvidenceRevision",
          `${cmd.payload.evidenceId}:${cmd.payload.evidenceRevision}`
        );
      }

      // Lock underlying source_objects row FOR UPDATE so dispute checks and event appends synchronize
      await client.query(
        `SELECT 1 FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR UPDATE`,
        [cmd.clientId, revRes.rows[0]!.source_object_id]
      );

      if (cmd.payload.withdrawalEventId) {
        const priorEventRes = await client.query<{ event_id: string }>(
          `SELECT event_id FROM evidence_verification_events
           WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3 AND event_id = $4`,
          [
            cmd.clientId,
            cmd.payload.evidenceId,
            cmd.payload.evidenceRevision,
            cmd.payload.withdrawalEventId
          ]
        );
        if (priorEventRes.rows.length === 0) {
          throw new NotFoundError("EvidenceVerificationEvent", cmd.payload.withdrawalEventId);
        }
      }

      const eventRes = await client.query<EvidenceVerificationEventRow>(
        `INSERT INTO evidence_verification_events
           (event_id, client_id, evidence_id, evidence_revision, outcome, verification_kind,
            fact_scope, actor_id, occurred_at, method, reason, verified_party_reference, withdrawal_event_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          crypto.randomUUID(),
          cmd.clientId,
          cmd.payload.evidenceId,
          cmd.payload.evidenceRevision,
          cmd.payload.outcome,
          cmd.payload.verificationKind,
          cmd.payload.factScope,
          cmd.actorId,
          cmd.timestamp,
          cmd.payload.method,
          cmd.payload.reason,
          cmd.payload.verifiedPartyReference ?? null,
          cmd.payload.withdrawalEventId ?? null
        ]
      );
      const event = mapRowToEvidenceVerificationEvent(eventRes.rows[0]!);

      await this.storeReceipt(client, cmd, "appendVerificationEvent", payloadHash, event);
      return event;
    } catch (err) {
      translateDatabaseError(err, { clientId: cmd.clientId, actionId: cmd.actionId });
    }
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  async getSourceObjectById(
    clientId: ClientId,
    sourceObjectId: SourceObjectId
  ): Promise<SourceObject | null> {
    const res = await this.client.query<SourceObjectRow>(
      `SELECT * FROM source_objects WHERE client_id = $1 AND source_object_id = $2`,
      [clientId, sourceObjectId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToSourceObject(res.rows[0]!);
  }

  async getSourceObjectByHash(
    clientId: ClientId,
    originalSha256: Sha256Hex
  ): Promise<SourceObject | null> {
    const res = await this.client.query<SourceObjectRow>(
      `SELECT * FROM source_objects WHERE client_id = $1 AND original_sha256 = $2`,
      [clientId, originalSha256]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToSourceObject(res.rows[0]!);
  }

  async getEvidenceById(clientId: ClientId, evidenceId: EvidenceId): Promise<EvidenceAsset | null> {
    const res = await this.client.query<EvidenceAssetRow>(
      `SELECT * FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
      [clientId, evidenceId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToEvidenceAsset(res.rows[0]!);
  }

  async getEvidenceHistory(
    clientId: ClientId,
    evidenceId: EvidenceId
  ): Promise<readonly EvidenceRevision[]> {
    const res = await this.client.query<EvidenceRevisionRow>(
      `SELECT * FROM evidence_revisions
       WHERE client_id = $1 AND evidence_id = $2
       ORDER BY revision ASC`,
      [clientId, evidenceId]
    );
    return res.rows.map(mapRowToEvidenceRevision);
  }

  async getEvidenceRevision(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceRevision | null> {
    const res = await this.client.query<EvidenceRevisionRow>(
      `SELECT * FROM evidence_revisions
       WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
      [clientId, evidenceId, revision]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToEvidenceRevision(res.rows[0]!);
  }

  async listBatchEvidence(
    clientId: ClientId,
    batchId: BatchId
  ): Promise<readonly BatchEvidenceLink[]> {
    const res = await this.client.query<BatchEvidenceLinkRow>(
      `SELECT * FROM batch_evidence_links
       WHERE client_id = $1 AND batch_id = $2
       ORDER BY asserted_at ASC, evidence_id ASC`,
      [clientId, batchId]
    );
    return res.rows.map(mapRowToBatchEvidenceLink);
  }

  async getBatchEvidenceLink(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<BatchEvidenceLink | null> {
    const res = await this.client.query<BatchEvidenceLinkRow>(
      `SELECT * FROM batch_evidence_links
       WHERE client_id = $1 AND batch_id = $2 AND evidence_id = $3 AND evidence_revision = $4`,
      [clientId, batchId, evidenceId, revision]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToBatchEvidenceLink(res.rows[0]!);
  }

  async getDerivative(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceDerivative | null> {
    const res = await this.client.query<EvidenceDerivativeRow>(
      `SELECT * FROM evidence_derivatives
       WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3`,
      [clientId, evidenceId, revision]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return mapRowToEvidenceDerivative(res.rows[0]!);
  }

  async listVerificationEvents(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<readonly EvidenceVerificationEvent[]> {
    const res = await this.client.query<EvidenceVerificationEventRow>(
      `SELECT * FROM evidence_verification_events
       WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
       ORDER BY occurred_at ASC, event_id ASC`,
      [clientId, evidenceId, revision]
    );
    return res.rows.map(mapRowToEvidenceVerificationEvent);
  }

  async getEvidenceEligibility(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceEligibilityResult> {
    const asset = await this.getEvidenceById(clientId, evidenceId);
    if (!asset) {
      throw new NotFoundError("EvidenceAsset", evidenceId);
    }
    const rev = await this.getEvidenceRevision(clientId, evidenceId, revision);
    if (!rev) {
      throw new NotFoundError("EvidenceRevision", `${evidenceId}:${revision}`);
    }
    const source = await this.getSourceObjectById(clientId, rev.sourceObjectId);
    if (!source) {
      throw new NotFoundError("SourceObject", rev.sourceObjectId);
    }
    const events = await this.listVerificationEvents(clientId, evidenceId, revision);

    return evaluateEvidenceEligibility(asset, source, events);
  }
}
