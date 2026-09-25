import { randomUUID } from "node:crypto";
import {
  assertReferenceAssetSelectable,
  ReferenceAssetNotFoundError,
  Scene,
  type CampaignId,
  type ReferenceAssetId,
  type SceneConfiguration,
  type SceneConfigurationInput,
  type SceneId
} from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";

export interface CreateSceneInput {
  readonly campaignId: string;
  readonly configuration: SceneConfigurationInput | SceneConfiguration;
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
      if (typeof context.campaigns.findByIdForUpdate !== "function") {
        throw new Error("UnitOfWorkContext.campaigns does not support findByIdForUpdate.");
      }
      const campaign = await context.campaigns.findByIdForUpdate(input.campaignId);
      if (campaign === undefined) {
        throw new CampaignNotFoundError(input.campaignId);
      }

      if (typeof context.scenes.findByCampaignId !== "function") {
        throw new Error("UnitOfWorkContext.scenes does not support findByCampaignId.");
      }

      const existingScenes = await context.scenes.findByCampaignId(input.campaignId as CampaignId, {
        forUpdate: true,
        includeArchived: true
      });
      const nextIndex = Math.max(0, ...existingScenes.map((s) => s.sequenceIndex ?? 0)) + 1;

      const requestedRefIds = [
        ...new Set([
          ...(input.configuration.referenceIds ?? []),
          ...(input.configuration.referenceBindings ?? []).map((b) => b.referenceAssetId)
        ])
      ];

      if (requestedRefIds.length > 0 && context.referenceAssets !== undefined) {
        const assets =
          typeof context.referenceAssets.findByIdsGlobal === "function"
            ? await context.referenceAssets.findByIdsGlobal(
                requestedRefIds as unknown as readonly ReferenceAssetId[],
                { includeArchived: true, forUpdate: true }
              )
            : await context.referenceAssets.findByIds(
                campaign.clientId,
                requestedRefIds as unknown as readonly ReferenceAssetId[],
                { includeArchived: true, forUpdate: true }
              );
        const assetMap = new Map(assets.map((a) => [a.id as string, a]));
        for (const refId of requestedRefIds) {
          const asset = assetMap.get(refId);
          if (!asset) {
            throw new ReferenceAssetNotFoundError(refId);
          }
          assertReferenceAssetSelectable(asset, campaign.clientId);
        }
      }

      const scene = Scene.create({
        id: randomUUID() as SceneId,
        campaignId: input.campaignId as CampaignId,
        configuration: input.configuration,
        sequenceIndex: nextIndex
      });
      await context.scenes.save(scene);
      return scene;
    });
  }
}
