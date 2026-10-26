import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { ExecutionScope } from "@cco/domain";
import {
  CreateCampaignUseCase,
  CreateCampaignShellUseCase,
  CreateClientUseCase,
  ListClientsUseCase,
  CreateProductSkuUseCase,
  GetProductSkuUseCase,
  ListProductSkusUseCase,
  UpdateProductSkuMetadataUseCase,
  ArchiveProductSkuUseCase,
  CreateProductBatchUseCase,
  GetProductBatchUseCase,
  ListProductBatchesUseCase,
  UpdateProductBatchMetadataUseCase,
  ArchiveProductBatchUseCase,
  AppendBatchFactsUseCase,
  GetBatchFactsHistoryUseCase,
  RegisterEvidenceAssetUseCase,
  LinkExistingDerivativeUseCase,
  RecordEvidenceVerificationEventUseCase,
  EvidenceAssetUseCases,
  CreateCoaReportUseCase,
  SupersedeCoaReportUseCase,
  ReviewCoaReportUseCase,
  ArchiveCoaReportUseCase,
  CoaReportUseCases,
  CreateClaimUseCase,
  AppendClaimRevisionUseCase,
  LinkClaimEvidenceUseCase,
  ReviewClaimUseCase,
  InvalidateClaimUseCase,
  ResolveClaimUseCase,
  ClaimUseCases,
  ResolveBatchEvidenceDossierUseCase,
  type ProductEvidenceRepositoryPort,
  PreviewCampaignReplanUseCase,
  CommitCampaignReplanUseCase,
  BeginOperatorAcceptanceRunUseCase,
  AcceptOperatorAcceptanceSceneUseCase,
  AssembleOperatorAcceptanceRunUseCase,
  type StageH3CandidateRenderUseCase,
  type H3CandidateRegistryReader,
  type RealmAdmissionContext,
  createDeployedLiveRealmContext,
  type ProductionReleaseCapabilityReader,
  type StagingPlanningAuthorizationSource,
  CreateSceneUseCase,
  EnforceStorageAdmission,
  EnqueueSceneProductionRenderUseCase,
  MaterializeStoryboardUseCase,
  PlanCampaignBeatSheetUseCase,
  PlanCampaignStoryboardUseCase,
  PlanSceneConfigurationUseCase,
  PlanShotPlansUseCase,
  CreateShotPlanVariationUseCase,
  ProgressSceneProductionUseCases,
  PrepareSceneProductionInputsUseCase,
  RankReviewCandidatesUseCase,
  ReviewSceneUseCases,
  ProductionReviewUseCases,
  SubmitSceneCreationUseCase,
  ApproveSceneAndDispatchCampaignProductionUseCase,
  CompleteCampaignProductionRunUseCases,
  CompleteCampaignProductionRunAssemblyUseCases,
  ResolveCampaignDeliveryReelUseCase,
  ResolveCampaignAnimaticUseCase,
  ResolveCampaignPreProductionReadinessUseCase,
  UploadReferenceAssetUseCase,
  ListClientReferencesUseCase,
  ArchiveReferenceAssetUseCase,
  UpdateReferenceAssetRoleUseCase,
  type CampaignAnimaticQueries,
  type CampaignReadinessQueries,
  type CampaignDeliveryReelQueries,
  type ClientContextResolver,
  type CurrentProductionAttemptQueries,
  type DeliveryAssemblyJobQueuePort,
  type HashBytesPort,
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
  type UnitOfWork,
  type AutoPlanFirstPassLogger,
  type ReviewerAuthorizationPort,
  type EvidenceLockCoordinatorPort,
  type OriginalsInspectionPort,
  type EvidenceStoragePolicyConfig,
  type BatchEvidenceDossierQueries
} from "@cco/application";
import { OriginalsInspectionAdapter, SharpImageInspectionAdapter } from "@cco/infrastructure";
import { ShotPlanPlanningCoordinator } from "../shot-plan-planning-coordinator.js";

export interface ControlApiDependencies {
  readonly uow: UnitOfWork;
  readonly renderEngine?: RenderEnginePort;
  readonly sceneReviewQueries?: SceneReviewQueries;
  readonly currentProductionAttemptQueries?: CurrentProductionAttemptQueries;
  readonly campaignDeliveryReelQueries?: CampaignDeliveryReelQueries;
  readonly campaignAnimaticQueries?: CampaignAnimaticQueries;
  readonly campaignReadinessQueries?: CampaignReadinessQueries;
  readonly objectStorage?: ObjectStoragePort;
  readonly hashBytes?: HashBytesPort;
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
  readonly planningCoordinator?: ShotPlanPlanningCoordinator | undefined;
  readonly logger?: AutoPlanFirstPassLogger | undefined;
  readonly reviewerAuthorization?: ReviewerAuthorizationPort;
  readonly evidenceLockCoordinator?: EvidenceLockCoordinatorPort;
  readonly originalsInspection?: OriginalsInspectionPort;
  readonly evidenceStoragePolicy?: EvidenceStoragePolicyConfig;
  readonly batchEvidenceDossierQueries?: BatchEvidenceDossierQueries;
  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
  readonly stageRenderUseCase?: StageH3CandidateRenderUseCase | undefined;
  readonly h3CandidateRegistryReader?: H3CandidateRegistryReader | undefined;
  readonly realmAdmissionContext?: RealmAdmissionContext | undefined;
}

export interface ControlApiUseCases {
  readonly reviewScene: ReviewSceneUseCases;
  readonly productionReview: ProductionReviewUseCases;
  readonly progressSceneProduction: ProgressSceneProductionUseCases;
  readonly enqueueSceneProductionRender?: EnqueueSceneProductionRenderUseCase | undefined;
  readonly previewCampaignReplan?: PreviewCampaignReplanUseCase | undefined;
  readonly commitCampaignReplan?: CommitCampaignReplanUseCase | undefined;
  readonly beginOperatorAcceptanceRun?: BeginOperatorAcceptanceRunUseCase | undefined;
  readonly acceptOperatorAcceptanceScene?: AcceptOperatorAcceptanceSceneUseCase | undefined;
  readonly assembleOperatorAcceptanceRun?: AssembleOperatorAcceptanceRunUseCase | undefined;
  readonly createCampaign?: CreateCampaignUseCase | undefined;
  readonly createCampaignShell?: CreateCampaignShellUseCase | undefined;
  readonly createClient?: CreateClientUseCase | undefined;
  readonly listClients?: ListClientsUseCase | undefined;
  readonly createScene?: CreateSceneUseCase | undefined;
  readonly submitSceneCreation?: SubmitSceneCreationUseCase | undefined;
  readonly materializeStoryboard?: MaterializeStoryboardUseCase | undefined;
  readonly planCampaignBeatSheet?: PlanCampaignBeatSheetUseCase | undefined;
  readonly planCampaignStoryboard?: PlanCampaignStoryboardUseCase | undefined;
  readonly rankReviewCandidates?: RankReviewCandidatesUseCase | undefined;
  readonly enforceStorageAdmission?: EnforceStorageAdmission;
  readonly prepareSceneProductionInputs: PrepareSceneProductionInputsUseCase;
  readonly approveSceneAndDispatchCampaignProduction: ApproveSceneAndDispatchCampaignProductionUseCase;
  readonly completeCampaignProductionRun: CompleteCampaignProductionRunUseCases;
  readonly completeCampaignProductionRunAssembly: CompleteCampaignProductionRunAssemblyUseCases;
  readonly resolveCampaignDeliveryReel?: ResolveCampaignDeliveryReelUseCase | undefined;
  readonly resolveCampaignAnimatic?: ResolveCampaignAnimaticUseCase | undefined;
  readonly resolveCampaignPreProductionReadiness?:
    ResolveCampaignPreProductionReadinessUseCase | undefined;
  readonly uploadReferenceAsset?: UploadReferenceAssetUseCase | undefined;
  readonly listClientReferences?: ListClientReferencesUseCase | undefined;
  readonly archiveReferenceAsset?: ArchiveReferenceAssetUseCase | undefined;
  readonly updateReferenceAssetRole?: UpdateReferenceAssetRoleUseCase | undefined;
  readonly planShotPlans?: PlanShotPlansUseCase | undefined;
  readonly createShotPlanVariation?: CreateShotPlanVariationUseCase | undefined;

  readonly createProductSku?: CreateProductSkuUseCase | undefined;
  readonly getProductSku?: GetProductSkuUseCase | undefined;
  readonly listProductSkus?: ListProductSkusUseCase | undefined;
  readonly updateProductSkuMetadata?: UpdateProductSkuMetadataUseCase | undefined;
  readonly archiveProductSku?: ArchiveProductSkuUseCase | undefined;
  readonly createProductBatch?: CreateProductBatchUseCase | undefined;
  readonly getProductBatch?: GetProductBatchUseCase | undefined;
  readonly listProductBatches?: ListProductBatchesUseCase | undefined;
  readonly updateProductBatchMetadata?: UpdateProductBatchMetadataUseCase | undefined;
  readonly archiveProductBatch?: ArchiveProductBatchUseCase | undefined;
  readonly appendBatchFacts?: AppendBatchFactsUseCase | undefined;
  readonly getBatchFactsHistory?: GetBatchFactsHistoryUseCase | undefined;
  readonly evidenceAsset?: EvidenceAssetUseCases | undefined;
  readonly coaReport?: CoaReportUseCases | undefined;
  readonly claim?: ClaimUseCases | undefined;
  readonly resolveBatchEvidenceDossier?: ResolveBatchEvidenceDossierUseCase | undefined;
}

export interface ControlApiQueries {
  readonly sceneReview?: SceneReviewQueries;
  readonly currentProductionAttempt?: CurrentProductionAttemptQueries;
  readonly campaignDeliveryReel?: CampaignDeliveryReelQueries;
  readonly campaignAnimatic?: CampaignAnimaticQueries;
  readonly campaignReadiness?: CampaignReadinessQueries;
  readonly batchEvidenceDossier?: BatchEvidenceDossierQueries;
}

export interface ControlApiContainer {
  readonly dependencies: ControlApiDependencies;
  readonly useCases: ControlApiUseCases;
  readonly queries: ControlApiQueries;
  readonly planningCoordinator?: ShotPlanPlanningCoordinator | undefined;
}

export function createControlApiContainer(
  dependencies: ControlApiDependencies
): ControlApiContainer {
  const planShotPlans = dependencies.planningModelClients
    ? new PlanShotPlansUseCase({
        uow: dependencies.uow,
        primaryClient: dependencies.planningModelClients.primary,
        fallbackClient: dependencies.planningModelClients.fallback,
        ...(dependencies.objectStorage !== undefined
          ? { objectStorage: dependencies.objectStorage }
          : {}),
        ...(dependencies.planningOverallTimeoutMs !== undefined
          ? { overallTimeoutMs: dependencies.planningOverallTimeoutMs }
          : {})
      })
    : undefined;
  const planningCoordinator =
    dependencies.planningCoordinator ??
    (planShotPlans
      ? new ShotPlanPlanningCoordinator({ planShotPlansUseCase: planShotPlans })
      : undefined);
  const createShotPlanVariation = dependencies.planningModelClients
    ? new CreateShotPlanVariationUseCase({
        uow: dependencies.uow,
        primaryClient: dependencies.planningModelClients.primary,
        fallbackClient: dependencies.planningModelClients.fallback,
        ...(dependencies.planningOverallTimeoutMs !== undefined
          ? { overallTimeoutMs: dependencies.planningOverallTimeoutMs }
          : {})
      })
    : undefined;
  const autoPlanLogger: AutoPlanFirstPassLogger = dependencies.logger ?? console;
  const reviewScene = new ReviewSceneUseCases(
    dependencies.uow,
    planShotPlans,
    planningCoordinator,
    autoPlanLogger
  );
  const hashBytes = dependencies.hashBytes ?? {
    hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  };
  const enqueueSceneProductionRender = new EnqueueSceneProductionRenderUseCase(dependencies.uow, {
    objectStorage: dependencies.objectStorage,
    hashBytes,
    imageValidator: dependencies.imageValidator,
    productionReleaseReader: dependencies.productionReleaseReader
  });
  const realmAdmissionContext =
    dependencies.realmAdmissionContext ?? createDeployedLiveRealmContext("default");
  const productionReview = new ProductionReviewUseCases(
    dependencies.uow,
    enqueueSceneProductionRender,
    realmAdmissionContext
  );
  const progressSceneProduction = new ProgressSceneProductionUseCases(
    dependencies.uow,
    dependencies.renderEngine,
    dependencies.jobQueue
  );
  const createCampaign = new CreateCampaignUseCase(dependencies.uow);
  const createCampaignShell = new CreateCampaignShellUseCase(dependencies.uow, {
    productionReleaseReader: dependencies.productionReleaseReader,
    stagingAuthSource: dependencies.stagingAuthSource,
    registryReader: dependencies.h3CandidateRegistryReader,
    realmContext: realmAdmissionContext
  });
  const createClient = new CreateClientUseCase(dependencies.uow);
  const listClients = new ListClientsUseCase(dependencies.uow);
  const createScene = new CreateSceneUseCase(dependencies.uow, planningCoordinator, autoPlanLogger);
  const materializeStoryboard = new MaterializeStoryboardUseCase(
    dependencies.uow,
    planningCoordinator,
    autoPlanLogger
  );
  const prepareSceneProductionInputs = new PrepareSceneProductionInputsUseCase(dependencies.uow, {
    objectStorage: dependencies.objectStorage,
    hashBytes,
    imageValidator: dependencies.imageValidator,
    mediaDelivery: dependencies.reviewMediaDelivery,
    productionReleaseReader: dependencies.productionReleaseReader
  });
  const approveSceneAndDispatchCampaignProduction =
    new ApproveSceneAndDispatchCampaignProductionUseCase(
      dependencies.uow,
      enqueueSceneProductionRender,
      prepareSceneProductionInputs
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
  const resolveCampaignAnimatic = dependencies.campaignAnimaticQueries
    ? new ResolveCampaignAnimaticUseCase({
        queries: dependencies.campaignAnimaticQueries,
        ...(dependencies.reviewMediaDelivery !== undefined
          ? { mediaDelivery: dependencies.reviewMediaDelivery }
          : {})
      })
    : undefined;
  const resolveCampaignPreProductionReadiness = dependencies.campaignReadinessQueries
    ? new ResolveCampaignPreProductionReadinessUseCase({
        queries: dependencies.campaignReadinessQueries
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

  const productEvidenceRepo: ProductEvidenceRepositoryPort | undefined = dependencies.uow
    ? {
        createSku: (cmd) => dependencies.uow.execute((ctx) => ctx.productEvidence!.createSku(cmd)),
        createBatch: (cmd) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.createBatch(cmd)),
        appendBatchFacts: (cmd) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.appendBatchFacts(cmd)),
        updateSkuMetadata: (cmd) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.updateSkuMetadata(cmd)),
        updateBatchMetadata: (cmd) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.updateBatchMetadata(cmd)),
        archiveSku: (cmd) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.archiveSku(cmd)),
        archiveBatch: (cmd) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.archiveBatch(cmd)),
        getSkuById: (c, s) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.getSkuById(c, s)),
        listSkus: (c, f) => dependencies.uow.execute((ctx) => ctx.productEvidence!.listSkus(c, f)),
        getBatchById: (c, b) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.getBatchById(c, b)),
        getBatchHistory: (c, b) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.getBatchHistory(c, b)),
        listBatches: (c, f) =>
          dependencies.uow.execute((ctx) => ctx.productEvidence!.listBatches(c, f))
      }
    : undefined;

  const createProductSku = dependencies.uow
    ? new CreateProductSkuUseCase(dependencies.uow)
    : undefined;
  const getProductSku = productEvidenceRepo
    ? new GetProductSkuUseCase(productEvidenceRepo)
    : undefined;
  const listProductSkus = productEvidenceRepo
    ? new ListProductSkusUseCase(productEvidenceRepo)
    : undefined;
  const updateProductSkuMetadata = dependencies.uow
    ? new UpdateProductSkuMetadataUseCase(dependencies.uow)
    : undefined;
  const archiveProductSku = dependencies.uow
    ? new ArchiveProductSkuUseCase(dependencies.uow)
    : undefined;

  const createProductBatch = dependencies.uow
    ? new CreateProductBatchUseCase(dependencies.uow)
    : undefined;
  const getProductBatch = productEvidenceRepo
    ? new GetProductBatchUseCase(productEvidenceRepo)
    : undefined;
  const listProductBatches = productEvidenceRepo
    ? new ListProductBatchesUseCase(productEvidenceRepo)
    : undefined;
  const updateProductBatchMetadata = dependencies.uow
    ? new UpdateProductBatchMetadataUseCase(dependencies.uow)
    : undefined;
  const archiveProductBatch = dependencies.uow
    ? new ArchiveProductBatchUseCase(dependencies.uow)
    : undefined;
  const appendBatchFacts = dependencies.uow
    ? new AppendBatchFactsUseCase(dependencies.uow)
    : undefined;
  const getBatchFactsHistory = productEvidenceRepo
    ? new GetBatchFactsHistoryUseCase(productEvidenceRepo)
    : undefined;

  const registerEvidenceAssetUseCase =
    dependencies.uow && dependencies.objectStorage && dependencies.evidenceLockCoordinator
      ? new RegisterEvidenceAssetUseCase({
          unitOfWork: dependencies.uow,
          objectStorage: dependencies.objectStorage,
          lockCoordinator: dependencies.evidenceLockCoordinator,
          originalsInspector: dependencies.originalsInspection ?? new OriginalsInspectionAdapter(),
          storagePolicy: dependencies.evidenceStoragePolicy
        })
      : undefined;
  const linkDerivativeUseCase =
    dependencies.uow && dependencies.objectStorage
      ? new LinkExistingDerivativeUseCase({
          unitOfWork: dependencies.uow,
          objectStorage: dependencies.objectStorage,
          lockCoordinator: dependencies.evidenceLockCoordinator,
          originalsInspector: dependencies.originalsInspection ?? new OriginalsInspectionAdapter()
        })
      : undefined;
  const recordVerificationUseCase = dependencies.uow
    ? new RecordEvidenceVerificationEventUseCase({ unitOfWork: dependencies.uow })
    : undefined;

  const evidenceAsset =
    dependencies.uow &&
    registerEvidenceAssetUseCase &&
    linkDerivativeUseCase &&
    recordVerificationUseCase
      ? new EvidenceAssetUseCases(
          dependencies.uow,
          registerEvidenceAssetUseCase,
          linkDerivativeUseCase,
          recordVerificationUseCase,
          dependencies.reviewerAuthorization,
          dependencies.reviewMediaDelivery,
          dependencies.objectStorage,
          dependencies.originalsInspection
        )
      : undefined;

  const createCoaReportUseCase = dependencies.uow
    ? new CreateCoaReportUseCase(dependencies.uow)
    : undefined;
  const supersedeCoaReportUseCase = dependencies.uow
    ? new SupersedeCoaReportUseCase(dependencies.uow)
    : undefined;
  const reviewCoaReportUseCase = dependencies.uow
    ? new ReviewCoaReportUseCase(dependencies.uow, dependencies.reviewerAuthorization)
    : undefined;
  const archiveCoaReportUseCase = dependencies.uow
    ? new ArchiveCoaReportUseCase(dependencies.uow)
    : undefined;

  const coaReport =
    dependencies.uow &&
    createCoaReportUseCase &&
    supersedeCoaReportUseCase &&
    reviewCoaReportUseCase &&
    archiveCoaReportUseCase
      ? new CoaReportUseCases(
          dependencies.uow,
          createCoaReportUseCase,
          supersedeCoaReportUseCase,
          reviewCoaReportUseCase,
          archiveCoaReportUseCase,
          dependencies.reviewerAuthorization
        )
      : undefined;

  const createClaimUseCase = dependencies.uow
    ? new CreateClaimUseCase(dependencies.uow)
    : undefined;
  const appendClaimRevisionUseCase = dependencies.uow
    ? new AppendClaimRevisionUseCase(dependencies.uow)
    : undefined;
  const linkClaimEvidenceUseCase = dependencies.uow
    ? new LinkClaimEvidenceUseCase(dependencies.uow)
    : undefined;
  const reviewClaimUseCase = dependencies.uow
    ? new ReviewClaimUseCase(dependencies.uow, dependencies.reviewerAuthorization)
    : undefined;
  const invalidateClaimUseCase = dependencies.uow
    ? new InvalidateClaimUseCase(dependencies.uow, dependencies.reviewerAuthorization)
    : undefined;
  const resolveClaimUseCase = dependencies.uow
    ? new ResolveClaimUseCase(dependencies.uow)
    : undefined;

  const claim =
    dependencies.uow &&
    createClaimUseCase &&
    appendClaimRevisionUseCase &&
    linkClaimEvidenceUseCase &&
    reviewClaimUseCase &&
    invalidateClaimUseCase &&
    resolveClaimUseCase
      ? new ClaimUseCases(
          dependencies.uow,
          createClaimUseCase,
          appendClaimRevisionUseCase,
          linkClaimEvidenceUseCase,
          reviewClaimUseCase,
          invalidateClaimUseCase,
          resolveClaimUseCase,
          dependencies.reviewerAuthorization,
          dependencies.objectStorage,
          dependencies.originalsInspection
        )
      : undefined;

  const resolveBatchEvidenceDossier = dependencies.batchEvidenceDossierQueries
    ? new ResolveBatchEvidenceDossierUseCase(dependencies.batchEvidenceDossierQueries)
    : undefined;

  const previewCampaignReplan = dependencies.uow
    ? new PreviewCampaignReplanUseCase({ uow: dependencies.uow })
    : undefined;
  const commitCampaignReplan = dependencies.uow
    ? new CommitCampaignReplanUseCase({ uow: dependencies.uow })
    : undefined;
  const beginOperatorAcceptanceRun = dependencies.uow
    ? new BeginOperatorAcceptanceRunUseCase({
        uow: dependencies.uow,
        stageRenderUseCase: dependencies.stageRenderUseCase,
        stagingAuthSource: dependencies.stagingAuthSource
      })
    : undefined;
  const acceptOperatorAcceptanceScene = dependencies.uow
    ? new AcceptOperatorAcceptanceSceneUseCase({ uow: dependencies.uow })
    : undefined;
  const assembleOperatorAcceptanceRun = dependencies.uow
    ? new AssembleOperatorAcceptanceRunUseCase({ uow: dependencies.uow })
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
      listClients,
      createScene,
      submitSceneCreation,
      materializeStoryboard,
      prepareSceneProductionInputs,
      approveSceneAndDispatchCampaignProduction,
      completeCampaignProductionRun,
      completeCampaignProductionRunAssembly,
      ...(resolveCampaignDeliveryReel !== undefined ? { resolveCampaignDeliveryReel } : {}),
      ...(resolveCampaignAnimatic !== undefined ? { resolveCampaignAnimatic } : {}),
      ...(resolveCampaignPreProductionReadiness !== undefined
        ? { resolveCampaignPreProductionReadiness }
        : {}),
      ...(planCampaignBeatSheet !== undefined ? { planCampaignBeatSheet } : {}),
      ...(planCampaignStoryboard !== undefined ? { planCampaignStoryboard } : {}),
      ...(enforceStorageAdmission !== undefined ? { enforceStorageAdmission } : {}),
      ...(rankReviewCandidates !== undefined ? { rankReviewCandidates } : {}),
      ...(uploadReferenceAsset !== undefined ? { uploadReferenceAsset } : {}),
      ...(listClientReferences !== undefined ? { listClientReferences } : {}),
      ...(archiveReferenceAsset !== undefined ? { archiveReferenceAsset } : {}),
      ...(updateReferenceAssetRole !== undefined ? { updateReferenceAssetRole } : {}),
      ...(planShotPlans !== undefined ? { planShotPlans } : {}),
      ...(createShotPlanVariation !== undefined ? { createShotPlanVariation } : {}),
      ...(createProductSku !== undefined ? { createProductSku } : {}),
      ...(getProductSku !== undefined ? { getProductSku } : {}),
      ...(listProductSkus !== undefined ? { listProductSkus } : {}),
      ...(updateProductSkuMetadata !== undefined ? { updateProductSkuMetadata } : {}),
      ...(archiveProductSku !== undefined ? { archiveProductSku } : {}),
      ...(createProductBatch !== undefined ? { createProductBatch } : {}),
      ...(getProductBatch !== undefined ? { getProductBatch } : {}),
      ...(listProductBatches !== undefined ? { listProductBatches } : {}),
      ...(updateProductBatchMetadata !== undefined ? { updateProductBatchMetadata } : {}),
      ...(archiveProductBatch !== undefined ? { archiveProductBatch } : {}),
      ...(appendBatchFacts !== undefined ? { appendBatchFacts } : {}),
      ...(getBatchFactsHistory !== undefined ? { getBatchFactsHistory } : {}),
      ...(evidenceAsset !== undefined ? { evidenceAsset } : {}),
      ...(coaReport !== undefined ? { coaReport } : {}),
      ...(claim !== undefined ? { claim } : {}),
      ...(resolveBatchEvidenceDossier !== undefined ? { resolveBatchEvidenceDossier } : {}),
      ...(previewCampaignReplan !== undefined ? { previewCampaignReplan } : {}),
      ...(commitCampaignReplan !== undefined ? { commitCampaignReplan } : {}),
      ...(beginOperatorAcceptanceRun !== undefined ? { beginOperatorAcceptanceRun } : {}),
      ...(acceptOperatorAcceptanceScene !== undefined ? { acceptOperatorAcceptanceScene } : {}),
      ...(assembleOperatorAcceptanceRun !== undefined ? { assembleOperatorAcceptanceRun } : {})
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
        : {}),
      ...(dependencies.campaignAnimaticQueries !== undefined
        ? { campaignAnimatic: dependencies.campaignAnimaticQueries }
        : {}),
      ...(dependencies.campaignReadinessQueries !== undefined
        ? { campaignReadiness: dependencies.campaignReadinessQueries }
        : {}),
      ...(dependencies.batchEvidenceDossierQueries !== undefined
        ? { batchEvidenceDossier: dependencies.batchEvidenceDossierQueries }
        : {})
    },
    ...(planningCoordinator !== undefined ? { planningCoordinator } : {})
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
    readonly allowedExecutionScopes?: readonly ExecutionScope[] | undefined;
    readonly resolveWorkerExecutionScopes?:
      ((workerId: string) => readonly ExecutionScope[]) | undefined;
    readonly resolveWorkerStagingToken?: ((workerId: string) => string | undefined) | undefined;
  };
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString()
};
