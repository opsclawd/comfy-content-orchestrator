import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import { insertRepresentativeGraph } from "./test-support/records.js";

describe("PostgreSQL job dispatch schema contract integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../migrations/", import.meta.url);

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
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    // Clean up public schema between tests
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  });

  it("adds the durable job dispatch contract and is a no-op on rerun", async () => {
    // 1. Run runMigrations(client, { migrationsDirectory }) and assert the last applied version is 007
    const applied = await runMigrations(client, { migrationsDirectory });
    expect(applied[applied.length - 1]?.version).toBe("007");

    // 2. Run it again and assert []
    const rerun = await runMigrations(client, { migrationsDirectory });
    expect(rerun).toEqual([]);

    // 3. Call insertRepresentativeGraph(client); then query its render-job row directly for { job_kind: string; lease_token: string | null } and expect { job_kind: "production", lease_token: null }
    const graph = await insertRepresentativeGraph(client);
    const jobRowRes = await client.query<{ job_kind: string; lease_token: string | null }>(
      "SELECT job_kind, lease_token FROM render_jobs WHERE job_id = $1",
      [graph.renderJob.job_id]
    );
    expect(jobRowRes.rows[0]).toEqual({
      job_kind: "production",
      lease_token: null
    });

    // 4. Query information_schema.columns for job_kind and lease_token; assert job_kind has udt_name = "job_kind_enum", is_nullable = "NO", and a normalized default containing production, while lease_token has udt_name = "uuid" and is_nullable = "YES"
    const columnsRes = await client.query<{
      column_name: string;
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `
      SELECT column_name, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'render_jobs'
        AND column_name IN ('job_kind', 'lease_token')
      ORDER BY column_name ASC
      `
    );
    const jobKindCol = columnsRes.rows.find((c) => c.column_name === "job_kind");
    const leaseTokenCol = columnsRes.rows.find((c) => c.column_name === "lease_token");

    expect(jobKindCol).toBeDefined();
    expect(jobKindCol?.udt_name).toBe("job_kind_enum");
    expect(jobKindCol?.is_nullable).toBe("NO");
    expect(jobKindCol?.column_default).toMatch(/production/);

    expect(leaseTokenCol).toBeDefined();
    expect(leaseTokenCol?.udt_name).toBe("uuid");
    expect(leaseTokenCol?.is_nullable).toBe("YES");

    // 5. Query pg_enum in enum sort order and assert job_kind_enum labels equal ["candidate", "production"]
    const enumRes = await client.query<{ enumlabel: string }>(
      `
      SELECT e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'job_kind_enum'
      ORDER BY e.enumsortorder ASC
      `
    );
    expect(enumRes.rows.map((r) => r.enumlabel)).toEqual(["candidate", "production"]);

    // 6. Query pg_indexes by exact index name and assert the normalized definition contains (status, lease_expires_at, created_at) and predicate labels queued, leased, and rendering in order
    const indexRes = await client.query<{ indexname: string; indexdef: string }>(
      `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'render_jobs'
        AND indexname = 'idx_render_jobs_queue'
      `
    );
    expect(indexRes.rows).toHaveLength(1);
    const indexdef = indexRes.rows[0]?.indexdef ?? "";
    expect(indexdef).toContain("(status, lease_expires_at, created_at)");
    expect(indexdef).toMatch(/WHERE.*queued.*leased.*rendering/i);
  });
});
