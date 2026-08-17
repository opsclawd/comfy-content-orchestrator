import { describe, expect, it, vi } from "vitest";
import {
  InvalidCandidateError,
  InvalidMutationError,
  InvalidTransitionError,
  Scene,
  type CampaignId,
  type CandidateId,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CandidateNotFoundError } from "./candidate-not-found-error.js";
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
          findById: async () => undefined,
          append: async (): Promise<void> => {
            throw new Error("Event store append failed: connection dropped");
          }
        };

        const scopedCandidates: StoryboardCandidateRepository = {
          findById: async () => undefined,
          insert: async () => {},
          listBySceneAndRevision: async () => []
        };

        return work({
          scenes: scopedScenes,
          reviewEvents: scopedReviewEvents,
          candidates: scopedCandidates
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

  describe("ReviewSceneUseCases - Candidate Selection and Review Semantics", () => {
    const createCandidate = (
      id: string,
      sceneId: string,
      revision: number = 1
    ): StoryboardCandidate => ({
      id: id as CandidateId,
      sceneId: sceneId as SceneId,
      specRevision: revision,
      variantOrdinal: 1,
      locator: `godzspeed-temp/candidates/${sceneId}/${id}.webp`,
      contentHash: "sha256-dummy-hash",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    });

    it("selectCandidate: fetches candidate from repository, delegates to scene.selectCandidate with ground truth, appends candidate_select event, and saves atomically", async () => {
      const scene = createSceneInDirectorReview("scene-select-1");
      const candidate = createCandidate("candidate-2", "scene-select-1", 1);
      const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
      const useCases = new ReviewSceneUseCases(uow);

      const input = {
        sceneId: "scene-select-1",
        eventId: "event-select-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        directorNotes: "Selecting candidate 2 for revision 1",
        candidateId: "candidate-2" as CandidateId
      };

      await useCases.selectCandidate(input);

      expect(uow.savedScenes).toHaveLength(1);
      const savedScene = uow.savedScenes[0]!;
      expect(savedScene.id).toBe("scene-select-1");
      expect(savedScene.status).toBe("director_review");
      expect(savedScene.snapshot().selectedCandidateId).toBe("candidate-2");
      expect(savedScene.snapshot().selectedCandidateRevision).toBe(1);

      expect(uow.reviewEvents).toHaveLength(1);
      expect(uow.reviewEvents[0]).toEqual({
        eventId: "event-select-1",
        sceneId: "scene-select-1",
        reviewerName: "Director Alice",
        action: "candidate_select",
        directorNotes: "Selecting candidate 2 for revision 1",
        mutationPayload: { candidateId: "candidate-2", candidateRevision: 1 },
        priorSceneStatus: "director_review",
        resultingSceneStatus: "director_review",
        occurredAt: "2026-08-15T01:00:00.000Z"
      });
    });

    it("selectCandidate: rejects when candidate belongs to a different scene (preventing forged scene ID bypass)", async () => {
      const scene = createSceneInDirectorReview("scene-select-target");
      const foreignCandidate = createCandidate("candidate-foreign", "scene-other", 1);
      const uow = new InMemorySceneUnitOfWork([scene], [foreignCandidate]);
      const useCases = new ReviewSceneUseCases(uow);

      const promise = useCases.selectCandidate({
        sceneId: "scene-select-target",
        eventId: "event-select-foreign",
        reviewerName: "Attacker",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "candidate-foreign" as CandidateId
      });

      await expect(promise).rejects.toThrow(InvalidCandidateError);
      await expect(promise).rejects.toThrow("Candidate belongs to a different scene");

      expect(uow.savedScenes).toHaveLength(0);
      expect(uow.reviewEvents).toHaveLength(0);
    });

    it("selectCandidate: rejects when candidate belongs to an outdated revision (preventing forged revision bypass)", async () => {
      const scene = createSceneInDirectorReview("scene-select-stale");
      scene.updatePrompt("Updated prompt that advances revision to 2");
      expect(scene.snapshot().specRevision).toBe(2);

      const staleCandidate = createCandidate("candidate-rev1", "scene-select-stale", 1);
      const uow = new InMemorySceneUnitOfWork([scene], [staleCandidate]);
      const useCases = new ReviewSceneUseCases(uow);

      // Client passes candidateRevision: 2 to try forging the revision
      const promise = useCases.selectCandidate({
        sceneId: "scene-select-stale",
        eventId: "event-select-stale",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "candidate-rev1" as CandidateId,
        candidateRevision: 2
      });

      await expect(promise).rejects.toThrow(InvalidCandidateError);
      await expect(promise).rejects.toThrow(
        "Candidate revision does not match current scene revision"
      );

      expect(uow.savedScenes).toHaveLength(0);
      expect(uow.reviewEvents).toHaveLength(0);
    });

    it("selectCandidate: throws CandidateNotFoundError when candidate does not exist in repository", async () => {
      const scene = createSceneInDirectorReview("scene-select-missing");
      const uow = new InMemorySceneUnitOfWork([scene], []);
      const useCases = new ReviewSceneUseCases(uow);

      const promise = useCases.selectCandidate({
        sceneId: "scene-select-missing",
        eventId: "event-select-missing",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "candidate-nonexistent" as CandidateId
      });

      await expect(promise).rejects.toThrow(CandidateNotFoundError);
      await expect(promise).rejects.toThrow("Candidate 'candidate-nonexistent' was not found.");

      expect(uow.savedScenes).toHaveLength(0);
      expect(uow.reviewEvents).toHaveLength(0);
    });

    it("approve use case rejects if no candidate was selected", async () => {
      const scene = createSceneInDirectorReview("scene-approve-unselected");
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ReviewSceneUseCases(uow);

      await expect(
        useCases.approve({
          sceneId: "scene-approve-unselected",
          eventId: "event-approve-fail",
          reviewerName: "Director Alice",
          occurredAt: "2026-08-15T01:00:00.000Z"
        })
      ).rejects.toThrow(InvalidTransitionError);

      expect(uow.savedScenes).toHaveLength(0);
      expect(uow.reviewEvents).toHaveLength(0);
    });

    it("storyboard rejection maps to requestReroll: clears candidate selection and emits reroll event", async () => {
      const scene = createSceneInDirectorReview("scene-reroll-clear");
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ReviewSceneUseCases(uow);

      await useCases.requestReroll({
        sceneId: "scene-reroll-clear",
        eventId: "event-reroll-2",
        reviewerName: "Director Bob",
        occurredAt: "2026-08-15T02:00:00.000Z",
        directorNotes: "None of the candidates meet style guidelines"
      });

      expect(uow.savedScenes).toHaveLength(1);
      const saved = uow.savedScenes[0]!;
      expect(saved.status).toBe("generating_candidates");
      expect(saved.snapshot().selectedCandidateId).toBeUndefined();

      expect(uow.reviewEvents).toHaveLength(1);
      expect(uow.reviewEvents[0]!.action).toBe("reroll");
    });

    it("QA rejection exclusively uses rejectQA: preserves candidate selection and emits reject event", async () => {
      const scene = createSceneInQA("scene-qa-reject-semantics");
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ReviewSceneUseCases(uow);

      await useCases.rejectQA({
        sceneId: "scene-qa-reject-semantics",
        eventId: "event-qa-reject-2",
        reviewerName: "QA Lead Dave",
        occurredAt: "2026-08-15T04:05:00.000Z",
        directorNotes: "Frame drop at 2.4s"
      });

      expect(uow.savedScenes).toHaveLength(1);
      const saved = uow.savedScenes[0]!;
      expect(saved.status).toBe("director_review");
      expect(saved.snapshot().selectedCandidateId).toBe("candidate-1");
      expect(saved.snapshot().approval).toBeUndefined();

      expect(uow.reviewEvents).toHaveLength(1);
      expect(uow.reviewEvents[0]!.action).toBe("reject");
    });

    it("selectCandidate propagates expectedSpecRevision, resultingSpecRevision, and requestHashSha256", async () => {
      const scene = createSceneInDirectorReview("scene-select-idempotent");
      const candidate: StoryboardCandidate = {
        id: "cand-uuid-1" as CandidateId,
        sceneId: "scene-select-idempotent" as SceneId,
        specRevision: 2,
        variantOrdinal: 1,
        locator: "storyboard-candidates/campaigns/c1/scenes/s1/v2/c1.png",
        contentHash: "b".repeat(64),
        generationMetadata: {},
        createdAt: "2026-08-15T00:00:00.000Z"
      };
      // Advance scene spec revision to match candidate
      scene.updatePrompt("Revised prompt for rev 2");
      scene.beginCandidateGeneration();
      scene.submitCandidatesForReview();

      const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
      const useCases = new ReviewSceneUseCases(uow);

      const requestHash = "e".repeat(64);
      await useCases.selectCandidate({
        sceneId: "scene-select-idempotent",
        eventId: "event-select-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T02:00:00.000Z",
        candidateId: "cand-uuid-1" as CandidateId,
        expectedSpecRevision: 2,
        resultingSpecRevision: 2,
        requestHashSha256: requestHash
      });

      expect(uow.reviewEvents).toHaveLength(1);
      const event = uow.reviewEvents[0]!;
      expect(event.action).toBe("candidate_select");
      expect(event.expectedSpecRevision).toBe(2);
      expect(event.resultingSpecRevision).toBe(2);
      expect(event.requestHashSha256).toBe(requestHash);
    });

    it("review actions propagate expectedSpecRevision, resultingSpecRevision, and requestHashSha256", async () => {
      const scene = createSceneInDirectorReview("scene-action-idempotent");
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ReviewSceneUseCases(uow);

      const requestHash = "f".repeat(64);
      await useCases.approve({
        sceneId: "scene-action-idempotent",
        eventId: "event-approve-idemp",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T02:00:00.000Z",
        expectedSpecRevision: 1,
        resultingSpecRevision: 1,
        requestHashSha256: requestHash
      });

      expect(uow.reviewEvents).toHaveLength(1);
      const event = uow.reviewEvents[0]!;
      expect(event.action).toBe("approve");
      expect(event.expectedSpecRevision).toBe(1);
      expect(event.resultingSpecRevision).toBe(1);
      expect(event.requestHashSha256).toBe(requestHash);
    });

    it("selectCandidate: duplicate eventId returns early without modifying scene or appending duplicate event", async () => {
      const scene = createSceneInDirectorReview("scene-idemp-select");
      const candidate = createCandidate("candidate-1", "scene-idemp-select", 1);
      const uow = new InMemorySceneUnitOfWork([scene], [candidate]);
      const useCases = new ReviewSceneUseCases(uow);

      const input = {
        sceneId: "scene-idemp-select",
        eventId: "event-duplicate-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z",
        candidateId: "candidate-1" as CandidateId
      };

      // First call succeeds
      await useCases.selectCandidate(input);
      expect(uow.savedScenes).toHaveLength(1);
      expect(uow.reviewEvents).toHaveLength(1);

      // Second call with identical eventId is a no-op
      await useCases.selectCandidate({
        ...input,
        candidateId: "candidate-nonexistent" as CandidateId // should not even lookup candidate if idempotent
      });

      expect(uow.savedScenes).toHaveLength(1);
      expect(uow.reviewEvents).toHaveLength(1);
    });

    it("review actions: duplicate eventId returns early without modifying scene or appending duplicate event", async () => {
      const scene = createSceneInDirectorReview("scene-idemp-action");
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ReviewSceneUseCases(uow);

      const input = {
        sceneId: "scene-idemp-action",
        eventId: "event-duplicate-action-1",
        reviewerName: "Director Alice",
        occurredAt: "2026-08-15T01:00:00.000Z"
      };

      // First call approves scene
      await useCases.approve(input);
      expect(uow.savedScenes).toHaveLength(1);
      expect(uow.reviewEvents).toHaveLength(1);
      expect(uow.savedScenes[0]!.status).toBe("approved");

      // Second call with duplicate eventId does nothing (even if scene is now in approved state where approve is not a valid transition)
      await useCases.approve(input);

      expect(uow.savedScenes).toHaveLength(1);
      expect(uow.reviewEvents).toHaveLength(1);
    });
  });
});
