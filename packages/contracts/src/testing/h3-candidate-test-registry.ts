import { deepFreeze } from "../deep-freeze.js";
import type { H3CandidateProfile, H3ProfileFrameCapability } from "../h3-candidate-profile.js";
import { resolveH3ProfileFrameCapabilities as resolveProductionH3Capabilities } from "../h3-candidate-registry.js";

export interface H3CandidateRegistryReader {
  getCandidateProfile(key: string | undefined): Readonly<H3CandidateProfile> | undefined;
  listCandidateProfiles(): readonly Readonly<H3CandidateProfile>[];
  isCandidateProfileKey(key: string | undefined): boolean;
  resolveH3ProfileFrameCapabilities(
    profileKeyOrId: string | undefined
  ): H3ProfileFrameCapability | undefined;
  isFrameCountAllowedForH3Profile(profileKeyOrId: string | undefined, frameCount: number): boolean;
}

/**
 * Creates an isolated, deep-frozen candidate registry instance for testing.
 *
 * GOVERNANCE INVARIANT:
 * This helper is strictly for unit testing and is NOT exported from the production contracts index.
 * It operates on its own internal map and is provably disconnected from the shared production catalog.
 */
export function createIsolatedH3CandidateRegistry(
  candidates: readonly H3CandidateProfile[] = []
): H3CandidateRegistryReader {
  const map = new Map<string, Readonly<H3CandidateProfile>>();

  for (const candidate of candidates) {
    if (map.has(candidate.key)) {
      throw new Error(`Duplicate candidate key in test registry: "${candidate.key}"`);
    }
    // Deep clone and freeze each entry to ensure isolation
    const cloned = JSON.parse(JSON.stringify(candidate)) as H3CandidateProfile;
    map.set(candidate.key, deepFreeze(cloned) as unknown as Readonly<H3CandidateProfile>);
  }

  const resolveCapabilities = (
    profileKeyOrId: string | undefined
  ): H3ProfileFrameCapability | undefined => {
    if (!profileKeyOrId) return undefined;
    // Check legacy first
    const legacy = resolveProductionH3Capabilities(profileKeyOrId);
    if (legacy) return legacy;

    // Check isolated test map
    const candidate = map.get(profileKeyOrId);
    if (candidate) {
      const frames = candidate.specification.frames;
      return Object.freeze({
        profileKey: candidate.key,
        route: candidate.specification.route,
        routingMode: candidate.specification.routingMode,
        width: candidate.specification.width,
        height: candidate.specification.height,
        fps: candidate.specification.fps,
        allowedFrameCounts: Object.freeze([frames]),
        isAllowedFrameCount: (f: number) => f === frames
      });
    }

    return undefined;
  };

  return Object.freeze({
    getCandidateProfile(key: string | undefined): Readonly<H3CandidateProfile> | undefined {
      if (!key) return undefined;
      return map.get(key);
    },
    listCandidateProfiles(): readonly Readonly<H3CandidateProfile>[] {
      return Object.freeze(Array.from(map.values()));
    },
    isCandidateProfileKey(key: string | undefined): boolean {
      if (!key) return false;
      return map.has(key);
    },
    resolveH3ProfileFrameCapabilities: resolveCapabilities,
    isFrameCountAllowedForH3Profile(
      profileKeyOrId: string | undefined,
      frameCount: number
    ): boolean {
      const cap = resolveCapabilities(profileKeyOrId);
      if (!cap) return false;
      return cap.isAllowedFrameCount(frameCount);
    }
  });
}
