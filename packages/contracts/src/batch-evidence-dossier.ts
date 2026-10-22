import { z } from "zod";
import { isValidIsoUtcTimestamp } from "@cco/shared";
import { ProductSkuResponseSchema } from "./product-sku.js";
import { BatchFactsRevisionResponseSchema, ProductBatchResponseSchema } from "./product-batch.js";
import {
  BatchEvidenceLinkSchema,
  EvidenceAssetSchema,
  EvidenceDerivativeSchema,
  EvidenceRevisionSchema,
  EvidenceVerificationEventSchema
} from "./evidence-asset.js";
import {
  CoaReportContractSchema,
  CoaReportRevisionContractSchema,
  CoaReviewEventContractSchema
} from "./coa-report.js";
import {
  ClaimDecisionEventContractSchema,
  ClaimEvidenceLinkContractSchema,
  ProductClaimContractSchema,
  ProductClaimRevisionContractSchema,
  ResolveClaimResponseSchema
} from "./product-claim.js";
import { SafeSourceObjectResponseSchema } from "./product-evidence-http.js";

// ============================================================================
// Dossier Nested Section Schemas (Strict, Deterministic, Lossless)
// ============================================================================

export const DossierEvidenceItemSchema = z
  .object({
    asset: EvidenceAssetSchema,
    currentRevision: EvidenceRevisionSchema.nullable(),
    revisions: z.array(EvidenceRevisionSchema),
    sourceObjects: z.array(SafeSourceObjectResponseSchema),
    derivatives: z.array(EvidenceDerivativeSchema),
    verificationEvents: z.array(EvidenceVerificationEventSchema)
  })
  .strict();
export type DossierEvidenceItem = z.infer<typeof DossierEvidenceItemSchema>;

export const DossierCoaReportItemSchema = z
  .object({
    report: CoaReportContractSchema,
    currentRevision: CoaReportRevisionContractSchema,
    revisions: z.array(CoaReportRevisionContractSchema),
    reviewEvents: z.array(CoaReviewEventContractSchema)
  })
  .strict();
export type DossierCoaReportItem = z.infer<typeof DossierCoaReportItemSchema>;

export const DossierClaimItemSchema = z
  .object({
    claim: ProductClaimContractSchema,
    currentRevision: ProductClaimRevisionContractSchema,
    revisions: z.array(ProductClaimRevisionContractSchema),
    links: z.array(ClaimEvidenceLinkContractSchema),
    decisionEvents: z.array(ClaimDecisionEventContractSchema),
    resolution: ResolveClaimResponseSchema
  })
  .strict();
export type DossierClaimItem = z.infer<typeof DossierClaimItemSchema>;

// ============================================================================
// Authoritative Batch Evidence Dossier Schema
// ============================================================================

export const BatchEvidenceDossierSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    clientId: z.string().uuid(),
    sku: ProductSkuResponseSchema,
    batch: ProductBatchResponseSchema,
    factsHistory: z.array(BatchFactsRevisionResponseSchema),
    evidenceLinks: z.array(BatchEvidenceLinkSchema),
    evidence: z.array(DossierEvidenceItemSchema),
    coaReports: z.array(DossierCoaReportItemSchema),
    claims: z.array(DossierClaimItemSchema),
    resolvedAt: z.string().refine(isValidIsoUtcTimestamp, {
      message: "resolvedAt must be a valid UTC ISO 8601 timestamp"
    })
  })
  .strict();
export type BatchEvidenceDossier = z.infer<typeof BatchEvidenceDossierSchema>;
