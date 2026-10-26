import { describe, expect, it } from "vitest";
import { Scene, type CampaignId, type CampaignRecord, type SceneId } from "@cco/domain";
import {
  CampaignDurationPlanningError,
  computeH3ReleaseKey,
  type CampaignDurationPlan,
  type DeployedRealm,
  type ExecutionProfileSelection,
  type StagingCandidateProfileSelection
} from "@cco/contracts";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
import { PreviewCampaignReplanUseCase, CommitCampaignReplanUseCase } from "./replan-campaign.js";
import { ReviewSceneUseCases, CampaignReplanRequiredError } from "./review-scene.js";

describe("Campaign duration replan and review guards", () => {
  const deployedRealm: DeployedRealm = {
    kind: "deployed",
    deploymentId: "test-deployment"
  };

  const legacyH3Ref2v: ExecutionProfileSelection = {
    kind: "legacy_production",
    profileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
    version: 1
  };

  function setupCampaignWithScenes(sceneCount: number = 3) {
    const campaignId = "11111111-1111-4111-8111-111111111111" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: "client-1",
      title: "Test Campaign",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: sceneCount,
      approvedScenes: 0,
      targetTotalDurationMs: sceneCount * 5000,
      planRevision: 1,
      currentDurationPlanId: "22222222-2222-4222-8222-222222222222",
      selectedProfileKey: legacyH3Ref2v.profileKey,
      allowedDurationProfileKeys: [legacyH3Ref2v.profileKey],
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
            prompt: `Scene ${i} prompt`,
            durationMs: 5000,
            engineProfileId: legacyH3Ref2v.profileKey
          }
        })
      );
    }

    const plan: CampaignDurationPlan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: sceneCount * 5000,
      selectedProfileSelection: legacyH3Ref2v,
      realm: deployedRealm,
      scope: "production"
    });

    const uow = new InMemorySceneUnitOfWork(scenes, undefined, undefined, [campaign]);
    return { campaignId, campaign, scenes, plan, uow };
  }

  it("ReviewSceneUseCases prevents direct duration and engine changes on planned scenes", async () => {
    const { scenes, plan, uow } = setupCampaignWithScenes(3);

    // Save initial plan in durationPlans repository
    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const reviewScene = new ReviewSceneUseCases(uow);
    const targetScene = scenes[0]!;

    // 1. Direct duration change MUST throw CampaignReplanRequiredError (409)
    await expect(
      reviewScene.updateDuration({
        sceneId: targetScene.id,
        eventId: "event-dur-change",
        reviewerName: "director",
        occurredAt: new Date().toISOString(),
        durationMs: 10000
      })
    ).rejects.toThrow(CampaignReplanRequiredError);

    // 2. Direct engine change MUST throw CampaignReplanRequiredError (409)
    await expect(
      reviewScene.updateEngine({
        sceneId: targetScene.id,
        eventId: "event-engine-change",
        reviewerName: "director",
        occurredAt: new Date().toISOString(),
        engineProfileId: "LTX_25_720P_5S_I2V_V1"
      })
    ).rejects.toThrow(CampaignReplanRequiredError);

    // Verify scene duration and engine were NOT modified
    await uow.execute(async (context) => {
      const scene = await context.scenes.findById(targetScene.id);
      expect(scene?.configuration.durationMs).toBe(5000);
      expect(scene?.configuration.engineProfileId).toBe(legacyH3Ref2v.profileKey);
    });
  });

  it("PreviewCampaignReplanUseCase previews a valid duration change", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(3);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const previewUseCase = new PreviewCampaignReplanUseCase({ uow });

    const previewResult = await previewUseCase.execute({
      campaignId,
      sceneIdDurations: {
        [scenes[0]!.id]: 5000,
        [scenes[1]!.id]: 5000,
        [scenes[2]!.id]: 5000
      }
    });

    expect(previewResult.feasible).toBe(true);
    expect(previewResult.currentPlanRevision).toBe(1);
    expect(previewResult.proposedPlan).toBeDefined();
    expect(previewResult.proposedPlan?.revision).toBe(2);
    expect(previewResult.proposedPlan?.predecessorPlanId).toBe(plan.planId);
  });

  it("CommitCampaignReplanUseCase commits new durations and bumps plan revision", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const commitUseCase = new CommitCampaignReplanUseCase({ uow });

    const commitResult = await commitUseCase.execute({
      campaignId,
      actionId: "replan-act-1",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 5000,
        [scenes[1]!.id]: 5000
      }
    });

    expect(commitResult.newPlanRevision).toBe(2);
    expect(commitResult.plan.revision).toBe(2);
    expect(commitResult.plan.predecessorPlanId).toBe(plan.planId);
    expect(commitResult.bindings).toHaveLength(2);

    // Verify stored state
    await uow.execute(async (context) => {
      const currentPlan = await context.durationPlans!.findCurrentPlanByCampaignId(campaignId);
      expect(currentPlan?.revision).toBe(2);
      expect(currentPlan?.planId).toBe(commitResult.plan.planId);

      const bindings = await context.durationPlans!.findBindingsByPlanId(currentPlan!.planId);
      expect(bindings).toHaveLength(2);
    });
  });

  it("CommitCampaignReplanUseCase rejects stale plan revision with 409 stale_plan", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const commitUseCase = new CommitCampaignReplanUseCase({ uow });

    // Expecting revision 99 when current is 1
    await expect(
      commitUseCase.execute({
        campaignId,
        actionId: "replan-act-stale",
        expectedPlanRevision: 99,
        expectedSceneSpecRevisions: {
          [scenes[0]!.id]: 1,
          [scenes[1]!.id]: 1
        },
        sceneIdDurations: {
          [scenes[0]!.id]: 5000,
          [scenes[1]!.id]: 5000
        }
      })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  it("CommitCampaignReplanUseCase replays cached response on identical actionId", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const commitUseCase = new CommitCampaignReplanUseCase({ uow });

    const first = await commitUseCase.execute({
      campaignId,
      actionId: "replan-act-replay",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 5000,
        [scenes[1]!.id]: 5000
      }
    });

    // Replay with identical actionId
    const second = await commitUseCase.execute({
      campaignId,
      actionId: "replan-act-replay",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 5000,
        [scenes[1]!.id]: 5000
      }
    });

    expect(second).toEqual(first);
  });

  it("CommitCampaignReplanUseCase rejects changed intent on identical actionId", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const commitUseCase = new CommitCampaignReplanUseCase({ uow });

    await commitUseCase.execute({
      campaignId,
      actionId: "replan-act-changed-intent",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 5000,
        [scenes[1]!.id]: 5000
      }
    });

    // Replay with identical actionId but different duration payload (changed intent)
    await expect(
      commitUseCase.execute({
        campaignId,
        actionId: "replan-act-changed-intent",
        expectedPlanRevision: 1,
        expectedSceneSpecRevisions: {
          [scenes[0]!.id]: 1,
          [scenes[1]!.id]: 1
        },
        sceneIdDurations: {
          [scenes[0]!.id]: 4000,
          [scenes[1]!.id]: 6000
        }
      })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  it("CommitCampaignReplanUseCase rejects partial duration vectors and duration alterations", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
    });

    const commitUseCase = new CommitCampaignReplanUseCase({ uow });

    // Partial vector: missing scene[1]
    await expect(
      commitUseCase.execute({
        campaignId,
        actionId: "replan-act-partial",
        expectedPlanRevision: 1,
        expectedSceneSpecRevisions: {
          [scenes[0]!.id]: 1
        },
        sceneIdDurations: {
          [scenes[0]!.id]: 5000
        }
      })
    ).rejects.toThrow(CampaignDurationPlanningError);

    // Sum mismatch: 5000 + 4000 = 9000ms != 10000ms target
    await expect(
      commitUseCase.execute({
        campaignId,
        actionId: "replan-act-mismatch",
        expectedPlanRevision: 1,
        expectedSceneSpecRevisions: {
          [scenes[0]!.id]: 1,
          [scenes[1]!.id]: 1
        },
        sceneIdDurations: {
          [scenes[0]!.id]: 5000,
          [scenes[1]!.id]: 4000
        }
      })
    ).rejects.toThrow(CampaignDurationPlanningError);
  });

  it("CommitCampaignReplanUseCase invalidates scene approvals and resets approvedScenes", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    // Set first scene to approved and campaign approvedScenes = 1
    await uow.execute(async (context) => {
      await context.durationPlans!.savePlan(plan);
      const s0 = await context.scenes.findById(scenes[0]!.id);
      const approvedScene = Scene.reconstitute({
        ...s0!.snapshot(),
        status: "approved",
        approval: {
          revision: 1,
          approvedBy: "director",
          approvedAt: new Date().toISOString()
        }
      });
      await context.scenes.save(approvedScene);
      const camp = await context.campaigns!.findById(campaignId);
      await context.campaigns!.save({
        ...camp!,
        approvedScenes: 1
      });
    });

    const commitUseCase = new CommitCampaignReplanUseCase({ uow });

    await commitUseCase.execute({
      campaignId,
      actionId: "replan-act-invalidate",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 5000,
        [scenes[1]!.id]: 5000
      }
    });

    await uow.execute(async (context) => {
      const camp = await context.campaigns!.findById(campaignId);
      expect(camp?.approvedScenes).toBe(0);
      const s0 = await context.scenes.findById(scenes[0]!.id);
      expect(s0?.status).not.toBe("approved");
    });
  });

  it("PreviewCampaignReplanUseCase and CommitCampaignReplanUseCase succeed for 243f candidate profile with stagingAuthSource", async () => {
    const candidateKey = "H3_CANDIDATE_da62255eb7245c2cc0ac588325ccd3d3_V1";
    const stagingCandidateSelection: StagingCandidateProfileSelection = {
      kind: "staging_candidate",
      profileKey: candidateKey,
      specificationDigest: "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7",
      targetId: "llama",
      authorizationId: "auth-243f"
    };

    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
      listAuthorizedCandidates: async () => [stagingCandidateSelection],
      resolveCandidateGrant: async () => undefined
    };

    const mockRegistryReader = {
      getCandidateProfile: () => undefined,
      listCandidateProfiles: () => [],
      isCandidateProfileKey: () => true,
      resolveH3ProfileFrameCapabilities: (key: string | undefined) =>
        key === candidateKey
          ? {
              profileKey: key,
              route: "ref2v" as const,
              routingMode: "reference_directed" as const,
              width: 1344,
              height: 768,
              fps: 24,
              allowedFrameCounts: [243],
              isAllowedFrameCount: (f: number) => f === 243
            }
          : undefined,
      isFrameCountAllowedForH3Profile: () => true
    };

    const { campaignId, scenes, uow } = setupCampaignWithScenes(2);
    const stagingPlan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: 20000,
      selectedProfileSelection: stagingCandidateSelection,
      realm: {
        kind: "isolated_test",
        testRealmId: "realm-1",
        isolationDescriptorDigest: "a".repeat(64)
      },
      scope: "staging",
      capabilities: new Map([
        [candidateKey, mockRegistryReader.resolveH3ProfileFrameCapabilities(candidateKey)!]
      ])
    });

    await uow.execute(async (context) => {
      const camp = await context.campaigns!.findById(campaignId);
      await context.campaigns!.save({
        ...camp!,
        targetTotalDurationMs: 20000
      });
      await context.durationPlans!.savePlan(stagingPlan);
    });

    const previewUseCase = new PreviewCampaignReplanUseCase({
      uow,
      stagingAuthSource: mockStagingAuthSource,
      registryReader: mockRegistryReader
    });

    const previewResult = await previewUseCase.execute({
      campaignId,
      sceneIdDurations: {
        [scenes[0]!.id]: 10000,
        [scenes[1]!.id]: 10000
      },
      selectedProfileKey: candidateKey
    });

    expect(previewResult.feasible).toBe(true);
    expect(previewResult.proposedPlan?.allocations[0]?.frames).toBe(243);

    const commitUseCase = new CommitCampaignReplanUseCase({
      uow,
      stagingAuthSource: mockStagingAuthSource,
      registryReader: mockRegistryReader
    });

    const commitResult = await commitUseCase.execute({
      campaignId,
      actionId: "replan-staging-243f",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 10000,
        [scenes[1]!.id]: 10000
      },
      selectedProfileKey: candidateKey
    });

    expect(commitResult.newPlanRevision).toBe(2);
    expect(commitResult.plan.allocations[0]?.frames).toBe(243);
  });

  it("PreviewCampaignReplanUseCase rejects single scene exceeding 15000ms max scene ceiling", async () => {
    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);

    await uow.execute(async (context) => {
      const camp = await context.campaigns!.findById(campaignId);
      await context.campaigns!.save({
        ...camp!,
        targetTotalDurationMs: 20000
      });
      await context.durationPlans!.savePlan(plan);
    });

    const previewUseCase = new PreviewCampaignReplanUseCase({ uow });

    const previewResult = await previewUseCase.execute({
      campaignId,
      sceneIdDurations: {
        [scenes[0]!.id]: 16000,
        [scenes[1]!.id]: 4000
      }
    });

    expect(previewResult.feasible).toBe(false);
    expect(previewResult.error).toContain("exceeds maximum permissible scene duration 15000ms");
  });

  it("PreviewCampaignReplanUseCase and CommitCampaignReplanUseCase succeed for test-authorized released_production profile in production scope", async () => {
    const releaseDigest = "b".repeat(64);
    const releaseKey = computeH3ReleaseKey(releaseDigest, 1);
    const spec = {
      version: 1 as const,
      route: "ref2v" as const,
      routingMode: "reference_directed" as const,
      workflowHash: "c".repeat(64),
      frames: 243,
      fps: 24 as const,
      width: 1344,
      height: 768,
      sampler: "res_multistep",
      scheduler: "simple",
      steps: 4,
      cfg: 1,
      denoise: 1,
      modelHashes: {
        checkpoint: "1".repeat(64),
        clip: "2".repeat(64),
        audioVae: "3".repeat(64),
        videoVae: "4".repeat(64),
        turboLora: "5".repeat(64),
        additionalModels: {}
      },
      attention: {
        backend: "comfy_native" as const,
        customNodeRevision: "none",
        customNodeSourceHash: "none",
        packageVersion: "none",
        sparsitySettings: {
          enabled: false as const,
          method: "none" as const,
          threshold: 0 as const
        }
      },
      customNodes: [],
      packageVersions: {
        torch: "2.13.0+cu130",
        comfyui: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      runnerSettings: {
        runnerProfile: "dynamicvram-offload-v1",
        offloadPolicy: "dynamicvram" as const,
        requiresModelOffloading: true,
        maxConcurrentGpuJobs: 1,
        minFreeDiskGb: 20
      },
      expectedCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      expectedPythonExecutable: "/bin/python3"
    };

    const releasedProfile = {
      key: releaseKey,
      version: 1 as const,
      specificationDigest: releaseDigest,
      specification: spec,
      topology: {
        prompt: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "prompt" },
        seed: { nodeId: "2", classType: "RandomNoise", inputField: "noise_seed" },
        frameCount: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "length" },
        referenceImage: { nodeId: "3", classType: "LoadImage", inputField: "image" },
        firstFrame: { nodeId: "3", classType: "LoadImage", inputField: "image" },
        width: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "width" },
        height: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "height" }
      },
      releaseId: "rel-1",
      signedReleaseDigest: "d".repeat(64),
      certificationRecordDigest: "e".repeat(64),
      deploymentEnablementDigest: "f".repeat(64),
      speedDecision: {
        specificationDigest: releaseDigest,
        specification: spec,
        speedVerdict: "pass" as const,
        qualityVerdict: "pass" as const,
        overallVerdict: "pass" as const,
        evidenceDigests: [],
        operatorIdentity: "operator",
        decidedAt: new Date().toISOString()
      },
      certificationVerdict: "released" as const,
      operatorIdentity: "operator",
      releasedAt: new Date().toISOString()
    };

    const mockProductionReleaseReader = {
      listReleasedProfiles: async () => [releasedProfile],
      getReleasedProfile: async (key: string) => (key === releaseKey ? releasedProfile : undefined),
      isReleasedProfileKey: async (key: string) => key === releaseKey,
      getDeploymentEnablementState: async () => undefined
    };

    const { campaignId, scenes, uow } = setupCampaignWithScenes(2);
    const prodPlan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: 20000,
      selectedProfileSelection: {
        kind: "released_production",
        profileKey: releaseKey,
        specificationDigest: releaseDigest,
        releaseId: "rel-1",
        signedReleaseDigest: "d".repeat(64),
        certificationRecordDigest: "e".repeat(64),
        deploymentEnablementDigest: "f".repeat(64)
      },
      realm: { kind: "deployed", deploymentId: "prod-deploy-1" },
      scope: "production",
      capabilities: new Map([
        [
          releaseKey,
          {
            profileKey: releaseKey,
            route: "ref2v" as const,
            routingMode: "reference_directed" as const,
            width: 1344,
            height: 768,
            fps: 24,
            allowedFrameCounts: [243],
            isAllowedFrameCount: (f: number) => f === 243
          }
        ]
      ])
    });

    await uow.execute(async (context) => {
      const camp = await context.campaigns!.findById(campaignId);
      await context.campaigns!.save({
        ...camp!,
        targetTotalDurationMs: 20000
      });
      await context.durationPlans!.savePlan(prodPlan);
    });

    const previewUseCase = new PreviewCampaignReplanUseCase({
      uow,
      productionReleaseReader: mockProductionReleaseReader
    });

    const previewResult = await previewUseCase.execute({
      campaignId,
      sceneIdDurations: {
        [scenes[0]!.id]: 10000,
        [scenes[1]!.id]: 10000
      },
      selectedProfileKey: releaseKey
    });

    expect(previewResult.feasible).toBe(true);
    expect(previewResult.proposedPlan?.allocations[0]?.frames).toBe(243);

    const commitUseCase = new CommitCampaignReplanUseCase({
      uow,
      productionReleaseReader: mockProductionReleaseReader
    });

    const commitResult = await commitUseCase.execute({
      campaignId,
      actionId: "replan-prod-released-243f",
      expectedPlanRevision: 1,
      expectedSceneSpecRevisions: {
        [scenes[0]!.id]: 1,
        [scenes[1]!.id]: 1
      },
      sceneIdDurations: {
        [scenes[0]!.id]: 10000,
        [scenes[1]!.id]: 10000
      },
      selectedProfileKey: releaseKey
    });

    expect(commitResult.newPlanRevision).toBe(2);
    expect(commitResult.plan.allocations[0]?.frames).toBe(243);
    expect(commitResult.plan.scope).toBe("production");
  });
});
