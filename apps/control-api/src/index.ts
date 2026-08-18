import type {
  ControlApiDependencies,
  ControlApiUseCases,
  ControlApiContainer
} from "./http/types.js";
import { createControlApiContainer } from "./http/types.js";

export const controlApiName = "control-api";

export function createControlApiServices(dependencies: ControlApiDependencies): ControlApiUseCases {
  return createControlApiContainer(dependencies).useCases;
}

export function createControlApi(dependencies: ControlApiDependencies): ControlApiContainer {
  return createControlApiContainer(dependencies);
}

export {
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type SceneReviewQueries
} from "@cco/application";

export * from "./http/types.js";
export * from "./http/errors.js";
export * from "./http/app.js";
export * from "./http/routes/review-read-routes.js";
export * from "./http/routes/review-command-routes.js";
