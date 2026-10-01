import { describe, expect, it } from "vitest";
import type { CampaignPreProductionReadinessReadModel } from "@cco/contracts";
import { CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE } from "@cco/contracts";
import type { CampaignReadinessQueries } from "../ports/campaign-readiness-queries.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ResolveCampaignPreProductionReadinessUseCase } from "./resolve-campaign-pre-production-readiness.js";

function createMockReadinessReadModel(campaignId: string): CampaignPreProductionReadinessReadModel {
  return {
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
}

describe("ResolveCampaignPreProductionReadinessUseCase", () => {
  it("resolves and returns the read model from the queries port", async () => {
    const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mockModel = createMockReadinessReadModel(campaignId);

    const mockQueries: CampaignReadinessQueries = {
      getCampaignPreProductionReadiness: async (id) => {
        if (id === campaignId) {
          return mockModel;
        }
        return undefined;
      }
    };

    const useCase = new ResolveCampaignPreProductionReadinessUseCase({ queries: mockQueries });

    const result = await useCase.execute(campaignId);
    expect(result).toEqual(mockModel);
    expect(result.planningOnlyNotice).toBe(CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE);
  });

  it("throws CampaignNotFoundError when the campaign is not found", async () => {
    const missingCampaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const mockQueries: CampaignReadinessQueries = {
      getCampaignPreProductionReadiness: async () => undefined
    };

    const useCase = new ResolveCampaignPreProductionReadinessUseCase({ queries: mockQueries });

    await expect(useCase.execute(missingCampaignId)).rejects.toThrow(CampaignNotFoundError);
  });
});
