import { z } from "zod";

export const PREVIS_TEXT_ADVISORY_STATUSES = ["flagged", "clean", "unavailable"] as const;
export const PrevisTextAdvisoryStatusSchema = z.enum(PREVIS_TEXT_ADVISORY_STATUSES);
export type PrevisTextAdvisoryStatus = z.infer<typeof PrevisTextAdvisoryStatusSchema>;

export const PREVIS_TEXT_ADVISORY_POLICY_VERSION = "previs_text_advisory_v1" as const;
export const PREVIS_TEXT_ADVISORY_MAX_DETECTIONS = 5;
export const PREVIS_TEXT_ADVISORY_MAX_TEXT_LENGTH = 64;

export const PrevisTextDetectionSchema = z.object({
  text: z.string().max(PREVIS_TEXT_ADVISORY_MAX_TEXT_LENGTH),
  confidence: z.number().min(0).max(1),
  bbox: z
    .object({
      x0: z.number(),
      y0: z.number(),
      x1: z.number(),
      y1: z.number()
    })
    .optional()
});
export type PrevisTextDetection = z.infer<typeof PrevisTextDetectionSchema>;

export const PrevisTextAdvisorySchema = z.object({
  status: PrevisTextAdvisoryStatusSchema,
  policyVersion: z.string().min(1),
  thresholds: z.object({
    minConfidence: z.number().min(0).max(1),
    minAlnumChars: z.number().int().min(1),
    minAlnumRatio: z.number().min(0).max(1)
  }),
  maxConfidence: z.number().min(0).max(1).nullable(),
  detections: z.array(PrevisTextDetectionSchema).max(PREVIS_TEXT_ADVISORY_MAX_DETECTIONS),
  engine: z.object({ id: z.string().min(1), version: z.string().min(1) }).nullable(),
  checkedAt: z.string().datetime(),
  reason: z.string().max(200).optional()
});
export type PrevisTextAdvisory = z.infer<typeof PrevisTextAdvisorySchema>;

export const RerollPrevisBeatRequestSchema = z
  .object({
    expectedCandidateId: z.string().uuid("expectedCandidateId must be a valid UUID")
  })
  .strict();
export type RerollPrevisBeatRequest = z.infer<typeof RerollPrevisBeatRequestSchema>;

export const RerollPrevisBeatResponseSchema = z.object({
  jobId: z.string().min(1),
  sceneId: z.string().uuid(),
  shotPlanId: z.string().uuid(),
  beatIndex: z.number().int().positive(),
  seed: z.number().int()
});
export type RerollPrevisBeatResponse = z.infer<typeof RerollPrevisBeatResponseSchema>;
