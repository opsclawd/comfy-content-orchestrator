import type { CandidateId, StoryboardCandidate } from "@cco/domain";

/**
 * Lookup port for storyboard candidates.
 *
 * Selection must never trust a caller-supplied scene ID or revision, so the
 * application layer loads the candidate through this port and reads its actual
 * `sceneId` and `specRevision`.
 *
 * Write and query members belong with the persistence work that needs them
 * (#39/#40). Adding them here speculatively — and optionally — produced a
 * review oscillation, because an optional member is simultaneously "declared,
 * so test it" and "unused, so remove it".
 */
export interface StoryboardCandidateRepository {
  findById(candidateId: CandidateId): Promise<StoryboardCandidate | undefined>;
}
