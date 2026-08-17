import { describe, expect, it } from "vitest";
import {
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type QueueRenderInput,
  type RenderEnginePort,
  type RenderQueueReceipt,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import { Scene, type CampaignId, type CandidateId, type SceneId } from "@cco/domain";
import {
  controlApiName,
  createControlApi,
  createControlApiContainer,
  createControlApiServices
} from "./index.js";

class FakeUnitOfWork implements UnitOfWork {
  readonly savedScenes: Scene[] = [];
  private readonly sceneMap = new Map<SceneId, Scene>();

  constructor(scenes: Scene[] = []) {
    for (const scene of scenes) {
      this.sceneMap.set(scene.id, scene);
    }
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const context: UnitOfWorkContext = {
      scenes: {
        findById: async (id: SceneId) => this.sceneMap.get(id),
        save: async (scene: Scene) => {
          this.savedScenes.push(scene);
          this.sceneMap.set(scene.id, scene);
        }
      },
      reviewEvents: {
        append: async () => {}
      },
      candidates: {
        findById: async () => undefined,
        save: async () => {},
        findBySceneRevision: async () => []
      }
    };
    return work(context);
  }
}

describe("control-api composition root", () => {
  const createApprovedScene = (id: string = "scene-1"): Scene => {
    const scene = Scene.create({
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
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate("candidate-1" as CandidateId, scene.snapshot().specRevision, scene.id);
    scene.approve({
      approvedBy: "Director Alice",
      approvedAt: "2026-08-15T00:00:00.000Z"
    });
    return scene;
  };

  it("exports the control-api module name", () => {
    expect(controlApiName).toBe("control-api");
  });

  it("creates a DI container wiring dependencies to ReviewSceneUseCases and ProgressSceneProductionUseCases", () => {
    const uow = new FakeUnitOfWork();
    const queuedRequests: QueueRenderInput[] = [];
    const renderEngine: RenderEnginePort = {
      async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
        queuedRequests.push(input);
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: "2026-08-15T01:00:00.000Z"
        };
      },
      async getRenderResult() {
        return undefined;
      },
      async unloadModels() {}
    };

    const container = createControlApiContainer({ uow, renderEngine });

    expect(container.dependencies.uow).toBe(uow);
    expect(container.dependencies.renderEngine).toBe(renderEngine);
    expect(container.useCases.reviewScene).toBeInstanceOf(ReviewSceneUseCases);
    expect(container.useCases.progressSceneProduction).toBeInstanceOf(
      ProgressSceneProductionUseCases
    );
  });

  it("creates services shortcut and executes use cases through the composition root", async () => {
    const scene = createApprovedScene("scene-root-1");
    const uow = new FakeUnitOfWork([scene]);
    const queuedRequests: QueueRenderInput[] = [];
    const renderEngine: RenderEnginePort = {
      async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
        queuedRequests.push(input);
        return {
          executionId: `exec-${input.renderJobId}`,
          acceptedAt: "2026-08-15T01:00:00.000Z"
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

    const services = createControlApiServices({ uow, renderEngine });
    const receipt = await services.progressSceneProduction.queue({
      sceneId: "scene-root-1",
      renderJobId: "job-root-1",
      workflow
    });

    expect(receipt).toEqual({
      executionId: "exec-job-root-1",
      acceptedAt: "2026-08-15T01:00:00.000Z"
    });
    expect(queuedRequests).toHaveLength(1);
    expect(queuedRequests[0]).toEqual({
      sceneId: "scene-root-1",
      renderJobId: "job-root-1",
      renderProfileKey: "ltx_25",
      workflow
    });

    const saved = uow.savedScenes[0]!;
    expect(saved.id).toBe("scene-root-1");
    expect(saved.status).toBe("queued");
  });

  it("createControlApi creates a fully functional container", () => {
    const uow = new FakeUnitOfWork();
    const container = createControlApi({ uow });
    expect(container.dependencies.uow).toBe(uow);
    expect(container.useCases.reviewScene).toBeInstanceOf(ReviewSceneUseCases);
    expect(container.useCases.progressSceneProduction).toBeInstanceOf(
      ProgressSceneProductionUseCases
    );
  });
});
