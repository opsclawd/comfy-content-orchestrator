import { describe, expect, it } from "vitest";
import type {
  PersistentObjectLocator,
  ReviewMediaDeliveryPort,
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
    scenes: [
      {
        sceneId: sceneUuid,
        status: "director_review",
        specRevision: 2
      }
    ],
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
            storageBucket: "bucket",
            storageObjectKey: "c1.mp4",
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
            storageBucket: "bucket",
            storageObjectKey: "c2.mp4",
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

  it("GET /api/scenes/:sceneId/review returns 200 with media available: true and signed URL when delivery port succeeds", async () => {
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

    const reviewMediaDelivery: ReviewMediaDeliveryPort = {
      async generatePresignedReadUrl(locator: PersistentObjectLocator) {
        return `https://storage.local/${locator.bucket}/${locator.key}?sig=${locator.contentHash}`;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneUuid}/review`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = SceneReviewDetailReadModelSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    expect(body.candidatesByRevision[0].candidates[0].media).toEqual({
      available: true,
      url: "https://storage.local/bucket/c1.mp4?sig=hash-c1"
    });
    expect(body.candidatesByRevision[1].candidates[0].media).toEqual({
      available: true,
      url: "https://storage.local/bucket/c2.mp4?sig=hash-c2"
    });
  });

  it("GET /api/scenes/:sceneId/review falls back to media available: false when delivery port throws (missing object)", async () => {
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

    const reviewMediaDelivery: ReviewMediaDeliveryPort = {
      async generatePresignedReadUrl(locator: PersistentObjectLocator) {
        if (locator.key === "c1.mp4") {
          throw new Error("Object not found in storage bucket");
        }
        return `https://storage.local/${locator.bucket}/${locator.key}?sig=${locator.contentHash}`;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneUuid}/review`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = SceneReviewDetailReadModelSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const c1Media = body.candidatesByRevision[0].candidates[0].media;
    expect(c1Media.available).toBe(false);
    expect(c1Media.url).toBeUndefined();
    expect(c1Media).toEqual({ available: false });

    const c2Media = body.candidatesByRevision[1].candidates[0].media;
    expect(c2Media).toEqual({
      available: true,
      url: "https://storage.local/bucket/c2.mp4?sig=hash-c2"
    });
  });

  it("GET /api/scenes/:sceneId/review defaults to available: false when reviewMediaDelivery dependency is not provided", async () => {
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

    for (const group of body.candidatesByRevision) {
      for (const candidate of group.candidates) {
        expect(candidate.media).toEqual({ available: false });
        expect(candidate.media.url).toBeUndefined();
      }
    }
  });

  it("ensures available flag and url presence are structurally consistent", async () => {
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

    const reviewMediaDelivery: ReviewMediaDeliveryPort = {
      async generatePresignedReadUrl(locator: PersistentObjectLocator) {
        if (locator.key === "c1.mp4") {
          throw new Error("Missing");
        }
        return `https://storage.local/${locator.bucket}/${locator.key}`;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneUuid}/review`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(SceneReviewDetailReadModelSchema.safeParse(body).success).toBe(true);

    const cand1 = body.candidatesByRevision[0].candidates[0];
    const cand2 = body.candidatesByRevision[1].candidates[0];

    // available: false never contains a url property
    expect(cand1.media.available).toBe(false);
    expect("url" in cand1.media).toBe(false);

    // available: true always contains a non-empty string url property
    expect(cand2.media.available).toBe(true);
    expect(typeof cand2.media.url).toBe("string");
    expect(cand2.media.url.length).toBeGreaterThan(0);
  });

  it("presigns all candidates across revisions concurrently", async () => {
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

    let activeSigningCalls = 0;
    let maxConcurrentSigningCalls = 0;

    const reviewMediaDelivery: ReviewMediaDeliveryPort = {
      async generatePresignedReadUrl(locator: PersistentObjectLocator) {
        activeSigningCalls++;
        if (activeSigningCalls > maxConcurrentSigningCalls) {
          maxConcurrentSigningCalls = activeSigningCalls;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
        activeSigningCalls--;
        return `https://storage.local/${locator.bucket}/${locator.key}`;
      }
    };

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneUuid}/review`
    });

    expect(response.statusCode).toBe(200);
    expect(maxConcurrentSigningCalls).toBe(2);
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
      const { defaultClock } = await import("../types.js");

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
          "Stale revision conflict for scene 's-1': expected spec revision 1, but current revision is 2.",
        details: {
          expectedRevision: 1,
          currentRevision: 2
        }
      });

      const idempConflict = formatReviewError(new IdempotencyConflictError("e-1"));
      expect(idempConflict.statusCode).toBe(409);
      expect(idempConflict.body).toEqual({
        code: "IDEMPOTENCY_CONFLICT",
        message:
          "Idempotency conflict for action ID 'e-1': action ID was already processed with a different request payload hash.",
        details: {
          actionId: "e-1"
        }
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
