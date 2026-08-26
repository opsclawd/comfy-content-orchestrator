import { z } from "zod";

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
  "candidate_select"
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

export const SceneReviewDetailReadModelSchema = z.object({
  sceneId: z.string().uuid(),
  campaignId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive(),
  configuration: SceneConfigurationSchema,
  selectedCandidateId: z.string().uuid().optional(),
  selectedCandidateRevision: z.number().int().positive().optional(),
  approval: SceneApprovalSchema.optional(),
  candidatesByRevision: z.array(SceneReviewCandidateGroupSchema),
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
  "IDEMPOTENCY_CONFLICT",
  "INVALID_DOMAIN_TRANSITION",
  "VALIDATION_FAILURE",
  "MEDIA_UNAVAILABLE",
  "AUTHENTICATION_REQUIRED"
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
  RejectCommandSchema
]);
export type ReviewCommand = z.infer<typeof ReviewCommandSchema>;

export const ReviewCommandResponseSchema = z.object({
  sceneId: z.string().uuid(),
  status: SceneStatusSchema,
  specRevision: z.number().int().positive(),
  selectedCandidateId: z.string().uuid().optional(),
  approval: SceneApprovalSchema.optional(),
  isIdempotentReplay: z.boolean()
});
export type ReviewCommandResponse = z.infer<typeof ReviewCommandResponseSchema>;

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    const val = record[key];
    if (val !== undefined) {
      result[key] = sortKeysDeep(val);
    }
  }
  return result;
}

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
