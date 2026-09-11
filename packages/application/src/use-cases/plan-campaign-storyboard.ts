import type { CreativeBrief } from "@cco/contracts";
import type { CampaignShellRecord, ReferenceAssetId, SceneSnapshot } from "@cco/domain";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { computeCampaignRequestHash } from "./campaign-request-hash.js";
import { ClientNotFoundError } from "./client-not-found-error.js";
import type { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
import type {
  MaterializeStoryboardUseCase,
  OrderedSceneConfiguration
} from "./materialize-storyboard.js";
import type { PlanCampaignBeatSheetUseCase } from "./plan-campaign-beat-sheet.js";
import type { PlanSceneConfigurationUseCase } from "./plan-scene-configuration.js";
import { StoryboardMaterializationConflictError } from "./storyboard-materialization-conflict-error.js";
import { StoryboardPartiallyMaterializedError } from "./storyboard-partially-materialized-error.js";

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
 * 1. Creates/resolves durable campaign shell with full orchestration idempotency identity (#219, #247).
 *    Idempotency identity is bound to the full orchestration request parameters: shell parameters,
 *    creative brief, and canonicalized candidate reference assets. Replaying with changed brief or
 *    assets triggers 409 IDEMPOTENCY_CONFLICT.
 * 2. Short-circuits if this is an idempotent replay and matching durable storyboard completion proof
 *    exists. A drafting shell with N scenes but no matching completion proof fails explicitly.
 * 3. Invokes PlanCampaignBeatSheetUseCase with targetTotalDurationMs (outside any DB transaction).
 * 4. Invokes PlanSceneConfigurationUseCase per beat with beat.targetDurationMs as authoritative (outside any DB transaction).
 * 5. Materializes storyboard scenes and admits candidate generation, atomically writing the completion proof (#220, #247).
 */
export class PlanCampaignStoryboardUseCase {
  constructor(private readonly deps: PlanCampaignStoryboardDeps) {}

  async execute(input: PlanCampaignStoryboardInput): Promise<PlanCampaignStoryboardResult> {
    // 1. Resolve/create the campaign shell and full orchestration idempotency identity within its own transaction.
    const { campaign, isIdempotentReplay } = await this.deps.createCampaignShell.execute({
      idempotencyKey: input.idempotencyKey,
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform,
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride,
      brief: input.brief,
      candidateReferenceAssetIds: input.candidateReferenceAssetIds
    });

    const orchestrationHash = await computeCampaignRequestHash({
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform,
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride,
      brief: input.brief,
      candidateReferenceAssetIds: input.candidateReferenceAssetIds
    });

    // 2. Idempotent-replay short-circuit:
    // A composed-flow replay may short-circuit only when durable completion proof exists
    // and matches the current orchestration operation. existing.length === campaign.totalScenes
    // alone is never sufficient evidence of successful replay.
    if (isIdempotentReplay) {
      const existing = await this.deps.uow.execute(async (ctx) => {
        if (ctx.scenes === undefined || typeof ctx.scenes.findByCampaignId !== "function") {
          throw new Error(
            "UnitOfWorkContext.scenes does not support findByCampaignId for this UnitOfWork implementation."
          );
        }
        return ctx.scenes.findByCampaignId(campaign.id, { includeArchived: true });
      });

      if (existing.length === 0) {
        // Recoverable drafting shell with zero scenes from a prior attempt that failed before materialization.
        // Fall through to planning fresh.
      } else if (
        existing.length === campaign.totalScenes &&
        campaign.storyboardCompletionHashSha256 !== undefined &&
        campaign.storyboardCompletionHashSha256 === orchestrationHash
      ) {
        // Durable completion proof exists and matches current orchestration operation!
        const sortedExisting = [...existing].sort(
          (a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
        );
        return {
          campaign,
          isIdempotentReplay: true,
          scenes: sortedExisting.map((s) => s.snapshot()),
          isStoryboardIdempotentReplay: true
        };
      } else if (existing.length > 0 && existing.length < campaign.totalScenes) {
        // Partially materialized state: fail fast rather than calling LLM planning
        throw new StoryboardPartiallyMaterializedError(
          campaign.id,
          campaign.totalScenes,
          existing.length
        );
      } else {
        // existing.length === campaign.totalScenes but completion proof is absent or inconsistent:
        // Fail explicitly as a conflict condition rather than returning them as a successful replay!
        throw new StoryboardMaterializationConflictError(
          campaign.id,
          `Campaign has ${existing.length} existing scenes but lacks matching storyboard completion proof for operation ${orchestrationHash}.`
        );
      }
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

    // 5. Durably materialize storyboard scenes and admit candidate generation in its own transaction,
    // atomically binding the completion proof.
    const { scenes, isIdempotentReplay: isStoryboardIdempotentReplay } =
      await this.deps.materializeStoryboard.execute({
        campaignId: campaign.id,
        scenes: orderedConfigs,
        completionHashSha256: orchestrationHash
      });

    return {
      campaign,
      isIdempotentReplay,
      scenes,
      isStoryboardIdempotentReplay
    };
  }
}
