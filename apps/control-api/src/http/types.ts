import type { FastifyRequest } from "fastify";
import {
  CreateCampaignUseCase,
  CreateClientUseCase,
  CreateSceneUseCase,
  EnforceStorageAdmission,
  EnqueueSceneProductionRenderUseCase,
  PlanCampaignBeatSheetUseCase,
  PlanSceneConfigurationUseCase,
  ProgressSceneProductionUseCases,
  RankReviewCandidatesUseCase,
  ReviewSceneUseCases,
  SubmitSceneCreationUseCase,
  ApproveSceneAndDispatchCampaignProductionUseCase,
  CompleteCampaignProductionRunUseCases,
  CompleteCampaignProductionRunAssemblyUseCases,
  type DeliveryAssemblyJobQueuePort,
  type JobQueuePort,
  type PlanningModelClientPort,
  type RankingModelClientPort,
  type ReferenceAssetRepository,
  type RenderEnginePort,
  type ReviewMediaDeliveryPort,
  type SceneReviewQueries,
  type StorageMetricsRegistryPort,
  type StorageTelemetryPort,
  type UnitOfWork
} from "@cco/application";

export interface ControlApiDependencies {
  readonly uow: UnitOfWork;
  readonly renderEngine?: RenderEnginePort;
  readonly sceneReviewQueries?: SceneReviewQueries;
  readonly reviewMediaDelivery?: ReviewMediaDeliveryPort;
  readonly storageTelemetry?: StorageTelemetryPort;
  readonly storageMetricsRegistry?: StorageMetricsRegistryPort;
  readonly jobQueue?: JobQueuePort;
  readonly deliveryAssemblyJobQueue?: DeliveryAssemblyJobQueuePort;
  readonly planningModelClients?: {
    readonly primary: PlanningModelClientPort;
    readonly fallback: PlanningModelClientPort;
  };
  readonly candidateRankerClients?: {
    readonly primary: RankingModelClientPort;
    readonly fallback: RankingModelClientPort;
  };
  readonly referenceAssetRepository?: ReferenceAssetRepository;
  readonly planningOverallTimeoutMs?: number;
  readonly rankingOverallTimeoutMs?: number;
}

export interface ControlApiUseCases {
  readonly reviewScene: ReviewSceneUseCases;
  readonly progressSceneProduction: ProgressSceneProductionUseCases;
  readonly enqueueSceneProductionRender?: EnqueueSceneProductionRenderUseCase | undefined;
  readonly createCampaign?: CreateCampaignUseCase | undefined;
  readonly createClient?: CreateClientUseCase | undefined;
  readonly createScene?: CreateSceneUseCase | undefined;
  readonly submitSceneCreation?: SubmitSceneCreationUseCase | undefined;
  readonly planCampaignBeatSheet?: PlanCampaignBeatSheetUseCase | undefined;
  readonly rankReviewCandidates?: RankReviewCandidatesUseCase | undefined;
  readonly enforceStorageAdmission?: EnforceStorageAdmission;
  readonly approveSceneAndDispatchCampaignProduction: ApproveSceneAndDispatchCampaignProductionUseCase;
  readonly completeCampaignProductionRun: CompleteCampaignProductionRunUseCases;
  readonly completeCampaignProductionRunAssembly: CompleteCampaignProductionRunAssemblyUseCases;
}

export interface ControlApiQueries {
  readonly sceneReview?: SceneReviewQueries;
}

export interface ControlApiContainer {
  readonly dependencies: ControlApiDependencies;
  readonly useCases: ControlApiUseCases;
  readonly queries: ControlApiQueries;
}

export function createControlApiContainer(
  dependencies: ControlApiDependencies
): ControlApiContainer {
  const reviewScene = new ReviewSceneUseCases(dependencies.uow);
  const progressSceneProduction = new ProgressSceneProductionUseCases(
    dependencies.uow,
    dependencies.renderEngine,
    dependencies.jobQueue
  );
  const enqueueSceneProductionRender = new EnqueueSceneProductionRenderUseCase(dependencies.uow);
  const createCampaign = new CreateCampaignUseCase(dependencies.uow);
  const createClient = new CreateClientUseCase(dependencies.uow);
  const createScene = new CreateSceneUseCase(dependencies.uow);
  const approveSceneAndDispatchCampaignProduction =
    new ApproveSceneAndDispatchCampaignProductionUseCase(
      dependencies.uow,
      enqueueSceneProductionRender
    );
  const completeCampaignProductionRun = new CompleteCampaignProductionRunUseCases(dependencies.uow);
  const completeCampaignProductionRunAssembly = new CompleteCampaignProductionRunAssemblyUseCases(
    dependencies.uow
  );
  const planSceneConfiguration =
    dependencies.planningModelClients && dependencies.referenceAssetRepository
      ? new PlanSceneConfigurationUseCase({
          primaryClient: dependencies.planningModelClients.primary,
          fallbackClient: dependencies.planningModelClients.fallback,
          referenceAssetRepository: dependencies.referenceAssetRepository,
          ...(dependencies.planningOverallTimeoutMs !== undefined
            ? { overallTimeoutMs: dependencies.planningOverallTimeoutMs }
            : {})
        })
      : undefined;

  const planCampaignBeatSheet =
    dependencies.planningModelClients && dependencies.referenceAssetRepository
      ? new PlanCampaignBeatSheetUseCase({
          uow: dependencies.uow,
          primaryClient: dependencies.planningModelClients.primary,
          fallbackClient: dependencies.planningModelClients.fallback,
          referenceAssetRepository: dependencies.referenceAssetRepository,
          ...(dependencies.planningOverallTimeoutMs !== undefined
            ? { overallTimeoutMs: dependencies.planningOverallTimeoutMs }
            : {})
        })
      : undefined;

  const submitSceneCreation = new SubmitSceneCreationUseCase({
    uow: dependencies.uow,
    createScene,
    ...(planSceneConfiguration ? { planSceneConfiguration } : {})
  });

  const enforceStorageAdmission = dependencies.storageTelemetry
    ? new EnforceStorageAdmission({
        telemetryPort: dependencies.storageTelemetry,
        ...(dependencies.storageMetricsRegistry
          ? { metricsRegistry: dependencies.storageMetricsRegistry }
          : {})
      })
    : undefined;

  const rankReviewCandidates = dependencies.uow
    ? new RankReviewCandidatesUseCase({
        uow: dependencies.uow,
        candidateRanker: dependencies.candidateRankerClients
          ? {
              primaryClient: dependencies.candidateRankerClients.primary,
              fallbackClient: dependencies.candidateRankerClients.fallback,
              ...(dependencies.rankingOverallTimeoutMs !== undefined
                ? { overallTimeoutMs: dependencies.rankingOverallTimeoutMs }
                : {})
            }
          : undefined
      })
    : undefined;

  return {
    dependencies,
    useCases: {
      reviewScene,
      progressSceneProduction,
      enqueueSceneProductionRender,
      createCampaign,
      createClient,
      createScene,
      submitSceneCreation,
      approveSceneAndDispatchCampaignProduction,
      completeCampaignProductionRun,
      completeCampaignProductionRunAssembly,
      ...(planCampaignBeatSheet !== undefined ? { planCampaignBeatSheet } : {}),
      ...(enforceStorageAdmission !== undefined ? { enforceStorageAdmission } : {}),
      ...(rankReviewCandidates !== undefined ? { rankReviewCandidates } : {})
    },
    queries: {
      ...(dependencies.sceneReviewQueries !== undefined
        ? { sceneReview: dependencies.sceneReviewQueries }
        : {})
    }
  };
}

export interface ReviewerIdentityResolver {
  resolve(request: FastifyRequest): Promise<string> | string;
}

export interface Clock {
  now(): string;
}

export type ControlApiHttpLogLevel =
  "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface ControlApiAppOptions {
  readonly reviewerIdentityResolver?: ReviewerIdentityResolver;
  readonly clock?: Clock;
  readonly logger?: boolean | { readonly level: ControlApiHttpLogLevel };
  readonly jobDispatch?: {
    readonly leaseDurationMs: number;
    readonly heartbeatIntervalMs: number;
  };
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString()
};
