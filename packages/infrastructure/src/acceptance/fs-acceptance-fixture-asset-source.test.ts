import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCEPTANCE_CAMPAIGN_ASSET_SLOTS } from "@cco/contracts";
import { FsAcceptanceFixtureAssetSource } from "./fs-acceptance-fixture-asset-source.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");

describe("FsAcceptanceFixtureAssetSource", () => {
  it("reads real fixture bytes whose sha256 matches each asset slot's pinned hash", async () => {
    const source = new FsAcceptanceFixtureAssetSource({ repoRoot: REPO_ROOT });

    for (const slot of ACCEPTANCE_CAMPAIGN_ASSET_SLOTS) {
      const bytes = await source.loadAssetBytes(slot);
      expect(bytes.sha256).toBe(slot.sha256);
      expect(bytes.mimeType).toBe(slot.mimeType);
      expect(bytes.body.length).toBeGreaterThan(0);
    }
  });

  it("rejects when the source file does not exist", async () => {
    const source = new FsAcceptanceFixtureAssetSource({ repoRoot: REPO_ROOT });
    const missingSlot = {
      ...ACCEPTANCE_CAMPAIGN_ASSET_SLOTS[0]!,
      sourcePath: "certification/minimax-h3/minimax-ref2v-visual-qa-001/does-not-exist.jpg"
    };

    await expect(source.loadAssetBytes(missingSlot)).rejects.toThrow();
  });
});
