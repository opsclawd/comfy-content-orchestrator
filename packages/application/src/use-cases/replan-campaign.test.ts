import { describe, expect, it } from "vitest";
import { Scene, type CampaignId, type CampaignRecord, type SceneId } from "@cco/domain";
import {
  CampaignDurationPlanningError,
  type CampaignDurationPlan,
  type DeployedRealm,
  type ExecutionProfileSelection
} from "@cco/contracts";
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
});
