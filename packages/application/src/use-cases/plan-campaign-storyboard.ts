import type { CreativeBrief, RenderProfileKey } from "@cco/contracts";
import type { CampaignShellRecord, ReferenceAssetId, SceneSnapshot } from "@cco/domain";
import type { ReferenceAssetRepository } from "../ports/reference-asset-repository.js";
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
import {
  canonicalizeCandidateReferenceAssetIds,
  resolveCandidateReferenceAssets
} from "./resolve-candidate-reference-assets.js";
import { SceneConfigurationValidationError } from "./validate-scene-configuration.js";
import { StoryboardMaterializationConflictError } from "./storyboard-materialization-conflict-error.js";
import { StoryboardPartiallyMaterializedError } from "./storyboard-partially-materialized-error.js";

export interface PlanCampaignStoryboardDeps {
  readonly createCampaignShell: CreateCampaignShellUseCase;
  readonly planCampaignBeatSheet: PlanCampaignBeatSheetUseCase;
  readonly planSceneConfiguration: PlanSceneConfigurationUseCase;
  readonly materializeStoryboard: MaterializeStoryboardUseCase;
  readonly uow: UnitOfWork;
  readonly referenceAssetRepository?: ReferenceAssetRepository | undefined;
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
  readonly targetEngineProfileId?: RenderProfileKey | undefined;
}

export interface PlanCampaignStoryboardResult {
  readonly campaign: CampaignShellRecord;
  readonly isIdempotentReplay: boolean;
  readonly scenes: readonly Readonly<SceneSnapshot>[];
}

export type PreparePlanningShellResult =
  | {
      readonly kind: "completed";
      readonly campaign: CampaignShellRecord;
      readonly scenes: readonly Readonly<SceneSnapshot>[];
      readonly isIdempotentReplay: true;
    }
  | {
      readonly kind: "in_progress";
      readonly campaign: CampaignShellRecord;
      readonly isIdempotentReplay: true;
      readonly scenes: readonly Readonly<SceneSnapshot>[];
    }
  | {
      readonly kind: "created";
      readonly campaign: CampaignShellRecord;
      readonly isIdempotentReplay: boolean;
      readonly scenes: readonly Readonly<SceneSnapshot>[];
      readonly orchestrationHash: string;
    };

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
 * 5. Materializes storyboard scenes and admits candidate generation, atomically writing the completion proof and
 *    transitioning status to 'drafting' (#220, #247, #286).
 */
export class PlanCampaignStoryboardUseCase {
  constructor(private readonly deps: PlanCampaignStoryboardDeps) {}

  /**
   * Phase 1: Resolves or creates the campaign shell in PostgreSQL (< 20ms) with status 'planning'.
   * Verifies idempotency identity. If completed proof exists, returns 'completed'.
   * If planning is already in progress, returns 'in_progress'. Otherwise returns 'created'.
   */
  async preparePlanningShell(
    input: PlanCampaignStoryboardInput
  ): Promise<PreparePlanningShellResult> {
    const canonicalCandidateIds = canonicalizeCandidateReferenceAssetIds(
      input.candidateReferenceAssetIds
    );
    const { campaign, isIdempotentReplay } = await this.deps.createCampaignShell.execute({
      idempotencyKey: input.idempotencyKey,
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform,
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride,
      brief: input.brief,
      candidateReferenceAssetIds: canonicalCandidateIds,
      initialStatus: "planning",
      targetEngineProfileId: input.targetEngineProfileId
    });

    const orchestrationHash = await computeCampaignRequestHash({
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform,
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride,
      brief: input.brief,
      candidateReferenceAssetIds: canonicalCandidateIds as readonly string[] | undefined,
      targetEngineProfileId: input.targetEngineProfileId
    });

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
        if (campaign.status === "planning") {
          return {
            kind: "in_progress",
            campaign,
            isIdempotentReplay: true,
            scenes: []
          };
        }
        // Recoverable shell with zero scenes from prior attempt that failed before materialization.
        // Transition status back to 'planning' so the retried planning pipeline can proceed and materialize.
        await this.deps.uow.execute(async (ctx) => {
          if (ctx.campaigns && typeof ctx.campaigns.transitionStatusIf === "function") {
            await ctx.campaigns.transitionStatusIf(campaign.id, campaign.status, "planning");
          }
        });

        return {
          kind: "created",
          campaign: { ...campaign, status: "planning" },
          isIdempotentReplay: false,
          scenes: [],
          orchestrationHash
        };
      }

      if (
        existing.length === campaign.totalScenes &&
        campaign.storyboardCompletionHashSha256 !== undefined &&
        campaign.storyboardCompletionHashSha256 === orchestrationHash
      ) {
        // Durable completion proof exists and matches current orchestration operation!
        const sortedExisting = [...existing].sort(
          (a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0)
        );
        return {
          kind: "completed",
          campaign: { ...campaign, status: "drafting" },
          isIdempotentReplay: true,
          scenes: sortedExisting.map((s) => s.snapshot())
        };
      }

      if (existing.length > 0 && existing.length < campaign.totalScenes) {
        throw new StoryboardPartiallyMaterializedError(
          campaign.id,
          campaign.totalScenes,
          existing.length
        );
      }

      throw new StoryboardMaterializationConflictError(
        campaign.id,
        `Campaign has ${existing.length} existing scenes but lacks matching storyboard completion proof for operation ${orchestrationHash}.`
      );
    }

    return {
      kind: "created",
      campaign,
      isIdempotentReplay: false,
      scenes: [],
      orchestrationHash
    };
  }

  /**
   * Phase 2: Runs the long-running LLM planning pipeline and materialization.
   * On success, atomically materializes scenes, enqueues render jobs, and transitions status to 'drafting'.
   * On failure, marks campaign status 'failed'.
   */
  async executePlanningPipeline(
    campaign: CampaignShellRecord,
    input: PlanCampaignStoryboardInput,
    orchestrationHash: string
  ): Promise<PlanCampaignStoryboardResult> {
    const canonicalCandidateIds = canonicalizeCandidateReferenceAssetIds(
      input.candidateReferenceAssetIds
    );

    try {
      // 1. Plan beat sheet (outside transaction)
      const beatSheet = await this.deps.planCampaignBeatSheet.execute({
        campaignId: campaign.id,
        brief: input.brief,
        targetTotalDurationMs: campaign.targetTotalDurationMs,
        candidateReferenceAssetIds: canonicalCandidateIds,
        overallTimeoutMs: input.overallTimeoutMs,
        targetEngine: input.targetEngineProfileId,
        engineProfileId: input.targetEngineProfileId
      });

      // 2. Resolve client externalProcessingPolicy
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

      // 3. Plan each scene configuration sequentially
      const orderedConfigs: OrderedSceneConfiguration[] = [];
      for (const beat of beatSheet.beats) {
        const configuration = await this.deps.planSceneConfiguration.execute({
          brief: beat.brief,
          campaignId: campaign.id,
          clientId: campaign.clientId,
          candidateReferenceAssetIds: canonicalCandidateIds,
          externalProcessingPolicy,
          targetDurationMs: beat.targetDurationMs,
          overallTimeoutMs: input.overallTimeoutMs,
          targetEngineProfileId: input.targetEngineProfileId
        });
        orderedConfigs.push({ ordinal: beat.ordinal, configuration });
      }

      // Collect union of assigned reference IDs across all planned scenes
      const assignedReferenceIds = Array.from(
        new Set(
          orderedConfigs.flatMap((c) => [
            ...(c.configuration.referenceIds ?? []),
            ...(c.configuration.referenceBindings?.map((b) => b.referenceAssetId) ?? [])
          ])
        )
      ) as ReferenceAssetId[];

      // Enforce allowlist membership: every assigned ID must be in canonical candidate allowlist
      const canonicalCandidateSet = new Set(canonicalCandidateIds.map((id) => String(id)));
      for (const id of assignedReferenceIds) {
        if (!canonicalCandidateSet.has(String(id))) {
          throw new SceneConfigurationValidationError(
            `referenceId "${id}" was not included in allowed campaign candidate reference assets`
          );
        }
      }

      // Re-read current repository state for assigned references before materialization.
      // This ensures that if any asset was archived or reassigned during LLM planning,
      // the planning pipeline fails closed before entering the materialization transaction.
      if (assignedReferenceIds.length > 0) {
        const refRepo =
          this.deps.referenceAssetRepository ??
          (await this.deps.uow.execute(async (ctx) => ctx.referenceAssets));
        if (!refRepo) {
          throw new Error(
            "Reference asset repository is required to validate planned scene references."
          );
        }
        await resolveCandidateReferenceAssets(refRepo, campaign.clientId, assignedReferenceIds);
      }

      // 4. Durably materialize storyboard scenes and admit candidate generation in its own transaction
      const { scenes } = await this.deps.materializeStoryboard.execute({
        campaignId: campaign.id,
        scenes: orderedConfigs,
        completionHashSha256: orchestrationHash,
        candidateReferenceAssetIds: canonicalCandidateIds
      });

      return {
        campaign: { ...campaign, status: "drafting" },
        isIdempotentReplay: false,
        scenes
      };
    } catch (err) {
      // Best-effort mark campaign as failed on unexpected planning pipeline failure
      try {
        await this.deps.uow.execute(async (ctx) => {
          if (ctx.campaigns && typeof ctx.campaigns.transitionStatusIf === "function") {
            await ctx.campaigns.transitionStatusIf(campaign.id, "planning", "failed");
          }
        });
      } catch {
        // Ignore secondary error updating status
      }
      throw err;
    }
  }

  /**
   * Synchronous entry point: resolves/creates shell and immediately runs pipeline.
   */
  async execute(input: PlanCampaignStoryboardInput): Promise<PlanCampaignStoryboardResult> {
    const canonicalCandidateIds = canonicalizeCandidateReferenceAssetIds(
      input.candidateReferenceAssetIds
    );
    const normalizedInput: PlanCampaignStoryboardInput = {
      ...input,
      candidateReferenceAssetIds: canonicalCandidateIds
    };

    const shellResult = await this.preparePlanningShell(normalizedInput);
    if (shellResult.kind === "completed") {
      return {
        campaign: shellResult.campaign,
        isIdempotentReplay: true,
        scenes: shellResult.scenes
      };
    }

    const orchestrationHash =
      "orchestrationHash" in shellResult
        ? shellResult.orchestrationHash
        : await computeCampaignRequestHash({
            clientId: normalizedInput.clientId,
            title: normalizedInput.title,
            targetPlatform: normalizedInput.targetPlatform,
            targetTotalDurationMs: normalizedInput.targetTotalDurationMs,
            sceneCountOverride: normalizedInput.sceneCountOverride,
            brief: normalizedInput.brief,
            candidateReferenceAssetIds: canonicalCandidateIds as readonly string[] | undefined,
            targetEngineProfileId: normalizedInput.targetEngineProfileId
          });

    return this.executePlanningPipeline(shellResult.campaign, normalizedInput, orchestrationHash);
  }
}
