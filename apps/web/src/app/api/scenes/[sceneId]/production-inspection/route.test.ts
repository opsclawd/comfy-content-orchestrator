import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { ApiClientError, getSceneProductionInspection } from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import type { H3ProductionInspectionReadModel } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getSceneProductionInspection: vi.fn()
  };
});

describe("GET /api/scenes/[sceneId]/production-inspection", () => {
  const sceneId = "11111111-1111-4111-8111-111111111111";
  const shotPlanId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockInspection: H3ProductionInspectionReadModel = {
    authority: {
      sceneId,
      specRevision: 1,
      shotPlanId,
      variantOrdinal: 1,
      shotPlanStatus: "approved",
      isCurrentRevision: true
    },
    route: {
      routingMode: "reference_directed",
      renderProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
      workflowTemplate: "minimax-h3-720p-124f-ref2v",
      targetDurationMs: 5000,
      targetFrameCount: 124,
      fps: 24,
      width: 1344,
      height: 768
    },
    visualInputs: {
      references: [],
      frameAnchor: null
    },
    instruction: {
      compiledText: "Test instruction",
      compiledSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      cameraIntentSummary: {
        framing: "wide",
        angle: "eye_level",
        cameraMovement: "static",
        movementSpeed: "slow",
        lensIntent: "35mm",
        cameraPosition: "eye level",
        cameraPromptDescription: "Static wide shot"
      }
    },
    admission: {
      readiness: "ready",
      blockers: []
    },
    runtimeContext: {
      durationCeilingSeconds: 60
    },
    productionInputFingerprint: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
  };

  it("returns 200 with inspection read model when found", async () => {
    vi.mocked(getSceneProductionInspection).mockResolvedValueOnce(mockInspection);

    const request = new Request(
      `http://localhost:3000/api/scenes/${sceneId}/production-inspection?shotPlanId=${shotPlanId}`
    );
    const response = await GET(request, { params: Promise.resolve({ sceneId }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockInspection);
    expect(getSceneProductionInspection).toHaveBeenCalledWith(sceneId, shotPlanId);
  });

  it("returns 400 for invalid sceneId UUID", async () => {
    const request = new Request(
      "http://localhost:3000/api/scenes/invalid-uuid/production-inspection"
    );
    const response = await GET(request, { params: Promise.resolve({ sceneId: "invalid-uuid" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 400 for invalid shotPlanId UUID", async () => {
    const request = new Request(
      `http://localhost:3000/api/scenes/${sceneId}/production-inspection?shotPlanId=bad-plan`
    );
    const response = await GET(request, { params: Promise.resolve({ sceneId }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("returns 404 when inspection is not found", async () => {
    vi.mocked(getSceneProductionInspection).mockRejectedValueOnce(
      new ApiClientError("Not found", 404)
    );

    const request = new Request(
      `http://localhost:3000/api/scenes/${sceneId}/production-inspection`
    );
    const response = await GET(request, { params: Promise.resolve({ sceneId }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 502 when upstream fails", async () => {
    vi.mocked(getSceneProductionInspection).mockRejectedValueOnce(
      new ApiClientError("Upstream error", 502)
    );

    const request = new Request(
      `http://localhost:3000/api/scenes/${sceneId}/production-inspection`
    );
    const response = await GET(request, { params: Promise.resolve({ sceneId }) });

    expect(response.status).toBe(502);
  });
});
