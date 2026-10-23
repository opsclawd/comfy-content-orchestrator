import {
  canonicalizeUtcTimestamp,
  compareUtcTimestamps,
  isValidIsoUtcTimestamp,
  isValidLotIdentifier,
  isValidPositiveInt,
  isValidUuid,
  MAX_POSITIVE_INT,
  normalizeDisplayName,
  normalizeLotIdentifier
} from "@cco/shared";
import type { IsoTimestampString } from "@cco/shared";
import {
  createInitialBatchFacts,
  type BatchFactsRevision,
  type InitialBatchFactsInput
} from "./batch-facts.js";
import type { BatchId, ClientId, SkuId } from "./identifiers.js";
import {
  AccessDeniedError,
  CrossBatchSourceError,
  CrossClientViolationError,
  DuplicateLotError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";
import { assertSkuCanAcceptBatch, type ProductSku } from "./product-sku.js";

/**
 * Pure domain model for physical ProductBatch / Lot head (ADR 0009 §2.2 & §5).
 * Bounded to a parent SKU under tenant isolation.
 * Mutable head separated from append-only batch facts.
 */
export interface ProductBatch {
  readonly clientId: ClientId;
  readonly batchId: BatchId;
  readonly skuId: SkuId;
  readonly lotIdentifier: string;
  readonly displayName: string;
  readonly version: number;
  readonly currentFactsRevision: number;
  readonly createdAt: IsoTimestampString;
  readonly updatedAt: IsoTimestampString;
  readonly archivedAt: IsoTimestampString | null;
}

export interface CreateProductBatchInput {
  readonly parentSku: ProductSku;
  readonly batchId: BatchId;
  readonly lotIdentifier: string;
  readonly displayName: string;
  readonly initialFacts?: InitialBatchFactsInput | undefined;
  readonly actorId: string;
  readonly timestamp: IsoTimestampString;
}

export interface ProductBatchCreationResult {
  readonly batch: ProductBatch;
  readonly initialFacts: BatchFactsRevision;
}

export interface UpdateProductBatchMetadataInput {
  readonly expectedVersion: number;
  readonly displayName: string;
  readonly updatedAt: IsoTimestampString;
}

export interface ArchiveProductBatchInput {
  readonly expectedVersion: number;
  readonly archivedAt: IsoTimestampString;
}

export interface ProductBatchTransitionResult {
  readonly previous: ProductBatch;
  readonly current: ProductBatch;
}

/**
 * Pure creation factory for ProductBatch:
 * - Requires explicit parent ProductSku and validates ownership & active status.
 * - Always initializes head at version 1, currentFactsRevision 1, active.
 * - Concurrently creates initial facts revision 1 (defaults to unknown provenance if omitted).
 */
export function createProductBatch(input: CreateProductBatchInput): ProductBatchCreationResult {
  // Validate parent SKU can accept new batches
  assertSkuCanAcceptBatch(input.parentSku);

  if (!isValidUuid(input.batchId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["batchId"],
        message: "batchId must be a valid UUID string."
      }
    ]);
  }

  let normalizedLot: string;
  try {
    normalizedLot = normalizeLotIdentifier(input.lotIdentifier);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["lotIdentifier"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  let normalizedName: string;
  try {
    normalizedName = normalizeDisplayName(input.displayName, "displayName");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["displayName"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  let canonicalTimestamp: IsoTimestampString;
  try {
    canonicalTimestamp = canonicalizeUtcTimestamp(input.timestamp);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["timestamp"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  const batchHead: ProductBatch = Object.freeze({
    clientId: input.parentSku.clientId,
    batchId: input.batchId,
    skuId: input.parentSku.skuId,
    lotIdentifier: normalizedLot,
    displayName: normalizedName,
    version: 1,
    currentFactsRevision: 1,
    createdAt: canonicalTimestamp,
    updatedAt: canonicalTimestamp,
    archivedAt: null
  });

  const initialFacts = createInitialBatchFacts(
    input.parentSku.clientId,
    input.batchId,
    input.actorId,
    canonicalTimestamp,
    input.initialFacts
  );

  return {
    batch: batchHead,
    initialFacts
  };
}

/**
 * Rehydrates a persisted or wire ProductBatch record, verifying all invariants.
 */
export function rehydrateProductBatch(raw: ProductBatch): ProductBatch {
  if (!isValidUuid(raw.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "Invalid clientId UUID in batch record."
      }
    ]);
  }
  if (!isValidUuid(raw.batchId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["batchId"],
        message: "Invalid batchId UUID in batch record."
      }
    ]);
  }
  if (!isValidUuid(raw.skuId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["skuId"],
        message: "Invalid skuId UUID in batch record."
      }
    ]);
  }
  if (!isValidLotIdentifier(raw.lotIdentifier)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["lotIdentifier"],
        message: `lotIdentifier "${raw.lotIdentifier}" violates lexical rules.`
      }
    ]);
  }
  if (!isValidPositiveInt(raw.version)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: `Batch version ${raw.version} must be a positive 32-bit INT.`
      }
    ]);
  }
  if (!isValidPositiveInt(raw.currentFactsRevision)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["currentFactsRevision"],
        message: `currentFactsRevision ${raw.currentFactsRevision} must be a positive 32-bit INT.`
      }
    ]);
  }
  if (!isValidIsoUtcTimestamp(raw.createdAt)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["createdAt"],
        message: "createdAt must be a valid UTC ISO 8601 timestamp."
      }
    ]);
  }
  if (!isValidIsoUtcTimestamp(raw.updatedAt)) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["updatedAt"],
        message: "updatedAt must be a valid UTC ISO 8601 timestamp."
      }
    ]);
  }
  if (compareUtcTimestamps(raw.updatedAt, raw.createdAt) < 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["updatedAt"],
        message: "updatedAt cannot be earlier than createdAt."
      }
    ]);
  }
  if (raw.archivedAt !== null) {
    if (!isValidIsoUtcTimestamp(raw.archivedAt)) {
      throw new ProductValidationError([
        {
          code: "INVALID_TIMESTAMP",
          path: ["archivedAt"],
          message: "archivedAt must be a valid UTC ISO 8601 timestamp when present."
        }
      ]);
    }
    if (compareUtcTimestamps(raw.archivedAt, raw.createdAt) < 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_TIMESTAMP",
          path: ["archivedAt"],
          message: "archivedAt cannot be earlier than createdAt."
        }
      ]);
    }
    if (compareUtcTimestamps(raw.archivedAt, raw.updatedAt) > 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_TIMESTAMP",
          path: ["archivedAt"],
          message: "archivedAt cannot be later than updatedAt."
        }
      ]);
    }
  }

  return Object.freeze({
    clientId: raw.clientId,
    batchId: raw.batchId,
    skuId: raw.skuId,
    lotIdentifier: raw.lotIdentifier,
    displayName: normalizeDisplayName(raw.displayName, "displayName"),
    version: raw.version,
    currentFactsRevision: raw.currentFactsRevision,
    createdAt: canonicalizeUtcTimestamp(raw.createdAt),
    updatedAt: canonicalizeUtcTimestamp(raw.updatedAt),
    archivedAt: raw.archivedAt !== null ? canonicalizeUtcTimestamp(raw.archivedAt) : null
  });
}

/**
 * Pure transition updating batch display metadata.
 * Fenced by expectedVersion, increments version by 1, forbids mutation of archived heads.
 */
export function updateProductBatchMetadata(
  current: ProductBatch,
  input: UpdateProductBatchMetadataInput
): ProductBatchTransitionResult {
  if (current.archivedAt !== null) {
    throw new AccessDeniedError(
      `Cannot modify archived batch "${current.batchId}".`,
      "ARCHIVED_ENTITY"
    );
  }
  if (input.expectedVersion !== current.version) {
    throw new StaleRevisionConflictError("ProductBatch", input.expectedVersion, current.version);
  }
  if (current.version >= MAX_POSITIVE_INT) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: "Batch version overflow: cannot increment beyond maximum positive INT."
      }
    ]);
  }

  let normalizedName: string;
  try {
    normalizedName = normalizeDisplayName(input.displayName, "displayName");
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TEXT",
        path: ["displayName"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  let canonicalUpdatedAt: IsoTimestampString;
  try {
    canonicalUpdatedAt = canonicalizeUtcTimestamp(input.updatedAt);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["updatedAt"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  if (compareUtcTimestamps(canonicalUpdatedAt, current.updatedAt) < 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["updatedAt"],
        message: "Supplied update timestamp cannot move updatedAt backwards in time."
      }
    ]);
  }

  const next: ProductBatch = Object.freeze({
    ...current,
    displayName: normalizedName,
    version: current.version + 1,
    updatedAt: canonicalUpdatedAt
  });

  return { previous: current, current: next };
}

/**
 * Pure transition archiving a ProductBatch.
 * Terminal lifecycle operation: once archived, cannot be re-archived or modified.
 */
export function archiveProductBatch(
  current: ProductBatch,
  input: ArchiveProductBatchInput
): ProductBatchTransitionResult {
  if (current.archivedAt !== null) {
    throw new AccessDeniedError(
      `Batch "${current.batchId}" is already archived.`,
      "ARCHIVED_ENTITY"
    );
  }
  if (input.expectedVersion !== current.version) {
    throw new StaleRevisionConflictError("ProductBatch", input.expectedVersion, current.version);
  }
  if (current.version >= MAX_POSITIVE_INT) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: "Batch version overflow: cannot increment beyond maximum positive INT."
      }
    ]);
  }

  let canonicalArchivedAt: IsoTimestampString;
  try {
    canonicalArchivedAt = canonicalizeUtcTimestamp(input.archivedAt);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["archivedAt"],
        message: err instanceof Error ? err.message : String(err)
      }
    ]);
  }

  if (compareUtcTimestamps(canonicalArchivedAt, current.updatedAt) < 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["archivedAt"],
        message: "Supplied archive timestamp cannot move time backwards."
      }
    ]);
  }

  const next: ProductBatch = Object.freeze({
    ...current,
    version: current.version + 1,
    updatedAt: canonicalArchivedAt,
    archivedAt: canonicalArchivedAt
  });

  return { previous: current, current: next };
}

/**
 * Pure transition applying facts append to the batch head:
 * Advances version by 1, advances currentFactsRevision to newFacts.revision,
 * updates batch.updatedAt to newFacts.assertedAt.
 */
export function applyBatchFactsAppend(
  currentBatch: ProductBatch,
  previousFacts: BatchFactsRevision,
  newFacts: BatchFactsRevision,
  expectedVersion: number
): ProductBatchTransitionResult {
  if (currentBatch.archivedAt !== null) {
    throw new AccessDeniedError(
      `Cannot append facts to archived batch "${currentBatch.batchId}".`,
      "ARCHIVED_ENTITY"
    );
  }
  if (expectedVersion !== currentBatch.version) {
    throw new StaleRevisionConflictError("ProductBatch", expectedVersion, currentBatch.version);
  }
  if (currentBatch.version >= MAX_POSITIVE_INT) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: "Batch version overflow: cannot increment beyond maximum positive INT."
      }
    ]);
  }

  // Cross-entity lineage verification
  if (newFacts.batchId !== currentBatch.batchId) {
    throw new CrossBatchSourceError(
      `Cannot link facts for batch "${newFacts.batchId}" to batch "${currentBatch.batchId}".`
    );
  }
  if (newFacts.clientId !== currentBatch.clientId) {
    throw new CrossClientViolationError(
      `Cross-client violation: facts client "${newFacts.clientId}" does not match batch client "${currentBatch.clientId}".`
    );
  }

  // Monotonic revision sequence verification
  if (newFacts.revision !== currentBatch.currentFactsRevision + 1) {
    throw new NonMonotonicRevisionError(
      `New facts revision ${newFacts.revision} must be exactly one greater than current facts revision ${currentBatch.currentFactsRevision}.`
    );
  }
  if (newFacts.revision !== previousFacts.revision + 1) {
    throw new NonMonotonicRevisionError(
      `New facts revision ${newFacts.revision} must succeed previous facts revision ${previousFacts.revision}.`
    );
  }
  if (newFacts.supersedesRevision !== previousFacts.revision) {
    throw new NonMonotonicRevisionError(
      `New facts supersedesRevision ${newFacts.supersedesRevision} must equal previous facts revision ${previousFacts.revision}.`
    );
  }

  if (compareUtcTimestamps(newFacts.assertedAt, currentBatch.updatedAt) < 0) {
    throw new ProductValidationError([
      {
        code: "INVALID_TIMESTAMP",
        path: ["assertedAt"],
        message: "Facts assertion timestamp cannot move batch updatedAt backwards in time."
      }
    ]);
  }

  const nextBatch: ProductBatch = Object.freeze({
    ...currentBatch,
    version: currentBatch.version + 1,
    currentFactsRevision: newFacts.revision,
    updatedAt: newFacts.assertedAt
  });

  return { previous: currentBatch, current: nextBatch };
}

/**
 * Pure availability / selectability guard (ADR §2.2 & U2).
 * Verifies ownership and active state across both batch and parent SKU.
 * Archived batches and batches under an archived SKU are unavailable for selection.
 */
export function isBatchSelectable(batch: ProductBatch, parentSku: ProductSku): boolean {
  return (
    batch.clientId === parentSku.clientId &&
    batch.skuId === parentSku.skuId &&
    batch.archivedAt === null &&
    parentSku.archivedAt === null
  );
}

export function assertBatchSelectable(batch: ProductBatch, parentSku: ProductSku): void {
  if (batch.clientId !== parentSku.clientId) {
    throw new CrossClientViolationError(
      `Cross-client violation: Batch client "${batch.clientId}" does not match SKU client "${parentSku.clientId}".`
    );
  }
  if (batch.skuId !== parentSku.skuId) {
    throw new CrossBatchSourceError(
      `Batch "${batch.batchId}" belongs to SKU "${batch.skuId}", not "${parentSku.skuId}".`
    );
  }
  if (parentSku.archivedAt !== null) {
    throw new AccessDeniedError(
      `Batch "${batch.batchId}" is unavailable because its parent SKU "${parentSku.skuId}" is archived.`,
      "ARCHIVED_ENTITY"
    );
  }
  if (batch.archivedAt !== null) {
    throw new AccessDeniedError(
      `Batch "${batch.batchId}" is archived and unavailable for selection.`,
      "ARCHIVED_ENTITY"
    );
  }
}

/**
 * Pure collision guard for client+SKU scoped lot identifiers (ADR §2.2).
 * Case-sensitive check; includes active AND archived reservations.
 */
export function assertNoLotCollision(
  lotIdentifier: string,
  existingLotsForSku: Iterable<string | ProductBatch>,
  skuId?: string
): void {
  const normalizedCandidate = normalizeLotIdentifier(lotIdentifier);
  for (const item of existingLotsForSku) {
    const existingCode = typeof item === "string" ? item : item.lotIdentifier;
    if (normalizeLotIdentifier(existingCode) === normalizedCandidate) {
      throw new DuplicateLotError(normalizedCandidate, skuId);
    }
  }
}
