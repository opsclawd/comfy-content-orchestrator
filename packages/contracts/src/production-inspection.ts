import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { sortKeysDeep } from "@cco/shared";
import { z } from "zod";
import { sha256HashSchema } from "./persistent-media.js";
import { PreviewAvailabilitySchema, ReferenceRoleSchema } from "./reference-asset.js";
import {
  CameraAngleSchema,
  CameraMovementSchema,
  MovementSpeedSchema,
  ShotFramingSchema,
  ShotPlanRoutingModeSchema,
  ShotPlanStatusSchema,
  type ShotPlanRoutingMode
} from "./shot-plan.js";

// ============================================================================
// Enums & Literal Sets
// ============================================================================

export const PRODUCTION_READINESS_STATUSES = ["ready", "awaiting_approval", "blocked"] as const;

export const ProductionReadinessStatusSchema = z.enum(PRODUCTION_READINESS_STATUSES);
export type ProductionReadinessStatus = z.infer<typeof ProductionReadinessStatusSchema>;

// ============================================================================
// Admission Blockers
// ============================================================================

export const ProductionBlockerSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1)
});
export type ProductionBlocker = z.infer<typeof ProductionBlockerSchema>;

// ============================================================================
// Visual Conditioning Inputs
// ============================================================================

export const InspectedReferenceInputSchema = z.object({
  slotIndex: z.number().int().min(1).max(9),
  promptTag: z.string().regex(/^<Picture\s+[1-9]>$/),
  referenceAssetId: z.string().uuid(),
  displayName: z.string().min(1),
  role: ReferenceRoleSchema,
  contentHashSha256: sha256HashSchema,
  previewUrl: z.string().min(1).nullable().optional(),
  previewAvailability: PreviewAvailabilitySchema.default("unavailable")
});
export type InspectedReferenceInput = z.infer<typeof InspectedReferenceInputSchema>;

export const InspectedFrameAnchorSchema = z.object({
  frameAnchorTarget: z.enum(["first_frame", "last_frame", "both"]),
  anchorCandidateId: z.string().uuid(),
  anchorMediaHashSha256: sha256HashSchema,
  previewUrl: z.string().min(1).nullable().optional(),
  previewAvailability: PreviewAvailabilitySchema.default("unavailable")
});
export type InspectedFrameAnchor = z.infer<typeof InspectedFrameAnchorSchema>;

// ============================================================================
// Camera Intent Summary
// ============================================================================

export const CameraIntentSummarySchema = z.object({
  framing: ShotFramingSchema,
  angle: CameraAngleSchema,
  cameraMovement: CameraMovementSchema,
  movementSpeed: MovementSpeedSchema,
  lensIntent: z.string(),
  cameraPosition: z.string(),
  cameraPromptDescription: z.string().optional()
});
export type CameraIntentSummary = z.infer<typeof CameraIntentSummarySchema>;

// ============================================================================
// Full Inspection Read Model
// ============================================================================

export const H3ProductionInspectionReadModelSchema = z.object({
  authority: z.object({
    sceneId: z.string().uuid(),
    specRevision: z.number().int().positive(),
    shotPlanId: z.string().uuid().nullable().optional(),
    variantOrdinal: z.number().int().positive().nullable().optional(),
    shotPlanStatus: ShotPlanStatusSchema.nullable().optional(),
    isCurrentRevision: z.boolean()
  }),
  route: z.object({
    routingMode: ShotPlanRoutingModeSchema,
    renderProfileKey: z.string().min(1),
    workflowTemplate: z.string().min(1),
    targetDurationMs: z.number().positive(),
    targetFrameCount: z.number().int().positive(),
    fps: z.literal(24),
    width: z.literal(1344),
    height: z.literal(768)
  }),
  visualInputs: z.object({
    references: z.array(InspectedReferenceInputSchema).default([]),
    frameAnchor: InspectedFrameAnchorSchema.nullable().optional()
  }),
  instruction: z.object({
    compiledText: z.string(),
    compiledSha256: sha256HashSchema,
    cameraIntentSummary: CameraIntentSummarySchema.optional()
  }),
  admission: z.object({
    readiness: ProductionReadinessStatusSchema,
    blockers: z.array(ProductionBlockerSchema).default([])
  }),
  runtimeContext: z.object({
    durationCeilingSeconds: z.number().int().positive().optional()
  }),
  productionInputFingerprint: sha256HashSchema
});
export type H3ProductionInspectionReadModel = z.infer<typeof H3ProductionInspectionReadModelSchema>;

// ============================================================================
// Fingerprint Calculation
// ============================================================================

export interface ComputeProductionInputFingerprintInput {
  readonly sceneId: string;
  readonly specRevision: number;
  readonly shotPlanId?: string | null | undefined;
  readonly routingMode: ShotPlanRoutingMode;
  readonly renderProfileKey: string;
  readonly workflowTemplate: string;
  readonly targetDurationMs: number;
  readonly targetFrameCount: number;
  readonly fps?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly compiledInstructionText: string;
  readonly compiledInstructionSha256: string;
  readonly references?:
    | readonly {
        readonly slotIndex: number;
        readonly referenceAssetId: string;
        readonly role: string;
        readonly contentHashSha256: string;
      }[]
    | undefined;
  readonly frameAnchor?:
    | {
        readonly frameAnchorTarget: string;
        readonly anchorCandidateId: string;
        readonly anchorMediaHashSha256: string;
      }
    | null
    | undefined;
}

/**
 * Pure, deterministic sha256 fingerprint over the canonical (key-sorted) JSON representation
 * of the exact immutable and compiled inputs that condition MiniMax-H3 production.
 *
 * Pure function: no I/O, no randomness, no wall-clock dependency.
 * Safe for browser bundling via `@noble/hashes`.
 */
export function computeProductionInputFingerprint(
  input: ComputeProductionInputFingerprintInput
): string {
  const canonical = sortKeysDeep({
    frameAnchor:
      input.routingMode === "frame_anchored" && input.frameAnchor
        ? {
            anchorCandidateId: input.frameAnchor.anchorCandidateId,
            anchorMediaHashSha256: input.frameAnchor.anchorMediaHashSha256,
            frameAnchorTarget: input.frameAnchor.frameAnchorTarget
          }
        : null,
    geometry: {
      fps: input.fps ?? 24,
      height: input.height ?? 768,
      targetDurationMs: input.targetDurationMs,
      targetFrameCount: input.targetFrameCount,
      width: input.width ?? 1344
    },
    instruction: {
      sha256: input.compiledInstructionSha256,
      text: input.compiledInstructionText
    },
    references:
      input.routingMode === "reference_directed" && input.references
        ? input.references
            .map((r) => ({
              assetId: r.referenceAssetId,
              contentHashSha256: r.contentHashSha256,
              role: r.role,
              slotIndex: r.slotIndex
            }))
            .sort((a, b) => a.slotIndex - b.slotIndex)
        : [],
    renderProfileKey: input.renderProfileKey,
    routingMode: input.routingMode,
    sceneId: input.sceneId,
    shotPlanId: input.shotPlanId ?? null,
    specRevision: input.specRevision,
    workflowTemplate: input.workflowTemplate
  });

  const encoded = new TextEncoder().encode(JSON.stringify(canonical));
  return bytesToHex(sha256(encoded));
}
