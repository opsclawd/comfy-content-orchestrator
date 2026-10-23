import { describe, expect, it } from "vitest";
import { formatByteLength, formatExactDecimal, formatUtcDateTime } from "./format-decimal.js";

describe("format-decimal utilities", () => {
  describe("formatExactDecimal", () => {
    it("preserves trailing zeros in decimal strings", () => {
      expect(formatExactDecimal("24.5000")).toBe("24.5000");
      expect(formatExactDecimal("0.0010")).toBe("0.0010");
      expect(formatExactDecimal("100.0")).toBe("100.0");
    });

    it("handles integer strings and empty values", () => {
      expect(formatExactDecimal("25")).toBe("25");
      expect(formatExactDecimal("")).toBe("—");
      expect(formatExactDecimal("   ")).toBe("—");
    });
  });

  describe("formatByteLength", () => {
    it("formats 0 and small byte sizes", () => {
      expect(formatByteLength(0)).toBe("0 B");
      expect(formatByteLength(512)).toBe("512 B");
    });

    it("formats KiB, MiB, and GiB sizes with precision", () => {
      expect(formatByteLength(1024)).toBe("1.0 KiB");
      expect(formatByteLength(1024 * 1024)).toBe("1.00 MiB");
      expect(formatByteLength(1024 * 1024 * 5.5)).toBe("5.50 MiB");
      expect(formatByteLength(1024 * 1024 * 1024 * 2)).toBe("2.00 GiB");
    });

    it("handles negative or invalid values safely", () => {
      expect(formatByteLength(-5)).toBe("0 B");
      expect(formatByteLength(NaN)).toBe("0 B");
    });
  });

  describe("formatUtcDateTime", () => {
    it("formats standard ISO UTC timestamp into readable string with UTC suffix", () => {
      const formatted = formatUtcDateTime("2026-10-21T18:30:00.000Z");
      expect(formatted).toContain("2026");
      expect(formatted).toContain("UTC");
    });

    it("returns dash for null or undefined or invalid timestamp", () => {
      expect(formatUtcDateTime(null)).toBe("—");
      expect(formatUtcDateTime(undefined)).toBe("—");
      expect(formatUtcDateTime("invalid-date")).toBe("—");
    });
  });
});
