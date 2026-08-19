import { describe, expect, it } from "vitest";
import { Scene, type CampaignId, type CandidateId, type SceneId } from "@cco/domain";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { IdempotencyConflictError } from "./idempotency-conflict-error.js";
import { ReviewSceneUseCases } from "./review-scene.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";

describe("ReviewSceneUseCases - Concurrency & Idempotency", () => {
  const createReviewScene = (id: string = "scene-1"): Scene => {
    const scene = Scene.create({
      id: id as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A cinematic shot of a mountain sunrise",
        referenceIds: ["ref-1"],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate("cand-1" as CandidateId, 1, id as SceneId);
    return scene;
  };

  it("throws StaleRevisionConflictError when expectedSpecRevision mismatches current scene revision", async () => {
    const scene = createReviewScene("scene-stale-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    await expect(
      useCases.approve({
        sceneId: "scene-stale-1",
        eventId: "event-stale-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        expectedSpecRevision: 999
      })
    ).rejects.toThrow(StaleRevisionConflictError);

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("returns isIdempotentReplay: true when action ID exists with matching requestHashSha256", async () => {
    const scene = createReviewScene("scene-idemp-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    const input = {
      sceneId: "scene-idemp-1",
      eventId: "event-idemp-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      expectedSpecRevision: 1,
      requestHashSha256: "a".repeat(64)
    };

    const firstResult = await useCases.approve(input);
    expect(firstResult.isIdempotentReplay).toBe(false);
    expect(firstResult.scene.status).toBe("approved");
    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.reviewEvents).toHaveLength(1);

    const replayResult = await useCases.approve(input);
    expect(replayResult.isIdempotentReplay).toBe(true);
    expect(replayResult.scene.status).toBe("approved");
    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.reviewEvents).toHaveLength(1);
  });

  it("throws IdempotencyConflictError when action ID exists with different requestHashSha256", async () => {
    const scene = createReviewScene("scene-conflict-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.approve({
      sceneId: "scene-conflict-1",
      eventId: "event-conflict-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      expectedSpecRevision: 1,
      requestHashSha256: "a".repeat(64)
    });

    await expect(
      useCases.approve({
        sceneId: "scene-conflict-1",
        eventId: "event-conflict-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        expectedSpecRevision: 1,
        requestHashSha256: "b".repeat(64)
      })
    ).rejects.toThrow(IdempotencyConflictError);

    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.reviewEvents).toHaveLength(1);
  });

  it("returns isIdempotentReplay: false and persists scene and event on fresh review action", async () => {
    const scene = createReviewScene("scene-fresh-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    const result = await useCases.approve({
      sceneId: "scene-fresh-1",
      eventId: "event-fresh-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      expectedSpecRevision: 1,
      requestHashSha256: "c".repeat(64)
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scene.status).toBe("approved");
    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.reviewEvents).toHaveLength(1);
  });

  it("selectCandidate: throws StaleRevisionConflictError on expectedSpecRevision mismatch", async () => {
    const scene = createReviewScene("scene-cand-stale");
    const candidate = {
      id: "cand-1" as CandidateId,
      sceneId: "scene-cand-stale" as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "loc/cand-1.webp",
      contentHash: "hash-1",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    };
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const useCases = new ReviewSceneUseCases(uow);

    await expect(
      useCases.selectCandidate({
        sceneId: "scene-cand-stale",
        eventId: "event-cand-stale",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "cand-1" as CandidateId,
        expectedSpecRevision: 42
      })
    ).rejects.toThrow(StaleRevisionConflictError);

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("selectCandidate: handles idempotent replay with matching hash and detects conflict with mismatching hash", async () => {
    const scene = createReviewScene("scene-cand-idemp");
    const candidate = {
      id: "cand-1" as CandidateId,
      sceneId: "scene-cand-idemp" as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "loc/cand-1.webp",
      contentHash: "hash-1",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    };
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const useCases = new ReviewSceneUseCases(uow);

    const firstResult = await useCases.selectCandidate({
      sceneId: "scene-cand-idemp",
      eventId: "event-cand-idemp",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      candidateId: "cand-1" as CandidateId,
      expectedSpecRevision: 1,
      requestHashSha256: "d".repeat(64)
    });
    expect(firstResult.isIdempotentReplay).toBe(false);
    expect(firstResult.scene.selectedCandidateId).toBe("cand-1");

    const replayResult = await useCases.selectCandidate({
      sceneId: "scene-cand-idemp",
      eventId: "event-cand-idemp",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      candidateId: "cand-1" as CandidateId,
      expectedSpecRevision: 1,
      requestHashSha256: "d".repeat(64)
    });
    expect(replayResult.isIdempotentReplay).toBe(true);
    expect(replayResult.scene.selectedCandidateId).toBe("cand-1");

    await expect(
      useCases.selectCandidate({
        sceneId: "scene-cand-idemp",
        eventId: "event-cand-idemp",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "cand-1" as CandidateId,
        expectedSpecRevision: 1,
        requestHashSha256: "e".repeat(64)
      })
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("throws IdempotencyConflictError when action ID exists with mismatched sceneId", async () => {
    const scene1 = createReviewScene("scene-cross-1");
    const scene2 = createReviewScene("scene-cross-2");
    const uow = new InMemorySceneUnitOfWork([scene1, scene2]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.approve({
      sceneId: "scene-cross-1",
      eventId: "event-cross-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      expectedSpecRevision: 1,
      requestHashSha256: "a".repeat(64)
    });

    await expect(
      useCases.approve({
        sceneId: "scene-cross-2",
        eventId: "event-cross-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        expectedSpecRevision: 1,
        requestHashSha256: "a".repeat(64)
      })
    ).rejects.toThrow(IdempotencyConflictError);

    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.savedScenes[0]!.id).toBe("scene-cross-1");
  });

  it("throws IdempotencyConflictError when replay omits requestHashSha256 but original event had a hash", async () => {
    const scene = createReviewScene("scene-hash-omit");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.approve({
      sceneId: "scene-hash-omit",
      eventId: "event-hash-omit-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      expectedSpecRevision: 1,
      requestHashSha256: "a".repeat(64)
    });

    await expect(
      useCases.approve({
        sceneId: "scene-hash-omit",
        eventId: "event-hash-omit-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        expectedSpecRevision: 1
      })
    ).rejects.toThrow(IdempotencyConflictError);

    expect(uow.savedScenes).toHaveLength(1);
  });

  it("throws IdempotencyConflictError when replay provides requestHashSha256 but original event had no hash", async () => {
    const scene = createReviewScene("scene-hash-add");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.approve({
      sceneId: "scene-hash-add",
      eventId: "event-hash-add-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      expectedSpecRevision: 1
    });

    await expect(
      useCases.approve({
        sceneId: "scene-hash-add",
        eventId: "event-hash-add-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        expectedSpecRevision: 1,
        requestHashSha256: "a".repeat(64)
      })
    ).rejects.toThrow(IdempotencyConflictError);

    expect(uow.savedScenes).toHaveLength(1);
  });

  it("selectCandidate: throws IdempotencyConflictError on mismatched sceneId", async () => {
    const scene1 = createReviewScene("scene-cand-cross-1");
    const scene2 = createReviewScene("scene-cand-cross-2");
    const candidate1 = {
      id: "cand-1" as CandidateId,
      sceneId: "scene-cand-cross-1" as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "loc/cand-1.webp",
      contentHash: "hash-1",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    };
    const candidate2 = {
      id: "cand-2" as CandidateId,
      sceneId: "scene-cand-cross-2" as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "loc/cand-2.webp",
      contentHash: "hash-2",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    };
    const uow = new InMemorySceneUnitOfWork([scene1, scene2], [candidate1, candidate2]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.selectCandidate({
      sceneId: "scene-cand-cross-1",
      eventId: "event-cand-cross-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      candidateId: "cand-1" as CandidateId,
      expectedSpecRevision: 1,
      requestHashSha256: "c".repeat(64)
    });

    await expect(
      useCases.selectCandidate({
        sceneId: "scene-cand-cross-2",
        eventId: "event-cand-cross-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "cand-2" as CandidateId,
        expectedSpecRevision: 1,
        requestHashSha256: "c".repeat(64)
      })
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("selectCandidate: throws IdempotencyConflictError when replay omits requestHashSha256", async () => {
    const scene = createReviewScene("scene-cand-hash-omit");
    const candidate = {
      id: "cand-1" as CandidateId,
      sceneId: "scene-cand-hash-omit" as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "loc/cand-1.webp",
      contentHash: "hash-1",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    };
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.selectCandidate({
      sceneId: "scene-cand-hash-omit",
      eventId: "event-cand-hash-omit-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      candidateId: "cand-1" as CandidateId,
      expectedSpecRevision: 1,
      requestHashSha256: "d".repeat(64)
    });

    await expect(
      useCases.selectCandidate({
        sceneId: "scene-cand-hash-omit",
        eventId: "event-cand-hash-omit-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "cand-1" as CandidateId,
        expectedSpecRevision: 1
      })
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("recognizes pre-seeded review events in InMemorySceneUnitOfWork", async () => {
    const scene = createReviewScene("scene-seeded-1");
    const seededEvent = {
      eventId: "event-seeded-1",
      sceneId: "scene-seeded-1",
      reviewerName: "Director Alice",
      action: "approve" as const,
      mutationPayload: {},
      priorSceneStatus: "director_review" as const,
      resultingSceneStatus: "approved" as const,
      requestHashSha256: "f".repeat(64),
      occurredAt: "2026-08-15T01:00:00.000Z"
    };

    const uow = new InMemorySceneUnitOfWork([scene], [], [seededEvent]);
    const useCases = new ReviewSceneUseCases(uow);

    const replayResult = await useCases.approve({
      sceneId: "scene-seeded-1",
      eventId: "event-seeded-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      requestHashSha256: "f".repeat(64)
    });

    expect(replayResult.isIdempotentReplay).toBe(true);
    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });
});
