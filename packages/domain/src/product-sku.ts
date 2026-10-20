import {
  canonicalizeUtcTimestamp,
  compareUtcTimestamps,
  isValidCanonicalSku,
  isValidIsoUtcTimestamp,
  isValidPositiveInt,
  isValidUuid,
  MAX_POSITIVE_INT,
  normalizeCanonicalSku,
  normalizeDisplayName
} from "@cco/shared";
import type { IsoTimestampString } from "@cco/shared";
import type { ClientId, SkuId } from "./identifiers.js";
import {
  AccessDeniedError,
  CrossClientViolationError,
  DuplicateSkuError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";

/**
 * Pure domain model for commercial Product SKU (ADR 0009 §2.1 & §5).
 * Permanent tenant-scoped commercial identity for physical lots (batches).
 */
export interface ProductSku {
  readonly clientId: ClientId;
  readonly skuId: SkuId;
  readonly canonicalSku: string;
  readonly displayName: string;
  readonly version: number;
  readonly createdAt: IsoTimestampString;
  readonly updatedAt: IsoTimestampString;
  readonly archivedAt: IsoTimestampString | null;
}

export interface CreateProductSkuInput {
  readonly clientId: ClientId;
  readonly skuId: SkuId;
  readonly canonicalSku: string;
  readonly displayName: string;
  readonly timestamp: IsoTimestampString;
}

export interface UpdateProductSkuMetadataInput {
  readonly expectedVersion: number;
  readonly displayName: string;
  readonly updatedAt: IsoTimestampString;
}

export interface ArchiveProductSkuInput {
  readonly expectedVersion: number;
  readonly archivedAt: IsoTimestampString;
}

export interface ProductSkuTransitionResult {
  readonly previous: ProductSku;
  readonly current: ProductSku;
}

/**
 * Pure creation factory for ProductSku:
 * Always initializes at version 1, active (archivedAt: null), createdAt == updatedAt.
 */
export function createProductSku(input: CreateProductSkuInput): ProductSku {
  if (!isValidUuid(input.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "clientId must be a valid UUID string."
      }
    ]);
  }
  if (!isValidUuid(input.skuId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["skuId"],
        message: "skuId must be a valid UUID string."
      }
    ]);
  }

  let normalizedSku: string;
  try {
    normalizedSku = normalizeCanonicalSku(input.canonicalSku);
  } catch (err) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["canonicalSku"],
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

  return Object.freeze({
    clientId: input.clientId,
    skuId: input.skuId,
    canonicalSku: normalizedSku,
    displayName: normalizedName,
    version: 1,
    createdAt: canonicalTimestamp,
    updatedAt: canonicalTimestamp,
    archivedAt: null
  });
}

/**
 * Rehydrates a persisted or wire ProductSku record, verifying all invariants.
 */
export function rehydrateProductSku(raw: ProductSku): ProductSku {
  if (!isValidUuid(raw.clientId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["clientId"],
        message: "Invalid clientId UUID in SKU record."
      }
    ]);
  }
  if (!isValidUuid(raw.skuId)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["skuId"],
        message: "Invalid skuId UUID in SKU record."
      }
    ]);
  }
  if (!isValidCanonicalSku(raw.canonicalSku)) {
    throw new ProductValidationError([
      {
        code: "INVALID_IDENTIFIER",
        path: ["canonicalSku"],
        message: `canonicalSku "${raw.canonicalSku}" violates lexical rules.`
      }
    ]);
  }
  if (!isValidPositiveInt(raw.version)) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: `SKU version ${raw.version} must be a positive 32-bit INT.`
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
    skuId: raw.skuId,
    canonicalSku: raw.canonicalSku,
    displayName: normalizeDisplayName(raw.displayName, "displayName"),
    version: raw.version,
    createdAt: canonicalizeUtcTimestamp(raw.createdAt),
    updatedAt: canonicalizeUtcTimestamp(raw.updatedAt),
    archivedAt: raw.archivedAt !== null ? canonicalizeUtcTimestamp(raw.archivedAt) : null
  });
}

/**
 * Pure transition updating SKU display metadata.
 * Fenced by expectedVersion, increments version by 1, forbids mutation of archived heads.
 */
export function updateProductSkuMetadata(
  current: ProductSku,
  input: UpdateProductSkuMetadataInput
): ProductSkuTransitionResult {
  if (current.archivedAt !== null) {
    throw new AccessDeniedError(
      `Cannot modify archived SKU "${current.skuId}".`,
      "ARCHIVED_ENTITY"
    );
  }
  if (input.expectedVersion !== current.version) {
    throw new StaleRevisionConflictError("ProductSku", input.expectedVersion, current.version);
  }
  if (current.version >= MAX_POSITIVE_INT) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: "SKU version overflow: cannot increment beyond maximum positive INT."
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

  const next: ProductSku = Object.freeze({
    ...current,
    displayName: normalizedName,
    version: current.version + 1,
    updatedAt: canonicalUpdatedAt
  });

  return { previous: current, current: next };
}

/**
 * Pure transition archiving a ProductSku.
 * Terminal lifecycle operation: once archived, cannot be re-archived or modified.
 */
export function archiveProductSku(
  current: ProductSku,
  input: ArchiveProductSkuInput
): ProductSkuTransitionResult {
  if (current.archivedAt !== null) {
    throw new AccessDeniedError(`SKU "${current.skuId}" is already archived.`, "ARCHIVED_ENTITY");
  }
  if (input.expectedVersion !== current.version) {
    throw new StaleRevisionConflictError("ProductSku", input.expectedVersion, current.version);
  }
  if (current.version >= MAX_POSITIVE_INT) {
    throw new ProductValidationError([
      {
        code: "INVALID_REVISION",
        path: ["version"],
        message: "SKU version overflow: cannot increment beyond maximum positive INT."
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

  const next: ProductSku = Object.freeze({
    ...current,
    version: current.version + 1,
    updatedAt: canonicalArchivedAt,
    archivedAt: canonicalArchivedAt
  });

  return { previous: current, current: next };
}

/**
 * Pure guard checking whether a parent SKU can accept a new batch.
 */
export function assertSkuCanAcceptBatch(sku: ProductSku, expectedClientId?: ClientId): void {
  if (expectedClientId && sku.clientId !== expectedClientId) {
    throw new CrossClientViolationError(
      `Cross-client violation: SKU "${sku.skuId}" belongs to client "${sku.clientId}", not "${expectedClientId}".`
    );
  }
  if (sku.archivedAt !== null) {
    throw new AccessDeniedError(
      `SKU "${sku.skuId}" is archived and cannot accept new batches.`,
      "ARCHIVED_ENTITY"
    );
  }
}

/**
 * Pure collision guard for client-scoped canonical SKU codes (ADR §2.1).
 * Existing set must include active AND archived reservations.
 */
export function assertNoSkuCollision(
  canonicalSku: string,
  existingCanonicalSkus: Iterable<string | ProductSku>,
  clientId?: string
): void {
  const normalizedCandidate = normalizeCanonicalSku(canonicalSku);
  for (const item of existingCanonicalSkus) {
    const existingCode = typeof item === "string" ? item : item.canonicalSku;
    if (normalizeCanonicalSku(existingCode) === normalizedCandidate) {
      throw new DuplicateSkuError(normalizedCandidate, clientId);
    }
  }
}
