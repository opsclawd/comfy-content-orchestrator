import {
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type RenderEnginePort,
  type SceneReviewQueries,
  type UnitOfWork
} from "@cco/application";

export const controlApiName = "control-api";

export interface ControlApiDependencies {
  readonly uow: UnitOfWork;
  readonly renderEngine?: RenderEnginePort;
  readonly sceneReviewQueries?: SceneReviewQueries;
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

export function createControlApiServices(dependencies: ControlApiDependencies): ControlApiUseCases {
  return createControlApiContainer(dependencies).useCases;
}

export function createControlApi(dependencies: ControlApiDependencies): ControlApiContainer {
  return createControlApiContainer(dependencies);
}

export { ProgressSceneProductionUseCases, ReviewSceneUseCases, type SceneReviewQueries };
