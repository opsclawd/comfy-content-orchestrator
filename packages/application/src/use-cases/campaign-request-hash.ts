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
}

/**
 * Produces a canonical JSON string for campaign shell creation requests.
 *
 * CRITICAL INVARIANT: This canonicalization operates strictly on the requested/declared
 * layer. It must ONLY be called with raw incoming request fields (including literal
 * sceneCountOverride, whether present or undefined). It must NEVER be called with
 * configured/executed fields (such as resolved totalScenes / N) substituted in place of
 * sceneCountOverride. Doing so would cause Auto-mode retries (where sceneCountOverride is undefined)
 * to produce mismatched hashes against stored configured state, falsely triggering 409 conflicts.
 */
export function canonicalizeCampaignRequest(input: CampaignRequestHashInput): string {
  const normalized = {
    clientId: input.clientId,
    title: input.title,
    ...(input.targetPlatform !== undefined ? { targetPlatform: input.targetPlatform } : {}),
    targetTotalDurationMs: input.targetTotalDurationMs,
    ...(input.sceneCountOverride !== undefined
      ? { sceneCountOverride: input.sceneCountOverride }
      : {})
  };
  return JSON.stringify(sortKeysDeep(normalized));
}

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
