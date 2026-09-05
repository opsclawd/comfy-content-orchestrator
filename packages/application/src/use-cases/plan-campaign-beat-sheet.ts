import type { CreativeBrief } from "@cco/contracts";
import type { CampaignId, ReferenceAssetId } from "@cco/domain";
import type { PlanningModelClientPort } from "../ports/planning-model-client-port.js";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ClientNotFoundError } from "./client-not-found-error.js";
import { parsePlanningResponse } from "./planning-response-parser.js";
import {
  PlanningOrchestrationKernel,
  decodePlanningAuthorizationPolicy
} from "./planning-orchestration-kernel.js";
import { buildBeatSheetPlanningPrompt } from "./beat-sheet-prompt.js";
import {
  CampaignBeatSheetValidationError,
  validateCampaignBeatSheet,
  type CampaignBeat
} from "./validate-campaign-beat-sheet.js";

export type { CampaignBeat };

export interface CampaignBeatSheet {
  readonly campaignId: string;
  readonly targetTotalDurationMs: number;
  readonly beats: readonly CampaignBeat[];
}

export interface PlanCampaignBeatSheetDeps {
  readonly uow: UnitOfWork;
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly primaryClient: PlanningModelClientPort;
  readonly fallbackClient: PlanningModelClientPort;
  readonly overallTimeoutMs?: number | undefined;
  readonly kernel?: PlanningOrchestrationKernel | undefined;
}

export interface PlanCampaignBeatSheetInput {
  readonly campaignId: CampaignId | string;
  readonly brief: CreativeBrief;
  readonly targetTotalDurationMs: number;
  readonly candidateReferenceAssetIds?: readonly ReferenceAssetId[] | undefined;
  readonly overallTimeoutMs?: number | undefined;
}

export class PlanCampaignBeatSheetUseCase {
  private readonly kernel: PlanningOrchestrationKernel;

  constructor(private readonly deps: PlanCampaignBeatSheetDeps) {
    this.kernel =
      deps.kernel ??
      new PlanningOrchestrationKernel({
        primaryClient: deps.primaryClient,
        fallbackClient: deps.fallbackClient,
        ...(deps.overallTimeoutMs !== undefined ? { overallTimeoutMs: deps.overallTimeoutMs } : {})
      });
  }

  async execute(input: PlanCampaignBeatSheetInput): Promise<CampaignBeatSheet> {
    if (
      typeof input.targetTotalDurationMs !== "number" ||
      !Number.isInteger(input.targetTotalDurationMs) ||
      input.targetTotalDurationMs <= 0
    ) {
      throw new CampaignBeatSheetValidationError(
        "targetTotalDurationMs must be a positive integer"
      );
    }

    const { clientId, externalProcessingPolicy, totalScenes } = await this.deps.uow.execute(
      async (ctx) => {
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
          externalProcessingPolicy: client.externalProcessingPolicy,
          totalScenes: campaign.totalScenes
        };
      }
    );

    if (input.targetTotalDurationMs < totalScenes) {
      throw new CampaignBeatSheetValidationError(
        `targetTotalDurationMs (${input.targetTotalDurationMs}ms) cannot be less than campaign totalScenes (${totalScenes})`
      );
    }

    const policy = decodePlanningAuthorizationPolicy(externalProcessingPolicy);

    const result = await this.kernel.run({
      policy,
      overallTimeoutMs: input.overallTimeoutMs,
      prepare: async (_signal: AbortSignal) => {
        const resolvedReferenceAssets = await this.deps.referenceAssetRepository.findByIds(
          clientId,
          input.candidateReferenceAssetIds ?? []
        );

        return {
          buildRequest: (correctiveFeedback?: string) =>
            buildBeatSheetPlanningPrompt({
              brief: input.brief,
              campaignId: input.campaignId,
              totalScenes,
              targetTotalDurationMs: input.targetTotalDurationMs,
              resolvedReferenceAssets,
              maskSensitiveData: policy.sensitiveDataMasking,
              correctiveFeedback
            }),
          parseAndValidate: (rawText: string) => {
            const parsed = parsePlanningResponse(rawText);
            if (!parsed.ok) {
              throw new CampaignBeatSheetValidationError(parsed.reason);
            }
            return validateCampaignBeatSheet(parsed.value, {
              totalScenes,
              targetTotalDurationMs: input.targetTotalDurationMs
            });
          }
        };
      }
    });

    return Object.freeze({
      campaignId: input.campaignId,
      targetTotalDurationMs: input.targetTotalDurationMs,
      beats: result.beats
    });
  }
}
