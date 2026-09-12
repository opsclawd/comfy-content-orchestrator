import { startTestPostgres, type TestPostgres } from "./postgres.js";
import { startTestControlApi, type TestControlApi } from "./control-api.js";
import { startTestWebServer, type TestWebServer } from "./web-server.js";
import { ScenarioPlanningModelClient } from "./scenario-planning-client.js";

export interface E2ETestEnvironment {
  postgres: TestPostgres;
  controlApi: TestControlApi;
  webServer: TestWebServer;
  planningStub: ScenarioPlanningModelClient;
  teardown: () => Promise<void>;
}

export async function setupE2ETestEnvironment(): Promise<E2ETestEnvironment> {
  const planningStub = new ScenarioPlanningModelClient();
  const postgres = await startTestPostgres();
  const controlApi = await startTestControlApi({
    pool: postgres.pool,
    planningStub
  });
  const webServer = await startTestWebServer({
    controlApiBaseUrl: controlApi.controlApiBaseUrl
  });

  return {
    postgres,
    controlApi,
    webServer,
    planningStub,
    teardown: async () => {
      await webServer.teardown();
      await controlApi.teardown();
      await postgres.teardown();
    }
  };
}

export * from "./scenario-planning-client.js";
export * from "./postgres.js";
export * from "./control-api.js";
export * from "./web-server.js";
