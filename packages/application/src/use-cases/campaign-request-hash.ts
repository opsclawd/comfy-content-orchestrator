import type { CreativeBrief } from "@cco/contracts";
import type { ReferenceAssetId } from "@cco/domain";

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const val = record[key];
    if (val !== undefined) {
      result[key] = sortKeysDeep(val);
    }
  }
  return result;
}

export interface CampaignRequestHashInput {
  readonly clientId: string;
  readonly title: string;
  readonly targetPlatform?: string | undefined;
  readonly targetTotalDurationMs: number;
  readonly sceneCountOverride?: number | undefined;
  readonly brief?: CreativeBrief | undefined;
  readonly candidateReferenceAssetIds?: readonly ReferenceAssetId[] | readonly string[] | undefined;
}

export type OrchestrationRequestHashInput = CampaignRequestHashInput;

/**
 * Produces a canonical JSON string for campaign shell creation and orchestration requests.
 *
 * CRITICAL INVARIANT: This canonicalization operates strictly on the requested/declared
 * layer. It must ONLY be called with raw incoming request fields (including literal
 * sceneCountOverride, whether present or undefined). It must NEVER be called with
 * configured/executed fields (such as resolved totalScenes / N) substituted in place of
 * sceneCountOverride. Doing so would cause Auto-mode retries (where sceneCountOverride is undefined)
 * to produce mismatched hashes against stored configured state, falsely triggering 409 conflicts.
 *
 * Candidate reference assets are canonicalized deterministically using set/order equivalence
 * (deduplicated and sorted). Empty array and undefined both denote absence of assets to prevent
 * hash divergence across clients.
 */
export function canonicalizeCampaignRequest(input: CampaignRequestHashInput): string {
  let canonicalAssetIds: string[] | undefined = undefined;
  if (
    input.candidateReferenceAssetIds !== undefined &&
    input.candidateReferenceAssetIds.length > 0
  ) {
    const rawIds = Array.isArray(input.candidateReferenceAssetIds)
      ? (input.candidateReferenceAssetIds as readonly string[])
      : [];
    canonicalAssetIds = Array.from(new Set(rawIds)).sort();
  }

  const normalized = {
    clientId: input.clientId,
    title: input.title,
    ...(input.targetPlatform !== undefined ? { targetPlatform: input.targetPlatform } : {}),
    targetTotalDurationMs: input.targetTotalDurationMs,
    ...(input.sceneCountOverride !== undefined
      ? { sceneCountOverride: input.sceneCountOverride }
      : {}),
    ...(input.brief !== undefined ? { brief: input.brief } : {}),
    ...(canonicalAssetIds !== undefined ? { candidateReferenceAssetIds: canonicalAssetIds } : {})
  };
  return JSON.stringify(sortKeysDeep(normalized));
}

export const canonicalizeOrchestrationRequest = canonicalizeCampaignRequest;

/**
 * Computes a deterministic SHA-256 hex string over the canonicalized request fields.
 */
export async function computeCampaignRequestHash(input: CampaignRequestHashInput): Promise<string> {
  const canonical = canonicalizeCampaignRequest(input);
  const data = new TextEncoder().encode(canonical);
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const computeOrchestrationRequestHash = computeCampaignRequestHash;
