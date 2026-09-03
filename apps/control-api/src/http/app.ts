import Fastify, { type FastifyInstance } from "fastify";
import {
  createControlApiContainer,
  type ControlApiContainer,
  type ControlApiDependencies
} from "./types.js";
import { handleReviewError } from "./errors.js";
import { reviewReadRoutes } from "./routes/review-read-routes.js";
import { reviewCommandRoutes } from "./routes/review-command-routes.js";
import { metricsRoutes } from "./routes/metrics-routes.js";
import { jobRoutes } from "./routes/job-routes.js";
import { deliveryAssemblyRoutes } from "./routes/delivery-assembly-routes.js";
import { campaignRoutes } from "./routes/campaign-routes.js";
import { clientRoutes } from "./routes/client-routes.js";
import { ControlApiConfigError } from "../runtime-config.js";
import type { ControlApiAppOptions } from "./types.js";
import {
  TailscaleReviewerIdentityResolver,
  parseReviewerIdentityConfig
} from "./reviewer-identity.js";

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

  const reviewerIdentityResolver =
    options?.reviewerIdentityResolver ??
    new TailscaleReviewerIdentityResolver(parseReviewerIdentityConfig(process.env));

  const effectiveOptions: ControlApiAppOptions = {
    ...options,
    reviewerIdentityResolver
  };

  const app = Fastify({
    logger: options?.logger ?? false,
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false
      }
    }
  });

  app.setErrorHandler(handleReviewError);

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      code: "NOT_FOUND",
      message: `Route ${request.method} ${request.url} not found.`
    });
  });

  app.get("/api/health", async (_request, reply) => {
    return reply.status(200).send({
      status: "ok",
      timestamp: new Date().toISOString()
    });
  });

  app.register(reviewReadRoutes, {
    container,
    ...(options !== undefined ? { appOptions: options } : {})
  });

  app.register(reviewCommandRoutes, {
    container,
    appOptions: effectiveOptions
  });

  app.register(campaignRoutes, {
    container
  });

  app.register(clientRoutes, {
    container
  });

  if (
    container.dependencies.storageTelemetry !== undefined &&
    container.dependencies.storageMetricsRegistry !== undefined
  ) {
    app.register(metricsRoutes, {
      container
    });
  }

  if (container.dependencies.jobQueue !== undefined) {
    if (options?.jobDispatch === undefined) {
      throw new ControlApiConfigError(
        "Job dispatch timing configuration (options.jobDispatch) is required when jobQueue is supplied"
      );
    }
    if (container.useCases.enforceStorageAdmission === undefined) {
      throw new ControlApiConfigError(
        "Storage admission use case (container.useCases.enforceStorageAdmission) is required when jobQueue is supplied"
      );
    }
    app.register(jobRoutes, {
      container,
      dispatchConfig: options.jobDispatch
    });
  }

  if (container.dependencies.deliveryAssemblyJobQueue !== undefined) {
    const dispatchConfig = options?.jobDispatch ?? {
      leaseDurationMs: 300_000,
      heartbeatIntervalMs: 30_000
    };
    app.register(deliveryAssemblyRoutes, {
      container,
      dispatchConfig
    });
  }

  return app;
}
