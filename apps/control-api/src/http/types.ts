import type { FastifyRequest } from "fastify";
import {
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type RenderEnginePort,
  type ReviewMediaDeliveryPort,
  type SceneReviewQueries,
  type UnitOfWork
} from "@cco/application";

export interface ControlApiDependencies {
  readonly uow: UnitOfWork;
  readonly renderEngine?: RenderEnginePort;
  readonly sceneReviewQueries?: SceneReviewQueries;
  readonly reviewMediaDelivery?: ReviewMediaDeliveryPort;
}

export interface ControlApiUseCases {
  readonly reviewScene: ReviewSceneUseCases;
  readonly progressSceneProduction: ProgressSceneProductionUseCases;
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
    dependencies.renderEngine
  );

  return {
    dependencies,
    useCases: {
      reviewScene,
      progressSceneProduction
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
}

export const defaultReviewerIdentityResolver: ReviewerIdentityResolver = {
  resolve: () => "Thomas Cumberbatch"
};

export const defaultClock: Clock = {
  now: () => new Date().toISOString()
};
