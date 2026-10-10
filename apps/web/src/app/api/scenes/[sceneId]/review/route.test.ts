import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import {
  getSceneReviewDetail,
  ApiClientError,
  ApiValidationError
} from "../../../../../api/client";
import type * as ClientModule from "../../../../../api/client";
import type { SceneReviewDetailReadModel } from "@cco/contracts";

vi.mock("../../../../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getSceneReviewDetail: vi.fn()
  };
});

describe("Scene Review Route Handler: GET /api/scenes/[sceneId]/review", () => {
  const sceneId = "123e4567-e89b-12d3-a456-426614174000";
  const routeUrl = `http://localhost:3000/api/scenes/${sceneId}/review`;

  const mockDetail: Partial<SceneReviewDetailReadModel> = {
    sceneId,
    campaignId: "123e4567-e89b-12d3-a456-426614174001",
    status: "generating_candidates",
    specRevision: 1,
    shotPlans: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with scene review detail on success", async () => {
    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(mockDetail as SceneReviewDetailReadModel);

    const request = new Request(routeUrl);
    const response = await GET(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(mockDetail);
    expect(getSceneReviewDetail).toHaveBeenCalledWith(sceneId);
  });

  it("returns 400 when sceneId is not a valid UUID", async () => {
    const invalidSceneId = "invalid-uuid";
    const request = new Request(`http://localhost:3000/api/scenes/${invalidSceneId}/review`);
    const response = await GET(request, {
      params: Promise.resolve({ sceneId: invalidSceneId })
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILURE");
    expect(getSceneReviewDetail).not.toHaveBeenCalled();
  });

  it("returns 404 when upstream returns 404", async () => {
    vi.mocked(getSceneReviewDetail).mockRejectedValueOnce(
      new ApiClientError("Scene not found", 404)
    );

    const request = new Request(routeUrl);
    const response = await GET(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 502 when upstream throws ApiValidationError", async () => {
    vi.mocked(getSceneReviewDetail).mockRejectedValueOnce(
      new ApiValidationError("Validation failed", [])
    );

    const request = new Request(routeUrl);
    const response = await GET(request, {
      params: Promise.resolve({ sceneId })
    });

    expect(response.status).toBe(502);
  });
});
