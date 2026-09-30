import { describe, expect, it } from "vitest";
import type { CampaignAnimaticReadModel } from "@cco/contracts";
import { CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE } from "@cco/contracts";
import type { CampaignAnimaticQueries } from "../ports/campaign-animatic-queries.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ResolveCampaignAnimaticUseCase } from "./resolve-campaign-animatic.js";

function createMockAnimaticReadModel(campaignId: string): CampaignAnimaticReadModel {
  return {
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
}

describe("ResolveCampaignAnimaticUseCase", () => {
  it("resolves and returns the CampaignAnimaticReadModel from queries port", async () => {
    const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mockModel = createMockAnimaticReadModel(campaignId);

    const mockQueries: CampaignAnimaticQueries = {
      getCampaignAnimatic: async (id) => {
        if (id === campaignId) {
          return mockModel;
        }
        return undefined;
      }
    };

    const useCase = new ResolveCampaignAnimaticUseCase({
      queries: mockQueries
    });

    const result = await useCase.execute(campaignId);
    expect(result).toEqual(mockModel);
    expect(result.nonProductionNotice).toBe(CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE);
  });

  it("throws CampaignNotFoundError when campaign animatic is not found", async () => {
    const missingCampaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const mockQueries: CampaignAnimaticQueries = {
      getCampaignAnimatic: async () => undefined
    };

    const useCase = new ResolveCampaignAnimaticUseCase({
      queries: mockQueries
    });

    await expect(useCase.execute(missingCampaignId)).rejects.toThrow(CampaignNotFoundError);
  });
});
