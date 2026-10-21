import { describe, expect, it } from "vitest";
import {
  compareDecimalStrings,
  isContradictoryUnitTuple,
  isNegativeDecimal,
  isNonNegativeDecimal,
  isPercentInRange,
  isPositiveDecimal,
  isSupportedAnalyticalTuple,
  isValidAnalyteCode,
  isValidAnalyticalContextString,
  isValidDecimalString,
  isZeroDecimal,
  normalizeDecimalString
} from "./coa-measurement.js";

describe("DecimalString Lexical Validation", () => {
  it("accepts valid decimal strings with exact spelling", () => {
    expect(isValidDecimalString("0")).toBe(true);
    expect(isValidDecimalString("12")).toBe(true);
    expect(isValidDecimalString("24.5000")).toBe(true);
    expect(isValidDecimalString("-0.05")).toBe(true);
    expect(isValidDecimalString("-100")).toBe(true);
    expect(isValidDecimalString("12345678901234567890.12345678901234567890")).toBe(true);
  });

  it("rejects non-strings, numbers, whitespace, exponents, NaN, and commas", () => {
    expect(isValidDecimalString(12.5)).toBe(false);
    expect(isValidDecimalString(null)).toBe(false);
    expect(isValidDecimalString(undefined)).toBe(false);
    expect(isValidDecimalString(" 12.5 ")).toBe(false);
    expect(isValidDecimalString("1e-4")).toBe(false);
    expect(isValidDecimalString("1E5")).toBe(false);
    expect(isValidDecimalString("NaN")).toBe(false);
    expect(isValidDecimalString("Infinity")).toBe(false);
    expect(isValidDecimalString("1,000.00")).toBe(false);
    expect(isValidDecimalString("012.5")).toBe(false); // leading zeros forbidden
    expect(isValidDecimalString(".5")).toBe(false); // leading zero required before dot
    expect(isValidDecimalString("12.")).toBe(false); // trailing dot forbidden
    expect(isValidDecimalString("")).toBe(false);
  });

  it("normalizeDecimalString preserves exact spelling and trailing zeros", () => {
    expect(normalizeDecimalString("24.5000")).toBe("24.5000");
    expect(() => normalizeDecimalString("invalid")).toThrow(/Lexical validation failed/);
  });
});

describe("Decimal String Comparison (Pure BigInt/Lexical)", () => {
  it("correctly compares values with precision beyond IEEE-754", () => {
    const val1 = "100000000000000000000.00000000000000000001";
    const val2 = "100000000000000000000.00000000000000000002";
    expect(compareDecimalStrings(val1, val2)).toBe(-1);
    expect(compareDecimalStrings(val2, val1)).toBe(1);
    expect(compareDecimalStrings(val1, val1)).toBe(0);
  });

  it("handles different fractional lengths and trailing zeros", () => {
    expect(compareDecimalStrings("24.5", "24.5000")).toBe(0);
    expect(compareDecimalStrings("24.5001", "24.5000")).toBe(1);
    expect(compareDecimalStrings("24.4999", "24.5")).toBe(-1);
  });

  it("handles negative decimals and zero equivalents", () => {
    expect(compareDecimalStrings("-0.5", "0.5")).toBe(-1);
    expect(compareDecimalStrings("-10", "-5")).toBe(-1);
    expect(compareDecimalStrings("-5", "-10")).toBe(1);
    expect(compareDecimalStrings("-0", "0")).toBe(0);
    expect(compareDecimalStrings("-0.000", "0.00")).toBe(0);
  });

  it("evaluates signs correctly", () => {
    expect(isZeroDecimal("0.0000")).toBe(true);
    expect(isZeroDecimal("-0.0000")).toBe(true);
    expect(isZeroDecimal("0.0001")).toBe(false);

    expect(isPositiveDecimal("0.0001")).toBe(true);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("-1")).toBe(false);

    expect(isNegativeDecimal("-0.0001")).toBe(true);
    expect(isNegativeDecimal("0")).toBe(false);
    expect(isNegativeDecimal("-0.00")).toBe(false);

    expect(isNonNegativeDecimal("0")).toBe(true);
    expect(isNonNegativeDecimal("-0.00")).toBe(true);
    expect(isNonNegativeDecimal("12.5")).toBe(true);
    expect(isNonNegativeDecimal("-0.01")).toBe(false);
  });
});

describe("Percent and Fraction Bounds", () => {
  it("enforces exact 0..100 percent bounds", () => {
    expect(isPercentInRange("0")).toBe(true);
    expect(isPercentInRange("0.0000")).toBe(true);
    expect(isPercentInRange("100")).toBe(true);
    expect(isPercentInRange("100.000")).toBe(true);
    expect(isPercentInRange("50.25")).toBe(true);
    expect(isPercentInRange("-0.00001")).toBe(false);
    expect(isPercentInRange("100.00001")).toBe(false);
  });
});

describe("Unit & Quantity Kind Compatibility", () => {
  it("recognizes supported tuples", () => {
    expect(isSupportedAnalyticalTuple("percent_w_w", "mass_fraction")).toBe(true);
    expect(isSupportedAnalyticalTuple("mg_per_g", "mass_fraction")).toBe(true);
    expect(isSupportedAnalyticalTuple("mg_per_l", "mass_concentration")).toBe(true);
    expect(isSupportedAnalyticalTuple("percent_w_w", "volume_fraction")).toBe(false);
    expect(isSupportedAnalyticalTuple("ppm", "mass_fraction")).toBe(false);
  });

  it("detects contradictory unit tuples", () => {
    expect(isContradictoryUnitTuple("percent_w_w", "volume_fraction")).toBe(true);
    expect(isContradictoryUnitTuple("percent_w_w", "mass_concentration")).toBe(true);
    expect(isContradictoryUnitTuple("percent_w_w", "mass_fraction")).toBe(false);

    expect(isContradictoryUnitTuple("mg_per_g", "mass_concentration")).toBe(true);
    expect(isContradictoryUnitTuple("mg_per_g", "mass_fraction")).toBe(false);

    expect(isContradictoryUnitTuple("mg_per_l", "mass_fraction")).toBe(true);
    expect(isContradictoryUnitTuple("mg_per_l", "mass_concentration")).toBe(false);
  });
});

describe("Analyte Code and Context String Validation", () => {
  it("validates analyte code", () => {
    expect(isValidAnalyteCode("THCA")).toBe(true);
    expect(isValidAnalyteCode("d9-THC")).toBe(true);
    expect(isValidAnalyteCode("myrcene")).toBe(true);
    expect(isValidAnalyteCode("")).toBe(false);
    expect(isValidAnalyteCode("   ")).toBe(false);
    expect(isValidAnalyteCode("THC\x00A")).toBe(false);
  });

  it("validates analytical context strings", () => {
    expect(isValidAnalyticalContextString("dry_weight")).toBe(true);
    expect(isValidAnalyticalContextString("flower")).toBe(true);
    expect(isValidAnalyticalContextString("")).toBe(false);
    expect(isValidAnalyticalContextString("a".repeat(65))).toBe(false);
  });
});
