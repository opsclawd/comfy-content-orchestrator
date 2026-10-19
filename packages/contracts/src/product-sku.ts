import { z } from "zod";
import {
  CANONICAL_SKU_REGEX,
  isValidCanonicalSku,
  isValidDisplayName,
  isValidIsoUtcTimestamp,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT
} from "@cco/shared";

// ============================================================================
// Public Request Schemas (Strict, Reject Unknown Keys)
// ============================================================================

export const CreateSkuRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    canonicalSku: z.string().refine(isValidCanonicalSku, {
      message: "canonicalSku must match ^[A-Z0-9_-]{3,64}$ without controls"
    }),
    displayName: z.string().refine(isValidDisplayName, {
      message: "displayName must be 1–255 code points without controls"
    })
  })
  .strict();
export type CreateSkuRequest = z.infer<typeof CreateSkuRequestSchema>;

export const UpdateSkuMetadataRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    displayName: z.string().refine(isValidDisplayName, {
      message: "displayName must be 1–255 code points without controls"
    })
  })
  .strict();
export type UpdateSkuMetadataRequest = z.infer<typeof UpdateSkuMetadataRequestSchema>;

export const ArchiveSkuRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT)
  })
  .strict();
export type ArchiveSkuRequest = z.infer<typeof ArchiveSkuRequestSchema>;

// ============================================================================
// Safe Wire Response Schemas (Strict Allowlist, Explicit Nulls, No Storage Keys)
// ============================================================================

export const ProductSkuResponseSchema = z
  .object({
    clientId: z.string().uuid(),
    skuId: z.string().uuid(),
    canonicalSku: z.string().regex(CANONICAL_SKU_REGEX),
    displayName: z.string().min(1).max(255),
    version: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
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
export type ProductSkuResponse = z.infer<typeof ProductSkuResponseSchema>;

export const ProductSkuListResponseSchema = z
  .object({
    skus: z.array(ProductSkuResponseSchema)
  })
  .strict();
export type ProductSkuListResponse = z.infer<typeof ProductSkuListResponseSchema>;
