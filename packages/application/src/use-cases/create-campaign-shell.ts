import { randomUUID } from "node:crypto";
import {
  type CampaignDurationPlan,
  type CreateCampaignShellRequest,
  type CreativeBrief,
  type ExecutionProfileSelection,
  type ExecutionRealm,
  type RenderProfileKey,
  type H3ProfileFrameCapability,
  type H3CapabilityResolverReader,
  type ReleasedProductionProfileKey,
  resolveH3ProfileFrameCapabilities,
  isReleasedProductionProfileKey,
  isStagingCandidateProfileKey,
  CampaignDurationPlanningError
} from "@cco/contracts";
import type {
  CampaignId,
  CampaignShellRecord,
  CampaignStatus,
  ReferenceAssetId
} from "@cco/domain";
import {
  isCampaignShellRepository,
  type CampaignShellRepository,
  type RealmAdmissionContext,
  type UnitOfWork,
  type UnitOfWorkContext
} from "../ports/index.js";
import type { ProductionReleaseCapabilityReader } from "../ports/production-release-ports.js";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
import { CampaignIdempotencyConflictError } from "./campaign-idempotency-conflict-error.js";
import { computeCampaignRequestHash } from "./campaign-request-hash.js";
import { resolveSceneCount } from "./scene-count-policy.js";
import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";

export interface CreateCampaignShellInput extends CreateCampaignShellRequest {
  readonly brief?: CreativeBrief | undefined;
  readonly candidateReferenceAssetIds?: readonly ReferenceAssetId[] | readonly string[] | undefined;
  readonly initialStatus?: CampaignStatus | undefined;
  readonly realm?: ExecutionRealm | undefined;
  readonly scope?: "production" | "staging" | undefined;
  readonly allowedProfileSelections?: readonly ExecutionProfileSelection[] | undefined;
  /**
   * Authenticated principal requesting this campaign shell, used to scope which staging
   * candidates are visible via StagingPlanningAuthorizationSource#listAuthorizedCandidates
   * (issue #426, AC-14). Undefined means the unrestricted/anonymous view.
   */
  readonly principal?: string | undefined;
}

export interface CreateCampaignShellResult {
  readonly campaign: CampaignShellRecord;
  readonly plan?: CampaignDurationPlan | undefined;
  readonly isIdempotentReplay: boolean;
}

export interface CreateCampaignShellOptions {
  readonly realmContext?: RealmAdmissionContext | undefined;
  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
  readonly registryReader?: H3CapabilityResolverReader | undefined;
}

export class CreateCampaignShellUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly options?: CreateCampaignShellOptions | undefined
  ) {}

  private getShellRepository(context: UnitOfWorkContext): CampaignShellRepository {
    if (!isCampaignShellRepository(context.campaigns)) {
      throw new Error(
        "UnitOfWorkContext.campaigns does not support campaign shell idempotency operations."
      );
    }
    return context.campaigns;
  }

  /**
   * Outer entry point for campaign shell creation with idempotency and race recovery.
   * If a concurrent duplicate submission races and hits a unique constraint violation,
   * the aborted transaction is cleanly rolled back before attempting a fresh read to recover
   * the committed winner's row.
   */
  async execute(input: CreateCampaignShellInput): Promise<CreateCampaignShellResult> {
    try {
      return await this.uow.execute((context) => this.executeWithContext(context, input));
    } catch (err) {
      if (err instanceof CampaignIdempotencyConflictError) {
        return await this.recoverFromConcurrentConflict(input, err);
      }
      throw err;
    }
  }

  /**
   * Recovers from a concurrent conflict by opening a FRESH UnitOfWork transaction/connection.
   * This is necessary because in PostgreSQL, once a statement encounters a unique violation (23505),
   * the current transaction block is aborted (25P02) and no further commands can be executed on it.
   */
  private async recoverFromConcurrentConflict(
    input: CreateCampaignShellInput,
    original: CampaignIdempotencyConflictError
  ): Promise<CreateCampaignShellResult> {
    const requestHash = await computeCampaignRequestHash(input);
    return this.uow.execute(async (context) => {
      if (!isCampaignShellRepository(context.campaigns)) {
        throw original;
      }
      const winner = await context.campaigns.findByIdempotencyKey(input.idempotencyKey);
      if (winner !== undefined && winner.requestHashSha256 === requestHash) {
        return {
          campaign: winner,
          isIdempotentReplay: true
        };
      }
      throw original;
    });
  }

  /**
   * Executes the creation logic within an existing UnitOfWorkContext.
   * Callers that own their own transaction boundary (e.g. future composed flows in #217-B/#217-C)
   * invoke this directly. Any conflict error propagates up so the caller's transaction
   * can abort and rollback cleanly.
   */
  async executeWithContext(
    context: UnitOfWorkContext,
    input: CreateCampaignShellInput
  ): Promise<CreateCampaignShellResult> {
    const repo = this.getShellRepository(context);

    const requestHash = await computeCampaignRequestHash(input);
    const existing = await repo.findByIdempotencyKey(input.idempotencyKey);

    if (existing !== undefined) {
      if (existing.requestHashSha256 === requestHash) {
        return {
          campaign: existing,
          isIdempotentReplay: true
        };
      }
      throw new CampaignIdempotencyConflictError(input.idempotencyKey);
    }

    const campaignId = randomUUID() as CampaignId;
    const realm: ExecutionRealm = input.realm ??
      this.options?.realmContext?.realm ?? { kind: "deployed", deploymentId: "default" };

    // Validate baseline campaign duration and scene count policy
    resolveSceneCount({
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride
    });

    // Validate that conflicting selectors are rejected
    if (
      input.targetEngineProfileId !== undefined &&
      input.selectedProfileKey !== undefined &&
      input.targetEngineProfileId !== input.selectedProfileKey
    ) {
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `Conflicting profile selectors: targetEngineProfileId "${input.targetEngineProfileId}" does not match selectedProfileKey "${input.selectedProfileKey}"`
      );
    }
    if (
      input.executionProfileSelection !== undefined &&
      input.selectedProfileKey !== undefined &&
      input.executionProfileSelection.profileKey !== input.selectedProfileKey
    ) {
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `Conflicting profile selectors: executionProfileSelection profileKey "${input.executionProfileSelection.profileKey}" does not match selectedProfileKey "${input.selectedProfileKey}"`
      );
    }
    if (
      input.executionProfileSelection !== undefined &&
      input.targetEngineProfileId !== undefined &&
      input.executionProfileSelection.profileKey !== input.targetEngineProfileId
    ) {
      throw new CampaignDurationPlanningError(
        "no_feasible_allocation",
        `Conflicting profile selectors: executionProfileSelection profileKey "${input.executionProfileSelection.profileKey}" does not match targetEngineProfileId "${input.targetEngineProfileId}"`
      );
    }

    const capabilities = new Map<string, H3ProfileFrameCapability>();

    if (this.options?.productionReleaseReader) {
      // A release-authority outage must not block an independently verified legacy-only
      // request (issue #426): capture failures here as "no released capabilities available"
      // rather than propagating. A request that actually needs a released profile still
      // fails explicitly below, via resolveSelection's own getReleasedProfile call.
      const releases = await this.options.productionReleaseReader
        .listReleasedProfiles()
        .catch(() => []);
      for (const rel of releases) {
        const frames = rel.specification.frames;
        capabilities.set(
          rel.key,
          Object.freeze({
            profileKey: rel.key,
            route: rel.specification.route,
            routingMode: rel.specification.routingMode,
            width: rel.specification.width,
            height: rel.specification.height,
            fps: rel.specification.fps,
            allowedFrameCounts: Object.freeze([frames]),
            isAllowedFrameCount: (f: number) => f === frames
          })
        );
      }
    }

    if (this.options?.stagingAuthSource) {
      // Same independence guarantee as above, for a staging-authority outage.
      const candidates = await this.options.stagingAuthSource
        .listAuthorizedCandidates(input.principal)
        .catch(() => []);
      for (const cand of candidates) {
        const cap = resolveH3ProfileFrameCapabilities(cand.profileKey, this.options.registryReader);
        if (cap) {
          capabilities.set(cand.profileKey, cap);
        }
      }
    }

    const resolveSelection = async (key: string): Promise<ExecutionProfileSelection> => {
      if (isReleasedProductionProfileKey(key)) {
        if (!this.options?.productionReleaseReader) {
          throw new CampaignDurationPlanningError(
            "release_unavailable",
            `No production release reader configured for released profile: ${key}`
          );
        }
        const rel = await this.options.productionReleaseReader.getReleasedProfile(key);
        if (!rel) {
          throw new CampaignDurationPlanningError(
            "release_unavailable",
            `Released profile ${key} is not available or not enabled`
          );
        }
        return {
          kind: "released_production",
          profileKey: key as ReleasedProductionProfileKey,
          specificationDigest: rel.specificationDigest,
          releaseId: rel.releaseId,
          signedReleaseDigest: rel.signedReleaseDigest,
          certificationRecordDigest: rel.certificationRecordDigest,
          deploymentEnablementDigest: rel.deploymentEnablementDigest
        };
      }

      if (isStagingCandidateProfileKey(key)) {
        if (!this.options?.stagingAuthSource) {
          throw new CampaignDurationPlanningError(
            "capability_unavailable",
            `No staging authorization source configured for candidate profile: ${key}`
          );
        }
        const candidates = await this.options.stagingAuthSource.listAuthorizedCandidates(
          input.principal
        );
        const cand = candidates.find((c) => c.profileKey === key);
        if (!cand) {
          throw new CampaignDurationPlanningError(
            "capability_unavailable",
            `Staging candidate ${key} is not authorized`
          );
        }
        return cand;
      }

      return {
        kind: "legacy_production",
        profileKey: key as RenderProfileKey,
        version: 1
      };
    };

    let selectedProfileSelection: ExecutionProfileSelection;
    if (input.executionProfileSelection) {
      selectedProfileSelection = input.executionProfileSelection;
    } else {
      const keyToResolve =
        input.selectedProfileKey ?? input.targetEngineProfileId ?? "MINIMAX_H3_720P_5S_I2V_V1";
      selectedProfileSelection = await resolveSelection(keyToResolve);
    }

    let allowedProfileSelections: readonly ExecutionProfileSelection[] | undefined =
      input.allowedProfileSelections;
    if (!allowedProfileSelections && input.allowedDurationProfileKeys) {
      allowedProfileSelections = await Promise.all(
        input.allowedDurationProfileKeys.map((k) => resolveSelection(k))
      );
    }

    const scope: "production" | "staging" =
      input.scope ??
      (selectedProfileSelection.kind === "staging_candidate" ? "staging" : "production");

    const plan = planFeasibleCampaignDuration({
      campaignId,
      targetTotalDurationMs: input.targetTotalDurationMs,
      sceneCountOverride: input.sceneCountOverride,
      selectedProfileSelection,
      allowedProfileSelections,
      realm,
      scope,
      capabilities
    });

    const now = new Date().toISOString();
    const record: CampaignShellRecord = {
      id: campaignId,
      clientId: input.clientId,
      title: input.title,
      targetPlatform: input.targetPlatform ?? "instagram_reels",
      status: input.initialStatus ?? "drafting",
      totalScenes: plan.allocations.length,
      approvedScenes: 0,
      createdAt: now,
      updatedAt: now,
      idempotencyKey: input.idempotencyKey,
      targetTotalDurationMs: input.targetTotalDurationMs
    };

    await repo.saveWithRequestHash(record, requestHash);
    if (context.durationPlans) {
      await context.durationPlans.savePlan(plan);
    }

    return {
      campaign: record,
      plan,
      isIdempotentReplay: false
    };
  }
}
