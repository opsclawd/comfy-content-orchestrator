import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertRenderJobRecord,
  insertGenerationManifestRecord
} from "../test-support/records.js";
import { PostgresGenerationManifestRepository } from "./postgres-generation-manifest-repository.js";
import { IncompleteVideoStemSourceError } from "@cco/application";

describe("PostgresGenerationManifestRepository Integration", () => {
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

  const validSha = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  it("finds and translates video stem source from real PostgreSQL row with default contentType", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });
    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed"
    });

    const manifest = await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id,
      manifestPayload: {
        renderProfile: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        outputs: [
          {
            bucket: "cco-rendered-media",
            key: `campaigns/${campaign.campaign_id}/scenes/${scene.scene_id}/output.mp4`,
            checksumSha256: validSha.toUpperCase()
          }
        ]
      }
    });

    const repo = new PostgresGenerationManifestRepository(client);
    const result = await repo.findVideoStemSourceByJobId(job.job_id);

    expect(result).toBeDefined();
    expect(result!.generationManifestId).toBe(manifest.manifest_id);
    expect(result!.media).toEqual({
      bucket: "cco-rendered-media",
      key: `campaigns/${campaign.campaign_id}/scenes/${scene.scene_id}/output.mp4`,
      sha256: validSha.toLowerCase(),
      contentType: "video/mp4"
    });
  });

  it("preserves explicit contentType from real PostgreSQL row", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });
    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed"
    });

    await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id,
      manifestPayload: {
        renderProfile: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        outputs: [
          {
            bucket: "cco-rendered-media",
            key: `campaigns/${campaign.campaign_id}/scenes/${scene.scene_id}/output.mov`,
            checksumSha256: validSha,
            contentType: "video/quicktime"
          }
        ]
      }
    });

    const repo = new PostgresGenerationManifestRepository(client);
    const result = await repo.findVideoStemSourceByJobId(job.job_id);

    expect(result).toBeDefined();
    expect(result!.media.contentType).toBe("video/quicktime");
  });

  it("returns undefined when no manifest exists for jobId", async () => {
    const repo = new PostgresGenerationManifestRepository(client);
    const result = await repo.findVideoStemSourceByJobId("01950c46-9e90-7d3d-82d2-8f1d3c999999");
    expect(result).toBeUndefined();
  });

  it("throws IncompleteVideoStemSourceError when manifest has empty or malformed outputs in PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });
    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed"
    });

    await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id,
      manifestPayload: {
        renderProfile: "LTX_25_720P_5S_V1",
        outputs: []
      }
    });

    const repo = new PostgresGenerationManifestRepository(client);
    await expect(repo.findVideoStemSourceByJobId(job.job_id)).rejects.toThrow(
      IncompleteVideoStemSourceError
    );
  });

  it.each([
    ["missing bucket", { key: "scene.mp4", checksumSha256: validSha }],
    ["missing key", { bucket: "renders", checksumSha256: validSha }],
    ["missing checksum", { bucket: "renders", key: "scene.mp4" }],
    ["malformed checksum", { bucket: "renders", key: "scene.mp4", checksumSha256: "not-a-sha" }]
  ])("rejects real manifest rows with %s", async (caseName, output) => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });
    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed"
    });

    await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id,
      manifestPayload: {
        renderProfile: "LTX_25_720P_5S_V1",
        outputs: [output]
      }
    });

    const repo = new PostgresGenerationManifestRepository(client);
    await expect(repo.findVideoStemSourceByJobId(job.job_id)).rejects.toThrow(
      IncompleteVideoStemSourceError
    );
    expect(caseName).toBeTypeOf("string");
  });

  it("retrieves component identity and outputChecksumsSha256 from real PostgreSQL manifest row", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "approved"
    });
    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed"
    });

    const manifest = await insertGenerationManifestRecord(client, {
      jobId: job.job_id,
      campaignId: campaign.campaign_id,
      sceneId: scene.scene_id,
      manifestPayload: {
        renderProfile: "LTX_25_720P_5S_V1",
        renderProfileVersion: 2,
        outputs: [
          {
            bucket: "cco-rendered-media",
            key: "key1.mp4",
            checksumSha256: validSha
          }
        ]
      }
    });

    const repo = new PostgresGenerationManifestRepository(client);
    const identity = await repo.getComponentIdentityById(manifest.manifest_id);

    expect(identity).toBeDefined();
    expect(identity!.renderProfile).toBe("LTX_25_720P_5S_V1");
    expect(identity!.renderProfileVersion).toBe(2);
    expect(identity!.outputChecksumsSha256).toEqual([validSha]);
  });
});
