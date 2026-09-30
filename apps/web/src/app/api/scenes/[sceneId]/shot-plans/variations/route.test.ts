import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import {
  createShotPlanVariation,
  ApiClientError,
  CreateShotPlanVariationApiError
} from "../../../../../../api/client";
import type * as ClientModule from "../../../../../../api/client";
import type {
  CreateShotPlanVariationResponse,
  CreateShotPlanVariationErrorResponse
} from "@cco/contracts";

vi.mock("../../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    createShotPlanVariation: vi.fn()
  };
});

function createJsonRequest(url: string, body?: unknown): Request {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

describe("Shot Plan Variations Route Handler: POST /api/scenes/[sceneId]/shot-plans/variations", () => {
  const sceneId = "123e4567-e89b-12d3-a456-426614174000";
  const sourceShotPlanId = "223e4567-e89b-12d3-a456-426614174000";
  const routeUrl = `http://localhost:3000/api/scenes/${sceneId}/shot-plans/variations`;

  const validPayload = {
    sourceShotPlanId,
    expectedSpecRevision: 1,
    directorGuidance: "Tighter 50mm shot with dolly in",
    variantCount: 1,
    idempotencyKey: "test-idem-key-1"
  };

  const defaultSuccessResponse: CreateShotPlanVariationResponse = {
    sceneId,
    sourceShotPlanId,
    shotPlans: [
      {
        id: "323e4567-e89b-12d3-a456-426614174000",
        sceneId,
        specRevision: 1,
        variantOrdinal: 2,
        derivedFromShotPlanId: sourceShotPlanId,
        derivation: {
          sourceShotPlanId,
          sourceVariantOrdinal: 1,
          directorGuidance: "Tighter 50mm shot with dolly in",
          provider: "mock-provider",
          machineModel: "mock-model",
          requestedAt: "2026-09-28T12:05:00.000Z"
        },
        status: "draft",
        routingMode: "reference_directed",
        targetDurationMs: 4000,
        targetFrameCount: 97,
        durationToleranceMs: 355,
        fps: 24,
        framing: "medium_close_up",
        angle: "eye_level",
        lensIntent: "50mm prime",
        cameraPosition: "eye level",
        cameraMovement: "dolly_in",
        movementSpeed: "slow",
        cameraPromptDescription: "Slow push in on 50mm lens",
        subjects: [],
        actionSummary: "Character enters scene",
        beats: [],
        lightingStyle: "high_key_commercial",
        environmentDescription: "Bright room",
        colorPalette: [],
        continuity: {
          frameAnchorTarget: "none",
          persistentSubjectIds: [],
          incomingContinuityFromSceneId: null,
          lightingContinuityNote: null,
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        createdAt: "2026-09-28T12:05:00.000Z",
        updatedAt: "2026-09-28T12:05:00.000Z"
      }
    ],
    isIdempotentReplay: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles valid variation request successfully", async () => {
    vi.mocked(createShotPlanVariation).mockResolvedValueOnce(defaultSuccessResponse);

    const request = createJsonRequest(routeUrl, validPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(defaultSuccessResponse);
    expect(createShotPlanVariation).toHaveBeenCalledWith(sceneId, validPayload);
  });

  it("returns 400 when request body contains invalid JSON", async () => {
    const request = new Request(routeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json"
    });

    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toContain("Invalid JSON");
  });

  it("returns 400 when guidance is empty", async () => {
    const invalidPayload = {
      ...validPayload,
      directorGuidance: "   "
    };

    const request = createJsonRequest(routeUrl, invalidPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toContain("directorGuidance");
  });

  it("returns 400 when sceneId is not a valid UUID", async () => {
    const request = createJsonRequest(routeUrl, validPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId: "invalid-uuid" })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toContain("Invalid sceneId UUID");
  });

  it("passes through CreateShotPlanVariationApiError (e.g. 404 source plan not found)", async () => {
    const errorResponse: CreateShotPlanVariationErrorResponse = {
      code: "SOURCE_SHOT_PLAN_NOT_FOUND",
      message: `Source shot plan ${sourceShotPlanId} not found`
    };
    vi.mocked(createShotPlanVariation).mockRejectedValueOnce(
      new CreateShotPlanVariationApiError(404, errorResponse)
    );

    const request = createJsonRequest(routeUrl, validPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual(errorResponse);
  });

  it("passes through 409 IDEMPOTENCY_CONFLICT", async () => {
    const errorResponse: CreateShotPlanVariationErrorResponse = {
      code: "IDEMPOTENCY_CONFLICT",
      message: "Conflicting request payload for idempotency key"
    };
    vi.mocked(createShotPlanVariation).mockRejectedValueOnce(
      new CreateShotPlanVariationApiError(409, errorResponse)
    );

    const request = createJsonRequest(routeUrl, validPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual(errorResponse);
  });

  it("returns 502 Bad Gateway when ApiClientError is thrown", async () => {
    vi.mocked(createShotPlanVariation).mockRejectedValueOnce(
      new ApiClientError("Network error", 503)
    );

    const request = createJsonRequest(routeUrl, validPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.message).toBe("Bad Gateway");
  });

  it("returns 500 on unexpected errors", async () => {
    vi.mocked(createShotPlanVariation).mockRejectedValueOnce(new Error("Boom"));

    const request = createJsonRequest(routeUrl, validPayload);
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.message).toBe("Internal Server Error");
  });
});
