import type {
  H3CandidateExecutionSpecification,
  H3CandidateProfile,
  H3ProfileFrameCapability
} from "./h3-candidate-profile.js";

export interface H3CapabilityResolverReader {
  getCandidateProfile?(key: string | undefined): Readonly<H3CandidateProfile> | undefined;
  getReleasedProfile?(
    key: string | undefined
  ): Readonly<{ key: string; specification: H3CandidateExecutionSpecification }> | undefined;
  getProfileCapability?(key: string | undefined): H3ProfileFrameCapability | undefined;
  resolveH3ProfileFrameCapabilities?(key: string | undefined): H3ProfileFrameCapability | undefined;
}

/**
 * Immutable accepted candidate catalog.
 * Starts with exactly zero accepted candidates: zero accepted candidates is the complete initial state.
 *
 * GOVERNANCE INVARIANT:
 * No registration function, mutable backing map, or synthetic bypass flag (e.g. allowSynthetic)
 * is exported from production contracts or reachable by callers.
 */
const ACCEPTED_H3_CANDIDATE_CATALOG: Readonly<Record<string, Readonly<H3CandidateProfile>>> =
  Object.freeze(Object.create(null));

/**
 * Recognizes and retrieves an accepted MiniMax-H3 candidate profile by key.
 * Returns undefined if key is unrecognized or not admitted to the accepted catalog.
 */
export function getH3CandidateProfile(
  key: string | undefined
): Readonly<H3CandidateProfile> | undefined {
  if (!key) return undefined;
  return ACCEPTED_H3_CANDIDATE_CATALOG[key];
}

/**
 * Lists all currently accepted MiniMax-H3 candidate profiles.
 * In the initial state before operator #445 empirical acceptance, this returns an empty array.
 */
export function listH3CandidateProfiles(): readonly Readonly<H3CandidateProfile>[] {
  return Object.freeze([]);
}

/**
 * Returns true if the key identifies an accepted MiniMax-H3 candidate profile.
 */
export function isH3CandidateProfileKey(key: string | undefined): boolean {
  if (!key) return false;
  return Object.prototype.hasOwnProperty.call(ACCEPTED_H3_CANDIDATE_CATALOG, key);
}

/**
 * Resolves profile-scoped frame capabilities for MiniMax-H3 profiles and accepted candidates.
 *
 * Invariant:
 * - Legacy profiles resolve strictly to [124] frames.
 * - Candidates resolve strictly to their accepted exact frame count if registered.
 * - Unrecognized or unadmitted profiles resolve to undefined.
 * - No interpolation, model advertising, or range expansion is permitted.
 */
export function resolveH3ProfileFrameCapabilities(
  profileKeyOrId: string | undefined,
  reader?: H3CapabilityResolverReader | undefined
): H3ProfileFrameCapability | undefined {
  if (!profileKeyOrId) return undefined;
  const normalized = profileKeyOrId.toLowerCase().trim();

  // Legacy I2V profile & aliases (1344x768, 24fps, [124])
  if (
    normalized === "minimax_h3_720p_5s_i2v_v1" ||
    normalized === "minimax-h3-720p-5s-i2v-v1" ||
    normalized === "minimax-h3-720p-124f-i2v" ||
    normalized === "minimax_h3_i2v" ||
    normalized === "minimax-h3-i2v" ||
    normalized === "minimax_h3" ||
    normalized === "minimax-h3" ||
    normalized === "minimax-h3-720p@certified-v1"
  ) {
    return Object.freeze({
      profileKey: "MINIMAX_H3_720P_5S_I2V_V1",
      route: "i2v",
      routingMode: "frame_anchored",
      width: 1344,
      height: 768,
      fps: 24,
      allowedFrameCounts: Object.freeze([124]),
      isAllowedFrameCount: (f: number) => f === 124
    });
  }

  // Legacy Ref2V profile & aliases (1344x768, 24fps, [124])
  if (
    normalized === "minimax_h3_720p_5s_ref2v_v1" ||
    normalized === "minimax-h3-720p-5s-ref2v-v1" ||
    normalized === "minimax-h3-720p-124f-ref2v" ||
    normalized === "minimax_h3_ref2v" ||
    normalized === "minimax-h3-ref2v"
  ) {
    return Object.freeze({
      profileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
      route: "ref2v",
      routingMode: "reference_directed",
      width: 1344,
      height: 768,
      fps: 24,
      allowedFrameCounts: Object.freeze([124]),
      isAllowedFrameCount: (f: number) => f === 124
    });
  }

  if (reader?.getProfileCapability) {
    const directCap = reader.getProfileCapability(profileKeyOrId);
    if (directCap) return directCap;
  }

  if (reader?.resolveH3ProfileFrameCapabilities) {
    const directCap = reader.resolveH3ProfileFrameCapabilities(profileKeyOrId);
    if (directCap) return directCap;
  }

  if (reader?.getReleasedProfile) {
    const release = reader.getReleasedProfile(profileKeyOrId);
    if (release) {
      const frames = release.specification.frames;
      return Object.freeze({
        profileKey: release.key,
        route: release.specification.route,
        routingMode: release.specification.routingMode,
        width: release.specification.width,
        height: release.specification.height,
        fps: release.specification.fps,
        allowedFrameCounts: Object.freeze([frames]),
        isAllowedFrameCount: (f: number) => f === frames
      });
    }
  }

  // Candidate profile lookup in reader or shared accepted catalog
  const candidate = reader?.getCandidateProfile
    ? reader.getCandidateProfile(profileKeyOrId)
    : getH3CandidateProfile(profileKeyOrId);
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
}

/**
 * Returns true if the exact frameCount is allowlisted for the specified profile.
 */
export function isFrameCountAllowedForH3Profile(
  profileKeyOrId: string | undefined,
  frameCount: number,
  reader?: H3CapabilityResolverReader | undefined
): boolean {
  const capability = resolveH3ProfileFrameCapabilities(profileKeyOrId, reader);
  if (!capability) return false;
  return capability.isAllowedFrameCount(frameCount);
}
