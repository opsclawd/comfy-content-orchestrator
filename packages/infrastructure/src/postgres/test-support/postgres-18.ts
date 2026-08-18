import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client, Pool, type PoolClient } from "pg";

export { Client, Pool, type PoolClient };

export interface StartedPostgres18Container {
  readonly container: StartedPostgreSqlContainer;
  getConnectionUri(): string;
  stop(): Promise<void>;
}

export async function startPostgres18Container(): Promise<StartedPostgres18Container> {
  const container = await new PostgreSqlContainer("postgres:18.6").start();
  const connectionUri = container.getConnectionUri();
  const client = new Client({ connectionString: connectionUri });

  try {
    await client.connect();
    const res = await client.query("SHOW server_version");
    const serverVersion = res.rows[0]?.server_version as string | undefined;
    if (!serverVersion || !serverVersion.startsWith("18.6")) {
      await container.stop();
      throw new Error(
        `PostgreSQL container server_version does not start with 18.6 (got: ${serverVersion ?? "unknown"})`
      );
    }
  } catch (error) {
    await container.stop().catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }

  return {
    container,
    getConnectionUri: () => container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    }
  };
}
