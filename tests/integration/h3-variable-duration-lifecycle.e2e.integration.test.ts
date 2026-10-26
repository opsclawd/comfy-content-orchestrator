import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  FakeComfyUiTransport,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertSceneReferenceAssetRecord,
  insertGenerationManifestRecord,
  insertRenderJobRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresReferenceAssetRepository,
  PostgresShotPlanRepository,
  PostgresGenerationManifestRepository,
  PostgresSceneRepository,
  PostgresCampaignRepository,
  PostgresJobQueue,
  S3ObjectStorage,
  S3ReviewMediaDelivery,
  SharpImageInspectionAdapter,
  JsonFileLicenseRegistryPort,
  ComfyUiClient,
  ComfyUiRenderEngineAdapter,
  HttpComfyUiInputStagingAdapter,
  H3OperatorSignatureVerifier,
  H3TrustedCandidateRegistryReader,
  FfmpegMediaAssemblerAdapter
} from "@cco/infrastructure";
import {
  UploadReferenceAssetUseCase,
  PlanShotPlansUseCase,
  ReviewSceneUseCases,
  AssembleDeliveryReel,
  AssembleGenerationManifest,
  ExecuteProfileRenderUseCase,
  StageH3CandidateRenderUseCase,
  EnforceLicenseRouting,
  BeginOperatorAcceptanceRunUseCase,
  AcceptOperatorAcceptanceSceneUseCase,
  AssembleOperatorAcceptanceRunUseCase,
  ResolveOperatorAcceptanceReelUseCase,
  planFeasibleCampaignDuration,
  type PlanningModelClientPort,
  type StagingPlanningAuthorizationSource,
  type GpuTelemetryPort,
  type EnforceStorageAdmission,
  type H3CandidateEligibilityService
} from "@cco/application";
import {
  type CampaignId,
  type ReferenceAssetId,
  type SceneId,
  type ShotPlanId,
  ShotPlan
} from "@cco/domain";
import { BUCKET_NAMES, BUCKETS } from "@cco/shared";
import {
  computePlanBindingDigest,
  type IsolatedTestRealm,
  type H3ProfileFrameCapability,
  type ExecutionProfileSelection
} from "@cco/contracts";
import {
  SOURCE_GPU_UUID,
  SOURCE_HOSTNAME,
  createDerivedSimulation243fFixture,
  createSignedTestCapabilityEnvelope,
  generateTestOperatorKeyPair,
  createSignedTestCandidateGrant
} from "../fixtures/h3-variable-duration/source-matrix.js";
import { AcceptanceDeliveryAssemblyWorker } from "../../apps/render-worker/src/acceptance-delivery-assembly-worker.js";
import {
  HttpAcceptanceAssemblyControlApiClient,
  createControlApiClient
} from "../../apps/render-worker/src/control-api-client.js";
import { createCertifiedRenderJobExecutor } from "../../apps/render-worker/src/render-job-executor.js";
import { RenderWorker } from "../../apps/render-worker/src/worker.js";
import { createControlApiApp } from "../../apps/control-api/src/http/app.js";
import { generateSyntheticStems } from "../../packages/infrastructure/src/ffmpeg/test-support/synthetic-stem-fixtures.js";
import { IsolatedSimulationRealmContext } from "../../packages/application/src/test-support/isolated-simulation-realm-context.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("H3 Variable-Duration Lifecycle Integration (#427)", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let pool: Pool;
  let client: PoolClient;
  let rawS3Client: S3Client;
  let objectStorage: S3ObjectStorage;
  let reviewMediaDelivery: S3ReviewMediaDelivery;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

  const { privateKey, publicKey } = generateTestOperatorKeyPair();
  const sim243f = createDerivedSimulation243fFixture();
  const candidateProfileKey = sim243f.candidate.key;
  const grant243f = createSignedTestCandidateGrant({
    candidate: sim243f.candidate,
    privateKey
  });

  const testRealm: IsolatedTestRealm = {
    kind: "isolated_test",
    testRealmId: "realm-h3-variable-e2e",
    isolationDescriptorDigest: "c".repeat(64)
  };

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

    objectStorage = new S3ObjectStorage({ client: rawS3Client });

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

  it("executes full variable-duration (243f) acceptance lifecycle: brief -> shot plan -> candidate staging -> reviews -> worker assembly -> readback", async () => {
    const uow = new PostgresUnitOfWork(pool);
    const clientRecord = await insertClientRecord(client, { companyName: "Simulation Brand" });
    const clientId = clientRecord.client_id;

    // 1. Create Campaign (20s duration, 2 scenes, 10s each)
    const campaignRecord = await insertCampaignRecord(client, {
      clientId,
      title: "Variable Duration Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 2,
      approvedScenes: 0
    });
    const campaignId = campaignRecord.campaign_id as CampaignId;

    // Seed Duration Plan
    const candidateCapability: H3ProfileFrameCapability = {
      profileKey: candidateProfileKey,
      route: "ref2v",
      routingMode: "reference_directed",
      width: 1344,
      height: 768,
      fps: 24,
      allowedFrameCounts: [243],
      isAllowedFrameCount: (f: number) => f === 243,
      toleranceMs: 355,
      preferredDurationMs: 10000
    };

    const candidateSelection: ExecutionProfileSelection = {
      kind: "staging_candidate",
      profileKey: candidateProfileKey,
      specificationDigest: sim243f.candidate.specificationDigest,
      authorizationId: "auth-sim-243f",
      targetId: "target-sim-gpu-1"
    };

    const durationPlan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: 20000,
      explicitSceneDurationsMs: [10000, 10000],
      selectedProfileSelection: candidateSelection,
      allowedProfileSelections: [candidateSelection],
      realm: testRealm,
      scope: "staging",
      capabilities: new Map([[candidateProfileKey, candidateCapability]])
    });

    await uow.execute(async (ctx) => {
      await ctx.durationPlans?.savePlan(durationPlan);
    });

    // 2. Upload Reference Asset
    const imageValidator = new SharpImageInspectionAdapter();
    const referenceAssetRepo = new PostgresReferenceAssetRepository(pool);
    const uploadRef = new UploadReferenceAssetUseCase({
      referenceAssetRepository: referenceAssetRepo,
      objectStorage,
      imageValidator
    });

    const refPng = await sharp({
      create: {
        width: 1344,
        height: 768,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    const uploadedRef = await uploadRef.execute({
      clientId,
      body: refPng,
      declaredMimeType: "image/png",
      displayName: "Key Visual Reference",
      libraryRole: "subject_identity"
    });

    // 3. Seed Scenes
    const scene1Record = await insertStoryboardSceneRecord(client, {
      campaignId,
      sceneOrder: 1,
      durationSeconds: 10,
      status: "director_review",
      specRevision: 1,
      engineAssigned: candidateProfileKey
    });
    const scene2Record = await insertStoryboardSceneRecord(client, {
      campaignId,
      sceneOrder: 2,
      durationSeconds: 10,
      status: "director_review",
      specRevision: 1,
      engineAssigned: candidateProfileKey
    });
    const scene1Id = scene1Record.scene_id as SceneId;
    const scene2Id = scene2Record.scene_id as SceneId;

    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene1Id,
      assetId: uploadedRef.id as ReferenceAssetId,
      specRevision: 1,
      role: "subject_identity",
      weight: 1.0
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: scene2Id,
      assetId: uploadedRef.id as ReferenceAssetId,
      specRevision: 1,
      role: "subject_identity",
      weight: 1.0
    });

    const bindingEntries = [
      {
        allocationId: durationPlan.allocations[0]!.allocationId,
        sceneId: scene1Id,
        specRevision: 1,
        ordinal: 1
      },
      {
        allocationId: durationPlan.allocations[1]!.allocationId,
        sceneId: scene2Id,
        specRevision: 1,
        ordinal: 2
      }
    ];
    const bindingDigest = computePlanBindingDigest(bindingEntries);
    await uow.execute(async (ctx) => {
      await ctx.durationPlans?.saveBindings([
        {
          bindingId: randomUUID(),
          campaignId,
          planId: durationPlan.planId,
          planRevision: durationPlan.revision,
          allocationId: durationPlan.allocations[0]!.allocationId,
          sceneId: scene1Id,
          specRevision: 1,
          ordinal: 1,
          bindingDigest,
          createdAt: new Date().toISOString()
        },
        {
          bindingId: randomUUID(),
          campaignId,
          planId: durationPlan.planId,
          planRevision: durationPlan.revision,
          allocationId: durationPlan.allocations[1]!.allocationId,
          sceneId: scene2Id,
          specRevision: 1,
          ordinal: 2,
          bindingDigest,
          createdAt: new Date().toISOString()
        }
      ]);
    });

    // 4. Generate ShotPlans via PlanShotPlansUseCase
    const mockPlanningClient: PlanningModelClientPort = {
      providerName: "Anthropic",
      imageCapability: true,
      supportsImages: true,
      complete: async (req) => {
        if (req.systemPrompt?.includes("visual analysis assistant")) {
          return { kind: "success", rawText: "Candidate visual description" };
        }
        return {
          kind: "success",
          rawText: JSON.stringify({
            variants: [
              {
                framing: "wide",
                angle: "eye_level",
                cameraMovement: "static",
                movementSpeed: "slow",
                lensIntent: "35mm",
                cameraPosition: "eye height",
                cameraPromptDescription: "Static wide shot",
                actionSummary: "Subject appears in frame",
                lightingStyle: "natural",
                environmentDescription: "Studio environment",
                colorPalette: ["blue", "grey"],
                atmosphere: "clean",
                subjects: [
                  {
                    subjectId: "sub-1",
                    role: "subject_identity",
                    referenceAssetId: uploadedRef.id,
                    initialPosition: "center",
                    movementTrajectory: "stationary"
                  }
                ],
                beats: [
                  {
                    beatIndex: 1,
                    startMs: 0,
                    endMs: 10000,
                    description: "Continuous 243f motion",
                    cameraAction: "static",
                    subjectAction: "motion"
                  }
                ]
              },
              {
                framing: "medium",
                angle: "eye_level",
                cameraMovement: "tracking",
                movementSpeed: "slow",
                lensIntent: "50mm",
                cameraPosition: "eye height",
                cameraPromptDescription: "Slow tracking medium shot",
                actionSummary: "Subject walks into frame",
                lightingStyle: "natural",
                environmentDescription: "Studio environment",
                colorPalette: ["blue", "grey"],
                atmosphere: "clean",
                subjects: [
                  {
                    subjectId: "sub-1",
                    role: "subject_identity",
                    referenceAssetId: uploadedRef.id,
                    initialPosition: "center",
                    movementTrajectory: "stationary"
                  }
                ],
                beats: [
                  {
                    beatIndex: 1,
                    startMs: 0,
                    endMs: 10000,
                    description: "Continuous 243f motion",
                    cameraAction: "tracking",
                    subjectAction: "motion"
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

    const shotPlansScene1 = await planShotPlans.execute({
      sceneId: scene1Id,
      variantCount: 2,
      enqueuePrevisJobs: false
    });
    expect(shotPlansScene1.shotPlans.length).toBeGreaterThanOrEqual(2);

    const shotPlansScene2 = await planShotPlans.execute({
      sceneId: scene2Id,
      variantCount: 2,
      enqueuePrevisJobs: false
    });
    expect(shotPlansScene2.shotPlans.length).toBeGreaterThanOrEqual(2);

    // 4b. Select and approve one ShotPlan variant per scene via the real
    // review-command use cases, so StageH3CandidateRenderUseCase's internal
    // PrepareSceneProductionInputsUseCase has a genuinely approved ShotPlan
    // to prepare inputs from (AC-2/AC-9/F-b4ff8304: no longer skipped).
    const reviewScene = new ReviewSceneUseCases(uow);
    for (const [sceneId, shotPlans] of [
      [scene1Id, shotPlansScene1.shotPlans],
      [scene2Id, shotPlansScene2.shotPlans]
    ] as const) {
      const shotPlan = shotPlans[0]!;
      await reviewScene.selectShotPlan({
        sceneId,
        eventId: randomUUID(),
        reviewerName: "operator",
        occurredAt: new Date().toISOString(),
        shotPlanId: shotPlan.id,
        expectedSpecRevision: 1
      });
      await reviewScene.approveShotPlan({
        sceneId,
        eventId: randomUUID(),
        reviewerName: "operator",
        occurredAt: new Date().toISOString(),
        shotPlanId: shotPlan.id,
        expectedSpecRevision: 1
      });
    }

    const stagingAuthSource: StagingPlanningAuthorizationSource = {
      resolveCandidateGrant: async () => grant243f
    };

    // 5. Real staging-candidate admission: a trusted, signature-verified
    // capability matrix admits sim243f.candidate, and a real operator
    // signature verifier authorizes the grant — both pinned to a clock
    // inside the fixture's issued/expires window rather than wall-clock
    // "now" (the fixture's grant is dated in the past relative to this
    // simulated world's "today").
    const pinnedNow = () => new Date("2026-10-24T12:00:00.000Z");
    const capabilityMatrixSignerKeyId = "operator-opsclawd";
    const decisionEnvelope = createSignedTestCapabilityEnvelope({
      rows: [sim243f.decisionRow],
      privateKey,
      signedBy: capabilityMatrixSignerKeyId
    });
    const registryReader = new H3TrustedCandidateRegistryReader({
      candidateProfiles: [sim243f.candidate],
      decisionEnvelope,
      trustedPublicKeys: new Map([[capabilityMatrixSignerKeyId, publicKey]]),
      evidenceResolver: (digest: string) =>
        digest === sim243f.evidenceDigest ? sim243f.evidenceBytes : undefined
    });
    const authorizationPort = new H3OperatorSignatureVerifier({
      trustedPublicKeys: new Map([[grant243f.signerKeyId, publicKey]]),
      now: pinnedNow
    });

    const stageRenderUseCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader,
      authorizationPort,
      prepareInputsOptions: {
        objectStorage,
        hashBytes: { hashBytes: async (bytes: Uint8Array) => sha256Hex(bytes) },
        imageValidator,
        registryReader
      }
    });

    const beginRunUseCase = new BeginOperatorAcceptanceRunUseCase({
      uow,
      stageRenderUseCase,
      stagingAuthSource
    });

    const beginResult = await beginRunUseCase.execute({
      campaignId,
      actionId: "action-begin-e2e",
      requestedBy: "operator"
    });
    expect(beginResult.status).toBe("dispatched");
    expect(beginResult.sceneCount).toBe(2);

    // 6. Real candidate render execution: a listening control-api server
    // dispatches each real render_jobs row to a real RenderWorker running
    // the real createCertifiedRenderJobExecutor candidate path (real
    // AssembleGenerationManifest, real ffprobe measurement). Only the
    // actual GPU/ComfyUI network boundary is simulated — via
    // FakeComfyUiTransport for the prompt/websocket/history protocol, and
    // a direct outputReader injection for the "rendered" bytes — which are
    // themselves real, CPU-synthesized 243-frame MP4 clips produced by a
    // real `ffmpeg` binary (AC-1/AC-2/AC-9/AC-15/F-b4ff8304/F-427e7892).
    const manifestRepo = new PostgresGenerationManifestRepository(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const storageTelemetry = {
      async getStorageTelemetry() {
        return {
          totalBytes: 1_000_000_000,
          freeBytes: 500_000_000,
          usedBytes: 500_000_000,
          measuredAt: new Date().toISOString(),
          buckets: [
            { bucket: BUCKETS.TEMP, usedBytes: 100_000 },
            { bucket: BUCKETS.REVIEW, usedBytes: 100_000 },
            { bucket: BUCKETS.DELIVERY, usedBytes: 100_000 },
            { bucket: BUCKETS.CANDIDATES, usedBytes: 100_000 }
          ]
        };
      }
    };
    const workerStagingToken = "test-staging-token-h3-243f";
    const controlApiApp = createControlApiApp(
      {
        uow,
        jobQueue,
        storageTelemetry,
        realmAdmissionContext: new IsolatedSimulationRealmContext({
          testRealmId: testRealm.testRealmId,
          isolationDescriptorDigest: testRealm.isolationDescriptorDigest
        })
      },
      {
        jobDispatch: {
          leaseDurationMs: 300_000,
          heartbeatIntervalMs: 30_000,
          resolveWorkerStagingToken: () => workerStagingToken,
          allowedExecutionScopes: ["production", "staging"]
        }
      }
    );
    const controlApiBaseUrl = await controlApiApp.listen({ port: 0, host: "127.0.0.1" });
    const controlApiClient = createControlApiClient({
      baseUrl: controlApiBaseUrl,
      workerStagingToken
    });

    const stemsDir = await mkdtemp(join(tmpdir(), "h3-243f-synthetic-stems-"));
    const syntheticStems = await generateSyntheticStems({
      outputDir: stemsDir,
      count: 2,
      durationSec: 243 / 24,
      width: 1344,
      height: 768,
      fps: 24,
      format: "mp4"
    });

    const sceneRepository = new PostgresSceneRepository(pool);
    const campaignRepository = new PostgresCampaignRepository(pool);
    const rawWorkflow243f = JSON.stringify(sim243f.rawWorkflow);

    const makeCandidateExecutor = (fakeVideoBytes: Uint8Array) => {
      const transport = new FakeComfyUiTransport();
      let promptCounter = 0;
      transport.fakeFetch.setDefaultResponseHandler(async (input, init) => {
        const urlStr = String(input);
        if (urlStr.includes("/upload/image")) {
          const formData = init?.body as FormData;
          const file = formData.get("image") as File;
          return new Response(
            JSON.stringify({ name: file.name, subfolder: "conditioning", type: "input" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.includes("/history/")) {
          const promptId = urlStr.split("/").pop() || "prompt-1";
          return new Response(
            JSON.stringify({
              [promptId]: {
                status: { completed: true, status_str: "success" },
                outputs: { "92": { images: [{ filename: "output.mp4", type: "output" }] } }
              }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (urlStr.endsWith("/prompt") || urlStr.includes("/prompt?")) {
          promptCounter += 1;
          const promptId = `prompt-${promptCounter}`;
          queueMicrotask(() => {
            const ws = transport.createdWebSockets[transport.createdWebSockets.length - 1];
            ws?.message({ type: "executing", data: { prompt_id: promptId, node: null } });
          });
          return new Response(JSON.stringify({ prompt_id: promptId }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }
        if (urlStr.includes("/free")) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      });
      const origCreateWebSocket = transport.createWebSocket.bind(transport);
      transport.createWebSocket = (url: string) => {
        const ws = origCreateWebSocket(url);
        const origAdd = ws.addEventListener.bind(ws);
        ws.addEventListener = (type, listener) => {
          origAdd(type, listener);
          if (type === "message") {
            queueMicrotask(() => {
              ws.message({
                type: "status",
                data: { status: { exec_info: { queue_remaining: 0 } } }
              });
            });
          }
        };
        return ws;
      };

      const comfyUiClient = new ComfyUiClient("http://127.0.0.1:8188", transport);
      const stageReferenceImage = new HttpComfyUiInputStagingAdapter({
        client: comfyUiClient,
        comfyUiDir: "/tmp/fake-comfyui-h3",
        unlinkFn: async () => {}
      });
      const renderEngine = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport
      });
      const fakeGpuLease = {
        acquireLease: async () => ({
          holder: {
            version: 1 as const,
            pid: 4242,
            startedAt: new Date().toISOString(),
            hostname: "test-host",
            leaseId: randomUUID()
          },
          release: async () => {}
        })
      };
      const fakeGpuTelemetry: GpuTelemetryPort = {
        readMemory: async () => ({
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        })
      };
      const noopLicense: EnforceLicenseRouting = { enforce: () => {} };
      const executeProfileRenderUseCase = new ExecuteProfileRenderUseCase(
        renderEngine,
        fakeGpuLease,
        fakeGpuTelemetry,
        noopLicense
      );
      const executeProfileRender = (
        input: Parameters<typeof executeProfileRenderUseCase.execute>[0]
      ) => executeProfileRenderUseCase.execute(input);
      const productionAssembler = new AssembleGenerationManifest({
        hashBytes: { hashBytes: async (bytes: Uint8Array) => sha256Hex(bytes) },
        sceneRepository,
        storyboardCandidateRepository: {
          findById: async () => undefined,
          insert: async () => {},
          listBySceneAndRevision: async () => []
        },
        referenceAssetRepository: referenceAssetRepo
      });

      return createCertifiedRenderJobExecutor({
        targetGpuUuid: SOURCE_GPU_UUID,
        targetHostname: SOURCE_HOSTNAME,
        registryReader,
        authorizationPort,
        eligibilityService: {
          evaluateEligibility: async () => ({ eligible: true })
        } as unknown as H3CandidateEligibilityService,
        readApprovedProvenance: async () => sim243f.provenanceReport,
        readWorkflowFile: async () => rawWorkflow243f,
        shotPlanRepository: new PostgresShotPlanRepository(pool),
        sceneRepository,
        campaignRepository,
        referenceAssetRepository: referenceAssetRepo,
        imageValidator,
        objectStorage,
        stageReferenceImage,
        executeProfileRender,
        outputReader: {
          readOutput: async () => ({ bytes: fakeVideoBytes, contentType: "video/mp4" })
        },
        candidateBucket: BUCKETS.CANDIDATES,
        productionManifestAssembler: productionAssembler
      });
    };

    for (let i = 0; i < beginResult.dispatchedJobIds.length; i++) {
      const claimedJob = await controlApiClient.claim(
        `worker-h3-243f-${i}`,
        ["candidate", "production"],
        ["staging", "production"]
      );
      expect(claimedJob).toBeDefined();
      const executor = makeCandidateExecutor(syntheticStems[i]!.bytes);
      const worker = new RenderWorker(
        {
          controlApiClient,
          objectStorage,
          enforceStorageAdmission: {
            execute: async () => {}
          } as unknown as EnforceStorageAdmission,
          renderJobExecutor: executor,
          logger: { info: () => {}, warn: console.warn, error: console.error },
          sleep: async () => {}
        },
        {
          workerId: `worker-h3-243f-${i}`,
          pollIntervalMs: 1000,
          heartbeatIntervalMs: 5000,
          leaseDurationMs: 30000,
          allowedJobKinds: ["candidate", "production"]
        }
      );
      const outcome = await worker.processJob(claimedJob!);
      if (outcome !== "completed") {
        // Surface the real render_jobs.error_trace rather than just the
        // "failed" outcome string, so a CI regression here is diagnosable
        // from the test log alone.
        const failedJob = await client.query(
          "SELECT error_trace FROM render_jobs WHERE job_id = $1",
          [claimedJob!.jobId]
        );
        console.error("Candidate render job failed:", failedJob.rows[0]?.error_trace);
      }
      expect(outcome).toBe("completed");
    }

    // 7. Accept Scenes
    const acceptSceneUseCase = new AcceptOperatorAcceptanceSceneUseCase({ uow });
    await acceptSceneUseCase.execute({
      acceptanceRunId: beginResult.acceptanceRunId,
      sceneId: scene1Id,
      expectedAttemptOrdinal: 1,
      actionId: "action-accept-1",
      acceptedBy: "operator"
    });
    await acceptSceneUseCase.execute({
      acceptanceRunId: beginResult.acceptanceRunId,
      sceneId: scene2Id,
      expectedAttemptOrdinal: 1,
      actionId: "action-accept-2",
      acceptedBy: "operator"
    });

    // 8. Enqueue Operator Acceptance Assembly
    const assembleRunUseCase = new AssembleOperatorAcceptanceRunUseCase({ uow });
    const assembleResult = await assembleRunUseCase.execute({
      acceptanceRunId: beginResult.acceptanceRunId,
      actionId: "action-enqueue-assembly",
      requestedBy: "operator"
    });
    expect(assembleResult.status).toBe("assembling");
    expect(assembleResult.assemblyJobId).toBeDefined();

    // 9. Run Acceptance Delivery Assembly Worker
    // Real FFmpeg delivery assembly over the two real candidate render
    // outputs produced in step 6, and a real HttpAcceptanceAssemblyControlApiClient
    // against the real listening control-api server (not a direct uow
    // injection) — AC-1/AC-9/AC-15/F-b4ff8304/F-427e7892.
    const assemblyWorkspaceRoot = await mkdtemp(join(tmpdir(), "h3-243f-assembly-"));
    const mediaAssembler = new FfmpegMediaAssemblerAdapter({
      ffmpegPath: "ffmpeg",
      ffprobePath: "ffprobe",
      workspaceRoot: assemblyWorkspaceRoot,
      outputBucket: BUCKETS.CANDIDATES,
      objectStorage
    });
    const runtimeComponents = await mediaAssembler.getRuntimeComponents();

    // License registry must register whatever this machine's real ffmpeg
    // binary actually reports (componentId/version), not a guessed string —
    // EnforceLicenseRouting fails closed on any unregistered runtime component.
    const licenseRegistry = new JsonFileLicenseRegistryPort({
      registryRevision: "2026-10-24.1",
      generatedAt: "2026-10-24T00:00:00.000Z",
      entries: [
        {
          componentId: "MINIMAX_H3_720P_5S_REF2V_V1",
          componentType: "model",
          versionOrRevision: "1",
          status: "approved",
          licenseSource: "docs/licenses.md",
          policyRevision: "1",
          notes: "Approved Ref2V component"
        },
        ...runtimeComponents.map((c) => ({
          componentId: c.componentId,
          componentType: c.componentType,
          versionOrRevision: c.versionOrRevision,
          status: "approved" as const,
          licenseSource: "docs/licenses.md",
          policyRevision: "1",
          notes: "Approved assembler runtime component"
        }))
      ]
    });
    const enforceLicense = new EnforceLicenseRouting({ registry: licenseRegistry });

    const assembleDeliveryReel = new AssembleDeliveryReel({
      mediaAssembler,
      objectStorage,
      enforceLicenseRouting: enforceLicense,
      generationManifestRepository: manifestRepo,
      runtimeComponents
    });

    // Same listening control-api server used for candidate render dispatch
    // above also serves /api/acceptance-assembly-jobs/*.
    const acceptanceControlApiClient = new HttpAcceptanceAssemblyControlApiClient(
      controlApiBaseUrl,
      undefined,
      undefined,
      workerStagingToken
    );

    const assemblyWorker = new AcceptanceDeliveryAssemblyWorker(
      {
        controlApiClient: acceptanceControlApiClient,
        assembleDeliveryReel: async ({ spec, targetBucket, acceptanceRunId: runId, outputKey }) =>
          assembleDeliveryReel.assemble({ spec, targetBucket, acceptanceRunId: runId, outputKey }),
        objectStorage,
        logger: console
      },
      { workerId: "worker-e2e-1" }
    );

    const jobProcessed = await assemblyWorker.processNextJob();
    expect(jobProcessed).toBeDefined();
    await controlApiApp.close();

    // 10. Reel Readback via ResolveOperatorAcceptanceReelUseCase
    const resolveReelUseCase = new ResolveOperatorAcceptanceReelUseCase({
      uow,
      objectStorage,
      mediaDelivery: reviewMediaDelivery
    });

    const reelResult = await resolveReelUseCase.execute({
      acceptanceRunId: beginResult.acceptanceRunId,
      reviewerName: "operator",
      clientId
    });

    expect(reelResult.status).toBe("completed");
    if (reelResult.status === "completed") {
      expect(reelResult.storageBucket).toBe(BUCKETS.CANDIDATES);
      expect(reelResult.manifestStorageBucket).toBe(BUCKETS.CANDIDATES);
      expect(reelResult.fps).toBe(30);
      // Real ffmpeg's actual re-encode/CFR-conversion duration (measured via
      // real ffprobe) for 2 real ~10.125s stems is a few ms off the exact
      // nominal 20250ms sum — tolerance matches ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS
      // conventions used elsewhere in this repo's real-ffmpeg assembly tests.
      expect(Math.abs(reelResult.durationMs! - 20250)).toBeLessThanOrEqual(200);
      expect(reelResult.resolution).toEqual({ width: 1080, height: 1920 });
      expect(reelResult.stemLineage?.length).toBe(2);
      expect(reelResult.url).toBeDefined();
    }
  }, 120_000);

  it("preserves historical 5-second ShotPlan and GenerationManifest repository round trips", async () => {
    const clientRecord = await insertClientRecord(client, { companyName: "Historical Studio" });
    const clientId = clientRecord.client_id;
    const campaignRecord = await insertCampaignRecord(client, {
      clientId,
      title: "Historical Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0
    });
    const campaignId = campaignRecord.campaign_id as CampaignId;

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId,
      sceneOrder: 1,
      durationSeconds: 5,
      status: "director_review",
      specRevision: 1,
      engineAssigned: "minimax-h3-720p@certified-v1"
    });
    const sceneId = sceneRecord.scene_id as SceneId;

    const shotPlanRepo = new PostgresShotPlanRepository(pool);
    const manifestRepo = new PostgresGenerationManifestRepository(pool);

    const planId = randomUUID() as ShotPlanId;
    const historicalPlan = ShotPlan.create({
      id: planId,
      sceneId,
      specRevision: 1,
      variantOrdinal: 1,
      targetDurationMs: 5000,
      targetFrameCount: 120,
      framing: "medium_close_up",
      angle: "eye_level",
      cameraMovement: "static",
      movementSpeed: "slow",
      lensIntent: "50mm prime",
      cameraPosition: "eye height",
      cameraPromptDescription: "Static medium close-up shot",
      actionSummary: "Subject turns to camera",
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 5000,
          description: "Subject turns to camera",
          cameraAction: "static",
          subjectAction: "turn"
        }
      ],
      lightingStyle: "cinematic",
      environmentDescription: "Indoor studio",
      colorPalette: ["warm"],
      atmosphere: "clear",
      subjects: []
    });

    await shotPlanRepo.save(historicalPlan);
    const readPlan = await shotPlanRepo.findById(planId);
    expect(readPlan).toBeDefined();
    expect(readPlan?.id).toBe(planId);
    expect(readPlan?.beats.length).toBe(1);

    const manifestId = randomUUID();
    const historicalJob = await insertRenderJobRecord(client, {
      sceneId,
      jobKind: "production",
      status: "completed"
    });

    const historicalManifest = {
      generationManifestId: manifestId,
      campaignId,
      sceneId,
      attemptId: randomUUID(),
      jobId: historicalJob.job_id,
      renderProfile: "MINIMAX_H3_720P_5S_REF2V_V1",
      renderProfileVersion: 1,
      executionScope: "production" as const,
      ownerKind: "production_run" as const,
      realm: { kind: "deployed" as const, deploymentId: "deploy-prod-1" },
      evidenceOrigin: "live_execution" as const,
      productionInputFingerprint: "e".repeat(64),
      workflowDefinitionHash: "f".repeat(64),
      pipelineSpecificationDigest: "a".repeat(64),
      outputChecksumsSha256: ["b".repeat(64)],
      workflowParameters: {
        steps: 20,
        cfg: 1,
        sampler: "euler",
        scheduler: "normal",
        denoise: 1,
        width: 1280,
        height: 720,
        frameCount: 120,
        fps: 24
      },
      specRevision: 1,
      frameCount: 120,
      fps: 24,
      measuredMedia: {
        outputKey: `campaigns/${campaignId}/scenes/${sceneId}/output.mp4`,
        checksumSha256: "b".repeat(64),
        container: "ffprobe" as const,
        dimensions: { width: 1280, height: 720 },
        frameCount: 120,
        fps: 24,
        durationMs: 5000,
        formatDurationMs: 5000,
        video: {
          codecName: "h264",
          pixelFormat: "yuv420p"
        },
        measurement: "source_bytes" as const
      },
      models: [],
      inputs: {
        videoPromptText: "Historical video prompt",
        referenceImages: []
      },
      outputs: [
        {
          bucket: BUCKETS.DELIVERY,
          key: `campaigns/${campaignId}/scenes/${sceneId}/output.mp4`,
          checksumSha256: "b".repeat(64),
          byteLength: 500000
        }
      ],
      createdAt: new Date().toISOString()
    };

    const insertedManifest = await insertGenerationManifestRecord(client, {
      manifestId,
      jobId: historicalJob.job_id,
      promptIdComfy: "prompt-hist-1",
      campaignId,
      sceneId,
      renderAttempt: 1,
      manifestPayload: historicalManifest
    });

    const readStem = await manifestRepo.findVideoStemSourceByJobId(historicalJob.job_id);
    expect(readStem).toBeDefined();
    expect(readStem?.generationManifestId).toBe(insertedManifest.manifest_id);
    expect(readStem?.renderProfile).toBe("MINIMAX_H3_720P_5S_REF2V_V1");
    expect(readStem?.executionScope).toBe("production");
  }, 120_000);
});
