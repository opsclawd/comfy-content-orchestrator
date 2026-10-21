import type { ProductEvidenceErrorCode, ProductValidationIssue } from "@cco/shared";

/**
 * Base domain error for verified product and batch operations.
 * Implements stable ADR 0009 error codes.
 */
export class ProductEvidenceDomainError extends Error {
  override readonly name: string = "ProductEvidenceDomainError";

  constructor(
    public readonly code: ProductEvidenceErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>
  ) {
    super(message);
  }
}

/**
 * Thrown when lexical validation or field combination constraints are violated.
 */
export class ProductValidationError extends Error {
  override readonly name = "ProductValidationError";

  constructor(
    public readonly issues: readonly ProductValidationIssue[],
    message?: string
  ) {
    super(
      message ??
        `Validation failed: ${issues.map((i) => `[${i.code}] ${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  }
}

export class NotFoundError extends ProductEvidenceDomainError {
  override readonly name = "NotFoundError";

  constructor(entityName: string, id: string) {
    super("NOT_FOUND", `${entityName} with id "${id}" was not found.`);
  }
}

export class CrossClientViolationError extends ProductEvidenceDomainError {
  override readonly name = "CrossClientViolationError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CROSS_CLIENT_VIOLATION", message, details);
  }
}

export class CrossBatchSourceError extends ProductEvidenceDomainError {
  override readonly name = "CrossBatchSourceError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CROSS_BATCH_SOURCE", message, details);
  }
}

export class DuplicateSkuError extends ProductEvidenceDomainError {
  override readonly name = "DuplicateSkuError";

  constructor(canonicalSku: string, clientId?: string) {
    super(
      "DUPLICATE_SKU",
      `Canonical SKU "${canonicalSku}" already exists for client${clientId ? ` "${clientId}"` : ""}.`,
      clientId ? { clientId, canonicalSku } : { canonicalSku }
    );
  }
}

export class DuplicateLotError extends ProductEvidenceDomainError {
  override readonly name = "DuplicateLotError";

  constructor(lotIdentifier: string, skuId?: string) {
    super(
      "DUPLICATE_LOT",
      `Lot identifier "${lotIdentifier}" already exists for SKU${skuId ? ` "${skuId}"` : ""}.`,
      skuId ? { skuId, lotIdentifier } : { lotIdentifier }
    );
  }
}

export class StaleRevisionConflictError extends ProductEvidenceDomainError {
  override readonly name = "StaleRevisionConflictError";

  constructor(entityName: string, expectedVersion: number, actualVersion: number) {
    super(
      "STALE_REVISION_CONFLICT",
      `Stale revision conflict on ${entityName}: expected version ${expectedVersion} but found version ${actualVersion}.`,
      { expectedVersion, actualVersion }
    );
  }
}

export class NonMonotonicRevisionError extends ProductEvidenceDomainError {
  override readonly name = "NonMonotonicRevisionError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("NON_MONOTONIC_REVISION", message, details);
  }
}

export class AccessDeniedError extends ProductEvidenceDomainError {
  override readonly name = "AccessDeniedError";

  constructor(message: string, reason = "ACCESS_DENIED") {
    super("ACCESS_DENIED", message, { reason });
  }
}

export class ConcurrencyConflictError extends ProductEvidenceDomainError {
  override readonly name = "ConcurrencyConflictError";

  constructor(message: string) {
    super("CONCURRENCY_CONFLICT", message);
  }
}

export class IdempotencyConflictError extends ProductEvidenceDomainError {
  override readonly name = "IdempotencyConflictError";

  constructor(actionId: string) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `Command with actionId "${actionId}" was already processed with a different payload.`,
      { actionId }
    );
  }
}

export class SourceIntegrityMismatchError extends ProductEvidenceDomainError {
  override readonly name = "SourceIntegrityMismatchError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SOURCE_INTEGRITY_MISMATCH", message, details);
  }
}

export class MimeConflictError extends ProductEvidenceDomainError {
  override readonly name = "MimeConflictError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("MIME_CONFLICT", message, details);
  }
}

export class SourceSupersededError extends ProductEvidenceDomainError {
  override readonly name = "SourceSupersededError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SOURCE_SUPERSEDED", message, details);
  }
}

export class QuotaExceededError extends ProductEvidenceDomainError {
  override readonly name = "QuotaExceededError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("QUOTA_EXCEEDED", message, details);
  }
}

export class ReportDisputedError extends ProductEvidenceDomainError {
  override readonly name = "ReportDisputedError";

  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("REPORT_DISPUTED", message, details);
  }
}
