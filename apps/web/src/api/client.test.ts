import { describe, expect, it, vi } from "vitest";
import {
  createApiClient,
  getHealth,
  getCampaignReviewSummary,
  getSceneReviewDetail,
  submitReviewCommand,
  ApiClientError,
  ApiValidationError,
  ReviewCommandApiError
} from "./client.js";
import type {
  CampaignReviewSummary,
  ReviewCommand,
  ReviewCommandResponse,
  ReviewErrorResponse,
  SceneReviewDetailReadModel
} from "@cco/contracts";

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

  describe("submitReviewCommand - command table tests covering all ten actions", () => {
    const sceneId = "123e4567-e89b-12d3-a456-426614174000";
    const actionId = "11111111-1111-1111-1111-111111111111";
    const expectedSpecRevision = 2;
    const directorNotes = "Optional notes for the action";

    const defaultSuccessResponse: ReviewCommandResponse = {
      sceneId,
      status: "director_review",
      specRevision: 3,
      isIdempotentReplay: false
    };

    const actionTestCases: Array<{
      action: ReviewCommand["action"];
      payload: ReviewCommand["payload"];
      expectedPayload: Record<string, unknown>;
    }> = [
      {
        action: "candidate_select",
        payload: { candidateId: "223e4567-e89b-12d3-a456-426614174000" },
        expectedPayload: { candidateId: "223e4567-e89b-12d3-a456-426614174000" }
      },
      {
        action: "approve",
        payload: {},
        expectedPayload: {}
      },
      {
        action: "reroll",
        payload: {},
        expectedPayload: {}
      },
      {
        action: "prompt_edit",
        payload: { prompt: "Updated scene prompt" },
        expectedPayload: { prompt: "Updated scene prompt" }
      },
      {
        action: "reference_change",
        payload: { referenceIds: ["ref-100", "ref-101"] },
        expectedPayload: { referenceIds: ["ref-100", "ref-101"] }
      },
      {
        action: "engine_change",
        payload: { engineProfileId: "profile-fast-v2" },
        expectedPayload: { engineProfileId: "profile-fast-v2" }
      },
      {
        action: "duration_change",
        payload: { durationMs: 7500 },
        expectedPayload: { durationMs: 7500 }
      },
      {
        action: "lora_tune",
        payload: { loraConfigurationId: "lora-cfg-alpha" },
        expectedPayload: { loraConfigurationId: "lora-cfg-alpha" }
      },
      {
        action: "cancel",
        payload: {},
        expectedPayload: {}
      },
      {
        action: "reject",
        payload: {},
        expectedPayload: {}
      }
    ];

    for (const { action, payload, expectedPayload } of actionTestCases) {
      it(`submits ${action} action: asserts exactly one POST, encoded scene path, and schema-stripped body`, async () => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => defaultSuccessResponse
        });

        const client = createApiClient({
          baseUrl: "http://localhost:3000",
          fetchFn: mockFetch
        });

        // Pass extra forbidden fields (reviewerName, timestamps/occurredAt, status)
        const rawCommand = {
          actionId,
          sceneId,
          expectedSpecRevision,
          action,
          payload,
          directorNotes,
          reviewerName: "UnauthorizedReviewer",
          occurredAt: "2026-08-20T00:00:00.000Z",
          status: "director_review"
        } as unknown as ReviewCommand;

        const result = await client.submitReviewCommand(sceneId, rawCommand);

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          `http://localhost:3000/api/scenes/${encodeURIComponent(sceneId)}/review-command`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            cache: "no-store",
            body: expect.any(String)
          }
        );

        const callOptions = mockFetch.mock.calls[0]?.[1] as { body?: string } | undefined;
        expect(callOptions?.body).toBeDefined();
        const parsedBody = JSON.parse(callOptions?.body ?? "{}");
        expect(parsedBody).toEqual({
          actionId,
          sceneId,
          expectedSpecRevision,
          action,
          payload: expectedPayload,
          directorNotes
        });

        // Assert strictly no extra fields
        expect(parsedBody).not.toHaveProperty("reviewerName");
        expect(parsedBody).not.toHaveProperty("occurredAt");
        expect(parsedBody).not.toHaveProperty("status");
        expect(result).toEqual(defaultSuccessResponse);
      });
    }
  });

  describe("submitReviewCommand - invariants and failure classifications", () => {
    const sceneId = "123e4567-e89b-12d3-a456-426614174000";
    const validCommand: ReviewCommand = {
      actionId: "11111111-1111-1111-1111-111111111111",
      sceneId,
      expectedSpecRevision: 1,
      action: "approve",
      payload: {}
    };

    it("does not retry a rejected command fetch", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Network disconnect in flight"));

      const client = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetch
      });

      await expect(client.submitReviewCommand(sceneId, validCommand)).rejects.toThrow(
        ApiClientError
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("parses a successful command response", async () => {
      const successData: ReviewCommandResponse = {
        sceneId,
        status: "approved",
        specRevision: 2,
        selectedCandidateId: "223e4567-e89b-12d3-a456-426614174000",
        approval: {
          revision: 2,
          approvedBy: "Director Alice",
          approvedAt: "2026-08-20T01:00:00.000Z"
        },
        isIdempotentReplay: false
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => successData
      });

      const client = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetch
      });

      const result = await client.submitReviewCommand(sceneId, validCommand);
      expect(result).toEqual(successData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Also test top-level convenience function
      const convenienceResult = await submitReviewCommand(sceneId, validCommand, mockFetch);
      expect(convenienceResult).toEqual(successData);
    });

    it("preserves structured stale and idempotency failures", async () => {
      // Stale revision conflict (409)
      const staleErrorBody: ReviewErrorResponse = {
        code: "STALE_REVISION_CONFLICT",
        message: "Scene spec revision 1 is stale; current revision is 2",
        details: {
          expectedRevision: 1,
          currentRevision: 2
        }
      };

      const mockFetchStale = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => staleErrorBody
      });

      const clientStale = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetchStale
      });

      let capturedError: unknown;
      try {
        await clientStale.submitReviewCommand(sceneId, validCommand);
      } catch (err) {
        capturedError = err;
      }

      expect(capturedError).toBeInstanceOf(ReviewCommandApiError);
      const staleErr = capturedError as ReviewCommandApiError;
      expect(staleErr.statusCode).toBe(409);
      expect(staleErr.error).toEqual(staleErrorBody);
      expect(staleErr.body).toEqual(staleErrorBody);

      // Idempotency conflict (409)
      const idempotencyErrorBody: ReviewErrorResponse = {
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Action ID 11111111-1111-1111-1111-111111111111 was previously used with different parameters",
        details: {
          actionId: "11111111-1111-1111-1111-111111111111"
        }
      };

      const mockFetchIdempotency = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => idempotencyErrorBody
      });

      const clientIdempotency = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetchIdempotency
      });

      capturedError = undefined;
      try {
        await clientIdempotency.submitReviewCommand(sceneId, validCommand);
      } catch (err) {
        capturedError = err;
      }

      expect(capturedError).toBeInstanceOf(ReviewCommandApiError);
      const idempotencyErr = capturedError as ReviewCommandApiError;
      expect(idempotencyErr.statusCode).toBe(409);
      expect(idempotencyErr.error).toEqual(idempotencyErrorBody);
      expect(idempotencyErr.body).toEqual(idempotencyErrorBody);

      // Domain transition failure (422)
      const domainErrorBody: ReviewErrorResponse = {
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Cannot approve scene in generating_candidates status"
      };

      const mockFetchDomain = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => domainErrorBody
      });

      const clientDomain = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetchDomain
      });

      capturedError = undefined;
      try {
        await clientDomain.submitReviewCommand(sceneId, validCommand);
      } catch (err) {
        capturedError = err;
      }

      expect(capturedError).toBeInstanceOf(ReviewCommandApiError);
      const domainErr = capturedError as ReviewCommandApiError;
      expect(domainErr.statusCode).toBe(422);
      expect(domainErr.error).toEqual(domainErrorBody);
    });

    it("rejects malformed command success and error bodies", async () => {
      // 1. 200 OK with malformed success response
      const malformedSuccessFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          sceneId: "invalid-uuid",
          status: "not_a_valid_status"
        })
      });

      const clientMalformedSuccess = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: malformedSuccessFetch
      });

      await expect(
        clientMalformedSuccess.submitReviewCommand(sceneId, validCommand)
      ).rejects.toThrow(ApiValidationError);

      // 2. 200 OK with non-JSON text
      const nonJsonSuccessFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        }
      });

      const clientNonJsonSuccess = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: nonJsonSuccessFetch
      });

      await expect(clientNonJsonSuccess.submitReviewCommand(sceneId, validCommand)).rejects.toThrow(
        ApiValidationError
      );

      // 3. 400 Bad Request with malformed error payload (e.g. unknown code or missing message)
      const malformedErrorFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          code: "UNKNOWN_CUSTOM_ERROR",
          message: 12345
        })
      });

      const clientMalformedError = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: malformedErrorFetch
      });

      await expect(clientMalformedError.submitReviewCommand(sceneId, validCommand)).rejects.toThrow(
        ApiValidationError
      );

      // 4. 502 Bad Gateway with unstructured HTML/text (res.json() throws SyntaxError)
      const unstructured500Fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        }
      });

      const client500 = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: unstructured500Fetch
      });

      let err500: unknown;
      try {
        await client500.submitReviewCommand(sceneId, validCommand);
      } catch (err) {
        err500 = err;
      }

      expect(err500).toBeInstanceOf(ApiClientError);
      expect((err500 as ApiClientError).statusCode).toBe(502);
    });

    it("rejects when route sceneId does not match command body sceneId before fetch", async () => {
      const mockFetch = vi.fn();
      const client = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetch
      });

      const mismatchedSceneId = "99999999-9999-9999-9999-999999999999";
      await expect(client.submitReviewCommand(mismatchedSceneId, validCommand)).rejects.toThrow(
        ApiValidationError
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects invalid command schema before fetch", async () => {
      const mockFetch = vi.fn();
      const client = createApiClient({
        baseUrl: "http://localhost:3000",
        fetchFn: mockFetch
      });

      const invalidCommand = {
        actionId: "not-a-uuid",
        sceneId,
        expectedSpecRevision: -1,
        action: "unknown_action"
      } as unknown as ReviewCommand;

      await expect(client.submitReviewCommand(sceneId, invalidCommand)).rejects.toThrow(
        ApiValidationError
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
