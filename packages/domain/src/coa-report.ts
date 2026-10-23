import {
  canonicalizeUtcTimestamp,
  compareDateOnly,
  hasControlOrInvisibleChars,
  isValidDateOnly,
  normalizeAssertedBy,
  type DateOnlyString,
  type IsoTimestampString,
  type CoaCompletenessStatus,
  type CoaReviewDecision,
  type CoaScopeKind
} from "@cco/shared";
import {
  createBatchId,
  createClientId,
  createCoaReportId,
  createCoaReviewEventId,
  createEvidenceId,
  createVerificationEventId,
  type BatchId,
  type ClientId,
  type CoaReportId,
  type CoaReviewEventId,
  type EvidenceId,
  type VerificationEventId
} from "./identifiers.js";
import type { CoaMeasurement } from "./coa-measurement.js";
import {
  AccessDeniedError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";

export interface CoaReport {
  readonly clientId: ClientId;
  readonly reportId: CoaReportId;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly currentRevision: number;
  readonly version: number;
  readonly createdAt: IsoTimestampString;
  readonly archivedAt: IsoTimestampString | null;
}

export interface CoaReportRevision {
  readonly clientId: ClientId;
  readonly reportId: CoaReportId;
  readonly revision: number;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly completenessStatus: CoaCompletenessStatus;
  readonly reportIdentifierAsClaimed: string | null;
  readonly reportDate: DateOnlyString | null;
  readonly labNameAsClaimed: string | null;
  readonly sampleIdentifierAsClaimed: string | null;
  readonly scopeKind: CoaScopeKind | null;
  readonly scopeDescription: string | null;
  readonly sampleDate: DateOnlyString | null;
  readonly samplingMethodDescription: string | null;
  readonly sampleToBatchAssociationAttestation: string | null;
  readonly sampleToBatchAssociationConfirmed: boolean | null;
  readonly verifiedLabIdentityEventId: VerificationEventId | null;
  readonly assertedBy: string;
  readonly assertedAt: IsoTimestampString;
  readonly supersedesRevision: number | null;
}

export interface CoaReportReviewEvent {
  readonly eventId: CoaReviewEventId;
  readonly clientId: ClientId;
  readonly reportId: CoaReportId;
  readonly reportRevision: number;
  readonly decision: CoaReviewDecision;
  readonly actorId: string;
  readonly occurredAt: IsoTimestampString;
  readonly reason: string;
  readonly assessedScope: CoaScopeKind;
}

export interface CreateCoaReportInput {
  readonly clientId: ClientId | string;
  readonly reportId?: CoaReportId | string | undefined;
  readonly batchId: BatchId | string;
  readonly evidenceId: EvidenceId | string;
  readonly createdAt?: IsoTimestampString | undefined;
}

export function createCoaReport(input: CreateCoaReportInput): CoaReport {
  const clientId = createClientId(String(input.clientId));
  const batchId = createBatchId(String(input.batchId));
  const evidenceId = createEvidenceId(String(input.evidenceId));
  const reportId = input.reportId
    ? createCoaReportId(String(input.reportId))
    : createCoaReportId(crypto.randomUUID());

  const createdAt = input.createdAt
    ? canonicalizeUtcTimestamp(input.createdAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    clientId,
    reportId,
    batchId,
    evidenceId,
    currentRevision: 1,
    version: 1,
    createdAt,
    archivedAt: null
  });
}

export interface CreateCoaReportRevisionInput {
  readonly clientId: ClientId | string;
  readonly reportId: CoaReportId | string;
  readonly revision: number;
  readonly batchId: BatchId | string;
  readonly evidenceId: EvidenceId | string;
  readonly evidenceRevision: number;
  readonly completenessStatus: CoaCompletenessStatus;
  readonly reportIdentifierAsClaimed?: string | null | undefined;
  readonly reportDate?: DateOnlyString | null | undefined;
  readonly labNameAsClaimed?: string | null | undefined;
  readonly sampleIdentifierAsClaimed?: string | null | undefined;
  readonly scopeKind?: CoaScopeKind | null | undefined;
  readonly scopeDescription?: string | null | undefined;
  readonly sampleDate?: DateOnlyString | null | undefined;
  readonly samplingMethodDescription?: string | null | undefined;
  readonly sampleToBatchAssociationAttestation?: string | null | undefined;
  readonly sampleToBatchAssociationConfirmed?: boolean | null | undefined;
  readonly verifiedLabIdentityEventId?: VerificationEventId | string | null | undefined;
  readonly assertedBy: string;
  readonly assertedAt?: IsoTimestampString | undefined;
  readonly supersedesRevision?: number | null | undefined;
}

export function createCoaReportRevision(
  input: CreateCoaReportRevisionInput,
  measurements: readonly CoaMeasurement[] = []
): CoaReportRevision {
  const clientId = createClientId(String(input.clientId));
  const reportId = createCoaReportId(String(input.reportId));
  const batchId = createBatchId(String(input.batchId));
  const evidenceId = createEvidenceId(String(input.evidenceId));

  if (!Number.isInteger(input.revision) || input.revision < 1) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["revision"],
        message: "revision must be a positive integer >= 1."
      }
    ]);
  }

  if (!Number.isInteger(input.evidenceRevision) || input.evidenceRevision < 1) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["evidenceRevision"],
        message: "evidenceRevision must be a positive integer >= 1."
      }
    ]);
  }

  // Monotonic revision checks
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

  let assertedBy: string;
  try {
    assertedBy = normalizeAssertedBy(input.assertedBy, "assertedBy");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["assertedBy"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  const assertedAt = input.assertedAt
    ? canonicalizeUtcTimestamp(input.assertedAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());
  const assertedAtDate = assertedAt.slice(0, 10) as DateOnlyString;

  // Clean and validate strings if present
  function cleanString(
    val: string | null | undefined,
    fieldName: string,
    maxLen = 255
  ): string | null {
    if (val === null || val === undefined) {
      return null;
    }
    if (hasControlOrInvisibleChars(val)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: [fieldName],
          message: `${fieldName} contains illegal control or invisible formatting characters.`
        }
      ]);
    }
    const trimmed = val.trim();
    if (trimmed.length === 0) {
      return null;
    }
    if (trimmed.length > maxLen) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: [fieldName],
          message: `${fieldName} must be <= ${maxLen} characters (found ${trimmed.length}).`
        }
      ]);
    }
    return trimmed;
  }

  const reportIdentifierAsClaimed = cleanString(
    input.reportIdentifierAsClaimed,
    "reportIdentifierAsClaimed",
    128
  );
  const labNameAsClaimed = cleanString(input.labNameAsClaimed, "labNameAsClaimed", 255);
  const sampleIdentifierAsClaimed = cleanString(
    input.sampleIdentifierAsClaimed,
    "sampleIdentifierAsClaimed",
    128
  );
  const scopeDescription = cleanString(input.scopeDescription, "scopeDescription", 1000);
  const samplingMethodDescription = cleanString(
    input.samplingMethodDescription,
    "samplingMethodDescription",
    1000
  );
  const sampleToBatchAssociationAttestation = cleanString(
    input.sampleToBatchAssociationAttestation,
    "sampleToBatchAssociationAttestation",
    2000
  );

  // Validate dates if present
  let reportDate: DateOnlyString | null = null;
  if (input.reportDate !== null && input.reportDate !== undefined) {
    const rd = input.reportDate.trim();
    if (!isValidDateOnly(rd)) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["reportDate"],
          message: `reportDate "${input.reportDate}" is not a valid date string (YYYY-MM-DD).`
        }
      ]);
    }
    if (compareDateOnly(rd, assertedAtDate) > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["reportDate"],
          message: `reportDate "${rd}" cannot be later than recording date "${assertedAtDate}".`
        }
      ]);
    }
    reportDate = rd as DateOnlyString;
  }

  let sampleDate: DateOnlyString | null = null;
  if (input.sampleDate !== null && input.sampleDate !== undefined) {
    const sd = input.sampleDate.trim();
    if (!isValidDateOnly(sd)) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["sampleDate"],
          message: `sampleDate "${input.sampleDate}" is not a valid date string (YYYY-MM-DD).`
        }
      ]);
    }
    if (compareDateOnly(sd, assertedAtDate) > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["sampleDate"],
          message: `sampleDate "${sd}" cannot be later than recording date "${assertedAtDate}".`
        }
      ]);
    }
    sampleDate = sd as DateOnlyString;
  }

  if (reportDate !== null && sampleDate !== null) {
    if (compareDateOnly(sampleDate, reportDate) > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["sampleDate", "reportDate"],
          message: `sampleDate "${sampleDate}" cannot be later than reportDate "${reportDate}".`
        }
      ]);
    }
  }

  const scopeKind = input.scopeKind ?? null;
  const sampleToBatchAssociationConfirmed = input.sampleToBatchAssociationConfirmed ?? null;

  const verifiedLabIdentityEventId = input.verifiedLabIdentityEventId
    ? createVerificationEventId(String(input.verifiedLabIdentityEventId))
    : null;

  // Completeness invariants (KTD3)
  if (input.completenessStatus === "complete") {
    if (!reportIdentifierAsClaimed) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["reportIdentifierAsClaimed"],
          message: "Complete CoA reports require a nonblank reportIdentifierAsClaimed."
        }
      ]);
    }
    if (!labNameAsClaimed) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["labNameAsClaimed"],
          message: "Complete CoA reports require a nonblank labNameAsClaimed."
        }
      ]);
    }
    if (!sampleIdentifierAsClaimed) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["sampleIdentifierAsClaimed"],
          message: "Complete CoA reports require a nonblank sampleIdentifierAsClaimed."
        }
      ]);
    }
    if (!reportDate) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["reportDate"],
          message: "Complete CoA reports require a valid reportDate."
        }
      ]);
    }
    if (!scopeKind || (scopeKind !== "sample_only" && scopeKind !== "attributed_lot")) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["scopeKind"],
          message: "Complete CoA reports require scopeKind 'sample_only' or 'attributed_lot'."
        }
      ]);
    }
    if (!scopeDescription) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["scopeDescription"],
          message: "Complete CoA reports require a nonblank scopeDescription."
        }
      ]);
    }
    if (scopeKind === "attributed_lot" && !samplingMethodDescription) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["samplingMethodDescription"],
          message:
            "Complete CoA reports with scopeKind 'attributed_lot' require a nonblank samplingMethodDescription."
        }
      ]);
    }
    if (sampleToBatchAssociationConfirmed !== true) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["sampleToBatchAssociationConfirmed"],
          message: "Complete CoA reports require sampleToBatchAssociationConfirmed to be true."
        }
      ]);
    }
    if (!sampleToBatchAssociationAttestation) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["sampleToBatchAssociationAttestation"],
          message: "Complete CoA reports require a nonblank sampleToBatchAssociationAttestation."
        }
      ]);
    }
    if (measurements.length === 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["measurements"],
          message: "Complete CoA reports require at least one measurement."
        }
      ]);
    }
  }

  // Duplicate analyte + basis + context check across measurements (KTD2)
  const seenKeys = new Set<string>();
  for (const m of measurements) {
    const key = `${m.analyte.trim().toLowerCase()}::${m.basis.trim().toLowerCase()}::${m.context.trim().toLowerCase()}`;
    if (seenKeys.has(key)) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["measurements"],
          message: `Duplicate parameter context in report: analyte "${m.analyte}" with basis "${m.basis}" and context "${m.context}" appears multiple times.`
        }
      ]);
    }
    seenKeys.add(key);

    // Verify lineage matches report revision exactly
    if (
      m.clientId !== clientId ||
      m.reportId !== reportId ||
      m.reportRevision !== input.revision ||
      m.batchId !== batchId ||
      m.evidenceId !== evidenceId ||
      m.evidenceRevision !== input.evidenceRevision
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["measurements", m.measurementId],
          message: "Measurement lineage does not match parent CoA report revision."
        }
      ]);
    }
  }

  return Object.freeze({
    clientId,
    reportId,
    revision: input.revision,
    batchId,
    evidenceId,
    evidenceRevision: input.evidenceRevision,
    completenessStatus: input.completenessStatus,
    reportIdentifierAsClaimed,
    reportDate,
    labNameAsClaimed,
    sampleIdentifierAsClaimed,
    scopeKind,
    scopeDescription,
    sampleDate,
    samplingMethodDescription,
    sampleToBatchAssociationAttestation,
    sampleToBatchAssociationConfirmed,
    verifiedLabIdentityEventId,
    assertedBy,
    assertedAt,
    supersedesRevision: input.supersedesRevision ?? null
  });
}

export function supersedeCoaReport(
  currentHead: CoaReport,
  expectedVersion: number
): { readonly previous: CoaReport; readonly current: CoaReport } {
  if (currentHead.archivedAt !== null) {
    throw new AccessDeniedError("Archived CoA report cannot be superseded.");
  }
  if (currentHead.version !== expectedVersion) {
    throw new StaleRevisionConflictError("CoaReport", expectedVersion, currentHead.version);
  }

  const nextHead: CoaReport = Object.freeze({
    ...currentHead,
    currentRevision: currentHead.currentRevision + 1,
    version: currentHead.version + 1
  });

  return { previous: currentHead, current: nextHead };
}

export function archiveCoaReport(
  currentHead: CoaReport,
  expectedVersion: number,
  archivedAt?: IsoTimestampString
): { readonly previous: CoaReport; readonly current: CoaReport } {
  if (currentHead.archivedAt !== null) {
    throw new AccessDeniedError("CoA report is already archived.");
  }
  if (currentHead.version !== expectedVersion) {
    throw new StaleRevisionConflictError("CoaReport", expectedVersion, currentHead.version);
  }

  const nextHead: CoaReport = Object.freeze({
    ...currentHead,
    version: currentHead.version + 1,
    archivedAt: archivedAt
      ? canonicalizeUtcTimestamp(archivedAt)
      : canonicalizeUtcTimestamp(new Date().toISOString())
  });

  return { previous: currentHead, current: nextHead };
}

export interface CreateCoaReportReviewEventInput {
  readonly eventId?: CoaReviewEventId | string | undefined;
  readonly clientId: ClientId | string;
  readonly reportId: CoaReportId | string;
  readonly reportRevision: number;
  readonly decision: CoaReviewDecision;
  readonly actorId: string;
  readonly occurredAt?: IsoTimestampString | undefined;
  readonly reason: string;
  readonly assessedScope: CoaScopeKind;
}

export function createCoaReportReviewEvent(
  input: CreateCoaReportReviewEventInput,
  currentHead: CoaReport,
  targetRevision: CoaReportRevision
): { readonly event: CoaReportReviewEvent; readonly updatedHead: CoaReport } {
  if (currentHead.archivedAt !== null) {
    throw new AccessDeniedError("Cannot review an archived CoA report.");
  }

  if (currentHead.currentRevision !== targetRevision.revision) {
    throw new StaleRevisionConflictError(
      "CoaReportRevision",
      currentHead.currentRevision,
      targetRevision.revision
    );
  }

  if (targetRevision.completenessStatus !== "complete" && input.decision === "approved") {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["decision"],
        message: "Cannot approve a draft CoA report. Report must be complete."
      }
    ]);
  }

  if (
    targetRevision.scopeKind === "sample_only" &&
    input.assessedScope === "attributed_lot" &&
    input.decision === "approved"
  ) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["assessedScope"],
        message: "Assessed scope cannot be 'attributed_lot' for a report scoped as 'sample_only'."
      }
    ]);
  }

  let actorId: string;
  try {
    actorId = normalizeAssertedBy(input.actorId, "actorId");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["actorId"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  // Separation of duties: reviewer cannot be the recorder who asserted this report revision
  if (
    input.decision === "approved" &&
    actorId.toLowerCase() === targetRevision.assertedBy.trim().toLowerCase()
  ) {
    throw new AccessDeniedError(
      "Self-approval forbidden: reviewer cannot be the recorder who asserted this report revision."
    );
  }

  const reason = input.reason ? input.reason.trim() : "";
  if (reason.length === 0 || reason.length > 1000) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["reason"],
        message: "reason must be 1–1000 characters."
      }
    ]);
  }

  const eventId = input.eventId
    ? createCoaReviewEventId(String(input.eventId))
    : createCoaReviewEventId(crypto.randomUUID());

  const occurredAt = input.occurredAt
    ? canonicalizeUtcTimestamp(input.occurredAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  const event: CoaReportReviewEvent = Object.freeze({
    eventId,
    clientId: currentHead.clientId,
    reportId: currentHead.reportId,
    reportRevision: targetRevision.revision,
    decision: input.decision,
    actorId: input.actorId.trim(),
    occurredAt,
    reason,
    assessedScope: input.assessedScope
  });

  const updatedHead: CoaReport = Object.freeze({
    ...currentHead,
    version: currentHead.version + 1
  });

  return { event, updatedHead };
}

export function rehydrateCoaReport(raw: CoaReport): CoaReport {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    reportId: createCoaReportId(raw.reportId),
    batchId: createBatchId(raw.batchId),
    evidenceId: createEvidenceId(raw.evidenceId),
    currentRevision: Number(raw.currentRevision),
    version: Number(raw.version),
    createdAt: canonicalizeUtcTimestamp(raw.createdAt),
    archivedAt: raw.archivedAt ? canonicalizeUtcTimestamp(raw.archivedAt) : null
  });
}

export function rehydrateCoaReportRevision(raw: CoaReportRevision): CoaReportRevision {
  return Object.freeze({
    clientId: createClientId(raw.clientId),
    reportId: createCoaReportId(raw.reportId),
    revision: Number(raw.revision),
    batchId: createBatchId(raw.batchId),
    evidenceId: createEvidenceId(raw.evidenceId),
    evidenceRevision: Number(raw.evidenceRevision),
    completenessStatus: raw.completenessStatus,
    reportIdentifierAsClaimed: raw.reportIdentifierAsClaimed
      ? String(raw.reportIdentifierAsClaimed).trim()
      : null,
    reportDate: raw.reportDate ? (String(raw.reportDate).trim() as DateOnlyString) : null,
    labNameAsClaimed: raw.labNameAsClaimed ? String(raw.labNameAsClaimed).trim() : null,
    sampleIdentifierAsClaimed: raw.sampleIdentifierAsClaimed
      ? String(raw.sampleIdentifierAsClaimed).trim()
      : null,
    scopeKind: raw.scopeKind ?? null,
    scopeDescription: raw.scopeDescription ? String(raw.scopeDescription).trim() : null,
    sampleDate: raw.sampleDate ? (String(raw.sampleDate).trim() as DateOnlyString) : null,
    samplingMethodDescription: raw.samplingMethodDescription
      ? String(raw.samplingMethodDescription).trim()
      : null,
    sampleToBatchAssociationAttestation: raw.sampleToBatchAssociationAttestation
      ? String(raw.sampleToBatchAssociationAttestation).trim()
      : null,
    sampleToBatchAssociationConfirmed:
      raw.sampleToBatchAssociationConfirmed !== null &&
      raw.sampleToBatchAssociationConfirmed !== undefined
        ? Boolean(raw.sampleToBatchAssociationConfirmed)
        : null,
    verifiedLabIdentityEventId: raw.verifiedLabIdentityEventId
      ? createVerificationEventId(raw.verifiedLabIdentityEventId)
      : null,
    assertedBy: String(raw.assertedBy).trim(),
    assertedAt: canonicalizeUtcTimestamp(raw.assertedAt),
    supersedesRevision:
      raw.supersedesRevision !== null && raw.supersedesRevision !== undefined
        ? Number(raw.supersedesRevision)
        : null
  });
}

export function rehydrateCoaReportReviewEvent(raw: CoaReportReviewEvent): CoaReportReviewEvent {
  return Object.freeze({
    eventId: createCoaReviewEventId(raw.eventId),
    clientId: createClientId(raw.clientId),
    reportId: createCoaReportId(raw.reportId),
    reportRevision: Number(raw.reportRevision),
    decision: raw.decision,
    actorId: String(raw.actorId).trim(),
    occurredAt: canonicalizeUtcTimestamp(raw.occurredAt),
    reason: String(raw.reason).trim(),
    assessedScope: raw.assessedScope
  });
}
