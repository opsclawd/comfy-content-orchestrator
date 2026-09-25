import type { Pool } from "pg";
import type { ObjectStoragePort, ReviewMediaDeliveryPort } from "@cco/application";
import {
  PostgresCampaignDeliveryReelQueries,
  PostgresCurrentProductionAttemptQueries,
  PostgresSceneReviewQueries,
  PostgresUnitOfWork,
  PostgresReferenceAssetRepository
} from "@cco/infrastructure";
import { createControlApiApp, createProductionClientSessionAuthenticator } from "control-api";
import type { ScenarioPlanningModelClient } from "./scenario-planning-client.js";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "node:net";

export const TEST_CLIENT_SESSION_SECRET = "test_client_session_secret_at_least_32_chars_long";

const inMemoryStorage = new Map<
  string,
  { body: Uint8Array; contentType?: string | undefined; checksumSha256?: string | undefined }
>();

const testObjectStorage: ObjectStoragePort = {
  putObject: async (input) => {
    inMemoryStorage.set(`${input.bucket}/${input.key}`, {
      body: input.body,
      contentType: input.contentType,
      checksumSha256: input.checksumSha256
    });
    return { bucket: input.bucket, key: input.key };
  },
  getObject: async (locator) => {
    const item = inMemoryStorage.get(`${locator.bucket}/${locator.key}`);
    if (!item) return undefined;
    return {
      bucket: locator.bucket,
      key: locator.key,
      body: item.body,
      ...(item.contentType !== undefined ? { contentType: item.contentType } : {}),
      ...(item.checksumSha256 !== undefined ? { checksumSha256: item.checksumSha256 } : {})
    };
  },
  copyObject: async (from, to) => {
    const item = inMemoryStorage.get(`${from.bucket}/${from.key}`);
    if (item) {
      inMemoryStorage.set(`${to.bucket}/${to.key}`, { ...item });
    }
    return { bucket: to.bucket, key: to.key };
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
  const referenceAssetRepository = new PostgresReferenceAssetRepository(options.pool);

  const app = createControlApiApp(
    {
      uow,
      sceneReviewQueries,
      currentProductionAttemptQueries,
      campaignDeliveryReelQueries,
      objectStorage: testObjectStorage,
      reviewMediaDelivery: mockMediaDelivery,
      planningModelClients: {
        primary: options.planningStub,
        fallback: {
          providerName: "OpenAI",
          complete: (req) => options.planningStub.complete(req)
        }
      },
      referenceAssetRepository
    },
    {
      reviewerIdentityResolver: {
        resolve: () => "Integration Test Director"
      },
      clientSessionAuthenticator: createProductionClientSessionAuthenticator({
        secret: TEST_CLIENT_SESSION_SECRET,
        pool: options.pool
      }),
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
