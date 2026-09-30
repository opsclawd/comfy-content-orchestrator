import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { ApiClientError, getCampaignAnimatic } from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import type { CampaignAnimaticReadModel } from "@cco/contracts";
import { CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getCampaignAnimatic: vi.fn()
  };
});

describe("GET /api/campaigns/[campaignId]/animatic", () => {
  const campaignId = "c1111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with animatic read model when found", async () => {
    const mockAnimatic: CampaignAnimaticReadModel = {
      campaignId,
      campaignName: "Test Campaign",
      readSnapshotId: "cas-mock-12345678",
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
    vi.mocked(getCampaignAnimatic).mockResolvedValueOnce(mockAnimatic);

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}/animatic`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockAnimatic);
  });

  it("returns 404 when campaign animatic is not found", async () => {
    vi.mocked(getCampaignAnimatic).mockRejectedValueOnce(new ApiClientError("Not found", 404));

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}/animatic`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 502 when upstream fails", async () => {
    vi.mocked(getCampaignAnimatic).mockRejectedValueOnce(new ApiClientError("Upstream error", 502));

    const request = new Request(`http://localhost:3000/api/campaigns/${campaignId}/animatic`);
    const response = await GET(request, { params: Promise.resolve({ campaignId }) });

    expect(response.status).toBe(502);
  });
});
