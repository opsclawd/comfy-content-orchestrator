import { describe, expect, it } from "vitest";
import {
  listTeaCacheCatalogEntries,
  getTeaCacheCatalogEntry
} from "./minimax-h3-teacache-catalog.js";

describe("minimax-h3-teacache-catalog", () => {
  it("lists all entries and filters by route", () => {
    const all = listTeaCacheCatalogEntries();
    expect(all.length).toBe(4);

    const i2vOnly = listTeaCacheCatalogEntries({ route: "i2v" });
    expect(i2vOnly.length).toBe(2);
    expect(i2vOnly.every((e) => e.route === "i2v")).toBe(true);

    const ref2vOnly = listTeaCacheCatalogEntries({ route: "ref2v" });
    expect(ref2vOnly.length).toBe(2);
    expect(ref2vOnly.every((e) => e.route === "ref2v")).toBe(true);
  });

  it("filters by variant name", () => {
    const candidates = listTeaCacheCatalogEntries({ variantName: "teacache-raw-l1" });
    expect(candidates.length).toBe(2);
    expect(candidates.every((e) => e.variantName === "teacache-raw-l1")).toBe(true);

    const controls = listTeaCacheCatalogEntries({ variantName: "matched-control" });
    expect(controls.length).toBe(2);
    expect(controls.every((e) => e.variantName === "matched-control")).toBe(true);
  });

  it("gets entry by name and route", () => {
    const entry = getTeaCacheCatalogEntry("teacache-raw-l1", "i2v");
    expect(entry.variantName).toBe("teacache-raw-l1");
    expect(entry.route).toBe("i2v");
    expect(entry.supportedThresholds).toEqual([0.05, 0.1, 0.15]);
    expect(entry.stepWindow.requiredTotalSteps).toBe(20);
    expect(entry.catalogDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves 'off' as matched-control", () => {
    const entry = getTeaCacheCatalogEntry("off", "ref2v");
    expect(entry.variantName).toBe("matched-control");
    expect(entry.route).toBe("ref2v");
  });

  it("throws when entry is not found", () => {
    expect(() =>
      // @ts-expect-error test invalid variant name
      getTeaCacheCatalogEntry("unknown-variant", "i2v")
    ).toThrow(/No TeaCache catalog entry found/);
  });
});
