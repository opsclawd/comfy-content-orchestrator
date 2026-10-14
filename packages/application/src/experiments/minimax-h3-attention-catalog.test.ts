import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MINIMAX_H3_ATTENTION_CATALOG,
  getAttentionCatalogEntry,
  listAttentionCatalogEntries
} from "./minimax-h3-attention-catalog.js";
import {
  MinimaxH3AttentionCatalogEntrySchema,
  computeAttentionCatalogDigest
} from "@cco/contracts";

describe("MiniMax-H3 Attention Catalog", () => {
  it("provides valid catalog entries across i2v and ref2v routes", () => {
    const entries = listAttentionCatalogEntries();
    expect(entries).toHaveLength(16);

    for (const entry of entries) {
      // Validate schema
      const parsed = MinimaxH3AttentionCatalogEntrySchema.parse(entry);
      expect(parsed).toBeDefined();

      // Check digest matches computed digest
      const computedDigest = computeAttentionCatalogDigest(entry);
      expect(entry.catalogDigest).toBe(computedDigest);
    }
  });

  it("enforces explicit compatibility states per variant", () => {
    // Dense control is unverified pending target GPU environment inspection
    expect(getAttentionCatalogEntry("dense", "i2v").compatibilityState).toBe("unverified");
    expect(getAttentionCatalogEntry("dense", "ref2v").compatibilityState).toBe("unverified");

    // SageAttention is unverified on pinned core
    expect(getAttentionCatalogEntry("sage", "i2v").compatibilityState).toBe("unverified");
    expect(getAttentionCatalogEntry("sage", "ref2v").compatibilityState).toBe("unverified");

    // Native sol-attn requires isolated upgrade
    expect(getAttentionCatalogEntry("native-sol-attn", "i2v").compatibilityState).toBe(
      "requires_isolated_upgrade"
    );
    expect(getAttentionCatalogEntry("native-sol-attn", "ref2v").compatibilityState).toBe(
      "requires_isolated_upgrade"
    );

    // Veda requires isolated upgrade
    expect(getAttentionCatalogEntry("veda", "i2v").compatibilityState).toBe(
      "requires_isolated_upgrade"
    );
    expect(getAttentionCatalogEntry("veda", "ref2v").compatibilityState).toBe(
      "requires_isolated_upgrade"
    );
  });

  it("resolves matched dense control entries for apples-to-apples baseline comparisons", () => {
    const sageMatchedI2v = getAttentionCatalogEntry("dense", "i2v", { matchedVariant: "sage" });
    expect(sageMatchedI2v.scope).toBe("sage-matched-dense-attention-i2v");
    expect(sageMatchedI2v.pythonPackages.some((p) => p.name === "sageattention")).toBe(true);

    const solAttnMatchedRef2v = getAttentionCatalogEntry("dense", "ref2v", {
      matchedVariant: "native-sol-attn"
    });
    expect(solAttnMatchedRef2v.scope).toBe("sol-attn-matched-dense-attention-ref2v");
    expect(solAttnMatchedRef2v.pythonPackages.some((p) => p.name === "comfy-kitchen")).toBe(true);
    expect(solAttnMatchedRef2v.comfyuiCoreRevision).toBe(
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
    );

    const vedaMatchedI2v = getAttentionCatalogEntry("dense", "i2v", { matchedVariant: "veda" });
    expect(vedaMatchedI2v.scope).toBe("veda-matched-dense-attention-i2v");
    expect(vedaMatchedI2v.customNode?.name).toBe("Veda-on-ComfyUI");
    expect(vedaMatchedI2v.pythonPackages.some((p) => p.name === "triton")).toBe(true);
  });

  it("filters catalog entries by variant and route", () => {
    const sageEntries = listAttentionCatalogEntries({ variantName: "sage" });
    expect(sageEntries).toHaveLength(2);
    expect(sageEntries.map((e) => e.route).sort()).toEqual(["i2v", "ref2v"]);

    const ref2vEntries = listAttentionCatalogEntries({ route: "ref2v" });
    expect(ref2vEntries).toHaveLength(8);

    const i2vEntries = listAttentionCatalogEntries({ route: "i2v" });
    expect(i2vEntries).toHaveLength(8);
  });

  it("matches disk catalog.json file exactly", () => {
    const catalogJsonPath = path.resolve(
      process.cwd(),
      "experiments/minimax-h3-attention/catalog.json"
    );
    const content = fs.readFileSync(catalogJsonPath, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(MINIMAX_H3_ATTENTION_CATALOG);
  });

  it("throws when catalog entry is not found", () => {
    expect(() => getAttentionCatalogEntry("nonexistent" as unknown as "dense", "i2v")).toThrow();
  });
});
