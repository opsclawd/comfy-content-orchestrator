import { describe, expect, it } from "vitest";
import type {
  SceneReviewDetail,
  SceneReviewQueries,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import {
  CampaignReviewSummarySchema,
  SceneReviewDetailReadModelSchema,
  type CampaignReviewSummary,
  type ReviewErrorResponse
} from "@cco/contracts";
import type { CampaignId, CandidateId, SceneId } from "@cco/domain";
import type { FastifyRequest } from "fastify";
import { createControlApiApp } from "../app.js";
import type { ControlApiUseCases } from "../../index.js";

class FakeUnitOfWork implements UnitOfWork {
  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({
      scenes: { findById: async () => undefined, save: async () => {} },
      reviewEvents: { findById: async () => undefined, append: async () => {} },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      }
    });
  }
}

describe("Review Read Endpoints", () => {
  const campaignUuid = "8bf83226-f761-419b-a010-8b1b017b2b00";
  const sceneUuid = "d0728c3a-b892-4919-bb0d-587274092b3b";
  const candidateUuid1 = "3e590059-cb14-41d6-b5fa-28498897ee22";
  const candidateUuid2 = "7709eeae-377c-4743-bcf2-b2586a11e130";

  const sampleSummary: CampaignReviewSummary = {
    campaignId: campaignUuid,
    campaignName: "Spring Campaign",
    totalScenes: 5,
    scenesByStatus: {
      director_review: 2,
      approved: 2,
      completed: 1
    },
    pendingReviewCount: 2,
    approvedCount: 2,
    completedCount: 1,
    updatedAt: "2026-08-18T12:00:00.000Z"
  };

  const sampleDetail: SceneReviewDetail = {
    sceneId: sceneUuid as SceneId,
    campaignId: campaignUuid as CampaignId,
    status: "director_review",
    specRevision: 2,
    configuration: {
      prompt: "A cinematic shot of a mountain sunrise",
      referenceIds: ["ref-1"],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: "lora-initial"
    },
    selectedCandidateId: candidateUuid2 as CandidateId,
    selectedCandidateRevision: 2,
    candidatesByRevision: [
      {
        specRevision: 1,
        candidates: [
          {
            id: candidateUuid1 as CandidateId,
            sceneId: sceneUuid as SceneId,
            specRevision: 1,
            variantOrdinal: 1,
            locator: "minio://bucket/c1.mp4",
            contentHash: "hash-c1",
            generationMetadata: { seed: 123 },
            createdAt: "2026-08-18T10:00:00.000Z"
          }
        ]
      },
      {
        specRevision: 2,
        candidates: [
          {
            id: candidateUuid2 as CandidateId,
            sceneId: sceneUuid as SceneId,
            specRevision: 2,
            variantOrdinal: 1,
            locator: "minio://bucket/c2.mp4",
            contentHash: "hash-c2",
            generationMetadata: { seed: 456 },
            createdAt: "2026-08-18T11:00:00.000Z"
          }
        ]
      }
    ],
    allowedActions: ["approve", "reject", "reroll", "candidate_select"]
  };

  it("GET /api/campaigns/:campaignId/review-summary returns 200 with summary when found", async () => {
    const sceneReviewQueries: SceneReviewQueries = {
      async getCampaignReviewSummary(campaignId: CampaignId) {
        if (campaignId === campaignUuid) {
          return sampleSummary;
        }
        return undefined;
      },
      async getSceneReviewDetail() {
        return undefined;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignUuid}/review-summary`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = CampaignReviewSummarySchema.safeParse(body);
    expect(parsed.success).toBe(true);
    expect(body).toEqual(sampleSummary);
  });

  it("GET /api/campaigns/:campaignId/review-summary returns 404 when not found", async () => {
    const sceneReviewQueries: SceneReviewQueries = {
      async getCampaignReviewSummary() {
        return undefined;
      },
      async getSceneReviewDetail() {
        return undefined;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/00000000-0000-0000-0000-000000000000/review-summary`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBeDefined();
  });

  it("GET /api/scenes/:sceneId/review returns 200 with full read model when found", async () => {
    const sceneReviewQueries: SceneReviewQueries = {
      async getCampaignReviewSummary() {
        return undefined;
      },
      async getSceneReviewDetail(sceneId: SceneId) {
        if (sceneId === sceneUuid) {
          return sampleDetail;
        }
        return undefined;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneUuid}/review`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = SceneReviewDetailReadModelSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    expect(body.sceneId).toBe(sceneUuid);
    expect(body.campaignId).toBe(campaignUuid);
    expect(body.status).toBe("director_review");
    expect(body.specRevision).toBe(2);
    expect(body.selectedCandidateId).toBe(candidateUuid2);
    expect(body.selectedCandidateRevision).toBe(2);
    expect(body.allowedActions).toEqual(["approve", "reject", "reroll", "candidate_select"]);

    // Verify candidates are mapped with media: { available: false }
    expect(body.candidatesByRevision).toHaveLength(2);
    expect(body.candidatesByRevision[0]).toEqual({
      specRevision: 1,
      candidates: [
        {
          candidateId: candidateUuid1,
          sceneId: sceneUuid,
          specRevision: 1,
          variantOrdinal: 1,
          contentHash: "hash-c1",
          media: { available: false },
          generationMetadata: { seed: 123 },
          createdAt: "2026-08-18T10:00:00.000Z"
        }
      ]
    });
    expect(body.candidatesByRevision[1]).toEqual({
      specRevision: 2,
      candidates: [
        {
          candidateId: candidateUuid2,
          sceneId: sceneUuid,
          specRevision: 2,
          variantOrdinal: 1,
          contentHash: "hash-c2",
          media: { available: false },
          generationMetadata: { seed: 456 },
          createdAt: "2026-08-18T11:00:00.000Z"
        }
      ]
    });
  });

  it("GET /api/scenes/:sceneId/review returns 404 when not found", async () => {
    const sceneReviewQueries: SceneReviewQueries = {
      async getCampaignReviewSummary() {
        return undefined;
      },
      async getSceneReviewDetail() {
        return undefined;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/00000000-0000-0000-0000-000000000000/review`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBeDefined();
  });

  it("GET /api/campaigns/:campaignId/review-summary returns 404 when sceneReviewQueries is absent", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignUuid}/review-summary`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain("review summary was not found");
  });

  it("GET /api/scenes/:sceneId/review returns 404 when sceneReviewQueries is absent", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneUuid}/review`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toContain("review detail was not found");
  });

  it("GET /api/campaigns/:campaignId/review-summary rejects invalid campaignId format with 400", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/not-a-uuid/review-summary`
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("GET /api/scenes/:sceneId/review rejects invalid sceneId format with 400", async () => {
    const app = createControlApiApp({
      uow: new FakeUnitOfWork()
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/invalid-uuid-scene/review`
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("VALIDATION_FAILURE");
  });

  it("accepts an existing ControlApiContainer directly", async () => {
    const sceneReviewQueries: SceneReviewQueries = {
      async getCampaignReviewSummary(campaignId: CampaignId) {
        if (campaignId === campaignUuid) {
          return sampleSummary;
        }
        return undefined;
      },
      async getSceneReviewDetail() {
        return undefined;
      }
    };

    const container = {
      dependencies: {
        uow: new FakeUnitOfWork(),
        sceneReviewQueries
      },
      useCases: {
        reviewScene: {} as unknown as ControlApiUseCases["reviewScene"],
        progressSceneProduction: {} as unknown as ControlApiUseCases["progressSceneProduction"]
      },
      queries: {
        sceneReview: sceneReviewQueries
      }
    };

    const app = createControlApiApp(container);

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaignUuid}/review-summary`
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(sampleSummary);
  });

  describe("Error Mapping & Types", () => {
    it("maps domain and application errors to HTTP status and ReviewErrorResponse format", async () => {
      const {
        SceneNotFoundError,
        CandidateNotFoundError,
        StaleRevisionConflictError,
        IdempotencyConflictError
      } = await import("@cco/application");
      const {
        InvalidTransitionError,
        InvalidMutationError,
        InvalidCandidateError,
        TerminalStateError
      } = await import("@cco/domain");
      const { z } = await import("zod");
      const { formatReviewError } = await import("../errors.js");
      const { defaultReviewerIdentityResolver, defaultClock } = await import("../types.js");

      expect(defaultReviewerIdentityResolver.resolve({} as unknown as FastifyRequest)).toBe(
        "Thomas Cumberbatch"
      );
      expect(typeof defaultClock.now()).toBe("string");

      const sceneNotFound = formatReviewError(new SceneNotFoundError("s-1"));
      expect(sceneNotFound.statusCode).toBe(404);
      expect(sceneNotFound.body).toEqual({
        code: "NOT_FOUND",
        message: "Scene 's-1' was not found."
      });

      const candNotFound = formatReviewError(new CandidateNotFoundError("c-1"));
      expect(candNotFound.statusCode).toBe(404);
      expect(candNotFound.body).toEqual({
        code: "NOT_FOUND",
        message: "Candidate 'c-1' was not found."
      });

      const staleRev = formatReviewError(new StaleRevisionConflictError("s-1", 1, 2));
      expect(staleRev.statusCode).toBe(409);
      expect(staleRev.body).toEqual({
        code: "STALE_REVISION_CONFLICT",
        message:
          "Stale revision conflict for scene 's-1': expected spec revision 1, but current revision is 2."
      });

      const idempConflict = formatReviewError(new IdempotencyConflictError("e-1"));
      expect(idempConflict.statusCode).toBe(409);
      expect(idempConflict.body).toEqual({
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Idempotency conflict for action ID 'e-1': action ID was already processed with a different request payload hash."
      });

      const invTrans = formatReviewError(
        new InvalidTransitionError("s-1" as SceneId, "draft_pending", "approve")
      );
      expect(invTrans.statusCode).toBe(422);
      expect(invTrans.body).toEqual({
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Cannot perform 'approve' on scene 's-1' with status 'draft_pending'."
      });

      const invMut = formatReviewError(
        new InvalidMutationError("s-1" as SceneId, "completed", "prompt")
      );
      expect(invMut.statusCode).toBe(422);
      expect(invMut.body).toEqual({
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Cannot mutate 'prompt' on scene 's-1' in status 'completed'."
      });

      const invCand = formatReviewError(
        new InvalidCandidateError("s-1" as SceneId, "c-1" as CandidateId, "spec revision mismatch")
      );
      expect(invCand.statusCode).toBe(422);
      expect(invCand.body).toEqual({
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Candidate 'c-1' is invalid for scene 's-1': spec revision mismatch"
      });

      const termState = formatReviewError(
        new TerminalStateError("s-1" as SceneId, "completed", "reroll")
      );
      expect(termState.statusCode).toBe(422);
      expect(termState.body).toEqual({
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Cannot perform 'reroll' on scene 's-1' in terminal state 'completed'."
      });

      const zodResult = z.string().safeParse(123);
      if (!zodResult.success) {
        const zodErr = formatReviewError(zodResult.error);
        expect(zodErr.statusCode).toBe(400);
        expect((zodErr.body as ReviewErrorResponse).code).toBe("VALIDATION_FAILURE");
      }

      const genericErr = formatReviewError(new Error("Database connection dropped"));
      expect(genericErr.statusCode).toBe(500);
      expect(genericErr.body).toEqual({ message: "Internal Server Error" });
    });
  });
});
