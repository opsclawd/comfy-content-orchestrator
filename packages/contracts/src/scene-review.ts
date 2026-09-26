import { sortKeysDeep } from "@cco/shared";
import { z } from "zod";
import { CampaignStatusSchema } from "./campaign-status.js";
import { SceneReferenceBindingSchema } from "./reference-asset.js";
import {
  ShotFramingSchema,
  CameraAngleSchema,
  CameraMovementSchema,
  MovementSpeedSchema,
  LightingStyleSchema,
  ShotPlanStatusSchema,
  ShotPlanRoutingModeSchema,
  ShotPlanSubjectBlockingSchema,
  ShotPlanTemporalBeatSchema,
  ShotPlanDialogueIntentSchema,
  ShotPlanContinuityConstraintsSchema
} from "./shot-plan.js";

export const SCENE_STATUSES = [
  "draft_pending",
  "generating_candidates",
  "director_review",
  "approved",
  "queued",
  "rendering",
  "qa",
  "completed",
  "failed",
  "cancelled"
] as const;

export const REVIEW_ACTIONS = [
  "approve",
  "reject",
  "reroll",
  "prompt_edit",
  "reference_change",
  "engine_change",
  "duration_change",
  "lora_tune",
  "reorder",
  "duplicate",
  "cancel",
  "candidate_select",
  "production_accept",
  "production_rerender",
  "select_shotplan",
  "approve_shotplan",
  "reroll_shotplan"
] as const;

export const SceneStatusSchema = z.enum(SCENE_STATUSES);
export type SceneStatus = z.infer<typeof SceneStatusSchema>;

export const ReviewActionSchema = z.enum(REVIEW_ACTIONS);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const ReviewEventSchema = z.object({
  eventId: z.string().min(1),
  sceneId: z.string().min(1),
  reviewerName: z.string().min(1),
  action: ReviewActionSchema,
  directorNotes: z.string().optional(),
  mutationPayload: z.record(z.string(), z.unknown()),
  priorSceneStatus: SceneStatusSchema,
  resultingSceneStatus: SceneStatusSchema,
  expectedSpecRevision: z.number().int().positive().optional(),
  resultingSpecRevision: z.number().int().positive().optional(),
  requestHashSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  occurredAt: z.string().datetime()
});

export type ReviewEvent = z.infer<typeof ReviewEventSchema>;

export const SceneConfigurationSchema = z.object({
  prompt: z.string(),
  referenceIds: z.array(z.string()),
  referenceBindings: z.array(SceneReferenceBindingSchema).optional(),
  engineProfileId: z.string().min(1),
  durationMs: z.number().int().positive(),
  loraConfigurationId: z.string().nullable().optional()
});
export type SceneConfiguration = z.infer<typeof SceneConfigurationSchema>;

export const MediaAvailabilitySchema = z.object({
  available: z.boolean(),
  url: z.string().min(1).optional()
});
export type MediaAvailability = z.infer<typeof MediaAvailabilitySchema>;

export const CandidateReadModelSchema = z.object({
  candidateId: z.string().uuid(),
  sceneId: z.string().uuid(),
  specRevision: z.number().int().positive(),
  variantOrdinal: z.number().int().positive(),
  contentHash: z.string().min(1),
  media: MediaAvailabilitySchema,
  generationMetadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime()
});
export type CandidateReadModel = z.infer<typeof CandidateReadModelSchema>;

export const SceneApprovalSchema = z.object({
  revision: z.number().int().positive(),
  approvedBy: z.string().min(1),
  approvedAt: z.string().datetime()
});
export type SceneApproval = z.infer<typeof SceneApprovalSchema>;

export const SceneReviewCandidateGroupSchema = z.object({
  specRevision: z.number().int().positive(),
  candidates: z.array(CandidateReadModelSchema)
});
export type SceneReviewCandidateGroup = z.infer<typeof SceneReviewCandidateGroupSchema>;

export const ShotPlanReviewItemSchema = z.object({
  shotPlanId: z.string().uuid(),
  sceneId: z.string().uuid(),
  specRevision: z.number().int().positive(),
  variantOrdinal: z.number().int().positive(),
  status: ShotPlanStatusSchema,
  routingMode: ShotPlanRoutingModeSchema,
  isCurrentRevision: z.boolean(),
  targetDurationMs: z.number().int().positive(),
  targetFrameCount: z.number().int().positive(),
  framing: ShotFramingSchema,
  angle: CameraAngleSchema,
  cameraMovement: CameraMovementSchema,
  movementSpeed: MovementSpeedSchema,
  lensIntent: z.string(),
  cameraPosition: z.string(),
  cameraPromptDescription: z.string(),
  actionSummary: z.string(),
  lightingStyle: LightingStyleSchema,
  environmentDescription: z.string(),
  colorPalette: z.array(z.string()).default([]),
  atmosphere: z.string().nullable().optional(),
  subjects: z.array(ShotPlanSubjectBlockingSchema).default([]),
  beats: z.array(ShotPlanTemporalBeatSchema).default([]),
  dialogue: ShotPlanDialogueIntentSchema.nullable().optional(),
  continuity: ShotPlanContinuityConstraintsSchema,
  previs: z
    .object({
      candidateId: z.string().uuid().nullable().optional(),
      media: MediaAvailabilitySchema,
      reviewNotes: z.string().nullable().optional()
    })
    .nullable()
    .optional(),
  boundReferences: z
    .array(
      z.object({
        referenceAssetId: z.string().uuid(),
        role: z.string(),
        displayName: z.string().optional()
      })
    )
    .default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type ShotPlanReviewItem = z.infer<typeof ShotPlanReviewItemSchema>;

export const SceneReviewDetailReadModelSchema = z.object({
  sceneId: z.string().uuid(),
  campaignId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive(),
  configuration: SceneConfigurationSchema,
  selectedCandidateId: z.string().uuid().optional(),
  selectedCandidateRevision: z.number().int().positive().optional(),
  selectedShotPlanId: z.string().uuid().optional(),
  selectedShotPlanRevision: z.number().int().positive().optional(),
  approvedShotPlanId: z.string().uuid().optional(),
  approval: SceneApprovalSchema.optional(),
  candidatesByRevision: z.array(SceneReviewCandidateGroupSchema),
  shotPlans: z.array(ShotPlanReviewItemSchema).optional(),
  allowedActions: z.array(ReviewActionSchema)
});
export type SceneReviewDetailReadModel = z.infer<typeof SceneReviewDetailReadModelSchema>;

export const CampaignReviewSceneSummarySchema = z.object({
  sceneId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive()
});
export type CampaignReviewSceneSummary = z.infer<typeof CampaignReviewSceneSummarySchema>;

export const CampaignReviewSummarySchema = z.object({
  campaignId: z.string().uuid(),
  campaignName: z.string().min(1),
  status: CampaignStatusSchema.default("drafting"),
  totalScenes: z.number().int().nonnegative(),
  scenesByStatus: z.record(z.string(), z.number().int().nonnegative()),
  pendingReviewCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  scenes: z.array(CampaignReviewSceneSummarySchema),
  updatedAt: z.string().datetime()
});
export type CampaignReviewSummary = z.infer<typeof CampaignReviewSummarySchema>;

export const StoryboardCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  sceneId: z.string().uuid(),
  sceneSpecRevision: z.number().int().positive(),
  variantOrdinal: z.number().int().positive(),
  storageBucket: z.string().min(1),
  storageObjectKey: z.string().min(1),
  contentHashSha256: z.string().length(64),
  generationMetadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime()
});
export type StoryboardCandidate = z.infer<typeof StoryboardCandidateSchema>;

export const REVIEW_ERROR_CODES = [
  "NOT_FOUND",
  "STALE_REVISION_CONFLICT",
  "STALE_PRODUCTION_ATTEMPT_CONFLICT",
  "SCENE_NOT_IN_PRODUCTION_RUN",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_DOMAIN_TRANSITION",
  "VALIDATION_FAILURE",
  "MEDIA_UNAVAILABLE",
  "AUTHENTICATION_REQUIRED",
  "UNSUPPORTED_PRODUCTION_DURATION"
] as const;

export const ReviewErrorCodeSchema = z.enum(REVIEW_ERROR_CODES);
export type ReviewErrorCode = z.infer<typeof ReviewErrorCodeSchema>;

export const ReviewErrorResponseSchema = z.object({
  code: ReviewErrorCodeSchema,
  message: z.string().min(1),
  details: z.unknown().optional()
});
export type ReviewErrorResponse = z.infer<typeof ReviewErrorResponseSchema>;

export const CandidateSelectPayloadSchema = z.object({
  candidateId: z.string().uuid()
});
export type CandidateSelectPayload = z.infer<typeof CandidateSelectPayloadSchema>;

export const PromptEditPayloadSchema = z.object({
  prompt: z.string().min(1)
});
export type PromptEditPayload = z.infer<typeof PromptEditPayloadSchema>;

export const ReferenceChangePayloadSchema = z.object({
  referenceIds: z.array(z.string())
});
export type ReferenceChangePayload = z.infer<typeof ReferenceChangePayloadSchema>;

export const EngineChangePayloadSchema = z.object({
  engineProfileId: z.string().min(1)
});
export type EngineChangePayload = z.infer<typeof EngineChangePayloadSchema>;

export const DurationChangePayloadSchema = z.object({
  durationMs: z.number().int().positive()
});
export type DurationChangePayload = z.infer<typeof DurationChangePayloadSchema>;

export const LoraTunePayloadSchema = z.object({
  loraConfigurationId: z.string().nullable().optional()
});
export type LoraTunePayload = z.infer<typeof LoraTunePayloadSchema>;

export const EmptyActionPayloadSchema = z
  .record(z.string(), z.never())
  .or(z.object({}))
  .default({});

const BaseCommandEnvelope = z.object({
  actionId: z.string().uuid(),
  sceneId: z.string().uuid(),
  expectedSpecRevision: z.number().int().positive(),
  directorNotes: z.string().optional()
});

export const CandidateSelectCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("candidate_select"),
  payload: CandidateSelectPayloadSchema
});

export const ApproveCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("approve"),
  payload: EmptyActionPayloadSchema
});

export const RerollCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("reroll"),
  payload: EmptyActionPayloadSchema
});

export const PromptEditCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("prompt_edit"),
  payload: PromptEditPayloadSchema
});

export const ReferenceChangeCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("reference_change"),
  payload: ReferenceChangePayloadSchema
});

export const EngineChangeCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("engine_change"),
  payload: EngineChangePayloadSchema
});

export const DurationChangeCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("duration_change"),
  payload: DurationChangePayloadSchema
});

export const LoraTuneCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("lora_tune"),
  payload: LoraTunePayloadSchema
});

export const CancelCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("cancel"),
  payload: EmptyActionPayloadSchema
});

export const RejectCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("reject"),
  payload: EmptyActionPayloadSchema
});

export const ProductionAttemptFencePayloadSchema = z.object({
  expectedProductionJobId: z.string().uuid()
});
export type ProductionAttemptFencePayload = z.infer<typeof ProductionAttemptFencePayloadSchema>;

export const ProductionAcceptCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("production_accept"),
  payload: ProductionAttemptFencePayloadSchema
});
export type ProductionAcceptCommand = z.infer<typeof ProductionAcceptCommandSchema>;

export const ProductionRerenderCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("production_rerender"),
  payload: ProductionAttemptFencePayloadSchema
});
export type ProductionRerenderCommand = z.infer<typeof ProductionRerenderCommandSchema>;

export const SelectShotPlanPayloadSchema = z.object({
  shotPlanId: z.string().uuid()
});
export type SelectShotPlanPayload = z.infer<typeof SelectShotPlanPayloadSchema>;

export const ApproveShotPlanPayloadSchema = z
  .object({
    shotPlanId: z.string().uuid().optional()
  })
  .default({});
export type ApproveShotPlanPayload = z.infer<typeof ApproveShotPlanPayloadSchema>;

export const RerollShotPlanPayloadSchema = EmptyActionPayloadSchema;
export type RerollShotPlanPayload = z.infer<typeof RerollShotPlanPayloadSchema>;

export const SelectShotPlanCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("select_shotplan"),
  payload: SelectShotPlanPayloadSchema
});
export type SelectShotPlanCommand = z.infer<typeof SelectShotPlanCommandSchema>;

export const ApproveShotPlanCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("approve_shotplan"),
  payload: ApproveShotPlanPayloadSchema
});
export type ApproveShotPlanCommand = z.infer<typeof ApproveShotPlanCommandSchema>;

export const RerollShotPlanCommandSchema = BaseCommandEnvelope.extend({
  action: z.literal("reroll_shotplan"),
  payload: RerollShotPlanPayloadSchema
});
export type RerollShotPlanCommand = z.infer<typeof RerollShotPlanCommandSchema>;

export const ReviewCommandSchema = z.discriminatedUnion("action", [
  CandidateSelectCommandSchema,
  ApproveCommandSchema,
  RerollCommandSchema,
  PromptEditCommandSchema,
  ReferenceChangeCommandSchema,
  EngineChangeCommandSchema,
  DurationChangeCommandSchema,
  LoraTuneCommandSchema,
  CancelCommandSchema,
  RejectCommandSchema,
  ProductionAcceptCommandSchema,
  ProductionRerenderCommandSchema,
  SelectShotPlanCommandSchema,
  ApproveShotPlanCommandSchema,
  RerollShotPlanCommandSchema
]);
export type ReviewCommand = z.infer<typeof ReviewCommandSchema>;

export const ReviewCommandResponseSchema = z.object({
  sceneId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive(),
  selectedCandidateId: z.string().uuid().optional(),
  selectedShotPlanId: z.string().uuid().optional(),
  approvedShotPlanId: z.string().uuid().optional(),
  approval: SceneApprovalSchema.optional(),
  isIdempotentReplay: z.boolean(),
  activeProductionJobId: z.string().uuid().optional(),
  productionAttemptOrdinal: z.number().int().nonnegative().optional(),
  acceptedProductionAttemptId: z.string().uuid().optional(),
  acceptedAttemptOrdinal: z.number().int().nonnegative().optional()
});
export type ReviewCommandResponse = z.infer<typeof ReviewCommandResponseSchema>;

export const GenerationAdmissionResponseSchema = z.object({
  sceneId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive(),
  enqueuedJobIds: z.array(z.string().min(1))
});
export type GenerationAdmissionResponse = z.infer<typeof GenerationAdmissionResponseSchema>;

export function canonicalizeReviewCommand(command: {
  sceneId: string;
  expectedSpecRevision: number;
  action: string;
  payload: unknown;
  directorNotes?: string;
}): string {
  const normalized = {
    sceneId: command.sceneId,
    expectedSpecRevision: command.expectedSpecRevision,
    action: command.action,
    payload: command.payload ?? {},
    ...(command.directorNotes !== undefined ? { directorNotes: command.directorNotes } : {})
  };
  return JSON.stringify(sortKeysDeep(normalized));
}

export async function hashReviewCommand(command: {
  sceneId: string;
  expectedSpecRevision: number;
  action: string;
  payload: unknown;
  directorNotes?: string;
}): Promise<string> {
  const canonical = canonicalizeReviewCommand(command);
  const data = new TextEncoder().encode(canonical);
  const buffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
