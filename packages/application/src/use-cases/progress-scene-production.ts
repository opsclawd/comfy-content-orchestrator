import type { Scene, SceneId } from "@cco/domain";
import type {
  RenderEnginePort,
  RenderQueueReceipt,
  RenderWorkflow
} from "../ports/render-engine-port.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export interface ProgressSceneProductionInput {
  readonly sceneId: string;
  readonly renderJobId?: string;
  readonly renderProfileKey?: string;
}

export interface QueueSceneProductionInput extends ProgressSceneProductionInput {
  readonly workflow: RenderWorkflow;
}

export class ProgressSceneProductionUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly renderEngine?: RenderEnginePort
  ) {}

  async beginCandidateGeneration(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) =>
      scene.beginCandidateGeneration()
    );
  }

  async submitCandidatesForReview(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) =>
      scene.submitCandidatesForReview()
    );
  }

  async queue(input: QueueSceneProductionInput): Promise<RenderQueueReceipt | undefined> {
    let engineProfileId: string | undefined;

    await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
      }
      scene.queueForProduction();
      await context.scenes.save(scene);
      engineProfileId = scene.snapshot().configuration.engineProfileId;
    });

    if (this.renderEngine !== undefined) {
      const renderJobId = input.renderJobId ?? input.sceneId;
      const renderProfileKey = input.renderProfileKey ?? engineProfileId ?? "default";
      return await this.renderEngine.queueRender({
        sceneId: input.sceneId,
        renderJobId,
        renderProfileKey,
        workflow: input.workflow
      });
    }

    return undefined;
  }

  async markRenderingStarted(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.startRendering());
  }

  async submitForQA(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.submitForQA());
  }

  async fail(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.fail());
  }

  async recoverToReview(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.recoverToReview());
  }

  private async executeProductionTransition(
    sceneId: string,
    transition: (scene: Scene) => void
  ): Promise<void> {
    await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(sceneId);
      }
      transition(scene);
      await context.scenes.save(scene);
    });
  }
}
