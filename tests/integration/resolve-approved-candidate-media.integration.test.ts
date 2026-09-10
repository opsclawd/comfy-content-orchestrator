import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CreateBucketCommand,
  PutObjectCommand,
  insertCampaignRecord,
  insertClientRecord,
  insertStoryboardCandidateRecord,
  insertStoryboardSceneRecord,
  MIGRATIONS_DIRECTORY_URL,
  Pool,
  type PoolClient,
  S3Client,
  startMinioContainer,
  startPostgres18Container,
  type StartedMinioContainer,
  type StartedPostgres18Container
} from "@cco/infrastructure/testing";
import {
  PostgresSceneRepository,
  PostgresStoryboardCandidateRepository,
  runMigrations,
  S3ObjectStorage
} from "@cco/infrastructure";
import {
  ApprovedCandidateMediaHashMismatchError,
  ApprovedCandidateMediaUnavailableError,
  CandidateNotFoundError,
  ResolveApprovedCandidateMediaUseCase,
  type HashBytesPort
} from "@cco/application";
import {
  CandidateIdentityMismatchError,
  CandidateSceneMismatchError,
  StaleCandidateRevisionError,
  type CandidateId,
  type SceneId
} from "@cco/domain";
import { BUCKET_NAMES } from "@cco/shared";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("ResolveApprovedCandidateMedia Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let pool: Pool;
  let sceneRepository: PostgresSceneRepository;
  let candidateRepository: PostgresStoryboardCandidateRepository;

  const hashBytes: HashBytesPort = {
    hashBytes: async (bytes) => sha256Hex(bytes)
  };

  const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
  const expectedHash = sha256Hex(imageBytes);

  beforeAll(async () => {
    [postgresContainer, minioContainer] = await Promise.all([
      startPostgres18Container(),
      startMinioContainer()
    ]);

    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });

    rawS3Client = new S3Client({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    for (const bucket of BUCKET_NAMES) {
      try {
        await rawS3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: unknown) {
        const errorName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (errorName !== "BucketAlreadyExists" && errorName !== "BucketAlreadyOwnedByYou") {
          throw err;
        }
      }
    }

    objectStorage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    sceneRepository = new PostgresSceneRepository(pool);
    candidateRepository = new PostgresStoryboardCandidateRepository(pool);
  }, 120_000);

  afterAll(async () => {
    if (rawS3Client) {
      rawS3Client.destroy();
    }
    if (minioContainer) {
      await minioContainer.stop();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
      await runMigrations(client, { migrationsDirectory: MIGRATIONS_DIRECTORY_URL });
    } finally {
      client.release();
    }
  });

  function createUseCase(): ResolveApprovedCandidateMediaUseCase {
    return new ResolveApprovedCandidateMediaUseCase({
      sceneRepository,
      storyboardCandidateRepository: candidateRepository,
      objectStorage,
      hashBytes
    });
  }

  async function setupSceneWithCandidate(
    client: PoolClient,
    options?: {
      sceneSpecRevision?: number;
      candidateSpecRevision?: number;
      selectedRevision?: number;
      approvedRevision?: number;
      contentHashSha256?: string;
      sceneOrder?: number;
    }
  ) {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const sceneSpecRevision = options?.sceneSpecRevision ?? 1;
    const candidateSpecRevision = options?.candidateSpecRevision ?? 1;
    const selectedRevision = options?.selectedRevision ?? 1;
    const approvedRevision = options?.approvedRevision ?? 1;
    const contentHashSha256 = options?.contentHashSha256 ?? expectedHash;

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: options?.sceneOrder ?? 1,
      status: "approved",
      specRevision: sceneSpecRevision
    });

    const candidateRecord = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: candidateSpecRevision,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/${candidateSpecRevision}.png`,
      contentHashSha256
    });

    await client.query(
      `
      UPDATE storyboard_scenes
      SET
        status = 'approved',
        selected_candidate_id = $1,
        selected_candidate_revision = $2,
        approved_by = 'director-1',
        approved_at = CURRENT_TIMESTAMP,
        approved_revision = $3
      WHERE scene_id = $4
      `,
      [candidateRecord.candidate_id, selectedRevision, approvedRevision, sceneRecord.scene_id]
    );

    return { clientRecord, campaign, sceneRecord, candidateRecord };
  }

  it("successfully resolves valid candidate and hash-verifies stored media", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client);

      // Store matching media in MinIO
      await objectStorage.putObject({
        bucket: candidateRecord.storage_bucket,
        key: candidateRecord.storage_object_key,
        body: imageBytes,
        contentType: "image/png"
      });

      const useCase = createUseCase();
      const result = await useCase.execute({
        sceneId: sceneRecord.scene_id as SceneId,
        approvedCandidateId: candidateRecord.candidate_id as CandidateId
      });

      expect(result.input.candidateId).toBe(candidateRecord.candidate_id);
      expect(result.input.sceneId).toBe(sceneRecord.scene_id);
      expect(result.input.specRevision).toBe(1);
      expect(result.input.contentHashSha256).toBe(expectedHash);

      expect(result.media.bucket).toBe(candidateRecord.storage_bucket);
      expect(result.media.key).toBe(candidateRecord.storage_object_key);
      expect(result.media.sha256).toBe(expectedHash);
      expect(result.media.contentType).toBe("image/png");
    } finally {
      client.release();
    }
  });

  it("rejects wrong candidate from the same scene and same revision", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord } = await setupSceneWithCandidate(client);

      const candidateB = await insertStoryboardCandidateRecord(client, {
        sceneId: sceneRecord.scene_id,
        sceneSpecRevision: 1,
        variantOrdinal: 2,
        contentHashSha256: expectedHash
      });

      const useCase = createUseCase();

      // Passing candidate B when candidate A is the selected/approved candidate must fail
      await expect(
        useCase.execute({
          sceneId: sceneRecord.scene_id as SceneId,
          approvedCandidateId: candidateB.candidate_id as CandidateId
        })
      ).rejects.toThrow(CandidateIdentityMismatchError);
    } finally {
      client.release();
    }
  });

  it("rejects candidate belonging to a different scene", async () => {
    const client = await pool.connect();
    try {
      // Drop composite FK to simulate desynced database state where scene selected candidate from another scene
      await client.query(
        "ALTER TABLE storyboard_scenes DROP CONSTRAINT IF EXISTS fk_scene_selected_candidate_revision;"
      );

      const { sceneRecord: scene1 } = await setupSceneWithCandidate(client, { sceneOrder: 1 });
      const { candidateRecord: candidate2 } = await setupSceneWithCandidate(client, {
        sceneOrder: 2
      });

      // Update scene1 to have candidate2 selected
      await client.query(
        `UPDATE storyboard_scenes SET
          selected_candidate_id = $1,
          selected_candidate_revision = 1,
          approved_by = 'director-1',
          approved_at = CURRENT_TIMESTAMP,
          approved_revision = 1
        WHERE scene_id = $2`,
        [candidate2.candidate_id, scene1.scene_id]
      );

      const useCase = createUseCase();

      await expect(
        useCase.execute({
          sceneId: scene1.scene_id as SceneId,
          approvedCandidateId: candidate2.candidate_id as CandidateId
        })
      ).rejects.toThrow(CandidateSceneMismatchError);
    } finally {
      client.release();
    }
  });

  it("rejects candidate with stale specRevision", async () => {
    const client = await pool.connect();
    try {
      // Drop constraints to simulate stale candidate reference in Postgres
      await client.query(
        "ALTER TABLE storyboard_scenes DROP CONSTRAINT IF EXISTS storyboard_scene_selected_revision_current;"
      );
      await client.query(
        "ALTER TABLE storyboard_scenes DROP CONSTRAINT IF EXISTS fk_scene_selected_candidate_revision;"
      );

      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client, {
        sceneSpecRevision: 2,
        candidateSpecRevision: 1,
        selectedRevision: 1,
        approvedRevision: 2
      });

      const useCase = createUseCase();

      await expect(
        useCase.execute({
          sceneId: sceneRecord.scene_id as SceneId,
          approvedCandidateId: candidateRecord.candidate_id as CandidateId
        })
      ).rejects.toThrow(StaleCandidateRevisionError);
    } finally {
      client.release();
    }
  });

  it("rejects non-existent candidate", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord } = await setupSceneWithCandidate(client);

      const useCase = createUseCase();

      await expect(
        useCase.execute({
          sceneId: sceneRecord.scene_id as SceneId,
          approvedCandidateId: "00000000-0000-0000-0000-000000000000" as CandidateId
        })
      ).rejects.toThrow(CandidateNotFoundError);
    } finally {
      client.release();
    }
  });

  it("rejects when media object is missing in storage", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client);

      // Do NOT put object in storage

      const useCase = createUseCase();

      const promise = useCase.execute({
        sceneId: sceneRecord.scene_id as SceneId,
        approvedCandidateId: candidateRecord.candidate_id as CandidateId
      });

      await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
      await expect(promise).rejects.toMatchObject({
        candidateId: candidateRecord.candidate_id,
        reason: "missing"
      });
    } finally {
      client.release();
    }
  });

  it("rejects when media object in storage has mismatched SHA-256 (corrupt)", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client);

      // Put corrupt bytes into MinIO
      const corruptBytes = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
      const corruptHash = sha256Hex(corruptBytes);

      await objectStorage.putObject({
        bucket: candidateRecord.storage_bucket,
        key: candidateRecord.storage_object_key,
        body: corruptBytes,
        contentType: "image/png"
      });

      const useCase = createUseCase();

      const promise = useCase.execute({
        sceneId: sceneRecord.scene_id as SceneId,
        approvedCandidateId: candidateRecord.candidate_id as CandidateId
      });

      await expect(promise).rejects.toThrow(ApprovedCandidateMediaHashMismatchError);
      await expect(promise).rejects.toMatchObject({
        candidateId: candidateRecord.candidate_id,
        expectedSha256: expectedHash,
        actualSha256: corruptHash
      });
    } finally {
      client.release();
    }
  });

  it("rejects with corrupt and preserves cause when S3 object has stored checksum metadata corruption", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client);

      // Put object with mismatched checksum-sha256 in S3 metadata
      await rawS3Client.send(
        new PutObjectCommand({
          Bucket: candidateRecord.storage_bucket,
          Key: candidateRecord.storage_object_key,
          Body: imageBytes,
          ContentType: "image/png",
          Metadata: {
            "checksum-sha256": "0000000000000000000000000000000000000000000000000000000000000000"
          }
        })
      );

      const useCase = createUseCase();

      const promise = useCase.execute({
        sceneId: sceneRecord.scene_id as SceneId,
        approvedCandidateId: candidateRecord.candidate_id as CandidateId
      });

      await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
      await expect(promise).rejects.toMatchObject({
        candidateId: candidateRecord.candidate_id,
        reason: "corrupt"
      });
      const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toMatch(/Checksum mismatch/i);
    } finally {
      client.release();
    }
  });

  it("rejects with unreadable and preserves cause when S3 storage encounters a read/provider failure", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client);

      // Configure an S3 storage with an unreachable endpoint
      const failingStorage = new S3ObjectStorage({
        endpoint: "http://127.0.0.1:9",
        region: "us-east-1",
        credentials: {
          accessKeyId: "dummy",
          secretAccessKey: "dummy"
        },
        forcePathStyle: true
      });

      const failingUseCase = new ResolveApprovedCandidateMediaUseCase({
        sceneRepository,
        storyboardCandidateRepository: candidateRepository,
        objectStorage: failingStorage,
        hashBytes
      });

      const promise = failingUseCase.execute({
        sceneId: sceneRecord.scene_id as SceneId,
        approvedCandidateId: candidateRecord.candidate_id as CandidateId
      });

      await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
      await expect(promise).rejects.toMatchObject({
        candidateId: candidateRecord.candidate_id,
        reason: "unreadable"
      });
      const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
      expect(error.cause).toBeDefined();
    } finally {
      client.release();
    }
  });

  it("rejects with unreadable and preserves cause when media in S3 exceeds maxCandidateImageBytes limit", async () => {
    const client = await pool.connect();
    try {
      const { sceneRecord, candidateRecord } = await setupSceneWithCandidate(client);

      await objectStorage.putObject({
        bucket: candidateRecord.storage_bucket,
        key: candidateRecord.storage_object_key,
        body: imageBytes, // 8 bytes
        contentType: "image/png"
      });

      const limitedUseCase = new ResolveApprovedCandidateMediaUseCase({
        sceneRepository,
        storyboardCandidateRepository: candidateRepository,
        objectStorage,
        hashBytes,
        maxCandidateImageBytes: 4 // bounded to 4 bytes
      });

      const promise = limitedUseCase.execute({
        sceneId: sceneRecord.scene_id as SceneId,
        approvedCandidateId: candidateRecord.candidate_id as CandidateId
      });

      await expect(promise).rejects.toThrow(ApprovedCandidateMediaUnavailableError);
      await expect(promise).rejects.toMatchObject({
        candidateId: candidateRecord.candidate_id,
        reason: "unreadable"
      });
      const error = (await promise.catch((e) => e)) as ApprovedCandidateMediaUnavailableError;
      expect(error.cause).toBeDefined();
      expect((error.cause as Error).message).toMatch(/exceeds maxBytes limit/);
    } finally {
      client.release();
    }
  });
});
