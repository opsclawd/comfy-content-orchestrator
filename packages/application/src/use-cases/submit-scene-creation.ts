import type { CreativeBrief } from "@cco/contracts";
import type { ReferenceAssetId, Scene, SceneConfiguration } from "@cco/domain";
import type { UnitOfWork } from "../ports/index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ClientNotFoundError } from "./client-not-found-error.js";
import type { CreateSceneUseCase } from "./create-scene.js";
import {
  decodePlanningAuthorizationPolicy,
  type PlanSceneConfigurationUseCase
} from "./plan-scene-configuration.js";
import {
  PlanningProviderNotConfiguredError,
  SceneCreationModeMismatchError
} from "./scene-creation-errors.js";

export type SubmitSceneCreationInput = {
  readonly campaignId: string;
} & (
  | {
      readonly kind: "manual";
      readonly configuration: SceneConfiguration;
    }
  | {
      readonly kind: "brief";
      readonly brief: CreativeBrief;
      readonly candidateReferenceAssetIds?: readonly ReferenceAssetId[] | undefined;
      readonly maxDurationMs?: number | undefined;
      readonly targetDurationMs?: number | undefined;
    }
);

export interface SubmitSceneCreationDeps {
  readonly uow: UnitOfWork;
  readonly createScene: CreateSceneUseCase;
  readonly planSceneConfiguration?: PlanSceneConfigurationUseCase | undefined;
}

export class SubmitSceneCreationUseCase {
  constructor(private readonly deps: SubmitSceneCreationDeps) {}

  async execute(input: SubmitSceneCreationInput): Promise<Scene> {
    const { clientId, externalProcessingPolicy } = await this.deps.uow.execute(async (ctx) => {
      if (ctx.campaigns === undefined) {
        throw new Error(
          "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
        );
      }
      const campaign = await ctx.campaigns.findById(input.campaignId);
      if (campaign === undefined) {
        throw new CampaignNotFoundError(input.campaignId);
      }
      if (ctx.clients === undefined) {
        throw new Error(
          "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
        );
      }
      const client = await ctx.clients.findById(campaign.clientId);
      if (client === undefined) {
        throw new ClientNotFoundError(campaign.clientId);
      }
      return {
        clientId: campaign.clientId,
        externalProcessingPolicy: client.externalProcessingPolicy
      };
    });

    const policy = decodePlanningAuthorizationPolicy(externalProcessingPolicy);

    if (policy.allowCloudPlanning) {
      if (input.kind !== "brief") {
        throw new SceneCreationModeMismatchError(
          "allowCloudPlanning is enabled for this client; submit a creative brief"
        );
      }
      if (!this.deps.planSceneConfiguration) {
        throw new PlanningProviderNotConfiguredError(
          "Cloud planning is required for this client but no planning provider is configured."
        );
      }
      const configuration = await this.deps.planSceneConfiguration.execute({
        brief: input.brief,
        campaignId: input.campaignId,
        clientId,
        candidateReferenceAssetIds: input.candidateReferenceAssetIds ?? [],
        externalProcessingPolicy,
        ...(input.maxDurationMs !== undefined ? { maxDurationMs: input.maxDurationMs } : {}),
        ...(input.targetDurationMs !== undefined
          ? { targetDurationMs: input.targetDurationMs }
          : {})
      });

      return this.deps.createScene.execute({
        campaignId: input.campaignId,
        configuration
      });
    }

    if (input.kind !== "manual") {
      throw new SceneCreationModeMismatchError(
        "allowCloudPlanning is disabled for this client; submit a manually-authored configuration"
      );
    }
    return this.deps.createScene.execute({
      campaignId: input.campaignId,
      configuration: input.configuration
    });
  }
}
