import { Pool } from "pg";
import { runMigrations } from "./migration-runner.js";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL environment variable is required and cannot be blank.");
    process.exitCode = 1;
    return;
  }

  const applicationRole = process.env.DATABASE_APP_ROLE?.trim();
  const migrationsDirectory = new URL("../../migrations/", import.meta.url);

  const pool = new Pool({ connectionString: databaseUrl });
  let client;

  try {
    client = await pool.connect();
    const options = {
      migrationsDirectory,
      ...(applicationRole && applicationRole.length > 0 ? { applicationRole } : {})
    };
    const applied = await runMigrations(client, options);

    if (applied.length === 0) {
      console.log("No new migrations to apply.");
    } else {
      const versions = applied.map((m) => m.version).join(", ");
      console.log(`Successfully applied ${applied.length} migration(s): ${versions}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration error: ${message}`);
  process.exit(1);
});
