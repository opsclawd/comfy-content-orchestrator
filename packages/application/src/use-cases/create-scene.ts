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
import type { ShotPlanPlanningAdmissionPort, UnitOfWork } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import {
  triggerFirstPassShotPlanningIfEligible,
  type AutoPlanFirstPassLogger
} from "./auto-plan-first-pass.js";

export interface CreateSceneInput {
  readonly campaignId: string;
  readonly configuration: SceneConfigurationInput | SceneConfiguration;
}

export class CreateSceneUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly autoPlanCoordinator?: ShotPlanPlanningAdmissionPort | undefined,
    private readonly logger?: AutoPlanFirstPassLogger | undefined
  ) {}

  async execute(input: CreateSceneInput): Promise<Scene> {
    const scene = await this.uow.execute(async (context) => {
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

    if (this.autoPlanCoordinator) {
      try {
        await triggerFirstPassShotPlanningIfEligible({
          sceneId: scene.id,
          uow: this.uow,
          coordinator: this.autoPlanCoordinator,
          logger: this.logger
        });
      } catch (err) {
        // Defensive: post-commit auto-planning failures must not fail the created scene
        this.logger?.warn?.(
          `Unexpected error during first-pass shot planning for scene '${scene.id}': ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else {
      const hasReferences =
        (input.configuration.referenceIds && input.configuration.referenceIds.length > 0) ||
        (input.configuration.referenceBindings && input.configuration.referenceBindings.length > 0);
      if (hasReferences) {
        this.logger?.warn?.(
          `First-pass shot-plan auto-trigger skipped for scene '${scene.id}': planning coordinator is not configured`
        );
      }
    }

    return scene;
  }
}
