/**
 * Pure lexical constants, normalizers, and validators for product identity,
 * revisions, date/timestamp bounds, and error codes.
 *
 * Sink layer: zero dependencies on domain, contracts, or Node I/O.
 */

export const MIN_POSITIVE_INT = 1;
export const MAX_POSITIVE_INT = 2_147_483_647; // PostgreSQL 32-bit signed INT max

export const CANONICAL_SKU_REGEX = /^[A-Z0-9_-]{3,64}$/;
export const LOT_IDENTIFIER_REGEX = /^[A-Za-z0-9_.-]{1,128}$/;
export const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
export const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
export const ISO_UTC_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

export const BATCH_ORIGIN_KINDS = ["own_production", "partner_origin", "unknown"] as const;
export type BatchOriginKind = (typeof BATCH_ORIGIN_KINDS)[number];

export const PRODUCT_EVIDENCE_ERROR_CODES = [
  "NOT_FOUND",
  "CROSS_CLIENT_VIOLATION",
  "CROSS_BATCH_SOURCE",
  "DUPLICATE_SKU",
  "DUPLICATE_LOT",
  "STALE_REVISION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "SOURCE_SUPERSEDED",
  "SOURCE_INTEGRITY_MISMATCH",
  "MIME_CONFLICT",
  "MEASUREMENT_UNIT_REQUIRED",
  "INVALID_DECIMAL_FORMAT",
  "NON_MONOTONIC_REVISION",
  "CLAIM_SUPPORT_REQUIRED",
  "REPORT_DISPUTED",
  "ORIGIN_PROVENANCE_REQUIRED",
  "ACCESS_DENIED",
  "CONCURRENCY_CONFLICT",
  "QUOTA_EXCEEDED"
] as const;
export type ProductEvidenceErrorCode = (typeof PRODUCT_EVIDENCE_ERROR_CODES)[number];

export const PRODUCT_VALIDATION_ISSUE_CODES = [
  "INVALID_IDENTIFIER",
  "INVALID_TEXT",
  "INVALID_REVISION",
  "INVALID_TIMESTAMP",
  "INVALID_DATE",
  "INVALID_FIELD_COMBINATION",
  "UNKNOWN_FIELD"
] as const;
export type ProductValidationIssueCode = (typeof PRODUCT_VALIDATION_ISSUE_CODES)[number];

export interface ProductValidationIssue {
  readonly code: ProductValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type IsoTimestampString = string;
export type DateOnlyString = string;

/**
 * Checks for C0 and C1 controls (\p{Cc}) as well as invisible formatting controls (\p{Cf})
 * such as zero-width spaces, BOM, directional formatting isolates.
 */
export function hasControlOrInvisibleChars(str: string): boolean {
  return /[\p{Cc}\p{Cf}]/u.test(str);
}

/**
 * Validates whether a value is a standard RFC 4122 / RFC 9562 UUID string (v1-v8, including v4 and v7).
 * Rejects leading/trailing whitespace without silent trimming.
 */
export function isValidUuid(val: unknown): val is string {
  if (typeof val !== "string") {
    return false;
  }
  return UUID_REGEX.test(val);
}

/**
 * Normalizes a UUID string by verifying its format and converting to lowercase hex.
 * Throws a lexical error if invalid or if leading/trailing whitespace is present.
 */
export function normalizeUuid(val: unknown, fieldName = "id"): string {
  if (typeof val !== "string" || !UUID_REGEX.test(val)) {
    throw new Error(
      `Lexical validation failed for ${fieldName}: must be a valid UUIDv4 or UUIDv7 string with no surrounding whitespace.`
    );
  }
  return val.toLowerCase();
}

/**
 * Validates positive 32-bit signed integers (1 to 2,147,483,647).
 * Rejects non-integers, non-finite numbers, strings, zero, negative numbers, and overflow.
 */
export function isValidPositiveInt(val: unknown): val is number {
  return (
    typeof val === "number" &&
    Number.isInteger(val) &&
    val >= MIN_POSITIVE_INT &&
    val <= MAX_POSITIVE_INT
  );
}

/**
 * Validates real Gregorian calendar dates (year 0001–9999).
 * Correctly accounts for leap years and month day counts.
 */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonths[month - 1]!;
}

/**
 * Validates date-only string YYYY-MM-DD.
 */
export function isValidDateOnly(val: unknown): val is DateOnlyString {
  if (typeof val !== "string") {
    return false;
  }
  const match = DATE_ONLY_REGEX.exec(val);
  if (!match) {
    return false;
  }
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  return isValidCalendarDate(year, month, day);
}

/**
 * Validates UTC ISO 8601 timestamp string YYYY-MM-DDTHH:mm:ss[.sss]Z.
 * Rejects offsets, local time, and invalid calendar dates.
 */
export function isValidIsoUtcTimestamp(val: unknown): val is IsoTimestampString {
  if (typeof val !== "string") {
    return false;
  }
  const match = ISO_UTC_TIMESTAMP_REGEX.exec(val);
  if (!match) {
    return false;
  }
  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  if (!isValidCalendarDate(year, month, day)) {
    return false;
  }
  const hours = Number.parseInt(match[4]!, 10);
  const minutes = Number.parseInt(match[5]!, 10);
  const seconds = Number.parseInt(match[6]!, 10);
  return (
    hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59
  );
}

/**
 * Canonicalizes an ISO UTC timestamp to milliseconds precision: YYYY-MM-DDTHH:mm:ss.sssZ.
 */
export function canonicalizeUtcTimestamp(val: string): IsoTimestampString {
  if (!isValidIsoUtcTimestamp(val)) {
    throw new Error(
      `Lexical validation failed: timestamp must be a valid UTC ISO 8601 string (e.g. 2026-10-19T17:00:00.000Z).`
    );
  }
  const match = ISO_UTC_TIMESTAMP_REGEX.exec(val)!;
  const year = match[1]!;
  const month = match[2]!;
  const day = match[3]!;
  const hours = match[4]!;
  const minutes = match[5]!;
  const seconds = match[6]!;
  const fraction = match[7] ?? "";
  const paddedFraction = fraction.padEnd(3, "0").slice(0, 3);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${paddedFraction}Z`;
}

/**
 * Chronologically compares two canonical or valid UTC timestamps.
 * Returns negative if a < b, 0 if a == b, positive if a > b.
 */
export function compareUtcTimestamps(a: string, b: string): number {
  const ca = canonicalizeUtcTimestamp(a);
  const cb = canonicalizeUtcTimestamp(b);
  if (ca < cb) return -1;
  if (ca > cb) return 1;
  return 0;
}

/**
 * Chronologically compares two date-only strings (YYYY-MM-DD).
 */
export function compareDateOnly(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Normalizes canonicalSku according to ADR 0009 / U1:
 * - Reject control and invisible formatting characters first.
 * - Trim ordinary surrounding spaces.
 * - Validate ASCII input before uppercasing (prevents lookalike / expanding transforms).
 * - Uppercase ASCII a-z.
 * - Match ^[A-Z0-9_-]{3,64}$.
 */
export function normalizeCanonicalSku(val: unknown): string {
  if (typeof val !== "string") {
    throw new Error("canonicalSku must be a string");
  }
  if (hasControlOrInvisibleChars(val)) {
    throw new Error("canonicalSku contains illegal control or invisible formatting characters");
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    throw new Error("canonicalSku cannot be blank or whitespace-only");
  }
  // Require ASCII characters only before uppercasing
  if (!/^[\x20-\x7E]+$/.test(trimmed)) {
    throw new Error("canonicalSku must contain ASCII characters only");
  }
  const uppercased = trimmed.toUpperCase();
  if (!CANONICAL_SKU_REGEX.test(uppercased)) {
    throw new Error(
      `canonicalSku "${uppercased}" does not match required format ^[A-Z0-9_-]{3,64}$`
    );
  }
  return uppercased;
}

export function isValidCanonicalSku(val: unknown): val is string {
  try {
    normalizeCanonicalSku(val);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes lotIdentifier according to ADR 0009 / U1:
 * - Reject control and invisible formatting characters first.
 * - Trim ordinary surrounding spaces.
 * - Case-sensitive: preserve case!
 * - Match ^[A-Za-z0-9_.-]{1,128}$.
 */
export function normalizeLotIdentifier(val: unknown): string {
  if (typeof val !== "string") {
    throw new Error("lotIdentifier must be a string");
  }
  if (hasControlOrInvisibleChars(val)) {
    throw new Error("lotIdentifier contains illegal control or invisible formatting characters");
  }
  const trimmed = val.trim();
  if (trimmed.length === 0) {
    throw new Error("lotIdentifier cannot be blank or whitespace-only");
  }
  if (!LOT_IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(
      `lotIdentifier "${trimmed}" does not match required format ^[A-Za-z0-9_.-]{1,128}$`
    );
  }
  return trimmed;
}

export function isValidLotIdentifier(val: unknown): val is string {
  try {
    normalizeLotIdentifier(val);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes display names:
 * - Reject C0/C1 controls and invisible formatting controls.
 * - Trim ordinary surrounding spaces.
 * - Require 1–255 Unicode code points.
 * - Preserve internal spacing and case; no Unicode compatibility folding.
 */
export function normalizeDisplayName(val: unknown, fieldName = "displayName"): string {
  if (typeof val !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  if (hasControlOrInvisibleChars(val)) {
    throw new Error(`${fieldName} contains illegal control or invisible formatting characters`);
  }
  const trimmed = val.trim();
  const codePoints = Array.from(trimmed);
  if (codePoints.length < 1 || codePoints.length > 255) {
    throw new Error(
      `${fieldName} must be between 1 and 255 Unicode code points (found ${codePoints.length})`
    );
  }
  return trimmed;
}

export function isValidDisplayName(val: unknown): val is string {
  try {
    normalizeDisplayName(val);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes producer identity if supplied:
 * - Optional / nullable.
 * - Trimmed nonblank Unicode text 1–255 code points, no controls.
 */
export function normalizeProducerIdentity(val: unknown): string | null {
  if (val === null || val === undefined) {
    return null;
  }
  return normalizeDisplayName(val, "producerIdentityAsClaimed");
}

/**
 * Normalizes actor ID / assertedBy:
 * - Trimmed nonblank text 1–128 code points, no controls.
 */
export function normalizeAssertedBy(val: unknown, fieldName = "assertedBy"): string {
  if (typeof val !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  if (hasControlOrInvisibleChars(val)) {
    throw new Error(`${fieldName} contains illegal control or invisible formatting characters`);
  }
  const trimmed = val.trim();
  const codePoints = Array.from(trimmed);
  if (codePoints.length < 1 || codePoints.length > 128) {
    throw new Error(
      `${fieldName} must be between 1 and 128 Unicode code points (found ${codePoints.length})`
    );
  }
  return trimmed;
}
