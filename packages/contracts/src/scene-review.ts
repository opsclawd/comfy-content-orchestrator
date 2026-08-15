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
  "cancel"
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
  occurredAt: z.string().datetime()
});

export type ReviewEvent = z.infer<typeof ReviewEventSchema>;
