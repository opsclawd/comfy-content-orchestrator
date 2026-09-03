import type { CampaignRecord } from "@cco/domain";
import type { CampaignRepository } from "./campaign-repository.js";
import type { ReviewEventStore } from "./review-event-store.js";
import type { SceneRepository } from "./scene-repository.js";
import type { StoryboardCandidateRepository } from "./storyboard-candidate-repository.js";

export interface UnitOfWorkContext {
  readonly scenes: SceneRepository;
  readonly reviewEvents: ReviewEventStore;
  readonly candidates: StoryboardCandidateRepository;
  readonly campaigns?: CampaignRepository<CampaignRecord> | undefined;
}

export interface UnitOfWork {
  execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult>;
}
