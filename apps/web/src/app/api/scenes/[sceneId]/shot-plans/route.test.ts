import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { POST } from "./route";
import {
  planShotPlans,
  ApiClientError,
  ApiValidationError,
  PlanShotPlansApiError
} from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import type { PlanShotPlansResponse, PlanShotPlansErrorResponse } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    planShotPlans: vi.fn()
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

describe("Shot Plans Route Handler: POST /api/scenes/[sceneId]/shot-plans", () => {
  const sceneId = "123e4567-e89b-12d3-a456-426614174000";
  const routeUrl = `http://localhost:3000/api/scenes/${sceneId}/shot-plans`;

  const defaultSuccessResponse: PlanShotPlansResponse = {
    sceneId,
    shotPlans: [
      {
        id: "01923456-789a-7b3c-9d4e-5f60718293a1",
        sceneId,
        specRevision: 1,
        variantOrdinal: 1,
        status: "draft",
        routingMode: "reference_directed",
        targetDurationMs: 4000,
        targetFrameCount: 97,
        durationToleranceMs: 355,
        fps: 24,
        framing: "wide",
        angle: "eye_level",
        lensIntent: "35mm prime",
        cameraPosition: "eye level",
        cameraMovement: "static",
        movementSpeed: "medium",
        cameraPromptDescription: "Static shot",
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
        createdAt: "2026-09-28T12:00:00.000Z",
        updatedAt: "2026-09-28T12:00:00.000Z"
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

  it("handles valid request with defaults (variantCount: 2, reroll: false)", async () => {
    vi.mocked(planShotPlans).mockResolvedValueOnce(defaultSuccessResponse);

    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(defaultSuccessResponse);
    expect(planShotPlans).toHaveBeenCalledWith(sceneId, {
      variantCount: 2,
      reroll: false
    });
  });

  it("returns 202 when upstream admits scene into generating_candidates", async () => {
    const admissionResponse: PlanShotPlansResponse = {
      sceneId,
      status: "generating_candidates",
      specRevision: 1,
      shotPlans: [],
      isIdempotentReplay: false
    };
    vi.mocked(planShotPlans).mockResolvedValueOnce(admissionResponse);

    const request = createJsonRequest(routeUrl, { variantCount: 2 });
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual(admissionResponse);
  });

  it("handles empty string body by defaulting to variantCount 2, reroll false", async () => {
    vi.mocked(planShotPlans).mockResolvedValueOnce(defaultSuccessResponse);

    const request = new Request(routeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(200);
    expect(planShotPlans).toHaveBeenCalledWith(sceneId, {
      variantCount: 2,
      reroll: false
    });
  });

  it("handles custom variantCount and reroll options", async () => {
    vi.mocked(planShotPlans).mockResolvedValueOnce(defaultSuccessResponse);

    const request = createJsonRequest(routeUrl, { variantCount: 4, reroll: true });
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(200);
    expect(planShotPlans).toHaveBeenCalledWith(sceneId, {
      variantCount: 4,
      reroll: true
    });
  });

  it("returns 400 VALIDATION_FAILURE on malformed JSON", async () => {
    const request = new Request(routeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not-json"
    });

    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toContain("Invalid JSON payload");
    expect(planShotPlans).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILURE when variantCount is invalid", async () => {
    const request = createJsonRequest(routeUrl, { variantCount: 10 });
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(planShotPlans).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILURE when externalProcessingPolicy is passed client-side", async () => {
    const request = createJsonRequest(routeUrl, {
      variantCount: 2,
      externalProcessingPolicy: { allowCloudPlanning: true }
    });
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(planShotPlans).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_FAILURE on invalid sceneId UUID", async () => {
    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId: "not-a-valid-uuid" })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(body.message).toContain("Invalid sceneId UUID");
    expect(planShotPlans).not.toHaveBeenCalled();
  });

  it("preserves 403 CLOUD_PLANNING_NOT_AUTHORIZED from upstream", async () => {
    const errorPayload: PlanShotPlansErrorResponse = {
      code: "CLOUD_PLANNING_NOT_AUTHORIZED",
      message: "allowCloudPlanning disabled"
    };
    vi.mocked(planShotPlans).mockRejectedValueOnce(new PlanShotPlansApiError(403, errorPayload));

    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual(errorPayload);
  });

  it("preserves 503 CONFIGURATION_ERROR from upstream", async () => {
    const errorPayload: PlanShotPlansErrorResponse = {
      code: "CONFIGURATION_ERROR",
      message: "Shot plan planning is not available; planning model clients are not configured."
    };
    vi.mocked(planShotPlans).mockRejectedValueOnce(new PlanShotPlansApiError(503, errorPayload));

    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual(errorPayload);
  });

  it("returns 502 Bad Gateway on upstream ApiClientError", async () => {
    vi.mocked(planShotPlans).mockRejectedValueOnce(
      new ApiClientError("Failed to connect to Control API", 502)
    );

    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ message: "Bad Gateway" });
  });

  it("returns 502 Bad Gateway on upstream ApiValidationError", async () => {
    vi.mocked(planShotPlans).mockRejectedValueOnce(
      new ApiValidationError("Response failed schema validation", [])
    );

    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ message: "Bad Gateway" });
  });

  it("returns 500 Internal Server Error on unexpected exceptions", async () => {
    vi.mocked(planShotPlans).mockRejectedValueOnce(new Error("Unexpected crash"));

    const request = createJsonRequest(routeUrl, {});
    const response = await POST(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ message: "Internal Server Error" });
  });
});
