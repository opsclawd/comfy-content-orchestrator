import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { PoolClient } from "pg";

export interface MigrationRunOptions {
  readonly migrationsDirectory: URL;
  readonly applicationRole?: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
}

interface DiscoveredMigration {
  readonly filename: string;
  readonly version: string;
  readonly numericPrefix: number;
  readonly checksum: string;
  readonly sqlContent: string;
}

const MIGRATION_LOCK_ID = "7492840192840192";
const MIGRATION_FILENAME_PATTERN = /^(\d+)_([a-z0-9_]+)\.sql$/;

export async function runMigrations(
  client: PoolClient,
  options: MigrationRunOptions
): Promise<readonly AppliedMigration[]> {
  const dirPath = fileURLToPath(options.migrationsDirectory);
  const dirEntries = await readdir(dirPath, { withFileTypes: true });

  const migrations: DiscoveredMigration[] = [];
  const seenPrefixes = new Set<number>();

  for (const entry of dirEntries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = entry.name.match(MIGRATION_FILENAME_PATTERN);
    if (!match) {
      continue;
    }

    const rawPrefix = match[1];
    if (rawPrefix === undefined) {
      continue;
    }
    const numericPrefix = parseInt(rawPrefix, 10);
    if (seenPrefixes.has(numericPrefix)) {
      throw new Error(`Duplicate numeric migration prefix detected: ${rawPrefix} (${entry.name})`);
    }
    seenPrefixes.add(numericPrefix);

    const filePath = join(dirPath, entry.name);
    const contentBuffer = await readFile(filePath);
    const checksum = createHash("sha256").update(contentBuffer).digest("hex");
    const sqlContent = contentBuffer.toString("utf-8");

    migrations.push({
      filename: entry.name,
      version: rawPrefix,
      numericPrefix,
      checksum,
      sqlContent
    });
  }

  // Sort migrations in ascending numeric prefix order
  migrations.sort((a, b) => a.numericPrefix - b.numericPrefix);

  // Acquire session advisory lock
  await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`);

  try {
    // Create schema_migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Fetch applied migrations
    const recordedRes = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version ASC"
    );
    const recordedMap = new Map<string, string>();
    for (const row of recordedRes.rows) {
      recordedMap.set(row.version, row.checksum);
    }

    // Verify all previously applied migrations are present on the filesystem
    const discoveredVersions = new Set(migrations.map((m) => m.version));
    for (const appliedVersion of recordedMap.keys()) {
      if (!discoveredVersions.has(appliedVersion)) {
        throw new Error(
          `Applied migration ${appliedVersion} is missing from filesystem migrations`
        );
      }
    }

    // Verify checksum drift on previously applied migrations
    for (const migration of migrations) {
      const recordedChecksum = recordedMap.get(migration.version);
      if (recordedChecksum !== undefined && recordedChecksum !== migration.checksum) {
        throw new Error(
          `Checksum drift detected for migration ${migration.version} (${migration.filename}): ` +
            `recorded ${recordedChecksum}, file has ${migration.checksum}`
        );
      }
    }

    // Apply unseen migrations
    const appliedList: AppliedMigration[] = [];
    const appRole = options.applicationRole?.trim();

    for (const migration of migrations) {
      if (recordedMap.has(migration.version)) {
        continue;
      }

      await client.query("BEGIN");
      try {
        if (appRole && appRole.length > 0) {
          await client.query("SELECT set_config('orchestrator.app_role', $1, true)", [appRole]);
        }
        await client.query(migration.sqlContent);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
          migration.version,
          migration.checksum
        ]);
        await client.query("COMMIT");
        appliedList.push(
          Object.freeze({
            version: migration.version,
            checksum: migration.checksum
          })
        );
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    return Object.freeze(appliedList);
  } finally {
    // Release advisory lock
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
  }
}
