import type { CampaignRecord, ClientRecord } from "@cco/domain";
import type { CampaignRepository } from "./campaign-repository.js";
import type { ClientRepository } from "./client-repository.js";
import type { ReviewEventStore } from "./review-event-store.js";
import type { SceneRepository } from "./scene-repository.js";
import type { StoryboardCandidateRepository } from "./storyboard-candidate-repository.js";

export interface UnitOfWorkContext {
  readonly scenes: SceneRepository;
  readonly reviewEvents: ReviewEventStore;
  readonly candidates: StoryboardCandidateRepository;
  readonly campaigns?: CampaignRepository<CampaignRecord> | undefined;
  readonly clients?: ClientRepository<ClientRecord> | undefined;
}

export interface UnitOfWork {
  execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult>;
}
