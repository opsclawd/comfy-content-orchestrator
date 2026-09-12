import type { Pool } from "pg";
import type { ReferenceAssetRepository } from "@cco/application";
import { PostgresSceneReviewQueries, PostgresUnitOfWork } from "@cco/infrastructure";
import { createControlApiApp } from "control-api";
import type { ScenarioPlanningModelClient } from "./scenario-planning-client.js";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

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

  const mockAssetRepo: ReferenceAssetRepository = {
    listBySceneId: async () => [],
    findByIds: async () => []
  };

  const app = createControlApiApp(
    {
      uow,
      sceneReviewQueries,
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
