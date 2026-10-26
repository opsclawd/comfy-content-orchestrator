import { describe, expect, it } from "vitest";
import type {
  CampaignDurationPlanRepository,
  CampaignRepository,
  StoryboardCandidateRepository,
  OperatorAcceptanceRunRepository,
  ReviewEventStore,
  SceneRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import type { CampaignRecord } from "@cco/domain";
import { planFeasibleCampaignDuration } from "@cco/application";
import type { CampaignDurationPlan } from "@cco/contracts";
import { createControlApiApp } from "../app.js";

const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
const scene1Id = "01950c46-9e90-7d3d-82d2-8f1d3c000011";
const scene2Id = "01950c46-9e90-7d3d-82d2-8f1d3c000012";
const scene3Id = "01950c46-9e90-7d3d-82d2-8f1d3c000013";

const samplePlan = planFeasibleCampaignDuration({
  campaignId,
  targetTotalDurationMs: 15_000,
  selectedProfileSelection: {
    kind: "legacy_production",
    profileKey: "MINIMAX_H3_720P_5S_I2V_V1",
    version: 1
  },
  allowedProfileSelections: [
    {
      kind: "legacy_production",
      profileKey: "MINIMAX_H3_720P_5S_I2V_V1",
      version: 1
    }
  ],
  realm: {
    kind: "isolated_test",
    testRealmId: "test-realm-1",
    isolationDescriptorDigest: "0".repeat(64)
  },
  scope: "production"
});

class FakeUnitOfWork implements UnitOfWork {
  private plans: Map<string, CampaignDurationPlan> = new Map();
  private campaigns: Map<string, CampaignRecord> = new Map();

  constructor(options?: { plans?: CampaignDurationPlan[]; campaigns?: CampaignRecord[] }) {
    if (options?.plans) {
      for (const p of options.plans) {
        this.plans.set(p.campaignId, p);
      }
    }
    if (options?.campaigns) {
      for (const c of options.campaigns) {
        this.campaigns.set(c.id, c);
      }
    } else {
      this.campaigns.set(campaignId, {
        id: campaignId,
        name: "Test Campaign",
        targetDurationMs: 15_000,
        targetTotalDurationMs: 15_000,
        sceneCount: 3,
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
        allowedDurationProfileKeys: ["MINIMAX_H3_720P_5S_I2V_V1"],
        planRevision: 1,
        currentDurationPlanId: samplePlan.planId,
        status: "draft",
        planningStatus: "idle",
        brief: "test brief",
        createdAt: "2026-10-24T12:00:00.000Z",
        updatedAt: "2026-10-24T12:00:00.000Z"
      } as unknown as CampaignRecord);
    }
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const durationPlanRepo: CampaignDurationPlanRepository = {
      savePlan: async (plan) => {
        this.plans.set(plan.campaignId, plan);
      },
      findCurrentPlanByCampaignId: async (cId: string) => {
        return this.plans.get(cId);
      },
      findByCampaignIdAndRevision: async (cId: string, rev: number) => {
        const p = this.plans.get(cId);
        return p?.revision === rev ? p : undefined;
      },
      findBindingsByPlanId: async () => [],
      findBindingBySceneId: async () => undefined,
      saveBindings: async () => {}
    };

    const campaignRepo = {
      create: async () => {},
      findById: async (id: string) => this.campaigns.get(id),
      findByName: async () => undefined,
      list: async () => Array.from(this.campaigns.values()),
      save: async () => {},
      updateStatus: async () => {},
      updatePlanningStatus: async () => {},
      updateDurationPlan: async (cId: string, planId: string, revision: number) => {
        const c = this.campaigns.get(cId);
        if (c) {
          const mutableCampaign = c as unknown as {
            currentDurationPlanId: string;
            planRevision: number;
          };
          mutableCampaign.currentDurationPlanId = planId;
          mutableCampaign.planRevision = revision;
        }
      }
    };

    const sceneList = [
      {
        id: scene1Id,
        campaignId,
        sequenceIndex: 0,
        specRevision: 1,
        configuration: { durationMs: 5_000, engine: "minimax_h3_i2v" },
        updateEngine: () => {},
        updateDuration: () => {}
      },
      {
        id: scene2Id,
        campaignId,
        sequenceIndex: 1,
        specRevision: 1,
        configuration: { durationMs: 5_000, engine: "minimax_h3_i2v" },
        updateEngine: () => {},
        updateDuration: () => {}
      },
      {
        id: scene3Id,
        campaignId,
        sequenceIndex: 2,
        specRevision: 1,
        configuration: { durationMs: 5_000, engine: "minimax_h3_i2v" },
        updateEngine: () => {},
        updateDuration: () => {}
      }
    ];

    const sceneRepo = {
      findById: async (id: string) => sceneList.find((s) => s.id === id),
      findByCampaignAndSequence: async () => undefined,
      findByCampaignId: async () => sceneList,
      listByCampaignId: async () => sceneList,
      save: async () => {},
      create: async () => {}
    };

    const acceptanceRuns: OperatorAcceptanceRunRepository = {
      createRun: async () => {},
      findRunById: async () => undefined,
      findRunByCampaignId: async () => undefined,
      findRunScenes: async () => [],
      findRunSceneBySceneId: async () => undefined,
      updateRunStatus: async () => {},
      updateSceneAcceptedAttempt: async () => {},
      updateSceneCurrentAttempt: async () => {}
    };

    return work({
      durationPlans: durationPlanRepo,
      campaigns: campaignRepo as unknown as CampaignRepository<CampaignRecord>,
      scenes: sceneRepo as unknown as SceneRepository,
      operatorAcceptanceRuns: acceptanceRuns,
      reviewEvents: {
        findById: async () => undefined,
        append: async () => {}
      } as unknown as ReviewEventStore,
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      } as unknown as StoryboardCandidateRepository
    });
  }
}

describe("DurationPlanningRoutes", () => {
  it("returns 400 for invalid UUID in GET /api/campaigns/:campaignId/duration-plan", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/campaigns/not-a-uuid/duration-plan"
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 404 when duration plan is not found", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/duration-plan`
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("PLAN_NOT_FOUND");
  });

  it("returns 200 with plan when plan exists", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork({ plans: [samplePlan] })
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/duration-plan`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.planId).toBe(samplePlan.planId);
    expect(body.requestedTotalDurationMs).toBe(15_000);
    expect(body.totalNominalDurationMs).toBe(15_501);
  });

  it("returns 200 on replan preview with feasible allocation", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork({ plans: [samplePlan] }) },
      { reviewerIdentityResolver: { resolve: async () => "Test Reviewer" } }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/replan/preview`,
      payload: {
        sceneIdDurations: {
          [scene1Id]: 5_000,
          [scene2Id]: 5_000,
          [scene3Id]: 5_000
        },
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.feasible).toBe(true);
    expect(body.proposedPlan).toBeDefined();
    expect(body.proposedPlan.allocations).toHaveLength(3);
    expect(body.proposedPlan.totalNominalDurationMs).toBe(15_501);
  });

  it("returns 422 on replan preview with unfeasible ceiling exceeded", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork({ plans: [samplePlan] }) },
      { reviewerIdentityResolver: { resolve: async () => "Test Reviewer" } }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/replan/preview`,
      payload: {
        sceneIdDurations: {
          [scene1Id]: 20_000, // 20s exceeds MAX_SCENE_DURATION_MS = 15_000
          [scene2Id]: 5_000,
          [scene3Id]: 5_000
        },
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1"
      }
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.feasible).toBe(false);
    expect(body.error).toContain("cannot be satisfied");
  });

  it("returns 200 for bindings query", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork({ plans: [samplePlan] })
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/duration-plan/bindings`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.campaignId).toBe(campaignId);
    expect(body.bindings).toBeDefined();
  });

  it("returns 403 on replan preview for an anonymous reviewer identity (issue #426)", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork({ plans: [samplePlan] }) },
      { reviewerIdentityResolver: { resolve: async () => "anonymous" } }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/replan/preview`,
      payload: {
        sceneIdDurations: {
          [scene1Id]: 5_000,
          [scene2Id]: 5_000,
          [scene3Id]: 5_000
        },
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1"
      }
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 on replan commit for an anonymous reviewer identity (issue #426)", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork({ plans: [samplePlan] }) },
      { reviewerIdentityResolver: { resolve: async () => "anonymous" } }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/replan/commit`,
      payload: {
        actionId: "act-commit-1",
        expectedPlanRevision: 1,
        expectedSceneSpecRevisions: {
          [scene1Id]: 1,
          [scene2Id]: 1,
          [scene3Id]: 1
        },
        sceneIdDurations: {
          [scene1Id]: 5_000,
          [scene2Id]: 5_000,
          [scene3Id]: 5_000
        },
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1"
      }
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 200 on replan commit", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork({ plans: [samplePlan] }) },
      { reviewerIdentityResolver: { resolve: async () => "Test Reviewer" } }
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/campaigns/${campaignId}/replan/commit`,
      payload: {
        actionId: "act-commit-1",
        expectedPlanRevision: 1,
        expectedSceneSpecRevisions: {
          [scene1Id]: 1,
          [scene2Id]: 1,
          [scene3Id]: 1
        },
        sceneIdDurations: {
          [scene1Id]: 5_000,
          [scene2Id]: 5_000,
          [scene3Id]: 5_000
        },
        selectedProfileKey: "MINIMAX_H3_720P_5S_I2V_V1"
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.campaignId).toBe(campaignId);
    expect(body.newPlanRevision).toBe(2);
  });

  it("returns 404 for non-existent operator acceptance run", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork() },
      { reviewerIdentityResolver: { resolve: async () => "Test Reviewer" } }
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/operator-acceptance/runs/01950c46-9e90-7d3d-82d2-8f1d3c000099"
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 403 when reviewer identity is anonymous or unauthorized", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork() },
      { reviewerIdentityResolver: { resolve: async () => "anonymous" } }
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/operator-acceptance/runs/01950c46-9e90-7d3d-82d2-8f1d3c000099"
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("returns 403 when client requestedBy conflicts with authenticated reviewer identity", async () => {
    const app = createControlApiApp(
      { uow: new FakeUnitOfWork() },
      { reviewerIdentityResolver: { resolve: async () => "RealReviewer" } }
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/operator-acceptance/runs",
      payload: {
        campaignId,
        actionId: "act-1",
        requestedBy: "SpoofedReviewer"
      }
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("does not match authenticated identity");
  });
});
