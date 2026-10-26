import type { CampaignRecord, ClientRecord } from "@cco/domain";
import type { CampaignProductionRunRepository } from "./campaign-production-run-repository.js";
import type { CampaignReferenceBibleRepository } from "./campaign-reference-bible-repository.js";
import type { CampaignRepository } from "./campaign-repository.js";
import type { ClientRepository } from "./client-repository.js";
import type { DeliveryAssemblyJobQueuePort } from "./delivery-assembly-job-queue-port.js";
import type { GenerationManifestRepository } from "./generation-manifest-repository.js";
import type { TransactionalJobEnqueuer } from "./job-queue-port.js";
import type { ReferenceAssetRepository } from "./reference-asset-repository.js";
import type { ReferenceGroupRepository } from "./reference-group-repository.js";
import type { ProductEvidenceRepositoryPort } from "./product-evidence-repository.js";
import type { EvidenceAssetRepositoryPort } from "./evidence-asset-repository.js";
import type { CoaReportRepositoryPort } from "./coa-report-repository.js";
import type { ProductClaimRepositoryPort } from "./product-claim-repository.js";
import type { CampaignDurationPlanRepository } from "./campaign-duration-plan-repository.js";
import type {
  AcceptanceAssemblyJobQueuePort,
  AcceptanceAssemblyManifestRepository,
  OperatorAcceptanceRunRepository
} from "./operator-acceptance-ports.js";
import type { DeploymentEnablementStatePort } from "./production-release-ports.js";
import type { ReviewEventStore } from "./review-event-store.js";
import type { SceneRepository } from "./scene-repository.js";
import type { ShotPlanRepository } from "./shot-plan-repository.js";
import type { StoryboardCandidateRepository } from "./storyboard-candidate-repository.js";

export interface UnitOfWorkContext {
  readonly scenes: SceneRepository;
  readonly reviewEvents: ReviewEventStore;
  readonly candidates: StoryboardCandidateRepository;
  readonly shotPlans?: ShotPlanRepository | undefined;
  readonly campaigns?: CampaignRepository<CampaignRecord> | undefined;
  readonly clients?: ClientRepository<ClientRecord> | undefined;
  readonly jobs?: TransactionalJobEnqueuer | undefined;
  readonly campaignProductionRuns?: CampaignProductionRunRepository | undefined;
  readonly assemblyJobs?: Pick<DeliveryAssemblyJobQueuePort, "enqueue"> | undefined;
  readonly generationManifests?: GenerationManifestRepository | undefined;
  readonly referenceAssets?: ReferenceAssetRepository | undefined;
  readonly referenceGroups?: ReferenceGroupRepository | undefined;
  readonly campaignReferenceBible?: CampaignReferenceBibleRepository | undefined;
  readonly productEvidence?: ProductEvidenceRepositoryPort | undefined;
  readonly evidenceAsset?: EvidenceAssetRepositoryPort | undefined;
  readonly coaReports?: CoaReportRepositoryPort | undefined;
  readonly productClaims?: ProductClaimRepositoryPort | undefined;
  readonly durationPlans?: CampaignDurationPlanRepository | undefined;
  readonly operatorAcceptanceRuns?: OperatorAcceptanceRunRepository | undefined;
  readonly acceptanceAssemblyJobs?: AcceptanceAssemblyJobQueuePort | undefined;
  readonly acceptanceAssemblyManifests?: AcceptanceAssemblyManifestRepository | undefined;
  readonly deploymentEnablement?: DeploymentEnablementStatePort | undefined;
}

export interface UnitOfWork {
  execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult>;
}
