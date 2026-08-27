import { describe, expect, it, vi } from "vitest";
import {
  EnforceStorageAdmission,
  ProgressSceneProductionUseCases,
  ReviewSceneUseCases,
  type QueueRenderInput,
  type RenderEnginePort,
  type RenderQueueReceipt,
  type ReviewMediaDeliveryPort,
  type SceneReviewQueries,
  type StorageMetricsRegistryPort,
  type StorageTelemetryPort,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import { Scene, type CampaignId, type CandidateId, type SceneId } from "@cco/domain";
import {
  controlApiName,
  createControlApi,
  createControlApiApp,
  createControlApiContainer,
  createControlApiServices,
  startControlApiServer
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
        findById: async () => undefined,
        append: async () => {}
      },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
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

    const sceneReviewQueries: SceneReviewQueries = {
      async getSceneReviewDetail() {
        return undefined;
      },
      async getCampaignReviewSummary() {
        return undefined;
      }
    };

    const reviewMediaDelivery: ReviewMediaDeliveryPort = {
      async generatePresignedReadUrl() {
        return "https://storage.local/presigned-url";
      }
    };

    const container = createControlApiContainer({
      uow,
      renderEngine,
      sceneReviewQueries,
      reviewMediaDelivery
    });

    expect(container.dependencies.uow).toBe(uow);
    expect(container.dependencies.renderEngine).toBe(renderEngine);
    expect(container.dependencies.sceneReviewQueries).toBe(sceneReviewQueries);
    expect(container.dependencies.reviewMediaDelivery).toBe(reviewMediaDelivery);
    expect(container.queries.sceneReview).toBe(sceneReviewQueries);
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
    expect(container.useCases.reviewScene).toBeInstanceOf(ReviewSceneUseCases);
    expect(container.useCases.progressSceneProduction).toBeInstanceOf(
      ProgressSceneProductionUseCases
    );
    expect(container.queries.sceneReview).toBeUndefined();
  });

  it("createControlApiApp creates a Fastify instance from dependencies or container", async () => {
    const uow = new FakeUnitOfWork();
    const app = createControlApiApp({ uow });
    expect(app).toBeDefined();
    await app.ready();
    await app.close();
  });

  it("server-listen-close: starts on configured or ephemeral port and closes cleanly", async () => {
    const uow = new FakeUnitOfWork();
    const server = await startControlApiServer({ uow }, { host: "127.0.0.1", port: 0 });

    expect(server.app).toBeDefined();
    expect(server.host).toBe("127.0.0.1");
    expect(typeof server.port).toBe("number");
    expect(server.port).toBeGreaterThan(0);
    expect(server.app.server.listening).toBe(true);

    await server.close();
    expect(server.app.server.listening).toBe(false);
  });

  describe("storage admission", () => {
    it("container shares telemetry and metrics with write admission", async () => {
      const uow = new FakeUnitOfWork();
      const telemetryPort: StorageTelemetryPort = {
        getStorageTelemetry: vi.fn().mockResolvedValue({
          totalBytes: 100,
          usedBytes: 50,
          freeBytes: 50,
          buckets: [],
          measuredAt: "2026-08-27T00:00:00.000Z"
        })
      };
      const metricsRegistry: StorageMetricsRegistryPort = {
        recordTelemetry: vi.fn(),
        getMetricsSnapshot: vi.fn(),
        formatPrometheusMetrics: vi.fn()
      };

      const container = createControlApiContainer({
        uow,
        storageTelemetry: telemetryPort,
        storageMetricsRegistry: metricsRegistry
      });

      expect(container.useCases.enforceStorageAdmission).toBeInstanceOf(EnforceStorageAdmission);

      await container.useCases.enforceStorageAdmission!.execute("delivery_write");

      expect(telemetryPort.getStorageTelemetry).toHaveBeenCalledTimes(1);
      expect(metricsRegistry.recordTelemetry).toHaveBeenCalledTimes(1);

      const containerWithout = createControlApiContainer({ uow });
      expect(containerWithout.useCases.enforceStorageAdmission).toBeUndefined();
    });
  });

  it("startControlApiServer uses default host and port when options omitted", async () => {
    const uow = new FakeUnitOfWork();
    const server = await startControlApiServer({ uow });

    expect(server.app).toBeDefined();
    expect(server.host).toBe("0.0.0.0");
    expect(typeof server.port).toBe("number");
    expect(server.port).toBeGreaterThan(0);
    expect(server.app.server.listening).toBe(true);

    await server.close();
    expect(server.app.server.listening).toBe(false);
  });
});
