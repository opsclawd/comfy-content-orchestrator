import { createHash, randomUUID } from "node:crypto";
import {
  type ExecutionProfileSelection,
  type ReplanCampaignPreviewRequest,
  type ReplanCampaignPreviewResponse,
  type ReplanCampaignCommitRequest,
  type ReplanCampaignCommitResponse,
  type SceneDurationBinding,
  type H3CapabilityResolverReader,
  type H3ProfileFrameCapability,
  computePlanBindingDigest,
  CampaignDurationPlanningError
} from "@cco/contracts";
import type { ReplanActionReceipt } from "../ports/campaign-duration-plan-repository.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import type { ProductionReleaseCapabilityReader } from "../ports/production-release-ports.js";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
import { ProfileSelectionResolver } from "./profile-selection-resolver.js";

export interface ReplanCampaignDependencies {
  readonly uow: UnitOfWork;
  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
  readonly registryReader?: H3CapabilityResolverReader | undefined;
}

export function computeReplanRequestHash(input: ReplanCampaignCommitRequest): string {
  const sortedSceneDurations = Object.keys(input.sceneIdDurations)
    .sort()
    .map((k) => [k, input.sceneIdDurations[k]]);
  const sortedSpecRevisions = Object.keys(input.expectedSceneSpecRevisions)
    .sort()
    .map((k) => [k, input.expectedSceneSpecRevisions[k]]);
  const canonicalPayload = {
    campaignId: input.campaignId,
    expectedPlanRevision: input.expectedPlanRevision,
    expectedSceneSpecRevisions: sortedSpecRevisions,
    sceneIdDurations: sortedSceneDurations,
    selectedProfileKey: input.selectedProfileKey ?? null,
    allowedDurationProfileKeys: input.allowedDurationProfileKeys
      ? [...input.allowedDurationProfileKeys].sort()
      : null,
    principal: input.principal ?? null
  };
  return createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
}

export class PreviewCampaignReplanUseCase {
  constructor(private readonly deps: ReplanCampaignDependencies) {}

  async execute(input: ReplanCampaignPreviewRequest): Promise<ReplanCampaignPreviewResponse> {
    return await this.deps.uow.execute(async (context) => {
      if (!context.campaigns) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision: 0,
          error: "Campaigns repository not available"
        };
      }

      const campaign = await context.campaigns.findById(input.campaignId);
      if (!campaign) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision: 0,
          error: `Campaign '${input.campaignId}' not found`
        };
      }

      const currentPlan = await context.durationPlans?.findCurrentPlanByCampaignId(campaign.id);
      const currentPlanRevision = currentPlan?.revision ?? campaign.planRevision ?? 0;
      if (!currentPlan) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision,
          error: "Campaign has no existing duration plan to replan"
        };
      }

      if (!context.scenes?.findByCampaignId) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision,
          error: "Scenes repository not available"
        };
      }

      const scenes = await context.scenes.findByCampaignId(campaign.id);
      const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      if (Object.keys(input.sceneIdDurations).length !== sortedScenes.length) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision,
          error: `Target duration allocation cannot be satisfied: sceneIdDurations key count (${Object.keys(input.sceneIdDurations).length}) does not match scene count (${sortedScenes.length})`
        };
      }

      for (const scene of sortedScenes) {
        if (input.sceneIdDurations[scene.id] === undefined) {
          return {
            campaignId: input.campaignId,
            feasible: false,
            currentPlanRevision,
            error: `Target duration allocation cannot be satisfied: missing duration for scene '${scene.id}' in sceneIdDurations`
          };
        }
      }

      const explicitSceneDurationsMs = sortedScenes.map((s) => input.sceneIdDurations[s.id]!);
      for (const d of explicitSceneDurationsMs) {
        if (d > 15_000) {
          return {
            campaignId: input.campaignId,
            feasible: false,
            currentPlanRevision,
            error: `Target duration allocation cannot be satisfied: scene duration ${d}ms exceeds maximum permissible scene duration 15000ms`
          };
        }
      }

      const sumDurationsMs = explicitSceneDurationsMs.reduce((sum, d) => sum + d, 0);
      const campaignTargetDurationMs =
        campaign.targetTotalDurationMs ??
        (campaign as unknown as { targetDurationMs?: number }).targetDurationMs ??
        currentPlan.requestedTotalDurationMs;

      if (sumDurationsMs !== campaignTargetDurationMs) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision,
          error: `Target duration allocation cannot be satisfied: Scene durations sum (${sumDurationsMs}ms) does not match campaign targetTotalDurationMs (${campaignTargetDurationMs}ms)`
        };
      }
      const targetTotalDurationMs = campaignTargetDurationMs;

      const selectedProfileKey = input.selectedProfileKey ?? currentPlan.selectedProfileKey;
      const allowedProfileKeys =
        input.allowedDurationProfileKeys ?? currentPlan.allowedDurationProfileKeys;

      const resolver = new ProfileSelectionResolver({
        productionReleaseReader: this.deps.productionReleaseReader,
        stagingAuthSource: this.deps.stagingAuthSource,
        registryReader: this.deps.registryReader
      });

      let capabilities: Map<string, H3ProfileFrameCapability>;
      let selectedProfileSelection: ExecutionProfileSelection;
      let allowedProfileSelections: readonly ExecutionProfileSelection[];
      try {
        capabilities = await resolver.buildCapabilitiesMap(input.principal);
        selectedProfileSelection = await resolver.resolveSelection(
          selectedProfileKey,
          input.principal
        );
        allowedProfileSelections = await Promise.all(
          allowedProfileKeys.map((k: string) => resolver.resolveSelection(k, input.principal))
        );
        resolver.verifyScopeAndRealm(
          selectedProfileSelection,
          currentPlan.scope,
          currentPlan.realm
        );
        for (const allowed of allowedProfileSelections) {
          resolver.verifyScopeAndRealm(allowed, currentPlan.scope, currentPlan.realm);
        }
        if (
          !allowedProfileSelections.some(
            (s) => s.profileKey === selectedProfileSelection.profileKey
          )
        ) {
          return {
            campaignId: input.campaignId,
            feasible: false,
            currentPlanRevision,
            error: `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
          };
        }
      } catch (err: unknown) {
        return {
          campaignId: input.campaignId,
          feasible: false,
          currentPlanRevision,
          error: err instanceof Error ? err.message : String(err)
        };
      }

      try {
        const proposedPlan = planFeasibleCampaignDuration({
          campaignId: campaign.id,
          targetTotalDurationMs,
          explicitSceneDurationsMs,
          revision: currentPlan.revision + 1,
          predecessorPlanId: currentPlan.planId,
          selectedProfileSelection,
          allowedProfileSelections,
          realm: currentPlan.realm,
          scope: currentPlan.scope,
          envelope: currentPlan.envelope,
          capabilities
        });

        return {
          campaignId: campaign.id,
          feasible: true,
          currentPlanRevision,
          proposedPlan
        };
      } catch (err: unknown) {
        return {
          campaignId: campaign.id,
          feasible: false,
          currentPlanRevision,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });
  }
}

export class CommitCampaignReplanUseCase {
  constructor(private readonly deps: ReplanCampaignDependencies) {}

  async execute(input: ReplanCampaignCommitRequest): Promise<ReplanCampaignCommitResponse> {
    return await this.deps.uow.execute(async (context) => {
      if (!context.campaigns) {
        throw new Error("UnitOfWorkContext.campaigns is not configured");
      }
      if (!context.durationPlans) {
        throw new Error("UnitOfWorkContext.durationPlans is not configured");
      }
      if (!context.scenes?.findByCampaignId) {
        throw new Error("UnitOfWorkContext.scenes is not configured");
      }

      const campaign =
        typeof context.campaigns.findByIdForUpdate === "function"
          ? await context.campaigns.findByIdForUpdate(input.campaignId)
          : await context.campaigns.findById(input.campaignId);
      if (!campaign) {
        throw new Error(`Campaign '${input.campaignId}' not found`);
      }

      const requestHash = computeReplanRequestHash(input);

      let existingReceipt: ReplanActionReceipt | undefined;
      if (typeof context.durationPlans.findReceipt === "function") {
        existingReceipt = await context.durationPlans.findReceipt({
          campaignId: campaign.id,
          actionId: input.actionId
        });
      } else if (typeof context.durationPlans.findReceiptByActionId === "function") {
        existingReceipt = await context.durationPlans.findReceiptByActionId(
          input.actionId,
          campaign.id
        );
      }

      if (existingReceipt) {
        if (existingReceipt.campaignId !== campaign.id) {
          throw new CampaignDurationPlanningError(
            "stale_plan",
            `Action ID "${input.actionId}" belongs to another campaign`
          );
        }
        if (existingReceipt.requestHash && existingReceipt.requestHash !== requestHash) {
          throw new CampaignDurationPlanningError(
            "stale_plan",
            `Action ID "${input.actionId}" was already processed with different request intent`
          );
        }
        return existingReceipt.response as ReplanCampaignCommitResponse;
      }

      const currentPlan = await context.durationPlans.findCurrentPlanByCampaignId(campaign.id);
      if (!currentPlan) {
        throw new Error(`Campaign '${campaign.id}' has no existing duration plan to replan`);
      }

      if (currentPlan.revision !== input.expectedPlanRevision) {
        throw new CampaignDurationPlanningError(
          "stale_plan",
          `Expected plan revision ${input.expectedPlanRevision}, but current plan revision is ${currentPlan.revision}`
        );
      }

      const scenes = await context.scenes.findByCampaignId(campaign.id, { forUpdate: true });
      const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      // Require complete vectors: all scenes must be present
      if (Object.keys(input.sceneIdDurations).length !== sortedScenes.length) {
        throw new CampaignDurationPlanningError(
          "no_feasible_allocation",
          `sceneIdDurations key count (${Object.keys(input.sceneIdDurations).length}) does not match scene count (${sortedScenes.length})`
        );
      }
      if (Object.keys(input.expectedSceneSpecRevisions).length !== sortedScenes.length) {
        throw new CampaignDurationPlanningError(
          "no_feasible_allocation",
          `expectedSceneSpecRevisions key count (${Object.keys(input.expectedSceneSpecRevisions).length}) does not match scene count (${sortedScenes.length})`
        );
      }

      for (const scene of sortedScenes) {
        if (input.sceneIdDurations[scene.id] === undefined) {
          throw new CampaignDurationPlanningError(
            "no_feasible_allocation",
            `Missing duration for scene '${scene.id}' in sceneIdDurations`
          );
        }
        if (input.expectedSceneSpecRevisions[scene.id] === undefined) {
          throw new CampaignDurationPlanningError(
            "no_feasible_allocation",
            `Missing expected spec revision for scene '${scene.id}' in expectedSceneSpecRevisions`
          );
        }
        const expectedRev = input.expectedSceneSpecRevisions[scene.id]!;
        if (scene.specRevision !== expectedRev) {
          throw new StaleRevisionConflictError(scene.id, expectedRev, scene.specRevision);
        }
      }

      const explicitSceneDurationsMs = sortedScenes.map((s) => input.sceneIdDurations[s.id]!);
      const targetTotalDurationMs = explicitSceneDurationsMs.reduce((sum, d) => sum + d, 0);

      const campaignTargetDurationMs =
        campaign.targetTotalDurationMs ??
        (campaign as unknown as { targetDurationMs?: number }).targetDurationMs ??
        currentPlan.requestedTotalDurationMs;

      // Enforce sum of durations matches campaign targetTotalDurationMs
      if (targetTotalDurationMs !== campaignTargetDurationMs) {
        throw new CampaignDurationPlanningError(
          "no_feasible_allocation",
          `Scene durations sum (${targetTotalDurationMs}ms) does not match campaign targetTotalDurationMs (${campaignTargetDurationMs}ms)`
        );
      }

      const selectedProfileKey = input.selectedProfileKey ?? currentPlan.selectedProfileKey;
      const allowedProfileKeys =
        input.allowedDurationProfileKeys ?? currentPlan.allowedDurationProfileKeys;

      const resolver = new ProfileSelectionResolver({
        productionReleaseReader: this.deps.productionReleaseReader,
        stagingAuthSource: this.deps.stagingAuthSource,
        registryReader: this.deps.registryReader
      });

      const capabilities = await resolver.buildCapabilitiesMap(input.principal);
      const selectedProfileSelection = await resolver.resolveSelection(
        selectedProfileKey,
        input.principal
      );
      const allowedProfileSelections = await Promise.all(
        allowedProfileKeys.map((k: string) => resolver.resolveSelection(k, input.principal))
      );
      resolver.verifyScopeAndRealm(selectedProfileSelection, currentPlan.scope, currentPlan.realm);
      for (const allowed of allowedProfileSelections) {
        resolver.verifyScopeAndRealm(allowed, currentPlan.scope, currentPlan.realm);
      }
      if (
        !allowedProfileSelections.some((s) => s.profileKey === selectedProfileSelection.profileKey)
      ) {
        throw new CampaignDurationPlanningError(
          "no_feasible_allocation",
          `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
        );
      }

      const newPlan = planFeasibleCampaignDuration({
        campaignId: campaign.id,
        targetTotalDurationMs,
        explicitSceneDurationsMs,
        existingAllocationIds: currentPlan.allocations.map((a) => a.allocationId),
        revision: currentPlan.revision + 1,
        predecessorPlanId: currentPlan.planId,
        selectedProfileSelection,
        allowedProfileSelections,
        realm: currentPlan.realm,
        scope: currentPlan.scope,
        envelope: currentPlan.envelope,
        capabilities
      });

      // Update all scenes: advance spec revision and invalidate approvals across entire campaign
      const updatedScenes: { sceneId: string; newSpecRevision: number }[] = [];
      for (let i = 0; i < sortedScenes.length; i++) {
        const scene = sortedScenes[i]!;
        const allocation = newPlan.allocations[i]!;

        if (typeof scene.rebindAllocation === "function") {
          scene.rebindAllocation(
            allocation.profileSelection.profileKey,
            allocation.requestedDurationMs
          );
        } else {
          const s = scene as unknown as Record<string, unknown>;
          const cfg = s.configuration as Record<string, unknown> | undefined;
          if (cfg && cfg.engineProfileId !== allocation.profileSelection.profileKey) {
            if (typeof s.updateEngine === "function") {
              s.updateEngine(allocation.profileSelection.profileKey);
            }
          }
          if (typeof s.updateDuration === "function") {
            s.updateDuration(allocation.requestedDurationMs);
          }
          if (s.status === "approved" && typeof s.invalidateApproval === "function") {
            s.invalidateApproval();
          }
        }

        await context.scenes.save(scene);

        updatedScenes.push({
          sceneId: scene.id,
          newSpecRevision: scene.specRevision
        });
      }

      // Compute full bindingDigest over ALL bindings
      const bindingEntries = sortedScenes.map((scene, i) => {
        const allocation = newPlan.allocations[i]!;
        return {
          allocationId: allocation.allocationId,
          sceneId: scene.id,
          specRevision: scene.specRevision,
          ordinal: allocation.ordinal
        };
      });
      const fullBindingDigest = computePlanBindingDigest(bindingEntries);

      const bindings: SceneDurationBinding[] = bindingEntries.map((entry) => ({
        bindingId: randomUUID(),
        campaignId: campaign.id,
        planId: newPlan.planId,
        planRevision: newPlan.revision,
        allocationId: entry.allocationId,
        sceneId: entry.sceneId,
        specRevision: entry.specRevision,
        ordinal: entry.ordinal,
        bindingDigest: fullBindingDigest,
        createdAt: new Date().toISOString()
      }));

      await context.durationPlans.savePlan(newPlan);
      await context.durationPlans.saveBindings(bindings);

      const updatedCampaign = {
        ...campaign,
        approvedScenes: 0,
        planRevision: newPlan.revision,
        currentDurationPlanId: newPlan.planId,
        selectedProfileKey: newPlan.selectedProfileKey,
        allowedDurationProfileKeys: newPlan.allowedDurationProfileKeys,
        updatedAt: new Date().toISOString()
      };
      await context.campaigns.save(updatedCampaign);

      const response: ReplanCampaignCommitResponse = {
        campaignId: campaign.id,
        newPlanRevision: newPlan.revision,
        plan: newPlan,
        bindings,
        updatedScenes
      };

      if (typeof context.durationPlans.saveReceipt === "function") {
        await context.durationPlans.saveReceipt({
          actionId: input.actionId,
          campaignId: campaign.id,
          realm: newPlan.realm,
          requestHash,
          response,
          createdAt: new Date().toISOString()
        });
      }

      return response;
    });
  }
}
