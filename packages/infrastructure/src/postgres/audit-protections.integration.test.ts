import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient, type DatabaseError } from "pg";
import { runMigrations } from "./migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "./test-support/postgres-18.js";
import {
  insertRepresentativeGraph,
  insertGenerationManifestRecord,
  insertStoryboardCandidateRecord,
  type RepresentativeGraph
} from "./test-support/records.js";

describe("PostgreSQL audit immutability and application-role privileges integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  let graph: RepresentativeGraph;
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
    // Clean up public schema and create non-owner application role
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await client.query("DROP ROLE IF EXISTS orchestrator_app;");
    await client.query("CREATE ROLE orchestrator_app NOLOGIN;");

    await runMigrations(client, {
      migrationsDirectory,
      applicationRole: "orchestrator_app"
    });

    graph = await insertRepresentativeGraph(client);
  });

  it("rejects UPDATE on generation_manifests through the immutability trigger", async () => {
    await client.query("BEGIN");
    let caughtError: Error | undefined;
    try {
      await client.query(
        "UPDATE generation_manifests SET prompt_id_comfy = $1 WHERE manifest_id = $2",
        ["tampered_prompt_id", graph.manifest.manifest_id]
      );
    } catch (err) {
      caughtError = err as Error;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/generation_manifests/i);
    expect(caughtError?.message).toMatch(/UPDATE/i);

    const checkRes = await client.query<{ prompt_id_comfy: string }>(
      "SELECT prompt_id_comfy FROM generation_manifests WHERE manifest_id = $1",
      [graph.manifest.manifest_id]
    );
    expect(checkRes.rows[0]?.prompt_id_comfy).toBe(graph.manifest.prompt_id_comfy);
  });

  it("rejects DELETE on generation_manifests through the immutability trigger", async () => {
    await client.query("BEGIN");
    let caughtError: Error | undefined;
    try {
      await client.query("DELETE FROM generation_manifests WHERE manifest_id = $1", [
        graph.manifest.manifest_id
      ]);
    } catch (err) {
      caughtError = err as Error;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/generation_manifests/i);
    expect(caughtError?.message).toMatch(/DELETE/i);

    const checkRes = await client.query<{ manifest_id: string }>(
      "SELECT manifest_id FROM generation_manifests WHERE manifest_id = $1",
      [graph.manifest.manifest_id]
    );
    expect(checkRes.rows).toHaveLength(1);
    expect(checkRes.rows[0]?.manifest_id).toBe(graph.manifest.manifest_id);
  });

  it("rejects UPDATE on review_events through the append-only trigger", async () => {
    await client.query("BEGIN");
    let caughtError: Error | undefined;
    try {
      await client.query("UPDATE review_events SET director_notes = $1 WHERE event_id = $2", [
        "tampered notes",
        graph.reviewEvent.event_id
      ]);
    } catch (err) {
      caughtError = err as Error;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/review_events/i);
    expect(caughtError?.message).toMatch(/UPDATE/i);

    const checkRes = await client.query<{ director_notes: string | null }>(
      "SELECT director_notes FROM review_events WHERE event_id = $1",
      [graph.reviewEvent.event_id]
    );
    expect(checkRes.rows[0]?.director_notes).toBe(graph.reviewEvent.director_notes);
  });

  it("rejects DELETE on review_events through the append-only trigger", async () => {
    await client.query("BEGIN");
    let caughtError: Error | undefined;
    try {
      await client.query("DELETE FROM review_events WHERE event_id = $1", [
        graph.reviewEvent.event_id
      ]);
    } catch (err) {
      caughtError = err as Error;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/review_events/i);
    expect(caughtError?.message).toMatch(/DELETE/i);

    const checkRes = await client.query<{ event_id: string }>(
      "SELECT event_id FROM review_events WHERE event_id = $1",
      [graph.reviewEvent.event_id]
    );
    expect(checkRes.rows).toHaveLength(1);
    expect(checkRes.rows[0]?.event_id).toBe(graph.reviewEvent.event_id);
  });

  it("rejects UPDATE on storyboard_candidates through the immutability trigger", async () => {
    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: graph.scene.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: "candidates/scene-1/candidate-2.webp"
    });

    await client.query("BEGIN");
    let caughtError: Error | undefined;
    try {
      await client.query(
        "UPDATE storyboard_candidates SET variant_ordinal = 3 WHERE candidate_id = $1",
        [candidate.candidate_id]
      );
    } catch (err) {
      caughtError = err as Error;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/storyboard_candidates/i);
    expect(caughtError?.message).toMatch(/UPDATE/i);

    const checkRes = await client.query<{ variant_ordinal: number }>(
      "SELECT variant_ordinal FROM storyboard_candidates WHERE candidate_id = $1",
      [candidate.candidate_id]
    );
    expect(checkRes.rows[0]?.variant_ordinal).toBe(2);
  });

  it("rejects DELETE on storyboard_candidates through the immutability trigger", async () => {
    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: graph.scene.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 3,
      storageBucket: "godzspeed-temp",
      storageObjectKey: "candidates/scene-1/candidate-3.webp"
    });

    await client.query("BEGIN");
    let caughtError: Error | undefined;
    try {
      await client.query("DELETE FROM storyboard_candidates WHERE candidate_id = $1", [
        candidate.candidate_id
      ]);
    } catch (err) {
      caughtError = err as Error;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/storyboard_candidates/i);
    expect(caughtError?.message).toMatch(/DELETE/i);

    const checkRes = await client.query<{ candidate_id: string }>(
      "SELECT candidate_id FROM storyboard_candidates WHERE candidate_id = $1",
      [candidate.candidate_id]
    );
    expect(checkRes.rows).toHaveLength(1);
    expect(checkRes.rows[0]?.candidate_id).toBe(candidate.candidate_id);
  });

  it("grants the application role SELECT and INSERT but not UPDATE or DELETE on audit tables", async () => {
    // Check schema usage
    const schemaUsageRes = await client.query<{ has_usage: boolean }>(
      "SELECT has_schema_privilege('orchestrator_app', 'public', 'USAGE') AS has_usage"
    );
    expect(schemaUsageRes.rows[0]?.has_usage).toBe(true);

    // Check CRUD privileges on domain tables
    for (const domainTable of [
      "campaigns",
      "clients",
      "storyboard_scenes",
      "render_jobs",
      "reference_assets",
      "license_registry"
    ]) {
      const privsRes = await client.query<{
        has_select: boolean;
        has_insert: boolean;
        has_update: boolean;
        has_delete: boolean;
      }>(
        `SELECT
          has_table_privilege('orchestrator_app', $1, 'SELECT') AS has_select,
          has_table_privilege('orchestrator_app', $1, 'INSERT') AS has_insert,
          has_table_privilege('orchestrator_app', $1, 'UPDATE') AS has_update,
          has_table_privilege('orchestrator_app', $1, 'DELETE') AS has_delete`,
        [domainTable]
      );
      expect(privsRes.rows[0]).toEqual({
        has_select: true,
        has_insert: true,
        has_update: true,
        has_delete: true
      });
    }

    // Check privileges on generation_manifests
    const gmPrivsRes = await client.query<{
      has_select: boolean;
      has_insert: boolean;
      has_update: boolean;
      has_delete: boolean;
    }>(
      `SELECT
        has_table_privilege('orchestrator_app', 'generation_manifests', 'SELECT') AS has_select,
        has_table_privilege('orchestrator_app', 'generation_manifests', 'INSERT') AS has_insert,
        has_table_privilege('orchestrator_app', 'generation_manifests', 'UPDATE') AS has_update,
        has_table_privilege('orchestrator_app', 'generation_manifests', 'DELETE') AS has_delete`
    );
    expect(gmPrivsRes.rows[0]).toEqual({
      has_select: true,
      has_insert: true,
      has_update: false,
      has_delete: false
    });

    // Check privileges on review_events
    const rePrivsRes = await client.query<{
      has_select: boolean;
      has_insert: boolean;
      has_update: boolean;
      has_delete: boolean;
    }>(
      `SELECT
        has_table_privilege('orchestrator_app', 'review_events', 'SELECT') AS has_select,
        has_table_privilege('orchestrator_app', 'review_events', 'INSERT') AS has_insert,
        has_table_privilege('orchestrator_app', 'review_events', 'UPDATE') AS has_update,
        has_table_privilege('orchestrator_app', 'review_events', 'DELETE') AS has_delete`
    );
    expect(rePrivsRes.rows[0]).toEqual({
      has_select: true,
      has_insert: true,
      has_update: false,
      has_delete: false
    });

    // Check privileges on storyboard_candidates
    const scPrivsRes = await client.query<{
      has_select: boolean;
      has_insert: boolean;
      has_update: boolean;
      has_delete: boolean;
    }>(
      `SELECT
        has_table_privilege('orchestrator_app', 'storyboard_candidates', 'SELECT') AS has_select,
        has_table_privilege('orchestrator_app', 'storyboard_candidates', 'INSERT') AS has_insert,
        has_table_privilege('orchestrator_app', 'storyboard_candidates', 'UPDATE') AS has_update,
        has_table_privilege('orchestrator_app', 'storyboard_candidates', 'DELETE') AS has_delete`
    );
    expect(scPrivsRes.rows[0]).toEqual({
      has_select: true,
      has_insert: true,
      has_update: false,
      has_delete: false
    });

    // Verify migration fails if configured application role does not exist
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await expect(
      runMigrations(client, {
        migrationsDirectory,
        applicationRole: "nonexistent_role_xyz"
      })
    ).rejects.toThrow(/nonexistent_role_xyz/i);

    // Verify migration fails if configured role has effective superuser/inherited mutation privileges
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await client.query("DROP ROLE IF EXISTS superuser_app; CREATE ROLE superuser_app SUPERUSER;");
    try {
      await expect(
        runMigrations(client, {
          migrationsDirectory,
          applicationRole: "superuser_app"
        })
      ).rejects.toThrow(/effective UPDATE or DELETE privilege/i);
    } finally {
      await client.query("DROP ROLE IF EXISTS superuser_app;");
    }

    // Verify migration succeeds when no application role is configured
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const noRoleApplied = await runMigrations(client, { migrationsDirectory });
    expect(noRoleApplied).toHaveLength(6);
  });

  it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
    // Reset schema to run partial migrations up through 002
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

    const tempDir = await mkdtemp(join(tmpdir(), "migration-candidate-priv-"));
    const srcDir = fileURLToPath(migrationsDirectory);
    await cp(join(srcDir, "001_baseline.sql"), join(tempDir, "001_baseline.sql"));
    await cp(join(srcDir, "002_audit_protections.sql"), join(tempDir, "002_audit_protections.sql"));
    const partialMigrationsDir = pathToFileURL(tempDir + "/");

    try {
      // Apply baseline migrations 001 and 002
      await runMigrations(client, {
        migrationsDirectory: partialMigrationsDir,
        applicationRole: "orchestrator_app"
      });

      // Create an application role that inherits mutation privileges on new tables via a group
      await client.query("DROP ROLE IF EXISTS overprivileged_group;");
      await client.query("DROP ROLE IF EXISTS overprivileged_app;");
      await client.query("CREATE ROLE overprivileged_group NOLOGIN;");
      await client.query("CREATE ROLE overprivileged_app NOLOGIN;");
      await client.query("GRANT overprivileged_group TO overprivileged_app;");
      await client.query(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT UPDATE ON TABLES TO overprivileged_group;"
      );

      // Now apply migration 003 with the overprivileged application role
      await expect(
        runMigrations(client, {
          migrationsDirectory,
          applicationRole: "overprivileged_app"
        })
      ).rejects.toThrow(
        /Application role overprivileged_app still has effective UPDATE or DELETE privilege on storyboard_candidates/i
      );
    } finally {
      await client
        .query(
          "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE ON TABLES FROM overprivileged_group;"
        )
        .catch(() => {});
      await client
        .query(
          "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM overprivileged_app, overprivileged_group;"
        )
        .catch(() => {});
      await client.query("DROP ROLE IF EXISTS overprivileged_app;").catch(() => {});
      await client.query("DROP ROLE IF EXISTS overprivileged_group;").catch(() => {});
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects a second generation manifest for the same render job", async () => {
    await client.query("BEGIN");
    let caughtError: DatabaseError | undefined;
    try {
      await insertGenerationManifestRecord(client, {
        jobId: graph.renderJob.job_id,
        campaignId: graph.campaign.campaign_id,
        sceneId: graph.scene.scene_id
      });
    } catch (err) {
      caughtError = err as DatabaseError;
    } finally {
      await client.query("ROLLBACK");
    }

    expect(caughtError).toBeDefined();
    // PostgreSQL error code for unique_violation is '23505'
    expect(caughtError?.code).toBe("23505");

    const countRes = await client.query<{ count: string }>(
      "SELECT count(*) FROM generation_manifests WHERE job_id = $1",
      [graph.renderJob.job_id]
    );
    expect(parseInt(countRes.rows[0]?.count ?? "0", 10)).toBe(1);
  });

  it("restricts parent deletes that would erase render or review audit history", async () => {
    // 1. Deleting render_jobs referenced by generation_manifests
    await client.query("BEGIN");
    let caughtJobError: DatabaseError | undefined;
    try {
      await client.query("DELETE FROM render_jobs WHERE job_id = $1", [graph.renderJob.job_id]);
    } catch (err) {
      caughtJobError = err as DatabaseError;
    } finally {
      await client.query("ROLLBACK");
    }
    expect(caughtJobError).toBeDefined();
    expect(["23001", "23503"]).toContain(caughtJobError?.code); // restrict_violation / foreign_key_violation

    // 2. Deleting storyboard_scenes referenced by generation_manifests / review_events
    await client.query("BEGIN");
    let caughtSceneError: DatabaseError | undefined;
    try {
      await client.query("DELETE FROM storyboard_scenes WHERE scene_id = $1", [
        graph.scene.scene_id
      ]);
    } catch (err) {
      caughtSceneError = err as DatabaseError;
    } finally {
      await client.query("ROLLBACK");
    }
    expect(caughtSceneError).toBeDefined();
    expect(["23001", "23503"]).toContain(caughtSceneError?.code); // restrict_violation / foreign_key_violation

    // 3. Deleting campaigns referenced by generation_manifests / storyboard_scenes
    await client.query("BEGIN");
    let caughtCampaignError: DatabaseError | undefined;
    try {
      await client.query("DELETE FROM campaigns WHERE campaign_id = $1", [
        graph.campaign.campaign_id
      ]);
    } catch (err) {
      caughtCampaignError = err as DatabaseError;
    } finally {
      await client.query("ROLLBACK");
    }
    expect(caughtCampaignError).toBeDefined();
    expect(["23001", "23503"]).toContain(caughtCampaignError?.code); // restrict_violation / foreign_key_violation

    // 4. Deleting clients referenced by campaigns / reference_assets
    await client.query("BEGIN");
    let caughtClientError: DatabaseError | undefined;
    try {
      await client.query("DELETE FROM clients WHERE client_id = $1", [graph.client.client_id]);
    } catch (err) {
      caughtClientError = err as DatabaseError;
    } finally {
      await client.query("ROLLBACK");
    }
    expect(caughtClientError).toBeDefined();
    expect(["23001", "23503"]).toContain(caughtClientError?.code); // restrict_violation / foreign_key_violation

    // Verify all records still exist intact
    const gmCheck = await client.query<{ manifest_id: string }>(
      "SELECT manifest_id FROM generation_manifests WHERE manifest_id = $1",
      [graph.manifest.manifest_id]
    );
    expect(gmCheck.rows).toHaveLength(1);

    const reCheck = await client.query<{ event_id: string }>(
      "SELECT event_id FROM review_events WHERE event_id = $1",
      [graph.reviewEvent.event_id]
    );
    expect(reCheck.rows).toHaveLength(1);
  });
});
