import { z } from "zod";
import {
  CANONICAL_CLAIM_KINDS,
  CLAIM_BLOCK_REASON_CODES,
  CLAIM_DATE_KINDS,
  CLAIM_DECISION_KINDS,
  CLAIM_DURATION_UNITS,
  CLAIM_INVALIDATION_CAUSES,
  CLAIM_PROOF_CATEGORIES,
  CLAIM_PROVENANCE_CATEGORIES,
  CLAIM_STATES,
  CLAIM_SUPPORT_ROLES,
  CLAIM_TIMING_KINDS,
  isValidDateOnly,
  isValidIsoUtcTimestamp,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT,
  REPORTED_CAPTURE_PRECISIONS,
  SHA256_HEX_REGEX
} from "@cco/shared";
import { DecimalStringSchema } from "./coa-report.js";

// ============================================================================
// Enums & Vocabulary Schemas
// ============================================================================

export const ClaimStateSchema = z.enum(CLAIM_STATES);
export type ClaimStateContract = z.infer<typeof ClaimStateSchema>;

export const ClaimDecisionKindSchema = z.enum(CLAIM_DECISION_KINDS);
export type ClaimDecisionKindContract = z.infer<typeof ClaimDecisionKindSchema>;

export const ClaimInvalidationCauseSchema = z.enum(CLAIM_INVALIDATION_CAUSES);
export type ClaimInvalidationCauseContract = z.infer<typeof ClaimInvalidationCauseSchema>;

export const ClaimProofCategorySchema = z.enum(CLAIM_PROOF_CATEGORIES);
export type ClaimProofCategoryContract = z.infer<typeof ClaimProofCategorySchema>;

export const ClaimSupportRoleSchema = z.enum(CLAIM_SUPPORT_ROLES);
export type ClaimSupportRoleContract = z.infer<typeof ClaimSupportRoleSchema>;

export const ClaimProvenanceCategorySchema = z.enum(CLAIM_PROVENANCE_CATEGORIES);
export type ClaimProvenanceCategoryContract = z.infer<typeof ClaimProvenanceCategorySchema>;

export const CanonicalClaimKindSchema = z.enum(CANONICAL_CLAIM_KINDS);
export type CanonicalClaimKindContract = z.infer<typeof CanonicalClaimKindSchema>;

export const ClaimDateKindSchema = z.enum(CLAIM_DATE_KINDS);
export type ClaimDateKindContract = z.infer<typeof ClaimDateKindSchema>;

export const ClaimTimingKindSchema = z.enum(CLAIM_TIMING_KINDS);
export type ClaimTimingKindContract = z.infer<typeof ClaimTimingKindSchema>;

export const ClaimDurationUnitSchema = z.enum(CLAIM_DURATION_UNITS);
export type ClaimDurationUnitContract = z.infer<typeof ClaimDurationUnitSchema>;

export const ClaimBlockReasonCodeSchema = z.enum(CLAIM_BLOCK_REASON_CODES);
export type ClaimBlockReasonCodeContract = z.infer<typeof ClaimBlockReasonCodeSchema>;

export const Sha256HexSchema = z
  .string()
  .regex(SHA256_HEX_REGEX, "Must be a 64-character lowercase hexadecimal SHA-256 string");

// ============================================================================
// Structured Parameters Schemas
// ============================================================================

export const FactualLotIdentifierParametersSchema = z
  .object({
    kind: z.literal("factual_lot_identifier"),
    lotIdentifier: z.string().min(1).max(128)
  })
  .strict();

export const PackagedOrHarvestDateParametersSchema = z
  .object({
    kind: z.literal("packaged_or_harvest_date"),
    dateKind: ClaimDateKindSchema,
    dateValue: z.string().refine(isValidDateOnly, "Must be a valid YYYY-MM-DD date"),
    reportedPrecision: z.enum(REPORTED_CAPTURE_PRECISIONS)
  })
  .strict();

export const CertificatePanelMeasurementItemSchema = z
  .object({
    analyte: z.string().min(1).max(128),
    exactDecimalValue: DecimalStringSchema,
    unit: z.string().min(1).max(64),
    quantityKind: z.string().min(1).max(64),
    basis: z.string().min(1).max(64),
    context: z.string().min(1).max(64),
    requiredScope: z.enum(["sample_only", "attributed_lot"])
  })
  .strict();

export const CertificatePanelMeasurementParametersSchema = z
  .object({
    kind: z.literal("certificate_panel_measurement"),
    panelName: z.string().min(1).max(128).optional(),
    measurements: z.array(CertificatePanelMeasurementItemSchema).min(1).readonly()
  })
  .strict();

export const CultivationProcessingLineageParametersSchema = z
  .object({
    kind: z.literal("cultivation_processing_lineage"),
    operationCode: z.string().min(1).max(128),
    originKind: z.enum(["own_production", "partner_origin"]),
    attributedParty: z.string().min(1).max(255).optional(),
    claimedFacts: z.array(z.string().min(1).max(512)).min(1).readonly()
  })
  .strict();

export const LoggedProcessTimingParametersSchema = z
  .object({
    kind: z.literal("logged_process_timing"),
    operationName: z.string().min(1).max(128),
    timingKind: ClaimTimingKindSchema,
    duration: z
      .object({
        value: DecimalStringSchema,
        unit: ClaimDurationUnitSchema
      })
      .strict()
      .optional(),
    timestampRange: z
      .object({
        start: z.string().refine(isValidIsoUtcTimestamp),
        end: z.string().refine(isValidIsoUtcTimestamp)
      })
      .strict()
      .optional()
  })
  .strict();

export const UnsupportedManualParametersSchema = z
  .object({
    kind: z.literal("unsupported_manual"),
    proposedText: z.string().min(1).max(1024),
    categoryOrReason: z.string().min(1).max(256)
  })
  .strict();

export const ClaimParametersSchema = z.discriminatedUnion("kind", [
  FactualLotIdentifierParametersSchema,
  PackagedOrHarvestDateParametersSchema,
  CertificatePanelMeasurementParametersSchema,
  CultivationProcessingLineageParametersSchema,
  LoggedProcessTimingParametersSchema,
  UnsupportedManualParametersSchema
]);
export type ClaimParametersContract = z.infer<typeof ClaimParametersSchema>;

// ============================================================================
// Entity Contract Schemas
// ============================================================================

export const ProductClaimContractSchema = z
  .object({
    claimId: z.string().uuid(),
    clientId: z.string().uuid(),
    skuId: z.string().uuid(),
    batchId: z.string().uuid(),
    currentRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    state: ClaimStateSchema,
    version: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    invalidationCause: ClaimInvalidationCauseSchema.nullable(),
    invalidationSourceRef: z.string().nullable(),
    createdAt: z.string().refine(isValidIsoUtcTimestamp),
    updatedAt: z.string().refine(isValidIsoUtcTimestamp),
    archivedAt: z.string().refine(isValidIsoUtcTimestamp).nullable()
  })
  .strict();
export type ProductClaimContract = z.infer<typeof ProductClaimContractSchema>;

export const ProductClaimRevisionContractSchema = z
  .object({
    clientId: z.string().uuid(),
    claimId: z.string().uuid(),
    revision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    batchId: z.string().uuid(),
    canonicalKind: CanonicalClaimKindSchema,
    proofCategory: ClaimProofCategorySchema,
    parameters: ClaimParametersSchema,
    displayWording: z.string().nullable(),
    policyVersion: z.string().min(1).max(64),
    assertedBy: z.string().min(1).max(128),
    assertedAt: z.string().refine(isValidIsoUtcTimestamp),
    supersedesRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).nullable()
  })
  .strict();
export type ProductClaimRevisionContract = z.infer<typeof ProductClaimRevisionContractSchema>;

export const ClaimSourceFactAttestationContractSchema = z
  .object({
    factKind: z.string().min(1).max(64),
    factValue: z.string().min(1).max(512),
    fieldLocator: z.string().min(1).max(256),
    attribution: z.string().min(1).max(256),
    actorId: z.string().min(1).max(128),
    occurredAt: z.string().refine(isValidIsoUtcTimestamp),
    verificationEventId: z.string().uuid().nullable().optional()
  })
  .strict();
export type ClaimSourceFactAttestationContract = z.infer<
  typeof ClaimSourceFactAttestationContractSchema
>;

export const ResolvedMeasurementDetailsSchema = z
  .object({
    measurementId: z.string().uuid(),
    analyte: z.string(),
    resultKind: z.string(),
    resultValue: z.string().nullable().optional(),
    unit: z.string(),
    quantityKind: z.string(),
    basis: z.string(),
    context: z.string()
  })
  .strict();
export type ResolvedMeasurementDetails = z.infer<typeof ResolvedMeasurementDetailsSchema>;

export const ResolvedReportDetailsSchema = z
  .object({
    reportId: z.string().uuid(),
    revision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    completenessStatus: z.string(),
    scopeKind: z.string().nullable().optional(),
    verifiedLabIdentityEventId: z.string().uuid().nullable().optional(),
    labVerificationOutcome: z.string().nullable().optional()
  })
  .strict();
export type ResolvedReportDetails = z.infer<typeof ResolvedReportDetailsSchema>;

export const ResolvedVerificationDetailsSchema = z
  .object({
    eventId: z.string().uuid(),
    outcome: z.string(),
    verificationKind: z.string().optional(),
    factScope: z.string().optional(),
    isWithdrawn: z.boolean().optional()
  })
  .strict();
export type ResolvedVerificationDetails = z.infer<typeof ResolvedVerificationDetailsSchema>;

export const ClaimEvidenceLinkContractSchema = z
  .object({
    linkId: z.string().uuid(),
    clientId: z.string().uuid(),
    claimId: z.string().uuid(),
    claimRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    sourceObjectId: z.string().uuid(),
    sourceSha256: Sha256HexSchema,
    supportRole: ClaimSupportRoleSchema,
    sourceClass: z.string().min(1).max(32).optional(),
    reportId: z.string().uuid().nullable().optional(),
    reportRevision: z
      .number()
      .int()
      .min(MIN_POSITIVE_INT)
      .max(MAX_POSITIVE_INT)
      .nullable()
      .optional(),
    measurementId: z.string().uuid().nullable().optional(),
    pinnedFactsRevision: z
      .number()
      .int()
      .min(MIN_POSITIVE_INT)
      .max(MAX_POSITIVE_INT)
      .nullable()
      .optional(),
    attestation: ClaimSourceFactAttestationContractSchema.nullable().optional(),
    derivativeAssetId: z.string().nullable().optional(),
    measurementDetails: ResolvedMeasurementDetailsSchema.nullable().optional(),
    reportDetails: ResolvedReportDetailsSchema.nullable().optional(),
    verificationDetails: ResolvedVerificationDetailsSchema.nullable().optional()
  })
  .strict();
export type ClaimEvidenceLinkContract = z.infer<typeof ClaimEvidenceLinkContractSchema>;

export const ClaimDecisionEventContractSchema = z
  .object({
    eventId: z.string().uuid(),
    clientId: z.string().uuid(),
    claimId: z.string().uuid(),
    claimRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    decision: ClaimDecisionKindSchema,
    actorId: z.string().min(1).max(128),
    occurredAt: z.string().refine(isValidIsoUtcTimestamp),
    reason: z.string().min(1).max(1024),
    policyVersion: z.string().min(1).max(64),
    dependencyFingerprint: z.string().max(128).nullable().optional(),
    invalidationCause: ClaimInvalidationCauseSchema.nullable().optional(),
    sourceEventId: z.string().max(256).nullable().optional()
  })
  .strict();
export type ClaimDecisionEventContract = z.infer<typeof ClaimDecisionEventContractSchema>;

export const ClaimBlockReasonContractSchema = z
  .object({
    code: ClaimBlockReasonCodeSchema,
    dependencyId: z.string().optional(),
    message: z.string().min(1).max(512)
  })
  .strict();
export type ClaimBlockReasonContract = z.infer<typeof ClaimBlockReasonContractSchema>;

// ============================================================================
// Command Payload Schemas
// ============================================================================

export const CreateClaimRequestSchema = z
  .object({
    batchId: z.string().uuid(),
    canonicalKind: CanonicalClaimKindSchema,
    proofCategory: ClaimProofCategorySchema,
    parameters: ClaimParametersSchema,
    displayWording: z.string().max(1024).nullable().optional()
  })
  .strict();
export type CreateClaimRequest = z.infer<typeof CreateClaimRequestSchema>;

export const AppendClaimRevisionRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    canonicalKind: CanonicalClaimKindSchema,
    proofCategory: ClaimProofCategorySchema,
    parameters: ClaimParametersSchema,
    displayWording: z.string().max(1024).nullable().optional()
  })
  .strict();
export type AppendClaimRevisionRequest = z.infer<typeof AppendClaimRevisionRequestSchema>;

export const LinkClaimEvidenceItemSchema = z
  .object({
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    sourceObjectId: z.string().uuid(),
    sourceSha256: Sha256HexSchema,
    supportRole: ClaimSupportRoleSchema,
    reportId: z.string().uuid().optional(),
    reportRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).optional(),
    measurementId: z.string().uuid().optional(),
    pinnedFactsRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).optional(),
    attestation: ClaimSourceFactAttestationContractSchema.optional(),
    derivativeAssetId: z.string().optional()
  })
  .strict();
export type LinkClaimEvidenceItem = z.infer<typeof LinkClaimEvidenceItemSchema>;

export const LinkClaimEvidenceRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    claimRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    reason: z.string().min(1).max(1024),
    links: z.array(LinkClaimEvidenceItemSchema).min(1)
  })
  .strict();
export type LinkClaimEvidenceRequest = z.infer<typeof LinkClaimEvidenceRequestSchema>;

export const ReviewClaimRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    claimRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().min(1).max(1024)
  })
  .strict();
export type ReviewClaimRequest = z.infer<typeof ReviewClaimRequestSchema>;

// ============================================================================
// Read Resolution Contract Schemas
// ============================================================================

export const ResolveClaimResponseSchema = z
  .object({
    claim: ProductClaimContractSchema,
    revision: ProductClaimRevisionContractSchema,
    supportEligible: z.boolean(),
    canRequestReview: z.boolean(),
    evidenceLinkApproved: z.boolean(),
    provenanceCategory: ClaimProvenanceCategorySchema,
    displayWordingStatus: z.enum(["none", "manual_review_required", "manual_review_approved"]),
    blockReasons: z.array(ClaimBlockReasonContractSchema),
    links: z.array(ClaimEvidenceLinkContractSchema),
    reviewEvents: z.array(ClaimDecisionEventContractSchema),
    dependencyFingerprint: z.string()
  })
  .strict();
export type ResolveClaimResponse = z.infer<typeof ResolveClaimResponseSchema>;
