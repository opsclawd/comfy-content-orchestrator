import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";

describe("PostgreSQL migration runner integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri()
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
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    // Clean up public schema between tests
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });

  async function createTempMigrationDir(files: Record<string, string>): Promise<URL> {
    const dir = await mkdtemp(join(tmpdir(), "migration-test-"));
    tempDirs.push(dir);
    for (const [filename, content] of Object.entries(files)) {
      await writeFile(join(dir, filename), content, "utf-8");
    }
    return pathToFileURL(dir + "/");
  }

  it("starts the exact PostgreSQL 18.6 server required by the schema", async () => {
    const res = await client.query("SHOW server_version");
    const version = res.rows[0]?.server_version as string;
    expect(version).toBeDefined();
    expect(version.startsWith("18.6")).toBe(true);
  });

  it("applies unseen migrations in numeric filename order and skips them on rerun", async () => {
    const migrationsDir = await createTempMigrationDir({
      "001_create_probe.sql": "CREATE TABLE probe (id INT PRIMARY KEY, name TEXT);",
      "002_insert_probe.sql": "INSERT INTO probe (id, name) VALUES (1, 'initial');"
    });

    const applied = await runMigrations(client, { migrationsDirectory: migrationsDir });

    expect(applied).toHaveLength(2);
    expect(applied[0]?.version).toBe("001");
    expect(applied[1]?.version).toBe("002");

    const schemaRes = await client.query(
      "SELECT version, checksum FROM schema_migrations ORDER BY version ASC"
    );
    expect(schemaRes.rows).toHaveLength(2);
    expect(schemaRes.rows[0]?.version).toBe("001");
    expect(schemaRes.rows[1]?.version).toBe("002");

    const probeRes = await client.query("SELECT id, name FROM probe");
    expect(probeRes.rows).toEqual([{ id: 1, name: "initial" }]);

    // Rerun migrations
    const rerunApplied = await runMigrations(client, { migrationsDirectory: migrationsDir });
    expect(rerunApplied).toEqual([]);

    const probeResAfterRerun = await client.query("SELECT id, name FROM probe");
    expect(probeResAfterRerun.rows).toEqual([{ id: 1, name: "initial" }]);
  });

  it("rolls back a failed migration without recording it and releases the migration lock", async () => {
    const migrationsDir = await createTempMigrationDir({
      "001_create_probe.sql": "CREATE TABLE probe (id INT PRIMARY KEY, name TEXT);",
      "002_invalid.sql": "INVALID SQL STATEMENT;"
    });

    await expect(runMigrations(client, { migrationsDirectory: migrationsDir })).rejects.toThrow();

    // 001 committed
    const probeRes = await client.query("SELECT to_regclass('public.probe') AS table_exists");
    expect(probeRes.rows[0]?.table_exists).not.toBeNull();

    // 001 recorded, 002 absent
    const schemaRes = await client.query(
      "SELECT version FROM schema_migrations ORDER BY version ASC"
    );
    expect(schemaRes.rows).toEqual([{ version: "001" }]);

    // Lock was released: subsequent migration run or advisory lock acquisition succeeds
    const validMigrationsDir = await createTempMigrationDir({
      "001_create_probe.sql": "CREATE TABLE probe (id INT PRIMARY KEY, name TEXT);",
      "002_insert_probe.sql": "INSERT INTO probe (id, name) VALUES (2, 'after_recovery');"
    });

    const secondRunApplied = await runMigrations(client, {
      migrationsDirectory: validMigrationsDir
    });
    expect(secondRunApplied).toHaveLength(1);
    expect(secondRunApplied[0]?.version).toBe("002");
  });

  it("rejects changed content for an already applied migration before applying later files", async () => {
    const initialDir = await createTempMigrationDir({
      "001_create_probe.sql": "CREATE TABLE probe (id INT PRIMARY KEY, name TEXT);"
    });

    const applied = await runMigrations(client, { migrationsDirectory: initialDir });
    expect(applied).toHaveLength(1);

    const driftedDir = await createTempMigrationDir({
      "001_create_probe.sql": "CREATE TABLE probe (id INT PRIMARY KEY, modified_name TEXT);",
      "002_insert_probe.sql": "INSERT INTO probe (id, modified_name) VALUES (1, 'drift');"
    });

    await expect(runMigrations(client, { migrationsDirectory: driftedDir })).rejects.toThrow(
      /checksum drift/i
    );

    // 002 was not applied
    const schemaRes = await client.query("SELECT version FROM schema_migrations");
    expect(schemaRes.rows).toEqual([{ version: "001" }]);
  });

  it("rejects migration run when an already applied migration is missing from filesystem", async () => {
    const initialDir = await createTempMigrationDir({
      "001_create_probe.sql": "CREATE TABLE probe (id INT PRIMARY KEY, name TEXT);",
      "002_insert_probe.sql": "INSERT INTO probe (id, name) VALUES (1, 'initial');"
    });

    const applied = await runMigrations(client, { migrationsDirectory: initialDir });
    expect(applied).toHaveLength(2);

    const missingDir = await createTempMigrationDir({
      "002_insert_probe.sql": "INSERT INTO probe (id, name) VALUES (1, 'initial');"
    });

    await expect(runMigrations(client, { migrationsDirectory: missingDir })).rejects.toThrow(
      /missing from filesystem/i
    );
  });

  it("upgrades a database with existing Sprint 1 data (001 and 002) to latest (003) without data loss or corruption", async () => {
    const migrationsRepoDir = new URL("../../migrations/", import.meta.url);
    const m001 = await readFile(new URL("001_baseline.sql", migrationsRepoDir), "utf-8");
    const m002 = await readFile(new URL("002_audit_protections.sql", migrationsRepoDir), "utf-8");
    const m003 = await readFile(new URL("003_candidate_selection.sql", migrationsRepoDir), "utf-8");

    const stageDir = await createTempMigrationDir({
      "001_baseline.sql": m001,
      "002_audit_protections.sql": m002
    });

    // Migrate to Sprint 1 baseline
    const stage1Applied = await runMigrations(client, { migrationsDirectory: stageDir });
    expect(stage1Applied).toHaveLength(2);

    // Insert Sprint 1 baseline data
    const clientRes = await client.query<{ client_id: string }>(
      "INSERT INTO clients (company_name) VALUES ('Upgrade Test Client') RETURNING client_id"
    );
    const clientId = clientRes.rows[0]!.client_id;

    const campRes = await client.query<{ campaign_id: string }>(
      "INSERT INTO campaigns (client_id, title) VALUES ($1, 'Upgrade Campaign') RETURNING campaign_id",
      [clientId]
    );
    const campaignId = campRes.rows[0]!.campaign_id;

    const sceneRes = await client.query<{ scene_id: string }>(
      "INSERT INTO storyboard_scenes (campaign_id, scene_order, shot_type, visual_description) VALUES ($1, 1, 'wide', 'Sunrise over the hills') RETURNING scene_id",
      [campaignId]
    );
    const sceneId = sceneRes.rows[0]!.scene_id;

    // Now introduce 003 into the directory
    await writeFile(join(fileURLToPath(stageDir), "003_candidate_selection.sql"), m003, "utf-8");

    // Run forward migration
    const stage2Applied = await runMigrations(client, { migrationsDirectory: stageDir });
    expect(stage2Applied).toHaveLength(1);
    expect(stage2Applied[0]?.version).toBe("003");

    // Verify pre-existing scene upgraded with defaults
    const sceneCheck = await client.query<{
      spec_revision: number;
      selected_candidate_id: string | null;
      selected_candidate_revision: number | null;
    }>(
      "SELECT spec_revision, selected_candidate_id, selected_candidate_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneId]
    );

    expect(sceneCheck.rows[0]?.spec_revision).toBe(1);
    expect(sceneCheck.rows[0]?.selected_candidate_id).toBeNull();
    expect(sceneCheck.rows[0]?.selected_candidate_revision).toBeNull();

    // Insert candidate for upgraded scene
    const candRes = await client.query<{ candidate_id: string }>(
      `INSERT INTO storyboard_candidates (
        scene_id, scene_spec_revision, variant_ordinal, storage_bucket, storage_object_key, content_hash_sha256
      ) VALUES ($1, 1, 1, 'upgrade-bucket', 'upgrade-key.webp', $2) RETURNING candidate_id`,
      [sceneId, "b".repeat(64)]
    );
    const candidateId = candRes.rows[0]!.candidate_id;

    // Select the candidate on the upgraded scene
    await client.query(
      "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
      [candidateId, sceneId]
    );

    // Insert candidate_select review event with idempotency columns
    const eventRes = await client.query<{ event_id: string; action: string }>(
      `INSERT INTO review_events (
        scene_id, action, expected_spec_revision, resulting_spec_revision, request_hash_sha256
      ) VALUES ($1, 'candidate_select', 1, 1, $2) RETURNING event_id, action`,
      [sceneId, "c".repeat(64)]
    );
    expect(eventRes.rows[0]?.action).toBe("candidate_select");
  });
});
