/**
 * Pure lexical constants, normalizers, and validators for CoA measurements,
 * decimal strings, quantity-kind compatibility, and analytical qualifiers.
 *
 * Sink layer: zero dependencies on domain, contracts, or Node I/O.
 */

import { hasControlOrInvisibleChars, type DateOnlyString } from "./product-identity.js";

export const DECIMAL_STRING_REGEX = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export declare const DecimalStringBrand: unique symbol;
export type DecimalString = string & { readonly [DecimalStringBrand]: true };

export const COA_COMPLETENESS_STATUSES = ["draft", "complete"] as const;
export type CoaCompletenessStatus = (typeof COA_COMPLETENESS_STATUSES)[number];

export const COA_SCOPE_KINDS = ["sample_only", "attributed_lot"] as const;
export type CoaScopeKind = (typeof COA_SCOPE_KINDS)[number];

export const COA_RESULT_KINDS = ["quantified", "below_limit", "not_detected"] as const;
export type CoaResultKind = (typeof COA_RESULT_KINDS)[number];

export const COA_RESULT_QUALIFIERS = ["lt", "lte"] as const;
export type CoaResultQualifier = (typeof COA_RESULT_QUALIFIERS)[number];

export const COA_REVIEW_DECISIONS = ["approved", "rejected"] as const;
export type CoaReviewDecision = (typeof COA_REVIEW_DECISIONS)[number];

export const COA_REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type CoaReviewStatus = (typeof COA_REVIEW_STATUSES)[number];

export const COA_ANALYTICAL_QUALIFIERS = ["negative_as_reported"] as const;
export type CoaAnalyticalQualifier = (typeof COA_ANALYTICAL_QUALIFIERS)[number];

/**
 * Validates whether a value is a strict DecimalString conforming to ADR 0009 grammar:
 * - Optional leading minus sign.
 * - Zero alone or non-zero-leading integer digits (no leading zeros like "007").
 * - Optional period followed by one or more fractional digits.
 * Rejects numbers, exponent notation (e.g. 1e-4), NaN, Infinity, commas, surrounding or internal whitespace.
 */
export function isValidDecimalString(val: unknown): val is DecimalString {
  if (typeof val !== "string") {
    return false;
  }
  return DECIMAL_STRING_REGEX.test(val);
}

/**
 * Normalizes a DecimalString. Rejects non-strings, whitespace, exponents, or malformed syntax.
 * Preserves exact string spelling including trailing zeros.
 */
export function normalizeDecimalString(val: unknown, fieldName = "decimal"): DecimalString {
  if (typeof val !== "string") {
    throw new Error(
      `Lexical validation failed for ${fieldName}: must be a decimal string conforming to ^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$`
    );
  }
  if (!DECIMAL_STRING_REGEX.test(val)) {
    throw new Error(
      `Lexical validation failed for ${fieldName}: "${val}" is not a valid decimal string.`
    );
  }
  return val as DecimalString;
}

interface ParsedDecimalParts {
  readonly isNegative: boolean;
  readonly isZero: boolean;
  readonly integerPart: string;
  readonly fractionPart: string;
}

function parseDecimalParts(str: string): ParsedDecimalParts {
  if (!DECIMAL_STRING_REGEX.test(str)) {
    throw new Error(`Cannot parse invalid decimal string: "${str}"`);
  }
  let s = str;
  let isNegative = false;
  if (s.startsWith("-")) {
    isNegative = true;
    s = s.slice(1);
  }
  const dotIdx = s.indexOf(".");
  let integerPart: string;
  let fractionPart: string;
  if (dotIdx === -1) {
    integerPart = s;
    fractionPart = "";
  } else {
    integerPart = s.slice(0, dotIdx);
    fractionPart = s.slice(dotIdx + 1);
  }

  // Check if value is numerically zero
  const isZero =
    BigInt(integerPart) === 0n && (fractionPart.length === 0 || /^0+$/.test(fractionPart));

  return {
    isNegative: isZero ? false : isNegative,
    isZero,
    integerPart,
    fractionPart
  };
}

/**
 * Exact decimal string comparison. Zero IEEE-754 precision loss.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareDecimalStrings(a: string, b: string): number {
  const pa = parseDecimalParts(a);
  const pb = parseDecimalParts(b);

  if (pa.isZero && pb.isZero) {
    return 0;
  }

  if (pa.isNegative && !pb.isNegative) {
    return -1;
  }
  if (!pa.isNegative && pb.isNegative) {
    return 1;
  }

  // Both have same sign
  const signMultiplier = pa.isNegative ? -1 : 1;

  // Compare integer parts
  const intA = BigInt(pa.integerPart);
  const intB = BigInt(pb.integerPart);
  if (intA < intB) {
    return -1 * signMultiplier;
  }
  if (intA > intB) {
    return 1 * signMultiplier;
  }

  // Integer parts equal, compare fractional parts by padding to equal length with trailing zeros
  const maxFracLen = Math.max(pa.fractionPart.length, pb.fractionPart.length);
  const fracA = pa.fractionPart.padEnd(maxFracLen, "0");
  const fracB = pb.fractionPart.padEnd(maxFracLen, "0");

  if (fracA < fracB) {
    return -1 * signMultiplier;
  }
  if (fracA > fracB) {
    return 1 * signMultiplier;
  }

  return 0;
}

export function isZeroDecimal(val: string): boolean {
  const p = parseDecimalParts(val);
  return p.isZero;
}

export function isPositiveDecimal(val: string): boolean {
  const p = parseDecimalParts(val);
  return !p.isZero && !p.isNegative;
}

export function isNegativeDecimal(val: string): boolean {
  const p = parseDecimalParts(val);
  return !p.isZero && p.isNegative;
}

export function isNonNegativeDecimal(val: string): boolean {
  const p = parseDecimalParts(val);
  return p.isZero || !p.isNegative;
}

/**
 * Checks if decimal value is within 0 <= val <= 100.
 */
export function isPercentInRange(val: string): boolean {
  if (!DECIMAL_STRING_REGEX.test(val)) {
    return false;
  }
  return compareDecimalStrings(val, "0") >= 0 && compareDecimalStrings(val, "100") <= 0;
}

/**
 * Checks if decimal value is within 0 <= val <= 1.
 */
export function isNormalizedFractionInRange(val: string): boolean {
  if (!DECIMAL_STRING_REGEX.test(val)) {
    return false;
  }
  return compareDecimalStrings(val, "0") >= 0 && compareDecimalStrings(val, "1") <= 0;
}

/**
 * Supported analytical tuples for source-support resolution (KTD2).
 */
export interface SupportedAnalyticalTuple {
  readonly unit: string;
  readonly quantityKind: string;
}

export const SUPPORTED_ANALYTICAL_TUPLES: readonly SupportedAnalyticalTuple[] = [
  { unit: "percent_w_w", quantityKind: "mass_fraction" },
  { unit: "mg_per_g", quantityKind: "mass_fraction" },
  { unit: "mg_per_l", quantityKind: "mass_concentration" }
];

export function isSupportedAnalyticalTuple(unit: string, quantityKind: string): boolean {
  const u = unit.trim();
  const qk = quantityKind.trim();
  return SUPPORTED_ANALYTICAL_TUPLES.some((t) => t.unit === u && t.quantityKind === qk);
}

/**
 * Checks if unit and quantityKind are inherently contradictory.
 * Known contradictory combinations are rejected at ingestion in every report state (KTD2).
 */
export function isContradictoryUnitTuple(unit: string, quantityKind: string): boolean {
  const u = unit.trim().toLowerCase();
  const qk = quantityKind.trim().toLowerCase();

  // percent_w_w is strictly mass_fraction
  if (u === "percent_w_w" && qk !== "mass_fraction") {
    return true;
  }
  // percent_v_v is strictly volume_fraction
  if (u === "percent_v_v" && qk !== "volume_fraction") {
    return true;
  }
  // mg_per_g and g_per_kg are mass fractions
  if (
    (u === "mg_per_g" || u === "g_per_kg") &&
    (qk === "volume_fraction" || qk === "mass_concentration")
  ) {
    return true;
  }
  // mg_per_l, ug_per_ml, etc. are concentrations
  if (
    (u === "mg_per_l" || u === "ug_per_ml" || u === "mg_per_ml") &&
    (qk === "mass_fraction" || qk === "volume_fraction")
  ) {
    return true;
  }
  return false;
}

/**
 * Validates analyte / parameter string:
 * - Non-empty trimmed text (1–128 chars).
 * - No C0/C1 or invisible controls.
 */
export function isValidAnalyteCode(val: unknown): val is string {
  if (typeof val !== "string") {
    return false;
  }
  if (hasControlOrInvisibleChars(val)) {
    return false;
  }
  const trimmed = val.trim();
  return trimmed.length >= 1 && trimmed.length <= 128;
}

/**
 * Validates analytical context string (e.g. basis, context, unit, quantityKind):
 * - Non-empty trimmed text (1–64 chars).
 * - No C0/C1 or invisible controls.
 */
export function isValidAnalyticalContextString(val: unknown): val is string {
  if (typeof val !== "string") {
    return false;
  }
  if (hasControlOrInvisibleChars(val)) {
    return false;
  }
  const trimmed = val.trim();
  return trimmed.length >= 1 && trimmed.length <= 64;
}

/**
 * Compares two date-only strings YYYY-MM-DD.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareCoaDates(a: DateOnlyString, b: DateOnlyString): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
