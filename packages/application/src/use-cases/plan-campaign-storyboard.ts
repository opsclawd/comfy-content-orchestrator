import type { CreativeBrief } from "@cco/contracts";
import type { CampaignShellRecord, ReferenceAssetId, SceneSnapshot } from "@cco/domain";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { ClientNotFoundError } from "./client-not-found-error.js";
import type { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
import type {
  MaterializeStoryboardUseCase,
  OrderedSceneConfiguration
} from "./materialize-storyboard.js";
import type { PlanCampaignBeatSheetUseCase } from "./plan-campaign-beat-sheet.js";
import type { PlanSceneConfigurationUseCase } from "./plan-scene-configuration.js";

export interface PlanCampaignStoryboardDeps {
  readonly createCampaignShell: CreateCampaignShellUseCase;
  readonly planCampaignBeatSheet: PlanCampaignBeatSheetUseCase;
  readonly planSceneConfiguration: PlanSceneConfigurationUseCase;
  readonly materializeStoryboard: MaterializeStoryboardUseCase;
  readonly uow: UnitOfWork;
}

export interface PlanCampaignStoryboardInput {
  readonly idempotencyKey: string;
  readonly clientId: string;
  readonly title: string;
  readonly targetPlatform?: string | undefined;
  readonly targetTotalDurationMs: number;
  readonly sceneCountOverride?: number | undefined;
  readonly brief: CreativeBrief;
  readonly candidateReferenceAssetIds?: readonly ReferenceAssetId[] | readonly string[] | undefined;
  readonly overallTimeoutMs?: number | undefined;
}

export interface PlanCampaignStoryboardResult {
  readonly campaign: CampaignShellRecord;
  readonly isIdempotentReplay: boolean;
  readonly scenes: readonly Readonly<SceneSnapshot>[];
  readonly isStoryboardIdempotentReplay: boolean;
}

/**
 * Orchestrates full prompt-to-storyboard planning:
 * 1. Creates/resolves durable campaign shell with idempotency identity (#219).
 *    Note: Idempotency identity is bound to the shell parameters. The planning inputs
 *    (brief and candidateReferenceAssetIds) are used during planning but do not participate
 *    in the durable shell request hash. Replaying an identical key returns the existing storyboard.
 * 2. Short-circuits if this is an idempotent replay and storyboard is already fully materialized.
 * 3. Invokes PlanCampaignBeatSheetUseCase with targetTotalDurationMs.
 * 4. Invokes PlanSceneConfigurationUseCase per beat with beat.targetDurationMs as authoritative.
 * 5. Materializes storyboard scenes and admits candidate generation (#220).
 */
export class PlanCampaignStoryboardUseCase {
  constructor(private readonly deps: PlanCampaignStoryboardDeps) {}

  async execute(input: PlanCampaignStoryboardInput): Promise<PlanCampaignStoryboardResult> {
    // 1. Resolve/create the campaign shell and idempotency identity within its own transaction.
    const { campaign, isIdempotentReplay } = await this.deps.createCampaignShell.execute({
      idempotencyKey: input.idempotencyKey,
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform,
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride
    });

    // 2. Idempotent-replay short-circuit:
    // If this request is an idempotent replay and the storyboard was already fully materialized,
    // return the existing storyboard immediately without making any LLM planning calls.
    if (isIdempotentReplay) {
      const existing = await this.deps.uow.execute(async (ctx) => {
        if (ctx.scenes === undefined || typeof ctx.scenes.findByCampaignId !== "function") {
          throw new Error(
            "UnitOfWorkContext.scenes does not support findByCampaignId for this UnitOfWork implementation."
          );
        }
        return ctx.scenes.findByCampaignId(campaign.id, { includeArchived: true });
      });

      if (existing.length === campaign.totalScenes) {
        const sortedExisting = [...existing].sort(
          (a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
        );
        return {
          campaign,
          isIdempotentReplay: true,
          scenes: sortedExisting.map((s) => s.snapshot()),
          isStoryboardIdempotentReplay: true
        };
      }
      // If existing.length === 0: recoverable drafting shell from a prior attempt that failed before materialization.
      // Fall through to planning fresh.
      // If 0 < existing.length < campaign.totalScenes: partially materialized state.
      // Fall through to planning and let MaterializeStoryboardUseCase enforce its own invariant.
    }

    // 3. Plan the campaign beat sheet (runs LLM call outside of any transaction).
    const beatSheet = await this.deps.planCampaignBeatSheet.execute({
      campaignId: campaign.id,
      brief: input.brief,
      targetTotalDurationMs: campaign.targetTotalDurationMs,
      candidateReferenceAssetIds: input.candidateReferenceAssetIds as
        readonly ReferenceAssetId[] | undefined,
      overallTimeoutMs: input.overallTimeoutMs
    });

    // 4. Resolve client externalProcessingPolicy: reuse the policy already resolved by
    // PlanCampaignBeatSheetUseCase if surfaced, or fetch in a short read-only transaction as fallback.
    const externalProcessingPolicy =
      beatSheet.externalProcessingPolicy ??
      (await this.deps.uow.execute(async (ctx) => {
        if (ctx.clients === undefined) {
          throw new Error(
            "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
          );
        }
        const client = await ctx.clients.findById(campaign.clientId);
        if (client === undefined) {
          throw new ClientNotFoundError(campaign.clientId);
        }
        return client.externalProcessingPolicy;
      }));

    // Plan each scene configuration sequentially, supplying beat.targetDurationMs as authoritative.
    const orderedConfigs: OrderedSceneConfiguration[] = [];
    for (const beat of beatSheet.beats) {
      const configuration = await this.deps.planSceneConfiguration.execute({
        brief: beat.brief,
        campaignId: campaign.id,
        clientId: campaign.clientId,
        candidateReferenceAssetIds: (input.candidateReferenceAssetIds ??
          []) as readonly ReferenceAssetId[],
        externalProcessingPolicy,
        targetDurationMs: beat.targetDurationMs,
        overallTimeoutMs: input.overallTimeoutMs
      });
      orderedConfigs.push({ ordinal: beat.ordinal, configuration });
    }

    // 5. Durably materialize storyboard scenes and admit candidate generation in its own transaction.
    const { scenes, isIdempotentReplay: isStoryboardIdempotentReplay } =
      await this.deps.materializeStoryboard.execute({
        campaignId: campaign.id,
        scenes: orderedConfigs
      });

    return {
      campaign,
      isIdempotentReplay,
      scenes,
      isStoryboardIdempotentReplay
    };
  }
}
