import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import { classifyCampaignAnimaticGap } from "./campaign-animatic.js";
import { MINIMAX_H3_MAX_REFERENCES, ShotPlanRoutingModeSchema } from "./shot-plan.js";
import { ReferenceRoleSchema } from "./reference-asset.js";

// ============================================================================
// Planning-only vocabulary — deliberately distinct from #363 production admission
// ============================================================================

export const CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE =
  "PRE-PRODUCTION PLANNING READINESS — NOT A PRODUCTION-INPUT CERTIFICATION" as const;

export const CampaignReadinessSceneStatusSchema = z.enum([
  "planning_ready",
  "needs_attention",
  "blocked_for_planning"
]);
export type CampaignReadinessSceneStatus = z.infer<typeof CampaignReadinessSceneStatusSchema>;

export const CampaignReadinessBlockerCodeSchema = z.enum([
  "MISSING_REFERENCE_BINDINGS",
  "ARCHIVED_REFERENCE_BINDING",
  "CROSS_CLIENT_REFERENCE_BINDING",
  "REFERENCE_LIMIT_EXCEEDED",
  "NO_CURRENT_SHOT_PLANS",
  "NO_SHOT_PLAN_SELECTED",
  "SHOT_PLAN_SELECTION_STALE",
  "SHOT_PLAN_NOT_APPROVED",
  "MISSING_FRAME_ANCHOR",
  "NOT_IN_CAMPAIGN_ANIMATIC"
]);
export type CampaignReadinessBlockerCode = z.infer<typeof CampaignReadinessBlockerCodeSchema>;

export const CampaignReadinessAdvisoryCodeSchema = z.enum([
  "NO_PREVIS_AVAILABLE",
  "SINGLE_SHOT_PLAN_VARIANT"
]);
export type CampaignReadinessAdvisoryCode = z.infer<typeof CampaignReadinessAdvisoryCodeSchema>;

export const CampaignReadinessDrillDownSectionSchema = z.enum([
  "references",
  "shot-plans",
  "approval",
  "previs",
  "animatic"
]);
export type CampaignReadinessDrillDownSection = z.infer<
  typeof CampaignReadinessDrillDownSectionSchema
>;

export const CampaignReadinessDrillDownSchema = z.object({
  sceneId: z.string().uuid(),
  sceneOrder: z.number().int().positive(),
  section: CampaignReadinessDrillDownSectionSchema
});
export type CampaignReadinessDrillDown = z.infer<typeof CampaignReadinessDrillDownSchema>;

export const CampaignReadinessBlockerSchema = z.object({
  code: CampaignReadinessBlockerCodeSchema,
  severity: z.enum(["blocked", "attention"]),
  message: z.string().min(1),
  remediationHint: z.string().min(1),
  drillDown: CampaignReadinessDrillDownSchema
});
export type CampaignReadinessBlocker = z.infer<typeof CampaignReadinessBlockerSchema>;

export const CampaignReadinessAdvisorySchema = z.object({
  code: CampaignReadinessAdvisoryCodeSchema,
  message: z.string().min(1),
  drillDown: CampaignReadinessDrillDownSchema
});
export type CampaignReadinessAdvisory = z.infer<typeof CampaignReadinessAdvisorySchema>;

export const CampaignReadinessStalenessSchema = z.object({
  isStaleAfterRevisionChange: z.boolean(),
  currentSpecRevision: z.number().int().positive(),
  lastPlannedSpecRevision: z.number().int().positive().nullable(),
  supersededShotPlanCount: z.number().int().nonnegative()
});
export type CampaignReadinessStaleness = z.infer<typeof CampaignReadinessStalenessSchema>;

export const CampaignReadinessSceneProjectionSchema = z.object({
  sceneId: z.string().uuid(),
  sceneOrder: z.number().int().positive(),
  specRevision: z.number().int().positive(),
  status: CampaignReadinessSceneStatusSchema,
  routingMode: ShotPlanRoutingModeSchema,
  referenceBindings: z.object({
    count: z.number().int().nonnegative(),
    roles: z.array(ReferenceRoleSchema),
    allCurrent: z.boolean(),
    hasArchived: z.boolean(),
    hasCrossClient: z.boolean(),
    withinLimit: z.boolean()
  }),
  shotPlans: z.object({
    currentRevisionCount: z.number().int().nonnegative(),
    supersededCount: z.number().int().nonnegative(),
    selectedShotPlanId: z.string().uuid().nullable(),
    selectedIsCurrentRevision: z.boolean(),
    approvedShotPlanId: z.string().uuid().nullable(),
    hasApprovedCurrentRevision: z.boolean()
  }),
  previs: z.object({
    available: z.boolean(),
    candidateId: z.string().uuid().nullable()
  }),
  animatic: z.object({
    included: z.boolean(),
    gapReason: z.string().nullable(),
    gapMessage: z.string().nullable()
  }),
  shotPlanAnimaticAvailable: z.boolean(),
  staleness: CampaignReadinessStalenessSchema,
  blockers: z.array(CampaignReadinessBlockerSchema),
  advisories: z.array(CampaignReadinessAdvisorySchema)
});
export type CampaignReadinessSceneProjection = z.infer<
  typeof CampaignReadinessSceneProjectionSchema
>;

export const CampaignReadinessAggregatesSchema = z.object({
  totalScenes: z.number().int().nonnegative(),
  planningReadyCount: z.number().int().nonnegative(),
  needsAttentionCount: z.number().int().nonnegative(),
  blockedForPlanningCount: z.number().int().nonnegative(),
  currentReferenceSceneCount: z.number().int().nonnegative(),
  scenesWithCurrentShotPlansCount: z.number().int().nonnegative(),
  scenesWithSelectionCount: z.number().int().nonnegative(),
  approvedSceneCount: z.number().int().nonnegative(),
  scenesWithPrevisCount: z.number().int().nonnegative(),
  scenesInCampaignAnimaticCount: z.number().int().nonnegative(),
  staleSceneCount: z.number().int().nonnegative()
});
export type CampaignReadinessAggregates = z.infer<typeof CampaignReadinessAggregatesSchema>;

export const CampaignPreProductionReadinessReadModelSchema = z.object({
  campaignId: z.string().uuid(),
  campaignName: z.string().min(1),
  campaignStatus: CampaignReadinessSceneStatusSchema,
  readinessStatus: CampaignReadinessSceneStatusSchema,
  readSnapshotId: z.string().min(1),
  aggregates: CampaignReadinessAggregatesSchema,
  scenes: z.array(CampaignReadinessSceneProjectionSchema),
  planningOnlyNotice: z.string().min(1),
  computedAt: z.string()
});
export type CampaignPreProductionReadinessReadModel = z.infer<
  typeof CampaignPreProductionReadinessReadModelSchema
>;

// ============================================================================
// Snapshot fingerprint (D7)
// ============================================================================

export interface CampaignReadinessSnapshotSceneInput {
  readonly sceneId: string;
  readonly specRevision: number;
  readonly sceneUpdatedAt: string;
  readonly selectedShotPlanId: string | null;
  readonly approvedShotPlanId: string | null;
  readonly selectedCandidateId: string | null;
  readonly routingMode: string;
  readonly bindingFingerprint: string;
  readonly currentPlanCount: number;
}

export function computeCampaignReadinessSnapshotId(
  campaignId: string,
  campaignUpdatedAt: string,
  scenes: readonly CampaignReadinessSnapshotSceneInput[]
): string {
  const sceneTokens = scenes.map(
    (s) =>
      `${s.sceneId}:r${s.specRevision}:u${s.sceneUpdatedAt}:sel${s.selectedShotPlanId ?? "none"}:appr${s.approvedShotPlanId ?? "none"}:cand${s.selectedCandidateId ?? "none"}:mode${s.routingMode}:bind${s.bindingFingerprint}:cnt${s.currentPlanCount}`
  );
  const payload = `${campaignId}:${campaignUpdatedAt}:${sceneTokens.join(";")}`;
  const hash = bytesToHex(sha256(new TextEncoder().encode(payload)));
  return `cpr-${hash.slice(0, 32)}`;
}

// ============================================================================
// Raw input shape supplied by the infrastructure adapter
// ============================================================================

export interface RawReadinessSceneInput {
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly specRevision: number;
  readonly sceneUpdatedAt: string;
  readonly routingMode: "reference_directed" | "frame_anchored";
  readonly selectedShotPlanId: string | null;
  readonly selectedShotPlanRevision: number | null;
  readonly approvedShotPlanId: string | null;
  readonly approvedShotPlanRevision: number | null;
  readonly selectedCandidateId: string | null;
  readonly selectedCandidateRevision: number | null;
  readonly selectedShotPlanSpecRevision: number | null;
  readonly selectedShotPlanStatus: string | null;
  readonly selectedShotPlanPrevisCandidateId: string | null;
  readonly currentRevisionShotPlanCount: number;
  readonly supersededShotPlanCount: number;
  readonly lastPlannedSpecRevision: number | null;
  readonly currentRevisionBindingCount: number;
  readonly currentRevisionBindingRoles: readonly string[];
  readonly hasArchivedBinding: boolean;
  readonly hasCrossClientBinding: boolean;
  readonly currentRevisionPrevisAvailable: boolean;
  readonly currentRevisionPrevisCandidateId: string | null;
}

export interface CompileCampaignPreProductionReadinessParams {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly campaignUpdatedAt: string;
  readonly scenes: readonly RawReadinessSceneInput[];
  readonly computedAt?: string | undefined;
}

function bandOf(status: CampaignReadinessSceneStatus): number {
  if (status === "blocked_for_planning") return 2;
  if (status === "needs_attention") return 1;
  return 0;
}

function statusFromBlockers(
  blockers: readonly CampaignReadinessBlocker[]
): CampaignReadinessSceneStatus {
  if (blockers.some((b) => b.severity === "blocked")) return "blocked_for_planning";
  if (blockers.some((b) => b.severity === "attention")) return "needs_attention";
  return "planning_ready";
}

/**
 * Pure, deterministic projector from already-persisted planning/review state to a
 * campaign-level pre-production readiness read model. Performs no I/O and never
 * touches the H3 production-input resolver reserved for #363 — this module has no
 * import path into application/infrastructure by construction (see
 * `contracts-are-standalone` boundary rule).
 */
export function compileCampaignPreProductionReadiness(
  params: CompileCampaignPreProductionReadinessParams
): CampaignPreProductionReadinessReadModel {
  const { campaignId, campaignName, campaignUpdatedAt, scenes } = params;
  const computedAt = params.computedAt ?? new Date().toISOString();

  const sortedScenes = [...scenes].sort((a, b) => a.sceneOrder - b.sceneOrder);

  const sceneProjections: CampaignReadinessSceneProjection[] = sortedScenes.map((scene) => {
    const drillDown = (section: CampaignReadinessDrillDownSection): CampaignReadinessDrillDown => ({
      sceneId: scene.sceneId,
      sceneOrder: scene.sceneOrder,
      section
    });

    const blockers: CampaignReadinessBlocker[] = [];
    const advisories: CampaignReadinessAdvisory[] = [];

    const withinLimit = scene.currentRevisionBindingCount <= MINIMAX_H3_MAX_REFERENCES;
    const allCurrent =
      scene.currentRevisionBindingCount > 0 &&
      !scene.hasArchivedBinding &&
      !scene.hasCrossClientBinding;

    if (scene.currentRevisionBindingCount === 0) {
      blockers.push({
        code: "MISSING_REFERENCE_BINDINGS",
        severity: "blocked",
        message: `Scene ${scene.sceneOrder} has no reference bindings for Revision ${scene.specRevision}`,
        remediationHint: "Bind reference assets to this scene revision",
        drillDown: drillDown("references")
      });
    }
    if (scene.hasArchivedBinding) {
      blockers.push({
        code: "ARCHIVED_REFERENCE_BINDING",
        severity: "blocked",
        message: `Scene ${scene.sceneOrder} has a bound reference asset that has been archived`,
        remediationHint: "Replace the archived reference asset binding",
        drillDown: drillDown("references")
      });
    }
    if (scene.hasCrossClientBinding) {
      blockers.push({
        code: "CROSS_CLIENT_REFERENCE_BINDING",
        severity: "blocked",
        message: `Scene ${scene.sceneOrder} has a bound reference asset belonging to a different client`,
        remediationHint: "Remove the cross-client reference asset binding",
        drillDown: drillDown("references")
      });
    }
    if (!withinLimit) {
      blockers.push({
        code: "REFERENCE_LIMIT_EXCEEDED",
        severity: "blocked",
        message: `Scene ${scene.sceneOrder} has ${scene.currentRevisionBindingCount} reference bindings, exceeding the limit of ${MINIMAX_H3_MAX_REFERENCES}`,
        remediationHint: "Remove reference bindings to bring the count within the limit",
        drillDown: drillDown("references")
      });
    }
    if (scene.currentRevisionShotPlanCount === 0) {
      blockers.push({
        code: "NO_CURRENT_SHOT_PLANS",
        severity: "blocked",
        message: `Scene ${scene.sceneOrder} has no ShotPlans generated for Revision ${scene.specRevision}`,
        remediationHint: "Generate ShotPlans for the current revision",
        drillDown: drillDown("shot-plans")
      });
    }

    const isStaleAfterRevisionChange =
      scene.specRevision > 1 &&
      scene.selectedShotPlanId === null &&
      scene.lastPlannedSpecRevision !== null &&
      scene.lastPlannedSpecRevision < scene.specRevision;

    if (scene.selectedShotPlanId === null) {
      if (isStaleAfterRevisionChange) {
        blockers.push({
          code: "SHOT_PLAN_SELECTION_STALE",
          severity: "attention",
          message: `Scene ${scene.sceneOrder}: References changed — regenerate/select ShotPlan`,
          remediationHint: "Select a ShotPlan for the current revision",
          drillDown: drillDown("shot-plans")
        });
      } else if (scene.currentRevisionShotPlanCount > 0) {
        blockers.push({
          code: "NO_SHOT_PLAN_SELECTED",
          severity: "attention",
          message: `Scene ${scene.sceneOrder} has no current-revision ShotPlan selected`,
          remediationHint: "Select a ShotPlan",
          drillDown: drillDown("shot-plans")
        });
      }
    }

    const selectedIsCurrentRevision =
      scene.selectedShotPlanId !== null && scene.selectedShotPlanRevision === scene.specRevision;

    if (
      scene.selectedShotPlanId !== null &&
      selectedIsCurrentRevision &&
      scene.approvedShotPlanId === null
    ) {
      blockers.push({
        code: "SHOT_PLAN_NOT_APPROVED",
        severity: "attention",
        message: `Scene ${scene.sceneOrder} has a selected ShotPlan that is not yet approved`,
        remediationHint: "Approve the selected ShotPlan",
        drillDown: drillDown("approval")
      });
    }

    if (
      scene.routingMode === "frame_anchored" &&
      (scene.selectedCandidateId === null || scene.selectedCandidateRevision !== scene.specRevision)
    ) {
      blockers.push({
        code: "MISSING_FRAME_ANCHOR",
        severity: "attention",
        message: `Scene ${scene.sceneOrder} is frame-anchored but has no current-revision frame anchor selected`,
        remediationHint: "Select a current-revision candidate as the frame anchor",
        drillDown: drillDown("previs")
      });
    }

    const gap = classifyCampaignAnimaticGap({
      sceneId: scene.sceneId,
      sceneOrder: scene.sceneOrder,
      specRevision: scene.specRevision,
      selectedShotPlanId: scene.selectedShotPlanId,
      selectedShotPlanRevision: scene.selectedShotPlanRevision,
      selectedShotPlan:
        scene.selectedShotPlanId !== null && scene.selectedShotPlanSpecRevision !== null
          ? { specRevision: scene.selectedShotPlanSpecRevision }
          : null
    });

    const included = gap === null;
    if (gap !== null) {
      blockers.push({
        code: "NOT_IN_CAMPAIGN_ANIMATIC",
        severity: "attention",
        message: `Scene ${scene.sceneOrder} is not represented in the campaign animatic: ${gap.message}`,
        remediationHint:
          "Resolve the ShotPlan selection so the scene appears in the campaign animatic",
        drillDown: drillDown("animatic")
      });
    }

    const hasApprovedCurrentRevision =
      scene.approvedShotPlanId !== null && scene.approvedShotPlanRevision === scene.specRevision;

    if (scene.routingMode === "reference_directed" && !scene.currentRevisionPrevisAvailable) {
      advisories.push({
        code: "NO_PREVIS_AVAILABLE",
        message: `Scene ${scene.sceneOrder} has no previs available for the current revision (advisory only)`,
        drillDown: drillDown("previs")
      });
    }

    if (scene.currentRevisionShotPlanCount === 1) {
      advisories.push({
        code: "SINGLE_SHOT_PLAN_VARIANT",
        message: `Scene ${scene.sceneOrder} has only a single ShotPlan variant generated`,
        drillDown: drillDown("shot-plans")
      });
    }

    const status = statusFromBlockers(blockers);

    const shotPlanAnimaticAvailable = selectedIsCurrentRevision;

    return {
      sceneId: scene.sceneId,
      sceneOrder: scene.sceneOrder,
      specRevision: scene.specRevision,
      status,
      routingMode: scene.routingMode,
      referenceBindings: {
        count: scene.currentRevisionBindingCount,
        roles: [
          ...scene.currentRevisionBindingRoles
        ] as CampaignReadinessSceneProjection["referenceBindings"]["roles"],
        allCurrent,
        hasArchived: scene.hasArchivedBinding,
        hasCrossClient: scene.hasCrossClientBinding,
        withinLimit
      },
      shotPlans: {
        currentRevisionCount: scene.currentRevisionShotPlanCount,
        supersededCount: scene.supersededShotPlanCount,
        selectedShotPlanId: scene.selectedShotPlanId,
        selectedIsCurrentRevision,
        approvedShotPlanId: scene.approvedShotPlanId,
        hasApprovedCurrentRevision
      },
      previs: {
        available: scene.currentRevisionPrevisAvailable,
        candidateId: scene.currentRevisionPrevisCandidateId
      },
      animatic: {
        included,
        gapReason: gap?.reason ?? null,
        gapMessage: gap?.message ?? null
      },
      shotPlanAnimaticAvailable,
      staleness: {
        isStaleAfterRevisionChange,
        currentSpecRevision: scene.specRevision,
        lastPlannedSpecRevision: scene.lastPlannedSpecRevision,
        supersededShotPlanCount: scene.supersededShotPlanCount
      },
      blockers,
      advisories
    };
  });

  const snapshotScenes: CampaignReadinessSnapshotSceneInput[] = sortedScenes.map((s) => ({
    sceneId: s.sceneId,
    specRevision: s.specRevision,
    sceneUpdatedAt: s.sceneUpdatedAt,
    selectedShotPlanId: s.selectedShotPlanId,
    approvedShotPlanId: s.approvedShotPlanId,
    selectedCandidateId: s.selectedCandidateId,
    routingMode: s.routingMode,
    bindingFingerprint: `${s.currentRevisionBindingCount}:${[...s.currentRevisionBindingRoles].sort().join(",")}:${s.hasArchivedBinding}:${s.hasCrossClientBinding}`,
    currentPlanCount: s.currentRevisionShotPlanCount
  }));

  const readSnapshotId = computeCampaignReadinessSnapshotId(
    campaignId,
    campaignUpdatedAt,
    snapshotScenes
  );

  const aggregates: CampaignReadinessAggregates = {
    totalScenes: sceneProjections.length,
    planningReadyCount: sceneProjections.filter((s) => s.status === "planning_ready").length,
    needsAttentionCount: sceneProjections.filter((s) => s.status === "needs_attention").length,
    blockedForPlanningCount: sceneProjections.filter((s) => s.status === "blocked_for_planning")
      .length,
    currentReferenceSceneCount: sceneProjections.filter((s) => s.referenceBindings.allCurrent)
      .length,
    scenesWithCurrentShotPlansCount: sceneProjections.filter(
      (s) => s.shotPlans.currentRevisionCount > 0
    ).length,
    scenesWithSelectionCount: sceneProjections.filter((s) => s.shotPlans.selectedIsCurrentRevision)
      .length,
    approvedSceneCount: sceneProjections.filter((s) => s.shotPlans.hasApprovedCurrentRevision)
      .length,
    scenesWithPrevisCount: sceneProjections.filter((s) => s.previs.available).length,
    scenesInCampaignAnimaticCount: sceneProjections.filter((s) => s.animatic.included).length,
    staleSceneCount: sceneProjections.filter((s) => s.staleness.isStaleAfterRevisionChange).length
  };

  const readinessStatus: CampaignReadinessSceneStatus =
    sceneProjections.length === 0
      ? "blocked_for_planning"
      : sceneProjections.reduce<CampaignReadinessSceneStatus>(
          (worst, scene) => (bandOf(scene.status) > bandOf(worst) ? scene.status : worst),
          "planning_ready"
        );

  return {
    campaignId,
    campaignName,
    campaignStatus: readinessStatus,
    readinessStatus,
    readSnapshotId,
    aggregates,
    scenes: sceneProjections,
    planningOnlyNotice: CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE,
    computedAt
  };
}
