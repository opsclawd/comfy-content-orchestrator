import type { FastifyRequest } from "fastify";
import {
  CreateCampaignUseCase,
  CreateClientUseCase,
  CreateSceneUseCase,
  EnforceStorageAdmission,
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type DeliveryAssemblyJobQueuePort,
  type JobQueuePort,
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
}

export interface ControlApiUseCases {
  readonly reviewScene: ReviewSceneUseCases;
  readonly progressSceneProduction: ProgressSceneProductionUseCases;
  readonly createCampaign?: CreateCampaignUseCase | undefined;
  readonly createClient?: CreateClientUseCase | undefined;
  readonly createScene?: CreateSceneUseCase | undefined;
  readonly enforceStorageAdmission?: EnforceStorageAdmission;
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
  const createCampaign = new CreateCampaignUseCase(dependencies.uow);
  const createClient = new CreateClientUseCase(dependencies.uow);
  const createScene = new CreateSceneUseCase(dependencies.uow);
  const enforceStorageAdmission = dependencies.storageTelemetry
    ? new EnforceStorageAdmission({
        telemetryPort: dependencies.storageTelemetry,
        ...(dependencies.storageMetricsRegistry
          ? { metricsRegistry: dependencies.storageMetricsRegistry }
          : {})
      })
    : undefined;

  return {
    dependencies,
    useCases: {
      reviewScene,
      progressSceneProduction,
      createCampaign,
      createClient,
      createScene,
      ...(enforceStorageAdmission !== undefined ? { enforceStorageAdmission } : {})
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

export interface ControlApiAppOptions {
  readonly reviewerIdentityResolver?: ReviewerIdentityResolver;
  readonly clock?: Clock;
  readonly logger?: boolean;
  readonly jobDispatch?: {
    readonly leaseDurationMs: number;
    readonly heartbeatIntervalMs: number;
  };
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString()
};
