import { randomUUID } from "node:crypto";
import { Scene, type CampaignId, type SceneConfiguration, type SceneId } from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";

export interface CreateSceneInput {
  readonly campaignId: string;
  readonly configuration: SceneConfiguration;
}

export class CreateSceneUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(input: CreateSceneInput): Promise<Scene> {
    return this.uow.execute(async (context) => {
      if (context.campaigns === undefined) {
        throw new Error(
          "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
        );
      }
      const campaign = await context.campaigns.findById(input.campaignId);
      if (campaign === undefined) {
        throw new CampaignNotFoundError(input.campaignId);
      }
      const scene = Scene.create({
        id: randomUUID() as SceneId,
        campaignId: input.campaignId as CampaignId,
        configuration: input.configuration
      });
      await context.scenes.save(scene);
      return scene;
    });
  }
}
