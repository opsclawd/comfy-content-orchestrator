import {
  canonicalizeUtcTimestamp,
  compareDateOnly,
  compareUtcTimestamps,
  isValidDateOnly,
  isValidIsoUtcTimestamp,
  isValidPositiveInt,
  isValidUuid,
  MAX_POSITIVE_INT,
  normalizeAssertedBy,
  normalizeProducerIdentity,
  normalizeUuid
} from "@cco/shared";
import type { BatchOriginKind, DateOnlyString, IsoTimestampString } from "@cco/shared";
import { BATCH_ORIGIN_KINDS } from "@cco/shared";
import type { BatchId, ClientId, EvidenceId } from "./identifiers.js";
import { NonMonotonicRevisionError, ProductValidationError } from "./product-evidence-errors.js";

/**
 * Pure domain model for append-only factual batch revision (ADR 0009 §2.2 & §5).
 * Represents submitter assertions over physical origin and dates.
 * Origin evidence references are identifiers only, NOT asserted truth.
 */
export interface BatchFactsRevision {
  readonly clientId: ClientId;
  readonly batchId: BatchId;
  readonly revision: number;
  readonly originKind: BatchOriginKind;
  readonly producerIdentityAsClaimed: string | null;
  readonly productionStartDate: DateOnlyString | null;
  readonly productionEndDate: DateOnlyString | null;
  readonly originEvidenceId: EvidenceId | null;
  readonly originEvidenceRevision: number | null;
  readonly assertedBy: string;
  readonly assertedAt: IsoTimestampString;
  readonly supersedesRevision: number | null;
}

export interface InitialBatchFactsInput {
  readonly originKind: BatchOriginKind;
  readonly producerIdentityAsClaimed?: string | null | undefined;
  readonly productionStartDate?: DateOnlyString | null | undefined;
  readonly productionEndDate?: DateOnlyString | null | undefined;
  readonly originEvidenceId?: EvidenceId | null | undefined;
  readonly originEvidenceRevision?: number | null | undefined;
}

export interface AppendBatchFactsInput {
  readonly originKind: BatchOriginKind;
  readonly producerIdentityAsClaimed?: string | null | undefined;
  readonly productionStartDate?: DateOnlyString | null | undefined;
  readonly productionEndDate?: DateOnlyString | null | undefined;
  readonly originEvidenceId?: EvidenceId | null | undefined;
  readonly originEvidenceRevision?: number | null | undefined;
  readonly assertedBy: string;
  readonly assertedAt: IsoTimestampString;
}

function validateOriginKind(val: unknown): BatchOriginKind {
  if (typeof val !== "string" || !(BATCH_ORIGIN_KINDS as readonly string[]).includes(val)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["originKind"],
        message: `originKind must be one of: ${BATCH_ORIGIN_KINDS.join(", ")}.`
      }
    ]);
  }
  return val as BatchOriginKind;
}

function validateProductionDates(
  startDate?: string | null,
  endDate?: string | null
): { startDate: DateOnlyString | null; endDate: DateOnlyString | null } {
  const normStart = startDate ?? null;
  const normEnd = endDate ?? null;

  if (normStart !== null && !isValidDateOnly(normStart)) {
    throw new ProductValidationError([
      {
        code: "INVALID_DATE",
        path: ["productionStartDate"],
        message: `productionStartDate "${normStart}" is not a valid Gregorian date (YYYY-MM-DD).`
      }
    ]);
  }
  if (normEnd !== null && !isValidDateOnly(normEnd)) {
    throw new ProductValidationError([
      {
        code: "INVALID_DATE",
        path: ["productionEndDate"],
        message: `productionEndDate "${normEnd}" is not a valid Gregorian date (YYYY-MM-DD).`
      }
    ]);
  }
  if (normStart !== null && normEnd !== null) {
    if (compareDateOnly(normStart, normEnd) > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["productionStartDate", "productionEndDate"],
          message: `productionStartDate "${normStart}" cannot be later than productionEndDate "${normEnd}".`
        }
      ]);
    }
  }

  return { startDate: normStart, endDate: normEnd };
}

function validateOriginEvidence(
  evidenceId?: string | null,
  evidenceRevision?: number | null
): { evidenceId: EvidenceId | null; evidenceRevision: number | null } {
  const normId = evidenceId ?? null;
  const normRev = evidenceRevision ?? null;

  const idPresent = normId !== null;
  const revPresent = normRev !== null;

  if ((idPresent && !revPresent) || (!idPresent && revPresent)) {
    throw new ProductValidationError([
      {
        code: "INVALID_FIELD_COMBINATION",
        path: ["originEvidenceId", "originEvidenceRevision"],
        message: "originEvidenceId and originEvidenceRevision must be both present or both null."
      }
    ]);
  }

  if (normId !== null) {
    if (!isValidUuid(normId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["originEvidenceId"],
          message: "originEvidenceId must be a valid UUID string."
        }
      ]);
    }
  }

  if (normRev !== null) {
    if (!isValidPositiveInt(normRev)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["originEvidenceRevision"],
          message: "originEvidenceRevision must be a positive 32-bit INT."
        }
      ]);
    }
  }

  return {
    evidenceId: normId ? (normalizeUuid(normId) as EvidenceId) : null,
    evidenceRevision: normRev
  };
}

/**
 * Creates initial revision 1 for batch facts.
 * If initialFactsInput is omitted, defaults to originKind "unknown" with null facts.
 */
export function createInitialBatchFacts(
  clientId: ClientId,
  batchId: BatchId,
  actorId: string,
  timestamp: IsoTimestampString,
  initialFactsInput?: InitialBatchFactsInput
): BatchFactsRevision {
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

  let canonicalTimestamp: IsoTimestampString;
  try {
    canonicalTimestamp = canonicalizeUtcTimestamp(timestamp);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["assertedAt"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  let normalizedActor: string;
  try {
    normalizedActor = normalizeAssertedBy(actorId, "assertedBy");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["assertedBy"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  if (!initialFactsInput) {
    return Object.freeze({
      clientId,
      batchId,
      revision: 1,
      originKind: "unknown",
      producerIdentityAsClaimed: null,
      productionStartDate: null,
      productionEndDate: null,
      originEvidenceId: null,
      originEvidenceRevision: null,
      assertedBy: normalizedActor,
      assertedAt: canonicalTimestamp,
      supersedesRevision: null
    });
  }

  const originKind = validateOriginKind(initialFactsInput.originKind);
  let producerIdentity: string | null = null;
  try {
    producerIdentity = normalizeProducerIdentity(initialFactsInput.producerIdentityAsClaimed);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["producerIdentityAsClaimed"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  const { startDate, endDate } = validateProductionDates(
    initialFactsInput.productionStartDate,
    initialFactsInput.productionEndDate
  );

  const { evidenceId, evidenceRevision } = validateOriginEvidence(
    initialFactsInput.originEvidenceId,
    initialFactsInput.originEvidenceRevision
  );

  return Object.freeze({
    clientId,
    batchId,
    revision: 1,
    originKind,
    producerIdentityAsClaimed: producerIdentity,
    productionStartDate: startDate,
    productionEndDate: endDate,
    originEvidenceId: evidenceId,
    originEvidenceRevision: evidenceRevision,
    assertedBy: normalizedActor,
    assertedAt: canonicalTimestamp,
    supersedesRevision: null
  });
}

/**
 * Rehydrates a persisted or wire BatchFactsRevision record, verifying all invariants.
 */
export function rehydrateBatchFactsRevision(raw: BatchFactsRevision): BatchFactsRevision {
  if (!isValidUuid(raw.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "Invalid clientId UUID in facts record."
      }
    ]);
  }
  if (!isValidUuid(raw.batchId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["batchId"],
        message: "Invalid batchId UUID in facts record."
      }
    ]);
  }
  if (!isValidPositiveInt(raw.revision)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["revision"],
        message: `Facts revision ${raw.revision} must be a positive 32-bit INT.`
      }
    ]);
  }

  // Monotonic predecessor invariant
  if (raw.revision === 1) {
    if (raw.supersedesRevision !== null) {
      throw new NonMonotonicRevisionError(
        `Initial facts revision 1 must have supersedesRevision null, got ${raw.supersedesRevision}.`
      );
    }
  } else {
    if (
      raw.supersedesRevision === null ||
      !isValidPositiveInt(raw.supersedesRevision) ||
      raw.supersedesRevision >= raw.revision
    ) {
      throw new NonMonotonicRevisionError(
        `Facts revision ${raw.revision} must supersede a strictly smaller positive revision, got ${raw.supersedesRevision}.`
      );
    }
  }

  const originKind = validateOriginKind(raw.originKind);
  let producerIdentity: string | null = null;
  try {
    producerIdentity = normalizeProducerIdentity(raw.producerIdentityAsClaimed);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["producerIdentityAsClaimed"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  const { startDate, endDate } = validateProductionDates(
    raw.productionStartDate,
    raw.productionEndDate
  );

  const { evidenceId, evidenceRevision } = validateOriginEvidence(
    raw.originEvidenceId,
    raw.originEvidenceRevision
  );

  if (!isValidIsoUtcTimestamp(raw.assertedAt)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["assertedAt"],
        message: "assertedAt must be a valid UTC ISO 8601 timestamp."
      }
    ]);
  }

  const assertedBy = normalizeAssertedBy(raw.assertedBy, "assertedBy");

  return Object.freeze({
    clientId: raw.clientId,
    batchId: raw.batchId,
    revision: raw.revision,
    originKind,
    producerIdentityAsClaimed: producerIdentity,
    productionStartDate: startDate,
    productionEndDate: endDate,
    originEvidenceId: evidenceId,
    originEvidenceRevision: evidenceRevision,
    assertedBy,
    assertedAt: canonicalizeUtcTimestamp(raw.assertedAt),
    supersedesRevision: raw.supersedesRevision
  });
}

/**
 * Pure transition appending a new facts revision to a batch.
 * Guarantees monotonic advance: revision = previous.revision + 1, supersedesRevision = previous.revision.
 */
export function appendBatchFactsRevision(
  previous: BatchFactsRevision,
  input: AppendBatchFactsInput
): BatchFactsRevision {
  if (previous.revision >= MAX_POSITIVE_INT) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["revision"],
        message: "Batch facts revision overflow: cannot increment beyond maximum positive INT."
      }
    ]);
  }

  let canonicalAssertedAt: IsoTimestampString;
  try {
    canonicalAssertedAt = canonicalizeUtcTimestamp(input.assertedAt);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["assertedAt"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  if (compareUtcTimestamps(canonicalAssertedAt, previous.assertedAt) < 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["assertedAt"],
        message: "Supplied facts assertedAt timestamp cannot move backwards in time."
      }
    ]);
  }

  let normalizedActor: string;
  try {
    normalizedActor = normalizeAssertedBy(input.assertedBy, "assertedBy");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["assertedBy"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  const originKind = validateOriginKind(input.originKind);
  let producerIdentity: string | null = null;
  try {
    producerIdentity = normalizeProducerIdentity(input.producerIdentityAsClaimed);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["producerIdentityAsClaimed"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  const { startDate, endDate } = validateProductionDates(
    input.productionStartDate,
    input.productionEndDate
  );

  const { evidenceId, evidenceRevision } = validateOriginEvidence(
    input.originEvidenceId,
    input.originEvidenceRevision
  );

  return Object.freeze({
    clientId: previous.clientId,
    batchId: previous.batchId,
    revision: previous.revision + 1,
    originKind,
    producerIdentityAsClaimed: producerIdentity,
    productionStartDate: startDate,
    productionEndDate: endDate,
    originEvidenceId: evidenceId,
    originEvidenceRevision: evidenceRevision,
    assertedBy: normalizedActor,
    assertedAt: canonicalAssertedAt,
    supersedesRevision: previous.revision
  });
}
