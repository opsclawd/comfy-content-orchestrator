import {
  canonicalizeUtcTimestamp,
  isValidDateOnly,
  isValidDisplayName,
  isValidIsoUtcTimestamp,
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
  createBatchId,
  createClientId,
  createDerivativeId,
  createEvidenceId,
  createSha256Hex,
  createSourceObjectId,
  createVerificationEventId,
  type BatchId,
  type ClientId,
  type DerivativeId,
  type EvidenceId,
  type Sha256Hex,
  type SourceObjectId,
  type VerificationEventId
} from "./identifiers.js";
import {
  AccessDeniedError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";
import type { SourceObject } from "./source-object.js";

// ============================================================================
// Core Entities & Interfaces
// ============================================================================

export interface EvidenceAsset {
  readonly clientId: ClientId;
  readonly evidenceId: EvidenceId;
  readonly currentRevision: number;
  readonly version: number;
  readonly createdAt: IsoTimestampString;
  readonly archivedAt: IsoTimestampString | null;
}

export interface EvidenceRevision {
  readonly clientId: ClientId;
  readonly evidenceId: EvidenceId;
  readonly revision: number;
  readonly sourceObjectId: SourceObjectId;
  readonly sourceClass: EvidenceSourceClass;
  readonly acquisitionMethod: EvidenceAcquisitionMethod;
  readonly submittedBy: string;
  readonly submittedAt: IsoTimestampString;
  readonly assertionText: string;
  readonly reportedCaptureDate: DateOnlyString | null;
  readonly reportedCaptureTimestamp: IsoTimestampString | null;
  readonly reportedCapturePrecision: ReportedCapturePrecision | null;
  readonly captureContext: string | null;
  readonly rightsStatus: LegalRightsStatus;
  readonly consentStatus: ConsentStatus;
  readonly rightsAttribution: string | null;
  readonly rightsDocumentLocator: string | null;
  readonly supersedesRevision: number | null;
}

export interface BatchEvidenceLink {
  readonly clientId: ClientId;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly purpose: BatchEvidencePurpose;
  readonly assertedBy: string;
  readonly assertedAt: IsoTimestampString;
}

export interface EvidenceDerivative {
  readonly clientId: ClientId;
  readonly derivativeId: DerivativeId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly referenceAssetId: string;
  readonly derivativeSha256: Sha256Hex;
  readonly transformDescription: string;
  readonly transformToolVersion: string | null;
  readonly createdBy: string;
  readonly createdAt: IsoTimestampString;
}

export interface EvidenceVerificationEvent {
  readonly clientId: ClientId;
  readonly eventId: VerificationEventId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly outcome: VerificationOutcome;
  readonly verificationKind: VerificationKind;
  readonly factScope: VerificationFactScope;
  readonly actorId: string;
  readonly occurredAt: IsoTimestampString;
  readonly method: string;
  readonly reason: string;
  readonly verifiedPartyReference: string | null;
  readonly withdrawalEventId: VerificationEventId | null;
}

export interface EvidenceEligibilityResult {
  readonly isEligible: boolean;
  readonly reason:
    | "eligible"
    | "source_quarantined"
    | "source_archived"
    | "source_deleted"
    | "source_disputed"
    | "asset_archived";
  readonly activeDisputeEvent?: EvidenceVerificationEvent | undefined;
}

// ============================================================================
// Capture Timestamp Consistency Validator (Additive Refinement to ADR 0009)
// ============================================================================

export function validateCaptureTimestampConsistency(
  reportedCaptureDate: DateOnlyString | null | undefined,
  reportedCaptureTimestamp: IsoTimestampString | null | undefined,
  reportedCapturePrecision?: ReportedCapturePrecision | null | undefined
): {
  readonly reportedCaptureDate: DateOnlyString | null;
  readonly reportedCaptureTimestamp: IsoTimestampString | null;
  readonly reportedCapturePrecision: ReportedCapturePrecision | null;
} {
  const dateVal = reportedCaptureDate ? reportedCaptureDate.trim() : null;
  const timeVal = reportedCaptureTimestamp
    ? canonicalizeUtcTimestamp(reportedCaptureTimestamp.trim())
    : null;
  const precisionVal = reportedCapturePrecision ?? null;

  if (dateVal !== null && !isValidDateOnly(dateVal)) {
    throw new ProductValidationError([
      {
        code: "INVALID_DATE",
        path: ["reportedCaptureDate"],
        message: `reportedCaptureDate "${dateVal}" is not a valid date string (YYYY-MM-DD).`
      }
    ]);
  }

  if (timeVal !== null && !isValidIsoUtcTimestamp(timeVal)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["reportedCaptureTimestamp"],
        message: `reportedCaptureTimestamp "${timeVal}" is not a valid ISO 8601 UTC timestamp.`
      }
    ]);
  }

  // Additive refinement consistency rule: if both are supplied, the UTC date of the timestamp must match the date-only string
  if (dateVal !== null && timeVal !== null) {
    const timestampDate = timeVal.slice(0, 10);
    if (timestampDate !== dateVal) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["reportedCaptureDate"],
          message: `reportedCaptureDate "${dateVal}" does not match the UTC date part "${timestampDate}" of reportedCaptureTimestamp.`
        }
      ]);
    }
  }

  return {
    reportedCaptureDate: dateVal ?? (timeVal ? (timeVal.slice(0, 10) as DateOnlyString) : null),
    reportedCaptureTimestamp: timeVal,
    reportedCapturePrecision: precisionVal
  };
}

// ============================================================================
// Factory Constructors & Transitions
// ============================================================================

export interface CreateEvidenceAssetInput {
  readonly clientId: ClientId;
  readonly evidenceId?: EvidenceId | undefined;
  readonly createdAt?: IsoTimestampString | undefined;
}

export function createEvidenceAsset(input: CreateEvidenceAssetInput): EvidenceAsset {
  const clientId = createClientId(input.clientId);
  const evidenceId = input.evidenceId
    ? createEvidenceId(input.evidenceId)
    : createEvidenceId(crypto.randomUUID());
  const createdAt = input.createdAt
    ? canonicalizeUtcTimestamp(input.createdAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    clientId,
    evidenceId,
    currentRevision: 1,
    version: 1,
    createdAt,
    archivedAt: null
  });
}

export interface CreateEvidenceRevisionInput {
  readonly clientId: ClientId;
  readonly evidenceId: EvidenceId;
  readonly revision: number;
  readonly sourceObjectId: SourceObjectId;
  readonly sourceClass: EvidenceSourceClass;
  readonly acquisitionMethod: EvidenceAcquisitionMethod;
  readonly submittedBy: string;
  readonly submittedAt?: IsoTimestampString | undefined;
  readonly assertionText: string;
  readonly reportedCaptureDate?: DateOnlyString | null | undefined;
  readonly reportedCaptureTimestamp?: IsoTimestampString | null | undefined;
  readonly reportedCapturePrecision?: ReportedCapturePrecision | null | undefined;
  readonly captureContext?: string | null | undefined;
  readonly rightsStatus?: LegalRightsStatus | undefined;
  readonly consentStatus?: ConsentStatus | undefined;
  readonly rightsAttribution?: string | null | undefined;
  readonly rightsDocumentLocator?: string | null | undefined;
  readonly supersedesRevision?: number | null | undefined;
}

export function createEvidenceRevision(input: CreateEvidenceRevisionInput): EvidenceRevision {
  const clientId = createClientId(input.clientId);
  const evidenceId = createEvidenceId(input.evidenceId);
  const sourceObjectId = createSourceObjectId(input.sourceObjectId);

  if (input.revision < 1 || !Number.isSafeInteger(input.revision)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["revision"],
        message: "revision must be a positive integer >= 1."
      }
    ]);
  }

  // Monotonic revision and predecessor rule
  if (input.revision === 1) {
    if (input.supersedesRevision !== null && input.supersedesRevision !== undefined) {
      throw new NonMonotonicRevisionError("Revision 1 must not supersede any revision.");
    }
  } else {
    if (input.supersedesRevision !== input.revision - 1) {
      throw new NonMonotonicRevisionError(
        `Revision ${input.revision} must supersede exactly revision ${input.revision - 1} (found ${String(input.supersedesRevision)}).`
      );
    }
  }

  if (!input.assertionText || input.assertionText.trim().length === 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["assertionText"],
        message: "assertionText cannot be blank."
      }
    ]);
  }

  if (!isValidDisplayName(input.submittedBy)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["submittedBy"],
        message: "submittedBy must be 1–255 code points without controls."
      }
    ]);
  }

  const { reportedCaptureDate, reportedCaptureTimestamp, reportedCapturePrecision } =
    validateCaptureTimestampConsistency(
      input.reportedCaptureDate,
      input.reportedCaptureTimestamp,
      input.reportedCapturePrecision
    );

  const submittedAt = input.submittedAt
    ? canonicalizeUtcTimestamp(input.submittedAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    clientId,
    evidenceId,
    revision: input.revision,
    sourceObjectId,
    sourceClass: input.sourceClass,
    acquisitionMethod: input.acquisitionMethod,
    submittedBy: input.submittedBy.trim(),
    submittedAt,
    assertionText: input.assertionText.trim(),
    reportedCaptureDate,
    reportedCaptureTimestamp,
    reportedCapturePrecision,
    captureContext: input.captureContext ? input.captureContext.trim() : null,
    rightsStatus: input.rightsStatus ?? "unknown",
    consentStatus: input.consentStatus ?? "unknown",
    rightsAttribution: input.rightsAttribution ? input.rightsAttribution.trim() : null,
    rightsDocumentLocator: input.rightsDocumentLocator ? input.rightsDocumentLocator.trim() : null,
    supersedesRevision: input.revision === 1 ? null : (input.supersedesRevision ?? null)
  });
}

export interface CreateBatchEvidenceLinkInput {
  readonly clientId: ClientId;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly purpose: BatchEvidencePurpose;
  readonly assertedBy: string;
  readonly assertedAt?: IsoTimestampString | undefined;
}

export function createBatchEvidenceLink(input: CreateBatchEvidenceLinkInput): BatchEvidenceLink {
  const clientId = createClientId(input.clientId);
  const batchId = createBatchId(input.batchId);
  const evidenceId = createEvidenceId(input.evidenceId);

  if (input.evidenceRevision < 1 || !Number.isSafeInteger(input.evidenceRevision)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["evidenceRevision"],
        message: "evidenceRevision must be a positive integer >= 1."
      }
    ]);
  }

  if (!isValidDisplayName(input.assertedBy)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["assertedBy"],
        message: "assertedBy must be 1–255 code points without controls."
      }
    ]);
  }

  const assertedAt = input.assertedAt
    ? canonicalizeUtcTimestamp(input.assertedAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    clientId,
    batchId,
    evidenceId,
    evidenceRevision: input.evidenceRevision,
    purpose: input.purpose,
    assertedBy: input.assertedBy.trim(),
    assertedAt
  });
}

export interface CreateEvidenceDerivativeInput {
  readonly clientId: ClientId;
  readonly derivativeId?: DerivativeId | undefined;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly referenceAssetId: string;
  readonly derivativeSha256: Sha256Hex;
  readonly transformDescription: string;
  readonly transformToolVersion?: string | null | undefined;
  readonly createdBy: string;
  readonly createdAt?: IsoTimestampString | undefined;
}

export function createEvidenceDerivative(input: CreateEvidenceDerivativeInput): EvidenceDerivative {
  const clientId = createClientId(input.clientId);
  const derivativeId = input.derivativeId
    ? createDerivativeId(input.derivativeId)
    : createDerivativeId(crypto.randomUUID());
  const evidenceId = createEvidenceId(input.evidenceId);
  const derivativeSha256 = createSha256Hex(input.derivativeSha256);

  if (!input.referenceAssetId || input.referenceAssetId.trim().length === 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["referenceAssetId"],
        message: "referenceAssetId cannot be empty."
      }
    ]);
  }

  if (!input.transformDescription || input.transformDescription.trim().length === 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["transformDescription"],
        message: "transformDescription cannot be empty."
      }
    ]);
  }

  if (!isValidDisplayName(input.createdBy)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["createdBy"],
        message: "createdBy must be 1–255 code points without controls."
      }
    ]);
  }

  const createdAt = input.createdAt
    ? canonicalizeUtcTimestamp(input.createdAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    clientId,
    derivativeId,
    evidenceId,
    evidenceRevision: input.evidenceRevision,
    referenceAssetId: input.referenceAssetId.trim(),
    derivativeSha256,
    transformDescription: input.transformDescription.trim(),
    transformToolVersion: input.transformToolVersion ? input.transformToolVersion.trim() : null,
    createdBy: input.createdBy.trim(),
    createdAt
  });
}

export interface CreateEvidenceVerificationEventInput {
  readonly clientId: ClientId;
  readonly eventId?: VerificationEventId | undefined;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly outcome: VerificationOutcome;
  readonly verificationKind: VerificationKind;
  readonly factScope: VerificationFactScope;
  readonly actorId: string;
  readonly method: string;
  readonly reason: string;
  readonly occurredAt?: IsoTimestampString | undefined;
  readonly verifiedPartyReference?: string | null | undefined;
  readonly withdrawalEventId?: VerificationEventId | null | undefined;
}

export function createEvidenceVerificationEvent(
  input: CreateEvidenceVerificationEventInput
): EvidenceVerificationEvent {
  const clientId = createClientId(input.clientId);
  const eventId = input.eventId
    ? createVerificationEventId(input.eventId)
    : createVerificationEventId(crypto.randomUUID());
  const evidenceId = createEvidenceId(input.evidenceId);

  if (input.evidenceRevision < 1 || !Number.isSafeInteger(input.evidenceRevision)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["evidenceRevision"],
        message: "evidenceRevision must be a positive integer >= 1."
      }
    ]);
  }

  if (!isValidDisplayName(input.actorId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["actorId"],
        message: "actorId must be 1–255 code points without controls."
      }
    ]);
  }

  if (!input.method || input.method.trim().length === 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["method"],
        message: "method cannot be empty."
      }
    ]);
  }

  if (!input.reason || input.reason.trim().length === 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["reason"],
        message: "reason cannot be empty."
      }
    ]);
  }

  const occurredAt = input.occurredAt
    ? canonicalizeUtcTimestamp(input.occurredAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  const withdrawalEventId = input.withdrawalEventId
    ? createVerificationEventId(input.withdrawalEventId)
    : null;

  if (withdrawalEventId !== null && withdrawalEventId === eventId) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["withdrawalEventId"],
        message: "withdrawalEventId cannot reference itself."
      }
    ]);
  }

  return Object.freeze({
    clientId,
    eventId,
    evidenceId,
    evidenceRevision: input.evidenceRevision,
    outcome: input.outcome,
    verificationKind: input.verificationKind,
    factScope: input.factScope,
    actorId: input.actorId.trim(),
    occurredAt,
    method: input.method.trim(),
    reason: input.reason.trim(),
    verifiedPartyReference: input.verifiedPartyReference
      ? input.verifiedPartyReference.trim()
      : null,
    withdrawalEventId
  });
}

export function supersedeEvidence(
  currentHead: EvidenceAsset,
  expectedVersion: number
): { readonly previous: EvidenceAsset; readonly current: EvidenceAsset } {
  if (currentHead.archivedAt !== null) {
    throw new AccessDeniedError("Archived evidence asset cannot be superseded.");
  }

  if (currentHead.version !== expectedVersion) {
    throw new StaleRevisionConflictError("EvidenceAsset", expectedVersion, currentHead.version);
  }

  const nextHead: EvidenceAsset = Object.freeze({
    ...currentHead,
    currentRevision: currentHead.currentRevision + 1,
    version: currentHead.version + 1
  });

  return { previous: currentHead, current: nextHead };
}

export function archiveEvidenceAsset(
  currentHead: EvidenceAsset,
  expectedVersion: number,
  archivedAt?: IsoTimestampString
): { readonly previous: EvidenceAsset; readonly current: EvidenceAsset } {
  if (currentHead.archivedAt !== null) {
    throw new AccessDeniedError("Evidence asset is already archived.");
  }

  if (currentHead.version !== expectedVersion) {
    throw new StaleRevisionConflictError("EvidenceAsset", expectedVersion, currentHead.version);
  }

  const nextHead: EvidenceAsset = Object.freeze({
    ...currentHead,
    version: currentHead.version + 1,
    archivedAt: archivedAt
      ? canonicalizeUtcTimestamp(archivedAt)
      : canonicalizeUtcTimestamp(new Date().toISOString())
  });

  return { previous: currentHead, current: nextHead };
}

// ============================================================================
// Eligibility Projection
// ============================================================================

export function evaluateEvidenceEligibility(
  asset: EvidenceAsset,
  sourceObject: SourceObject,
  events: readonly EvidenceVerificationEvent[]
): EvidenceEligibilityResult {
  if (asset.archivedAt !== null) {
    return { isEligible: false, reason: "asset_archived" };
  }

  if (sourceObject.availability === "quarantined") {
    return { isEligible: false, reason: "source_quarantined" };
  }
  if (sourceObject.availability === "archived") {
    return { isEligible: false, reason: "source_archived" };
  }
  if (sourceObject.availability === "deleted_under_retention") {
    return { isEligible: false, reason: "source_deleted" };
  }

  // Active disputes ledger: check events chronologically
  const activeDisputes = new Map<string, EvidenceVerificationEvent>();
  for (const event of events) {
    if (event.outcome === "disputed" || event.outcome === "rejected") {
      activeDisputes.set(event.eventId, event);
    } else if (event.outcome === "withdrawn" && event.withdrawalEventId) {
      activeDisputes.delete(event.withdrawalEventId);
    }
  }

  if (activeDisputes.size > 0) {
    const latestDispute = Array.from(activeDisputes.values()).pop();
    return {
      isEligible: false,
      reason: "source_disputed",
      activeDisputeEvent: latestDispute
    };
  }

  return { isEligible: true, reason: "eligible" };
}

// ============================================================================
// Rehydration Functions
// ============================================================================

export function rehydrateEvidenceAsset(raw: EvidenceAsset): EvidenceAsset {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    evidenceId: createEvidenceId(raw.evidenceId),
    currentRevision: Number(raw.currentRevision),
    version: Number(raw.version),
    createdAt: canonicalizeUtcTimestamp(raw.createdAt),
    archivedAt: raw.archivedAt ? canonicalizeUtcTimestamp(raw.archivedAt) : null
  });
}

export function rehydrateEvidenceRevision(raw: EvidenceRevision): EvidenceRevision {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    evidenceId: createEvidenceId(raw.evidenceId),
    revision: Number(raw.revision),
    sourceObjectId: createSourceObjectId(raw.sourceObjectId),
    sourceClass: raw.sourceClass,
    acquisitionMethod: raw.acquisitionMethod,
    submittedBy: String(raw.submittedBy).trim(),
    submittedAt: canonicalizeUtcTimestamp(raw.submittedAt),
    assertionText: String(raw.assertionText).trim(),
    reportedCaptureDate: raw.reportedCaptureDate
      ? (String(raw.reportedCaptureDate).trim() as DateOnlyString)
      : null,
    reportedCaptureTimestamp: raw.reportedCaptureTimestamp
      ? canonicalizeUtcTimestamp(raw.reportedCaptureTimestamp)
      : null,
    reportedCapturePrecision: raw.reportedCapturePrecision ?? null,
    captureContext: raw.captureContext ? String(raw.captureContext).trim() : null,
    rightsStatus: raw.rightsStatus,
    consentStatus: raw.consentStatus,
    rightsAttribution: raw.rightsAttribution ? String(raw.rightsAttribution).trim() : null,
    rightsDocumentLocator: raw.rightsDocumentLocator
      ? String(raw.rightsDocumentLocator).trim()
      : null,
    supersedesRevision:
      raw.supersedesRevision !== null && raw.supersedesRevision !== undefined
        ? Number(raw.supersedesRevision)
        : null
  });
}

export function rehydrateBatchEvidenceLink(raw: BatchEvidenceLink): BatchEvidenceLink {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    batchId: createBatchId(raw.batchId),
    evidenceId: createEvidenceId(raw.evidenceId),
    evidenceRevision: Number(raw.evidenceRevision),
    purpose: raw.purpose,
    assertedBy: String(raw.assertedBy).trim(),
    assertedAt: canonicalizeUtcTimestamp(raw.assertedAt)
  });
}

export function rehydrateEvidenceDerivative(raw: EvidenceDerivative): EvidenceDerivative {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    derivativeId: createDerivativeId(raw.derivativeId),
    evidenceId: createEvidenceId(raw.evidenceId),
    evidenceRevision: Number(raw.evidenceRevision),
    referenceAssetId: String(raw.referenceAssetId).trim(),
    derivativeSha256: createSha256Hex(raw.derivativeSha256),
    transformDescription: String(raw.transformDescription).trim(),
    transformToolVersion: raw.transformToolVersion ? String(raw.transformToolVersion).trim() : null,
    createdBy: String(raw.createdBy).trim(),
    createdAt: canonicalizeUtcTimestamp(raw.createdAt)
  });
}

export function rehydrateEvidenceVerificationEvent(
  raw: EvidenceVerificationEvent
): EvidenceVerificationEvent {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    eventId: createVerificationEventId(raw.eventId),
    evidenceId: createEvidenceId(raw.evidenceId),
    evidenceRevision: Number(raw.evidenceRevision),
    outcome: raw.outcome,
    verificationKind: raw.verificationKind,
    factScope: raw.factScope,
    actorId: String(raw.actorId).trim(),
    occurredAt: canonicalizeUtcTimestamp(raw.occurredAt),
    method: String(raw.method).trim(),
    reason: String(raw.reason).trim(),
    verifiedPartyReference: raw.verifiedPartyReference
      ? String(raw.verifiedPartyReference).trim()
      : null,
    withdrawalEventId: raw.withdrawalEventId
      ? createVerificationEventId(raw.withdrawalEventId)
      : null
  });
}
