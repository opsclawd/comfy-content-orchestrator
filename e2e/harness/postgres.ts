import {
  startPostgres18Container,
  Pool,
  type StartedPostgres18Container,
  insertClientRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import { runMigrations } from "@cco/infrastructure";

export const TEST_CLIENT_ID = "11111111-1111-4111-8111-111111111111";

export interface TestPostgres {
  container: StartedPostgres18Container;
  pool: Pool;
  defaultClientId: string;
  teardown: () => Promise<void>;
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const container = await startPostgres18Container();
  const pool = new Pool({
    connectionString: container.getConnectionUri(),
    max: 10
  });

  const client = await pool.connect();
  try {
    await runMigrations(client, { migrationsDirectory: MIGRATIONS_DIRECTORY_URL });

    // Seed default test client so standard test submissions succeed
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Production Studios",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowCloudVisualQA: true,
        allowCloudVoice: true,
        allowedProviders: ["Anthropic", "OpenAI"],
        sensitiveDataMasking: false
      }
    });

    return {
      container,
      pool,
      defaultClientId: clientRecord.client_id,
      teardown: async () => {
        await pool.end();
        await container.stop();
      }
    };
  } finally {
    client.release();
  }
}
