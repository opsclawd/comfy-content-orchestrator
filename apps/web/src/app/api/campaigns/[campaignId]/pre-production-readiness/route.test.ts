import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { ApiClientError, getCampaignPreProductionReadiness } from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import type { CampaignPreProductionReadinessReadModel } from "@cco/contracts";
import { CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getCampaignPreProductionReadiness: vi.fn()
  };
});

describe("GET /api/campaigns/[campaignId]/pre-production-readiness", () => {
  const campaignId = "c1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with readiness read model when found", async () => {
    const mockReadiness: CampaignPreProductionReadinessReadModel = {
      campaignId,
      campaignName: "Test Campaign",
      campaignStatus: "planning_ready",
      readinessStatus: "planning_ready",
      readSnapshotId: "cpr-mock-12345678",
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
    vi.mocked(getCampaignPreProductionReadiness).mockResolvedValueOnce(mockReadiness);

    const request = new Request(
      `http://localhost:3000/api/campaigns/${campaignId}/pre-production-readiness`
    );
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockReadiness);
  });

  it("returns 404 when campaign readiness is not found", async () => {
    vi.mocked(getCampaignPreProductionReadiness).mockRejectedValueOnce(
      new ApiClientError("Not found", 404)
    );

    const request = new Request(
      `http://localhost:3000/api/campaigns/${campaignId}/pre-production-readiness`
    );
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 502 when upstream fails", async () => {
    vi.mocked(getCampaignPreProductionReadiness).mockRejectedValueOnce(
      new ApiClientError("Upstream error", 502)
    );

    const request = new Request(
      `http://localhost:3000/api/campaigns/${campaignId}/pre-production-readiness`
    );
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(502);
  });
});
