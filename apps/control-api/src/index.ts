import {
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type RenderEnginePort,
  type StoryboardCandidateRepository,
  type UnitOfWork
} from "@cco/application";

export const controlApiName = "control-api";

export interface ControlApiDependencies {
  readonly uow: UnitOfWork;
  readonly renderEngine?: RenderEnginePort;
  readonly candidateRepository?: StoryboardCandidateRepository;
}

export interface ControlApiUseCases {
  readonly reviewScene: ReviewSceneUseCases;
  readonly progressSceneProduction: ProgressSceneProductionUseCases;
}

export interface ControlApiContainer {
  readonly dependencies: ControlApiDependencies;
  readonly useCases: ControlApiUseCases;
}

export function createControlApiContainer(
  dependencies: ControlApiDependencies
): ControlApiContainer {
  const reviewScene = new ReviewSceneUseCases(dependencies.uow, dependencies.candidateRepository);
  const progressSceneProduction = new ProgressSceneProductionUseCases(
    dependencies.uow,
    dependencies.renderEngine
  );

  return {
    dependencies,
    useCases: {
      reviewScene,
      progressSceneProduction
    }
  };
}

export function createControlApiServices(dependencies: ControlApiDependencies): ControlApiUseCases {
  return createControlApiContainer(dependencies).useCases;
}

export function createControlApi(dependencies: ControlApiDependencies): ControlApiContainer {
  return createControlApiContainer(dependencies);
}

export { ProgressSceneProductionUseCases, ReviewSceneUseCases };
