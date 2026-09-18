import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { ApiClientError, getCampaignReviewSummary } from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import type { CampaignReviewSummary } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getCampaignReviewSummary: vi.fn()
  };
});

describe("GET /api/campaigns/[campaignId]/review-summary", () => {
  const campaignId = "c1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with summary when found", async () => {
    const mockSummary: CampaignReviewSummary = {
      campaignId,
      campaignName: "Test Campaign",
      status: "planning",
      totalScenes: 3,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 0,
      scenesByStatus: {},
      scenes: [],
      updatedAt: "2026-09-17T12:00:00.000Z"
    };
    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(mockSummary);

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}/review-summary`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockSummary);
  });

  it("returns 404 when campaign is not found", async () => {
    vi.mocked(getCampaignReviewSummary).mockRejectedValueOnce(new ApiClientError("Not found", 404));

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}/review-summary`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 502 when upstream fails", async () => {
    vi.mocked(getCampaignReviewSummary).mockRejectedValueOnce(
      new ApiClientError("Upstream error", 502)
    );

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}/review-summary`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(502);
  });
});
