import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  Scene,
  type CampaignId,
  type CampaignProductionRunRecord,
  type CampaignRecord,
  type SceneId
} from "@cco/domain";
import {
  type CampaignDurationPlan,
  type DeployedRealm,
  type ExecutionProfileSelection,
  type IsolatedTestRealm,
  type H3CandidateAuthorizationGrant,
  type H3CandidateProfileKey,
  type StagingCandidateProfileSelection,
  CampaignDurationPlanningError
} from "@cco/contracts";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { createIsolatedSimulationRealmContext } from "../test-support/isolated-simulation-realm-context.js";
import { createDeployedLiveRealmContext } from "../ports/realm-admission-context.js";
import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
import {
  BeginOperatorAcceptanceRunUseCase,
  AcceptOperatorAcceptanceSceneUseCase,
  AssembleOperatorAcceptanceRunUseCase
} from "./operator-acceptance-run.js";
import {
  attemptEnqueueAssemblyForAcceptedRun,
  StagingRenderIneligibleForAssemblyError
} from "./enqueue-delivery-assembly-for-accepted-run.js";

describe("Operator Acceptance Run lifecycle and execution isolation", () => {
  const deployedRealm: DeployedRealm = {
    kind: "deployed",
    deploymentId: "test-deployment"
  };

  const isolatedTestRealm: IsolatedTestRealm = {
    kind: "isolated_test",
    testRealmId: "test-realm-426",
    isolationDescriptorDigest: "a".repeat(64)
  };

  const stagingCandidateRef2v: ExecutionProfileSelection = {
    kind: "staging_candidate",
    profileKey: `H3_CANDIDATE_${"b".repeat(32)}_V1`,
    specificationDigest: "b".repeat(64),
    targetId: "target-gpu-1",
    authorizationId: "auth-1"
  };

  const legacyProductionH3: ExecutionProfileSelection = {
    kind: "legacy_production",
    profileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
    version: 1
  };

  const candidateCapability = {
    profileKey: stagingCandidateRef2v.profileKey,
    frames: 124,
    allowedFrameCounts: [124],
    isAllowedFrameCount: (f: number) => f === 124,
    fps: 24,
    width: 1280,
    height: 720,
    toleranceMs: 355,
    preferredDurationMs: 5000,
    route: "ref2v" as const,
    routingMode: "reference_directed" as const
  };

  function setupStagingCampaign(sceneCount: number = 2) {
    const campaignId = "33333333-3333-4333-8333-333333333333" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: "client-1",
      title: "Staging Test Campaign",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: sceneCount,
      approvedScenes: 0,
      targetTotalDurationMs: sceneCount * 5000,
      planRevision: 1,
      currentDurationPlanId: "44444444-4444-4444-8444-444444444444",
      selectedProfileKey: stagingCandidateRef2v.profileKey,
      allowedDurationProfileKeys: [stagingCandidateRef2v.profileKey],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const scenes: Scene[] = [];
    for (let i = 1; i <= sceneCount; i++) {
      const sceneId = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as SceneId;
      scenes.push(
        Scene.create({
          id: sceneId,
          campaignId,
          sequenceIndex: i,
          configuration: {
            prompt: `Scene ${i} staging prompt`,
            durationMs: 5000,
            engineProfileId: stagingCandidateRef2v.profileKey
          }
        })
      );
    }

    const stagingPlan: CampaignDurationPlan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: sceneCount * 5000,
      selectedProfileSelection: stagingCandidateRef2v,
      realm: isolatedTestRealm,
      scope: "staging",
      capabilities: new Map([[stagingCandidateRef2v.profileKey, candidateCapability]])
    });

    const uow = new InMemorySceneUnitOfWork(scenes, undefined, undefined, [campaign]);
    return { campaignId, campaign, scenes, stagingPlan, uow };
  }

  it("BeginOperatorAcceptanceRunUseCase rejects production-scoped plans", async () => {
    const campaignId = "55555555-5555-4555-8555-555555555555" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: "client-1",
      title: "Prod Campaign",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const scene = Scene.create({
      id: "00000000-0000-4000-8000-000000000001" as SceneId,
      campaignId,
      sequenceIndex: 1,
      configuration: {
        prompt: "Prompt",
        durationMs: 5000,
        engineProfileId: legacyProductionH3.profileKey
      }
    });

    const prodPlan: CampaignDurationPlan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: 5000,
      selectedProfileSelection: legacyProductionH3,
      realm: deployedRealm,
      scope: "production"
    });

    const uow = new InMemorySceneUnitOfWork([scene], undefined, undefined, [campaign]);
    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(prodPlan);
    });

    const beginUseCase = new BeginOperatorAcceptanceRunUseCase({ uow });

    await expect(
      beginUseCase.execute({
        campaignId,
        actionId: "act-begin-prod",
        requestedBy: "operator"
      })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  it("Executes the full operator acceptance lifecycle: begin -> accept scenes -> assemble", async () => {
    const { campaignId, scenes, stagingPlan, uow } = setupStagingCampaign(2);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(stagingPlan);
    });

    const mockGrant: H3CandidateAuthorizationGrant = {
      payload: {
        version: 1,
        candidateKey: stagingCandidateRef2v.profileKey as H3CandidateProfileKey,
        specificationDigest: "b".repeat(64),
        goldMasterWorkflowHash: "c".repeat(64),
        goldMasterModelHashesDigest: "d".repeat(64),
        targetHostname: "staging-host",
        targetGpuUuid: "target-gpu-1",
        purpose: "staging",
        scope: "staging",
        issuedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        operatorId: "operator-1"
      },
      signature: "0123456789abcdef".repeat(4),
      signerKeyId: "auth-1"
    };

    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
      listAuthorizedCandidates: async () => [
        stagingCandidateRef2v as StagingCandidateProfileSelection
      ],
      resolveCandidateGrant: async () => mockGrant
    };

    const mockStageRenderUseCase = {
      executeWithContext: async (_context: unknown, _input: unknown) => {
        const jobId = randomUUID();
        uow.seedVideoStemSource(jobId, {
          generationManifestId: randomUUID(),
          renderAttempt: 1,
          executionScope: "staging",
          ownerKind: "staging_acceptance",
          realm: isolatedTestRealm,
          evidenceOrigin: "simulated_test",
          measuredMedia: {
            outputKey: "videos/stem-1.mp4",
            checksumSha256: "0".repeat(64),
            container: "ffprobe",
            dimensions: { width: 720, height: 1280 },
            frameCount: 124,
            fps: 24,
            durationMs: 5167,
            formatDurationMs: 5167,
            measurement: "source_bytes"
          },
          media: {
            bucket: "staging-bucket",
            key: "videos/stem-1.mp4",
            sha256: "0".repeat(64),
            contentType: "video/mp4"
          }
        });
        return {
          job: { jobId },
          attemptId: randomUUID()
        };
      }
    } as unknown as StageH3CandidateRenderUseCase;

    const beginUseCase = new BeginOperatorAcceptanceRunUseCase({
      uow,
      stagingAuthSource: mockStagingAuthSource,
      stageRenderUseCase: mockStageRenderUseCase
    });
    const acceptUseCase = new AcceptOperatorAcceptanceSceneUseCase({ uow });
    const assembleUseCase = new AssembleOperatorAcceptanceRunUseCase({ uow });

    // 1. Begin acceptance run
    const beginRes = await beginUseCase.execute({
      campaignId,
      actionId: "act-begin-staging",
      requestedBy: "operator"
    });

    expect(beginRes.status).toBe("dispatched");
    expect(beginRes.sceneCount).toBe(2);
    expect(beginRes.dispatchedJobIds).toHaveLength(2);

    // 2. Attempt assemble before accepting scenes -> must fail
    await expect(
      assembleUseCase.execute({
        acceptanceRunId: beginRes.acceptanceRunId,
        actionId: "act-assemble-early",
        requestedBy: "operator"
      })
    ).rejects.toThrow(/has not been accepted/i);

    // 3. Accept scene 1
    const accept1 = await acceptUseCase.execute({
      acceptanceRunId: beginRes.acceptanceRunId,
      sceneId: scenes[0]!.id,
      actionId: "act-accept-scene-1",
      expectedAttemptOrdinal: 1,
      acceptedBy: "operator"
    });
    expect(accept1.accepted).toBe(true);

    // Still cannot assemble (scene 2 not accepted)
    await expect(
      assembleUseCase.execute({
        acceptanceRunId: beginRes.acceptanceRunId,
        actionId: "act-assemble-half",
        requestedBy: "operator"
      })
    ).rejects.toThrow(/has not been accepted/i);

    // 4. Accept scene 2
    const accept2 = await acceptUseCase.execute({
      acceptanceRunId: beginRes.acceptanceRunId,
      sceneId: scenes[1]!.id,
      actionId: "act-accept-scene-2",
      expectedAttemptOrdinal: 1,
      acceptedBy: "operator"
    });
    expect(accept2.accepted).toBe(true);

    // 5. Assemble acceptance run -> succeeds and enqueues AcceptanceAssemblyJob
    const assembleRes = await assembleUseCase.execute({
      acceptanceRunId: beginRes.acceptanceRunId,
      actionId: "act-assemble-final",
      requestedBy: "operator"
    });

    expect(assembleRes.status).toBe("assembling");
    expect(assembleRes.assemblyJobId).toBeDefined();

    // Verify stored acceptance run state
    await uow.execute(async (context) => {
      const run = await context.operatorAcceptanceRuns!.findRunById(beginRes.acceptanceRunId);
      expect(run?.status).toBe("assembling");
      expect(run?.assemblyJobId).toBe(assembleRes.assemblyJobId);

      const job = await context.acceptanceAssemblyJobs!.findById(assembleRes.assemblyJobId);
      expect(job).toBeDefined();
      expect(job?.status).toBe("queued");
      expect(job?.assemblySpec.videoStems).toHaveLength(2);
    });
  });

  it("Ordinary delivery assembly rejects stems originating from staging_acceptance or staging executionScope", async () => {
    const { campaignId, scenes, uow } = setupStagingCampaign(1);
    const scene = scenes[0]!;

    const runId = "run-prod-isolation-test";
    const acceptedJobId = "job-staging-accepted";
    const acceptedAttemptId = "attempt-staging-accepted";

    // Setup a mock production run and attempts
    await uow.execute(async (context) => {
      await context.campaignProductionRuns!.createIfAbsent({
        campaignId,
        fingerprint: "fp-test",
        status: "dispatched",
        expectedTotalDurationMs: 5000
      });

      await context.campaignProductionRuns!.insertRunScenes(runId, [
        {
          runId,
          sceneId: scene.id,
          specRevision: scene.specRevision,
          sequenceIndex: 1,
          expectedDurationMs: 5000,
          currentAttemptOrdinal: 1,
          acceptedAttemptId,
          acceptedProductionJobId: acceptedJobId,
          acceptedAttemptOrdinal: 1
        }
      ]);

      await context.campaignProductionRuns!.recordProductionAttempt({
        attemptId: acceptedAttemptId,
        sceneId: scene.id,
        runId,
        ordinal: 1,
        productionJobId: acceptedJobId,
        specRevision: scene.specRevision,
        seed: 12345,
        createdReason: "initial_dispatch",
        ownerKind: "staging_acceptance"
      });

      uow.seedVideoStemSource(acceptedJobId, {
        generationManifestId: "manifest-1",
        renderAttempt: 1,
        executionScope: "staging",
        ownerKind: "staging_acceptance",
        media: {
          bucket: "staging-bucket",
          key: "stems/scene-1.mp4",
          sha256: "0".repeat(64),
          contentType: "video/mp4"
        }
      });
    });

    const runRecord = {
      id: runId,
      campaignId,
      fingerprint: "fp-test",
      status: "dispatched" as const,
      expectedTotalDurationMs: 5000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Ordinary delivery assembly MUST reject staging stems with StagingRenderIneligibleForAssemblyError
    await uow.execute(async (context) => {
      await expect(attemptEnqueueAssemblyForAcceptedRun(context, runRecord)).rejects.toThrow(
        StagingRenderIneligibleForAssemblyError
      );
    });
  });

  it("Isolated simulation realm admits simulated_test evidence and enqueues assembly", async () => {
    const campaignId = "66666666-6666-4666-8666-666666666666" as CampaignId;
    const sceneId = "00000000-0000-4000-8000-000000000001" as SceneId;
    const scene = Scene.create({
      id: sceneId,
      campaignId,
      sequenceIndex: 1,
      configuration: {
        prompt: "Simulation scene",
        durationMs: 5000,
        engineProfileId: legacyProductionH3.profileKey
      }
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    const acceptedJobId = "job-sim-accepted";
    const acceptedAttemptId = "attempt-sim-accepted";

    let runRecord!: CampaignProductionRunRecord;

    await uow.execute(async (context) => {
      const created = await context.campaignProductionRuns!.createIfAbsent({
        campaignId,
        fingerprint: "fp-sim",
        status: "dispatched",
        expectedTotalDurationMs: 5000
      });
      runRecord = created.run;
      const runId = runRecord.id;

      await context.campaignProductionRuns!.insertRunScenes(runId, [
        {
          runId,
          sceneId: scene.id,
          specRevision: scene.specRevision,
          sequenceIndex: 1,
          expectedDurationMs: 5000,
          currentAttemptOrdinal: 1,
          acceptedAttemptId,
          acceptedProductionJobId: acceptedJobId,
          acceptedAttemptOrdinal: 1
        }
      ]);

      await context.campaignProductionRuns!.recordProductionAttempt({
        attemptId: acceptedAttemptId,
        sceneId: scene.id,
        runId,
        ordinal: 1,
        productionJobId: acceptedJobId,
        specRevision: scene.specRevision,
        seed: 12345,
        createdReason: "initial_dispatch",
        ownerKind: "production_run"
      });

      uow.seedVideoStemSource(acceptedJobId, {
        generationManifestId: "manifest-sim-1",
        renderAttempt: 1,
        executionScope: "production",
        ownerKind: "production_run",
        realm: isolatedTestRealm,
        evidenceOrigin: "simulated_test",
        media: {
          bucket: "test-bucket",
          key: "stems/sim-scene-1.mp4",
          sha256: "0".repeat(64),
          contentType: "video/mp4"
        }
      });
    });

    const simulationContext = createIsolatedSimulationRealmContext({
      testRealmId: isolatedTestRealm.testRealmId,
      isolationDescriptorDigest: isolatedTestRealm.isolationDescriptorDigest
    });

    const deployedContext = createDeployedLiveRealmContext("deployment-live");

    // 1. In deployed live context: simulated_test MUST be rejected (origin_not_admissible)
    await uow.execute(async (context) => {
      await expect(
        attemptEnqueueAssemblyForAcceptedRun(context, runRecord, {
          realmAdmissionContext: deployedContext
        })
      ).rejects.toThrow(CampaignDurationPlanningError);
    });

    // 2. In isolated simulation context matching the realm: simulated_test is admitted and enqueues!
    await uow.execute(async (context) => {
      const res = await attemptEnqueueAssemblyForAcceptedRun(context, runRecord, {
        realmAdmissionContext: simulationContext
      });
      expect(res.enqueued).toBe(true);
      expect(res.assemblyJobId).toBeDefined();
    });
  });
});
