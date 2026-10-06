import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  sharp,
  startPostgres18Container,
  startMinioContainer,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  type StartedMinioContainer,
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertStoryboardCandidateRecord,
  insertSceneReferenceAssetRecord,
  insertGenerationManifestRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresSceneReviewQueries,
  S3ReviewMediaDelivery,
  SharpImageInspectionAdapter,
  S3ObjectStorage,
  PostgresReferenceAssetRepository,
  PostgresSceneRepository,
  PostgresStoryboardCandidateRepository,
  PostgresCampaignRepository,
  PostgresShotPlanRepository,
  loadCertificationProfile,
  hashWorkflow,
  type CertificationProfile
} from "@cco/infrastructure";
import {
  ApproveSceneAndDispatchCampaignProductionUseCase,
  EnqueueSceneProductionRenderUseCase,
  AssembleGenerationManifest,
  ResolveApprovedCandidateMediaUseCase,
  UploadReferenceAssetUseCase,
  PlanShotPlansUseCase,
  ReviewSceneUseCases,
  ProductionReviewUseCases,
  ProgressSceneProductionUseCases,
  CompleteCampaignProductionRunUseCases,
  CompleteCampaignProductionRunAssemblyUseCases,
  type HashBytesPort,
  type PlanningModelClientPort,
  type StagedComfyUiInput
} from "@cco/application";
import {
  ShotPlan,
  type CampaignId,
  type CandidateId,
  type ReferenceAssetId,
  type RenderJob,
  type SceneId,
  type ShotPlanId
} from "@cco/domain";
import { BUCKET_NAMES, BUCKETS } from "@cco/shared";
import {
  GenerationManifestSchema,
  SceneReviewDetailReadModelSchema,
  LTX_FPS,
  type GenerationManifest
} from "@cco/contracts";
import { createCertifiedRenderJobExecutor } from "../../apps/render-worker/src/render-job-executor.js";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";
import type { ControlApiContainer } from "../../apps/control-api/src/http/types.js";

describe("ShotPlan-to-H3 E2E Integration (#331)", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let client: PoolClient;
  let rawS3Client: S3Client;
  let reviewMediaDelivery: S3ReviewMediaDelivery;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

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

    reviewMediaDelivery = new S3ReviewMediaDelivery({
      signingEndpoint: minioContainer.getEndpoint(),
      storageEndpoint: minioContainer.getEndpoint(),
      client: rawS3Client,
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
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
    if (minioContainer) {
      await minioContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  it("verifies ReferenceAsset upload -> approved ShotPlan -> H3 dispatch -> worker execution -> review QA -> assembly lifecycle", async () => {
    // -------------------------------------------------------------------------
    // 1. Seed Client and Campaign (5s duration each scene, 2 scenes, 10s total)
    // -------------------------------------------------------------------------
    const clientRecord = await insertClientRecord(client, {
      companyName: "Cyberpunk Studios"
    });
    const clientId = clientRecord.client_id;

    const campaignRecord = await insertCampaignRecord(client, {
      clientId,
      title: "Night City Run",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 2,
      approvedScenes: 0
    });
    const campaignId = campaignRecord.campaign_id as CampaignId;

    // -------------------------------------------------------------------------
    // 2. Real UploadReferenceAssetUseCase with synthesized PNG bytes
    // -------------------------------------------------------------------------
    const imageValidator = new SharpImageInspectionAdapter();
    const objectStorage = new S3ObjectStorage({ client: rawS3Client });
    const referenceAssetRepo = new PostgresReferenceAssetRepository(pool);
    const hashBytesPort: HashBytesPort = {
      hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
    };

    const uploadReferenceAsset = new UploadReferenceAssetUseCase({
      referenceAssetRepository: referenceAssetRepo,
      objectStorage,
      imageValidator
    });

    const heroPng = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const stylePng = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const uploadedRef1 = await uploadReferenceAsset.execute({
      clientId,
      body: heroPng,
      declaredMimeType: "image/png",
      displayName: "Hero Character Sheet",
      libraryRole: "subject_identity"
    });

    const uploadedRef2 = await uploadReferenceAsset.execute({
      clientId,
      body: stylePng,
      declaredMimeType: "image/png",
      displayName: "Cyberpunk Aesthetic",
      libraryRole: "style"
    });

    const refAsset1Id = uploadedRef1.id as ReferenceAssetId;
    const refAsset2Id = uploadedRef2.id as ReferenceAssetId;
    const ref1Sha256 = uploadedRef1.contentHashSha256;
    const ref2Sha256 = uploadedRef2.contentHashSha256;

    // -------------------------------------------------------------------------
    // 3. Seed Scenes in Postgres (durationSeconds: 5 for MiniMax-H3 124 frames)
    // -------------------------------------------------------------------------
    const scene1Record = await insertStoryboardSceneRecord(client, {
      campaignId,
      sceneOrder: 1,
      durationSeconds: 5,
      status: "director_review",
      specRevision: 1,
      engineAssigned: "minimax-h3-720p@certified-v1"
    });
    const scene2Record = await insertStoryboardSceneRecord(client, {
      campaignId,
      sceneOrder: 2,
      durationSeconds: 5,
      status: "director_review",
      specRevision: 1,
      engineAssigned: "minimax-h3-720p@certified-v1"
    });

    const scene1Id = scene1Record.scene_id as SceneId;
    const scene2Id = scene2Record.scene_id as SceneId;

    // -------------------------------------------------------------------------
    // 4. Bind references to Scene 1 in Postgres
    // -------------------------------------------------------------------------
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene1Id,
      assetId: refAsset1Id,
      specRevision: 1,
      role: "subject_identity",
      weight: 1.0
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene1Id,
      assetId: refAsset2Id,
      specRevision: 1,
      role: "style",
      weight: 1.0
    });

    // -------------------------------------------------------------------------
    // 5. Generate ShotPlans via PlanShotPlansUseCase with Deterministic Model Client
    // -------------------------------------------------------------------------
    const uow = new PostgresUnitOfWork(pool);

    const mockPlanningClient: PlanningModelClientPort = {
      providerName: "Anthropic",
      imageCapability: true,
      supportsImages: true,
      complete: async (req) => {
        if (req.images && req.images.length > 0) {
          return {
            kind: "success",
            rawText: "Cyberpunk reference asset visual description"
          };
        }
        return {
          kind: "success",
          rawText: JSON.stringify({
            variants: [
              {
                framing: "medium_close_up",
                angle: "eye_level",
                cameraMovement: "dolly_in",
                movementSpeed: "slow",
                lensIntent: "50mm prime",
                cameraPosition: "eye height",
                cameraPromptDescription: "Slow dolly forward",
                actionSummary: "Operative activates scanner",
                lightingStyle: "neon_night",
                environmentDescription: "Rainy alleyway",
                colorPalette: ["cyan", "magenta"],
                atmosphere: "foggy rain",
                subjects: [
                  {
                    subjectId: "hero-operative",
                    role: "subject_identity",
                    referenceAssetId: refAsset1Id,
                    initialPosition: "screen_center",
                    movementTrajectory: "stationary"
                  }
                ],
                beats: [
                  {
                    beatIndex: 1,
                    startMs: 0,
                    endMs: 5000,
                    description: "Scan target",
                    cameraAction: "dolly in",
                    subjectAction: "activate scanner"
                  }
                ]
              },
              {
                framing: "close_up",
                angle: "low_angle",
                cameraMovement: "static",
                movementSpeed: "slow",
                lensIntent: "85mm",
                cameraPosition: "low tripod",
                cameraPromptDescription: "Static low angle",
                actionSummary: "Operative stares intently",
                lightingStyle: "chiaroscuro",
                environmentDescription: "Dark doorway",
                colorPalette: ["blue"],
                atmosphere: "dark",
                subjects: [
                  {
                    subjectId: "hero-operative",
                    role: "subject_identity",
                    referenceAssetId: refAsset1Id,
                    initialPosition: "screen_center",
                    movementTrajectory: "static"
                  }
                ],
                beats: [
                  {
                    beatIndex: 1,
                    startMs: 0,
                    endMs: 5000,
                    description: "Stare",
                    cameraAction: "static",
                    subjectAction: "breathing"
                  }
                ]
              }
            ]
          })
        };
      }
    };

    const mockFallbackClient: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: async () => ({
        kind: "permanent_failure",
        error: "Fallback client should not be called in test"
      })
    };

    const planShotPlans = new PlanShotPlansUseCase({
      uow,
      primaryClient: mockPlanningClient,
      fallbackClient: mockFallbackClient,
      objectStorage
    });

    const planResultScene1 = await planShotPlans.execute({
      sceneId: scene1Id,
      variantCount: 2,
      enqueuePrevisJobs: false,
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowedProviders: ["Anthropic", "OpenAI"]
      }
    });
    expect(planResultScene1.shotPlans).toHaveLength(2);
    expect(planResultScene1.shotPlans[0]!.routingMode).toBe("reference_directed");
    expect(planResultScene1.shotPlans[0]!.variantOrdinal).toBe(1);
    expect(planResultScene1.shotPlans[1]!.variantOrdinal).toBe(2);

    const plan1Scene1 = planResultScene1.shotPlans[0]!;
    const plan2Scene1 = planResultScene1.shotPlans[1]!;
    const shotPlan1Scene1Id = plan1Scene1.id;
    const shotPlan2Scene1Id = plan2Scene1.id;

    // -------------------------------------------------------------------------
    // 6. Seed Previs Candidates (Storyboards) in MinIO and Postgres
    // -------------------------------------------------------------------------
    const previs1Jpeg = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: { r: 120, g: 120, b: 120 } }
    })
      .jpeg()
      .toBuffer();
    const previs1Sha256 = createHash("sha256").update(previs1Jpeg).digest("hex");
    const previsKey1 = `scenes/${scene1Id}/previs1.jpg`;

    const previs2Jpeg = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: { r: 60, g: 60, b: 60 } }
    })
      .jpeg()
      .toBuffer();
    const previs2Sha256 = createHash("sha256").update(previs2Jpeg).digest("hex");
    const previsKey2 = `scenes/${scene2Id}/previs2.jpg`;

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: previsKey1,
        Body: previs1Jpeg,
        ContentType: "image/jpeg"
      })
    );
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: previsKey2,
        Body: previs2Jpeg,
        ContentType: "image/jpeg"
      })
    );

    const cand1 = await insertStoryboardCandidateRecord(client, {
      sceneId: scene1Id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      contentHashSha256: previs1Sha256,
      storageBucket: BUCKETS.REVIEW,
      storageObjectKey: previsKey1
    });
    const cand2 = await insertStoryboardCandidateRecord(client, {
      sceneId: scene2Id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      contentHashSha256: previs2Sha256,
      storageBucket: BUCKETS.REVIEW,
      storageObjectKey: previsKey2
    });
    const previsCand1Id = cand1.candidate_id as CandidateId;
    const previsCand2Id = cand2.candidate_id as CandidateId;

    // Attach previs association to plan1Scene1
    plan1Scene1.attachPrevis({
      candidateId: previsCand1Id,
      storageBucket: BUCKETS.REVIEW,
      storageObjectKey: previsKey1,
      contentHashSha256: previs1Sha256,
      modelProfile: "flux_schnell",
      generatedAt: "2026-09-27T10:15:00.000Z",
      reviewNotes: "Previs visualization"
    });

    const shotPlan1Scene2Id = "01928374-abcd-7000-8000-000000000041" as ShotPlanId;
    const plan1Scene2 = ShotPlan.create({
      id: shotPlan1Scene2Id,
      sceneId: scene2Id,
      specRevision: 1,
      variantOrdinal: 1,
      routingMode: "frame_anchored",
      targetDurationMs: 5000,
      targetFrameCount: 124,
      framing: "wide",
      angle: "eye_level",
      cameraMovement: "tracking",
      movementSpeed: "fast",
      lensIntent: "24mm wide",
      cameraPosition: "tracking rig",
      cameraPromptDescription: "Tracking shot",
      actionSummary: "Operative sprints toward illuminated plaza",
      lightingStyle: "neon_night",
      environmentDescription: "Neon alley",
      colorPalette: ["yellow", "red"],
      atmosphere: "rain",
      subjects: [
        {
          subjectId: "hero-operative",
          role: "subject_identity",
          referenceAssetId: null,
          initialPosition: "foreground_center",
          movementTrajectory: "sprints forward"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 5000,
          description: "Sprint",
          cameraAction: "tracks backward",
          subjectAction: "runs"
        }
      ],
      continuity: {
        persistentSubjectIds: ["hero-operative"],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: previsCand2Id,
        anchorMediaHashSha256: previs2Sha256
      },
      previs: {
        candidateId: previsCand2Id,
        storageBucket: BUCKETS.REVIEW,
        storageObjectKey: previsKey2,
        contentHashSha256: previs2Sha256,
        modelProfile: "flux_schnell",
        generatedAt: "2026-09-27T10:15:00.000Z",
        reviewNotes: "Authoritative anchor"
      }
    });

    await uow.execute(async (ctx) => {
      await ctx.shotPlans.saveMany([plan1Scene1, plan1Scene2]);
    });

    // -------------------------------------------------------------------------
    // 7. Initialize Real EnqueueSceneProductionRenderUseCase and ControlApi App
    // -------------------------------------------------------------------------
    const realEnqueueProductionRender = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes: hashBytesPort,
      imageValidator
    });

    const coordinator = new ApproveSceneAndDispatchCampaignProductionUseCase(
      uow,
      realEnqueueProductionRender
    );

    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);

    const progressSceneProduction = new ProgressSceneProductionUseCases(uow);
    const completeCampaignProductionRunAssembly = new CompleteCampaignProductionRunAssemblyUseCases(
      uow
    );

    const container: ControlApiContainer = {
      dependencies: {
        uow,
        sceneReviewQueries,
        reviewMediaDelivery
      },
      useCases: {
        reviewScene: new ReviewSceneUseCases(uow),
        productionReview: new ProductionReviewUseCases(uow, realEnqueueProductionRender),
        progressSceneProduction,
        approveSceneAndDispatchCampaignProduction: coordinator,
        completeCampaignProductionRun: new CompleteCampaignProductionRunUseCases(uow),
        completeCampaignProductionRunAssembly
      },
      queries: {
        sceneReview: sceneReviewQueries
      }
    };

    const app = createControlApiApp(container, {
      reviewerIdentityResolver: {
        resolve: () => "Director Alex"
      }
    });

    // -------------------------------------------------------------------------
    // 8. Review Hub Read Projection against Postgres DB
    // -------------------------------------------------------------------------
    const reviewRes1 = await app.inject({
      method: "GET",
      url: `/api/scenes/${scene1Id}/review`
    });
    expect(reviewRes1.statusCode).toBe(200);
    const reviewBody1 = reviewRes1.json();
    const parsedReview1 = SceneReviewDetailReadModelSchema.safeParse(reviewBody1);
    expect(parsedReview1.success).toBe(true);

    expect(reviewBody1.shotPlans).toHaveLength(2);
    const readPlan1Scene1 = reviewBody1.shotPlans.find(
      (p: { shotPlanId: string }) => p.shotPlanId === shotPlan1Scene1Id
    );
    expect(readPlan1Scene1.routingMode).toBe("reference_directed");
    expect(readPlan1Scene1.boundReferences).toHaveLength(2);
    expect(readPlan1Scene1.boundReferences[0].previewAvailability).toBe("available");
    expect(readPlan1Scene1.boundReferences[0].previewUrl).toBeDefined();

    // Scene 2 is frame_anchored
    const reviewRes2 = await app.inject({
      method: "GET",
      url: `/api/scenes/${scene2Id}/review`
    });
    expect(reviewRes2.statusCode).toBe(200);
    const reviewBody2 = reviewRes2.json();
    const parsedReview2 = SceneReviewDetailReadModelSchema.safeParse(reviewBody2);
    expect(parsedReview2.success).toBe(true);

    const readPlan1Scene2 = reviewBody2.shotPlans.find(
      (p: { shotPlanId: string }) => p.shotPlanId === shotPlan1Scene2Id
    );
    expect(readPlan1Scene2.routingMode).toBe("frame_anchored");
    expect(readPlan1Scene2.continuity.frameAnchorTarget).toBe("first_frame");
    expect(readPlan1Scene2.continuity.anchorCandidateId).toBe(previsCand2Id);

    // -------------------------------------------------------------------------
    // 9. Select ShotPlan 1 for Scene 1 & Stale Spec Revision Rejection
    // -------------------------------------------------------------------------
    const selectRes1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000091",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "select_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene1Id
        }
      }
    });
    expect(selectRes1.statusCode).toBe(200);

    const staleApprove = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000092",
        sceneId: scene1Id,
        expectedSpecRevision: 999,
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene1Id
        }
      }
    });
    expect(staleApprove.statusCode).toBe(409);

    // -------------------------------------------------------------------------
    // 10. Approve Scene 1 ShotPlan (does not dispatch early)
    // -------------------------------------------------------------------------
    const approveRes1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000093",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene1Id
        }
      }
    });
    expect(approveRes1.statusCode).toBe(200);

    // Assert no render jobs created yet
    const pendingJobsCheck = await client.query("SELECT COUNT(*) FROM render_jobs");
    expect(Number(pendingJobsCheck.rows[0].count)).toBe(0);

    // -------------------------------------------------------------------------
    // 11. Select and Approve Scene 2 ShotPlan -> Triggers Atomic Dispatch in DB
    // -------------------------------------------------------------------------
    await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000094",
        sceneId: scene2Id,
        expectedSpecRevision: 1,
        action: "select_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene2Id
        }
      }
    });

    const approveRes2 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000095",
        sceneId: scene2Id,
        expectedSpecRevision: 1,
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene2Id
        }
      }
    });
    expect(approveRes2.statusCode).toBe(200);

    // Verify campaign status in Postgres
    const campaignAfterDispatch = await uow.execute(async (ctx) =>
      ctx.campaigns.findById(campaignId)
    );
    expect(campaignAfterDispatch?.status).toBe("queued");
    expect(campaignAfterDispatch?.approvedScenes).toBe(2);

    // Verify enqueued render jobs in Postgres
    const dbJobsResult = await client.query(
      "SELECT job_id, scene_id, job_kind, workflow_template, injected_payload FROM render_jobs ORDER BY created_at ASC"
    );
    expect(dbJobsResult.rows).toHaveLength(2);

    const dbJob1 = dbJobsResult.rows.find((r) => r.scene_id === scene1Id)!;
    expect(dbJob1.workflow_template).toBe("minimax-h3-720p-124f-ref2v");
    const payload1 =
      typeof dbJob1.injected_payload === "string"
        ? JSON.parse(dbJob1.injected_payload)
        : dbJob1.injected_payload;
    expect(payload1.shotPlanId).toBe(shotPlan1Scene1Id);
    expect(payload1.specRevision).toBe(1);
    expect(payload1.frameCount).toBe(124);
    // CRITICAL [AC-1]: No storyboard/previs candidate conditioned in reference_directed mode
    expect(payload1.approvedCandidateId).toBeUndefined();

    const dbJob2 = dbJobsResult.rows.find((r) => r.scene_id === scene2Id)!;
    expect(dbJob2.workflow_template).toBe("minimax-h3-720p-124f-i2v");
    const payload2 =
      typeof dbJob2.injected_payload === "string"
        ? JSON.parse(dbJob2.injected_payload)
        : dbJob2.injected_payload;
    // CRITICAL [AC-2]: Explicit frame-anchored route conditions the exact declared anchor candidate
    expect(payload2.approvedCandidateId).toBe(previsCand2Id);
    expect(payload2.shotPlanId).toBe(shotPlan1Scene2Id);
    expect(payload2.frameCount).toBe(124);

    // -------------------------------------------------------------------------
    // 12. Simulated Render Worker Execution & Staging
    // -------------------------------------------------------------------------
    const manifestPath = resolve(process.cwd(), "templates/provenance.json");
    const capturedWorkflows: Array<{
      renderJobId: string;
      workflow: Record<string, unknown>;
    }> = [];
    const stagedRefInputs: StagedComfyUiInput[] = [];
    const stagedRecords: Array<{
      filename: string;
      bytes: Uint8Array;
      contentType: string;
      sha256: string;
    }> = [];

    function getLiveProvenance(profile: CertificationProfile) {
      return {
        version: 1,
        generatedAt: "2026-09-27T10:30:00.000Z",
        profileId: profile.id,
        renderProfileProvenance: {
          modelHashes: profile.models.map((m) => ({
            category: m.category,
            relativePath: m.relativePath,
            sha256: createHash("sha256").update(m.relativePath).digest("hex")
          }))
        },
        models: profile.models.map((m) => ({
          category: m.category,
          key: m.relativePath,
          sha256: createHash("sha256").update(m.relativePath).digest("hex"),
          bytes: 1024 * 1024
        })),
        workflow: {
          sha256: profile.expectedWorkflowHash
        },
        git: {
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          customNodes: []
        }
      };
    }

    const workerExecutor = createCertifiedRenderJobExecutor({
      manifestPath,
      loadCertificationProfile: async (path, id) => loadCertificationProfile(path, id),
      readApprovedProvenance: async () => {},
      collectCertificationProvenance: async ({ profile }) => getLiveProvenance(profile),
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async (filePath) => readFile(filePath, "utf8"),
      hashWorkflow: (content) => hashWorkflow(content),
      hashBytes: hashBytesPort,
      imageValidator,
      objectStorage,
      stageReferenceImage: {
        stage: async (input) => {
          const sha256 = createHash("sha256").update(input.bytes).digest("hex");
          stagedRecords.push({
            filename: input.filename,
            bytes: input.bytes,
            contentType: input.contentType,
            sha256
          });
          const staged: StagedComfyUiInput = {
            name: input.filename,
            subfolder: "references"
          };
          stagedRefInputs.push(staged);
          return staged;
        },
        cleanup: async () => {}
      },
      outputReader: {
        readOutput: async () => ({
          bytes: Buffer.from("dummy-video-bytes-h3-720p"),
          contentType: "video/mp4"
        })
      },
      formatAwareProber: (options) => ({
        outputKey: options.outputKey,
        checksumSha256: options.checksumSha256,
        container: "ffprobe",
        dimensions: { width: 1280, height: 720 },
        frameCount: 124,
        fps: 24,
        durationMs: 5166,
        formatDurationMs: 5166,
        video: {
          codecName: "h264",
          pixelFormat: "yuv420p"
        },
        measurement: "source_bytes"
      }),
      executeProfileRender: async (input) => {
        capturedWorkflows.push({
          renderJobId: input.renderJobId,
          workflow: input.workflow as Record<string, unknown>
        });
        return {
          status: "succeeded",
          promptId: `comfy-prompt-${input.renderJobId}`,
          outputObjectKeys: ["output.mp4"],
          durationMs: 5000,
          profile: input.identity
        };
      },
      productionManifestAssembler: new AssembleGenerationManifest({
        hashBytes: hashBytesPort,
        sceneRepository: new PostgresSceneRepository(pool),
        storyboardCandidateRepository: new PostgresStoryboardCandidateRepository(pool),
        referenceAssetRepository: referenceAssetRepo
      }),
      resolveApprovedCandidateMedia: new ResolveApprovedCandidateMediaUseCase({
        sceneRepository: new PostgresSceneRepository(pool),
        storyboardCandidateRepository: new PostgresStoryboardCandidateRepository(pool),
        objectStorage,
        hashBytes: hashBytesPort
      }),
      referenceAssetRepository: referenceAssetRepo,
      shotPlanRepository: new PostgresShotPlanRepository(pool),
      sceneRepository: new PostgresSceneRepository(pool),
      campaignRepository: new PostgresCampaignRepository(pool)
    });

    // Execute Job 1 (reference_directed)
    const execJob1Input: RenderJob = {
      jobId: dbJob1.job_id,
      sceneId: scene1Id,
      jobKind: "production",
      workflowTemplate: dbJob1.workflow_template,
      injectedPayload: payload1,
      retryCount: 0,
      maxRetries: 3
    };

    const execResult1 = await workerExecutor(execJob1Input);
    expect(execResult1.manifestPayload).toBeDefined();

    // Verify [AC-1]: Stage reference assets and verify conditioning in submitted workflow
    expect(stagedRefInputs).toHaveLength(2);
    expect(stagedRecords).toHaveLength(2);

    // Verify staged bytes match declared hashes and fixture bytes
    expect(stagedRecords[0]!.sha256).toBe(ref1Sha256);
    expect(stagedRecords[1]!.sha256).toBe(ref2Sha256);
    expect(Buffer.from(stagedRecords[0]!.bytes)).toEqual(heroPng);
    expect(Buffer.from(stagedRecords[1]!.bytes)).toEqual(stylePng);

    const captured1 = capturedWorkflows.find((c) => c.renderJobId === dbJob1.job_id)!;
    const workflow1 = captured1.workflow;

    const node201 = workflow1["201"] as { inputs: { image: string } };
    const node202 = workflow1["202"] as { inputs: { image: string } };
    expect(node201.inputs.image).toContain(ref1Sha256.slice(0, 16));
    expect(node202.inputs.image).toContain(ref2Sha256.slice(0, 16));

    // Confirm previs 1 is completely absent from executed conditioning
    const workflow1Json = JSON.stringify(workflow1);
    expect(workflow1Json).not.toContain(previsCand1Id);
    expect(workflow1Json).not.toContain(previsKey1);
    expect(workflow1Json).not.toContain(previs1Sha256);

    const manifestScene1 = execResult1.manifestPayload as unknown as GenerationManifest;
    const parsedManifest1 = GenerationManifestSchema.safeParse(manifestScene1);
    if (!parsedManifest1.success) {
      throw new Error(
        `MANIFEST PARSE ERROR: ${JSON.stringify(parsedManifest1.error.format(), null, 2)}`
      );
    }
    expect(parsedManifest1.success).toBe(true);
    expect(manifestScene1.routingMode).toBe("reference_directed");
    expect(manifestScene1.referenceImages).toHaveLength(2);
    expect(manifestScene1.referenceImages![0]!.contentHashSha256).toBe(ref1Sha256);
    expect(manifestScene1.referenceImages![1]!.contentHashSha256).toBe(ref2Sha256);
    expect(manifestScene1.referenceImages![0]!.stagedAs.name).toBe(stagedRecords[0]!.filename);
    expect(manifestScene1.referenceImages![1]!.stagedAs.name).toBe(stagedRecords[1]!.filename);
    expect(manifestScene1.shotPlan?.id).toBe(shotPlan1Scene1Id);
    expect(manifestScene1.firstFrame).toBeUndefined();
    expect(manifestScene1.executionConditioning).toBeUndefined();

    // Verify manifestScene1 reconstructed from observed execution matches actual submitted workflow and output
    const workflow1Hash = hashWorkflow(JSON.stringify(workflow1));
    expect(manifestScene1.workflow.submittedWorkflowHash).toBe(workflow1Hash);
    expect(manifestScene1.referenceImages![0]!.injectionTarget).toEqual({
      nodeId: "201",
      classType: "LoadImage",
      inputField: "image"
    });
    expect(manifestScene1.referenceImages![1]!.injectionTarget).toEqual({
      nodeId: "202",
      classType: "LoadImage",
      inputField: "image"
    });

    const dummyVideoBytes = Buffer.from("dummy-video-bytes-h3-720p");
    const dummyVideoSha256 = createHash("sha256").update(dummyVideoBytes).digest("hex");
    expect(manifestScene1.outputs[0]!.checksumSha256).toBe(dummyVideoSha256);

    // Persist manifest for Job 1 in Postgres
    await insertGenerationManifestRecord(client, {
      jobId: dbJob1.job_id,
      promptIdComfy: manifestScene1.promptIdComfy,
      campaignId,
      sceneId: scene1Id,
      renderAttempt: 1,
      manifestPayload: manifestScene1
    });

    // Write primary video output in S3
    const output1 = manifestScene1.outputs[0];
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: output1.bucket,
        Key: output1.key,
        Body: Buffer.from("dummy-video-bytes-h3-720p"),
        ContentType: "video/mp4"
      })
    );

    // Execute Job 2 (frame_anchored)
    const execJob2Input: RenderJob = {
      jobId: dbJob2.job_id,
      sceneId: scene2Id,
      jobKind: "production",
      workflowTemplate: dbJob2.workflow_template,
      injectedPayload: payload2,
      retryCount: 0,
      maxRetries: 3
    };

    const execResult2 = await workerExecutor(execJob2Input);
    expect(execResult2.manifestPayload).toBeDefined();

    // Verify [AC-2]: Explicit frame-anchored route stages exact anchor candidate
    expect(stagedRecords).toHaveLength(3);
    const anchorRecord = stagedRecords[2]!;
    expect(anchorRecord.sha256).toBe(previs2Sha256);
    expect(Buffer.from(anchorRecord.bytes)).toEqual(previs2Jpeg);

    const captured2 = capturedWorkflows.find((c) => c.renderJobId === dbJob2.job_id)!;
    const workflow2 = captured2.workflow;
    const node20 = workflow2["20"] as { inputs: { image: string } };
    expect(node20.inputs.image).toContain(previs2Sha256.slice(0, 16));

    const manifestScene2 = execResult2.manifestPayload as unknown as GenerationManifest;
    expect(GenerationManifestSchema.safeParse(manifestScene2).success).toBe(true);
    expect(manifestScene2.routingMode).toBe("frame_anchored");
    expect(manifestScene2.firstFrame?.candidateId).toBe(previsCand2Id);
    expect(manifestScene2.firstFrame?.contentHashSha256).toBe(previs2Sha256);
    expect(manifestScene2.firstFrame?.stagedAs.name).toBe(anchorRecord.filename);
    expect(manifestScene2.referenceImages).toBeUndefined();
    expect(manifestScene2.shotPlan?.id).toBe(shotPlan1Scene2Id);
    expect(manifestScene2.firstFrame?.injectionTarget).toEqual({
      nodeId: "20",
      classType: "LoadImage",
      inputField: "image"
    });
    const workflow2Hash = hashWorkflow(JSON.stringify(workflow2));
    expect(manifestScene2.workflow.submittedWorkflowHash).toBe(workflow2Hash);

    const profile1 = await loadCertificationProfile(manifestPath, "minimax-h3-720p-124f-ref2v");

    // -------------------------------------------------------------------------
    // Manifest dimensions/fps provenance
    //
    // NOTE: manifestScene1.dimensions/fps are populated from the certified
    // profile's configured baseline (profile.baseline) and the node-driven
    // frame-count topology override (fps pinned to LTX_FPS when the profile's
    // injection topology declares a workflow-driven frameCount node, as
    // MiniMax H3 Ref2V's does) — not from probing the actual rendered output
    // bytes. The production pipeline has no ffprobe (or equivalent) wiring
    // from real media into GenerationManifest assembly for any render profile
    // today. Real media-probe integration is tracked separately in
    // https://github.com/opsclawd/comfy-content-orchestrator/issues/345 and is
    // out of scope for this issue. This assertion checks the manifest against
    // the configured values it is actually derived from, not against an
    // independently measured value.
    // -------------------------------------------------------------------------
    expect(manifestScene1.dimensions.width).toBe(profile1.baseline.width);
    expect(manifestScene1.dimensions.height).toBe(profile1.baseline.height);
    expect(manifestScene1.fps).toBe(LTX_FPS);

    // Reconstruct GenerationManifest directly via AssembleGenerationManifest
    // from the captured workflow/staging execution results and verified output
    const standaloneAssembler = new AssembleGenerationManifest({
      hashBytes: hashBytesPort,
      sceneRepository: new PostgresSceneRepository(pool),
      storyboardCandidateRepository: new PostgresStoryboardCandidateRepository(pool),
      referenceAssetRepository: referenceAssetRepo
    });

    const reconstructedDirectly = await standaloneAssembler.assemble({
      job: execJob1Input,
      profile: profile1,
      liveProvenance: getLiveProvenance(profile1),
      renderResult: {
        status: "succeeded",
        promptId: manifestScene1.promptIdComfy,
        outputObjectKeys: ["output.mp4"],
        durationMs: 5000,
        profile: {
          profileId: profile1.id,
          renderProfileKey: profile1.renderProfileIdentity.key,
          renderProfileVersion: profile1.renderProfileIdentity.version,
          engine: profile1.engine as "minimax_h3_ref2v",
          workflowSha256: profile1.expectedWorkflowHash,
          modelSha256: [],
          runnerProfile: profile1.runnerProfile,
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
        }
      },
      workflow: workflow1 as Record<string, unknown>,
      mediaObjects: [
        {
          bucket: output1.bucket,
          key: output1.key,
          body: dummyVideoBytes,
          contentType: "video/mp4",
          checksumSha256: dummyVideoSha256
        }
      ],
      routingMode: "reference_directed",
      shotPlan: {
        id: shotPlan1Scene1Id,
        specRevision: 1,
        variantOrdinal: 1
      },
      executedInstruction: {
        text: (workflow1["105"] as { inputs: { prompt: string } }).inputs.prompt,
        sha256: createHash("sha256")
          .update(
            Buffer.from((workflow1["105"] as { inputs: { prompt: string } }).inputs.prompt, "utf8")
          )
          .digest("hex"),
        byteLength: Buffer.byteLength(
          (workflow1["105"] as { inputs: { prompt: string } }).inputs.prompt,
          "utf8"
        )
      },
      referenceImages: manifestScene1.referenceImages!,
      configuredMedia: manifestScene1.configuredMedia,
      measuredMedia: manifestScene1.measuredMedia
    });

    const parsedDirectly = GenerationManifestSchema.safeParse(
      reconstructedDirectly.manifestPayload
    );
    expect(parsedDirectly.success).toBe(true);
    const directManifest = reconstructedDirectly.manifestPayload as unknown as GenerationManifest;
    expect(directManifest.manifestId).toBe(manifestScene1.manifestId);
    expect(directManifest.routingMode).toBe("reference_directed");
    expect(directManifest.workflow.submittedWorkflowHash).toBe(workflow1Hash);
    expect(directManifest.outputs[0]!.checksumSha256).toBe(dummyVideoSha256);
    expect(directManifest.dimensions.width).toBe(profile1.baseline.width);
    expect(directManifest.dimensions.height).toBe(profile1.baseline.height);
    expect(directManifest.fps).toBe(LTX_FPS);

    // Assert conditional invalid manifests are rejected:
    // 1. reference_directed with firstFrame fails
    const invalidRefDirectedWithFirstFrame = {
      ...manifestScene1,
      firstFrame: {
        anchorType: "first_frame",
        candidateId: previsCand1Id,
        contentHashSha256: previs1Sha256,
        stagedAs: { name: "invalid.png", subfolder: "references" },
        injectionTarget: { nodeId: "20", classType: "LoadImage", inputField: "image" }
      }
    };
    expect(GenerationManifestSchema.safeParse(invalidRefDirectedWithFirstFrame).success).toBe(
      false
    );

    // 2. reference_directed with executionConditioning fails (False Conditioning Invariant)
    const invalidRefDirectedWithConditioning = {
      ...manifestScene1,
      executionConditioning: {
        candidateId: previsCand1Id,
        sceneId: scene1Id,
        specRevision: 1,
        contentHashSha256: previs1Sha256,
        media: {
          bucket: BUCKETS.REVIEW,
          key: previsKey1,
          sha256: previs1Sha256,
          contentType: "image/jpeg"
        },
        stagedAs: { name: "invalid.png", subfolder: "references" },
        injectionTarget: { nodeId: "20", classType: "LoadImage", inputField: "image" }
      }
    };
    expect(GenerationManifestSchema.safeParse(invalidRefDirectedWithConditioning).success).toBe(
      false
    );

    // 3. frame_anchored without firstFrame fails
    const invalidFrameAnchoredWithoutFirstFrame = {
      ...manifestScene2,
      firstFrame: undefined
    };
    expect(GenerationManifestSchema.safeParse(invalidFrameAnchoredWithoutFirstFrame).success).toBe(
      false
    );

    // 4. frame_anchored with referenceImages fails
    const invalidFrameAnchoredWithReferences = {
      ...manifestScene2,
      referenceImages: [
        {
          slotIndex: 1,
          promptTag: "<Picture 1>",
          bindingId: "binding-1",
          assetId: refAsset1Id,
          contentHashSha256: ref1Sha256,
          role: "subject_identity",
          stagedAs: { name: "invalid.png", subfolder: "references" },
          injectionTarget: { nodeId: "201", classType: "LoadImage", inputField: "image" }
        }
      ]
    };
    expect(GenerationManifestSchema.safeParse(invalidFrameAnchoredWithReferences).success).toBe(
      false
    );

    // Persist manifest for Job 2 in Postgres
    const manifestRecord2 = await insertGenerationManifestRecord(client, {
      jobId: dbJob2.job_id,
      promptIdComfy: manifestScene2.promptIdComfy,
      campaignId,
      sceneId: scene2Id,
      renderAttempt: 1,
      manifestPayload: manifestScene2
    });

    const output2 = manifestScene2.outputs[0];
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: output2.bucket,
        Key: output2.key,
        Body: Buffer.from("dummy-video-bytes-h3-720p"),
        ContentType: "video/mp4"
      })
    );

    // -------------------------------------------------------------------------
    // 13. Progress Scenes to QA
    // -------------------------------------------------------------------------
    await progressSceneProduction.markRenderingStarted({ sceneId: scene1Id });
    await progressSceneProduction.submitForQA({ sceneId: scene1Id });

    await progressSceneProduction.markRenderingStarted({ sceneId: scene2Id });
    await progressSceneProduction.submitForQA({ sceneId: scene2Id });

    const scene1Check = await uow.execute(async (ctx) => ctx.scenes.findById(scene1Id));
    const scene2Check = await uow.execute(async (ctx) => ctx.scenes.findById(scene2Id));
    expect(scene1Check?.status).toBe("qa");
    expect(scene2Check?.status).toBe("qa");

    // -------------------------------------------------------------------------
    // 14. Production Review QA: Rejection on Stale Attempt & Stale Revision
    // -------------------------------------------------------------------------
    const staleJobRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000096",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: "01928374-abcd-7000-8000-000000000000"
        }
      }
    });
    expect(staleJobRes.statusCode).toBe(409);

    const staleRevRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000097",
        sceneId: scene1Id,
        expectedSpecRevision: 999,
        action: "production_accept",
        payload: {
          expectedProductionJobId: dbJob1.job_id
        }
      }
    });
    expect(staleRevRes.statusCode).toBe(409);

    // -------------------------------------------------------------------------
    // 15. Production Rerender on Scene 1 (Creates Attempt 2)
    // -------------------------------------------------------------------------
    const rerenderRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000098",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "production_rerender",
        payload: {
          expectedProductionJobId: dbJob1.job_id
        }
      }
    });
    expect(rerenderRes.statusCode).toBe(200);

    const scene1AfterRerender = await uow.execute(async (ctx) => ctx.scenes.findById(scene1Id));
    expect(scene1AfterRerender?.status).toBe("queued");
    expect(scene1AfterRerender?.snapshot().productionAttemptOrdinal).toBe(2);

    const allScene1Jobs = await client.query(
      "SELECT job_id, scene_id, job_kind, workflow_template, injected_payload FROM render_jobs WHERE scene_id = $1 ORDER BY created_at ASC",
      [scene1Id]
    );
    expect(allScene1Jobs.rows).toHaveLength(2);
    const dbJob1Attempt2 = allScene1Jobs.rows[1];
    const payload1Attempt2 =
      typeof dbJob1Attempt2.injected_payload === "string"
        ? JSON.parse(dbJob1Attempt2.injected_payload)
        : dbJob1Attempt2.injected_payload;

    // Execute Attempt 2 with worker executor
    const execJob1Attempt2Input: RenderJob = {
      jobId: dbJob1Attempt2.job_id,
      sceneId: scene1Id,
      jobKind: "production",
      workflowTemplate: dbJob1Attempt2.workflow_template,
      injectedPayload: payload1Attempt2,
      retryCount: 0,
      maxRetries: 3
    };

    const execResult1Attempt2 = await workerExecutor(execJob1Attempt2Input);
    const manifestScene1Attempt2 =
      execResult1Attempt2.manifestPayload as unknown as GenerationManifest;
    expect(GenerationManifestSchema.safeParse(manifestScene1Attempt2).success).toBe(true);
    expect(manifestScene1Attempt2.renderAttempt).toBe(2);

    const manifestRecord1Attempt2 = await insertGenerationManifestRecord(client, {
      jobId: dbJob1Attempt2.job_id,
      promptIdComfy: manifestScene1Attempt2.promptIdComfy,
      campaignId,
      sceneId: scene1Id,
      renderAttempt: 2,
      manifestPayload: manifestScene1Attempt2
    });

    const output1Attempt2 = manifestScene1Attempt2.outputs[0];
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: output1Attempt2.bucket,
        Key: output1Attempt2.key,
        Body: Buffer.from("dummy-video-bytes-h3-720p-attempt2"),
        ContentType: "video/mp4"
      })
    );

    // Progress Scene 1 Attempt 2 to QA
    await progressSceneProduction.markRenderingStarted({ sceneId: scene1Id });
    await progressSceneProduction.submitForQA({ sceneId: scene1Id });

    // -------------------------------------------------------------------------
    // 16. Production Accept Scene 1 and Idempotent Replay
    // -------------------------------------------------------------------------
    const acceptRes1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000099",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: dbJob1Attempt2.job_id
        }
      }
    });
    expect(acceptRes1.statusCode).toBe(200);
    const acceptBody1 = acceptRes1.json();
    expect(acceptBody1.isIdempotentReplay).toBe(false);
    expect(acceptBody1.status).toBe("completed");

    // Idempotent replay of the exact same accept command
    const replayRes1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000099",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: dbJob1Attempt2.job_id
        }
      }
    });
    expect(replayRes1.statusCode).toBe(200);
    const replayBody1 = replayRes1.json();
    expect(replayBody1.isIdempotentReplay).toBe(true);

    // Assembly should not be enqueued yet (Scene 2 still in QA)
    const earlyAssemblyCheck = await client.query("SELECT COUNT(*) FROM delivery_assembly_jobs");
    expect(Number(earlyAssemblyCheck.rows[0].count)).toBe(0);

    // -------------------------------------------------------------------------
    // 17. Production Accept Scene 2 -> Triggers Automated Assembly
    // -------------------------------------------------------------------------
    const acceptRes2 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-00000000009a",
        sceneId: scene2Id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: dbJob2.job_id
        }
      }
    });
    expect(acceptRes2.statusCode).toBe(200);
    const acceptBody2 = acceptRes2.json();
    expect(acceptBody2.status).toBe("completed");

    // Verify delivery assembly job was automatically enqueued
    const assemblyRows = await client.query(
      "SELECT job_id, campaign_id, assembly_spec FROM delivery_assembly_jobs WHERE campaign_id = $1",
      [campaignId]
    );
    expect(assemblyRows.rows).toHaveLength(1);
    const assemblyJob = assemblyRows.rows[0];
    const spec =
      typeof assemblyJob.assembly_spec === "string"
        ? JSON.parse(assemblyJob.assembly_spec)
        : assemblyJob.assembly_spec;

    expect(spec.videoStems).toHaveLength(2);
    // Stem 0 references Scene 1 Attempt 2 manifest
    expect(spec.videoStems[0].order).toBe(0);
    expect(spec.videoStems[0].sceneId).toBe(scene1Id);
    expect(spec.videoStems[0].generationManifestId).toBe(manifestRecord1Attempt2.manifest_id);

    // Stem 1 references Scene 2 Attempt 1 manifest
    expect(spec.videoStems[1].order).toBe(1);
    expect(spec.videoStems[1].sceneId).toBe(scene2Id);
    expect(spec.videoStems[1].generationManifestId).toBe(manifestRecord2.manifest_id);

    // Total duration matches sum of scene durations (5s + 5s = 10000ms)
    expect(spec.expectedTotalDurationMs).toBe(10000);

    // Complete campaign delivery assembly
    await completeCampaignProductionRunAssembly.onAssemblyJobCompleted(assemblyJob.job_id);

    const finalCampaign = await uow.execute(async (ctx) => ctx.campaigns.findById(campaignId));
    expect(finalCampaign?.status).toBe("completed");

    // -------------------------------------------------------------------------
    // 18. Auditability & Lineage Preservation
    // -------------------------------------------------------------------------
    const allScene1Plans = await uow.execute(async (ctx) => ctx.shotPlans.listByScene(scene1Id));
    expect(allScene1Plans).toHaveLength(2);
    const plan2 = allScene1Plans.find((p) => p.id === shotPlan2Scene1Id);
    expect(plan2?.status).toBe("superseded");

    const attemptsResult = await client.query(
      "SELECT attempt_id, ordinal, production_job_id FROM production_attempts WHERE scene_id = $1 ORDER BY ordinal ASC",
      [scene1Id]
    );
    expect(attemptsResult.rows).toHaveLength(2);
    expect(attemptsResult.rows[0].ordinal).toBe(1);
    expect(attemptsResult.rows[1].ordinal).toBe(2);

    const allManifests = await client.query(
      "SELECT job_id, render_attempt FROM generation_manifests WHERE campaign_id = $1 ORDER BY render_attempt ASC",
      [campaignId]
    );
    expect(allManifests.rows.length).toBeGreaterThanOrEqual(3);
  });
});
