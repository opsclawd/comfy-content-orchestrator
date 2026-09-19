import type { Pool } from "pg";
import type {
  ObjectStoragePort,
  ReferenceAssetRepository,
  ReviewMediaDeliveryPort
} from "@cco/application";
import {
  PostgresCampaignDeliveryReelQueries,
  PostgresCurrentProductionAttemptQueries,
  PostgresSceneReviewQueries,
  PostgresUnitOfWork
} from "@cco/infrastructure";
import { createControlApiApp } from "control-api";
import type { ScenarioPlanningModelClient } from "./scenario-planning-client.js";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

// Neither port's methods are exercised by e2e coverage today: every test
// campaign is fresh, so ResolveCampaignDeliveryReelUseCase always resolves
// via the "not-started" branch, which never touches storage or media
// delivery. These stubs exist only to satisfy the use case's construction
// gate (apps/control-api/src/http/types.ts) -- without them,
// resolveCampaignDeliveryReel is silently left undefined and every
// /api/campaigns/:id/delivery-reel request 500s with CONFIGURATION_ERROR,
// which the campaign review page (apps/web) now depends on for every
// render since it fetches the delivery reel alongside the review summary.
const notImplementedObjectStorage: ObjectStoragePort = {
  putObject: async () => {
    throw new Error("InMemoryObjectStorage stub: putObject is not implemented in the e2e harness");
  },
  getObject: async () => undefined,
  copyObject: async () => {
    throw new Error("InMemoryObjectStorage stub: copyObject is not implemented in the e2e harness");
  }
};

const mockMediaDelivery: ReviewMediaDeliveryPort = {
  generatePresignedReadUrl: async (locator) =>
    `http://mock-storage/${locator.bucket}/${locator.key}`
};

export interface TestControlApi {
  app: FastifyInstance;
  controlApiBaseUrl: string;
  teardown: () => Promise<void>;
}

export async function startTestControlApi(options: {
  pool: Pool;
  planningStub: ScenarioPlanningModelClient;
}): Promise<TestControlApi> {
  const uow = new PostgresUnitOfWork(options.pool);
  const sceneReviewQueries = new PostgresSceneReviewQueries(options.pool);
  const currentProductionAttemptQueries = new PostgresCurrentProductionAttemptQueries(options.pool);
  const campaignDeliveryReelQueries = new PostgresCampaignDeliveryReelQueries(options.pool);

  const mockAssetRepo: ReferenceAssetRepository = {
    listBySceneId: async () => [],
    findByIds: async () => []
  };

  const app = createControlApiApp(
    {
      uow,
      sceneReviewQueries,
      currentProductionAttemptQueries,
      campaignDeliveryReelQueries,
      objectStorage: notImplementedObjectStorage,
      reviewMediaDelivery: mockMediaDelivery,
      planningModelClients: {
        primary: options.planningStub,
        fallback: {
          providerName: "OpenAI",
          complete: (req) => options.planningStub.complete(req)
        }
      },
      referenceAssetRepository: mockAssetRepo
    },
    {
      reviewerIdentityResolver: {
        resolve: () => "Integration Test Director"
      },
      logger: false
    }
  );

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  const controlApiBaseUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    controlApiBaseUrl,
    teardown: async () => {
      await app.close();
    }
  };
}
