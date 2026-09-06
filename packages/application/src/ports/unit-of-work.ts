import type { CampaignRecord, ClientRecord } from "@cco/domain";
import type { CampaignProductionRunRepository } from "./campaign-production-run-repository.js";
import type { CampaignRepository } from "./campaign-repository.js";
import type { ClientRepository } from "./client-repository.js";
import type { DeliveryAssemblyJobQueuePort } from "./delivery-assembly-job-queue-port.js";
import type { GenerationManifestRepository } from "./generation-manifest-repository.js";
import type { TransactionalJobEnqueuer } from "./job-queue-port.js";
import type { ReviewEventStore } from "./review-event-store.js";
import type { SceneRepository } from "./scene-repository.js";
import type { StoryboardCandidateRepository } from "./storyboard-candidate-repository.js";

export interface UnitOfWorkContext {
  readonly scenes: SceneRepository;
  readonly reviewEvents: ReviewEventStore;
  readonly candidates: StoryboardCandidateRepository;
  readonly campaigns?: CampaignRepository<CampaignRecord> | undefined;
  readonly clients?: ClientRepository<ClientRecord> | undefined;
  readonly jobs?: TransactionalJobEnqueuer | undefined;
  readonly campaignProductionRuns?: CampaignProductionRunRepository | undefined;
  readonly assemblyJobs?: Pick<DeliveryAssemblyJobQueuePort, "enqueue"> | undefined;
  readonly generationManifests?: GenerationManifestRepository | undefined;
}

export interface UnitOfWork {
  execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult>;
}
