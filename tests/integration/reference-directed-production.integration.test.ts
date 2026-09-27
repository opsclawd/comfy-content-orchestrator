import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  insertClientRecord,
  insertCampaignRecord,
  insertReferenceAssetRecord,
  insertSceneReferenceAssetRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresSceneRepository,
  PostgresShotPlanRepository,
  PostgresReferenceAssetRepository,
  PostgresStoryboardCandidateRepository,
  PostgresCampaignRepository,
  S3ObjectStorage,
  SharpImageInspectionAdapter,
  type CertificationProfile,
  type CertificationProvenanceReport
} from "@cco/infrastructure";
import {
  EnqueueSceneProductionRenderUseCase,
  AssembleGenerationManifest,
  MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
  type HashBytesPort
} from "@cco/application";
import { GenerationManifestSchema } from "@cco/contracts";
import { Scene, ShotPlan, type CampaignId, type SceneId, type ShotPlanId } from "@cco/domain";
import { BUCKET_NAMES, BUCKETS } from "@cco/shared";
import {
  createCertifiedRenderJobExecutor,
  type StagedComfyUiInput
} from "../../apps/render-worker/src/render-job-executor.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Reference-directed Production Integration (Postgres + MinIO)", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let uow: PostgresUnitOfWork;

  const hashBytesPort: HashBytesPort = {
    hashBytes: async (bytes) => sha256Hex(bytes)
  };

  const fixturePngPath = fileURLToPath(
    new URL("../fixtures/deterministic-reference.png", import.meta.url)
  );
  const validPngBytes = new Uint8Array(readFileSync(fixturePngPath));
  const validPngHash = sha256Hex(validPngBytes);

  beforeAll(async () => {
    [postgresContainer, minioContainer] = await Promise.all([
      startPostgres18Container(),
      startMinioContainer()
    ]);

    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });

    const migrationClient = await pool.connect();
    try {
      await runMigrations(migrationClient, { migrationsDirectory: MIGRATIONS_DIRECTORY_URL });
    } finally {
      migrationClient.release();
    }

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

    uow = new PostgresUnitOfWork(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await Promise.all([postgresContainer?.stop(), minioContainer?.stop()]);
  });

  it("completes full reference-directed lifecycle: transactional admission, MinIO verification, worker staging, and manifest provenance persistence", async () => {
    const client = await pool.connect();
    let sceneId: SceneId;
    let shotPlanId: ShotPlanId;
    let assetId: string;
    let campaignId: string;

    try {
      const clientRecord = await insertClientRecord(client);
      const campaignRecord = await insertCampaignRecord(client, {
        clientId: clientRecord.client_id,
        title: "Integration Campaign"
      });
      campaignId = campaignRecord.campaign_id;

      // 1. Upload reference asset to MinIO
      const storageBucket = BUCKETS.REFERENCE;
      const photoKey = `reference-assets/${randomUUID()}/photo.png`;
      await rawS3Client.send(
        new PutObjectCommand({
          Bucket: storageBucket,
          Key: photoKey,
          Body: validPngBytes,
          ContentType: "image/png"
        })
      );

      // 2. Insert ReferenceAsset metadata in Postgres
      const refRecord = await insertReferenceAssetRecord(client, {
        clientId: clientRecord.client_id,
        assetType: "image",
        storageBucket,
        storageObjectKey: photoKey,
        contentHashSha256: validPngHash,
        mimeType: "image/png",
        width: 1280,
        height: 720
      });
      assetId = refRecord.asset_id;

      // 3. Create approved Scene in Postgres
      sceneId = randomUUID() as SceneId;
      const sceneDomain = Scene.create({
        id: sceneId,
        campaignId: campaignId as CampaignId,
        configuration: {
          prompt: "Cinematic portrait with reference styling",
          referenceIds: [],
          engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
          durationMs: 5000
        }
      });
      sceneDomain.beginCandidateGeneration();
      sceneDomain.submitCandidatesForReview();

      // 4. Create approved ShotPlan in Postgres
      shotPlanId = randomUUID() as ShotPlanId;
      const shotPlanDomain = ShotPlan.create({
        id: shotPlanId,
        sceneId,
        specRevision: 1,
        variantOrdinal: 1,
        status: "approved",
        routingMode: "reference_directed",
        targetDurationMs: 5000,
        targetFrameCount: 124,
        framing: "medium",
        angle: "eye_level",
        lensIntent: "50mm",
        cameraPosition: "front",
        cameraMovement: "static",
        movementSpeed: "slow",
        cameraPromptDescription: "Static tripod shot",
        actionSummary: "Character looks at the camera",
        lightingStyle: "cinematic_soft",
        environmentDescription: "Studio background",
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: [],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        }
      });

      const sceneRepo = new PostgresSceneRepository(client);
      const shotPlanRepo = new PostgresShotPlanRepository(client);
      await sceneRepo.save(sceneDomain);
      await shotPlanRepo.save(shotPlanDomain);

      sceneDomain.selectShotPlan(shotPlanId, 1, sceneId);
      sceneDomain.approveShotPlan({
        approvedBy: "Director Integration",
        approvedAt: new Date().toISOString(),
        routingMode: "reference_directed"
      });
      await sceneRepo.save(sceneDomain);

      // 5. Insert SceneReferenceBinding in Postgres
      await insertSceneReferenceAssetRecord(client, {
        sceneId,
        assetId,
        specRevision: 1,
        role: "subject_identity",
        weight: 1
      });
    } finally {
      client.release();
    }

    // 6. Transactional Admission: EnqueueSceneProductionRenderUseCase
    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes: hashBytesPort,
      imageValidator: new SharpImageInspectionAdapter()
    });

    const admissionResult = await enqueueUseCase.execute({ sceneId });

    expect(admissionResult.scene.status).toBe("queued");
    expect(admissionResult.job.jobKind).toBe("production");
    expect(admissionResult.job.workflowTemplate).toBe(
      MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE
    );
    expect(admissionResult.attemptId).toBeDefined();
    expect(admissionResult.attemptOrdinal).toBe(1);

    const injected = admissionResult.job.injectedPayload;
    expect(injected.shotPlanId).toBe(shotPlanId);
    expect(injected.specRevision).toBe(1);
    expect(injected.frameCount).toBe(124);
    expect(injected.attemptId).toBe(admissionResult.attemptId);
    // Crucial invariant: no candidate pixels staged as first-frame authority
    expect("approvedCandidateId" in injected).toBe(false);

    // Verify production attempt row was persisted in Postgres
    const attemptCheck = await pool.query(
      `SELECT * FROM production_attempts WHERE scene_id = $1 AND ordinal = 1`,
      [sceneId]
    );
    expect(attemptCheck.rows).toHaveLength(1);
    expect(attemptCheck.rows[0].attempt_id).toBe(admissionResult.attemptId);

    // 7. Worker Execution & Staging
    const stagedInputs: StagedComfyUiInput[] = [];
    const mockStagePort = {
      stage: vi
        .fn()
        .mockImplementation(
          async (input: { filename: string; bytes: Uint8Array; contentType: string }) => {
            const staged: StagedComfyUiInput = {
              name: input.filename,
              subfolder: "inputs",
              type: "input"
            };
            stagedInputs.push(staged);
            return staged;
          }
        ),
      cleanup: vi.fn().mockResolvedValue(undefined)
    };

    const ref2vWorkflowJson = await readFile(
      fileURLToPath(
        new URL("../../templates/minimax_h3_720p_ref2v_124f_api.json", import.meta.url)
      ),
      "utf8"
    );
    const ref2vWorkflowHash = sha256Hex(Buffer.from(ref2vWorkflowJson, "utf8"));

    const fakeRef2vProfile: CertificationProfile = {
      id: MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
      engine: "minimax_h3_ref2v",
      expectedWorkflowHash: ref2vWorkflowHash,
      source: {
        kind: "validated_host_export",
        uri: "https://github.com/Comfy-Org/MiniMax-H3",
        revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
        license: "MiniMax Community License"
      },
      runnerProfile: "dynamicvram-offload-v1",
      baseline: {
        width: 1344,
        height: 768,
        frames: 124,
        steps: 20,
        approximateDurationSeconds: 5
      },
      renderProfileIdentity: {
        key: MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
        version: 1,
        engine: "minimax_h3_ref2v",
        frames: 124,
        steps: 20,
        runnerProfile: "dynamicvram-offload-v1",
        workflowHash: ref2vWorkflowHash,
        modelHashes: {}
      }
    };

    const realSceneRepo = new PostgresSceneRepository(pool);
    const realCandidateRepo = new PostgresStoryboardCandidateRepository(pool);
    const realRefAssetRepo = new PostgresReferenceAssetRepository(pool);
    const realShotPlanRepo = new PostgresShotPlanRepository(pool);

    const manifestAssembler = new AssembleGenerationManifest({
      hashBytes: hashBytesPort,
      sceneRepository: realSceneRepo,
      storyboardCandidateRepository: realCandidateRepo,
      referenceAssetRepository: realRefAssetRepo
    });

    const fakeProvenanceReport: CertificationProvenanceReport = {
      version: 1,
      profileId: MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
      generatedAt: "2026-09-25T00:00:00Z",
      workflow: {
        relativePath: "minimax_h3_720p_ref2v_124f_api.json",
        sha256: ref2vWorkflowHash,
        source: {
          kind: "validated_host_export",
          uri: "https://github.com/Comfy-Org/MiniMax-H3",
          revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1",
          license: "MiniMax Community License"
        }
      },
      models: [],
      git: { comfyUiCommit: "a".repeat(40), customNodes: [] },
      disk: {
        modelFootprintBytes: 0,
        availableBytes: 100_000_000_000,
        requiredFreeBytes: 0,
        modelFootprintGb: 0,
        availableGb: 100,
        minFreeDiskGb: 50,
        passes: true
      },
      renderProfileProvenance: {
        key: MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
        version: 1,
        engine: "minimax_h3_ref2v",
        frames: 124,
        steps: 20,
        workflowHash: ref2vWorkflowHash,
        runnerProfile: "dynamicvram-offload-v1",
        measuredDiskFootprintGb: 10,
        minFreeDiskGb: 50,
        modelHashes: {}
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeRef2vProfile,
      readApprovedProvenance: async () => fakeProvenanceReport,
      collectCertificationProvenance: async () => fakeProvenanceReport,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => ref2vWorkflowJson,
      hashWorkflow: (raw: string) => sha256Hex(Buffer.from(raw, "utf8")),
      executeProfileRender: async () => ({
        status: "succeeded",
        promptId: "prompt-integration-1",
        outputObjectKeys: ["renders/output.mp4"],
        durationMs: 5000,
        profile: {
          key: MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
          version: 1,
          engine: "minimax_h3_ref2v",
          frames: 124,
          steps: 20,
          runnerProfile: "dynamicvram-offload-v1",
          workflowHash: fakeRef2vProfile.expectedWorkflowHash,
          modelHashes: {}
        },
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      }),
      outputReader: {
        readOutput: async () => ({ bytes: new Uint8Array([0, 1, 2, 3]), contentType: "video/mp4" })
      },
      sceneRepository: realSceneRepo,
      shotPlanRepository: realShotPlanRepo,
      referenceAssetRepository: realRefAssetRepo,
      campaignRepository: new PostgresCampaignRepository(pool),
      objectStorage,
      stageReferenceImage: mockStagePort,
      hashBytes: hashBytesPort,
      imageValidator: new SharpImageInspectionAdapter(),
      productionManifestAssembler: async (input) => {
        const res = await manifestAssembler.assemble(input);
        return res.manifestPayload;
      }
    });

    const executionResult = await executor(admissionResult.job);
    expect(executionResult.manifestPayload).toBeDefined();

    // 8. Validate Staging from MinIO
    expect(mockStagePort.stage).toHaveBeenCalledTimes(1);
    const stagedCall = mockStagePort.stage.mock.calls[0]![0];
    expect(stagedCall.bytes).toEqual(validPngBytes);
    expect(stagedCall.contentType).toBe("image/png");

    // 9. Validate Schema & Persist Manifest in Postgres
    const rawManifest = executionResult.manifestPayload!;
    const parsedManifest = GenerationManifestSchema.parse(rawManifest);

    expect(parsedManifest.routingMode).toBe("reference_directed");
    expect(parsedManifest.attemptId).toBe(admissionResult.attemptId);
    expect(parsedManifest.shotPlan).toBeDefined();
    expect(parsedManifest.shotPlan?.id).toBe(shotPlanId);
    expect(parsedManifest.shotPlan?.specRevision).toBe(1);
    expect(parsedManifest.referenceImages).toHaveLength(1);

    const refImageEntry = parsedManifest.referenceImages![0]!;
    expect(refImageEntry.assetId).toBe(assetId);
    expect(refImageEntry.contentHashSha256).toBe(validPngHash);
    expect(refImageEntry.bindingId).toBeDefined();
    expect(refImageEntry.role).toBe("subject_identity");
    expect(refImageEntry.stagedAs).toBeDefined();

    // Provenance invariant: firstFrame and candidate conditioning MUST be absent
    expect(parsedManifest.firstFrame).toBeUndefined();
    expect(parsedManifest.approvedCandidateId).toBeUndefined();

    // 10. Persist and retrieve from Postgres
    await pool.query(
      `
      INSERT INTO generation_manifests (
        manifest_id,
        job_id,
        prompt_id_comfy,
        campaign_id,
        scene_id,
        render_attempt,
        manifest_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        parsedManifest.manifestId,
        admissionResult.job.jobId,
        "prompt-integration-1",
        campaignId,
        sceneId,
        1,
        JSON.stringify(parsedManifest)
      ]
    );

    const retrievedResult = await pool.query<{ manifest_id: string; manifest_payload: unknown }>(
      `SELECT manifest_id, manifest_payload FROM generation_manifests WHERE job_id = $1`,
      [admissionResult.job.jobId]
    );
    expect(retrievedResult.rows).toHaveLength(1);
    const retrieved = retrievedResult.rows[0]!;
    const retrievedParsed = GenerationManifestSchema.parse(retrieved.manifest_payload);
    expect(retrievedParsed.manifestId).toBe(parsedManifest.manifestId);
    expect(retrievedParsed.attemptId).toBe(admissionResult.attemptId);
    expect(retrievedParsed.referenceImages![0]!.bindingId).toBe(refImageEntry.bindingId);
  });

  it("fails closed at admission when MinIO reference bytes are corrupted", async () => {
    const client = await pool.connect();
    let sceneId: SceneId;
    let campaignId: string;

    try {
      const clientRecord = await insertClientRecord(client);
      const campaignRecord = await insertCampaignRecord(client, {
        clientId: clientRecord.client_id
      });
      campaignId = campaignRecord.campaign_id;

      const storageBucket = BUCKETS.REFERENCE;
      const corruptKey = `reference-assets/${randomUUID()}/corrupt.png`;

      // Upload corrupt bytes to MinIO
      await rawS3Client.send(
        new PutObjectCommand({
          Bucket: storageBucket,
          Key: corruptKey,
          Body: new Uint8Array([1, 2, 3, 4, 5]),
          ContentType: "image/png"
        })
      );

      const refRecord = await insertReferenceAssetRecord(client, {
        clientId: clientRecord.client_id,
        assetType: "image",
        storageBucket,
        storageObjectKey: corruptKey,
        contentHashSha256: validPngHash,
        mimeType: "image/png"
      });
      const assetId = refRecord.asset_id;

      sceneId = randomUUID() as SceneId;
      const sceneDomain = Scene.create({
        id: sceneId,
        campaignId: campaignId as CampaignId,
        configuration: {
          prompt: "Corrupt reference scene",
          referenceIds: [],
          engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
          durationMs: 5000
        }
      });
      sceneDomain.beginCandidateGeneration();
      sceneDomain.submitCandidatesForReview();

      const shotPlanId = randomUUID() as ShotPlanId;
      const shotPlanDomain = ShotPlan.create({
        id: shotPlanId,
        sceneId,
        specRevision: 1,
        variantOrdinal: 1,
        status: "approved",
        routingMode: "reference_directed",
        targetDurationMs: 5000,
        targetFrameCount: 124,
        framing: "medium",
        angle: "eye_level",
        lensIntent: "50mm",
        cameraPosition: "front",
        cameraMovement: "static",
        movementSpeed: "slow",
        cameraPromptDescription: "Static shot",
        actionSummary: "Action",
        lightingStyle: "cinematic_soft",
        environmentDescription: "Studio",
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: [],
          lightingContinuityNote: null,
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        }
      });

      const sceneRepo = new PostgresSceneRepository(client);
      const shotPlanRepo = new PostgresShotPlanRepository(client);
      await sceneRepo.save(sceneDomain);
      await shotPlanRepo.save(shotPlanDomain);

      sceneDomain.selectShotPlan(shotPlanId, 1, sceneId);
      sceneDomain.approveShotPlan({
        approvedBy: "Director",
        approvedAt: new Date().toISOString(),
        routingMode: "reference_directed"
      });
      await sceneRepo.save(sceneDomain);

      await insertSceneReferenceAssetRecord(client, {
        sceneId,
        assetId,
        specRevision: 1,
        role: "subject_identity",
        weight: 1
      });
    } finally {
      client.release();
    }

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes: hashBytesPort,
      imageValidator: new SharpImageInspectionAdapter()
    });

    await expect(enqueueUseCase.execute({ sceneId })).rejects.toThrow(/content hash mismatch/);
  });
});
