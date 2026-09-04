import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import {
  submitReviewCommand,
  ApiClientError,
  ApiValidationError,
  ReviewCommandApiError
} from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import {
  resolveReviewerIdentity,
  ReviewerIdentityUnavailableError
} from "../../../../../api/reviewer-identity";
import type * as ReviewerIdentityModule from "../../../../../api/reviewer-identity";
import type { ReviewCommand, ReviewCommandResponse, ReviewErrorResponse } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    submitReviewCommand: vi.fn()
  };
});

vi.mock("../../../../../api/reviewer-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof ReviewerIdentityModule>();
  return {
    ...actual,
    resolveReviewerIdentity: vi.fn().mockResolvedValue({
      login: "director@example.com",
      displayName: "Director Alice"
    })
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

describe("Review Hub Command Route Handler: POST /api/scenes/[sceneId]/review-command", () => {
  const sceneId = "123e4567-e89b-12d3-a456-426614174000";
  const actionId = "11111111-1111-1111-1111-111111111111";
  const routeUrl = `http://localhost:3000/api/scenes/${sceneId}/review-command`;

  const validApproveCommand: ReviewCommand = {
    actionId,
    sceneId,
    expectedSpecRevision: 1,
    action: "approve",
    payload: {},
    directorNotes: "LGTM"
  };

  const defaultSuccessResponse: ReviewCommandResponse = {
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveReviewerIdentity).mockResolvedValue({
      login: "director@example.com",
      displayName: "Director Alice"
    });
  });

  describe("Reviewer Identity Verification", () => {
    it("returns 401 AUTHENTICATION_REQUIRED when reviewer identity cannot be established", async () => {
      vi.mocked(resolveReviewerIdentity).mockRejectedValueOnce(
        new ReviewerIdentityUnavailableError("Peer IP missing or unresolvable")
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body).toEqual({
        code: "AUTHENTICATION_REQUIRED",
        message: "Reviewer identity could not be established."
      });
      expect(submitReviewCommand).not.toHaveBeenCalled();
    });
  });

  describe("Happy Path & Action Forwarding", () => {
    it("forwards a valid command exactly once through the API client and returns 200 with upstream success JSON", async () => {
      vi.mocked(submitReviewCommand).mockResolvedValueOnce(defaultSuccessResponse);

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(submitReviewCommand).toHaveBeenCalledTimes(1);
      expect(submitReviewCommand).toHaveBeenCalledWith(sceneId, validApproveCommand, {
        login: "director@example.com",
        displayName: "Director Alice"
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(defaultSuccessResponse);
    });

    it("forwards all ten Phase 1 review actions with stripped payload fields", async () => {
      const actions: Array<{
        action: ReviewCommand["action"];
        payload: ReviewCommand["payload"];
      }> = [
        {
          action: "candidate_select",
          payload: { candidateId: "223e4567-e89b-12d3-a456-426614174000" }
        },
        { action: "approve", payload: {} },
        { action: "reroll", payload: {} },
        {
          action: "prompt_edit",
          payload: { prompt: "A cinematic cityscape in the rain" }
        },
        {
          action: "reference_change",
          payload: { referenceIds: ["ref-1", "ref-2"] }
        },
        {
          action: "engine_change",
          payload: { engineProfileId: "engine-profile-v2" }
        },
        {
          action: "duration_change",
          payload: { durationMs: 4000 }
        },
        {
          action: "lora_tune",
          payload: { loraConfigurationId: "lora-cfg-1" }
        },
        { action: "cancel", payload: {} },
        { action: "reject", payload: {} }
      ];

      for (const { action, payload } of actions) {
        vi.mocked(submitReviewCommand).mockResolvedValueOnce({
          sceneId,
          status: "director_review",
          specRevision: 2,
          isIdempotentReplay: false
        });

        // Pass extra forbidden fields (reviewerName, timestamps, raw status) in request JSON
        const rawPayload = {
          actionId,
          sceneId,
          expectedSpecRevision: 1,
          action,
          payload,
          directorNotes: "Action notes",
          reviewerName: "InjectedReviewer",
          occurredAt: "2026-08-20T00:00:00.000Z",
          status: "director_review"
        };

        const request = createJsonRequest(routeUrl, rawPayload);
        const response = await POST(request, {
          params: Promise.resolve({ sceneId })
        });

        expect(response.status).toBe(200);
        expect(submitReviewCommand).toHaveBeenCalledTimes(1);

        // Verify the command passed to submitReviewCommand does NOT have injected fields
        const forwardedCommand = vi.mocked(submitReviewCommand).mock.calls[0]?.[1];
        expect(forwardedCommand).toEqual({
          actionId,
          sceneId,
          expectedSpecRevision: 1,
          action,
          payload,
          directorNotes: "Action notes"
        });
        expect(forwardedCommand).not.toHaveProperty("reviewerName");
        expect(forwardedCommand).not.toHaveProperty("occurredAt");
        expect(forwardedCommand).not.toHaveProperty("status");

        vi.clearAllMocks();
      }
    });
  });

  describe("Structured Upstream Error Translation (400, 404, 409, 422)", () => {
    it("preserves 404 NOT_FOUND status and exact contract body", async () => {
      const errorBody: ReviewErrorResponse = {
        code: "NOT_FOUND",
        message: "Scene not found"
      };

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ReviewCommandApiError(404, errorBody)
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual(errorBody);
    });

    it("preserves 409 STALE_REVISION_CONFLICT status and exact contract body with revision details", async () => {
      const errorBody: ReviewErrorResponse = {
        code: "STALE_REVISION_CONFLICT",
        message: "Scene spec revision 1 is stale; current revision is 2",
        details: {
          expectedRevision: 1,
          currentRevision: 2
        }
      };

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ReviewCommandApiError(409, errorBody)
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual(errorBody);
    });

    it("preserves 409 IDEMPOTENCY_CONFLICT status and exact contract body with actionId details", async () => {
      const errorBody: ReviewErrorResponse = {
        code: "IDEMPOTENCY_CONFLICT",
        message: `Action ID ${actionId} was previously used with different parameters`,
        details: {
          actionId
        }
      };

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ReviewCommandApiError(409, errorBody)
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toEqual(errorBody);
    });

    it("preserves 422 INVALID_DOMAIN_TRANSITION status and exact contract body", async () => {
      const errorBody: ReviewErrorResponse = {
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Cannot approve scene in generating_candidates status"
      };

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ReviewCommandApiError(422, errorBody)
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body).toEqual(errorBody);
    });

    it("preserves 400 VALIDATION_FAILURE status and exact contract body from upstream", async () => {
      const errorBody: ReviewErrorResponse = {
        code: "VALIDATION_FAILURE",
        message: "Upstream validation failed",
        details: [{ path: ["payload"], message: "Invalid payload" }]
      };

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ReviewCommandApiError(400, errorBody)
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual(errorBody);
    });
  });

  describe("Local Request Validation (400 VALIDATION_FAILURE without upstream call)", () => {
    it("returns 400 VALIDATION_FAILURE on malformed JSON without calling upstream client", async () => {
      const request = new Request(routeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed json string"
      });

      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ReviewErrorResponse;
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(body.message).toMatch(/json/i);
      expect(submitReviewCommand).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_FAILURE when command schema is invalid without calling upstream client", async () => {
      const invalidCommand = {
        actionId: "not-a-valid-uuid",
        sceneId,
        expectedSpecRevision: -1,
        action: "unknown_action"
      };

      const request = createJsonRequest(routeUrl, invalidCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ReviewErrorResponse;
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(body.message).toMatch(/validation/i);
      expect(submitReviewCommand).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_FAILURE when route sceneId does not match body sceneId without calling upstream client", async () => {
      const mismatchedBody: ReviewCommand = {
        ...validApproveCommand,
        sceneId: "99999999-9999-9999-9999-999999999999"
      };

      const request = createJsonRequest(routeUrl, mismatchedBody);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ReviewErrorResponse;
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(body.message).toContain("does not match");
      expect(submitReviewCommand).not.toHaveBeenCalled();
    });
  });

  describe("Indeterminate Upstream Failures (5xx & Network Isolation)", () => {
    it("returns a generic 502 response without retrying or leaking internal network error text", async () => {
      const networkErrorMessage =
        "Failed to connect to Control API: connect ECONNREFUSED 127.0.0.1:3000 (internal secret host: https://internal-api.secret.cluster.local)";

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(new ApiClientError(networkErrorMessage));

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(502);
      expect(submitReviewCommand).toHaveBeenCalledTimes(1);

      const bodyText = await response.text();
      expect(bodyText).not.toContain("ECONNREFUSED");
      expect(bodyText).not.toContain("127.0.0.1:3000");
      expect(bodyText).not.toContain("internal-api.secret.cluster.local");
      expect(bodyText).not.toContain("Failed to connect");
    });

    it("returns a generic 502 response on upstream 500 / 502 HTTP error without retrying or leaking internal text", async () => {
      const upstreamErrorMessage =
        "Control API returned HTTP 500: Internal Server Error (PostgreSQL connection pool exhausted at postgresql://user:pass@db:5432/cco)";

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ApiClientError(upstreamErrorMessage, 500)
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(502);
      expect(submitReviewCommand).toHaveBeenCalledTimes(1);

      const bodyText = await response.text();
      expect(bodyText).not.toContain("PostgreSQL");
      expect(bodyText).not.toContain("postgresql://");
      expect(bodyText).not.toContain("connection pool exhausted");
    });

    it("returns a generic 502 response on upstream response validation failure without retrying or leaking internal text", async () => {
      const validationErrorMessage =
        "Control API response failed schema validation: invalid internal field structure in {" +
        '"secret_token": "xyz123"}';

      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new ApiValidationError(validationErrorMessage, [{ message: "secret_token leaked" }])
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(502);
      expect(submitReviewCommand).toHaveBeenCalledTimes(1);

      const bodyText = await response.text();
      expect(bodyText).not.toContain("secret_token");
      expect(bodyText).not.toContain("xyz123");
    });

    it("returns a generic 500 response on unexpected unhandled error without leaking internal text", async () => {
      vi.mocked(submitReviewCommand).mockRejectedValueOnce(
        new Error("Unexpected crash with database password supersecretpassword")
      );

      const request = createJsonRequest(routeUrl, validApproveCommand);
      const response = await POST(request, {
        params: Promise.resolve({ sceneId })
      });

      expect(response.status).toBe(500);
      expect(submitReviewCommand).toHaveBeenCalledTimes(1);

      const bodyText = await response.text();
      expect(bodyText).not.toContain("supersecretpassword");
      expect(bodyText).not.toContain("Unexpected crash");
    });
  });
});
