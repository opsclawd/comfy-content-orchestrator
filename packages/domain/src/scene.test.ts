import { describe, expect, it } from "vitest";
import {
  InvalidCandidateError,
  InvalidMutationError,
  InvalidTransitionError,
  SCENE_STATUSES,
  Scene,
  TerminalStateError,
  type CampaignId,
  type CandidateId,
  type SceneApprovalInput,
  type SceneConfiguration,
  type SceneId,
  type SceneStatus,
  type SceneTransition,
  type SceneTransitionReason
} from "./index.js";

describe("Scene domain contracts", () => {
  it("exports canonical status tuple matching PRD order", () => {
    expect(SCENE_STATUSES).toEqual([
      "draft_pending",
      "generating_candidates",
      "director_review",
      "approved",
      "queued",
      "rendering",
      "qa",
      "completed",
      "failed",
      "cancelled"
    ]);
  });

  it("creates a draft scene at revision one with an immutable configuration snapshot", () => {
    const referenceIds = ["asset-a"];
    const scene = Scene.create({
      id: "scene-1" as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A product reveal",
        referenceIds,
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4_000
      }
    });

    expect(scene.id).toBe("scene-1");
    expect(scene.campaignId).toBe("campaign-1");
    expect(scene.status).toBe("draft_pending");

    referenceIds.push("asset-b");
    const snapshot = scene.snapshot();
    expect(snapshot).toMatchObject({
      status: "draft_pending",
      specRevision: 1,
      configuration: { referenceIds: ["asset-a"] }
    });
    expect(snapshot.approval).toBeUndefined();
    expect(snapshot.failedFrom).toBeUndefined();
    expect("approval" in snapshot).toBe(false);
    expect("failedFrom" in snapshot).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.configuration.referenceIds)).toBe(true);

    // Compile-time type assertion: CampaignId cannot occupy SceneId position
    Scene.create({
      // @ts-expect-error CampaignId cannot be assigned to SceneId
      id: "campaign-1" as CampaignId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "Test",
        referenceIds: [],
        engineProfileId: "engine-1",
        durationMs: 1000
      }
    });

    // Compile-time and runtime type assertion: status is readonly
    expect(() => {
      // @ts-expect-error status is readonly and has no setter
      scene.status = "approved";
    }).toThrow(TypeError);

    // Compile-time and runtime type assertion: id is readonly
    expect(() => {
      // @ts-expect-error id is readonly and has no setter
      scene.id = "scene-2" as SceneId;
    }).toThrow(TypeError);

    // Compile-time and runtime type assertion: campaignId is readonly
    expect(() => {
      // @ts-expect-error campaignId is readonly and has no setter
      scene.campaignId = "campaign-2" as CampaignId;
    }).toThrow(TypeError);
  });

  describe("typed domain errors", () => {
    it("instantiates InvalidTransitionError with default and custom messages", () => {
      const err = new InvalidTransitionError(
        "scene-1" as SceneId,
        "draft_pending",
        "start_rendering"
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidTransitionError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.currentStatus).toBe("draft_pending");
      expect(err.attemptedAction).toBe("start_rendering");
      expect(err.message).toBe(
        "Cannot perform 'start_rendering' on scene 'scene-1' with status 'draft_pending'."
      );

      const customErr = new InvalidTransitionError(
        "scene-1" as SceneId,
        "draft_pending",
        "start_rendering",
        "Custom transition failure"
      );
      expect(customErr.message).toBe("Custom transition failure");
    });

    it("instantiates InvalidMutationError with default and custom messages", () => {
      const err = new InvalidMutationError("scene-1" as SceneId, "rendering", "prompt");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidMutationError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.currentStatus).toBe("rendering");
      expect(err.field).toBe("prompt");
      expect(err.message).toBe("Cannot mutate 'prompt' on scene 'scene-1' in status 'rendering'.");

      const customErr = new InvalidMutationError(
        "scene-1" as SceneId,
        "rendering",
        "prompt",
        "Custom mutation failure"
      );
      expect(customErr.message).toBe("Custom mutation failure");
    });

    it("instantiates TerminalStateError with default and custom messages", () => {
      const err = new TerminalStateError("scene-1" as SceneId, "completed", "cancel");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("TerminalStateError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.terminalStatus).toBe("completed");
      expect(err.attemptedAction).toBe("cancel");
      expect(err.message).toBe(
        "Cannot perform 'cancel' on scene 'scene-1' in terminal state 'completed'."
      );

      const customErr = new TerminalStateError(
        "scene-1" as SceneId,
        "completed",
        "cancel",
        "Custom terminal failure"
      );
      expect(customErr.message).toBe("Custom terminal failure");
    });

    it("instantiates InvalidCandidateError with sceneId, candidateId, and reason", () => {
      const err = new InvalidCandidateError(
        "scene-1" as SceneId,
        "candidate-1" as CandidateId,
        "Candidate belongs to a different scene"
      );
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidCandidateError");
      expect(err.sceneId).toBe("scene-1");
      expect(err.candidateId).toBe("candidate-1");
      expect(err.reason).toBe("Candidate belongs to a different scene");
      expect(err.message).toBe(
        "Candidate 'candidate-1' is invalid for scene 'scene-1': Candidate belongs to a different scene"
      );
    });
  });

  describe("canonical lifecycle and failure recovery", () => {
    const fixedApprovalInput: SceneApprovalInput = {
      approvedBy: "director-1",
      approvedAt: "2026-08-14T10:00:00Z"
    };

    function createTestScene(): Scene {
      return Scene.create({
        id: "scene-1" as SceneId,
        campaignId: "campaign-1" as CampaignId,
        configuration: {
          prompt: "A product reveal",
          referenceIds: ["asset-a"],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4_000
        }
      });
    }

    it("allows every canonical scene transition through its behavior method", () => {
      interface TransitionTestCase {
        readonly from: SceneStatus;
        readonly description: string;
        readonly setup: () => Scene;
        readonly action: (scene: Scene) => SceneTransition;
        readonly to: SceneStatus;
        readonly reason: SceneTransitionReason;
      }

      const reachReview = (): Scene => {
        const scene = createTestScene();
        scene.beginCandidateGeneration();
        scene.submitCandidatesForReview();
        return scene;
      };

      const reachApproved = (): Scene => {
        const scene = reachReview();
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision,
          scene.id
        );
        scene.approve(fixedApprovalInput);
        return scene;
      };

      const reachQueued = (): Scene => {
        const scene = reachApproved();
        scene.queueForProduction();
        return scene;
      };

      const reachRendering = (): Scene => {
        const scene = reachQueued();
        scene.startRendering();
        return scene;
      };

      const reachQA = (): Scene => {
        const scene = reachRendering();
        scene.submitForQA();
        return scene;
      };

      const cases: readonly TransitionTestCase[] = [
        {
          from: "draft_pending",
          description: "draft_pending -> generating_candidates via beginCandidateGeneration",
          setup: () => createTestScene(),
          action: (s) => s.beginCandidateGeneration(),
          to: "generating_candidates",
          reason: "candidate_generation_started"
        },
        {
          from: "draft_pending",
          description: "draft_pending -> cancelled via cancel",
          setup: () => createTestScene(),
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        },
        {
          from: "generating_candidates",
          description: "generating_candidates -> director_review via submitCandidatesForReview",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            return s;
          },
          action: (s) => s.submitCandidatesForReview(),
          to: "director_review",
          reason: "candidates_submitted"
        },
        {
          from: "generating_candidates",
          description: "generating_candidates -> failed via fail",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            return s;
          },
          action: (s) => s.fail(),
          to: "failed",
          reason: "failed"
        },
        {
          from: "generating_candidates",
          description: "generating_candidates -> cancelled via cancel",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            return s;
          },
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        },
        {
          from: "director_review",
          description: "director_review -> generating_candidates via beginCandidateGeneration",
          setup: () => reachReview(),
          action: (s) => s.beginCandidateGeneration(),
          to: "generating_candidates",
          reason: "candidate_generation_started"
        },
        {
          from: "director_review",
          description: "director_review -> generating_candidates via requestReroll",
          setup: () => reachReview(),
          action: (s) => s.requestReroll(),
          to: "generating_candidates",
          reason: "reroll_requested"
        },
        {
          from: "director_review",
          description: "director_review -> approved via approve",
          setup: () => {
            const s = reachReview();
            s.selectCandidate("candidate-1" as CandidateId, s.snapshot().specRevision, s.id);
            return s;
          },
          action: (s) => s.approve(fixedApprovalInput),
          to: "approved",
          reason: "approved"
        },
        {
          from: "director_review",
          description: "director_review -> cancelled via cancel",
          setup: () => reachReview(),
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        },
        {
          from: "approved",
          description: "approved -> queued via queueForProduction",
          setup: () => reachApproved(),
          action: (s) => s.queueForProduction(),
          to: "queued",
          reason: "production_queued"
        },
        {
          from: "approved",
          description: "approved -> cancelled via cancel",
          setup: () => reachApproved(),
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        },
        {
          from: "queued",
          description: "queued -> rendering via startRendering",
          setup: () => reachQueued(),
          action: (s) => s.startRendering(),
          to: "rendering",
          reason: "rendering_started"
        },
        {
          from: "queued",
          description: "queued -> failed via fail",
          setup: () => reachQueued(),
          action: (s) => s.fail(),
          to: "failed",
          reason: "failed"
        },
        {
          from: "queued",
          description: "queued -> cancelled via cancel",
          setup: () => reachQueued(),
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        },
        {
          from: "rendering",
          description: "rendering -> qa via submitForQA",
          setup: () => reachRendering(),
          action: (s) => s.submitForQA(),
          to: "qa",
          reason: "submitted_for_qa"
        },
        {
          from: "rendering",
          description: "rendering -> failed via fail",
          setup: () => reachRendering(),
          action: (s) => s.fail(),
          to: "failed",
          reason: "failed"
        },
        {
          from: "rendering",
          description: "rendering -> cancelled via cancel",
          setup: () => reachRendering(),
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        },
        {
          from: "qa",
          description: "qa -> completed via acceptQA",
          setup: () => reachQA(),
          action: (s) => s.acceptQA(),
          to: "completed",
          reason: "qa_accepted"
        },
        {
          from: "qa",
          description: "qa -> director_review via rejectQA",
          setup: () => reachQA(),
          action: (s) => s.rejectQA(),
          to: "director_review",
          reason: "qa_rejected"
        },
        {
          from: "qa",
          description: "qa -> failed via fail",
          setup: () => reachQA(),
          action: (s) => s.fail(),
          to: "failed",
          reason: "failed"
        },
        {
          from: "failed",
          description: "failed (production) -> queued via queueForProduction",
          setup: () => {
            const s = reachQueued();
            s.fail();
            return s;
          },
          action: (s) => s.queueForProduction(),
          to: "queued",
          reason: "production_queued"
        },
        {
          from: "failed",
          description: "failed -> director_review via recoverToReview",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.fail();
            return s;
          },
          action: (s) => s.recoverToReview(),
          to: "director_review",
          reason: "recovered_to_review"
        },
        {
          from: "failed",
          description: "failed -> cancelled via cancel",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.fail();
            return s;
          },
          action: (s) => s.cancel(),
          to: "cancelled",
          reason: "cancelled"
        }
      ];

      for (const tc of cases) {
        const scene = tc.setup();
        expect(scene.status).toBe(tc.from);
        const transition = tc.action(scene);
        expect(scene.status).toBe(tc.to);
        expect(transition).toEqual({
          sceneId: scene.id,
          from: tc.from,
          to: tc.to,
          revision: 1,
          reason: tc.reason
        });
        expect(Object.isFrozen(transition)).toBe(true);
      }
    });

    it("rejects representative transitions absent from the canonical matrix", () => {
      interface ForbiddenTestCase {
        readonly description: string;
        readonly setup: () => Scene;
        readonly action: (scene: Scene) => void;
      }

      const reachReview = (): Scene => {
        const scene = createTestScene();
        scene.beginCandidateGeneration();
        scene.submitCandidatesForReview();
        return scene;
      };

      const reachApproved = (): Scene => {
        const scene = reachReview();
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision,
          scene.id
        );
        scene.approve(fixedApprovalInput);
        return scene;
      };

      const reachQueued = (): Scene => {
        const scene = reachApproved();
        scene.queueForProduction();
        return scene;
      };

      const reachRendering = (): Scene => {
        const scene = reachQueued();
        scene.startRendering();
        return scene;
      };

      const reachQA = (): Scene => {
        const scene = reachRendering();
        scene.submitForQA();
        return scene;
      };

      const forbiddenCases: readonly ForbiddenTestCase[] = [
        // Creative / draft
        {
          description: "draft_pending cannot approve directly",
          setup: () => createTestScene(),
          action: (s) => s.approve(fixedApprovalInput)
        },
        {
          description: "draft_pending cannot start rendering",
          setup: () => createTestScene(),
          action: (s) => s.startRendering()
        },
        {
          description: "draft_pending cannot fail before generation starts",
          setup: () => createTestScene(),
          action: (s) => s.fail()
        },
        // Generating candidates
        {
          description: "generating_candidates cannot queue for production",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            return s;
          },
          action: (s) => s.queueForProduction()
        },
        {
          description: "generating_candidates cannot accept QA",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            return s;
          },
          action: (s) => s.acceptQA()
        },
        // Director review
        {
          description: "director_review cannot start rendering directly",
          setup: () => reachReview(),
          action: (s) => s.startRendering()
        },
        {
          description: "director_review cannot submit for QA",
          setup: () => reachReview(),
          action: (s) => s.submitForQA()
        },
        {
          description: "director_review cannot fail directly",
          setup: () => reachReview(),
          action: (s) => s.fail()
        },
        // Approved
        {
          description: "approved cannot submit for QA",
          setup: () => reachApproved(),
          action: (s) => s.submitForQA()
        },
        {
          description: "approved cannot start rendering without queueing",
          setup: () => reachApproved(),
          action: (s) => s.startRendering()
        },
        {
          description: "approved cannot approve again",
          setup: () => reachApproved(),
          action: (s) => s.approve(fixedApprovalInput)
        },
        // Queued
        {
          description: "queued cannot submit for QA",
          setup: () => reachQueued(),
          action: (s) => s.submitForQA()
        },
        {
          description: "queued cannot approve",
          setup: () => reachQueued(),
          action: (s) => s.approve(fixedApprovalInput)
        },
        // Rendering
        {
          description: "rendering cannot approve",
          setup: () => reachRendering(),
          action: (s) => s.approve(fixedApprovalInput)
        },
        {
          description: "rendering cannot queue for production",
          setup: () => reachRendering(),
          action: (s) => s.queueForProduction()
        },
        // QA
        {
          description: "qa cannot cancel",
          setup: () => reachQA(),
          action: (s) => s.cancel()
        },
        {
          description: "qa cannot start rendering",
          setup: () => reachQA(),
          action: (s) => s.startRendering()
        },
        // Failure context
        {
          description: "failed from candidate generation cannot queue for production",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.fail();
            return s;
          },
          action: (s) => s.queueForProduction()
        },
        {
          description: "failed cannot start rendering directly",
          setup: () => {
            const s = reachQueued();
            s.fail();
            return s;
          },
          action: (s) => s.startRendering()
        },
        {
          description: "failed cannot submit for QA",
          setup: () => {
            const s = reachQueued();
            s.fail();
            return s;
          },
          action: (s) => s.submitForQA()
        }
      ];

      for (const tc of forbiddenCases) {
        const scene = tc.setup();
        const snapshotBefore = scene.snapshot();
        let caughtError: unknown;
        try {
          tc.action(scene);
        } catch (err) {
          caughtError = err;
        }

        expect(caughtError).toBeInstanceOf(InvalidTransitionError);
        const invErr = caughtError as InvalidTransitionError;
        expect(invErr.sceneId).toBe(scene.id);
        expect(invErr.currentStatus).toBe(snapshotBefore.status);
        expect(scene.snapshot()).toEqual(snapshotBefore);
      }
    });

    it("treats completed and cancelled scenes as terminal", () => {
      const reachCompleted = (): Scene => {
        const scene = createTestScene();
        scene.beginCandidateGeneration();
        scene.submitCandidatesForReview();
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision,
          scene.id
        );
        scene.approve(fixedApprovalInput);
        scene.queueForProduction();
        scene.startRendering();
        scene.submitForQA();
        scene.acceptQA();
        return scene;
      };

      const reachCancelled = (): Scene => {
        const scene = createTestScene();
        scene.cancel();
        return scene;
      };

      const terminalScenes = [reachCompleted(), reachCancelled()];

      const lifecycleActions: readonly {
        readonly name: string;
        readonly action: (s: Scene) => void;
      }[] = [
        { name: "beginCandidateGeneration", action: (s) => s.beginCandidateGeneration() },
        { name: "submitCandidatesForReview", action: (s) => s.submitCandidatesForReview() },
        { name: "approve", action: (s) => s.approve(fixedApprovalInput) },
        { name: "requestReroll", action: (s) => s.requestReroll() },
        { name: "queueForProduction", action: (s) => s.queueForProduction() },
        { name: "startRendering", action: (s) => s.startRendering() },
        { name: "submitForQA", action: (s) => s.submitForQA() },
        { name: "acceptQA", action: (s) => s.acceptQA() },
        { name: "rejectQA", action: (s) => s.rejectQA() },
        { name: "fail", action: (s) => s.fail() },
        { name: "recoverToReview", action: (s) => s.recoverToReview() },
        { name: "cancel", action: (s) => s.cancel() }
      ];

      for (const scene of terminalScenes) {
        expect(scene.status === "completed" || scene.status === "cancelled").toBe(true);

        for (const { action } of lifecycleActions) {
          const snapshotBefore = scene.snapshot();
          let caughtError: unknown;
          try {
            action(scene);
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(TerminalStateError);
          const termErr = caughtError as TerminalStateError;
          expect(termErr.name).toBe("TerminalStateError");
          expect(termErr.sceneId).toBe(scene.id);
          expect(termErr.terminalStatus).toBe(snapshotBefore.status);
          expect(scene.snapshot()).toEqual(snapshotBefore);
        }
      }
    });

    it("records failure origin and permits only approved production failures to retry", () => {
      // 1. Generation failure records generating_candidates and cannot retry directly to queued
      const s1 = createTestScene();
      s1.beginCandidateGeneration();
      const failTrans1 = s1.fail();
      expect(failTrans1.from).toBe("generating_candidates");
      expect(failTrans1.to).toBe("failed");
      expect(failTrans1.reason).toBe("failed");
      expect(s1.status).toBe("failed");
      expect(s1.snapshot().failedFrom).toBe("generating_candidates");
      expect(s1.snapshot().approval).toBeUndefined();

      const snapshotBeforeIllegalRetry = s1.snapshot();
      expect(() => s1.queueForProduction()).toThrow(InvalidTransitionError);
      expect(s1.snapshot()).toEqual(snapshotBeforeIllegalRetry);

      // Generation failure can recover to review, clearing failure provenance
      const recoverTrans1 = s1.recoverToReview();
      expect(recoverTrans1.from).toBe("failed");
      expect(recoverTrans1.to).toBe("director_review");
      expect(recoverTrans1.reason).toBe("recovered_to_review");
      expect(s1.status).toBe("director_review");
      expect(s1.snapshot().failedFrom).toBeUndefined();
      expect(s1.snapshot().approval).toBeUndefined();

      // 2. Production failure from queued records queued and permits retry to queued
      const s2 = createTestScene();
      s2.beginCandidateGeneration();
      s2.submitCandidatesForReview();
      s2.selectCandidate("candidate-1" as CandidateId, s2.snapshot().specRevision, s2.id);
      s2.approve(fixedApprovalInput);
      s2.queueForProduction();
      s2.fail();
      expect(s2.status).toBe("failed");
      expect(s2.snapshot().failedFrom).toBe("queued");
      expect(s2.snapshot().approval).toEqual({ revision: 1, ...fixedApprovalInput });

      const retryTrans2 = s2.queueForProduction();
      expect(retryTrans2.from).toBe("failed");
      expect(retryTrans2.to).toBe("queued");
      expect(retryTrans2.reason).toBe("production_queued");
      expect(s2.status).toBe("queued");
      expect(s2.snapshot().failedFrom).toBeUndefined();
      expect(s2.snapshot().approval).toEqual({ revision: 1, ...fixedApprovalInput });

      // 3. Production failure from rendering records rendering and permits retry
      const s3 = createTestScene();
      s3.beginCandidateGeneration();
      s3.submitCandidatesForReview();
      s3.selectCandidate("candidate-1" as CandidateId, s3.snapshot().specRevision, s3.id);
      s3.approve(fixedApprovalInput);
      s3.queueForProduction();
      s3.startRendering();
      s3.fail();
      expect(s3.status).toBe("failed");
      expect(s3.snapshot().failedFrom).toBe("rendering");

      const retryTrans3 = s3.queueForProduction();
      expect(retryTrans3.from).toBe("failed");
      expect(retryTrans3.to).toBe("queued");
      expect(s3.status).toBe("queued");
      expect(s3.snapshot().failedFrom).toBeUndefined();

      // 4. Production failure from qa records qa and permits retry
      const s4 = createTestScene();
      s4.beginCandidateGeneration();
      s4.submitCandidatesForReview();
      s4.selectCandidate("candidate-1" as CandidateId, s4.snapshot().specRevision, s4.id);
      s4.approve(fixedApprovalInput);
      s4.queueForProduction();
      s4.startRendering();
      s4.submitForQA();
      s4.fail();
      expect(s4.status).toBe("failed");
      expect(s4.snapshot().failedFrom).toBe("qa");

      const retryTrans4 = s4.queueForProduction();
      expect(retryTrans4.from).toBe("failed");
      expect(retryTrans4.to).toBe("queued");
      expect(s4.status).toBe("queued");
      expect(s4.snapshot().failedFrom).toBeUndefined();

      // 5. recoverToReview from a production failure clears approval and failure provenance
      const s5 = createTestScene();
      s5.beginCandidateGeneration();
      s5.submitCandidatesForReview();
      s5.selectCandidate("candidate-1" as CandidateId, s5.snapshot().specRevision, s5.id);
      s5.approve(fixedApprovalInput);
      s5.queueForProduction();
      s5.startRendering();
      s5.fail();
      expect(s5.snapshot().approval).toBeDefined();
      expect(s5.snapshot().failedFrom).toBe("rendering");

      const recoverTrans5 = s5.recoverToReview();
      expect(recoverTrans5.from).toBe("failed");
      expect(recoverTrans5.to).toBe("director_review");
      expect(s5.status).toBe("director_review");
      expect(s5.snapshot().approval).toBeUndefined();
      expect(s5.snapshot().failedFrom).toBeUndefined();
    });

    it("returns an immutable QA rejection transition without erasing prior state facts", () => {
      const scene = createTestScene();
      scene.beginCandidateGeneration();
      scene.submitCandidatesForReview();
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      scene.approve(fixedApprovalInput);
      scene.queueForProduction();
      scene.startRendering();
      scene.submitForQA();

      expect(scene.status).toBe("qa");
      expect(scene.snapshot().approval).toEqual({ revision: 1, ...fixedApprovalInput });

      const transition = scene.rejectQA();

      expect(Object.isFrozen(transition)).toBe(true);
      expect(transition).toEqual({
        sceneId: scene.id,
        from: "qa",
        to: "director_review",
        revision: 1,
        reason: "qa_rejected"
      });

      const snapshotAfterReject = scene.snapshot();
      expect(snapshotAfterReject.status).toBe("director_review");
      expect(snapshotAfterReject.approval).toBeUndefined();
      expect(snapshotAfterReject.failedFrom).toBeUndefined();
      expect(snapshotAfterReject.specRevision).toBe(1);

      // Drive later activity on scene
      scene.beginCandidateGeneration();
      scene.submitCandidatesForReview();
      const secondApprovalInput: SceneApprovalInput = {
        approvedBy: "director-2",
        approvedAt: "2026-08-14T12:00:00Z"
      };
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      scene.approve(secondApprovalInput);
      scene.queueForProduction();

      // Ensure transition fact object was not mutated by subsequent activity
      expect(transition.from).toBe("qa");
      expect(transition.to).toBe("director_review");
      expect(transition.reason).toBe("qa_rejected");
      expect(transition.revision).toBe(1);
      expect(transition.sceneId).toBe(scene.id);
    });
  });

  describe("creative mutations and revision-bound approval", () => {
    const fixedApprovalInput: SceneApprovalInput = {
      approvedBy: "director-1",
      approvedAt: "2026-08-14T10:00:00Z"
    };

    function createTestScene(overrides?: Partial<SceneConfiguration>): Scene {
      return Scene.create({
        id: "scene-1" as SceneId,
        campaignId: "campaign-1" as CampaignId,
        configuration: {
          prompt: "A product reveal",
          referenceIds: ["asset-a"],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4_000,
          ...overrides
        }
      });
    }

    it("binds approval metadata to the current scene revision", () => {
      const scene = createTestScene();
      const draftSnapshot = scene.snapshot();

      expect(() => scene.approve(fixedApprovalInput)).toThrow(InvalidTransitionError);
      expect(scene.snapshot()).toEqual(draftSnapshot);

      scene.beginCandidateGeneration();
      scene.submitCandidatesForReview();
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      const transition = scene.approve(fixedApprovalInput);

      expect(scene.status).toBe("approved");
      expect(transition).toEqual({
        sceneId: scene.id,
        from: "director_review",
        to: "approved",
        revision: 1,
        reason: "approved"
      });
      expect(Object.isFrozen(transition)).toBe(true);

      const snapshot = scene.snapshot();
      expect(snapshot.status).toBe("approved");
      expect(snapshot.specRevision).toBe(1);
      expect(snapshot.approval).toEqual({
        revision: 1,
        approvedBy: "director-1",
        approvedAt: "2026-08-14T10:00:00Z"
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.approval)).toBe(true);
    });

    it("invalidates approval for every creative mutation", () => {
      const mutations = [
        ["prompt", (scene: Scene) => scene.updatePrompt("A revised reveal")],
        ["references", (scene: Scene) => scene.updateReferences(["asset-b"])],
        ["engine", (scene: Scene) => scene.updateEngine("wan@certified-v2")],
        ["duration", (scene: Scene) => scene.updateDuration(6_000)],
        ["LoRA", (scene: Scene) => scene.updateLora("brand-style-v2")]
      ] as const;

      for (const [field, mutate] of mutations) {
        const scene = createTestScene();
        scene.beginCandidateGeneration();
        scene.submitCandidatesForReview();
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision,
          scene.id
        );
        scene.approve(fixedApprovalInput);

        expect(scene.status).toBe("approved");
        expect(scene.snapshot().specRevision).toBe(1);
        expect(scene.snapshot().approval).toBeDefined();

        const transition = mutate(scene);

        expect(Object.isFrozen(transition)).toBe(true);
        expect(transition).toEqual({
          sceneId: scene.id,
          from: "approved",
          to: "director_review",
          revision: 2,
          reason: "configuration_changed"
        });

        const snapshot = scene.snapshot();
        expect(scene.status).toBe("director_review");
        expect(snapshot.status).toBe("director_review");
        expect(snapshot.specRevision).toBe(2);
        expect(snapshot.approval).toBeUndefined();
        expect("approval" in snapshot).toBe(false);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.configuration)).toBe(true);
        expect(Object.isFrozen(snapshot.configuration.referenceIds)).toBe(true);

        if (field === "prompt") {
          expect(snapshot.configuration.prompt).toBe("A revised reveal");
          expect(snapshot.configuration.referenceIds).toEqual(["asset-a"]);
          expect(snapshot.configuration.engineProfileId).toBe("ltx-2.5@certified-v1");
          expect(snapshot.configuration.durationMs).toBe(4_000);
        } else if (field === "references") {
          expect(snapshot.configuration.prompt).toBe("A product reveal");
          expect(snapshot.configuration.referenceIds).toEqual(["asset-b"]);
          expect(snapshot.configuration.engineProfileId).toBe("ltx-2.5@certified-v1");
          expect(snapshot.configuration.durationMs).toBe(4_000);
        } else if (field === "engine") {
          expect(snapshot.configuration.prompt).toBe("A product reveal");
          expect(snapshot.configuration.referenceIds).toEqual(["asset-a"]);
          expect(snapshot.configuration.engineProfileId).toBe("wan@certified-v2");
          expect(snapshot.configuration.durationMs).toBe(4_000);
        } else if (field === "duration") {
          expect(snapshot.configuration.prompt).toBe("A product reveal");
          expect(snapshot.configuration.referenceIds).toEqual(["asset-a"]);
          expect(snapshot.configuration.engineProfileId).toBe("ltx-2.5@certified-v1");
          expect(snapshot.configuration.durationMs).toBe(6_000);
        } else if (field === "LoRA") {
          expect(snapshot.configuration.prompt).toBe("A product reveal");
          expect(snapshot.configuration.referenceIds).toEqual(["asset-a"]);
          expect(snapshot.configuration.engineProfileId).toBe("ltx-2.5@certified-v1");
          expect(snapshot.configuration.durationMs).toBe(4_000);
          expect(snapshot.configuration.loraConfigurationId).toBe("brand-style-v2");
        }
      }

      // Second LoRA assertion: updateLora() with no argument removes existing optional identity while advancing revision
      const sceneWithLora = createTestScene({ loraConfigurationId: "brand-style-v1" });
      sceneWithLora.beginCandidateGeneration();
      sceneWithLora.submitCandidatesForReview();
      sceneWithLora.selectCandidate(
        "candidate-1" as CandidateId,
        sceneWithLora.snapshot().specRevision,
        sceneWithLora.id
      );
      sceneWithLora.approve(fixedApprovalInput);

      expect(sceneWithLora.snapshot().configuration.loraConfigurationId).toBe("brand-style-v1");

      const transitionWithoutLora = sceneWithLora.updateLora();

      expect(Object.isFrozen(transitionWithoutLora)).toBe(true);
      expect(transitionWithoutLora).toEqual({
        sceneId: sceneWithLora.id,
        from: "approved",
        to: "director_review",
        revision: 2,
        reason: "configuration_changed"
      });

      const snapshotWithoutLora = sceneWithLora.snapshot();
      expect(snapshotWithoutLora.status).toBe("director_review");
      expect(snapshotWithoutLora.specRevision).toBe(2);
      expect(snapshotWithoutLora.approval).toBeUndefined();
      expect("approval" in snapshotWithoutLora).toBe(false);
      expect(snapshotWithoutLora.configuration.loraConfigurationId).toBeUndefined();
      expect("loraConfigurationId" in snapshotWithoutLora.configuration).toBe(false);
    });

    it("keeps editable non-approved scenes in place while advancing revision", () => {
      type EditableSetup = {
        readonly state: SceneStatus;
        readonly setup: () => Scene;
      };

      const editableSetups: readonly EditableSetup[] = [
        {
          state: "draft_pending",
          setup: () => createTestScene()
        },
        {
          state: "director_review",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.submitCandidatesForReview();
            return s;
          }
        }
      ];

      const mutations = [
        ["prompt", (scene: Scene) => scene.updatePrompt("Draft revised prompt")],
        ["references", (scene: Scene) => scene.updateReferences(["asset-c"])],
        ["engine", (scene: Scene) => scene.updateEngine("flux-schnell@v1")],
        ["duration", (scene: Scene) => scene.updateDuration(3_000)],
        ["LoRA", (scene: Scene) => scene.updateLora("brand-style-v3")]
      ] as const;

      for (const { state, setup } of editableSetups) {
        for (const [field, mutate] of mutations) {
          const scene = setup();
          expect(scene.status).toBe(state);
          expect(scene.snapshot().specRevision).toBe(1);

          const transition = mutate(scene);

          expect(Object.isFrozen(transition)).toBe(true);
          expect(transition).toEqual({
            sceneId: scene.id,
            from: state,
            to: state,
            revision: 2,
            reason: "configuration_changed"
          });

          const snapshot = scene.snapshot();
          expect(scene.status).toBe(state);
          expect(snapshot.status).toBe(state);
          expect(snapshot.specRevision).toBe(2);
          expect(snapshot.approval).toBeUndefined();
          expect("approval" in snapshot).toBe(false);
          expect(Object.isFrozen(snapshot)).toBe(true);
          expect(Object.isFrozen(snapshot.configuration)).toBe(true);
          expect(Object.isFrozen(snapshot.configuration.referenceIds)).toBe(true);

          if (field === "prompt") {
            expect(snapshot.configuration.prompt).toBe("Draft revised prompt");
          } else if (field === "references") {
            expect(snapshot.configuration.referenceIds).toEqual(["asset-c"]);
          } else if (field === "engine") {
            expect(snapshot.configuration.engineProfileId).toBe("flux-schnell@v1");
          } else if (field === "duration") {
            expect(snapshot.configuration.durationMs).toBe(3_000);
          } else if (field === "LoRA") {
            expect(snapshot.configuration.loraConfigurationId).toBe("brand-style-v3");
          }
        }
      }
    });

    it("rejects creative mutation during generation and production", () => {
      const busyStates: readonly { readonly state: SceneStatus; readonly setup: () => Scene }[] = [
        {
          state: "generating_candidates",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            return s;
          }
        },
        {
          state: "queued",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.submitCandidatesForReview();
            s.selectCandidate("candidate-1" as CandidateId, s.snapshot().specRevision, s.id);
            s.approve(fixedApprovalInput);
            s.queueForProduction();
            return s;
          }
        },
        {
          state: "rendering",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.submitCandidatesForReview();
            s.selectCandidate("candidate-1" as CandidateId, s.snapshot().specRevision, s.id);
            s.approve(fixedApprovalInput);
            s.queueForProduction();
            s.startRendering();
            return s;
          }
        },
        {
          state: "qa",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.submitCandidatesForReview();
            s.selectCandidate("candidate-1" as CandidateId, s.snapshot().specRevision, s.id);
            s.approve(fixedApprovalInput);
            s.queueForProduction();
            s.startRendering();
            s.submitForQA();
            return s;
          }
        },
        {
          state: "failed",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.fail();
            return s;
          }
        }
      ];

      const mutations = [
        { field: "prompt", action: (scene: Scene) => scene.updatePrompt("Illegal edit") },
        { field: "references", action: (scene: Scene) => scene.updateReferences(["asset-x"]) },
        { field: "engine", action: (scene: Scene) => scene.updateEngine("illegal-engine") },
        { field: "duration", action: (scene: Scene) => scene.updateDuration(5_000) },
        { field: "lora", action: (scene: Scene) => scene.updateLora("illegal-lora") }
      ] as const;

      for (const { state, setup } of busyStates) {
        for (const { field, action } of mutations) {
          const scene = setup();
          expect(scene.status).toBe(state);
          const snapshotBefore = scene.snapshot();

          let caughtError: unknown;
          try {
            action(scene);
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(InvalidMutationError);
          const mutErr = caughtError as InvalidMutationError;
          expect(mutErr.name).toBe("InvalidMutationError");
          expect(mutErr.sceneId).toBe(scene.id);
          expect(mutErr.currentStatus).toBe(state);
          expect(mutErr.field).toBe(field);
          expect(mutErr.message).toBe(
            `Cannot mutate '${field}' on scene '${scene.id}' in status '${state}'.`
          );

          // Atomic snapshot preservation
          expect(scene.snapshot()).toEqual(snapshotBefore);
        }
      }
    });

    it("rejects every creative mutation in terminal states", () => {
      const terminalStates: readonly {
        readonly state: SceneStatus;
        readonly setup: () => Scene;
      }[] = [
        {
          state: "completed",
          setup: () => {
            const s = createTestScene();
            s.beginCandidateGeneration();
            s.submitCandidatesForReview();
            s.selectCandidate("candidate-1" as CandidateId, s.snapshot().specRevision, s.id);
            s.approve(fixedApprovalInput);
            s.queueForProduction();
            s.startRendering();
            s.submitForQA();
            s.acceptQA();
            return s;
          }
        },
        {
          state: "cancelled",
          setup: () => {
            const s = createTestScene();
            s.cancel();
            return s;
          }
        }
      ];

      const mutations = [
        {
          actionName: "updatePrompt",
          action: (scene: Scene) => scene.updatePrompt("Terminal edit")
        },
        {
          actionName: "updateReferences",
          action: (scene: Scene) => scene.updateReferences(["asset-x"])
        },
        {
          actionName: "updateEngine",
          action: (scene: Scene) => scene.updateEngine("terminal-engine")
        },
        { actionName: "updateDuration", action: (scene: Scene) => scene.updateDuration(5_000) },
        { actionName: "updateLora", action: (scene: Scene) => scene.updateLora("terminal-lora") }
      ] as const;

      for (const { state, setup } of terminalStates) {
        for (const { actionName, action } of mutations) {
          const scene = setup();
          expect(scene.status).toBe(state);
          const snapshotBefore = scene.snapshot();

          let caughtError: unknown;
          try {
            action(scene);
          } catch (err) {
            caughtError = err;
          }

          expect(caughtError).toBeInstanceOf(TerminalStateError);
          const termErr = caughtError as TerminalStateError;
          expect(termErr.name).toBe("TerminalStateError");
          expect(termErr.sceneId).toBe(scene.id);
          expect(termErr.terminalStatus).toBe(state);
          expect(termErr.attemptedAction).toBe(actionName);
          expect(termErr.message).toBe(
            `Cannot perform '${actionName}' on scene '${scene.id}' in terminal state '${state}'.`
          );

          // Atomic snapshot preservation
          expect(scene.snapshot()).toEqual(snapshotBefore);
        }
      }
    });
  });

  describe("Candidate Selection", () => {
    function createReviewScene(): Scene {
      const scene = Scene.create({
        id: "scene-1" as SceneId,
        campaignId: "campaign-1" as CampaignId,
        configuration: {
          prompt: "A product reveal",
          referenceIds: ["asset-a"],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4_000
        }
      });
      scene.beginCandidateGeneration();
      scene.submitCandidatesForReview();
      return scene;
    }

    it("selectCandidate in director_review sets selection state and returns transition", () => {
      const scene = createReviewScene();
      const transition = scene.selectCandidate(
        "candidate-1" as CandidateId,
        scene.snapshot().specRevision,
        scene.id
      );

      expect(transition).toEqual({
        sceneId: scene.id,
        from: "director_review",
        to: "director_review",
        revision: 1,
        reason: "candidate_selected"
      });
      expect(Object.isFrozen(transition)).toBe(true);

      const snap = scene.snapshot();
      expect(snap.selectedCandidateId).toBe("candidate-1");
      expect(snap.selectedCandidateRevision).toBe(1);
      expect(Object.isFrozen(snap)).toBe(true);
    });

    it("selectCandidate with mismatched sceneId throws InvalidCandidateError", () => {
      const scene = createReviewScene();
      expect(() =>
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision,
          "wrong-scene" as SceneId
        )
      ).toThrowError(InvalidCandidateError);
      expect(scene.snapshot().selectedCandidateId).toBeUndefined();
    });

    it("selectCandidate with stale revision throws InvalidCandidateError", () => {
      const scene = createReviewScene();
      expect(() =>
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision - 1,
          scene.id
        )
      ).toThrowError(InvalidCandidateError);
      expect(scene.snapshot().selectedCandidateId).toBeUndefined();
    });

    it("selectCandidate with future revision throws InvalidCandidateError", () => {
      const scene = createReviewScene();
      expect(() =>
        scene.selectCandidate(
          "candidate-1" as CandidateId,
          scene.snapshot().specRevision + 1,
          scene.id
        )
      ).toThrowError(InvalidCandidateError);
      expect(scene.snapshot().selectedCandidateId).toBeUndefined();
    });

    it("selectCandidate in non-director_review status throws InvalidTransitionError", () => {
      const draftScene = Scene.create({
        id: "scene-1" as SceneId,
        campaignId: "campaign-1" as CampaignId,
        configuration: {
          prompt: "A product reveal",
          referenceIds: ["asset-a"],
          engineProfileId: "ltx-2.5@certified-v1",
          durationMs: 4_000
        }
      });
      expect(() =>
        draftScene.selectCandidate(
          "candidate-1" as CandidateId,
          draftScene.snapshot().specRevision,
          draftScene.id
        )
      ).toThrow(InvalidTransitionError);
    });

    it("selectCandidate in terminal status throws TerminalStateError", () => {
      const cancelledScene = createReviewScene();
      cancelledScene.cancel();
      expect(() =>
        cancelledScene.selectCandidate("candidate-1" as CandidateId, 1, cancelledScene.id)
      ).toThrow(TerminalStateError);
    });

    it("approve throws InvalidTransitionError if no candidate is selected", () => {
      const scene = createReviewScene();
      expect(scene.snapshot().selectedCandidateId).toBeUndefined();
      expect(() =>
        scene.approve({ approvedBy: "test", approvedAt: "2024-01-01T00:00:00Z" })
      ).toThrow(InvalidTransitionError);
      expect(() =>
        scene.approve({ approvedBy: "test", approvedAt: "2024-01-01T00:00:00Z" })
      ).toThrow("Approval requires a valid candidate selection from revision 1.");
    });

    it("approve succeeds when candidate is selected and revision matches", () => {
      const scene = createReviewScene();
      scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
      const transition = scene.approve({
        approvedBy: "director-1",
        approvedAt: "2024-01-01T00:00:00Z"
      });

      expect(scene.status).toBe("approved");
      expect(transition.to).toBe("approved");
      expect(scene.snapshot().approval).toEqual({
        revision: 1,
        approvedBy: "director-1",
        approvedAt: "2024-01-01T00:00:00Z"
      });
      expect(scene.snapshot().selectedCandidateId).toBe("candidate-1");
    });
  });
});
