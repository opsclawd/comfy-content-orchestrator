import { z } from "zod";
import {
  PRODUCT_EVIDENCE_ERROR_CODES,
  isValidIsoUtcTimestamp,
  isValidUuidV7,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT
} from "@cco/shared";
import {
  EvidenceAssetSchema,
  EvidenceDerivativeSchema,
  EvidenceRevisionSchema,
  EvidenceVerificationEventSchema,
  BatchEvidenceLinkSchema,
  SourceObjectAvailabilitySchema,
  RegisterEvidenceAssetBaseSchema
} from "./evidence-asset.js";
import {
  CoaReportContractSchema,
  CoaReportRevisionContractSchema,
  CoaReviewEventContractSchema,
  CreateCoaReportRequestSchema,
  SupersedeCoaReportRequestSchema,
  ReviewCoaReportRequestSchema,
  ArchiveCoaReportRequestSchema
} from "./coa-report.js";
import {
  ClaimDecisionEventContractSchema,
  ClaimEvidenceLinkContractSchema,
  ClaimInvalidationCauseSchema,
  ProductClaimContractSchema,
  ProductClaimRevisionContractSchema,
  CreateClaimRequestSchema,
  AppendClaimRevisionRequestSchema,
  LinkClaimEvidenceRequestSchema,
  ReviewClaimRequestSchema
} from "./product-claim.js";
import { ProductValidationErrorResponseSchema } from "./product-evidence-error.js";

// ============================================================================
// Shared UUIDv7 Schema
// ============================================================================

export const UuidV7Schema = z.string().refine(isValidUuidV7, {
  message: "Must be a valid UUIDv7 string"
});

// ============================================================================
// Safe Source Object & Evidence Projections (Strict, No Internal Storage Keys)
// ============================================================================

export const SafeSourceObjectResponseSchema = z
  .object({
    sourceObjectId: z.string().uuid(),
    originalSha256: z.string().regex(/^[0-9a-f]{64}$/),
    detectedMimeType: z.string().min(1),
    byteLength: z.number().int().positive(),
    uploadedAt: z.string().refine(isValidIsoUtcTimestamp, {
      message: "uploadedAt must be a valid UTC ISO 8601 timestamp"
    }),
    uploaderId: z.string().min(1),
    accessClass: z.literal("restricted_original"),
    retentionClass: z.literal("source_evidence_archive"),
    retentionPolicyVersion: z.string().min(1),
    availability: SourceObjectAvailabilitySchema
  })
  .strict();
export type SafeSourceObjectResponse = z.infer<typeof SafeSourceObjectResponseSchema>;

export const EvidenceAssetResponseSchema = z
  .object({
    evidenceAsset: EvidenceAssetSchema,
    evidenceRevision: EvidenceRevisionSchema,
    sourceObject: SafeSourceObjectResponseSchema,
    batchEvidenceLink: BatchEvidenceLinkSchema,
    derivative: EvidenceDerivativeSchema.nullable()
  })
  .strict();
export type EvidenceAssetResponse = z.infer<typeof EvidenceAssetResponseSchema>;

export const EvidenceAssetSummaryResponseSchema = z
  .object({
    evidenceId: z.string().uuid(),
    currentRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    version: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    createdAt: z.string().refine(isValidIsoUtcTimestamp),
    archivedAt: z.string().refine(isValidIsoUtcTimestamp).nullable(),
    linkedRevisions: z.array(z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT))
  })
  .strict();
export type EvidenceAssetSummaryResponse = z.infer<typeof EvidenceAssetSummaryResponseSchema>;

export const EvidenceAssetListResponseSchema = z
  .object({
    evidence: z.array(EvidenceAssetSummaryResponseSchema)
  })
  .strict();
export type EvidenceAssetListResponse = z.infer<typeof EvidenceAssetListResponseSchema>;

export const EvidenceAssetRevisionListResponseSchema = z
  .object({
    revisions: z.array(EvidenceRevisionSchema)
  })
  .strict();
export type EvidenceAssetRevisionListResponse = z.infer<
  typeof EvidenceAssetRevisionListResponseSchema
>;

export const EvidenceVerificationEventListResponseSchema = z
  .object({
    events: z.array(EvidenceVerificationEventSchema)
  })
  .strict();
export type EvidenceVerificationEventListResponse = z.infer<
  typeof EvidenceVerificationEventListResponseSchema
>;

export const RegisterEvidenceAssetMultipartMetadataSchema = RegisterEvidenceAssetBaseSchema.omit({
  reusedSourceObjectId: true
})
  .extend({
    actionId: UuidV7Schema
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.declaredMimeType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["declaredMimeType"],
        message: "declaredMimeType is required when uploading source evidence"
      });
    }

    if (val.reportedCaptureDate && val.reportedCaptureTimestamp) {
      const tsDate = val.reportedCaptureTimestamp.slice(0, 10);
      if (tsDate !== val.reportedCaptureDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportedCaptureDate"],
          message:
            "reportedCaptureDate does not match the UTC date part of reportedCaptureTimestamp"
        });
      }
    }

    if (val.registrationIntent === "supersede") {
      if (!val.targetEvidenceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetEvidenceId"],
          message: "targetEvidenceId is required when registrationIntent is 'supersede'"
        });
      }
      if (val.expectedEvidenceVersion === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["expectedEvidenceVersion"],
          message: "expectedEvidenceVersion is required when registrationIntent is 'supersede'"
        });
      }
    }
  });
export type RegisterEvidenceAssetMultipartMetadata = z.infer<
  typeof RegisterEvidenceAssetMultipartMetadataSchema
>;

// ============================================================================
// Media Delivery Response Schema (Short-Lived Signed URL)
// ============================================================================

export const EvidenceMediaDeliveryResponseSchema = z
  .object({
    clientId: z.string().uuid(),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    sourceObjectId: z.string().uuid(),
    originalSha256: z.string().regex(/^[0-9a-f]{64}$/),
    detectedMimeType: z.string().min(1),
    byteLength: z.number().int().positive(),
    url: z.string().url(),
    expiresAt: z.string().refine(isValidIsoUtcTimestamp, {
      message: "expiresAt must be a valid UTC ISO 8601 timestamp"
    })
  })
  .strict();
export type EvidenceMediaDeliveryResponse = z.infer<typeof EvidenceMediaDeliveryResponseSchema>;

// ============================================================================
// CoA Report HTTP Schemas
// ============================================================================

export const CreateCoaReportHttpRequestSchema = CreateCoaReportRequestSchema.omit({
  reportId: true
})
  .extend({
    actionId: UuidV7Schema
  })
  .strict();
export type CreateCoaReportHttpRequest = z.infer<typeof CreateCoaReportHttpRequestSchema>;

export const SupersedeCoaReportHttpRequestSchema = SupersedeCoaReportRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type SupersedeCoaReportHttpRequest = z.infer<typeof SupersedeCoaReportHttpRequestSchema>;

export const ReviewCoaReportHttpRequestSchema = ReviewCoaReportRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type ReviewCoaReportHttpRequest = z.infer<typeof ReviewCoaReportHttpRequestSchema>;

export const ArchiveCoaReportHttpRequestSchema = ArchiveCoaReportRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type ArchiveCoaReportHttpRequest = z.infer<typeof ArchiveCoaReportHttpRequestSchema>;

export const CoaReportResponseSchema = z
  .object({
    report: CoaReportContractSchema,
    currentRevision: CoaReportRevisionContractSchema
  })
  .strict();
export type CoaReportResponse = z.infer<typeof CoaReportResponseSchema>;

export const CoaReportListResponseSchema = z
  .object({
    reports: z.array(CoaReportContractSchema)
  })
  .strict();
export type CoaReportListResponse = z.infer<typeof CoaReportListResponseSchema>;

export const CoaReportHistoryResponseSchema = z
  .object({
    revisions: z.array(CoaReportRevisionContractSchema)
  })
  .strict();
export type CoaReportHistoryResponse = z.infer<typeof CoaReportHistoryResponseSchema>;

export const CoaReportReviewResponseSchema = z
  .object({
    report: CoaReportContractSchema,
    decisionEvent: CoaReviewEventContractSchema
  })
  .strict();
export type CoaReportReviewResponse = z.infer<typeof CoaReportReviewResponseSchema>;

// ============================================================================
// Product Claim HTTP Schemas
// ============================================================================

export const CreateClaimHttpRequestSchema = CreateClaimRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type CreateClaimHttpRequest = z.infer<typeof CreateClaimHttpRequestSchema>;

export const AppendClaimRevisionHttpRequestSchema = AppendClaimRevisionRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type AppendClaimRevisionHttpRequest = z.infer<typeof AppendClaimRevisionHttpRequestSchema>;

export const LinkClaimEvidenceHttpRequestSchema = LinkClaimEvidenceRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type LinkClaimEvidenceHttpRequest = z.infer<typeof LinkClaimEvidenceHttpRequestSchema>;

export const ReviewClaimHttpRequestSchema = ReviewClaimRequestSchema.extend({
  actionId: UuidV7Schema
}).strict();
export type ReviewClaimHttpRequest = z.infer<typeof ReviewClaimHttpRequestSchema>;

export const InvalidateClaimRequestSchema = z
  .object({
    actionId: UuidV7Schema,
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    claimRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    invalidationCause: ClaimInvalidationCauseSchema,
    reason: z.string().min(1).max(1024)
  })
  .strict();
export type InvalidateClaimRequest = z.infer<typeof InvalidateClaimRequestSchema>;
export const InvalidateClaimHttpRequestSchema = InvalidateClaimRequestSchema;
export type InvalidateClaimHttpRequest = InvalidateClaimRequest;

export const InvalidateClaimResponseSchema = z
  .object({
    claim: ProductClaimContractSchema,
    decisionEvent: ClaimDecisionEventContractSchema
  })
  .strict();
export type InvalidateClaimResponse = z.infer<typeof InvalidateClaimResponseSchema>;

export const ProductClaimDetailResponseSchema = z
  .object({
    claim: ProductClaimContractSchema,
    currentRevision: ProductClaimRevisionContractSchema,
    links: z.array(ClaimEvidenceLinkContractSchema),
    events: z.array(ClaimDecisionEventContractSchema)
  })
  .strict();
export type ProductClaimDetailResponse = z.infer<typeof ProductClaimDetailResponseSchema>;

export const ProductClaimListResponseSchema = z
  .object({
    claims: z.array(ProductClaimContractSchema)
  })
  .strict();
export type ProductClaimListResponse = z.infer<typeof ProductClaimListResponseSchema>;

export const ProductClaimHistoryResponseSchema = z
  .object({
    revisions: z.array(ProductClaimRevisionContractSchema)
  })
  .strict();
export type ProductClaimHistoryResponse = z.infer<typeof ProductClaimHistoryResponseSchema>;

export const ProductClaimReviewResponseSchema = z
  .object({
    claim: ProductClaimContractSchema,
    decisionEvent: ClaimDecisionEventContractSchema
  })
  .strict();
export type ProductClaimReviewResponse = z.infer<typeof ProductClaimReviewResponseSchema>;

// ============================================================================
// Additive HTTP Error Schema
// ============================================================================

export const PRODUCT_EVIDENCE_HTTP_ERROR_CODES = [
  ...PRODUCT_EVIDENCE_ERROR_CODES,
  "SELF_APPROVAL_FORBIDDEN",
  "COA_REPORT_ARCHIVED",
  "EVIDENCE_ARCHIVED",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "INTERNAL_ERROR"
] as const;
export type ProductEvidenceHttpErrorCode = (typeof PRODUCT_EVIDENCE_HTTP_ERROR_CODES)[number];

export const ProductEvidenceHttpErrorCodeSchema = z.enum(PRODUCT_EVIDENCE_HTTP_ERROR_CODES);

export const ProductEvidenceHttpBusinessErrorResponseSchema = z
  .object({
    error: ProductEvidenceHttpErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional()
  })
  .strict();
export type ProductEvidenceHttpBusinessErrorResponse = z.infer<
  typeof ProductEvidenceHttpBusinessErrorResponseSchema
>;

export const ProductEvidenceHttpErrorResponseSchema = z.union([
  ProductValidationErrorResponseSchema,
  ProductEvidenceHttpBusinessErrorResponseSchema
]);
export type ProductEvidenceHttpErrorResponse = z.infer<
  typeof ProductEvidenceHttpErrorResponseSchema
>;
