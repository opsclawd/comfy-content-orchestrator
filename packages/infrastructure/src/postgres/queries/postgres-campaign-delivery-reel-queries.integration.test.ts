import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { AssemblySpec } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertDeliveryAssemblyJobRecord
} from "../test-support/records.js";
import { PostgresCampaignDeliveryReelQueries } from "./postgres-campaign-delivery-reel-queries.js";

describe("PostgresCampaignDeliveryReelQueries Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);
  const validSha = "a".repeat(64);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN;");
    await runMigrations(client, { migrationsDirectory });
    return async () => {
      await client.query("ROLLBACK;");
      client.release();
    };
  });

  it("returns not-started for a newly created campaign with no assembly jobs or runs", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const queries = new PostgresCampaignDeliveryReelQueries(client);
    const result = await queries.findCanonicalDeliveryAssembly(campaign.campaign_id as CampaignId);

    expect(result).toBeDefined();
    expect(result!.campaignExists).toBe(true);
    expect(result!.status).toBe("not-started");
  });

  it("returns assembling when an active assembly job is queued or leased", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const job = await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      status: "queued"
    });

    const queries = new PostgresCampaignDeliveryReelQueries(client);
    const result = await queries.findCanonicalDeliveryAssembly(campaign.campaign_id as CampaignId);

    expect(result).toBeDefined();
    expect(result!.campaignExists).toBe(true);
    expect(result!.status).toBe("assembling");
    expect(result!.assemblyJobId).toBe(job.job_id);
  });

  it("returns completed with assemblySpec when completed job exists", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const spec: AssemblySpec = {
      campaignId: campaign.campaign_id,
      assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
      expectedTotalDurationMs: 5000,
      videoStems: [
        {
          order: 0,
          sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
          generationManifestId: "01950c46-9e90-7d3d-82d2-8f1d3c000002",
          expectedDurationMs: 5000,
          media: {
            bucket: "delivery",
            key: `campaigns/${campaign.campaign_id}/scenes/s1.mp4`,
            sha256: validSha,
            contentType: "video/mp4"
          }
        }
      ],
      subtitleCues: []
    };

    const job = await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaign.campaign_id,
      status: "completed",
      assemblySpec: spec
    });

    const queries = new PostgresCampaignDeliveryReelQueries(client);
    const result = await queries.findCanonicalDeliveryAssembly(campaign.campaign_id as CampaignId);

    expect(result).toBeDefined();
    expect(result!.campaignExists).toBe(true);
    expect(result!.status).toBe("completed");
    expect(result!.assemblyJobId).toBe(job.job_id);
    expect(result!.assemblySpec).toEqual(spec);
  });

  it("enforces multi-tenant campaign isolation in PostgreSQL query", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaignA = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const campaignB = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    await insertDeliveryAssemblyJobRecord(client, {
      campaignId: campaignA.campaign_id,
      status: "completed"
    });

    const queries = new PostgresCampaignDeliveryReelQueries(client);

    // Query Campaign B, which has no jobs
    const resultB = await queries.findCanonicalDeliveryAssembly(
      campaignB.campaign_id as CampaignId
    );

    expect(resultB).toBeDefined();
    expect(resultB!.campaignExists).toBe(true);
    expect(resultB!.status).toBe("not-started");
    expect(resultB!.assemblyJobId).toBeUndefined();
  });
});
