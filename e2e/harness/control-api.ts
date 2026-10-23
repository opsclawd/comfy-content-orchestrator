import type { Pool } from "pg";
import { AccessDeniedError } from "@cco/domain";
import {
  type ObjectStoragePort,
  type ReviewMediaDeliveryPort,
  type ReviewerAuthorizationPort,
  DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
} from "@cco/application";
import {
  PostgresCampaignDeliveryReelQueries,
  PostgresCurrentProductionAttemptQueries,
  PostgresSceneReviewQueries,
  PostgresUnitOfWork,
  PostgresReferenceAssetRepository,
  PostgresBatchEvidenceDossierQueries,
  PostgresEvidenceLockCoordinator,
  OriginalsInspectionAdapter
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

export const testObjectStorage: ObjectStoragePort = {
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

let activeControlApiBaseUrl = "http://127.0.0.1:8000";

const mockMediaDelivery: ReviewMediaDeliveryPort = {
  generatePresignedReadUrl: async (locator) =>
    `${activeControlApiBaseUrl}/test-media/${locator.bucket}/${locator.key}`
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
  const batchEvidenceDossierQueries = new PostgresBatchEvidenceDossierQueries(options.pool);
  const evidenceLockCoordinator = new PostgresEvidenceLockCoordinator(options.pool);
  const originalsInspection = new OriginalsInspectionAdapter();
  const reviewerAuthorization: ReviewerAuthorizationPort = {
    assertCanReviewCoaReport: async (_clientId, actorId) => {
      if (actorId === "author@test.internal") {
        throw new AccessDeniedError(`Actor "${actorId}" is not authorized to review CoA reports.`);
      }
    },
    assertCanReviewClaim: async (_clientId, actorId) => {
      if (actorId === "author@test.internal") {
        throw new AccessDeniedError(
          `Actor "${actorId}" is not authorized to review product claims.`
        );
      }
    },
    assertCanVerifyEvidence: async (_clientId, actorId) => {
      if (actorId === "author@test.internal") {
        throw new AccessDeniedError(`Actor "${actorId}" is not authorized to verify evidence.`);
      }
    }
  };

  const app = createControlApiApp(
    {
      uow,
      sceneReviewQueries,
      currentProductionAttemptQueries,
      campaignDeliveryReelQueries,
      objectStorage: testObjectStorage,
      reviewMediaDelivery: mockMediaDelivery,
      batchEvidenceDossierQueries,
      evidenceLockCoordinator,
      originalsInspection,
      reviewerAuthorization,
      planningModelClients: {
        primary: options.planningStub,
        fallback: {
          providerName: "OpenAI",
          complete: (req) => options.planningStub.complete(req)
        }
      },
      referenceAssetRepository,
      evidenceStoragePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    },
    {
      reviewerIdentityResolver: {
        resolve: (req) => {
          const headers = req?.headers as Record<string, string | undefined> | undefined;
          return (
            headers?.["tailscale-user-login"] ||
            headers?.["x-test-actor-id"] ||
            "author@test.internal"
          );
        }
      },
      clientSessionAuthenticator: createProductionClientSessionAuthenticator({
        secret: TEST_CLIENT_SESSION_SECRET,
        pool: options.pool
      }),
      logger: false
    }
  );

  app.get("/test-media/:bucket/*", async (req, reply) => {
    const { bucket } = req.params as { bucket: string };
    const key = (req.params as Record<string, string>)["*"];
    const item = inMemoryStorage.get(`${bucket}/${key}`);
    if (!item) {
      reply.code(404).send({ error: "Media not found" });
      return;
    }
    if (item.contentType) {
      reply.header("content-type", item.contentType);
    }
    reply.send(Buffer.from(item.body));
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  const controlApiBaseUrl = `http://127.0.0.1:${address.port}`;
  activeControlApiBaseUrl = controlApiBaseUrl;

  return {
    app,
    controlApiBaseUrl,
    teardown: async () => {
      await app.close();
    }
  };
}
