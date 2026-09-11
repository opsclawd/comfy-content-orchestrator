import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import {
  planCampaignStoryboard,
  ApiClientError,
  ApiValidationError,
  PlanCampaignStoryboardApiError
} from "../../../../api/client";
import type * as ClientModule from "../../../../api/client";
import type {
  PlanCampaignStoryboardRequest,
  PlanCampaignStoryboardResponse,
  PlanCampaignStoryboardErrorResponse
} from "@cco/contracts";

vi.mock("../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    planCampaignStoryboard: vi.fn()
  };
});

function createJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("Review Hub Campaign Plan Route Handler: POST /api/campaigns/plan", () => {
  const routeUrl = "http://localhost:3000/api/campaigns/plan";

  const validRequest: PlanCampaignStoryboardRequest = {
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    clientId: "22222222-2222-4222-8222-222222222222",
    title: "Summer 2026 Collection",
    targetTotalDurationMs: 15000,
    brief: {
      description: "High energy summer fashion reel"
    }
  };

  const defaultSuccessResponse: PlanCampaignStoryboardResponse = {
    campaignId: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    status: "drafting",
    totalScenes: 3,
    targetTotalDurationMs: 15000,
    isIdempotentReplay: false,
    sceneCount: 3,
    scenes: [
      {
        sceneId: "44444444-4444-4444-8444-444444444441",
        ordinal: 1,
        status: "generating_candidates"
      },
      {
        sceneId: "44444444-4444-4444-8444-444444444442",
        ordinal: 2,
        status: "generating_candidates"
      },
      {
        sceneId: "44444444-4444-4444-8444-444444444443",
        ordinal: 3,
        status: "generating_candidates"
      }
    ],
    createdAt: "2026-09-10T12:00:00.000Z"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Happy path", () => {
    it("proxies a valid request to the client and returns 201 with response body", async () => {
      vi.mocked(planCampaignStoryboard).mockResolvedValueOnce(defaultSuccessResponse);

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toEqual(defaultSuccessResponse);
      expect(planCampaignStoryboard).toHaveBeenCalledTimes(1);
      expect(planCampaignStoryboard).toHaveBeenCalledWith(validRequest);
    });
  });

  describe("Local request validation (before upstream call)", () => {
    it("returns 400 on malformed JSON payload without calling upstream", async () => {
      const request = new Request(routeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json..."
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.message).toMatch(/json/i);
      expect(planCampaignStoryboard).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_FAILURE when request fails schema validation", async () => {
      const invalidPayload = {
        ...validRequest,
        clientId: "not-a-uuid"
      };

      const request = createJsonRequest(routeUrl, invalidPayload);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(body.message).toContain("validation");
      expect(Array.isArray(body.details)).toBe(true);
      expect(planCampaignStoryboard).not.toHaveBeenCalled();
    });
  });

  describe("Upstream structured error pass-through (Decision 6)", () => {
    it("passes through 409 STORYBOARD_MATERIALIZATION_CONFLICT unmodified", async () => {
      const conflictError: PlanCampaignStoryboardErrorResponse = {
        code: "STORYBOARD_MATERIALIZATION_CONFLICT",
        message: "Storyboard materialization conflict occurred",
        details: { campaignId: "33333333-3333-4333-8333-333333333333", reason: "Concurrent run" }
      };

      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new PlanCampaignStoryboardApiError(409, conflictError)
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual(conflictError);
    });

    it("passes through 409 IDEMPOTENCY_CONFLICT unmodified", async () => {
      const idempotencyError: PlanCampaignStoryboardErrorResponse = {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was previously used with different parameters",
        details: { idempotencyKey: validRequest.idempotencyKey }
      };

      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new PlanCampaignStoryboardApiError(409, idempotencyError)
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual(idempotencyError);
    });

    it("passes through 422 PLANNING_SAFETY_REFUSAL unmodified", async () => {
      const safetyError: PlanCampaignStoryboardErrorResponse = {
        code: "PLANNING_SAFETY_REFUSAL",
        message: "Content was flagged by safety filter",
        details: { provider: "mock-ai" }
      };

      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new PlanCampaignStoryboardApiError(422, safetyError)
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toEqual(safetyError);
    });

    it("passes through 400 VALIDATION_FAILURE from upstream unmodified", async () => {
      const upstreamValidationError: PlanCampaignStoryboardErrorResponse = {
        code: "VALIDATION_FAILURE",
        message: "Invalid target duration combination",
        details: [{ path: ["sceneCountOverride"], message: "duration mismatch" }]
      };

      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new PlanCampaignStoryboardApiError(400, upstreamValidationError)
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual(upstreamValidationError);
    });
  });

  describe("Indeterminate and unhandled failures (502 / 500)", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("returns generic 502 on ApiClientError (network failure) without leaking internal details", async () => {
      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new ApiClientError(
          "Failed to connect: connect ECONNREFUSED 127.0.0.1:3000 secret=supersecret"
        )
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body).toEqual({ message: "Bad Gateway" });
      expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
      expect(JSON.stringify(body)).not.toContain("supersecret");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("returns generic 502 on ApiValidationError without leaking internal error details", async () => {
      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new ApiValidationError("Schema validation failed: internal_token leaked", [
          { message: "bad" }
        ])
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body).toEqual({ message: "Bad Gateway" });

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it("returns generic 500 on unexpected Error without leaking secrets", async () => {
      vi.mocked(planCampaignStoryboard).mockRejectedValueOnce(
        new Error("Unexpected crash with password secretpassword123")
      );

      const request = createJsonRequest(routeUrl, validRequest);
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ message: "Internal Server Error" });
      expect(JSON.stringify(body)).not.toContain("secretpassword123");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
