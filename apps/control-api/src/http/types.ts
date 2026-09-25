import type { FastifyRequest } from "fastify";
import {
  CreateCampaignUseCase,
  CreateCampaignShellUseCase,
  CreateClientUseCase,
  CreateSceneUseCase,
  EnforceStorageAdmission,
  EnqueueSceneProductionRenderUseCase,
  MaterializeStoryboardUseCase,
  PlanCampaignBeatSheetUseCase,
  PlanCampaignStoryboardUseCase,
  PlanSceneConfigurationUseCase,
  ProgressSceneProductionUseCases,
  RankReviewCandidatesUseCase,
  ReviewSceneUseCases,
  ProductionReviewUseCases,
  SubmitSceneCreationUseCase,
  ApproveSceneAndDispatchCampaignProductionUseCase,
  CompleteCampaignProductionRunUseCases,
  CompleteCampaignProductionRunAssemblyUseCases,
  ResolveCampaignDeliveryReelUseCase,
  UploadReferenceAssetUseCase,
  ListClientReferencesUseCase,
  ArchiveReferenceAssetUseCase,
  UpdateReferenceAssetRoleUseCase,
  type CampaignDeliveryReelQueries,
  type ClientContextResolver,
  type CurrentProductionAttemptQueries,
  type DeliveryAssemblyJobQueuePort,
  type ImageInspectionPort,
  type JobQueuePort,
  type ObjectStoragePort,
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
import { SharpImageInspectionAdapter } from "@cco/infrastructure";

export interface ControlApiDependencies {
  readonly uow: UnitOfWork;
  readonly renderEngine?: RenderEnginePort;
  readonly sceneReviewQueries?: SceneReviewQueries;
  readonly currentProductionAttemptQueries?: CurrentProductionAttemptQueries;
  readonly campaignDeliveryReelQueries?: CampaignDeliveryReelQueries;
  readonly objectStorage?: ObjectStoragePort;
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
  readonly imageValidator?: ImageInspectionPort;
  readonly planningOverallTimeoutMs?: number;
  readonly rankingOverallTimeoutMs?: number;
}

export interface ControlApiUseCases {
  readonly reviewScene: ReviewSceneUseCases;
  readonly productionReview: ProductionReviewUseCases;
  readonly progressSceneProduction: ProgressSceneProductionUseCases;
  readonly enqueueSceneProductionRender?: EnqueueSceneProductionRenderUseCase | undefined;
  readonly createCampaign?: CreateCampaignUseCase | undefined;
  readonly createCampaignShell?: CreateCampaignShellUseCase | undefined;
  readonly createClient?: CreateClientUseCase | undefined;
  readonly createScene?: CreateSceneUseCase | undefined;
  readonly submitSceneCreation?: SubmitSceneCreationUseCase | undefined;
  readonly materializeStoryboard?: MaterializeStoryboardUseCase | undefined;
  readonly planCampaignBeatSheet?: PlanCampaignBeatSheetUseCase | undefined;
  readonly planCampaignStoryboard?: PlanCampaignStoryboardUseCase | undefined;
  readonly rankReviewCandidates?: RankReviewCandidatesUseCase | undefined;
  readonly enforceStorageAdmission?: EnforceStorageAdmission;
  readonly approveSceneAndDispatchCampaignProduction: ApproveSceneAndDispatchCampaignProductionUseCase;
  readonly completeCampaignProductionRun: CompleteCampaignProductionRunUseCases;
  readonly completeCampaignProductionRunAssembly: CompleteCampaignProductionRunAssemblyUseCases;
  readonly resolveCampaignDeliveryReel?: ResolveCampaignDeliveryReelUseCase | undefined;
  readonly uploadReferenceAsset?: UploadReferenceAssetUseCase | undefined;
  readonly listClientReferences?: ListClientReferencesUseCase | undefined;
  readonly archiveReferenceAsset?: ArchiveReferenceAssetUseCase | undefined;
  readonly updateReferenceAssetRole?: UpdateReferenceAssetRoleUseCase | undefined;
}

export interface ControlApiQueries {
  readonly sceneReview?: SceneReviewQueries;
  readonly currentProductionAttempt?: CurrentProductionAttemptQueries;
  readonly campaignDeliveryReel?: CampaignDeliveryReelQueries;
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
  const enqueueSceneProductionRender = new EnqueueSceneProductionRenderUseCase(dependencies.uow);
  const productionReview = new ProductionReviewUseCases(
    dependencies.uow,
    enqueueSceneProductionRender
  );
  const progressSceneProduction = new ProgressSceneProductionUseCases(
    dependencies.uow,
    dependencies.renderEngine,
    dependencies.jobQueue
  );
  const createCampaign = new CreateCampaignUseCase(dependencies.uow);
  const createCampaignShell = new CreateCampaignShellUseCase(dependencies.uow);
  const createClient = new CreateClientUseCase(dependencies.uow);
  const createScene = new CreateSceneUseCase(dependencies.uow);
  const materializeStoryboard = new MaterializeStoryboardUseCase(
    dependencies.uow,
    progressSceneProduction
  );
  const approveSceneAndDispatchCampaignProduction =
    new ApproveSceneAndDispatchCampaignProductionUseCase(
      dependencies.uow,
      enqueueSceneProductionRender
    );
  const completeCampaignProductionRun = new CompleteCampaignProductionRunUseCases(dependencies.uow);
  const completeCampaignProductionRunAssembly = new CompleteCampaignProductionRunAssemblyUseCases(
    dependencies.uow
  );
  const resolveCampaignDeliveryReel =
    dependencies.campaignDeliveryReelQueries &&
    dependencies.objectStorage &&
    dependencies.reviewMediaDelivery
      ? new ResolveCampaignDeliveryReelUseCase({
          queries: dependencies.campaignDeliveryReelQueries,
          objectStorage: dependencies.objectStorage,
          mediaDelivery: dependencies.reviewMediaDelivery
        })
      : undefined;
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

  const planCampaignStoryboard =
    planCampaignBeatSheet !== undefined && planSceneConfiguration !== undefined
      ? new PlanCampaignStoryboardUseCase({
          createCampaignShell,
          planCampaignBeatSheet,
          planSceneConfiguration,
          materializeStoryboard,
          uow: dependencies.uow,
          ...(dependencies.referenceAssetRepository
            ? { referenceAssetRepository: dependencies.referenceAssetRepository }
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

  const uploadReferenceAsset =
    dependencies.referenceAssetRepository && dependencies.objectStorage
      ? new UploadReferenceAssetUseCase({
          referenceAssetRepository: dependencies.referenceAssetRepository,
          objectStorage: dependencies.objectStorage,
          imageValidator: dependencies.imageValidator ?? new SharpImageInspectionAdapter(),
          mediaDelivery: dependencies.reviewMediaDelivery
        })
      : undefined;

  const listClientReferences = dependencies.referenceAssetRepository
    ? new ListClientReferencesUseCase({
        referenceAssetRepository: dependencies.referenceAssetRepository,
        mediaDelivery: dependencies.reviewMediaDelivery
      })
    : undefined;

  const archiveReferenceAsset = dependencies.referenceAssetRepository
    ? new ArchiveReferenceAssetUseCase(dependencies.referenceAssetRepository)
    : undefined;

  const updateReferenceAssetRole = dependencies.referenceAssetRepository
    ? new UpdateReferenceAssetRoleUseCase({
        referenceAssetRepository: dependencies.referenceAssetRepository,
        mediaDelivery: dependencies.reviewMediaDelivery
      })
    : undefined;

  return {
    dependencies,
    useCases: {
      reviewScene,
      productionReview,
      progressSceneProduction,
      enqueueSceneProductionRender,
      createCampaign,
      createCampaignShell,
      createClient,
      createScene,
      submitSceneCreation,
      materializeStoryboard,
      approveSceneAndDispatchCampaignProduction,
      completeCampaignProductionRun,
      completeCampaignProductionRunAssembly,
      ...(resolveCampaignDeliveryReel !== undefined ? { resolveCampaignDeliveryReel } : {}),
      ...(planCampaignBeatSheet !== undefined ? { planCampaignBeatSheet } : {}),
      ...(planCampaignStoryboard !== undefined ? { planCampaignStoryboard } : {}),
      ...(enforceStorageAdmission !== undefined ? { enforceStorageAdmission } : {}),
      ...(rankReviewCandidates !== undefined ? { rankReviewCandidates } : {}),
      ...(uploadReferenceAsset !== undefined ? { uploadReferenceAsset } : {}),
      ...(listClientReferences !== undefined ? { listClientReferences } : {}),
      ...(archiveReferenceAsset !== undefined ? { archiveReferenceAsset } : {}),
      ...(updateReferenceAssetRole !== undefined ? { updateReferenceAssetRole } : {})
    },
    queries: {
      ...(dependencies.sceneReviewQueries !== undefined
        ? { sceneReview: dependencies.sceneReviewQueries }
        : {}),
      ...(dependencies.currentProductionAttemptQueries !== undefined
        ? { currentProductionAttempt: dependencies.currentProductionAttemptQueries }
        : {}),
      ...(dependencies.campaignDeliveryReelQueries !== undefined
        ? { campaignDeliveryReel: dependencies.campaignDeliveryReelQueries }
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

import type { ClientSessionMiddlewareOptions, VerifiedClientPrincipal } from "./client-context.js";

export interface ControlApiAppOptions {
  readonly reviewerIdentityResolver?: ReviewerIdentityResolver;
  readonly clientContextResolver?: ClientContextResolver<FastifyRequest>;
  readonly clientSessionConfig?: ClientSessionMiddlewareOptions | undefined;
  readonly clientSessionAuthenticator?:
    | ((
        request: FastifyRequest
      ) => Promise<VerifiedClientPrincipal | null> | VerifiedClientPrincipal | null)
    | undefined;
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
