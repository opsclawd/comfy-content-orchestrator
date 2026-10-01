import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import {
  CameraMotionPlanSchema,
  AnimaticTemporalBeatCueSchema,
  AnimaticDialogueCueSchema,
  ShotPlanAnimaticTimelineSchema,
  compileShotPlanAnimaticTimeline,
  ANIMATIC_NON_PRODUCTION_NOTICE
} from "./shot-plan-animatic.js";
import type { ShotPlanDocument } from "./shot-plan.js";
import type { ShotPlanReviewItem } from "./scene-review.js";

// ============================================================================
// Schemas for Deterministic Campaign Animatic Read Model
// ============================================================================

export const CampaignAnimaticGapReasonSchema = z.enum([
  "NO_SELECTION",
  "STALE_SELECTION",
  "SHOT_PLAN_NOT_FOUND",
  "SPEC_REVISION_MISMATCH"
]);
export type CampaignAnimaticGapReason = z.infer<typeof CampaignAnimaticGapReasonSchema>;

export const CampaignAnimaticShotSegmentSchema = z.object({
  sceneId: z.string().uuid(),
  sceneOrder: z.number().int().positive(),
  specRevision: z.number().int().positive(),
  hasPlan: z.literal(true),
  shotPlanId: z.string().uuid(),
  variantOrdinal: z.number().int().positive(),
  approvalStatus: z.enum(["approved", "draft"]),
  targetDurationMs: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  timeline: ShotPlanAnimaticTimelineSchema,
  actionSummary: z.string(),
  dialogue: AnimaticDialogueCueSchema.nullable(),
  camera: CameraMotionPlanSchema,
  beats: z.array(AnimaticTemporalBeatCueSchema),
  previsMedia: z.object({
    available: z.boolean(),
    url: z.string().nullable(),
    candidateId: z.string().nullable(),
    reviewNotes: z.string().nullable()
  })
});
export type CampaignAnimaticShotSegment = z.infer<typeof CampaignAnimaticShotSegmentSchema>;

export const CampaignAnimaticGapSegmentSchema = z.object({
  sceneId: z.string().uuid(),
  sceneOrder: z.number().int().positive(),
  specRevision: z.number().int().positive(),
  hasPlan: z.literal(false),
  gapReason: CampaignAnimaticGapReasonSchema,
  gapMessage: z.string().min(1),
  targetDurationMs: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive()
});
export type CampaignAnimaticGapSegment = z.infer<typeof CampaignAnimaticGapSegmentSchema>;

export const CampaignAnimaticSegmentSchema = z.discriminatedUnion("hasPlan", [
  CampaignAnimaticShotSegmentSchema,
  CampaignAnimaticGapSegmentSchema
]);
export type CampaignAnimaticSegment = z.infer<typeof CampaignAnimaticSegmentSchema>;

export const CampaignAnimaticReadModelSchema = z.object({
  campaignId: z.string().uuid(),
  campaignName: z.string().min(1),
  readSnapshotId: z.string().min(1),
  totalDurationMs: z.number().int().nonnegative(),
  includedShotPlanDurationMs: z.number().int().nonnegative(),
  totalScenes: z.number().int().nonnegative(),
  gapCount: z.number().int().nonnegative(),
  approvedShotCount: z.number().int().nonnegative(),
  draftShotCount: z.number().int().nonnegative(),
  segments: z.array(CampaignAnimaticSegmentSchema),
  nonProductionNotice: z.string().min(1),
  compiledAt: z.string()
});
export type CampaignAnimaticReadModel = z.infer<typeof CampaignAnimaticReadModelSchema>;

// ============================================================================
// Constants
// ============================================================================

export const CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE =
  "CAMPAIGN STORYBOARD ANIMATIC — NON-PRODUCTION PLANNING PREVIEW" as const;

export { ANIMATIC_NON_PRODUCTION_NOTICE };

// ============================================================================
// Snapshot Fingerprint Derivation
// ============================================================================

export interface CampaignAnimaticSnapshotSceneInput {
  readonly sceneId: string;
  readonly specRevision: number;
  readonly selectedShotPlanId: string | null;
  readonly approvedShotPlanId: string | null;
}

/**
 * Derives a deterministic snapshot fingerprint across campaign state and all scene selections.
 */
export function computeCampaignAnimaticSnapshotId(
  campaignId: string,
  campaignUpdatedAt: string,
  scenes: readonly CampaignAnimaticSnapshotSceneInput[]
): string {
  const sceneTokens = scenes.map(
    (s) =>
      `${s.sceneId}:r${s.specRevision}:sel${s.selectedShotPlanId ?? "none"}:appr${s.approvedShotPlanId ?? "none"}`
  );
  const payload = `${campaignId}:${campaignUpdatedAt}:${sceneTokens.join(";")}`;
  const hash = bytesToHex(sha256(new TextEncoder().encode(payload)));
  return `cas-${hash.slice(0, 32)}`;
}

// ============================================================================
// Pure Deterministic Timeline Helpers
// ============================================================================

/**
 * Finds the currently active segment at the given millisecond timestamp.
 * Handles boundary transitions using hard cuts: [startMs, endMs) for non-terminal
 * segments, and [startMs, endMs] for the final segment.
 */
export function findActiveCampaignSegment(
  readModel: CampaignAnimaticReadModel,
  currentMs: number
): CampaignAnimaticSegment | null {
  const { segments, totalDurationMs } = readModel;
  if (!segments || segments.length === 0) {
    return null;
  }
  const clampedMs = Math.max(0, Math.min(totalDurationMs, currentMs));
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const isLast = i === segments.length - 1;
    if (seg.startMs <= clampedMs && (isLast ? clampedMs <= seg.endMs : clampedMs < seg.endMs)) {
      return seg;
    }
  }
  return segments[segments.length - 1] ?? null;
}

/**
 * Computes shot-local elapsed milliseconds within the given segment.
 */
export function computeShotLocalTimeMs(
  segment: CampaignAnimaticSegment,
  currentMs: number
): number {
  return Math.max(0, Math.min(segment.targetDurationMs, currentMs - segment.startMs));
}

/**
 * Seeks to the start of the next segment (the end of the current active segment).
 */
export function findNextSegmentStartTime(
  readModel: CampaignAnimaticReadModel,
  currentMs: number
): number {
  const active = findActiveCampaignSegment(readModel, currentMs);
  if (!active) {
    return 0;
  }
  return Math.min(readModel.totalDurationMs, active.endMs);
}

/**
 * Seeks to the start of the current segment if more than thresholdMs has elapsed,
 * otherwise seeks to the start of the preceding segment.
 */
export function findPreviousSegmentStartTime(
  readModel: CampaignAnimaticReadModel,
  currentMs: number,
  thresholdMs: number = 500
): number {
  const { segments } = readModel;
  if (!segments || segments.length === 0) {
    return 0;
  }
  const active = findActiveCampaignSegment(readModel, currentMs);
  if (!active) {
    return 0;
  }
  const localElapsed = currentMs - active.startMs;
  if (localElapsed > thresholdMs) {
    return active.startMs;
  }
  const activeIdx = segments.findIndex(
    (s) => s.sceneId === active.sceneId && s.sceneOrder === active.sceneOrder
  );
  if (activeIdx > 0) {
    return segments[activeIdx - 1]!.startMs;
  }
  return 0;
}

// ============================================================================
// Shared Gap Classification
// ============================================================================

export interface AnimaticGapClassificationInput {
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly specRevision: number;
  readonly selectedShotPlanId: string | null;
  readonly selectedShotPlanRevision: number | null;
  readonly selectedShotPlan?: { readonly specRevision: number } | null | undefined;
}

export interface AnimaticGapClassification {
  readonly reason: CampaignAnimaticGapReason;
  readonly message: string;
}

/**
 * Fixed decision ladder used by both the campaign animatic compiler and the
 * campaign pre-production readiness compiler to determine whether a scene's
 * current-revision ShotPlan selection resolves to playable content. Extracted
 * so both compilers share a single source of truth for gap semantics.
 */
export function classifyCampaignAnimaticGap(
  scene: AnimaticGapClassificationInput
): AnimaticGapClassification | null {
  if (!scene.selectedShotPlanId) {
    return {
      reason: "NO_SELECTION",
      message: `Scene ${scene.sceneOrder} has no ShotPlan selected for Revision ${scene.specRevision}`
    };
  }

  if (
    scene.selectedShotPlanRevision !== null &&
    scene.selectedShotPlanRevision !== undefined &&
    scene.selectedShotPlanRevision !== scene.specRevision
  ) {
    return {
      reason: "STALE_SELECTION",
      message: `Scene ${scene.sceneOrder} selection is from Revision ${scene.selectedShotPlanRevision}, but current spec is Revision ${scene.specRevision}`
    };
  }

  if (!scene.selectedShotPlan) {
    return {
      reason: "SHOT_PLAN_NOT_FOUND",
      message: `Selected ShotPlan ${scene.selectedShotPlanId} was not found`
    };
  }

  if (scene.selectedShotPlan.specRevision !== scene.specRevision) {
    return {
      reason: "SPEC_REVISION_MISMATCH",
      message: `Selected ShotPlan is Revision ${scene.selectedShotPlan.specRevision}, but current scene spec is Revision ${scene.specRevision}`
    };
  }

  return null;
}

// ============================================================================
// Pure Deterministic Compiler
// ============================================================================

export interface RawAnimaticSceneInput {
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly specRevision: number;
  readonly durationSeconds?: number | string | undefined;
  readonly selectedShotPlanId: string | null;
  readonly selectedShotPlanRevision: number | null;
  readonly approvedShotPlanId: string | null;
  readonly selectedShotPlan?: ShotPlanReviewItem | ShotPlanDocument | null | undefined;
  readonly fallbackPrevisUrl?: string | null | undefined;
}

export interface CompileCampaignAnimaticParams {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly campaignUpdatedAt: string;
  readonly scenes: readonly RawAnimaticSceneInput[];
  readonly compiledAt?: string | undefined;
}

/**
 * Compiles canonical scene inputs and resolved ShotPlans into an immutable CampaignAnimaticReadModel.
 * Enforces canonical ordering, fail-closed gap semantics, cumulative offset calculations,
 * and deterministic snapshot fingerprinting.
 */
export function compileCampaignAnimaticReadModel(
  params: CompileCampaignAnimaticParams
): CampaignAnimaticReadModel {
  const { campaignId, campaignName, campaignUpdatedAt, scenes } = params;
  const compiledAt = params.compiledAt ?? new Date().toISOString();

  // Sort scenes strictly by sceneOrder ascending (canonical campaign sequence)
  const sortedScenes = [...scenes].sort((a, b) => a.sceneOrder - b.sceneOrder);

  const snapshotScenes: CampaignAnimaticSnapshotSceneInput[] = sortedScenes.map((s) => ({
    sceneId: s.sceneId,
    specRevision: s.specRevision,
    selectedShotPlanId: s.selectedShotPlanId,
    approvedShotPlanId: s.approvedShotPlanId
  }));

  const readSnapshotId = computeCampaignAnimaticSnapshotId(
    campaignId,
    campaignUpdatedAt,
    snapshotScenes
  );

  let runningOffsetMs = 0;
  const segments: CampaignAnimaticSegment[] = [];
  let includedShotPlanDurationMs = 0;
  let gapCount = 0;
  let approvedShotCount = 0;
  let draftShotCount = 0;

  for (const scene of sortedScenes) {
    const startMs = runningOffsetMs;
    const rawDurationSec =
      typeof scene.durationSeconds === "number"
        ? scene.durationSeconds
        : scene.durationSeconds
          ? parseFloat(scene.durationSeconds)
          : 4;
    const sceneTargetDurationMs = Math.max(1000, Math.round(rawDurationSec * 1000));

    // Evaluate plan resolution and gap conditions
    const gap = classifyCampaignAnimaticGap(scene);

    if (gap !== null) {
      const targetDurationMs = sceneTargetDurationMs;
      const endMs = startMs + targetDurationMs;
      runningOffsetMs = endMs;
      gapCount++;

      segments.push({
        sceneId: scene.sceneId,
        sceneOrder: scene.sceneOrder,
        specRevision: scene.specRevision,
        hasPlan: false,
        gapReason: gap.reason,
        gapMessage: gap.message,
        targetDurationMs,
        startMs,
        endMs
      });
    } else {
      const plan = scene.selectedShotPlan!;
      const isApproved =
        scene.approvedShotPlanId === scene.selectedShotPlanId || plan.status === "approved";
      const approvalStatus: "approved" | "draft" = isApproved ? "approved" : "draft";

      const timeline = compileShotPlanAnimaticTimeline(plan, {
        isCurrentRevision: true
      });

      const targetDurationMs = plan.targetDurationMs;
      const endMs = startMs + targetDurationMs;
      runningOffsetMs = endMs;
      includedShotPlanDurationMs += targetDurationMs;

      if (approvalStatus === "approved") {
        approvedShotCount++;
      } else {
        draftShotCount++;
      }

      segments.push({
        sceneId: scene.sceneId,
        sceneOrder: scene.sceneOrder,
        specRevision: scene.specRevision,
        hasPlan: true,
        shotPlanId: timeline.shotPlanId,
        variantOrdinal: timeline.variantOrdinal,
        approvalStatus,
        targetDurationMs,
        startMs,
        endMs,
        timeline,
        actionSummary: plan.actionSummary ?? "",
        dialogue: timeline.dialogue,
        camera: timeline.camera,
        beats: timeline.beats,
        previsMedia: timeline.previsMedia.available
          ? timeline.previsMedia
          : scene.fallbackPrevisUrl
            ? {
                available: true,
                url: scene.fallbackPrevisUrl,
                candidateId: timeline.previsMedia.candidateId,
                reviewNotes: timeline.previsMedia.reviewNotes
              }
            : timeline.previsMedia
      });
    }
  }

  const totalDurationMs = runningOffsetMs;

  return {
    campaignId,
    campaignName,
    readSnapshotId,
    totalDurationMs,
    includedShotPlanDurationMs,
    totalScenes: segments.length,
    gapCount,
    approvedShotCount,
    draftShotCount,
    segments,
    nonProductionNotice: CAMPAIGN_ANIMATIC_NON_PRODUCTION_NOTICE,
    compiledAt
  };
}
