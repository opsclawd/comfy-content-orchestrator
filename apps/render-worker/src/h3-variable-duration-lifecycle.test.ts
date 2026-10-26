import { describe, expect, it, vi } from "vitest";
import { createHash, randomUUID, type KeyObject } from "node:crypto";
import {
  computeH3CandidateKey,
  computeAssemblyId,
  validateShotPlanDuration,
  MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY,
  MAX_SCENE_DURATION_MS,
  CampaignDurationPlanningError,
  OperatorAcceptanceIdempotencyConflictError,
  H3CandidateExecutionSpecificationSchema,
  ShotPlanDocumentSchema,
  GenerationManifestSchema,
  type AssemblyExecutionResult,
  type AssemblySpec,
  type H3CandidateProfile,
  type H3CandidateProfileKey,
  type IsolatedTestRealm,
  type H3CapabilityDecisionRow,
  type H3CapabilityMatrixEnvelope,
  type H3CandidateAuthorizationGrant
} from "@cco/contracts";
import { Scene, type SceneId } from "@cco/domain";
import { BUCKETS } from "@cco/shared";
import {
  H3TrustedCandidateRegistryReader,
  JsonFileProductionReleaseReader
} from "@cco/infrastructure";

interface SourceMatrixFixture {
  readonly SOURCE_ROW_362F: H3CapabilityDecisionRow;
  readonly HISTORICAL_NO_GO_ROW_362F: H3CapabilityDecisionRow;
  readonly createDerivedSimulation243fFixture: () => {
    readonly candidate: H3CandidateProfile;
    readonly rawWorkflow: Record<string, unknown>;
    readonly workflowHash: string;
    readonly specificationDigest: string;
    readonly provenanceReport: unknown;
    readonly evidenceDigest: string;
    readonly evidenceBytes: Buffer;
    readonly decisionRow: H3CapabilityDecisionRow;
    readonly sourceMapping: unknown;
  };
  readonly generateTestOperatorKeyPair: () => {
    readonly publicKey: KeyObject;
    readonly publicKeyPem: string;
    readonly privateKey: KeyObject;
  };
  readonly createSignedTestCandidateGrant: (options: {
    readonly candidate: H3CandidateProfile;
    readonly privateKey: KeyObject;
    readonly signerKeyId?: string;
    readonly purpose?: "staging" | "production";
    readonly scope?: "staging" | "production";
  }) => H3CandidateAuthorizationGrant;
  readonly createSignedTestCapabilityEnvelope: (
    optionsOrRows:
      | {
          readonly rows: readonly H3CapabilityDecisionRow[];
          readonly privateKey: KeyObject;
          readonly signedBy?: string;
          readonly matrixId?: string;
        }
      | readonly H3CapabilityDecisionRow[]
  ) => H3CapabilityMatrixEnvelope;
}

const fixtureModulePath = "../../../tests/fixtures/h3-variable-duration/source-matrix.js";
const {
  SOURCE_ROW_362F,
  HISTORICAL_NO_GO_ROW_362F,
  createDerivedSimulation243fFixture,
  generateTestOperatorKeyPair,
  createSignedTestCandidateGrant,
  createSignedTestCapabilityEnvelope
} = (await import(fixtureModulePath)) as unknown as SourceMatrixFixture;
import { InMemorySceneUnitOfWork } from "../../../packages/application/src/test-support/in-memory-scene-unit-of-work.js";
import {
  CreateCampaignShellUseCase,
  BeginOperatorAcceptanceRunUseCase,
  AcceptOperatorAcceptanceSceneUseCase,
  AssembleOperatorAcceptanceRunUseCase,
  ResolveOperatorAcceptanceReelUseCase,
  AssembleDeliveryReel,
  EnforceLicenseRouting,
  LicenseRoutingError,
  type StageH3CandidateRenderUseCase,
  type ObjectStoragePort,
  type ReviewMediaDeliveryPort,
  type GenerationManifestRepository,
  type MediaAssemblerPort,
  type H3CandidateRegistryReader,
  type ProductionReleaseCapabilityReader,
  type StagingPlanningAuthorizationSource
} from "@cco/application";
import { AcceptanceDeliveryAssemblyWorker } from "./acceptance-delivery-assembly-worker.js";

describe("Variable-Duration H3 Production Lifecycle & Regression Coverage", () => {
  const dummySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const { privateKey } = generateTestOperatorKeyPair();
  const sim243f = createDerivedSimulation243fFixture();
  const candidateProfileKey = sim243f.candidate.key;
  const grant243f = createSignedTestCandidateGrant({
    candidate: sim243f.candidate,
    privateKey
  });

  function createTestSetup() {
    const uow = new InMemorySceneUnitOfWork();
    const storedObjects = new Map<string, { body: Buffer; checksumSha256: string }>();

    const objectStorage: ObjectStoragePort = {
      getObject: vi.fn(async (locator) => {
        const item = storedObjects.get(`${locator.bucket}/${locator.key}`);
        if (!item) return undefined;
        return {
          body: item.body,
          bucket: locator.bucket,
          key: locator.key,
          checksumSha256: item.checksumSha256,
          contentLength: item.body.length,
          contentType: "video/mp4"
        };
      }),
      headObject: vi.fn(async (locator) => {
        const item = storedObjects.get(`${locator.bucket}/${locator.key}`);
        if (!item) return undefined;
        return {
          bucket: locator.bucket,
          key: locator.key,
          checksumSha256: item.checksumSha256,
          contentLength: item.body.length
        };
      }),
      putObject: vi.fn(async (input) => {
        const buf = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
        storedObjects.set(`${input.bucket}/${input.key}`, {
          body: buf,
          checksumSha256: input.checksumSha256
        });
        return { bucket: input.bucket, key: input.key };
      }),
      copyObject: vi.fn(async (from, to) => {
        const item = storedObjects.get(`${from.bucket}/${from.key}`);
        if (item) {
          storedObjects.set(`${to.bucket}/${to.key}`, item);
        }
        return to;
      })
    };

    const mediaDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(
        async (locator) => `https://signed.example.com/${locator.bucket}/${locator.key}`
      )
    };

    // Staging authorization source returning the derived 243f candidate grant
    const stagingAuthSource: StagingPlanningAuthorizationSource = {
      listAuthorizedCandidates: async () => [
        {
          kind: "staging_candidate",
          profileKey: candidateProfileKey as H3CandidateProfileKey,
          specificationDigest: sim243f.specificationDigest,
          targetId: "llama",
          authorizationId: "auth-243f-test"
        }
      ],
      resolveCandidateGrant: async () => grant243f
    };

    // Production release reader: strictly production releases only! Never staging candidate keys.
    const productionReleaseReader: ProductionReleaseCapabilityReader = {
      listReleasedProfiles: async () => [],
      getReleasedProfile: async () => undefined,
      isReleasedProfileKey: async () => false,
      getDeploymentEnablementState: async () => undefined
    };

    const candidateRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: (key: string | undefined) => {
        if (key === candidateProfileKey) {
          return sim243f.candidate;
        }
        return undefined;
      },
      listCandidateProfiles: () => [sim243f.candidate],
      isCandidateProfileKey: (key: string | undefined) => key === candidateProfileKey
    };

    const licenseRegistry = {
      getSnapshot: () => ({
        schemaVersion: 1 as const,
        registryRevision: "2026-10-24.1",
        generatedAt: "2026-10-24T12:00:00.000Z",
        entries: [
          {
            componentId: "ffmpeg",
            componentType: "runtime" as const,
            versionOrRevision: "n8.0.1",
            status: "approved" as const,
            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
            reviewedAt: "2026-08-29T12:00:00.000Z",
            policyRevision: "2026-08-29.1"
          },
          {
            componentId: "MINIMAX_H3_720P_5S_REF2V_V1",
            componentType: "model" as const,
            versionOrRevision: "1",
            status: "approved" as const,
            licenseSource: "operator-signed",
            reviewedAt: "2026-10-24T12:00:00.000Z",
            policyRevision: "2026-10-24.1"
          },
          {
            componentId: "MINIMAX_H3_720P_5S_I2V_V1",
            componentType: "model" as const,
            versionOrRevision: "1",
            status: "approved" as const,
            licenseSource: "operator-signed",
            reviewedAt: "2026-10-24T12:00:00.000Z",
            policyRevision: "2026-10-24.1"
          }
        ]
      })
    };
    const enforceLicenseRouting = new EnforceLicenseRouting({ registry: licenseRegistry });

    return {
      uow,
      objectStorage,
      mediaDelivery,
      stagingAuthSource,
      productionReleaseReader,
      candidateRegistryReader,
      enforceLicenseRouting,
      storedObjects
    };
  }

  describe("Required Automated Path 1 & 2: Full Positive Simulated Application Lifecycle", () => {
    it("runs campaign create -> 243f beat allocation -> ShotPlan approval -> acceptance dispatch -> render completion -> scene reviews -> assembly worker execution -> reel readback", async () => {
      const {
        uow,
        objectStorage,
        mediaDelivery,
        stagingAuthSource,
        productionReleaseReader,
        candidateRegistryReader,
        enforceLicenseRouting,
        storedObjects
      } = createTestSetup();

      const isolatedTestRealm: IsolatedTestRealm = {
        kind: "isolated_test",
        testRealmId: "test-realm-427-sim",
        isolationDescriptorDigest: "a".repeat(64)
      };

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource,
        productionReleaseReader,
        registryReader: candidateRegistryReader
      });

      // 1. Create campaign requesting 20,000ms duration, 2 scenes @ 10,000ms each, selecting candidate 243f Ref2V
      const targetDurationMs = 20_000;
      const sceneTargetMs = 10_000;
      const campaignResult = await createCampaignShell.execute({
        idempotencyKey: "idem-" + randomUUID(),
        clientId: "client-" + randomUUID(),
        title: "Variable Duration H3 243f Campaign",
        targetPlatform: "tiktok",
        targetTotalDurationMs: targetDurationMs,
        sceneCountOverride: 2,
        selectedProfileKey: candidateProfileKey,
        scope: "staging",
        realm: isolatedTestRealm,
        principal: "operator-primary"
      });

      const campaignId = campaignResult.campaign.id;
      const durationPlan = campaignResult.plan;
      expect(durationPlan).toBeDefined();

      // INVARIANT 5: Assert requested duration (20,000ms) vs exact nominal duration (20,250ms = 2 * 10,125ms) are never conflated
      expect(durationPlan!.requestedTotalDurationMs).toBe(20_000);
      expect(durationPlan!.totalNominalDurationMs).toBe(20_250);
      expect(durationPlan!.totalNominalDurationMs).not.toBe(durationPlan!.requestedTotalDurationMs);

      // Verify each scene's allocation
      expect(durationPlan!.allocations).toHaveLength(2);
      for (const allocation of durationPlan!.allocations) {
        expect(allocation.requestedDurationMs).toBe(sceneTargetMs);
        expect(allocation.nominalDurationMs).toBe(10_125);
        expect(allocation.frames).toBe(243);
        expect(allocation.fps).toBe(24);
        expect(allocation.profileSelection.profileKey).toBe(candidateProfileKey);
      }

      // Save scenes to campaign
      await uow.execute(async (ctx) => {
        for (let i = 1; i <= 2; i++) {
          const sceneId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as SceneId;
          const scene = Scene.create({
            id: sceneId,
            campaignId,
            sequenceIndex: i,
            configuration: {
              prompt: `Scene ${i} positive prompt`,
              durationMs: 10_000,
              engineProfileId: candidateProfileKey
            }
          });
          await ctx.scenes.save(scene);
        }
      });

      // 2. Begin Operator Acceptance Run
      const stagedRenders = new Map<string, { jobId: string; attemptId: string }>();
      const mockStageRenderUseCase = {
        executeWithContext: vi.fn(async (_ctx: unknown, input: unknown) => {
          const jobId = randomUUID();
          const attemptId = randomUUID();
          const sceneId = (input as { readonly sceneId: string }).sceneId;
          stagedRenders.set(sceneId, { jobId, attemptId });
          return {
            job: { jobId },
            attemptId
          };
        })
      } as unknown as StageH3CandidateRenderUseCase;

      const beginAcceptanceRun = new BeginOperatorAcceptanceRunUseCase({
        uow,
        stagingAuthSource,
        stageRenderUseCase: mockStageRenderUseCase
      });

      const beginActionId = "act-begin-" + randomUUID();
      const beginResponse = await beginAcceptanceRun.execute({
        campaignId,
        actionId: beginActionId,
        requestedBy: "operator-primary"
      });

      const acceptanceRunId = beginResponse.acceptanceRunId;
      expect(beginResponse.status).toBe("dispatched");
      expect(beginResponse.sceneCount).toBe(2);

      // 3. Stage render completion for both scenes with candidate specification digest
      const scenes = await uow.execute((ctx) =>
        ctx.operatorAcceptanceRuns!.findRunScenes(acceptanceRunId)
      );
      expect(scenes).toHaveLength(2);

      const generatedMediaPerScene: Array<{
        sceneId: string;
        attemptId: string;
        mediaKey: string;
        sha256: string;
      }> = [];

      for (let idx = 0; idx < scenes.length; idx++) {
        const scene = scenes[idx]!;
        const jobId = scene.acceptedStagingJobId!;
        const attemptId = scene.currentAttemptId!;
        const mediaKey = `staged-renders/scene-${idx + 1}-243f.mp4`;
        const mediaSha256 = "c".repeat(63) + idx;
        const mediaBuffer = Buffer.from(`simulated-rendered-video-stem-bytes-${idx}`);

        // Seed object storage
        storedObjects.set(`${BUCKETS.REVIEW}/${mediaKey}`, {
          body: mediaBuffer,
          checksumSha256: mediaSha256
        });

        // Seed generation manifest repository with stem source and measured media
        uow.seedVideoStemSource(jobId, {
          generationManifestId: "gen-manifest-" + scene.sceneId,
          jobId,
          sceneId: scene.sceneId,
          renderProfile: candidateProfileKey,
          candidateSpecificationDigest: sim243f.specificationDigest,
          specRevision: scene.specRevision,
          frames: 243,
          fps: 24,
          outputChecksumsSha256: [mediaSha256],
          executionScope: "staging",
          ownerKind: "staging_acceptance",
          acceptanceRunId,
          realm: isolatedTestRealm,
          evidenceOrigin: "simulated_test",
          routingMode: "reference_directed",
          route: "ref2v",
          measuredMedia: {
            outputKey: mediaKey,
            checksumSha256: mediaSha256,
            container: "ffprobe",
            dimensions: { width: 1344, height: 768 },
            frameCount: 243,
            fps: 24,
            durationMs: 10125,
            formatDurationMs: 10125,
            measurement: "source_bytes"
          },
          media: {
            bucket: BUCKETS.REVIEW,
            key: mediaKey,
            sha256: mediaSha256,
            contentType: "video/mp4"
          },
          renderAttempt: 1
        });

        // 4. Operator reviews and accepts the scene
        const acceptScene = new AcceptOperatorAcceptanceSceneUseCase({ uow });
        const acceptActionId = `act-accept-scene-${idx + 1}-` + randomUUID();
        const acceptResult = await acceptScene.execute({
          acceptanceRunId,
          sceneId: scene.sceneId,
          actionId: acceptActionId,
          expectedAttemptOrdinal: 1,
          acceptedBy: "operator-primary"
        });
        expect(acceptResult.accepted).toBe(true);

        generatedMediaPerScene.push({
          sceneId: scene.sceneId,
          attemptId,
          mediaKey,
          sha256: mediaSha256
        });
      }

      // 5. Assemble Operator Acceptance Run
      const assembleAcceptance = new AssembleOperatorAcceptanceRunUseCase({ uow });
      const assembleActionId = "act-assemble-" + randomUUID();
      const assembleResponse = await assembleAcceptance.execute({
        acceptanceRunId,
        actionId: assembleActionId,
        requestedBy: "operator-primary"
      });

      expect(assembleResponse.status).toBe("assembling");
      expect(assembleResponse.assemblyJobId).toBeDefined();

      // 6. Worker claims and executes assembly job targeting BUCKETS.CANDIDATES
      const reelMediaKey = `acceptance-runs/${acceptanceRunId}/reel.mp4`;
      const reelBuffer = Buffer.from("simulated-final-accepted-delivery-reel-mp4-stream");
      const reelSha256 = createHash("sha256").update(reelBuffer).digest("hex");
      storedObjects.set(`${BUCKETS.CANDIDATES}/${reelMediaKey}`, {
        body: reelBuffer,
        checksumSha256: reelSha256
      });

      const mockAssembler: MediaAssemblerPort = {
        assemble: vi.fn(async (spec: AssemblySpec): Promise<AssemblyExecutionResult> => {
          return {
            assemblyId: computeAssemblyId(spec),
            campaignId: spec.campaignId,
            assemblyProfile: spec.assemblyProfile,
            executedInputs: {
              videoStems: spec.videoStems.map((stem) => ({
                sceneId: stem.sceneId,
                generationManifestId: stem.generationManifestId,
                order: stem.order,
                media: stem.media,
                actualDurationMs: stem.expectedDurationMs
              }))
            },
            timeline: {
              totalDurationMs: 20_250,
              stemDurationsMs: [10_125, 10_125]
            },
            layout: { mode: "fit_blurred_fill" },
            subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
            ffmpeg: { executable: "ffmpeg", version: "7.0.2", buildInfo: "7.0.2-static" },
            commandFingerprint: "0".repeat(64),
            encoding: {
              video: { codec: "libx264", pixelFormat: "yuv420p", crf: 23, preset: "veryfast" }
            },
            streams: {
              video: {
                codecName: "h264",
                pixelFormat: "yuv420p",
                width: 1080,
                height: 1920,
                frameRate: 30,
                durationMs: 20_250
              }
            },
            output: {
              media: {
                bucket: BUCKETS.CANDIDATES,
                key: reelMediaKey,
                sha256: reelSha256,
                contentType: "video/mp4"
              },
              durationMs: 20_250,
              width: 1080,
              height: 1920
            },
            measuredFrameRate: 30,
            executionDurationMs: 2400
          };
        })
      };

      const assembleDeliveryReel = new AssembleDeliveryReel({
        mediaAssembler: mockAssembler,
        objectStorage,
        enforceLicenseRouting,
        generationManifestRepository: uow.generationManifests,
        runtimeComponents: [
          {
            componentId: "ffmpeg",
            componentType: "runtime",
            versionOrRevision: "n8.0.1"
          }
        ]
      });

      const worker = new AcceptanceDeliveryAssemblyWorker(
        {
          uow,
          assembleDeliveryReel: (params) => assembleDeliveryReel.assemble(params),
          objectStorage
        },
        { workerId: "acceptance-worker-test-1" }
      );

      const manifestRecord = await worker.processNextJob();
      expect(manifestRecord).toBeDefined();
      expect(manifestRecord!.jobId).toBe(assembleResponse.assemblyJobId);
      expect(manifestRecord!.acceptanceRunId).toBe(acceptanceRunId);
      expect(manifestRecord!.storageBucket).toBe(BUCKETS.CANDIDATES);
      expect(manifestRecord!.storageKey).toBe(reelMediaKey);
      expect(manifestRecord!.storageSha256).toBe(reelSha256);
      expect(manifestRecord!.planId).toBe(durationPlan!.planId);

      // 7. Resolve Operator Acceptance Reel Readback
      const resolveReel = new ResolveOperatorAcceptanceReelUseCase({
        uow,
        objectStorage,
        mediaDelivery
      });

      const reelReadModel = await resolveReel.execute({
        acceptanceRunId,
        reviewerName: "operator-primary"
      });
      expect(reelReadModel.status).toBe("completed");

      if (reelReadModel.status === "completed") {
        expect(reelReadModel.acceptanceRunId).toBe(acceptanceRunId);
        expect(reelReadModel.campaignId).toBe(campaignId);
        expect(reelReadModel.assemblyJobId).toBe(assembleResponse.assemblyJobId);
        expect(reelReadModel.manifestId).toBe(manifestRecord!.manifestId);
        expect(reelReadModel.storageBucket).toBe(BUCKETS.CANDIDATES);
        expect(reelReadModel.storageKey).toBe(reelMediaKey);
        expect(reelReadModel.storageSha256).toBe(reelSha256);
        expect(reelReadModel.durationMs).toBe(20_250);
        expect(reelReadModel.fps).toBe(30);
        expect(reelReadModel.frameCount).toBe(608); // (20,250ms / 1000) * 30 fps = 608 frames
        expect(reelReadModel.resolution).toEqual({ width: 1080, height: 1920 });
        expect(reelReadModel.url).toBe(
          `https://signed.example.com/${BUCKETS.CANDIDATES}/${reelMediaKey}`
        );

        // Verify stem lineage contains both scenes with exact persistent SHA-256 and keys
        expect(reelReadModel.stemLineage).toHaveLength(2);
        for (let i = 0; i < 2; i++) {
          const entry = reelReadModel.stemLineage![i]!;
          expect(entry.sceneId).toBe(generatedMediaPerScene[i]!.sceneId);
          expect(entry.attemptId).toBe(generatedMediaPerScene[i]!.attemptId);
          expect(entry.storageKey).toBe(generatedMediaPerScene[i]!.mediaKey);
          expect(entry.sha256).toBe(generatedMediaPerScene[i]!.sha256);
        }
      }
    });
  });

  describe("Required Negative Paths", () => {
    it("rejects off-grid frames (e.g. 244 frames) before GPU side effects", async () => {
      // 1. Schema boundary validation
      const validOnGrid = H3CandidateExecutionSpecificationSchema.safeParse({
        ...sim243f.candidate.specification,
        frames: 243
      });
      expect(validOnGrid.success).toBe(true);

      const offGridResult = H3CandidateExecutionSpecificationSchema.safeParse({
        ...sim243f.candidate.specification,
        frames: 244
      });
      expect(offGridResult.success).toBe(false);
      if (!offGridResult.success) {
        expect(offGridResult.error.issues[0]?.message).toMatch(/grid/i);
      }

      // 2. ShotPlan timing validation
      expect(validateShotPlanDuration(10125, 243)).toBe(true);
      expect(validateShotPlanDuration(10125, 244)).toBe(false);

      // 3. Application production planning gate (CreateCampaignShellUseCase)
      const { uow, productionReleaseReader } = createTestSetup();
      const offGridProfileKey = "H3_CANDIDATE_OFFGRID_TEST_V1" as H3CandidateProfileKey;
      const offGridCandidate: H3CandidateProfile = {
        ...sim243f.candidate,
        key: offGridProfileKey,
        specification: {
          ...sim243f.candidate.specification,
          frames: 244 as unknown as 243
        }
      };

      const stagingAuthSourceWithOffGrid: StagingPlanningAuthorizationSource = {
        listAuthorizedCandidates: async () => [
          {
            kind: "staging_candidate",
            profileKey: offGridProfileKey,
            specificationDigest: sim243f.specificationDigest,
            targetId: "llama",
            authorizationId: "auth-offgrid-test"
          }
        ],
        resolveCandidateGrant: async () =>
          createSignedTestCandidateGrant({
            candidate: offGridCandidate,
            privateKey
          })
      };

      const registryReaderWithOffGrid: H3CandidateRegistryReader = {
        getCandidateProfile: (key: string | undefined) =>
          key === offGridProfileKey ? offGridCandidate : undefined,
        listCandidateProfiles: () => [offGridCandidate],
        isCandidateProfileKey: (key: string | undefined) => key === offGridProfileKey
      };

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: stagingAuthSourceWithOffGrid,
        productionReleaseReader,
        registryReader: registryReaderWithOffGrid
      });

      await expect(
        createCampaignShell.execute({
          idempotencyKey: "idem-" + randomUUID(),
          clientId: "client-" + randomUUID(),
          title: "Off-Grid Campaign",
          targetTotalDurationMs: 20_000,
          sceneCountOverride: 2,
          selectedProfileKey: offGridProfileKey,
          scope: "staging",
          principal: "operator-primary"
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    it("rejects 362f configuration due to scene ceiling (15,083ms > 15,000ms MAX_SCENE_DURATION_MS)", async () => {
      const { uow, productionReleaseReader } = createTestSetup();

      const candidate362fKey = computeH3CandidateKey(SOURCE_ROW_362F.specificationDigest);
      const exactNominalDurationMs = Math.round(
        (SOURCE_ROW_362F.specification.frames / SOURCE_ROW_362F.specification.fps) * 1000
      ); // 15083

      const candidate362f: H3CandidateProfile = {
        key: candidate362fKey,
        version: 1,
        specificationDigest: SOURCE_ROW_362F.specificationDigest,
        specification: SOURCE_ROW_362F.specification,
        topology: {
          ...MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY,
          referenceImages: MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceImages
            ? [...MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceImages]
            : undefined,
          referenceSlotFields: MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceSlotFields
            ? [...MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceSlotFields]
            : undefined
        },
        status: "candidate"
      };

      const authSourceWith362f: StagingPlanningAuthorizationSource = {
        listAuthorizedCandidates: async () => [
          {
            kind: "staging_candidate",
            profileKey: candidate362fKey as H3CandidateProfileKey,
            specificationDigest: SOURCE_ROW_362F.specificationDigest,
            targetId: "llama",
            authorizationId: "auth-362f-test"
          }
        ],
        resolveCandidateGrant: async () => {
          return createSignedTestCandidateGrant({
            candidate: candidate362f,
            privateKey
          });
        }
      };

      const registryReaderWith362f: H3CandidateRegistryReader = {
        getCandidateProfile: (key: string | undefined) => {
          if (key === candidate362fKey) {
            return candidate362f;
          }
          return undefined;
        },
        listCandidateProfiles: () => [],
        isCandidateProfileKey: (key: string | undefined) => key === candidate362fKey
      };

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: authSourceWith362f,
        productionReleaseReader,
        registryReader: registryReaderWith362f
      });

      // 362 frames at 24fps is 15,083.33ms which exceeds MAX_SCENE_DURATION_MS (15,000ms)
      expect(exactNominalDurationMs).toBeGreaterThan(MAX_SCENE_DURATION_MS);

      // Attempting to create a campaign that allocates a scene to 362f must fail with scene_ceiling
      await expect(
        createCampaignShell.execute({
          idempotencyKey: "idem-" + randomUUID(),
          clientId: "client-" + randomUUID(),
          title: "Invalid 362f Campaign",
          targetTotalDurationMs: 15_000,
          sceneCountOverride: 1,
          selectedProfileKey: candidate362fKey,
          scope: "staging",
          principal: "operator-primary"
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    it("rejects candidate row with recorded NO_GO visual decision", async () => {
      // Historical 362f row had overallVerdict: "fail" with recorded NO_GO visual decision
      expect(HISTORICAL_NO_GO_ROW_362F.overallVerdict).toBe("fail");
      expect(HISTORICAL_NO_GO_ROW_362F.qualityVerdict).toBe("fail");

      // Verify H3TrustedCandidateRegistryReader refuses to index or admit NO_GO decision rows
      const { publicKey, privateKey } = generateTestOperatorKeyPair();
      const signedEnvelope = createSignedTestCapabilityEnvelope({
        matrixId: "h3-capability-matrix-historical-nogo",
        rows: [HISTORICAL_NO_GO_ROW_362F],
        privateKey,
        signedBy: "operator-opsclawd"
      });

      const publicKeys = new Map<string, KeyObject>([["operator-opsclawd", publicKey]]);
      const reader = new H3TrustedCandidateRegistryReader({
        decisionEnvelope: signedEnvelope,
        trustedPublicKeys: publicKeys,
        candidateProfiles: [
          {
            key: computeH3CandidateKey(HISTORICAL_NO_GO_ROW_362F.specificationDigest),
            version: 1,
            specificationDigest: HISTORICAL_NO_GO_ROW_362F.specificationDigest,
            specification: HISTORICAL_NO_GO_ROW_362F.specification,
            topology: {
              prompt: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "prompt" },
              seed: { nodeId: "15", classType: "RandomNoise", inputField: "noise_seed" },
              frameCount: {
                nodeId: "104",
                classType: "MiniMaxH3ImageToVideo",
                inputField: "length"
              },
              referenceImage: { nodeId: "20", classType: "LoadImage", inputField: "image" },
              firstFrame: { nodeId: "20", classType: "LoadImage", inputField: "image" },
              width: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "width" },
              height: { nodeId: "104", classType: "MiniMaxH3ImageToVideo", inputField: "height" }
            },
            status: "candidate"
          }
        ],
        evidenceResolver: (digest) => Buffer.from("mock-evidence-" + digest)
      });

      const nogoKey = computeH3CandidateKey(HISTORICAL_NO_GO_ROW_362F.specificationDigest);
      expect(reader.getCandidateProfile(nogoKey)).toBeUndefined();
      expect(reader.isCandidateProfileKey(nogoKey)).toBe(false);
      expect(reader.listCandidateProfiles()).toEqual([]);

      // Verify CreateCampaignShellUseCase fails closed when attempting to plan with NO_GO profile
      const { uow, productionReleaseReader } = createTestSetup();
      const authSourceForNoGo: StagingPlanningAuthorizationSource = {
        listAuthorizedCandidates: async () => [
          {
            kind: "staging_candidate",
            profileKey: nogoKey as H3CandidateProfileKey,
            specificationDigest: HISTORICAL_NO_GO_ROW_362F.specificationDigest,
            targetId: "llama",
            authorizationId: "auth-nogo-test"
          }
        ],
        resolveCandidateGrant: async () => undefined
      };

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: authSourceForNoGo,
        productionReleaseReader,
        registryReader: reader
      });

      await expect(
        createCampaignShell.execute({
          idempotencyKey: "idem-" + randomUUID(),
          clientId: "client-" + randomUUID(),
          title: "NO_GO Candidate Campaign",
          targetTotalDurationMs: 15_000,
          sceneCountOverride: 1,
          selectedProfileKey: nogoKey,
          scope: "staging",
          principal: "operator-primary"
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    it("rejects unapproved profile or forged candidate specificationDigest", async () => {
      const { uow, productionReleaseReader, candidateRegistryReader } = createTestSetup();

      const emptyStagingAuthSource: StagingPlanningAuthorizationSource = {
        listAuthorizedCandidates: async () => [],
        resolveCandidateGrant: async () => undefined
      };

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource: emptyStagingAuthSource,
        productionReleaseReader,
        registryReader: candidateRegistryReader
      });

      await expect(
        createCampaignShell.execute({
          idempotencyKey: "idem-" + randomUUID(),
          clientId: "client-" + randomUUID(),
          title: "Forged Candidate Campaign",
          targetTotalDurationMs: 20_000,
          sceneCountOverride: 2,
          selectedProfileKey: "H3_CANDIDATE_00000000000000000000000000000000_V1",
          scope: "staging",
          principal: "operator-primary"
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    it("rejects route cross-licensing (certified I2V never licenses Ref2V automatically)", async () => {
      const { objectStorage } = createTestSetup();

      const genManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(async () => ({
          renderProfile: candidateProfileKey,
          renderProfileVersion: 1,
          route: "ref2v" as const,
          candidateSpecificationDigest: sim243f.specificationDigest
        }))
      };

      // License registry only authorizes I2V, not Ref2V
      const i2vOnlyRegistry = {
        getSnapshot: () => ({
          schemaVersion: 1 as const,
          registryRevision: "2026-10-24.1",
          generatedAt: "2026-10-24T12:00:00.000Z",
          entries: [
            {
              componentId: "ffmpeg",
              componentType: "runtime" as const,
              versionOrRevision: "n8.0.1",
              status: "approved" as const,
              licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
              reviewedAt: "2026-08-29T12:00:00.000Z",
              policyRevision: "2026-08-29.1"
            },
            {
              componentId: "MINIMAX_H3_720P_5S_I2V_V1",
              componentType: "model" as const,
              versionOrRevision: "1",
              status: "approved" as const,
              licenseSource: "operator-signed",
              reviewedAt: "2026-10-24T12:00:00.000Z",
              policyRevision: "2026-10-24.1"
            }
          ]
        })
      };

      const enforceLicenseRoutingI2VOnly = new EnforceLicenseRouting({ registry: i2vOnlyRegistry });

      const mockAssembler: MediaAssemblerPort = {
        assemble: vi.fn()
      };

      const assembleDeliveryReel = new AssembleDeliveryReel({
        mediaAssembler: mockAssembler,
        objectStorage,
        enforceLicenseRouting: enforceLicenseRoutingI2VOnly,
        generationManifestRepository: genManifestRepo,
        runtimeComponents: [
          { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: "n8.0.1" }
        ]
      });

      const spec: AssemblySpec = {
        campaignId: "campaign-cross-license",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 10125,
        videoStems: [
          {
            sceneId: "scene-1",
            generationManifestId: "gen-ref2v",
            order: 0,
            media: {
              bucket: BUCKETS.REVIEW,
              key: "stem.mp4",
              sha256: dummySha256,
              contentType: "video/mp4"
            },
            expectedDurationMs: 10125
          }
        ],
        subtitleCues: []
      };

      await expect(
        assembleDeliveryReel.assemble({
          spec,
          targetBucket: BUCKETS.REVIEW
        })
      ).rejects.toThrow(LicenseRoutingError);

      expect(mockAssembler.assemble).not.toHaveBeenCalled();
    });

    it("rejects action replay when parameters conflict (HTTP 409 idempotency conflict)", async () => {
      const { uow, stagingAuthSource, productionReleaseReader, candidateRegistryReader } =
        createTestSetup();

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource,
        productionReleaseReader,
        registryReader: candidateRegistryReader
      });

      const campaignResult = await createCampaignShell.execute({
        idempotencyKey: "idem-" + randomUUID(),
        clientId: "client-" + randomUUID(),
        title: "Idempotency Test Campaign",
        targetTotalDurationMs: 20_000,
        sceneCountOverride: 2,
        selectedProfileKey: candidateProfileKey,
        scope: "staging",
        principal: "operator-primary"
      });

      await uow.execute(async (ctx) => {
        for (let i = 1; i <= 2; i++) {
          const sceneId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as SceneId;
          const scene = Scene.create({
            id: sceneId,
            campaignId: campaignResult.campaign.id,
            sequenceIndex: i,
            configuration: {
              prompt: `Scene ${i} positive prompt`,
              durationMs: 10_000,
              engineProfileId: candidateProfileKey
            }
          });
          await ctx.scenes.save(scene);
        }
      });

      const mockStageRenderUseCase = {
        executeWithContext: vi.fn(async (_ctx: unknown, _input: unknown) => ({
          job: { jobId: randomUUID() },
          attemptId: randomUUID()
        }))
      } as unknown as StageH3CandidateRenderUseCase;

      const beginAcceptanceRun = new BeginOperatorAcceptanceRunUseCase({
        uow,
        stagingAuthSource,
        stageRenderUseCase: mockStageRenderUseCase
      });

      const sharedActionId = "act-idempotency-test-1";

      // First call succeeds
      const firstResult = await beginAcceptanceRun.execute({
        campaignId: campaignResult.campaign.id,
        actionId: sharedActionId,
        requestedBy: "operator-primary"
      });
      expect(firstResult.status).toBe("dispatched");

      // Exact replay returns identical receipt
      const replayResult = await beginAcceptanceRun.execute({
        campaignId: campaignResult.campaign.id,
        actionId: sharedActionId,
        requestedBy: "operator-primary"
      });
      expect(replayResult.acceptanceRunId).toBe(firstResult.acceptanceRunId);

      // Conflicting replay with different parameter (different requestedBy) throws OperatorAcceptanceIdempotencyConflictError
      await expect(
        beginAcceptanceRun.execute({
          campaignId: campaignResult.campaign.id,
          actionId: sharedActionId,
          requestedBy: "operator-impostor"
        })
      ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
    });

    it("rejects assembly when video stem checksum mismatches generation manifest output checksums", async () => {
      const { enforceLicenseRouting, objectStorage } = createTestSetup();

      const genManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(async () => ({
          renderProfile: candidateProfileKey,
          renderProfileVersion: 1,
          route: "ref2v" as const,
          candidateSpecificationDigest: sim243f.specificationDigest,
          outputChecksumsSha256: ["a".repeat(64)] // expected sha256
        }))
      };

      const mockAssembler: MediaAssemblerPort = { assemble: vi.fn() };
      const assembleDeliveryReel = new AssembleDeliveryReel({
        mediaAssembler: mockAssembler,
        objectStorage,
        enforceLicenseRouting,
        generationManifestRepository: genManifestRepo,
        runtimeComponents: [
          { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: "n8.0.1" }
        ]
      });

      const specWithMismatchedStem: AssemblySpec = {
        campaignId: "campaign-checksum-mismatch",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 10125,
        videoStems: [
          {
            sceneId: "scene-1",
            generationManifestId: "gen-ref2v",
            order: 0,
            media: {
              bucket: BUCKETS.REVIEW,
              key: "stem.mp4",
              sha256: "b".repeat(64), // mismatched sha256!
              contentType: "video/mp4"
            },
            expectedDurationMs: 10125
          }
        ],
        subtitleCues: []
      };

      await expect(
        assembleDeliveryReel.assemble({
          spec: specWithMismatchedStem,
          targetBucket: BUCKETS.REVIEW
        })
      ).rejects.toThrow(LicenseRoutingError);

      expect(mockAssembler.assemble).not.toHaveBeenCalled();
    });
  });

  describe("Legacy Five-Second Job and Snapshot Controls", () => {
    it("preserves five-second production workflows for certified MINIMAX_H3_720P_5S_I2V_V1 and REF2V_V1", async () => {
      const { uow, stagingAuthSource, productionReleaseReader, candidateRegistryReader } =
        createTestSetup();

      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource,
        productionReleaseReader,
        registryReader: candidateRegistryReader
      });

      // 5-second production campaign
      const result = await createCampaignShell.execute({
        idempotencyKey: "idem-" + randomUUID(),
        clientId: "client-" + randomUUID(),
        title: "Legacy 5-Second Production Campaign",
        targetTotalDurationMs: 5_000,
        sceneCountOverride: 1,
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        scope: "production",
        principal: "operator-production"
      });

      expect(result.plan).toBeDefined();
      expect(result.plan!.requestedTotalDurationMs).toBe(5_000);
      expect(result.plan!.totalNominalDurationMs).toBe(5_167); // 124 frames / 24 fps = 5,166.67ms -> 5,167ms
      expect(result.plan!.allocations[0]!.frames).toBe(124);
      expect(result.plan!.allocations[0]!.fps).toBe(24);
    });

    it("preserves mixed-route 5-second production workflows for certified MINIMAX_H3_720P_5S_I2V_V1 and REF2V_V1", async () => {
      const { objectStorage, enforceLicenseRouting, storedObjects } = createTestSetup();
      const uow = new InMemorySceneUnitOfWork();

      const i2vStemSha = "1".repeat(64);
      const ref2vStemSha = "2".repeat(64);

      uow.seedVideoStemSource("i2v-job-1", {
        generationManifestId: "gen-i2v-1",
        jobId: "i2v-job-1",
        sceneId: "scene-1",
        renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
        routingMode: "frame_anchored",
        specRevision: 1,
        frames: 124,
        fps: 24,
        outputChecksumsSha256: [i2vStemSha],
        measuredMedia: {
          outputKey: "stems/scene-1.mp4",
          checksumSha256: i2vStemSha,
          container: "ffprobe",
          dimensions: { width: 1280, height: 720 },
          frameCount: 124,
          fps: 24,
          durationMs: 5167,
          formatDurationMs: 5167,
          measurement: "source_bytes"
        },
        media: {
          bucket: BUCKETS.REVIEW,
          key: "stems/scene-1.mp4",
          sha256: i2vStemSha,
          contentType: "video/mp4"
        },
        renderAttempt: 1
      });

      uow.seedVideoStemSource("ref2v-job-2", {
        generationManifestId: "gen-ref2v-2",
        jobId: "ref2v-job-2",
        sceneId: "scene-2",
        renderProfile: "MINIMAX_H3_720P_5S_REF2V_V1",
        routingMode: "reference_directed",
        specRevision: 1,
        frames: 124,
        fps: 24,
        outputChecksumsSha256: [ref2vStemSha],
        measuredMedia: {
          outputKey: "stems/scene-2.mp4",
          checksumSha256: ref2vStemSha,
          container: "ffprobe",
          dimensions: { width: 1280, height: 720 },
          frameCount: 124,
          fps: 24,
          durationMs: 5167,
          formatDurationMs: 5167,
          measurement: "source_bytes"
        },
        media: {
          bucket: BUCKETS.REVIEW,
          key: "stems/scene-2.mp4",
          sha256: ref2vStemSha,
          contentType: "video/mp4"
        },
        renderAttempt: 1
      });

      const mockMixedAssembler: MediaAssemblerPort = {
        assemble: vi.fn(async (spec: AssemblySpec): Promise<AssemblyExecutionResult> => ({
          assemblyId: computeAssemblyId(spec),
          campaignId: spec.campaignId,
          assemblyProfile: spec.assemblyProfile,
          executedInputs: {
            videoStems: spec.videoStems.map((stem) => ({
              sceneId: stem.sceneId,
              generationManifestId: stem.generationManifestId,
              order: stem.order,
              media: stem.media,
              actualDurationMs: stem.expectedDurationMs
            }))
          },
          timeline: { totalDurationMs: 10334, stemDurationsMs: [5167, 5167] },
          layout: { mode: "fit_blurred_fill" },
          subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          ffmpeg: { executable: "/usr/bin/ffmpeg", version: "7.0.2", buildInfo: "7.0.2" },
          commandFingerprint: "0".repeat(64),
          encoding: {
            video: { codec: "libx264", pixelFormat: "yuv420p", crf: 23, preset: "veryfast" }
          },
          streams: {
            video: {
              codecName: "h264",
              pixelFormat: "yuv420p",
              width: 1080,
              height: 1920,
              frameRate: 30,
              durationMs: 10334
            }
          },
          output: {
            media: {
              bucket: BUCKETS.DELIVERY,
              key: "assemblies/mixed-5s.mp4",
              sha256: "9".repeat(64),
              contentType: "video/mp4"
            },
            durationMs: 10334,
            width: 1080,
            height: 1920
          },
          measuredFrameRate: 30,
          executionDurationMs: 2500
        }))
      };

      const assembleDeliveryReel = new AssembleDeliveryReel({
        mediaAssembler: mockMixedAssembler,
        objectStorage,
        enforceLicenseRouting,
        generationManifestRepository: uow.generationManifests,
        runtimeComponents: [
          { componentId: "ffmpeg", componentType: "runtime", versionOrRevision: "n8.0.1" }
        ]
      });

      const mixedSpec: AssemblySpec = {
        campaignId: "campaign-mixed-5s",
        assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
        expectedTotalDurationMs: 10334,
        videoStems: [
          {
            sceneId: "scene-1",
            generationManifestId: "gen-i2v-1",
            order: 0,
            media: {
              bucket: BUCKETS.REVIEW,
              key: "stems/scene-1.mp4",
              sha256: i2vStemSha,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5167
          },
          {
            sceneId: "scene-2",
            generationManifestId: "gen-ref2v-2",
            order: 1,
            media: {
              bucket: BUCKETS.REVIEW,
              key: "stems/scene-2.mp4",
              sha256: ref2vStemSha,
              contentType: "video/mp4"
            },
            expectedDurationMs: 5167
          }
        ],
        subtitleCues: []
      };

      storedObjects.set(`${BUCKETS.DELIVERY}/assemblies/mixed-5s.mp4`, {
        body: Buffer.from("simulated-mixed-5s-reel"),
        checksumSha256: "9".repeat(64)
      });

      const result = await assembleDeliveryReel.assemble({
        spec: mixedSpec,
        targetBucket: BUCKETS.DELIVERY
      });

      expect(result.manifest.assemblyId).toBeDefined();
      expect(result.manifest.generationManifestIds).toEqual(["gen-i2v-1", "gen-ref2v-2"]);
      expect(result.executionResult.output.media.bucket).toBe(BUCKETS.DELIVERY);
    });

    it("successfully deserializes and validates historical 5-second ShotPlan and GenerationManifest documents", () => {
      const historicalShotPlan = {
        id: randomUUID(),
        sceneId: randomUUID(),
        specRevision: 1,
        variantOrdinal: 1,
        routingMode: "frame_anchored" as const,
        framing: "medium" as const,
        angle: "eye_level" as const,
        lensIntent: "50mm prime",
        cameraPosition: "tripod front",
        cameraMovement: "static" as const,
        movementSpeed: "medium" as const,
        cameraPromptDescription: "Static eye-level shot",
        actionSummary: "Subject presents product",
        lightingStyle: "high_key_commercial" as const,
        environmentDescription: "Studio white cyc background",
        targetDurationMs: 5167,
        targetFrameCount: 124,
        status: "approved" as const,
        createdAt: "2026-08-01T12:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z"
      };

      const parsedPlan = ShotPlanDocumentSchema.safeParse(historicalShotPlan);
      expect(parsedPlan.success).toBe(true);

      const historicalManifest = {
        manifestId: randomUUID(),
        jobId: randomUUID(),
        attemptId: randomUUID(),
        promptIdComfy: "prompt-historical-1",
        campaignId: randomUUID(),
        sceneId: randomUUID(),
        renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
        renderProfileVersion: 1,
        routingMode: "frame_anchored" as const,
        firstFrame: {
          anchorType: "first_frame" as const,
          candidateId: randomUUID(),
          contentHashSha256: "0".repeat(64),
          stagedAs: { name: "anchor.png", subfolder: "" },
          injectionTarget: { nodeId: "20", classType: "LoadImage", inputField: "image" }
        },
        renderAttempt: 1,
        renderedAt: "2026-08-01T12:00:00.000Z",
        engine: "minimax_h3_i2v",
        executionScope: "production" as const,
        ownerKind: "production_run" as const,
        realm: { kind: "deployed" as const, deploymentId: "prod-1" },
        evidenceOrigin: "live_execution" as const,
        models: [
          {
            category: "diffusion_models",
            sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
          }
        ],
        workflow: {
          templateId: "minimax-h3-720p-124f-i2v",
          sha256: "0".repeat(64)
        },
        loras: [],
        sampling: {
          seed: 42,
          steps: 20,
          cfg: 1.0,
          sampler: "euler",
          scheduler: "linear",
          denoise: 1.0
        },
        dimensions: { width: 1280, height: 720 },
        frameCount: 124,
        fps: 24,
        prompts: { prompt: "Historical 5s render" },
        environment: {
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
          customNodes: []
        },
        runnerProfile: "dynamicvram-offload-v1",
        runtimeMetadata: {},
        governance: {
          license: "MiniMax Community License",
          sourceKind: "validated_host_export"
        },
        outputs: [
          {
            bucket: "godzspeed-delivery",
            key: "renders/scene-legacy.mp4",
            filename: "scene-legacy.mp4",
            checksumSha256: "0".repeat(64)
          }
        ],
        outputObjectKeys: ["renders/scene-legacy.mp4"],
        executionDurationMs: 45000,
        configuredMedia: {
          outputKey: "renders/scene-legacy.mp4",
          checksumSha256: "0".repeat(64),
          dimensions: { width: 1280, height: 720 },
          frameCount: 124,
          fps: 24,
          source: "render_profile_and_executed_workflow" as const
        },
        measuredMedia: {
          outputKey: "renders/scene-legacy.mp4",
          checksumSha256: "0".repeat(64),
          container: "ffprobe" as const,
          dimensions: { width: 1280, height: 720 },
          frameCount: 124,
          fps: 24,
          durationMs: 5167,
          formatDurationMs: 5167,
          video: {
            codecName: "h264",
            pixelFormat: "yuv420p"
          },
          measurement: "source_bytes" as const
        }
      };

      const parsedManifest = GenerationManifestSchema.safeParse(historicalManifest);
      expect(parsedManifest.success).toBe(true);
    });

    it("public UI / production release reader does not advertise staging-only candidate lengths before #428 release gate", async () => {
      const releaseReader = new JsonFileProductionReleaseReader(
        "config/production-releases.json" // non-existent or empty bundle
      );

      const releasedProfiles = await releaseReader.listReleasedProfiles();
      for (const rel of releasedProfiles) {
        expect(rel.specification.frames).not.toBe(243);
        expect(rel.specification.frames).not.toBe(362);
      }
      expect(await releaseReader.isReleasedProfileKey(candidateProfileKey)).toBe(false);

      // Verify that CreateCampaignShellUseCase rejects staging candidate keys on production campaign shells
      const { uow, stagingAuthSource, candidateRegistryReader } = createTestSetup();
      const createCampaignShell = new CreateCampaignShellUseCase(uow, {
        stagingAuthSource,
        productionReleaseReader: releaseReader,
        registryReader: candidateRegistryReader
      });

      await expect(
        createCampaignShell.execute({
          idempotencyKey: "idem-" + randomUUID(),
          clientId: "client-" + randomUUID(),
          title: "Illegal Production Candidate Campaign",
          targetTotalDurationMs: 20_000,
          sceneCountOverride: 2,
          selectedProfileKey: candidateProfileKey,
          scope: "production",
          principal: "operator-production"
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });
  });
});
