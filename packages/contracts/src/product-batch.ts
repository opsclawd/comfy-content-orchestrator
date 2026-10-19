import { z } from "zod";
import {
  BATCH_ORIGIN_KINDS,
  compareDateOnly,
  isValidDateOnly,
  isValidDisplayName,
  isValidIsoUtcTimestamp,
  isValidLotIdentifier,
  LOT_IDENTIFIER_REGEX,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT
} from "@cco/shared";

// ============================================================================
// Public Request Schemas (Strict, Reject Unknown Keys)
// ============================================================================

export const InitialBatchFactsInputSchema = z
  .object({
    originKind: z.enum(BATCH_ORIGIN_KINDS),
    producerIdentityAsClaimed: z
      .string()
      .refine(isValidDisplayName, {
        message: "producerIdentityAsClaimed must be 1–255 code points without controls"
      })
      .nullable()
      .optional(),
    productionStartDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "productionStartDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable()
      .optional(),
    productionEndDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "productionEndDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable()
      .optional(),
    originEvidenceId: z.string().uuid().nullable().optional(),
    originEvidenceRevision: z
      .number()
      .int()
      .min(MIN_POSITIVE_INT)
      .max(MAX_POSITIVE_INT)
      .nullable()
      .optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.productionStartDate && val.productionEndDate) {
      if (compareDateOnly(val.productionStartDate, val.productionEndDate) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productionStartDate"],
          message: "productionStartDate cannot be later than productionEndDate"
        });
      }
    }

    const idPresent = val.originEvidenceId !== null && val.originEvidenceId !== undefined;
    const revPresent =
      val.originEvidenceRevision !== null && val.originEvidenceRevision !== undefined;

    if ((idPresent && !revPresent) || (!idPresent && revPresent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["originEvidenceId"],
        message:
          "originEvidenceId and originEvidenceRevision must be both present or both null/omitted"
      });
    }
  });
export type InitialBatchFactsInputContract = z.infer<typeof InitialBatchFactsInputSchema>;

export const CreateBatchRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    skuId: z.string().uuid(),
    lotIdentifier: z.string().refine(isValidLotIdentifier, {
      message: "lotIdentifier must match ^[A-Za-z0-9_.-]{1,128}$ without controls"
    }),
    displayName: z.string().refine(isValidDisplayName, {
      message: "displayName must be 1–255 code points without controls"
    }),
    initialFacts: InitialBatchFactsInputSchema.optional()
  })
  .strict();
export type CreateBatchRequest = z.infer<typeof CreateBatchRequestSchema>;

export const AppendBatchFactsRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    originKind: z.enum(BATCH_ORIGIN_KINDS),
    producerIdentityAsClaimed: z
      .string()
      .refine(isValidDisplayName, {
        message: "producerIdentityAsClaimed must be 1–255 code points without controls"
      })
      .nullable()
      .optional(),
    productionStartDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "productionStartDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable()
      .optional(),
    productionEndDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "productionEndDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable()
      .optional(),
    originEvidenceId: z.string().uuid().nullable().optional(),
    originEvidenceRevision: z
      .number()
      .int()
      .min(MIN_POSITIVE_INT)
      .max(MAX_POSITIVE_INT)
      .nullable()
      .optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.productionStartDate && val.productionEndDate) {
      if (compareDateOnly(val.productionStartDate, val.productionEndDate) > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["productionStartDate"],
          message: "productionStartDate cannot be later than productionEndDate"
        });
      }
    }

    const idPresent = val.originEvidenceId !== null && val.originEvidenceId !== undefined;
    const revPresent =
      val.originEvidenceRevision !== null && val.originEvidenceRevision !== undefined;

    if ((idPresent && !revPresent) || (!idPresent && revPresent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["originEvidenceId"],
        message:
          "originEvidenceId and originEvidenceRevision must be both present or both null/omitted"
      });
    }
  });
export type AppendBatchFactsRequest = z.infer<typeof AppendBatchFactsRequestSchema>;

export const UpdateBatchMetadataRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    displayName: z.string().refine(isValidDisplayName, {
      message: "displayName must be 1–255 code points without controls"
    })
  })
  .strict();
export type UpdateBatchMetadataRequest = z.infer<typeof UpdateBatchMetadataRequestSchema>;

export const ArchiveBatchRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT)
  })
  .strict();
export type ArchiveBatchRequest = z.infer<typeof ArchiveBatchRequestSchema>;

// ============================================================================
// Safe Wire Response Schemas (Strict Allowlist, Explicit Nulls, No Storage Keys)
// ============================================================================

export const BatchFactsRevisionResponseSchema = z
  .object({
    clientId: z.string().uuid(),
    batchId: z.string().uuid(),
    revision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    originKind: z.enum(BATCH_ORIGIN_KINDS),
    producerIdentityAsClaimed: z.string().nullable(),
    productionStartDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "productionStartDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable(),
    productionEndDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "productionEndDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable(),
    originEvidenceId: z.string().uuid().nullable(),
    originEvidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).nullable(),
    assertedBy: z.string().min(1).max(128),
    assertedAt: z.string().refine(isValidIsoUtcTimestamp, {
      message: "assertedAt must be a valid UTC ISO 8601 timestamp"
    }),
    supersedesRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).nullable()
  })
  .strict();
export type BatchFactsRevisionResponse = z.infer<typeof BatchFactsRevisionResponseSchema>;

export const ProductBatchResponseSchema = z
  .object({
    clientId: z.string().uuid(),
    batchId: z.string().uuid(),
    skuId: z.string().uuid(),
    lotIdentifier: z.string().regex(LOT_IDENTIFIER_REGEX),
    displayName: z.string().min(1).max(255),
    version: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    currentFactsRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    createdAt: z.string().refine(isValidIsoUtcTimestamp, {
      message: "createdAt must be a valid UTC ISO 8601 timestamp"
    }),
    updatedAt: z.string().refine(isValidIsoUtcTimestamp, {
      message: "updatedAt must be a valid UTC ISO 8601 timestamp"
    }),
    archivedAt: z
      .string()
      .refine(isValidIsoUtcTimestamp, {
        message: "archivedAt must be a valid UTC ISO 8601 timestamp when present"
      })
      .nullable()
  })
  .strict();
export type ProductBatchResponse = z.infer<typeof ProductBatchResponseSchema>;

export const ProductBatchCreationResultResponseSchema = z
  .object({
    batch: ProductBatchResponseSchema,
    initialFacts: BatchFactsRevisionResponseSchema
  })
  .strict();
export type ProductBatchCreationResultResponse = z.infer<
  typeof ProductBatchCreationResultResponseSchema
>;

export const ProductBatchListResponseSchema = z
  .object({
    batches: z.array(ProductBatchResponseSchema)
  })
  .strict();
export type ProductBatchListResponse = z.infer<typeof ProductBatchListResponseSchema>;

export const ProductBatchHistoryResponseSchema = z
  .object({
    revisions: z.array(BatchFactsRevisionResponseSchema)
  })
  .strict();
export type ProductBatchHistoryResponse = z.infer<typeof ProductBatchHistoryResponseSchema>;
