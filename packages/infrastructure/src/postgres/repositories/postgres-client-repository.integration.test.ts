import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { ClientRecord } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { PostgresClientRepository } from "./postgres-client-repository.js";

describe("PostgresClientRepository Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });
  }, 120_000);

  afterAll(async () => {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  it("returns undefined for non-existent client", async () => {
    const repository = new PostgresClientRepository(client);
    const result = await repository.findById("018e69e0-8a6a-72cb-b1b7-ec79a1f73899");
    expect(result).toBeUndefined();
  });

  it("returns undefined for archived client", async () => {
    const repository = new PostgresClientRepository(client);
    const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";

    const clientRecord: ClientRecord = {
      id: clientId,
      companyName: "Archived Studios",
      brandBibleJson: { palette: ["#ffffff"] },
      defaultAspectRatio: "9:16",
      externalProcessingPolicy: { allowCloudPlanning: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(clientRecord);
    await client.query("UPDATE clients SET archived_at = CURRENT_TIMESTAMP WHERE client_id = $1", [
      clientId
    ]);

    const result = await repository.findById(clientId);
    expect(result).toBeUndefined();
  });

  it("inserts and finds a client by id", async () => {
    const repository = new PostgresClientRepository(client);
    const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73802";

    const clientRecord: ClientRecord = {
      id: clientId,
      companyName: "Acme Caribbean Productions",
      brandBibleJson: { palette: ["#FF5722", "#212121"], tagline: "Pure Energy" },
      defaultAspectRatio: "16:9",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowCloudVisualQA: true,
        allowCloudVoice: false,
        allowedProviders: ["Anthropic", "ElevenLabs"],
        sensitiveDataMasking: true
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(clientRecord);

    const retrieved = await repository.findById(clientId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(clientId);
    expect(retrieved?.companyName).toBe("Acme Caribbean Productions");
    expect(retrieved?.brandBibleJson).toEqual({
      palette: ["#FF5722", "#212121"],
      tagline: "Pure Energy"
    });
    expect(retrieved?.defaultAspectRatio).toBe("16:9");
    expect(retrieved?.externalProcessingPolicy).toEqual({
      allowCloudPlanning: true,
      allowCloudVisualQA: true,
      allowCloudVoice: false,
      allowedProviders: ["Anthropic", "ElevenLabs"],
      sensitiveDataMasking: true
    });
    expect(retrieved?.createdAt).toBeDefined();
    expect(retrieved?.updatedAt).toBeDefined();
  });

  it("updates existing client on conflict", async () => {
    const repository = new PostgresClientRepository(client);
    const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73803";

    const initialRecord: ClientRecord = {
      id: clientId,
      companyName: "Original Name",
      brandBibleJson: { version: 1 },
      defaultAspectRatio: "9:16",
      externalProcessingPolicy: { allowCloudPlanning: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await repository.save(initialRecord);

    const updatedRecord: ClientRecord = {
      ...initialRecord,
      companyName: "Updated Name",
      brandBibleJson: { version: 2 },
      defaultAspectRatio: "1:1"
    };

    await repository.save(updatedRecord);

    const retrieved = await repository.findById(clientId);
    expect(retrieved?.companyName).toBe("Updated Name");
    expect(retrieved?.brandBibleJson).toEqual({ version: 2 });
    expect(retrieved?.defaultAspectRatio).toBe("1:1");
  });
});
