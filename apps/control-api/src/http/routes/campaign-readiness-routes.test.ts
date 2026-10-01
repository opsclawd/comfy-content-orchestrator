import { describe, expect, it, vi } from "vitest";
import type { CampaignReadinessQueries, UnitOfWork, UnitOfWorkContext } from "@cco/application";
import type { CampaignPreProductionReadinessReadModel } from "@cco/contracts";
import { CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE } from "@cco/contracts";
import { createControlApiApp } from "../app.js";

class FakeUnitOfWork implements UnitOfWork {
  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({
      scenes: { findById: async () => undefined, save: async () => {} },
      reviewEvents: { findById: async () => undefined, append: async () => {} },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      }
    });
  }
}

describe("CampaignReadinessRoutes", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";

  const sampleReadiness: CampaignPreProductionReadinessReadModel = {
    campaignId,
    campaignName: "Test Campaign",
    campaignStatus: "planning_ready",
    readinessStatus: "planning_ready",
    readSnapshotId: "cpr-mock-fingerprint-12345678",
    aggregates: {
      totalScenes: 1,
      planningReadyCount: 1,
      needsAttentionCount: 0,
      blockedForPlanningCount: 0,
      currentReferenceSceneCount: 1,
      scenesWithCurrentShotPlansCount: 1,
      scenesWithSelectionCount: 1,
      approvedSceneCount: 1,
      scenesWithPrevisCount: 1,
      scenesInCampaignAnimaticCount: 1,
      staleSceneCount: 0
    },
    scenes: [],
    planningOnlyNotice: CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE,
    computedAt: "2026-09-27T12:00:00.000Z"
  };

  it("returns 400 VALIDATION_FAILURE when campaignId is not a valid UUID", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/campaigns/not-a-uuid/pre-production-readiness"
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 500 CONFIGURATION_ERROR when the use case is not wired", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/pre-production-readiness`
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("CONFIGURATION_ERROR");
  });

  it("returns 404 NOT_FOUND when campaign readiness is not found", async () => {
    const mockQueries: CampaignReadinessQueries = {
      getCampaignPreProductionReadiness: vi.fn(async () => undefined)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignReadinessQueries: mockQueries
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/pre-production-readiness`
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(campaignId);
  });

  it("returns 200 with CampaignPreProductionReadinessReadModel when found", async () => {
    const mockQueries: CampaignReadinessQueries = {
      getCampaignPreProductionReadiness: vi.fn(async () => sampleReadiness)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignReadinessQueries: mockQueries
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/pre-production-readiness`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.campaignId).toBe(campaignId);
    expect(body.planningOnlyNotice).toBe(CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE);
    expect(body.readinessStatus).toBe("planning_ready");
  });
});
