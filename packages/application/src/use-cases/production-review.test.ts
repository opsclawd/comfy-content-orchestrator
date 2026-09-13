import { describe, expect, it } from "vitest";
import {
  AlreadyAcceptedProductionAttemptError,
  InvalidTransitionError,
  Scene,
  type CampaignId,
  type CampaignProductionRunRecord,
  type CandidateId,
  type SceneId
} from "@cco/domain";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { EnqueueSceneProductionRenderUseCase } from "./enqueue-scene-production-render.js";
import { ProductionReviewUseCases } from "./production-review.js";
import { SceneNotInProductionRunError } from "./scene-not-in-production-run-error.js";
import { StaleProductionAttemptConflictError } from "./stale-production-attempt-conflict-error.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";

describe("ProductionReviewUseCases", () => {
  const createQAScene = (sceneId: string = "scene-qa-1", jobId: string = "job-prod-1"): Scene => {
    const scene = Scene.create({
      id: sceneId as SceneId,
      campaignId: "camp-1" as CampaignId,
      configuration: {
        prompt: "Epic mountain landscape at dawn",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 4042
      }
    });

    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate("cand-1" as CandidateId, 1, scene.id);
    scene.approve({
      approvedBy: "Director Dave",
      approvedAt: "2026-09-01T10:00:00.000Z"
    });
    scene.queueForProduction(jobId);
    scene.startRendering();
    scene.submitForQA();

    return scene;
  };

  const setupTestContext = (scene: Scene, initialJobId: string = "job-prod-1") => {
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const runRecord = {
      id: "run-1",
      campaignId: "camp-1" as CampaignId,
      fingerprint: "fp-1",
      status: "dispatched" as const,
      expectedTotalDurationMs: 8084,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    uow.seedCampaignProductionRun(runRecord);

    const initialAttempt = {
      attemptId: "attempt-1",
      sceneId: scene.id,
      runId: "run-1",
      ordinal: 1,
      productionJobId: initialJobId,
      specRevision: 1,
      seed: 42,
      createdReason: "initial_dispatch" as const,
      createdAt: new Date().toISOString()
    };
    uow.seedProductionAttempt(initialAttempt);

    uow.seedCampaignProductionRunScenes([
      {
        runId: "run-1",
        sceneId: scene.id,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4042,
        productionJobId: initialJobId,
        currentAttemptId: "attempt-1",
        currentAttemptOrdinal: 1
      },
      {
        runId: "run-1",
        sceneId: "scene-pending-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4042,
        productionJobId: "job-pending-2",
        currentAttemptId: "attempt-pending-2",
        currentAttemptOrdinal: 1
      }
    ]);

    const enqueue = new EnqueueSceneProductionRenderUseCase(uow);
    const useCases = new ProductionReviewUseCases(uow, enqueue);

    return { uow, queue, useCases, runRecord, initialAttempt };
  };

  describe("acceptProduction", () => {
    it("successfully accepts production attempt: marks scene completed, stores accepted attempt, and logs review event", async () => {
      const scene = createQAScene("scene-1", "job-prod-1");
      const { uow, useCases } = setupTestContext(scene, "job-prod-1");

      const result = await useCases.acceptProduction({
        sceneId: "scene-1",
        eventId: "evt-accept-1",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1",
        directorNotes: "Flawless render!"
      });

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.scene.status).toBe("completed");
      expect(result.scene.acceptedProductionAttemptId).toBe("attempt-1");
      expect(result.acceptedAttemptOrdinal).toBe(1);

      // Verify campaign production run scene has accepted attempt recorded
      const runScene = await uow.campaignProductionRuns.findRunSceneBySceneId("scene-1");
      expect(runScene?.acceptedAttemptId).toBe("attempt-1");
      expect(runScene?.acceptedAttemptOrdinal).toBe(1);
      expect(runScene?.acceptedProductionJobId).toBe("job-prod-1");

      // Verify review event was appended
      const savedEvents = uow.reviewEvents;
      expect(savedEvents).toHaveLength(1);
      const event = savedEvents[0]!;
      expect(event.action).toBe("production_accept");
      expect(event.sceneId).toBe("scene-1");
      expect(event.priorSceneStatus).toBe("qa");
      expect(event.resultingSceneStatus).toBe("completed");
      expect(event.directorNotes).toBe("Flawless render!");
      expect(event.mutationPayload).toEqual({
        acceptedAttemptId: "attempt-1",
        acceptedAttemptOrdinal: 1,
        productionJobId: "job-prod-1"
      });
    });

    it("returns idempotent replay when called repeatedly with the same eventId", async () => {
      const scene = createQAScene("scene-idem", "job-prod-1");
      const { useCases } = setupTestContext(scene, "job-prod-1");

      const first = await useCases.acceptProduction({
        sceneId: "scene-idem",
        eventId: "evt-idem-1",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1"
      });
      expect(first.isIdempotentReplay).toBe(false);

      const second = await useCases.acceptProduction({
        sceneId: "scene-idem",
        eventId: "evt-idem-1",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1"
      });
      expect(second.isIdempotentReplay).toBe(true);
      expect(second.scene.status).toBe("completed");
      expect(second.acceptedAttemptOrdinal).toBe(1);
    });

    it("rejects with StaleProductionAttemptConflictError when expectedProductionJobId does not match current attempt", async () => {
      const scene = createQAScene("scene-stale-attempt", "job-prod-latest");
      const { useCases } = setupTestContext(scene, "job-prod-latest");

      await expect(
        useCases.acceptProduction({
          sceneId: "scene-stale-attempt",
          eventId: "evt-stale-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-old"
        })
      ).rejects.toThrow(StaleProductionAttemptConflictError);
    });

    it("rejects with StaleRevisionConflictError when expectedSpecRevision does not match scene revision", async () => {
      const scene = createQAScene("scene-stale-rev", "job-prod-1");
      const { useCases } = setupTestContext(scene, "job-prod-1");

      await expect(
        useCases.acceptProduction({
          sceneId: "scene-stale-rev",
          eventId: "evt-stale-rev-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 99,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(StaleRevisionConflictError);
    });

    it("rejects with SceneNotInProductionRunError when scene has no associated run", async () => {
      const scene = createQAScene("scene-no-run", "job-prod-1");
      const queue = new InMemoryJobQueue();
      // uow without seeding run
      const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
      const enqueue = new EnqueueSceneProductionRenderUseCase(uow);
      const useCases = new ProductionReviewUseCases(uow, enqueue);

      await expect(
        useCases.acceptProduction({
          sceneId: "scene-no-run",
          eventId: "evt-no-run-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(SceneNotInProductionRunError);
    });

    it("rejects with InvalidTransitionError when scene is not in qa status (e.g. rendering)", async () => {
      const scene = Scene.create({
        id: "scene-rendering" as SceneId,
        campaignId: "camp-1" as CampaignId,
        configuration: {
          prompt: "Rendering scene",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 4042
        }
      });
      scene.beginCandidateGeneration();
      scene.submitCandidatesForReview();
      scene.selectCandidate("cand-1" as CandidateId, 1, scene.id);
      scene.approve({ approvedBy: "Director", approvedAt: "2026-09-01T00:00:00.000Z" });
      scene.queueForProduction("job-prod-1");
      scene.startRendering();

      const { useCases } = setupTestContext(scene, "job-prod-1");

      await expect(
        useCases.acceptProduction({
          sceneId: "scene-rendering",
          eventId: "evt-render-accept",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(InvalidTransitionError);
    });

    it("rejects with AlreadyAcceptedProductionAttemptError if already accepted", async () => {
      const scene = createQAScene("scene-already-acc", "job-prod-1");
      const { useCases } = setupTestContext(scene, "job-prod-1");

      await useCases.acceptProduction({
        sceneId: "scene-already-acc",
        eventId: "evt-acc-first",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1"
      });

      // Different eventId on already accepted scene
      await expect(
        useCases.acceptProduction({
          sceneId: "scene-already-acc",
          eventId: "evt-acc-second",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:05:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(AlreadyAcceptedProductionAttemptError);
    });

    it("throws internal Error when production attempt record is missing for active job", async () => {
      const scene = createQAScene("scene-missing-attempt", "job-prod-1");
      const { uow, useCases } = setupTestContext(scene, "job-prod-1");
      // Simulate data integrity defect: active production job exists on scene, but no attempt record
      (uow as unknown as { _seededAttempts: Map<string, unknown> })._seededAttempts.clear();

      await expect(
        useCases.acceptProduction({
          sceneId: "scene-missing-attempt",
          eventId: "evt-missing-attempt-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(/Production attempt record not found for active job 'job-prod-1'/);
    });

    it("throws internal Error when run scene record sceneId does not match aggregate sceneId", async () => {
      const scene = createQAScene("scene-mismatched", "job-prod-1");
      const { uow, useCases } = setupTestContext(scene, "job-prod-1");
      (uow as unknown as { _seededRunScenes: Map<string, unknown> })._seededRunScenes.clear();
      // Mismatch the sceneId in the runScene
      uow.seedCampaignProductionRunScenes([
        {
          runId: "run-1",
          sceneId: "other-scene" as SceneId,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4042,
          productionJobId: "job-prod-1",
          currentAttemptId: "attempt-1",
          currentAttemptOrdinal: 1
        }
      ]);

      await expect(
        useCases.acceptProduction({
          sceneId: "scene-mismatched",
          eventId: "evt-mismatched-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(/Run scene 'other-scene' does not match expected scene 'scene-mismatched'/);
    });

    it("throws SceneNotInProductionRunError if findRunSceneByProductionJobId returns undefined even if older run scene exists for sceneId", async () => {
      const scene = createQAScene("scene-new-job", "job-prod-active");
      const { uow, useCases } = setupTestContext(scene, "job-prod-active");
      // Seed a run scene with a different/superseded job ID, so findRunSceneByProductionJobId(job-prod-active) returns undefined
      uow.seedCampaignProductionRunScenes([
        {
          runId: "run-1",
          sceneId: scene.id,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4042,
          productionJobId: "job-prod-superseded",
          currentAttemptId: "attempt-old",
          currentAttemptOrdinal: 1
        }
      ]);

      await expect(
        useCases.acceptProduction({
          sceneId: scene.id,
          eventId: "evt-no-active-run-scene",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-active"
        })
      ).rejects.toThrow(SceneNotInProductionRunError);
    });
  });

  describe("requestProductionRerender", () => {
    it("successfully requests production rerender: enqueues new job, increments ordinal, resets to queued, logs review event", async () => {
      const scene = createQAScene("scene-rerender-1", "job-prod-1");
      const { uow, queue, useCases } = setupTestContext(scene, "job-prod-1");

      const result = await useCases.requestProductionRerender({
        sceneId: "scene-rerender-1",
        eventId: "evt-rerender-1",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1",
        directorNotes: "Need more lighting on the mountain edge"
      });

      expect(result.isIdempotentReplay).toBe(false);
      expect(result.scene.status).toBe("queued");
      expect(result.scene.productionAttemptOrdinal).toBe(2);
      expect(result.scene.activeProductionJobId).not.toBe("job-prod-1");

      // Verify a new job was enqueued
      expect(queue.jobs).toHaveLength(1);
      const enqueuedJob = queue.jobs[0]!;
      expect(enqueuedJob.jobId).toBe(result.scene.activeProductionJobId);
      expect(enqueuedJob.jobKind).toBe("production");

      // Verify run repository has attempt #2 recorded
      const attempt2 = await uow.campaignProductionRuns.findAttemptByProductionJobId(
        enqueuedJob.jobId
      );
      expect(attempt2).toBeDefined();
      expect(attempt2?.ordinal).toBe(2);
      expect(attempt2?.createdReason).toBe("production_rerender");

      // Verify run scene current attempt updated
      const runScene = await uow.campaignProductionRuns.findRunSceneBySceneId("scene-rerender-1");
      expect(runScene?.currentAttemptId).toBe(attempt2?.attemptId);
      expect(runScene?.currentAttemptOrdinal).toBe(2);
      expect(runScene?.productionJobId).toBe(enqueuedJob.jobId);

      // Verify review event was appended
      const savedEvents = uow.reviewEvents;
      expect(savedEvents).toHaveLength(1);
      const event = savedEvents[0]!;
      expect(event.action).toBe("production_rerender");
      expect(event.sceneId).toBe("scene-rerender-1");
      expect(event.priorSceneStatus).toBe("qa");
      expect(event.resultingSceneStatus).toBe("queued");
      expect(event.directorNotes).toBe("Need more lighting on the mountain edge");
      expect(event.mutationPayload).toEqual({
        productionJobId: enqueuedJob.jobId,
        attemptId: attempt2?.attemptId,
        attemptOrdinal: 2,
        previousProductionJobId: "job-prod-1"
      });
    });

    it("returns idempotent replay when called repeatedly with the same eventId without re-enqueuing", async () => {
      const scene = createQAScene("scene-rerender-idem", "job-prod-1");
      const { queue, useCases } = setupTestContext(scene, "job-prod-1");

      const first = await useCases.requestProductionRerender({
        sceneId: "scene-rerender-idem",
        eventId: "evt-rerender-idem-1",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1"
      });
      expect(first.isIdempotentReplay).toBe(false);
      expect(queue.jobs).toHaveLength(1);

      const second = await useCases.requestProductionRerender({
        sceneId: "scene-rerender-idem",
        eventId: "evt-rerender-idem-1",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1"
      });
      expect(second.isIdempotentReplay).toBe(true);
      expect(queue.jobs).toHaveLength(1); // No new job enqueued
    });

    it("rejects with StaleProductionAttemptConflictError when expectedProductionJobId does not match current attempt", async () => {
      const scene = createQAScene("scene-stale-rerender", "job-prod-latest");
      const { useCases } = setupTestContext(scene, "job-prod-latest");

      await expect(
        useCases.requestProductionRerender({
          sceneId: "scene-stale-rerender",
          eventId: "evt-stale-rerender-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-old"
        })
      ).rejects.toThrow(StaleProductionAttemptConflictError);
    });

    it("rejects with InvalidTransitionError when scene is not in qa status", async () => {
      const scene = createQAScene("scene-queued-rerender", "job-prod-1");
      // Put back to queued
      scene.rejectQA(); // director_review

      const { useCases } = setupTestContext(scene, "job-prod-1");

      await expect(
        useCases.requestProductionRerender({
          sceneId: "scene-queued-rerender",
          eventId: "evt-invalid-status",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ).rejects.toThrow(InvalidTransitionError);
    });
  });

  describe("fencing and concurrency guarantees", () => {
    it("rejects a stale Accept attempt that arrives after a Re-render has advanced the active attempt", async () => {
      const scene = createQAScene("scene-race-1", "job-prod-1");
      const { useCases } = setupTestContext(scene, "job-prod-1");

      // 1. User A triggers Re-render on attempt 1
      const rerenderResult = await useCases.requestProductionRerender({
        sceneId: "scene-race-1",
        eventId: "evt-race-rerender",
        reviewerName: "Director Dave",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-1"
      });
      expect(rerenderResult.scene.productionAttemptOrdinal).toBe(2);
      const newJobId = rerenderResult.scene.activeProductionJobId;
      expect(newJobId).toBeDefined();
      expect(newJobId).not.toBe("job-prod-1");

      // Scene is now queued with attempt 2
      // Simulate that attempt 2 completes render and is submitted for QA
      const updatedScene = Scene.reconstitute(rerenderResult.scene);
      updatedScene.startRendering();
      updatedScene.submitForQA();

      // Update unit of work with the advanced scene in QA for attempt 2
      const queue = new InMemoryJobQueue();
      const uow = new InMemorySceneUnitOfWork([updatedScene]).withJobs(queue);
      const runRecord = {
        id: "run-1",
        campaignId: "camp-1" as CampaignId,
        fingerprint: "fp-1",
        status: "dispatched" as const,
        expectedTotalDurationMs: 8084,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      uow.seedCampaignProductionRun(runRecord);
      uow.seedCampaignProductionRunScenes([
        {
          runId: "run-1",
          sceneId: "scene-race-1" as SceneId,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4042,
          productionJobId: newJobId!,
          currentAttemptId: "attempt-2",
          currentAttemptOrdinal: 2
        },
        {
          runId: "run-1",
          sceneId: "scene-pending-2" as SceneId,
          specRevision: 1,
          sequenceIndex: 2,
          expectedDurationMs: 4042,
          productionJobId: "job-pending-2",
          currentAttemptId: "attempt-pending-2",
          currentAttemptOrdinal: 1
        }
      ]);
      uow.seedProductionAttempt({
        attemptId: "attempt-1",
        sceneId: "scene-race-1" as SceneId,
        runId: "run-1",
        ordinal: 1,
        productionJobId: "job-prod-1",
        specRevision: 1,
        seed: 42,
        createdReason: "initial_dispatch",
        createdAt: new Date().toISOString()
      });
      uow.seedProductionAttempt({
        attemptId: "attempt-2",
        sceneId: "scene-race-1" as SceneId,
        runId: "run-1",
        ordinal: 2,
        productionJobId: newJobId!,
        specRevision: 1,
        seed: 43,
        createdReason: "production_rerender",
        createdAt: new Date().toISOString()
      });

      const enqueue = new EnqueueSceneProductionRenderUseCase(uow);
      const activeUseCases = new ProductionReviewUseCases(uow, enqueue);

      // 2. User B's late Accept arrives referencing stale job-prod-1
      const staleAcceptError = await activeUseCases
        .acceptProduction({
          sceneId: "scene-race-1",
          eventId: "evt-late-accept",
          reviewerName: "Producer Pete",
          occurredAt: "2026-09-01T12:01:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
        .catch((e) => e);

      expect(staleAcceptError).toBeInstanceOf(StaleProductionAttemptConflictError);
      expect(staleAcceptError.expectedProductionJobId).toBe("job-prod-1");
      expect(staleAcceptError.actualProductionJobId).toBe(newJobId);

      // 3. User B's Accept referencing the current active attempt (newJobId) succeeds
      const validAccept = await activeUseCases.acceptProduction({
        sceneId: "scene-race-1",
        eventId: "evt-correct-accept",
        reviewerName: "Producer Pete",
        occurredAt: "2026-09-01T12:02:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: newJobId!
      });
      expect(validAccept.isIdempotentReplay).toBe(false);
      expect(validAccept.scene.status).toBe("completed");
      expect(validAccept.scene.acceptedProductionAttemptId).toBe("attempt-2");
    });

    it("serializes concurrent accept and rerender requests racing on the same attempt so at most one valid mutation wins", async () => {
      const scene = createQAScene("scene-race-concurrent-1", "job-prod-1");
      const { useCases } = setupTestContext(scene, "job-prod-1");

      const [acceptResult, rerenderResult] = await Promise.allSettled([
        useCases.acceptProduction({
          sceneId: "scene-race-concurrent-1",
          eventId: "evt-concurrent-accept",
          reviewerName: "Producer Pete",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        }),
        useCases.requestProductionRerender({
          sceneId: "scene-race-concurrent-1",
          eventId: "evt-concurrent-rerender",
          reviewerName: "Director Dave",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ]);

      const fulfilled = [acceptResult, rerenderResult].filter((r) => r.status === "fulfilled");
      const rejected = [acceptResult, rerenderResult].filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });

    it("serializes concurrent rerender requests racing on the same attempt so at most one succeeds", async () => {
      const scene = createQAScene("scene-race-rerenders", "job-prod-1");
      const { queue, useCases } = setupTestContext(scene, "job-prod-1");

      const [res1, res2] = await Promise.allSettled([
        useCases.requestProductionRerender({
          sceneId: "scene-race-rerenders",
          eventId: "evt-rerender-race-1",
          reviewerName: "Director Dave",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        }),
        useCases.requestProductionRerender({
          sceneId: "scene-race-rerenders",
          eventId: "evt-rerender-race-2",
          reviewerName: "Producer Pete",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-1"
        })
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === "fulfilled");
      const rejected = [res1, res2].filter((r) => r.status === "rejected");

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Exactly 1 new production job was enqueued
      expect(queue.jobs).toHaveLength(1);
    });

    it("allows concurrent accept requests for different scenes in the same run to both succeed", async () => {
      const scene1 = createQAScene("scene-diff-1", "job-prod-s1");
      const scene2 = createQAScene("scene-diff-2", "job-prod-s2");

      const queue = new InMemoryJobQueue();
      const uow = new InMemorySceneUnitOfWork([scene1, scene2]).withJobs(queue);
      const runRecord = {
        id: "run-shared",
        campaignId: "camp-1" as CampaignId,
        fingerprint: "fp-shared",
        status: "dispatched" as const,
        expectedTotalDurationMs: 8084,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      uow.seedCampaignProductionRun(runRecord);
      uow.seedProductionAttempt({
        attemptId: "att-s1",
        sceneId: scene1.id,
        runId: "run-shared",
        ordinal: 1,
        productionJobId: "job-prod-s1",
        specRevision: 1,
        seed: 101,
        createdReason: "initial_dispatch",
        createdAt: new Date().toISOString()
      });
      uow.seedProductionAttempt({
        attemptId: "att-s2",
        sceneId: scene2.id,
        runId: "run-shared",
        ordinal: 1,
        productionJobId: "job-prod-s2",
        specRevision: 1,
        seed: 102,
        createdReason: "initial_dispatch",
        createdAt: new Date().toISOString()
      });
      uow.seedCampaignProductionRunScenes([
        {
          runId: "run-shared",
          sceneId: scene1.id,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4042,
          productionJobId: "job-prod-s1",
          currentAttemptId: "att-s1",
          currentAttemptOrdinal: 1
        },
        {
          runId: "run-shared",
          sceneId: scene2.id,
          specRevision: 1,
          sequenceIndex: 2,
          expectedDurationMs: 4042,
          productionJobId: "job-prod-s2",
          currentAttemptId: "att-s2",
          currentAttemptOrdinal: 1
        }
      ]);

      uow.seedVideoStemSource("job-prod-s1", {
        generationManifestId: "manifest-s1",
        renderAttempt: 1,
        media: {
          bucket: "delivery-bucket",
          key: "stems/scene-1.mp4",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          contentType: "video/mp4"
        }
      });
      uow.seedVideoStemSource("job-prod-s2", {
        generationManifestId: "manifest-s2",
        renderAttempt: 1,
        media: {
          bucket: "delivery-bucket",
          key: "stems/scene-2.mp4",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          contentType: "video/mp4"
        }
      });

      const enqueue = new EnqueueSceneProductionRenderUseCase(uow);
      const useCases = new ProductionReviewUseCases(uow, enqueue);

      const [res1, res2] = await Promise.all([
        useCases.acceptProduction({
          sceneId: "scene-diff-1",
          eventId: "evt-diff-acc-1",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-s1"
        }),
        useCases.acceptProduction({
          sceneId: "scene-diff-2",
          eventId: "evt-diff-acc-2",
          reviewerName: "Supervisor Sam",
          occurredAt: "2026-09-01T12:00:00.000Z",
          expectedSpecRevision: 1,
          expectedProductionJobId: "job-prod-s2"
        })
      ]);

      expect(res1.scene.status).toBe("completed");
      expect(res1.scene.acceptedProductionAttemptId).toBe("att-s1");
      expect(res2.scene.status).toBe("completed");
      expect(res2.scene.acceptedProductionAttemptId).toBe("att-s2");

      // Verify that assembly was enqueued exactly once across the two concurrent calls
      expect(uow.enqueuedAssemblyJobs()).toHaveLength(1);
      const run = await uow.campaignProductionRuns.findById("run-shared");
      expect(run?.status).toBe("assembling");
      expect(run?.assemblyJobId).toBeDefined();
    });

    it("triggers assembly enqueue and sets assemblyJobId on run when the final scene is accepted", async () => {
      const scene = createQAScene("scene-final", "job-prod-final");
      const queue = new InMemoryJobQueue();
      const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
      const runRecord: CampaignProductionRunRecord = {
        id: "run-final",
        campaignId: "camp-final" as CampaignId,
        fingerprint: "fp-final",
        status: "dispatched",
        expectedTotalDurationMs: 4042,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      uow.seedCampaignProductionRun(runRecord);
      uow.seedProductionAttempt({
        attemptId: "attempt-final",
        sceneId: scene.id,
        runId: "run-final",
        ordinal: 1,
        productionJobId: "job-prod-final",
        specRevision: 1,
        seed: 42,
        createdReason: "initial_dispatch",
        createdAt: new Date().toISOString()
      });
      uow.seedCampaignProductionRunScenes([
        {
          runId: "run-final",
          sceneId: scene.id,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4042,
          productionJobId: "job-prod-final",
          currentAttemptId: "attempt-final",
          currentAttemptOrdinal: 1
        }
      ]);
      uow.seedVideoStemSource("job-prod-final", {
        generationManifestId: "manifest-final",
        renderAttempt: 1,
        media: {
          bucket: "delivery-bucket",
          key: "stems/final.mp4",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          contentType: "video/mp4"
        }
      });

      const enqueue = new EnqueueSceneProductionRenderUseCase(uow);
      const useCases = new ProductionReviewUseCases(uow, enqueue);

      const result = await useCases.acceptProduction({
        sceneId: "scene-final",
        eventId: "evt-final-accept",
        reviewerName: "Supervisor Sam",
        occurredAt: "2026-09-01T12:00:00.000Z",
        expectedSpecRevision: 1,
        expectedProductionJobId: "job-prod-final"
      });

      expect(result.scene.status).toBe("completed");
      const enqueued = uow.enqueuedAssemblyJobs();
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0]!.campaignId).toBe("camp-final");
      expect(enqueued[0]!.assemblySpec.videoStems).toHaveLength(1);
      expect(enqueued[0]!.assemblySpec.videoStems[0]!.generationManifestId).toBe("manifest-final");

      const run = await uow.campaignProductionRuns.findById("run-final");
      expect(run?.status).toBe("assembling");
      expect(run?.assemblyJobId).toBeDefined();
    });
  });
});
