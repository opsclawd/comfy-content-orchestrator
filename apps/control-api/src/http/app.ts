import Fastify, { type FastifyInstance } from "fastify";
import {
  createControlApiContainer,
  type ControlApiContainer,
  type ControlApiDependencies
} from "./types.js";
import { handleReviewError } from "./errors.js";
import { reviewReadRoutes } from "./routes/review-read-routes.js";
import { reviewCommandRoutes } from "./routes/review-command-routes.js";
import type { ControlApiAppOptions } from "./types.js";

function isControlApiContainer(
  deps: ControlApiDependencies | ControlApiContainer
): deps is ControlApiContainer {
  return (
    typeof deps === "object" &&
    deps !== null &&
    "useCases" in deps &&
    "dependencies" in deps &&
    "queries" in deps
  );
}

export function createControlApiApp(
  dependencies: ControlApiDependencies | ControlApiContainer,
  options?: ControlApiAppOptions
): FastifyInstance {
  const container = isControlApiContainer(dependencies)
    ? dependencies
    : createControlApiContainer(dependencies);

  const app = Fastify({
    logger: options?.logger ?? false
  });

  app.setErrorHandler(handleReviewError);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.url} not found.`
    });
  });

  app.register(reviewReadRoutes, {
    container,
    ...(options !== undefined ? { appOptions: options } : {})
  });

  app.register(reviewCommandRoutes, {
    container,
    ...(options !== undefined ? { appOptions: options } : {})
  });

  return app;
}
