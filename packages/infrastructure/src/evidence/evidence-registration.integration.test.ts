import crypto from "node:crypto";
import sharp from "sharp";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { BUCKETS, BUCKET_NAMES, generateUuidV7 } from "@cco/shared";
import {
  AccessDeniedError,
  CrossBatchSourceError,
  IdempotencyConflictError,
  MimeConflictError,
  ReportDisputedError,
  createBatchId,
  createClientId,
  createEvidenceId,
  createSkuId,
  type Sha256Hex
} from "@cco/domain";
import {
  DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
  RegisterEvidenceAssetUseCase,
  LinkExistingDerivativeUseCase,
  RecordEvidenceVerificationEventUseCase
} from "@cco/application";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../postgres/test-support/postgres-18.js";
import { startMinioContainer, type StartedMinioContainer } from "../storage/test-support/minio.js";
import { runMigrations } from "../postgres/migration-runner.js";
import { insertClientRecord } from "../postgres/test-support/records.js";
import { PostgresUnitOfWork } from "../postgres/uow/postgres-unit-of-work.js";
import { S3ObjectStorage } from "../storage/s3-object-storage.js";
import { OriginalsInspectionAdapter } from "./originals-inspection-adapter.js";
import { PostgresEvidenceLockCoordinator } from "./postgres-evidence-lock-coordinator.js";

describe("Evidence registration and derivative integration tests", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let client: PoolClient;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let lockCoordinator: PostgresEvidenceLockCoordinator;
  let originalsInspector: OriginalsInspectionAdapter;
  let unitOfWork: PostgresUnitOfWork;

  const migrationsDirectory = new URL("../../migrations/", import.meta.url);

  beforeAll(async () => {
    [postgresContainer, minioContainer] = await Promise.all([
      startPostgres18Container(),
      startMinioContainer()
    ]);

    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri()
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
        const name =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (name !== "BucketAlreadyExists" && name !== "BucketAlreadyOwnedByYou") {
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

    lockCoordinator = new PostgresEvidenceLockCoordinator(pool);
    originalsInspector = new OriginalsInspectionAdapter();
    unitOfWork = new PostgresUnitOfWork(pool);
  }, 120_000);

  afterAll(async () => {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
    await Promise.all([postgresContainer?.stop(), minioContainer?.stop()]);
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  async function createSyntheticJpeg(width = 64, height = 64): Promise<Buffer> {
    return await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 120, g: 150, b: 200 }
      }
    })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  async function seedSkuAndBatch(
    clientIdStr: string,
    skuIdStr: string,
    batchIdStr: string,
    lotIdentifier: string
  ) {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO product_skus
           (client_id, sku_id, canonical_sku, display_name, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
         ON CONFLICT (client_id, sku_id) DO NOTHING`,
        [clientIdStr, skuIdStr, `SKU-${lotIdentifier}`, `Display ${lotIdentifier}`]
      );

      await client.query(
        `INSERT INTO product_batches
           (client_id, batch_id, sku_id, lot_identifier, display_name, version, current_facts_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, 1, NOW(), NOW())`,
        [clientIdStr, batchIdStr, skuIdStr, lotIdentifier, `Batch ${lotIdentifier}`]
      );

      await client.query(
        `INSERT INTO product_batch_facts
           (client_id, batch_id, revision, origin_kind, asserted_by, asserted_at)
         VALUES ($1, $2, 1, 'own_production', 'tester@example.com', NOW())`,
        [clientIdStr, batchIdStr]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  it("registers original source evidence, records exact SHA-256, and links to batch", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000001");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000001");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-001");

    const jpegBytes = await createSyntheticJpeg(32, 32);
    const expectedSha256 = crypto.createHash("sha256").update(jpegBytes).digest("hex") as Sha256Hex;

    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const actionId = generateUuidV7();
    const result = await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Authentic clean room macro photo",
      registrationIntent: "initial_assertion",
      actorId: "qa-lead@example.com",
      actionId
    });

    expect(result.evidenceAsset.clientId).toBe(clientId);
    expect(result.evidenceAsset.currentRevision).toBe(1);
    expect(result.sourceObject.originalSha256).toBe(expectedSha256);
    expect(result.sourceObject.storageObjectKey).toBe(
      `clients/${clientId}/evidence/originals/${expectedSha256}`
    );
    expect(result.batchEvidenceLink.batchId).toBe(batchId);
    expect(result.batchEvidenceLink.purpose).toBe("macro_hero_photo");

    // Verify blob in storage
    const stored = await objectStorage.getObject({
      bucket: BUCKETS.EVIDENCE,
      key: result.sourceObject.storageObjectKey
    });
    expect(stored).toBeDefined();
    expect(stored!.body.byteLength).toBe(jpegBytes.byteLength);

    // Verify database rows
    const assetRow = await client.query(
      `SELECT * FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
      [clientId, result.evidenceAsset.evidenceId]
    );
    expect(assetRow.rows.length).toBe(1);

    const sourceRow = await client.query(
      `SELECT * FROM source_objects WHERE client_id = $1 AND original_sha256 = $2`,
      [clientId, expectedSha256]
    );
    expect(sourceRow.rows.length).toBe(1);
    expect(sourceRow.rows[0]!.availability).toBe("available");
  });

  it("stores evidence as reported/unknown when trusted capture metadata is omitted", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000002");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000002");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-002");

    const jpegBytes = await createSyntheticJpeg(16, 16);
    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const result = await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "general_supporting_evidence",
      sourceClass: "photo",
      acquisitionMethod: "field_capture",
      assertionText: "Field photo without certified device context",
      registrationIntent: "initial_assertion",
      actorId: "field-agent@example.com"
    });

    expect(result.evidenceRevision.reportedCaptureTimestamp).toBeNull();
    expect(result.evidenceRevision.reportedCaptureDate).toBeNull();
    expect(result.evidenceRevision.rightsStatus).toBe("unknown");
    expect(result.evidenceRevision.consentStatus).toBe("unknown");

    // Ensure no automatic verification event was created
    const events = await client.query(
      `SELECT * FROM evidence_verification_events WHERE client_id = $1 AND evidence_id = $2`,
      [clientId, result.evidenceAsset.evidenceId]
    );
    expect(events.rows.length).toBe(0);
  });

  it("links existing reference derivative without mutating ReferenceAsset or duplicate binary", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000003");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000003");
    const refAssetId = "018f0000-0003-7000-8000-000000000001";
    const derivSha =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Sha256Hex;

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-003");

    // Insert pre-existing reference asset
    await client.query(
      `INSERT INTO reference_assets
         (client_id, asset_id, asset_type, content_hash_sha256, mime_type, storage_bucket, storage_object_key, created_at)
       VALUES ($1, $2, 'style_lora', $3, 'image/webp', 'godzspeed-reference', 'ref-path', NOW())`,
      [clientId, refAssetId, derivSha]
    );

    const jpegBytes = await createSyntheticJpeg(24, 24);
    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const result = await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Macro hero original with derivative",
      registrationIntent: "initial_assertion",
      actorId: "operator@example.com",
      derivative: {
        referenceAssetId: refAssetId,
        derivativeSha256: derivSha,
        transformDescription: "Downscaled to 1024x1024 WebP",
        transformToolVersion: "sharp@0.33.5"
      }
    });

    expect(result.derivative).toBeDefined();
    expect(result.derivative!.referenceAssetId).toBe(refAssetId);
    expect(result.derivative!.derivativeSha256).toBe(derivSha);

    // Verify reference asset itself was not mutated
    const refRow = await client.query(
      `SELECT * FROM reference_assets WHERE client_id = $1 AND asset_id = $2`,
      [clientId, refAssetId]
    );
    expect(refRow.rows[0]!.content_hash_sha256).toBe(derivSha);
  });

  it("fails closed on MIME mismatch or corrupted format", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000004");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000004");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-004");

    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    // Provide random bytes claiming to be image/jpeg
    const corruptedBytes = Buffer.from("NOT_A_JPEG_FILE_AT_ALL");

    await expect(
      useCase.execute({
        clientId,
        batchId,
        body: corruptedBytes,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Corrupted image test",
        registrationIntent: "initial_assertion",
        actorId: "tester@example.com"
      })
    ).rejects.toThrow(MimeConflictError);
  });

  it("rejects cross-batch source reuse without explicit new_batch_assertion", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000005");
    const batch1 = createBatchId("018f0000-0002-7000-8000-000000000005");
    const batch2 = createBatchId("018f0000-0002-7000-8000-000000000006");

    await seedSkuAndBatch(clientRec.client_id, skuId, batch1, "LOT-005A");
    await seedSkuAndBatch(clientRec.client_id, skuId, batch2, "LOT-005B");

    const jpegBytes = await createSyntheticJpeg(30, 30);
    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    // Register for Batch 1
    await useCase.execute({
      clientId,
      batchId: batch1,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Photo for Batch 1",
      registrationIntent: "initial_assertion",
      actorId: "tester@example.com"
    });

    // Attempt to register same bytes for Batch 2 with initial_assertion -> reject
    await expect(
      useCase.execute({
        clientId,
        batchId: batch2,
        body: jpegBytes,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Photo reuse attempt",
        registrationIntent: "initial_assertion",
        actorId: "tester@example.com"
      })
    ).rejects.toThrow(CrossBatchSourceError);

    // Register same bytes for Batch 2 with new_batch_assertion -> succeeds
    const reuseResult = await useCase.execute({
      clientId,
      batchId: batch2,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Separate lot-specific assertion for Batch 2",
      registrationIntent: "new_batch_assertion",
      actorId: "tester@example.com"
    });

    expect(reuseResult.batchEvidenceLink.batchId).toBe(batch2);
  });

  it("supersedes evidence creating a new revision without destroying old bytes", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000007");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000007");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-007");

    const jpeg1 = await createSyntheticJpeg(20, 20);
    const jpeg2 = await createSyntheticJpeg(40, 40);

    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const initial = await useCase.execute({
      clientId,
      batchId,
      body: jpeg1,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Initial capture revision 1",
      registrationIntent: "initial_assertion",
      actorId: "photographer-1@example.com"
    });

    expect(initial.evidenceAsset.currentRevision).toBe(1);

    const superseded = await useCase.execute({
      clientId,
      batchId,
      body: jpeg2,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Higher resolution replacement capture",
      registrationIntent: "supersede",
      targetEvidenceId: createEvidenceId(initial.evidenceAsset.evidenceId),
      expectedEvidenceVersion: 1,
      actorId: "photographer-1@example.com"
    });

    expect(superseded.evidenceAsset.currentRevision).toBe(2);
    expect(superseded.evidenceRevision.revision).toBe(2);
    expect(superseded.evidenceRevision.supersedesRevision).toBe(1);

    // Verify both source objects are available in the database
    const rev1Source = await client.query(
      `SELECT * FROM source_objects WHERE source_object_id = $1`,
      [initial.sourceObject.sourceObjectId]
    );
    const rev2Source = await client.query(
      `SELECT * FROM source_objects WHERE source_object_id = $1`,
      [superseded.sourceObject.sourceObjectId]
    );

    expect(rev1Source.rows.length).toBe(1);
    expect(rev2Source.rows.length).toBe(1);
    expect(rev1Source.rows[0]!.original_sha256).not.toBe(rev2Source.rows[0]!.original_sha256);
  });

  it("fences supersession to target evidence batch and rejects foreign-lot sources during supersession", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000077");
    const batchLotA = createBatchId("018f0000-0002-7000-8000-000000000077");
    const batchLotB = createBatchId("018f0000-0002-7000-8000-000000000078");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchLotA, "LOT-77A");
    await seedSkuAndBatch(clientRec.client_id, skuId, batchLotB, "LOT-77B");

    const jpegA = await createSyntheticJpeg(36, 36);
    const jpegB = await createSyntheticJpeg(37, 37);
    const jpegReplacement = await createSyntheticJpeg(38, 38);

    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    // Evidence 1 registered for Lot A
    const initialLotA = await useCase.execute({
      clientId,
      batchId: batchLotA,
      body: jpegA,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Initial capture for Lot A",
      registrationIntent: "initial_assertion",
      actorId: "photographer-1@example.com"
    });

    // Evidence 2 registered for Lot B with jpegB
    await useCase.execute({
      clientId,
      batchId: batchLotB,
      body: jpegB,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Initial capture for Lot B",
      registrationIntent: "initial_assertion",
      actorId: "photographer-2@example.com"
    });

    // 1. Attempt to supersede Evidence 1 (Lot A) with changed target batch (Lot B) -> must fail with CrossBatchSourceError
    await expect(
      useCase.execute({
        clientId,
        batchId: batchLotB, // Caller tries to switch batch to Lot B during supersession
        body: jpegReplacement,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Supersede attempt under wrong batch",
        registrationIntent: "supersede",
        targetEvidenceId: createEvidenceId(initialLotA.evidenceAsset.evidenceId),
        expectedEvidenceVersion: 1,
        actorId: "photographer-1@example.com"
      })
    ).rejects.toThrow(CrossBatchSourceError);

    // 2. Attempt to supersede Evidence 1 (Lot A) using an already-used foreign-lot source (jpegB from Lot B) -> must fail with CrossBatchSourceError
    await expect(
      useCase.execute({
        clientId,
        batchId: batchLotA,
        body: jpegB, // jpegB is already associated with Lot B
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Supersede attempt with foreign-lot source",
        registrationIntent: "supersede",
        targetEvidenceId: createEvidenceId(initialLotA.evidenceAsset.evidenceId),
        expectedEvidenceVersion: 1,
        actorId: "photographer-1@example.com"
      })
    ).rejects.toThrow(CrossBatchSourceError);
  });

  it("prevents reuse and derivative linking when revision has an active dispute", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000008");
    const batch1 = createBatchId("018f0000-0002-7000-8000-000000000008");
    const batch2 = createBatchId("018f0000-0002-7000-8000-000000000009");

    await seedSkuAndBatch(clientRec.client_id, skuId, batch1, "LOT-008A");
    await seedSkuAndBatch(clientRec.client_id, skuId, batch2, "LOT-008B");

    const jpegBytes = await createSyntheticJpeg(35, 35);
    const registerUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const initial = await registerUseCase.execute({
      clientId,
      batchId: batch1,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Photo to be disputed",
      registrationIntent: "initial_assertion",
      actorId: "seller@example.com"
    });

    // Add dispute event to revision 1
    await client.query(
      `INSERT INTO evidence_verification_events
         (event_id, client_id, evidence_id, evidence_revision, outcome, verification_kind,
          fact_scope, actor_id, occurred_at, method, reason)
       VALUES ($1, $2, $3, $4, 'disputed', 'human_internal_review', 'full_document_authenticity', 'qa@cco.org', NOW(), 'visual_inspection', 'Photo appears staged')`,
      [crypto.randomUUID(), clientId, initial.evidenceAsset.evidenceId, 1]
    );

    // Attempting new batch assertion with disputed source fails
    await expect(
      registerUseCase.execute({
        clientId,
        batchId: batch2,
        body: jpegBytes,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Trying to reuse disputed source",
        registrationIntent: "new_batch_assertion",
        actorId: "seller@example.com"
      })
    ).rejects.toThrow(ReportDisputedError);

    // Attempting to link derivative to disputed revision fails
    const linkUseCase = new LinkExistingDerivativeUseCase({
      unitOfWork,
      objectStorage
    });

    const refAssetId = "018f0000-0004-7000-8000-000000000001";
    const derivSha =
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" as Sha256Hex;
    await client.query(
      `INSERT INTO reference_assets
         (client_id, asset_id, asset_type, content_hash_sha256, mime_type, storage_bucket, storage_object_key, created_at)
       VALUES ($1, $2, 'style_lora', $3, 'image/webp', 'godzspeed-reference', 'ref-path-2', NOW())`,
      [clientId, refAssetId, derivSha]
    );

    await expect(
      linkUseCase.execute({
        clientId,
        evidenceId: createEvidenceId(initial.evidenceAsset.evidenceId),
        evidenceRevision: 1,
        referenceAssetId: refAssetId,
        derivativeSha256: derivSha,
        transformDescription: "Derivative of disputed evidence",
        actorId: "qa@example.com"
      })
    ).rejects.toThrow(ReportDisputedError);
  });

  it("replays committed receipt on identical actionId without duplicate rows or storage writes", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000010");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000010");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-010");

    const jpegBytes = await createSyntheticJpeg(28, 28);
    const actionId = generateUuidV7();

    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const firstResult = await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Idempotent registration test",
      registrationIntent: "initial_assertion",
      actorId: "lead@example.com",
      actionId
    });

    // Count rows after first execution
    const receiptsCount1 = await client.query(
      `SELECT COUNT(*) FROM product_evidence_command_receipts WHERE client_id = $1 AND action_id = $2`,
      [clientId, actionId]
    );
    expect(Number(receiptsCount1.rows[0]!.count)).toBe(1);

    const assetsCount1 = await client.query(
      `SELECT COUNT(*) FROM evidence_assets WHERE client_id = $1`,
      [clientId]
    );
    expect(Number(assetsCount1.rows[0]!.count)).toBe(1);

    // Replay with identical actionId and payload
    const replayResult = await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Idempotent registration test",
      registrationIntent: "initial_assertion",
      actorId: "lead@example.com",
      actionId
    });

    expect(replayResult.evidenceAsset.evidenceId).toBe(firstResult.evidenceAsset.evidenceId);
    expect(replayResult.sourceObject.originalSha256).toBe(firstResult.sourceObject.originalSha256);

    // Verify no duplicate rows
    const receiptsCount2 = await client.query(
      `SELECT COUNT(*) FROM product_evidence_command_receipts WHERE client_id = $1 AND action_id = $2`,
      [clientId, actionId]
    );
    expect(Number(receiptsCount2.rows[0]!.count)).toBe(1);

    const assetsCount2 = await client.query(
      `SELECT COUNT(*) FROM evidence_assets WHERE client_id = $1`,
      [clientId]
    );
    expect(Number(assetsCount2.rows[0]!.count)).toBe(1);
  });

  it("throws IdempotencyConflictError on actionId retry with changed payload or actor", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000011");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000011");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-011");

    const jpegBytes1 = await createSyntheticJpeg(25, 25);
    const jpegBytes2 = await createSyntheticJpeg(30, 30);
    const actionId = generateUuidV7();

    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes1,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Original payload",
      registrationIntent: "initial_assertion",
      actorId: "author@example.com",
      actionId
    });

    // Retry with different bytes -> throws IdempotencyConflictError
    await expect(
      useCase.execute({
        clientId,
        batchId,
        body: jpegBytes2,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Original payload",
        registrationIntent: "initial_assertion",
        actorId: "author@example.com",
        actionId
      })
    ).rejects.toThrow(IdempotencyConflictError);

    // Retry with different actor -> throws IdempotencyConflictError
    await expect(
      useCase.execute({
        clientId,
        batchId,
        body: jpegBytes1,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Original payload",
        registrationIntent: "initial_assertion",
        actorId: "different-actor@example.com",
        actionId
      })
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("supports existing-source registration by reusedSourceObjectId without re-upload", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000012");
    const batch1 = createBatchId("018f0000-0002-7000-8000-000000000012");
    const batch2 = createBatchId("018f0000-0002-7000-8000-000000000013");

    await seedSkuAndBatch(clientRec.client_id, skuId, batch1, "LOT-012A");
    await seedSkuAndBatch(clientRec.client_id, skuId, batch2, "LOT-012B");

    const jpegBytes = await createSyntheticJpeg(36, 36);
    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const first = await useCase.execute({
      clientId,
      batchId: batch1,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Initial source upload",
      registrationIntent: "initial_assertion",
      actorId: "author@example.com"
    });

    // Reuse via reusedSourceObjectId without body
    const reused = await useCase.execute({
      clientId,
      batchId: batch2,
      reusedSourceObjectId: first.sourceObject.sourceObjectId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Fresh lot attestation for batch 2 using existing source",
      registrationIntent: "new_batch_assertion",
      actorId: "author@example.com"
    });

    expect(reused.sourceObject.sourceObjectId).toBe(first.sourceObject.sourceObjectId);
    expect(reused.batchEvidenceLink.batchId).toBe(batch2);
    expect(reused.evidenceAsset.evidenceId).not.toBe(first.evidenceAsset.evidenceId);

    // Verify source_objects table still has only 1 row for this client
    const sourceRows = await client.query(
      `SELECT COUNT(*) FROM source_objects WHERE client_id = $1`,
      [clientId]
    );
    expect(Number(sourceRows.rows[0]!.count)).toBe(1);
  });

  it("enforces origin-evidence linkage in product_batch_facts", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000014");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000014");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-014");

    const jpegBytes = await createSyntheticJpeg(30, 30);
    const useCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const reg = await useCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Origin evidence for batch facts",
      registrationIntent: "initial_assertion",
      actorId: "author@example.com"
    });

    // Append batch facts with valid origin evidence revision -> succeeds
    await client.query(
      `INSERT INTO product_batch_facts
         (client_id, batch_id, revision, supersedes_revision, origin_kind, origin_evidence_id, origin_evidence_revision, asserted_by, asserted_at)
       VALUES ($1, $2, 2, 1, 'own_production', $3, $4, 'auditor@example.com', NOW())`,
      [clientId, batchId, reg.evidenceAsset.evidenceId, 1]
    );

    const factRow = await client.query(
      `SELECT * FROM product_batch_facts WHERE client_id = $1 AND batch_id = $2 AND revision = 2`,
      [clientId, batchId]
    );
    expect(factRow.rows.length).toBe(1);
    expect(factRow.rows[0]!.origin_evidence_id).toBe(reg.evidenceAsset.evidenceId);
    expect(factRow.rows[0]!.origin_evidence_revision).toBe(1);

    // Foreign origin evidence revision not linked to this batch -> fails constraint fk_batch_facts_origin_evidence
    const fakeEvidenceId = generateUuidV7();
    await expect(
      client.query(
        `INSERT INTO product_batch_facts
           (client_id, batch_id, revision, supersedes_revision, origin_kind, origin_evidence_id, origin_evidence_revision, asserted_by, asserted_at)
         VALUES ($1, $2, 3, 2, 'own_production', $3, 1, 'auditor@example.com', NOW())`,
        [clientId, batchId, fakeEvidenceId]
      )
    ).rejects.toThrow(/fk_batch_facts_origin_evidence/);
  });

  it("records verification events and withdrawals via RecordEvidenceVerificationEventUseCase", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000015");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000015");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-015");

    const jpegBytes = await createSyntheticJpeg(30, 30);
    const registerUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const reg = await registerUseCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Photo to be verified and withdrawn",
      registrationIntent: "initial_assertion",
      actorId: "lead@example.com"
    });

    const verifyUseCase = new RecordEvidenceVerificationEventUseCase({ unitOfWork });

    // Record verification event
    const event1 = await verifyUseCase.execute({
      clientId,
      evidenceId: createEvidenceId(reg.evidenceAsset.evidenceId),
      evidenceRevision: 1,
      outcome: "verified",
      verificationKind: "human_internal_review",
      factScope: "full_document_authenticity",
      method: "exif_and_visual_audit",
      reason: "Confirmed clean room capture matches metadata",
      actorId: "qa-lead@example.com"
    });

    expect(event1.outcome).toBe("verified");
    expect(event1.factScope).toBe("full_document_authenticity");

    // Record withdrawal of event1
    const event2 = await verifyUseCase.execute({
      clientId,
      evidenceId: createEvidenceId(reg.evidenceAsset.evidenceId),
      evidenceRevision: 1,
      outcome: "withdrawn",
      verificationKind: "human_internal_review",
      factScope: "full_document_authenticity",
      method: "audit_correction",
      reason: "Withdrawing prior verification after re-audit",
      withdrawalEventId: event1.eventId,
      actorId: "qa-lead@example.com"
    });

    expect(event2.outcome).toBe("withdrawn");
    expect(event2.withdrawalEventId).toBe(event1.eventId);
  });

  it("fails closed when storage policy is missing or unapproved in production", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000016");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000016");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-016");
    const jpegBytes = await createSyntheticJpeg(20, 20);

    // Missing policy throws AccessDeniedError
    const noPolicyUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator
    });

    await expect(
      noPolicyUseCase.execute({
        clientId,
        batchId,
        body: jpegBytes,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Missing policy test",
        registrationIntent: "initial_assertion",
        actorId: "tester@example.com"
      })
    ).rejects.toThrow(AccessDeniedError);

    // Unapproved production policy throws AccessDeniedError
    const unapprovedProdUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: {
        ...DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
        environment: "production",
        isProductionApproved: false
      }
    });

    await expect(
      unapprovedProdUseCase.execute({
        clientId,
        batchId,
        body: jpegBytes,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Unapproved production test",
        registrationIntent: "initial_assertion",
        actorId: "tester@example.com"
      })
    ).rejects.toThrow(AccessDeniedError);
  });

  it("handles concurrent upload race for identical command cleanly via advisory lock", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000017");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000017");
    const actionId = generateUuidV7();

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-017");
    const jpegBytes = await createSyntheticJpeg(25, 25);

    const registerUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const input = {
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo" as const,
      sourceClass: "photo" as const,
      acquisitionMethod: "direct_upload" as const,
      assertionText: "Concurrent upload race test",
      registrationIntent: "initial_assertion" as const,
      actorId: "tester@example.com",
      actionId
    };

    // Run identical commands concurrently
    const [res1, res2] = await Promise.all([
      registerUseCase.execute(input),
      registerUseCase.execute(input)
    ]);

    expect(res1.evidenceAsset.evidenceId).toBe(res2.evidenceAsset.evidenceId);
    expect(res1.sourceObject.sourceObjectId).toBe(res2.sourceObject.sourceObjectId);

    // Verify exactly one source object exists
    const countRes = await client.query(
      `SELECT COUNT(*) FROM source_objects WHERE client_id = $1`,
      [clientId]
    );
    expect(Number(countRes.rows[0]?.count)).toBe(1);
  });

  it("preserves orphan blob and records abandoned reservation on DB rollback after S3 PUT", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000018");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000018");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-018");
    const jpegBytes = await createSyntheticJpeg(35, 35);
    const sha = crypto.createHash("sha256").update(jpegBytes).digest("hex");

    const registerUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    // Attempt supersede with non-existent targetEvidenceId: PUT will succeed, DB will fail
    const fakeEvidenceId = createEvidenceId(generateUuidV7());
    await expect(
      registerUseCase.execute({
        clientId,
        batchId,
        body: jpegBytes,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Orphan blob preservation test",
        registrationIntent: "supersede",
        targetEvidenceId: fakeEvidenceId,
        expectedEvidenceVersion: 1,
        actorId: "tester@example.com"
      })
    ).rejects.toThrow();

    // Verify S3 blob was NOT deleted (preserved for recovery/investigation)
    const blob = await objectStorage.getObject({
      bucket: BUCKETS.EVIDENCE,
      key: `clients/${clientId}/evidence/originals/${sha}`
    });
    expect(blob).toBeDefined();
    expect(blob?.body).toBeDefined();

    // Verify reservation was marked abandoned
    const resRes = await client.query(
      `SELECT status FROM evidence_ingest_reservations WHERE client_id = $1 AND sha256 = $2`,
      [clientId, sha]
    );
    expect(resRes.rows[0]?.status).toBe("abandoned");
  });

  it("enforces schema immutability triggers on source_objects and evidence_revisions", async () => {
    const clientRec = await insertClientRecord(client);
    const clientId = createClientId(clientRec.client_id);
    const skuId = createSkuId("018f0000-0001-7000-8000-000000000019");
    const batchId = createBatchId("018f0000-0002-7000-8000-000000000019");

    await seedSkuAndBatch(clientRec.client_id, skuId, batchId, "LOT-019");
    const jpegBytes = await createSyntheticJpeg(15, 15);

    const registerUseCase = new RegisterEvidenceAssetUseCase({
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
    });

    const reg = await registerUseCase.execute({
      clientId,
      batchId,
      body: jpegBytes,
      declaredMimeType: "image/jpeg",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Immutability trigger test",
      registrationIntent: "initial_assertion",
      actorId: "tester@example.com"
    });

    const sourceId = reg.sourceObject.sourceObjectId;

    // Mutating byte_length on source_objects fails
    await expect(
      client.query(`UPDATE source_objects SET byte_length = 9999 WHERE source_object_id = $1`, [
        sourceId
      ])
    ).rejects.toThrow(/Permanent source object binary columns cannot be updated/);

    // Archive source_objects
    await client.query(
      `UPDATE source_objects SET availability = 'archived' WHERE source_object_id = $1`,
      [sourceId]
    );

    // Un-archiving source_objects back to available fails
    await expect(
      client.query(
        `UPDATE source_objects SET availability = 'available' WHERE source_object_id = $1`,
        [sourceId]
      )
    ).rejects.toThrow(/Archived source objects cannot be reactivated or updated/);

    // Deleting source_objects head fails
    await expect(
      client.query(`DELETE FROM source_objects WHERE source_object_id = $1`, [sourceId])
    ).rejects.toThrow(/CANNOT_DELETE_HEAD_ENTITY/);

    // Updating evidence_revisions fails
    await expect(
      client.query(
        `UPDATE evidence_revisions SET assertion_text = 'tampered' WHERE evidence_id = $1`,
        [reg.evidenceAsset.evidenceId]
      )
    ).rejects.toThrow(/CANNOT_MODIFY_IMMUTABLE_ENTITY/);
  });

  it("operates reliably without deadlock under concurrent requests on minimum 2-connection pool", async () => {
    const minPool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 2
    });
    try {
      const minCoordinator = new PostgresEvidenceLockCoordinator(minPool);
      const minUow = new PostgresUnitOfWork(minPool);

      const clientRec = await insertClientRecord(client);
      const clientId = createClientId(clientRec.client_id);
      const skuId = createSkuId("018f0000-0001-7000-8000-000000000020");
      const batchId1 = createBatchId("018f0000-0002-7000-8000-000000000020");
      const batchId2 = createBatchId("018f0000-0002-7000-8000-000000000021");

      await seedSkuAndBatch(clientRec.client_id, skuId, batchId1, "LOT-020A");
      await seedSkuAndBatch(clientRec.client_id, skuId, batchId2, "LOT-020B");

      const jpeg1 = await createSyntheticJpeg(20, 20);
      const jpeg2 = await createSyntheticJpeg(22, 22);

      const registerUseCase = new RegisterEvidenceAssetUseCase({
        unitOfWork: minUow,
        objectStorage,
        originalsInspector,
        lockCoordinator: minCoordinator,
        storagePolicy: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY
      });

      // Run two distinct commands concurrently on the 2-connection pool
      const [res1, res2] = await Promise.all([
        registerUseCase.execute({
          clientId,
          batchId: batchId1,
          body: jpeg1,
          declaredMimeType: "image/jpeg",
          purpose: "macro_hero_photo",
          sourceClass: "photo",
          acquisitionMethod: "direct_upload",
          assertionText: "Concurrent min-pool test 1",
          registrationIntent: "initial_assertion",
          actorId: "tester@example.com"
        }),
        registerUseCase.execute({
          clientId,
          batchId: batchId2,
          body: jpeg2,
          declaredMimeType: "image/jpeg",
          purpose: "macro_hero_photo",
          sourceClass: "photo",
          acquisitionMethod: "direct_upload",
          assertionText: "Concurrent min-pool test 2",
          registrationIntent: "initial_assertion",
          actorId: "tester@example.com"
        })
      ]);

      expect(res1.evidenceAsset.evidenceId).toBeDefined();
      expect(res2.evidenceAsset.evidenceId).toBeDefined();
    } finally {
      await minPool.end();
    }
  });
});
