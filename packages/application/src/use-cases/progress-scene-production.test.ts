import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  Scene,
  type CampaignId,
  type SceneId,
  type SceneStatus
} from "@cco/domain";
import type {
  QueueRenderInput,
  RenderEnginePort,
  RenderQueueReceipt
} from "../ports/render-engine-port.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { ProgressSceneProductionUseCases } from "./progress-scene-production.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

describe("ProgressSceneProductionUseCases", () => {
  const createDraftScene = (id: string = "scene-1"): Scene => {
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

  const createGeneratingCandidatesScene = (id: string = "scene-1"): Scene => {
    const scene = createDraftScene(id);
    scene.beginCandidateGeneration();
    return scene;
  };

  const createDirectorReviewScene = (id: string = "scene-1"): Scene => {
    const scene = createGeneratingCandidatesScene(id);
    scene.submitCandidatesForReview();
    return scene;
  };

  const createApprovedScene = (id: string = "scene-1"): Scene => {
    const scene = createDirectorReviewScene(id);
    scene.approve({
      approvedBy: "Director Alice",
      approvedAt: "2026-08-15T00:00:00.000Z"
    });
    return scene;
  };

  const createQueuedScene = (id: string = "scene-1"): Scene => {
    const scene = createApprovedScene(id);
    scene.queueForProduction();
    return scene;
  };

  const createRenderingScene = (id: string = "scene-1"): Scene => {
    const scene = createQueuedScene(id);
    scene.startRendering();
    return scene;
  };

  const createQAScene = (id: string = "scene-1"): Scene => {
    const scene = createRenderingScene(id);
    scene.submitForQA();
    return scene;
  };

  const createFailedScene = (id: string = "scene-1", from: SceneStatus = "rendering"): Scene => {
    let scene: Scene;
    switch (from) {
      case "generating_candidates":
        scene = createGeneratingCandidatesScene(id);
        break;
      case "queued":
        scene = createQueuedScene(id);
        break;
      case "rendering":
        scene = createRenderingScene(id);
        break;
      case "qa":
        scene = createQAScene(id);
        break;
      default:
        throw new Error(`Unsupported failed from state in fixture: ${from}`);
    }
    scene.fail();
    return scene;
  };

  it("candidate generation start: draft_pending and director_review transition to generating_candidates and save without a review event", async () => {
    const cases: Array<{
      readonly name: string;
      readonly createFixture: (id: string) => Scene;
    }> = [
      {
        name: "draft_pending",
        createFixture: createDraftScene
      },
      {
        name: "director_review",
        createFixture: createDirectorReviewScene
      }
    ];

    for (const testCase of cases) {
      const sceneId = `scene-begin-gen-${testCase.name}`;
      const scene = testCase.createFixture(sceneId);
      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ProgressSceneProductionUseCases(uow);

      await useCases.beginCandidateGeneration({ sceneId });

      expect(uow.savedScenes).toHaveLength(1);
      const savedScene = uow.savedScenes[0]!;
      expect(savedScene.id).toBe(sceneId);
      expect(savedScene.status).toBe("generating_candidates");
      expect(uow.reviewEvents).toHaveLength(0);
    }
  });

  it("candidate submission: generating_candidates transitions to director_review and saves without a review event", async () => {
    const scene = createGeneratingCandidatesScene("scene-submit-cand-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ProgressSceneProductionUseCases(uow);

    await useCases.submitCandidatesForReview({ sceneId: "scene-submit-cand-1" });

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-submit-cand-1");
    expect(savedScene.status).toBe("director_review");
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("queue: approved transitions to queued and saves without a review event", async () => {
    const scene = createApprovedScene("scene-queue-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ProgressSceneProductionUseCases(uow);
    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42 }
      }
    } satisfies Readonly<Record<string, unknown>>;

    const receipt = await useCases.queue({ sceneId: "scene-queue-1", workflow });

    expect(receipt).toBeUndefined();
    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-queue-1");
    expect(savedScene.status).toBe("queued");
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("queue: forwards the API-format workflow unchanged to RenderEnginePort", async () => {
    const scene = createApprovedScene("scene-queue-engine-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const queuedRequests: QueueRenderInput[] = [];
    const renderEngine: RenderEnginePort = {
      async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
        queuedRequests.push(input);
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: "2026-08-15T02:00:00.000Z"
        };
      },
      async getRenderResult() {
        return undefined;
      },
      async unloadModels() {}
    };

    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42 }
      }
    } satisfies Readonly<Record<string, unknown>>;

    const useCases = new ProgressSceneProductionUseCases(uow, renderEngine);
    const receipt = await useCases.queue({
      sceneId: "scene-queue-engine-1",
      workflow
    });

    expect(receipt).toEqual({
      executionId: "exec-scene-queue-engine-1",
      acceptedAt: "2026-08-15T02:00:00.000Z"
    });
    expect(queuedRequests).toHaveLength(1);
    expect(queuedRequests[0]).toEqual({
      sceneId: "scene-queue-engine-1",
      renderJobId: "scene-queue-engine-1",
      renderProfileKey: "ltx_25",
      workflow
    });
    expect(queuedRequests[0]?.workflow).toBe(workflow);
    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.savedScenes[0]!.status).toBe("queued");
  });

  it("queue: invokes RenderEnginePort.queueRender with custom renderJobId and renderProfileKey", async () => {
    const scene = createApprovedScene("scene-queue-custom-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const queuedRequests: QueueRenderInput[] = [];
    const renderEngine: RenderEnginePort = {
      async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
        queuedRequests.push(input);
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: "2026-08-15T03:00:00.000Z"
        };
      },
      async getRenderResult() {
        return undefined;
      },
      async unloadModels() {}
    };

    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42 }
      }
    } satisfies Readonly<Record<string, unknown>>;

    const useCases = new ProgressSceneProductionUseCases(uow, renderEngine);
    const receipt = await useCases.queue({
      sceneId: "scene-queue-custom-1",
      renderJobId: "job-custom-123",
      renderProfileKey: "LTX_25_720P_5S_V1",
      workflow
    });

    expect(receipt).toEqual({
      executionId: "exec-job-custom-123",
      acceptedAt: "2026-08-15T03:00:00.000Z"
    });
    expect(queuedRequests).toHaveLength(1);
    expect(queuedRequests[0]).toEqual({
      sceneId: "scene-queue-custom-1",
      renderJobId: "job-custom-123",
      renderProfileKey: "LTX_25_720P_5S_V1",
      workflow
    });
  });

  it("queue: does not invoke RenderEnginePort or inspect workflow when transition is invalid", async () => {
    const draftScene = createDraftScene("scene-invalid-draft");
    const uow = new InMemorySceneUnitOfWork([draftScene]);
    let queueRenderCalled = false;
    const renderEngine: RenderEnginePort = {
      async queueRender() {
        queueRenderCalled = true;
        return { executionId: "exec-1", acceptedAt: "2026-08-15T00:00:00.000Z" };
      },
      async getRenderResult() {
        return undefined;
      },
      async unloadModels() {}
    };

    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42 }
      }
    } satisfies Readonly<Record<string, unknown>>;

    const useCases = new ProgressSceneProductionUseCases(uow, renderEngine);
    await expect(useCases.queue({ sceneId: "scene-invalid-draft", workflow })).rejects.toThrow(
      InvalidTransitionError
    );

    expect(queueRenderCalled).toBe(false);
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("render start: queued transitions to rendering and saves without a review event", async () => {
    const scene = createQueuedScene("scene-render-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ProgressSceneProductionUseCases(uow);

    await useCases.markRenderingStarted({ sceneId: "scene-render-1" });

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-render-1");
    expect(savedScene.status).toBe("rendering");
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("QA submission: rendering transitions to qa and saves without a review event", async () => {
    const scene = createRenderingScene("scene-qa-sub-1");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ProgressSceneProductionUseCases(uow);

    await useCases.submitForQA({ sceneId: "scene-qa-sub-1" });

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-qa-sub-1");
    expect(savedScene.status).toBe("qa");
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("failure: each domain-allowed production state transitions to failed and saves once", async () => {
    const failureSources: readonly SceneStatus[] = [
      "generating_candidates",
      "queued",
      "rendering",
      "qa"
    ];

    for (const source of failureSources) {
      const sceneId = `scene-fail-${source}`;
      let scene: Scene;
      switch (source) {
        case "generating_candidates":
          scene = createGeneratingCandidatesScene(sceneId);
          break;
        case "queued":
          scene = createQueuedScene(sceneId);
          break;
        case "rendering":
          scene = createRenderingScene(sceneId);
          break;
        case "qa":
          scene = createQAScene(sceneId);
          break;
        default:
          throw new Error(`Unexpected source state: ${source}`);
      }

      const uow = new InMemorySceneUnitOfWork([scene]);
      const useCases = new ProgressSceneProductionUseCases(uow);

      await useCases.fail({ sceneId });

      expect(uow.savedScenes).toHaveLength(1);
      const savedScene = uow.savedScenes[0]!;
      expect(savedScene.id).toBe(sceneId);
      expect(savedScene.status).toBe("failed");
      expect(savedScene.snapshot().failedFrom).toBe(source);
      expect(uow.reviewEvents).toHaveLength(0);
    }
  });

  it("failure recovery: failed transitions to director_review and saves without a review event", async () => {
    const scene = createFailedScene("scene-recover-1", "rendering");
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCases = new ProgressSceneProductionUseCases(uow);

    await useCases.recoverToReview({ sceneId: "scene-recover-1" });

    expect(uow.savedScenes).toHaveLength(1);
    const savedScene = uow.savedScenes[0]!;
    expect(savedScene.id).toBe("scene-recover-1");
    expect(savedScene.status).toBe("director_review");
    expect(savedScene.snapshot().approval).toBeUndefined();
    expect(savedScene.snapshot().failedFrom).toBeUndefined();
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("invalid production transition preserves the domain error and commits no save", async () => {
    const draftScene = createDraftScene("scene-invalid-trans");
    const uow = new InMemorySceneUnitOfWork([draftScene]);
    const useCases = new ProgressSceneProductionUseCases(uow);
    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42 }
      }
    } satisfies Readonly<Record<string, unknown>>;

    // Attempting queue from draft_pending should throw InvalidTransitionError
    await expect(useCases.queue({ sceneId: "scene-invalid-trans", workflow })).rejects.toThrow(
      InvalidTransitionError
    );

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);

    // Attempting markRenderingStarted from draft_pending should throw InvalidTransitionError
    await expect(useCases.markRenderingStarted({ sceneId: "scene-invalid-trans" })).rejects.toThrow(
      InvalidTransitionError
    );

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);

    // Attempting fail from draft_pending should throw InvalidTransitionError
    await expect(useCases.fail({ sceneId: "scene-invalid-trans" })).rejects.toThrow(
      InvalidTransitionError
    );

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);

    // Attempting recoverToReview from draft_pending should throw InvalidTransitionError
    await expect(useCases.recoverToReview({ sceneId: "scene-invalid-trans" })).rejects.toThrow(
      InvalidTransitionError
    );

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("missing production scene throws SceneNotFoundError and commits no writes", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCases = new ProgressSceneProductionUseCases(uow);

    const promise = useCases.beginCandidateGeneration({
      sceneId: "non-existent-scene"
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
});
