import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  CreateCampaignShellUseCase,
  CreateSceneUseCase,
  InstallAcceptanceCampaignFixtureUseCase,
  UploadReferenceAssetUseCase,
  type ObjectLocator,
  type ObjectStoragePort,
  type PutObjectInput,
  type StoredObject
} from "@cco/application";
import { ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN } from "@cco/contracts";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import { insertClientRecord } from "../test-support/records.js";
import { FsAcceptanceFixtureAssetSource } from "../../acceptance/fs-acceptance-fixture-asset-source.js";
import { SharpImageInspectionAdapter } from "../../image/sharp-image-inspection-adapter.js";
import { PostgresReferenceAssetRepository } from "../repositories/postgres-reference-asset-repository.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";

/**
 * In-memory ObjectStoragePort fake. This test exercises the install flow against a REAL
 * PostgreSQL instance (Testcontainers) but fakes object storage, since this repository has
 * no MinIO Testcontainers helper yet — the install use case's own unit tests already cover
 * storage-adapter contract behavior via UploadReferenceAssetUseCase's existing test suite.
 */
class InMemoryObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, StoredObject>();

  private key(locator: ObjectLocator): string {
    return `${locator.bucket}/${locator.key}`;
  }

  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    const locator = { bucket: input.bucket, key: input.key };
    this.objects.set(this.key(locator), {
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {})
    });
    return locator;
  }

  async getObject(locator: ObjectLocator): Promise<StoredObject | undefined> {
    return this.objects.get(this.key(locator));
  }

  async copyObject(from: ObjectLocator, to: ObjectLocator): Promise<ObjectLocator> {
    const existing = this.objects.get(this.key(from));
    if (existing) {
      this.objects.set(this.key(to), { ...existing, bucket: to.bucket, key: to.key });
    }
    return to;
  }

  async deleteObject(locator: ObjectLocator): Promise<void> {
    this.objects.delete(this.key(locator));
  }
}

describe("InstallAcceptanceCampaignFixtureUseCase Integration", () => {
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

  function buildUseCase(): InstallAcceptanceCampaignFixtureUseCase {
    const uow = new PostgresUnitOfWork(pool);
    const referenceAssetRepository = new PostgresReferenceAssetRepository(pool);
    const objectStorage = new InMemoryObjectStorage();
    const imageValidator = new SharpImageInspectionAdapter();

    return new InstallAcceptanceCampaignFixtureUseCase({
      uow,
      createCampaignShellUseCase: new CreateCampaignShellUseCase(uow),
      createSceneUseCase: new CreateSceneUseCase(uow),
      uploadReferenceAssetUseCase: new UploadReferenceAssetUseCase({
        referenceAssetRepository,
        objectStorage,
        imageValidator
      }),
      assetSource: new FsAcceptanceFixtureAssetSource()
    });
  }

  it("creates the campaign shell, 9 scenes, and 5 reference-role assets against real PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const useCase = buildUseCase();

    const result = await useCase.execute({
      clientId: clientRecord.client_id,
      idempotencyKey: randomUUID()
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scenes).toHaveLength(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.length);
    expect(result.referenceAssetsBySlot.size).toBe(5);

    const campaignRows = await client.query(
      "SELECT campaign_id, title, total_scenes FROM campaigns WHERE campaign_id = $1",
      [result.campaign.id]
    );
    expect(campaignRows.rows).toHaveLength(1);
    expect(campaignRows.rows[0]?.total_scenes).toBe(9);

    const sceneRows = await client.query(
      "SELECT scene_id FROM storyboard_scenes WHERE campaign_id = $1",
      [result.campaign.id]
    );
    expect(sceneRows.rows).toHaveLength(9);

    const referenceRows = await client.query(
      "SELECT asset_id, content_hash_sha256 FROM reference_assets WHERE client_id = $1",
      [clientRecord.client_id]
    );
    expect(referenceRows.rows).toHaveLength(5);
  });

  it("is idempotent across a second install with the same idempotency key", async () => {
    const clientRecord = await insertClientRecord(client);
    const idempotencyKey = randomUUID();

    const first = await buildUseCase().execute({
      clientId: clientRecord.client_id,
      idempotencyKey
    });
    expect(first.isIdempotentReplay).toBe(false);

    const second = await buildUseCase().execute({
      clientId: clientRecord.client_id,
      idempotencyKey
    });

    expect(second.isIdempotentReplay).toBe(true);
    expect(second.campaign.id).toBe(first.campaign.id);
    expect(second.scenes).toHaveLength(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.length);

    const campaignRows = await client.query(
      "SELECT campaign_id FROM campaigns WHERE client_id = $1",
      [clientRecord.client_id]
    );
    expect(campaignRows.rows).toHaveLength(1);

    // Regression guard: a second install must converge on the existing 9 scenes, not
    // duplicate them to 18.
    const sceneRows = await client.query(
      "SELECT count(*)::int AS count FROM storyboard_scenes WHERE campaign_id = $1",
      [second.campaign.id]
    );
    expect(sceneRows.rows[0]?.count).toBe(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.length);
  });
});
