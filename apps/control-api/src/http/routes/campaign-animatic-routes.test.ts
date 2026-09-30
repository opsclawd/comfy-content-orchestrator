import { describe, expect, it, vi } from "vitest";
import type { CampaignAnimaticQueries, UnitOfWork, UnitOfWorkContext } from "@cco/application";
import type { CampaignAnimaticReadModel } from "@cco/contracts";
import { CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE } from "@cco/contracts";
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

describe("CampaignAnimaticRoutes", () => {
  const campaignId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";

  const sampleAnimatic: CampaignAnimaticReadModel = {
    campaignId,
    campaignName: "Test Campaign",
    readSnapshotId: "cas-mock-fingerprint-12345678",
    totalDurationMs: 4000,
    includedShotPlanDurationMs: 4000,
    totalScenes: 1,
    gapCount: 0,
    approvedShotCount: 1,
    draftShotCount: 0,
    segments: [],
    nonProductionNotice: CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE,
    compiledAt: "2026-09-27T12:00:00.000Z"
  };

  it("returns 400 VALIDATION_FAILURE when campaignId is not a valid UUID", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/campaigns/not-a-uuid/animatic"
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 404 NOT_FOUND when campaign animatic is not found", async () => {
    const mockQueries: CampaignAnimaticQueries = {
      getCampaignAnimatic: vi.fn(async () => undefined)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignAnimaticQueries: mockQueries
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/animatic`
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain(campaignId);
  });

  it("returns 200 with CampaignAnimaticReadModel when found", async () => {
    const mockQueries: CampaignAnimaticQueries = {
      getCampaignAnimatic: vi.fn(async () => sampleAnimatic)
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      campaignAnimaticQueries: mockQueries
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignId}/animatic`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.campaignId).toBe(campaignId);
    expect(body.campaignName).toBe("Test Campaign");
    expect(body.nonProductionNotice).toBe(CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE);
    expect(body.totalDurationMs).toBe(4000);
  });
});
