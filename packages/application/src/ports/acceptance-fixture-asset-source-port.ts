import type { AcceptanceAssetSlot } from "@cco/contracts";

/**
 * Narrow port for reading the bytes of a single, already-approved acceptance-campaign
 * fixture asset slot from its pinned, read-only source location (e.g. a file under
 * `certification/minimax-h3/...`). Implementations MUST be read-only: they never write,
 * copy, or mutate the underlying fixture file.
 *
 * This port intentionally knows nothing about campaigns, scenes, ShotPlans, production
 * attempts, or manifests — it only resolves bytes for a declared asset slot.
 */
export interface AcceptanceFixtureAssetBytes {
  readonly body: Buffer;
  readonly mimeType: string;
  readonly sha256: string;
}

export interface AcceptanceFixtureAssetSourcePort {
  readonly loadAssetBytes: (slot: AcceptanceAssetSlot) => Promise<AcceptanceFixtureAssetBytes>;
}
