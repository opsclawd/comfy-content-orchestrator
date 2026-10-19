import { describe, expect, it } from "vitest";
import {
  canonicalizeUtcTimestamp,
  compareDateOnly,
  compareUtcTimestamps,
  hasControlOrInvisibleChars,
  isValidCalendarDate,
  isValidCanonicalSku,
  isValidDateOnly,
  isValidDisplayName,
  isValidIsoUtcTimestamp,
  isValidLotIdentifier,
  isValidPositiveInt,
  isValidUuid,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT,
  normalizeAssertedBy,
  normalizeCanonicalSku,
  normalizeDisplayName,
  normalizeLotIdentifier,
  normalizeProducerIdentity,
  normalizeUuid
} from "./product-identity.js";

describe("product-identity lexical functions", () => {
  describe("UUID validation and normalization", () => {
    it("accepts valid UUIDv4 and UUIDv7 strings", () => {
      const v4 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
      const v7 = "018f0000-0000-7000-8000-000000000001";
      expect(isValidUuid(v4)).toBe(true);
      expect(isValidUuid(v7)).toBe(true);
      expect(normalizeUuid(v4)).toBe(v4);
      expect(normalizeUuid(v7)).toBe(v7);
    });

    it("normalizes uppercase hex to lowercase", () => {
      const upper = "018F0000-0000-7000-8000-000000000001";
      expect(isValidUuid(upper)).toBe(true);
      expect(normalizeUuid(upper)).toBe("018f0000-0000-7000-8000-000000000001");
    });

    it("rejects UUIDs with leading or trailing whitespace without silent trimming", () => {
      const padded = " 018f0000-0000-7000-8000-000000000001 ";
      expect(isValidUuid(padded)).toBe(false);
      expect(() => normalizeUuid(padded)).toThrow();
    });

    it("rejects non-UUID strings and malformed shapes", () => {
      expect(isValidUuid("not-a-uuid")).toBe(false);
      expect(isValidUuid("018f0000000070008000000000000001")).toBe(false);
      expect(isValidUuid("")).toBe(false);
      expect(isValidUuid(null)).toBe(false);
    });
  });

  describe("canonicalSku normalization and validation", () => {
    it("trims ordinary surrounding spaces and uppercases ascii", () => {
      expect(normalizeCanonicalSku("  sku-indica-01  ")).toBe("SKU-INDICA-01");
      expect(normalizeCanonicalSku("abc")).toBe("ABC");
      expect(isValidCanonicalSku("  sku-indica-01  ")).toBe(true);
    });

    it("is idempotent", () => {
      const initial = "  sku-indica-01  ";
      const norm1 = normalizeCanonicalSku(initial);
      const norm2 = normalizeCanonicalSku(norm1);
      expect(norm2).toBe(norm1);
    });

    it("enforces length bounds (3 to 64)", () => {
      // 2 chars -> reject
      expect(() => normalizeCanonicalSku("AB")).toThrow();
      expect(isValidCanonicalSku("AB")).toBe(false);

      // 3 chars -> accept
      expect(normalizeCanonicalSku("ABC")).toBe("ABC");

      // 64 chars -> accept
      const exact64 = "A".repeat(64);
      expect(normalizeCanonicalSku(exact64)).toBe(exact64);

      // 65 chars -> reject
      const tooLong = "A".repeat(65);
      expect(() => normalizeCanonicalSku(tooLong)).toThrow();
      expect(isValidCanonicalSku(tooLong)).toBe(false);
    });

    it("rejects embedded spaces and invalid separator characters", () => {
      expect(() => normalizeCanonicalSku("SKU 01")).toThrow();
      expect(() => normalizeCanonicalSku("SKU/01")).toThrow();
      expect(() => normalizeCanonicalSku("SKU\\01")).toThrow();
      expect(() => normalizeCanonicalSku("SKU.01")).toThrow(); // dot not allowed in SKU
    });

    it("rejects blank and whitespace-only strings", () => {
      expect(() => normalizeCanonicalSku("")).toThrow();
      expect(() => normalizeCanonicalSku("   ")).toThrow();
    });

    it("rejects controls and invisible characters", () => {
      expect(hasControlOrInvisibleChars("\t")).toBe(true);
      expect(hasControlOrInvisibleChars("\n")).toBe(true);
      expect(hasControlOrInvisibleChars("\u200B")).toBe(true);
      expect(hasControlOrInvisibleChars("normal text")).toBe(false);
      expect(() => normalizeCanonicalSku("\tSKU-01")).toThrow();
      expect(() => normalizeCanonicalSku("SKU-01\n")).toThrow();
      expect(() => normalizeCanonicalSku("\u200BSKU-01")).toThrow();
    });

    it("rejects non-ASCII characters and Unicode lookalikes before uppercasing", () => {
      // German sharp S 'ß' expands to 'SS' in uppercase if converted carelessly
      expect(() => normalizeCanonicalSku("sku-ß")).toThrow();
      // Cyrillic lookalike 'А' (U+0410)
      expect(() => normalizeCanonicalSku("\u0410BC-01")).toThrow();
    });
  });

  describe("lotIdentifier normalization and validation", () => {
    it("preserves case and trims ordinary surrounding spaces", () => {
      expect(normalizeLotIdentifier("  LOT-2026.Ind_042  ")).toBe("LOT-2026.Ind_042");
      expect(isValidLotIdentifier("  LOT-2026.Ind_042  ")).toBe(true);
    });

    it("is idempotent", () => {
      const initial = "  LOT-2026.Ind_042  ";
      const norm1 = normalizeLotIdentifier(initial);
      const norm2 = normalizeLotIdentifier(norm1);
      expect(norm2).toBe(norm1);
    });

    it("enforces length bounds (1 to 128)", () => {
      // 0 chars (after trim) -> reject
      expect(() => normalizeLotIdentifier("")).toThrow();
      expect(() => normalizeLotIdentifier("   ")).toThrow();

      // 1 char -> accept
      expect(normalizeLotIdentifier("A")).toBe("A");

      // 128 chars -> accept
      const exact128 = "L" + "a".repeat(127);
      expect(normalizeLotIdentifier(exact128)).toBe(exact128);

      // 129 chars -> reject
      const tooLong = "L" + "a".repeat(128);
      expect(() => normalizeLotIdentifier(tooLong)).toThrow();
      expect(isValidLotIdentifier(tooLong)).toBe(false);
    });

    it("allows letters, digits, underscore, dot, hyphen", () => {
      expect(normalizeLotIdentifier("lot_1.2-beta")).toBe("lot_1.2-beta");
    });

    it("rejects illegal characters like spaces, slashes, controls", () => {
      expect(() => normalizeLotIdentifier("LOT 01")).toThrow();
      expect(() => normalizeLotIdentifier("LOT/01")).toThrow();
      expect(() => normalizeLotIdentifier("LOT\\01")).toThrow();
      expect(() => normalizeLotIdentifier("\tLOT-01")).toThrow();
      expect(() => normalizeLotIdentifier("LOT-01\u200B")).toThrow();
    });
  });

  describe("displayName normalization and validation", () => {
    it("preserves internal spaces and case without compatibility folding", () => {
      const name = "  Aurora Indica 3.5g (Batch #1)  ";
      expect(normalizeDisplayName(name)).toBe("Aurora Indica 3.5g (Batch #1)");
      expect(isValidDisplayName(name)).toBe(true);
    });

    it("counts Unicode code points accurately (e.g. emoji)", () => {
      const emojiName = "🌿 Cannabis Extract";
      expect(normalizeDisplayName(emojiName)).toBe(emojiName);
    });

    it("enforces bounds (1 to 255 code points)", () => {
      expect(() => normalizeDisplayName("")).toThrow();
      expect(() => normalizeDisplayName("   ")).toThrow();

      const exact255 = "x".repeat(255);
      expect(normalizeDisplayName(exact255)).toBe(exact255);

      const tooLong = "x".repeat(256);
      expect(() => normalizeDisplayName(tooLong)).toThrow();
    });

    it("rejects C0/C1 and formatting controls", () => {
      expect(() => normalizeDisplayName("Name\tWith\tTab")).toThrow();
      expect(() => normalizeDisplayName("Name\nWith\nNewline")).toThrow();
      expect(() => normalizeDisplayName("Name\u200BWithZeroWidth")).toThrow();
      expect(() => normalizeDisplayName("Name\uFEFFWithBom")).toThrow();
    });
  });

  describe("producerIdentity and assertedBy", () => {
    it("handles producerIdentity as nullable or nonblank text", () => {
      expect(normalizeProducerIdentity(null)).toBeNull();
      expect(normalizeProducerIdentity(undefined)).toBeNull();
      expect(normalizeProducerIdentity("  Acme Farms Ltd.  ")).toBe("Acme Farms Ltd.");
      expect(() => normalizeProducerIdentity("   ")).toThrow();
    });

    it("handles assertedBy nonblank text 1–128 code points", () => {
      expect(normalizeAssertedBy("  admin@example.com  ")).toBe("admin@example.com");
      expect(() => normalizeAssertedBy("")).toThrow();
      expect(() => normalizeAssertedBy("   ")).toThrow();
      expect(() => normalizeAssertedBy("a".repeat(129))).toThrow();
    });
  });

  describe("positive INT limits", () => {
    it("accepts valid positive integers within 32-bit signed range", () => {
      expect(isValidPositiveInt(1)).toBe(true);
      expect(isValidPositiveInt(MIN_POSITIVE_INT)).toBe(true);
      expect(isValidPositiveInt(MAX_POSITIVE_INT)).toBe(true);
    });

    it("rejects 0, negative, fractional, overflow and strings", () => {
      expect(isValidPositiveInt(0)).toBe(false);
      expect(isValidPositiveInt(-1)).toBe(false);
      expect(isValidPositiveInt(1.5)).toBe(false);
      expect(isValidPositiveInt(MAX_POSITIVE_INT + 1)).toBe(false);
      expect(isValidPositiveInt(Number.POSITIVE_INFINITY)).toBe(false);
      expect(isValidPositiveInt(Number.NaN)).toBe(false);
      expect(isValidPositiveInt("1")).toBe(false);
    });
  });

  describe("calendar dates and date-only strings", () => {
    it("accurately validates leap years and day counts", () => {
      expect(isValidCalendarDate(2024, 2, 29)).toBe(true); // 2024 leap year
      expect(isValidCalendarDate(2023, 2, 29)).toBe(false); // 2023 non-leap
      expect(isValidCalendarDate(1900, 2, 29)).toBe(false); // 1900 century non-leap
      expect(isValidCalendarDate(2000, 2, 29)).toBe(true); // 2000 400-yr leap
      expect(isValidCalendarDate(2024, 4, 31)).toBe(false); // April has 30 days
      expect(isValidCalendarDate(2024, 12, 31)).toBe(true);
    });

    it("validates DateOnlyString (YYYY-MM-DD)", () => {
      expect(isValidDateOnly("2026-05-15")).toBe(true);
      expect(isValidDateOnly("2024-02-29")).toBe(true);
      expect(isValidDateOnly("2023-02-29")).toBe(false);
      expect(isValidDateOnly("2026-00-15")).toBe(false);
      expect(isValidDateOnly("2026-13-15")).toBe(false);
      expect(isValidDateOnly("not-a-date")).toBe(false);
    });

    it("chronologically compares DateOnlyString values", () => {
      expect(compareDateOnly("2026-01-01", "2026-01-02")).toBe(-1);
      expect(compareDateOnly("2026-01-02", "2026-01-01")).toBe(1);
      expect(compareDateOnly("2026-01-01", "2026-01-01")).toBe(0);
    });
  });

  describe("UTC ISO timestamps", () => {
    it("validates and canonicalizes UTC timestamps ending in Z", () => {
      expect(isValidIsoUtcTimestamp("2026-10-19T17:14:00Z")).toBe(true);
      expect(isValidIsoUtcTimestamp("2026-10-19T17:14:00.123Z")).toBe(true);
      expect(isValidIsoUtcTimestamp("2026-10-19T17:14:00.1Z")).toBe(true);

      expect(canonicalizeUtcTimestamp("2026-10-19T17:14:00Z")).toBe("2026-10-19T17:14:00.000Z");
      expect(canonicalizeUtcTimestamp("2026-10-19T17:14:00.1Z")).toBe("2026-10-19T17:14:00.100Z");
      expect(canonicalizeUtcTimestamp("2026-10-19T17:14:00.123Z")).toBe("2026-10-19T17:14:00.123Z");
    });

    it("rejects non-UTC timestamps and local offsets", () => {
      expect(isValidIsoUtcTimestamp("2026-10-19T17:14:00+02:00")).toBe(false);
      expect(isValidIsoUtcTimestamp("2026-10-19T17:14:00-05:00")).toBe(false);
      expect(isValidIsoUtcTimestamp("2026-10-19T17:14:00")).toBe(false);
    });

    it("rejects invalid calendar dates in timestamps", () => {
      expect(isValidIsoUtcTimestamp("2023-02-29T12:00:00Z")).toBe(false);
      expect(isValidIsoUtcTimestamp("2026-04-31T12:00:00Z")).toBe(false);
    });

    it("chronologically compares UTC timestamps", () => {
      expect(compareUtcTimestamps("2026-10-19T17:00:00Z", "2026-10-19T17:00:01Z")).toBe(-1);
      expect(compareUtcTimestamps("2026-10-19T17:00:01Z", "2026-10-19T17:00:00Z")).toBe(1);
      expect(compareUtcTimestamps("2026-10-19T17:00:00Z", "2026-10-19T17:00:00.000Z")).toBe(0);
    });
  });
});
