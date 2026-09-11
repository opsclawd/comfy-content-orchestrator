import { randomUUID } from "node:crypto";
import {
  Scene,
  type CampaignId,
  type SceneConfiguration,
  type SceneId,
  type SceneSnapshot
} from "@cco/domain";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { InvalidSceneOrdinalSequenceError } from "./invalid-scene-ordinal-sequence-error.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import type { ProgressSceneProductionUseCases } from "./progress-scene-production.js";
import { SceneConfigurationCountMismatchError } from "./scene-configuration-count-mismatch-error.js";
import { StoryboardPartiallyMaterializedError } from "./storyboard-partially-materialized-error.js";

export interface OrderedSceneConfiguration {
  readonly ordinal: number;
  readonly configuration: SceneConfiguration;
}

export interface MaterializeStoryboardInput {
  readonly campaignId: CampaignId;
  readonly scenes: readonly OrderedSceneConfiguration[];
}

export interface MaterializeStoryboardResult {
  readonly scenes: readonly Readonly<SceneSnapshot>[];
  readonly isIdempotentReplay: boolean;
}

export class MaterializeStoryboardUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly progressSceneProduction: ProgressSceneProductionUseCases
  ) {}

  async execute(input: MaterializeStoryboardInput): Promise<MaterializeStoryboardResult> {
    return this.uow.execute((context) => this.executeWithContext(context, input));
  }

  async executeWithContext(
    context: UnitOfWorkContext,
    input: MaterializeStoryboardInput
  ): Promise<MaterializeStoryboardResult> {
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

    if (input.scenes.length !== campaign.totalScenes) {
      throw new SceneConfigurationCountMismatchError(
        input.campaignId,
        campaign.totalScenes,
        input.scenes.length
      );
    }

    const sortedInputScenes = [...input.scenes].sort((a, b) => a.ordinal - b.ordinal);
    const expectedOrdinals = Array.from({ length: campaign.totalScenes }, (_, i) => i + 1);
    const actualOrdinals = sortedInputScenes.map((s) => s.ordinal);
    const isValidSequence =
      actualOrdinals.length === expectedOrdinals.length &&
      actualOrdinals.every((ord, idx) => ord === expectedOrdinals[idx]);

    if (!isValidSequence) {
      throw new InvalidSceneOrdinalSequenceError(
        input.campaignId,
        input.scenes.map((s) => s.ordinal),
        `Ordinals must be a contiguous 1-based sequence from 1 to ${campaign.totalScenes} without duplicates or gaps`
      );
    }

    if (typeof context.scenes.findByCampaignId !== "function") {
      throw new Error("UnitOfWorkContext.scenes does not support findByCampaignId.");
    }

    const existing = await context.scenes.findByCampaignId(input.campaignId, {
      forUpdate: true,
      includeArchived: true
    });

    if (existing.length === campaign.totalScenes) {
      const sortedExisting = [...existing].sort(
        (a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
      );
      return {
        scenes: sortedExisting.map((s) => s.snapshot()),
        isIdempotentReplay: true
      };
    }

    if (existing.length !== 0) {
      throw new StoryboardPartiallyMaterializedError(
        input.campaignId,
        campaign.totalScenes,
        existing.length
      );
    }

    if (context.jobs === undefined) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    const materializedScenes: Readonly<SceneSnapshot>[] = [];
    for (const item of sortedInputScenes) {
      const scene = Scene.create({
        id: randomUUID() as SceneId,
        campaignId: input.campaignId,
        configuration: item.configuration,
        sequenceIndex: item.ordinal
      });
      await context.scenes.save(scene);
      const admission = await this.progressSceneProduction.beginCandidateGenerationWithContext(
        context,
        { sceneId: scene.id }
      );
      materializedScenes.push(admission.scene);
    }

    return {
      scenes: materializedScenes,
      isIdempotentReplay: false
    };
  }
}
