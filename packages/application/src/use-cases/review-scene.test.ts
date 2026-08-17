import { describe, expect, it, vi } from "vitest";
import {
  InvalidMutationError,
  InvalidTransitionError,
  Scene,
  type CampaignId,
  type CandidateId,
  type SceneId
} from "@cco/domain";
import type {
  ReviewEventStore,
  SceneRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { ReviewSceneUseCases } from "./review-scene.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

describe("ReviewSceneUseCases", () => {
  const createTestScene = (id: string = "scene-1"): Scene => {
    return Scene.create({
      id: id as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A cinematic shot of a mountain sunrise",
        referenceIds: ["ref-1"],
        engineProfileId: "ltx_25",
        durationMs: 5000,
        loraConfigurationId: "lora-initial"
      }
    });
  };

  const createSceneInDirectorReview = (id: string = "scene-1"): Scene => {
    const scene = createTestScene(id);
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    return scene;
  };

  const createSceneInApproved = (id: string = "scene-1"): Scene => {
    const scene = createSceneInDirectorReview(id);
    scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
    scene.approve({
      approvedBy: "Director Initial",
      approvedAt: "2026-08-15T00:00:00.000Z"
    });
    return scene;
  };

  const createSceneInQA = (id: string = "scene-1"): Scene => {
    const scene = createSceneInApproved(id);
    scene.queueForProduction();
    scene.startRendering();
    scene.submitForQA();
    return scene;
  };

  it("approve: director_review transitions to approved, appends approve event, and saves atomically", async () => {
    const scene = createSceneInDirectorReview("scene-approve-1");
    scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    const input = {
      sceneId: "scene-approve-1",
      eventId: "event-approve-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T01:00:00.000Z",
      directorNotes: "Composition approved for production"
    };

    await useCases.approve(input);

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-approve-1");
    expect(savedScene.status).toBe("approved");
    expect(savedScene.snapshot().approval).toEqual({
      revision: 1,
      approvedBy: "Director Alice",
      approvedAt: "2026-08-15T01:00:00.000Z"
    });

    expect(uow.reviewEvents).toHaveLength(1);
    expect(uow.reviewEvents[0]).toEqual({
      eventId: "event-approve-1",
      sceneId: "scene-approve-1",
      reviewerName: "Director Alice",
      action: "approve",
      directorNotes: "Composition approved for production",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "approved",
      occurredAt: "2026-08-15T01:00:00.000Z"
    });
  });

  it("reroll: director_review transitions to generating_candidates and records reroll", async () => {
    const scene = createSceneInDirectorReview("scene-reroll-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    const input = {
      sceneId: "scene-reroll-1",
      eventId: "event-reroll-1",
      reviewerName: "Director Bob",
      occurredAt: "2026-08-15T02:00:00.000Z",
      directorNotes: "Needs more dramatic lighting"
    };

    await useCases.requestReroll(input);

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-reroll-1");
    expect(savedScene.status).toBe("generating_candidates");

    expect(uow.reviewEvents).toHaveLength(1);
    expect(uow.reviewEvents[0]).toEqual({
      eventId: "event-reroll-1",
      sceneId: "scene-reroll-1",
      reviewerName: "Director Bob",
      action: "reroll",
      directorNotes: "Needs more dramatic lighting",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "generating_candidates",
      occurredAt: "2026-08-15T02:00:00.000Z"
    });
  });

  it("configuration edit: approved invalidates approval, advances revision, and records only the changed field", async () => {
    const mutationCases = [
      {
        field: "prompt",
        action: "prompt_edit",
        execute: (useCases: ReviewSceneUseCases, sceneId: string) =>
          useCases.updatePrompt({
            sceneId,
            eventId: "event-prompt-1",
            reviewerName: "Director Alice",
            occurredAt: "2026-08-15T03:00:00.000Z",
            directorNotes: "Refining prompt details",
            prompt: "Updated sunrise over misty mountains"
          }),
        expectedPayload: { prompt: "Updated sunrise over misty mountains" },
        verifyScene: (scene: Scene) => {
          expect(scene.snapshot().configuration.prompt).toBe(
            "Updated sunrise over misty mountains"
          );
        }
      },
      {
        field: "referenceIds",
        action: "reference_change",
        execute: (useCases: ReviewSceneUseCases, sceneId: string) =>
          useCases.updateReferences({
            sceneId,
            eventId: "event-ref-1",
            reviewerName: "Director Alice",
            occurredAt: "2026-08-15T03:01:00.000Z",
            referenceIds: ["ref-2", "ref-3"]
          }),
        expectedPayload: { referenceIds: ["ref-2", "ref-3"] },
        verifyScene: (scene: Scene) => {
          expect(scene.snapshot().configuration.referenceIds).toEqual(["ref-2", "ref-3"]);
        }
      },
      {
        field: "engineProfileId",
        action: "engine_change",
        execute: (useCases: ReviewSceneUseCases, sceneId: string) =>
          useCases.updateEngine({
            sceneId,
            eventId: "event-engine-1",
            reviewerName: "Director Alice",
            occurredAt: "2026-08-15T03:02:00.000Z",
            engineProfileId: "wan_21"
          }),
        expectedPayload: { engineProfileId: "wan_21" },
        verifyScene: (scene: Scene) => {
          expect(scene.snapshot().configuration.engineProfileId).toBe("wan_21");
        }
      },
      {
        field: "durationMs",
        action: "duration_change",
        execute: (useCases: ReviewSceneUseCases, sceneId: string) =>
          useCases.updateDuration({
            sceneId,
            eventId: "event-duration-1",
            reviewerName: "Director Alice",
            occurredAt: "2026-08-15T03:03:00.000Z",
            durationMs: 8000
          }),
        expectedPayload: { durationMs: 8000 },
        verifyScene: (scene: Scene) => {
          expect(scene.snapshot().configuration.durationMs).toBe(8000);
        }
      },
      {
        field: "loraConfigurationId",
        action: "lora_tune",
        execute: (useCases: ReviewSceneUseCases, sceneId: string) =>
          useCases.updateLora({
            sceneId,
            eventId: "event-lora-1",
            reviewerName: "Director Alice",
            occurredAt: "2026-08-15T03:04:00.000Z",
            loraConfigurationId: "lora-custom-v2"
          }),
        expectedPayload: { loraConfigurationId: "lora-custom-v2" },
        verifyScene: (scene: Scene) => {
          expect(scene.snapshot().configuration.loraConfigurationId).toBe("lora-custom-v2");
        }
      },
      {
        field: "loraConfigurationId (explicit null removal)",
        action: "lora_tune",
        execute: (useCases: ReviewSceneUseCases, sceneId: string) =>
          useCases.updateLora({
            sceneId,
            eventId: "event-lora-null-1",
            reviewerName: "Director Alice",
            occurredAt: "2026-08-15T03:05:00.000Z",
            loraConfigurationId: null
          }),
        expectedPayload: { loraConfigurationId: null },
        verifyScene: (scene: Scene) => {
          expect(scene.snapshot().configuration.loraConfigurationId).toBeUndefined();
        }
      }
    ] as const;

    for (const testCase of mutationCases) {
      const sceneId = `scene-mutation-${testCase.field}`;
      const scene = createSceneInApproved(sceneId);
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ReviewSceneUseCases(uow);

      expect(scene.status).toBe("approved");
      expect(scene.snapshot().specRevision).toBe(1);
      expect(scene.snapshot().approval).toBeDefined();

      await testCase.execute(useCases, sceneId);

      expect(uow.savedScenes).toHaveLength(1);
      const savedScene = uow.savedScenes[0]!;
      expect(savedScene.id).toBe(sceneId);
      expect(savedScene.status).toBe("director_review");
      expect(savedScene.snapshot().specRevision).toBe(2);
      expect(savedScene.snapshot().approval).toBeUndefined();
      testCase.verifyScene(savedScene);

      expect(uow.reviewEvents).toHaveLength(1);
      const event = uow.reviewEvents[0]!;
      expect(event.action).toBe(testCase.action);
      expect(event.priorSceneStatus).toBe("approved");
      expect(event.resultingSceneStatus).toBe("director_review");
      expect(event.mutationPayload).toEqual(testCase.expectedPayload);
      expect(Object.keys(event.mutationPayload)).toEqual(Object.keys(testCase.expectedPayload));
    }
  });

  it("qa decisions: qa accept completes and qa reject returns to director_review with audit events", async () => {
    // QA Accept
    const acceptScene = createSceneInQA("scene-qa-accept");
    const acceptUow = new InMemorySceneUnitOfWork([acceptScene]);
    const acceptUseCases = new ReviewSceneUseCases(acceptUow);

    await acceptUseCases.acceptQA({
      sceneId: "scene-qa-accept",
      eventId: "event-qa-accept-1",
      reviewerName: "QA Lead Dave",
      occurredAt: "2026-08-15T04:00:00.000Z",
      directorNotes: "Quality verified"
    });

    expect(acceptUow.savedScenes).toHaveLength(1);
    const acceptedSavedScene = acceptUow.savedScenes[0]!;
    expect(acceptedSavedScene.id).toBe("scene-qa-accept");
    expect(acceptedSavedScene.status).toBe("completed");

    expect(acceptUow.reviewEvents).toHaveLength(1);
    expect(acceptUow.reviewEvents[0]).toEqual({
      eventId: "event-qa-accept-1",
      sceneId: "scene-qa-accept",
      reviewerName: "QA Lead Dave",
      action: "approve",
      directorNotes: "Quality verified",
      mutationPayload: {},
      priorSceneStatus: "qa",
      resultingSceneStatus: "completed",
      occurredAt: "2026-08-15T04:00:00.000Z"
    });

    // QA Reject
    const rejectScene = createSceneInQA("scene-qa-reject");
    const rejectUow = new InMemorySceneUnitOfWork([rejectScene]);
    const rejectUseCases = new ReviewSceneUseCases(rejectUow);

    await rejectUseCases.rejectQA({
      sceneId: "scene-qa-reject",
      eventId: "event-qa-reject-1",
      reviewerName: "QA Lead Dave",
      occurredAt: "2026-08-15T04:05:00.000Z",
      directorNotes: "Flickering artifact on frame 45"
    });

    expect(rejectUow.savedScenes).toHaveLength(1);
    const rejectedSavedScene = rejectUow.savedScenes[0]!;
    expect(rejectedSavedScene.id).toBe("scene-qa-reject");
    expect(rejectedSavedScene.status).toBe("director_review");
    expect(rejectedSavedScene.snapshot().approval).toBeUndefined();

    expect(rejectUow.reviewEvents).toHaveLength(1);
    expect(rejectUow.reviewEvents[0]).toEqual({
      eventId: "event-qa-reject-1",
      sceneId: "scene-qa-reject",
      reviewerName: "QA Lead Dave",
      action: "reject",
      directorNotes: "Flickering artifact on frame 45",
      mutationPayload: {},
      priorSceneStatus: "qa",
      resultingSceneStatus: "director_review",
      occurredAt: "2026-08-15T04:05:00.000Z"
    });
  });

  it("cancel: a cancellable scene becomes cancelled and records a cancel event", async () => {
    const scene = createSceneInDirectorReview("scene-cancel-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ReviewSceneUseCases(uow);

    await useCases.cancel({
      sceneId: "scene-cancel-1",
      eventId: "event-cancel-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T05:00:00.000Z",
      directorNotes: "Scene replaced by scene-2"
    });

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-cancel-1");
    expect(savedScene.status).toBe("cancelled");

    expect(uow.reviewEvents).toHaveLength(1);
    expect(uow.reviewEvents[0]).toEqual({
      eventId: "event-cancel-1",
      sceneId: "scene-cancel-1",
      reviewerName: "Director Alice",
      action: "cancel",
      directorNotes: "Scene replaced by scene-2",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "cancelled",
      occurredAt: "2026-08-15T05:00:00.000Z"
    });
  });

  it("invalid review transition commits neither a scene save nor a review event", async () => {
    const draftScene = createTestScene("scene-draft");
    const uow = new InMemorySceneUnitOfWork([draftScene]);
    const useCases = new ReviewSceneUseCases(uow);

    // Attempt invalid transition: approve on draft_pending (allowed only on director_review)
    await expect(
      useCases.approve({
        sceneId: "scene-draft",
        eventId: "event-invalid-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T06:00:00.000Z"
      })
    ).rejects.toThrow(InvalidTransitionError);

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);

    // Attempt invalid mutation: edit prompt while in qa status
    const qaScene = createSceneInQA("scene-qa");
    const qaUow = new InMemorySceneUnitOfWork([qaScene]);
    const qaUseCases = new ReviewSceneUseCases(qaUow);

    await expect(
      qaUseCases.updatePrompt({
        sceneId: "scene-qa",
        eventId: "event-invalid-2",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T06:01:00.000Z",
        prompt: "Invalid edit during qa"
      })
    ).rejects.toThrow(InvalidMutationError);

    expect(qaUow.savedScenes).toHaveLength(0);
    expect(qaUow.reviewEvents).toHaveLength(0);
  });

  it("missing review scene throws SceneNotFoundError and commits no writes", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCases = new ReviewSceneUseCases(uow);

    const promise = useCases.approve({
      sceneId: "non-existent-scene",
      eventId: "event-missing-1",
      reviewerName: "Director Alice",
      occurredAt: "2026-08-15T07:00:00.000Z"
    });

    await expect(promise).rejects.toThrow(SceneNotFoundError);
    await expect(promise).rejects.toThrow("Scene 'non-existent-scene' was not found.");

    await promise.catch((err: unknown) => {
      expect(err).toBeInstanceOf(SceneNotFoundError);
      if (err instanceof SceneNotFoundError) {
        expect(err.name).toBe("SceneNotFoundError");
        expect(err.sceneId).toBe("non-existent-scene");
      }
    });

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("review event append failure commits neither the event nor the scene save", async () => {
    const scene = createSceneInDirectorReview("scene-append-fail");
    scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
    const saveSpy = vi.fn();

    const failingUow: UnitOfWork = {
      async execute<TResult>(
        work: (context: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> {
        const scopedScenes: SceneRepository = {
          findById: async (sceneId: SceneId): Promise<Scene | undefined> => {
            return sceneId === scene.id ? scene : undefined;
          },
          save: async (sceneToSave: Scene): Promise<void> => {
            saveSpy(sceneToSave);
          }
        };

        const scopedReviewEvents: ReviewEventStore = {
          append: async (): Promise<void> => {
            throw new Error("Event store append failed: connection dropped");
          }
        };

        return work({
          scenes: scopedScenes,
          reviewEvents: scopedReviewEvents
        });
      }
    };

    const useCases = new ReviewSceneUseCases(failingUow);

    await expect(
      useCases.approve({
        sceneId: "scene-append-fail",
        eventId: "event-fail-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T08:00:00.000Z"
      })
    ).rejects.toThrow("Event store append failed: connection dropped");

    expect(saveSpy).not.toHaveBeenCalled();
  });
});
