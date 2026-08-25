import { describe, expect, it, vi } from "vitest";
import {
  createApiClient,
  getHealth,
  getCampaignReviewSummary,
  getSceneReviewDetail,
  ApiClientError,
  ApiValidationError
} from "./client.js";
import type { CampaignReviewSummary, SceneReviewDetailReadModel } from "@cco/contracts";

const validCampaignReviewSummary: CampaignReviewSummary = {
  campaignId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  campaignName: "Test Campaign",
  totalScenes: 1,
  scenesByStatus: {
    director_review: 1
  },
  pendingReviewCount: 1,
  approvedCount: 0,
  completedCount: 0,
  scenes: [
    {
      sceneId: "123e4567-e89b-12d3-a456-426614174000",
      status: "director_review",
      specRevision: 1
    }
  ],
  updatedAt: "2026-08-20T00:00:00.000Z"
};

const validSceneReviewDetail: SceneReviewDetailReadModel = {
  sceneId: "123e4567-e89b-12d3-a456-426614174000",
  campaignId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  status: "director_review",
  specRevision: 1,
  configuration: {
    prompt: "A cinematic space battle",
    referenceIds: ["ref-1"],
    engineProfileId: "engine-profile-1",
    durationMs: 5000,
    loraConfigurationId: null
  },
  selectedCandidateId: "223e4567-e89b-12d3-a456-426614174000",
  selectedCandidateRevision: 1,
  approval: {
    revision: 1,
    approvedBy: "Director Alice",
    approvedAt: "2026-08-20T01:00:00.000Z"
  },
  candidatesByRevision: [
    {
      specRevision: 1,
      candidates: [
        {
          candidateId: "223e4567-e89b-12d3-a456-426614174000",
          sceneId: "123e4567-e89b-12d3-a456-426614174000",
          specRevision: 1,
          variantOrdinal: 1,
          contentHash: "sha256-hash-example",
          media: {
            available: true,
            url: "https://example.com/media.mp4"
          },
          createdAt: "2026-08-20T00:30:00.000Z"
        }
      ]
    }
  ],
  allowedActions: ["approve", "reject", "reroll"]
};

describe("Typed Control API Client", () => {
  it("parses and returns valid health response", async () => {
    const validData = {
      status: "ok",
      timestamp: "2026-08-20T00:00:00.000Z"
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validData
    });

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    const result = await client.getHealth();

    expect(mockFetch).toHaveBeenCalledWith("http://example.com/api/health", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    });
    expect(result).toEqual(validData);
  });

  it("throws ApiValidationError when response shape is malformed", async () => {
    const malformedData = {
      status: "wrong_status",
      timestamp: 12345
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => malformedData
    });

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    await expect(client.getHealth()).rejects.toThrow(ApiValidationError);
  });

  it("throws ApiClientError when response is HTTP 500", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    });

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    await expect(client.getHealth()).rejects.toThrow(ApiClientError);
  });

  it("throws ApiClientError when network connection fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection refused"));

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    await expect(client.getHealth()).rejects.toThrow(ApiClientError);
  });

  it("getHealth convenience function works as expected", async () => {
    const validData = {
      status: "ok",
      timestamp: "2026-08-20T00:00:00.000Z"
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validData
    });

    const result = await getHealth("http://example.com", mockFetch);
    expect(result).toEqual(validData);
  });

  it("requests an encoded campaign review-summary path without persistent caching", async () => {
    const campaignId = "campaign 123/special";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validCampaignReviewSummary
    });

    const result = await getCampaignReviewSummary(campaignId, mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/campaigns/campaign%20123%2Fspecial/review-summary",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      }
    );
    expect(result).toEqual(validCampaignReviewSummary);

    const client = createApiClient({
      baseUrl: "https://custom-api.example.com",
      fetchFn: mockFetch
    });
    const clientResult = await client.getCampaignReviewSummary(campaignId);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-api.example.com/api/campaigns/campaign%20123%2Fspecial/review-summary",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      }
    );
    expect(clientResult).toEqual(validCampaignReviewSummary);
  });

  it("requests an encoded scene review path without persistent caching", async () => {
    const sceneId = "scene 456/special";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validSceneReviewDetail
    });

    const result = await getSceneReviewDetail(sceneId, mockFetch);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/scenes/scene%20456%2Fspecial/review",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      }
    );
    expect(result).toEqual(validSceneReviewDetail);

    const client = createApiClient({
      baseUrl: "https://custom-api.example.com",
      fetchFn: mockFetch
    });
    const clientResult = await client.getSceneReviewDetail(sceneId);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://custom-api.example.com/api/scenes/scene%20456%2Fspecial/review",
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      }
    );
    expect(clientResult).toEqual(validSceneReviewDetail);
  });

  it("rejects malformed successful review payloads as ApiValidationError", async () => {
    const malformedPayload = {
      campaignId: "not-a-valid-uuid",
      totalScenes: -5
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => malformedPayload
    });

    await expect(
      getCampaignReviewSummary("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", mockFetch)
    ).rejects.toThrow(ApiValidationError);

    await expect(
      getSceneReviewDetail("123e4567-e89b-12d3-a456-426614174000", mockFetch)
    ).rejects.toThrow(ApiValidationError);
  });

  it("preserves 404 status on ApiClientError", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found"
    });

    let campaignError: unknown;
    try {
      await getCampaignReviewSummary("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", mockFetch);
    } catch (err) {
      campaignError = err;
    }

    expect(campaignError).toBeInstanceOf(ApiClientError);
    expect((campaignError as ApiClientError).statusCode).toBe(404);

    let sceneError: unknown;
    try {
      await getSceneReviewDetail("123e4567-e89b-12d3-a456-426614174000", mockFetch);
    } catch (err) {
      sceneError = err;
    }

    expect(sceneError).toBeInstanceOf(ApiClientError);
    expect((sceneError as ApiClientError).statusCode).toBe(404);
  });

  it("classifies invalid JSON separately from network and HTTP failures", async () => {
    // 1. Invalid JSON produces ApiValidationError
    const invalidJsonFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON at position 0");
      }
    });

    await expect(
      getCampaignReviewSummary("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", invalidJsonFetch)
    ).rejects.toThrow(ApiValidationError);

    // 2. Network rejection produces ApiClientError without status code
    const networkErrorFetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));

    let networkError: unknown;
    try {
      await getCampaignReviewSummary("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", networkErrorFetch);
    } catch (err) {
      networkError = err;
    }

    expect(networkError).toBeInstanceOf(ApiClientError);
    expect((networkError as ApiClientError).statusCode).toBeUndefined();

    // 3. HTTP 500 produces ApiClientError with status code 500
    const httpErrorFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    });

    let httpError: unknown;
    try {
      await getCampaignReviewSummary("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d", httpErrorFetch);
    } catch (err) {
      httpError = err;
    }

    expect(httpError).toBeInstanceOf(ApiClientError);
    expect((httpError as ApiClientError).statusCode).toBe(500);
  });
});
