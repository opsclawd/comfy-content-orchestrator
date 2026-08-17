import type { CandidateId, StoryboardCandidate } from "@cco/domain";

export interface StoryboardCandidateRepository {
  findById(candidateId: CandidateId): Promise<StoryboardCandidate | undefined>;
  save(candidate: StoryboardCandidate): Promise<void>;
  findBySceneRevision(sceneId: string, revision: number): Promise<readonly StoryboardCandidate[]>;
}
