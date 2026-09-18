import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { ApiClientError, getCampaign } from "../../../../api/client";
import type * as ClientModule from "../../../../api/client";
import type { CampaignResponse } from "@cco/contracts";

vi.mock("../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getCampaign: vi.fn()
  };
});

describe("GET /api/campaigns/[campaignId]", () => {
  const campaignId = "c1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with campaign when found", async () => {
    const mockCampaign: CampaignResponse = {
      campaignId,
      clientId: "22222222-2222-4222-8222-222222222222",
      title: "Test Campaign",
      targetPlatform: "instagram_reels",
      status: "planning",
      totalScenes: 3,
      approvedScenes: 0,
      createdAt: "2026-09-17T12:00:00.000Z"
    };
    vi.mocked(getCampaign).mockResolvedValueOnce(mockCampaign);

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockCampaign);
  });

  it("returns 404 when campaign is not found", async () => {
    vi.mocked(getCampaign).mockRejectedValueOnce(new ApiClientError("Not found", 404));

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 502 when upstream fails", async () => {
    vi.mocked(getCampaign).mockRejectedValueOnce(new ApiClientError("Upstream error", 502));

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(502);
  });
});
