import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AcceptanceFixtureAssetBytes,
  AcceptanceFixtureAssetSourcePort
} from "@cco/application";
import type { AcceptanceAssetSlot } from "@cco/contracts";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");

export interface FsAcceptanceFixtureAssetSourceOptions {
  /** Repository root used to resolve each asset slot's repo-relative `sourcePath`. */
  readonly repoRoot?: string | undefined;
}

/**
 * Read-only filesystem adapter for {@link AcceptanceFixtureAssetSourcePort}. Resolves an
 * asset slot's `sourcePath` (always rooted under the read-only
 * `certification/minimax-h3/...` fixture directory) and reads its bytes. Never writes,
 * copies, moves, or deletes anything under that path.
 */
export class FsAcceptanceFixtureAssetSource implements AcceptanceFixtureAssetSourcePort {
  private readonly repoRoot: string;

  constructor(options: FsAcceptanceFixtureAssetSourceOptions = {}) {
    this.repoRoot = options.repoRoot ?? DEFAULT_REPO_ROOT;
  }

  async loadAssetBytes(slot: AcceptanceAssetSlot): Promise<AcceptanceFixtureAssetBytes> {
    const absolutePath = resolve(this.repoRoot, slot.sourcePath);
    const body = await readFile(absolutePath);
    const sha256 = createHash("sha256").update(body).digest("hex");

    return {
      body,
      mimeType: slot.mimeType,
      sha256
    };
  }
}
