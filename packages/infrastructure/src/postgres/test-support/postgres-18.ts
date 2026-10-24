import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { StopOptions } from "testcontainers";
import { Client, Pool, type PoolClient } from "pg";

export { Client, Pool, type PoolClient };

export interface StartedPostgres18Container {
  readonly container: StartedPostgreSqlContainer;
  getConnectionUri(): string;
  stop(): Promise<void>;
}

async function stopContainerSafely(container: {
  stop: (options?: Partial<StopOptions>) => Promise<unknown>;
}): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await container.stop();
      return;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const is409 =
        msg.includes("409") ||
        msg.includes("cannot remove container") ||
        msg.includes("is running");
      const is404 = msg.includes("404") || msg.includes("No such container");

      if (is404) {
        return;
      }
      if (is409 && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
        continue;
      }
      if (is409) {
        try {
          await container.stop({ remove: false });
          return;
        } catch {
          return;
        }
      }
      throw err;
    }
  }
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
      await stopContainerSafely(container);
      throw new Error(
        `PostgreSQL container server_version does not start with 18.6 (got: ${serverVersion ?? "unknown"})`
      );
    }
  } catch (error) {
    await stopContainerSafely(container).catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }

  return {
    container,
    getConnectionUri: () => container.getConnectionUri(),
    stop: async () => {
      await stopContainerSafely(container);
    }
  };
}
