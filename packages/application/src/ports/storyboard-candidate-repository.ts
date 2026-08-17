import type { CandidateId, SceneId, StoryboardCandidate } from "@cco/domain";

export interface StoryboardCandidateRepository {
  findById(candidateId: CandidateId): Promise<StoryboardCandidate | undefined>;
  insert(candidate: StoryboardCandidate): Promise<void>;
  listBySceneAndRevision(
    sceneId: SceneId,
    specRevision: number
  ): Promise<readonly StoryboardCandidate[]>;
}
