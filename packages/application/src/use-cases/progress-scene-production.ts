import type { Scene, SceneId } from "@cco/domain";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export interface ProgressSceneProductionInput {
  readonly sceneId: string;
}

export class ProgressSceneProductionUseCases {
  constructor(private readonly uow: UnitOfWork) {}

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

  async queue(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.queueForProduction());
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
