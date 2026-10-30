import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  PrevisBeatNotFoundError,
  StalePrevisCandidateConflictError,
  type RerollPrevisBeatUseCase
} from "@cco/application";
import { handleReviewError } from "../errors.js";
import { sceneGenerationRoutes } from "./scene-generation-routes.js";
import type { ControlApiContainer } from "../types.js";

const sceneId = "11111111-1111-4111-8111-111111111111";
const shotPlanId = "22222222-2222-4222-8222-222222222222";
const candidateId = "33333333-3333-4333-8333-333333333333";
const url = `/api/scenes/${sceneId}/shot-plans/${shotPlanId}/beats/2/previs-reroll`;

async function build(execute: ReturnType<typeof vi.fn>) {
  const app = Fastify();
  app.setErrorHandler(handleReviewError);
  const container = {
    useCases: { rerollPrevisBeat: { execute } as unknown as RerollPrevisBeatUseCase }
  } as unknown as ControlApiContainer;
  await app.register(sceneGenerationRoutes, { container });
  return app;
}

describe("POST previs-reroll", () => {
  it("returns 202 with the enqueued job", async () => {
    const execute = vi.fn().mockResolvedValue({
      jobId: "job-1",
      sceneId,
      shotPlanId,
      beatIndex: 2,
      seed: 123456
    });
    const app = await build(execute);
    const res = await app.inject({
      method: "POST",
      url,
      payload: { expectedCandidateId: candidateId }
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ jobId: "job-1", seed: 123456, beatIndex: 2 });
    expect(execute).toHaveBeenCalledWith({
      sceneId,
      shotPlanId,
      beatIndex: 2,
      expectedCandidateId: candidateId
    });
  });

  it("maps a stale candidate to 409", async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(
        new StalePrevisCandidateConflictError(shotPlanId, 2, candidateId, undefined)
      );
    const app = await build(execute);
    const res = await app.inject({
      method: "POST",
      url,
      payload: { expectedCandidateId: candidateId }
    });
    expect(res.statusCode).toBe(409);
  });

  it("maps an unknown beat to 404", async () => {
    const execute = vi.fn().mockRejectedValue(new PrevisBeatNotFoundError(shotPlanId, 2));
    const app = await build(execute);
    const res = await app.inject({
      method: "POST",
      url,
      payload: { expectedCandidateId: candidateId }
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a malformed body", async () => {
    const execute = vi.fn();
    const app = await build(execute);
    const res = await app.inject({
      method: "POST",
      url,
      payload: { expectedCandidateId: "nope", extra: 1 }
    });
    expect(res.statusCode).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
