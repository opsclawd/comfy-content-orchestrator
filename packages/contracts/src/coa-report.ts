import { z } from "zod";
import {
  COA_ANALYTICAL_QUALIFIERS,
  COA_COMPLETENESS_STATUSES,
  COA_RESULT_KINDS,
  COA_RESULT_QUALIFIERS,
  COA_REVIEW_DECISIONS,
  COA_REVIEW_STATUSES,
  COA_SCOPE_KINDS,
  DECIMAL_STRING_REGEX,
  isValidDateOnly,
  isValidIsoUtcTimestamp,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT
} from "@cco/shared";

// ============================================================================
// Enums & Vocabulary Schemas
// ============================================================================

export const CoaCompletenessStatusSchema = z.enum(COA_COMPLETENESS_STATUSES);
export type CoaCompletenessStatusContract = z.infer<typeof CoaCompletenessStatusSchema>;

export const CoaScopeKindSchema = z.enum(COA_SCOPE_KINDS);
export type CoaScopeKindContract = z.infer<typeof CoaScopeKindSchema>;

export const CoaResultKindSchema = z.enum(COA_RESULT_KINDS);
export type CoaResultKindContract = z.infer<typeof CoaResultKindSchema>;

export const CoaResultQualifierSchema = z.enum(COA_RESULT_QUALIFIERS);
export type CoaResultQualifierContract = z.infer<typeof CoaResultQualifierSchema>;

export const CoaReviewDecisionSchema = z.enum(COA_REVIEW_DECISIONS);
export type CoaReviewDecisionContract = z.infer<typeof CoaReviewDecisionSchema>;

export const CoaReviewStatusSchema = z.enum(COA_REVIEW_STATUSES);
export type CoaReviewStatusContract = z.infer<typeof CoaReviewStatusSchema>;

export const CoaAnalyticalQualifierSchema = z.enum(COA_ANALYTICAL_QUALIFIERS);
export type CoaAnalyticalQualifierContract = z.infer<typeof CoaAnalyticalQualifierSchema>;

export const DecimalStringSchema = z
  .string()
  .regex(
    DECIMAL_STRING_REGEX,
    "Must be an exact decimal string (no floats, no exponents, no commas)"
  );

// ============================================================================
// Entity Contract Schemas
// ============================================================================

export const CoaMeasurementContractSchema = z
  .object({
    measurementId: z.string().uuid(),
    clientId: z.string().uuid(),
    reportId: z.string().uuid(),
    reportRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    analyte: z.string().min(1).max(128),
    resultKind: CoaResultKindSchema,
    resultValue: DecimalStringSchema.nullable(),
    resultLimit: DecimalStringSchema.nullable(),
    resultQualifier: CoaResultQualifierSchema.nullable(),
    unit: z.string().min(1).max(64),
    basis: z.string().min(1).max(64),
    context: z.string().min(1).max(64),
    quantityKind: z.string().min(1).max(64),
    methodAsReported: z.string().min(1).max(128).nullable(),
    uncertaintyAbsolute: DecimalStringSchema.nullable(),
    detectionLimit: DecimalStringSchema.nullable(),
    quantificationLimit: DecimalStringSchema.nullable(),
    analyticalQualifierCode: z.string().min(1).max(64).nullable(),
    analyticalQualifierExplanation: z.string().min(1).max(512).nullable()
  })
  .strict();
export type CoaMeasurementContract = z.infer<typeof CoaMeasurementContractSchema>;

export const CoaReportContractSchema = z
  .object({
    clientId: z.string().uuid(),
    reportId: z.string().uuid(),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    currentRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    version: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    createdAt: z.string().refine(isValidIsoUtcTimestamp),
    archivedAt: z.string().refine(isValidIsoUtcTimestamp).nullable()
  })
  .strict();
export type CoaReportContract = z.infer<typeof CoaReportContractSchema>;

export const CoaReportRevisionContractSchema = z
  .object({
    clientId: z.string().uuid(),
    reportId: z.string().uuid(),
    revision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    completenessStatus: CoaCompletenessStatusSchema,
    reportIdentifierAsClaimed: z.string().min(1).max(128).nullable(),
    reportDate: z.string().refine(isValidDateOnly).nullable(),
    labNameAsClaimed: z.string().min(1).max(255).nullable(),
    sampleIdentifierAsClaimed: z.string().min(1).max(128).nullable(),
    scopeKind: CoaScopeKindSchema.nullable(),
    scopeDescription: z.string().min(1).max(1000).nullable(),
    sampleDate: z.string().refine(isValidDateOnly).nullable(),
    samplingMethodDescription: z.string().min(1).max(1000).nullable(),
    sampleToBatchAssociationAttestation: z.string().min(1).max(2000).nullable(),
    sampleToBatchAssociationConfirmed: z.boolean().nullable(),
    verifiedLabIdentityEventId: z.string().uuid().nullable(),
    assertedBy: z.string().min(1).max(128),
    assertedAt: z.string().refine(isValidIsoUtcTimestamp),
    supersedesRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).nullable(),
    measurements: z.array(CoaMeasurementContractSchema)
  })
  .strict();
export type CoaReportRevisionContract = z.infer<typeof CoaReportRevisionContractSchema>;

export const CoaReviewEventContractSchema = z
  .object({
    eventId: z.string().uuid(),
    clientId: z.string().uuid(),
    reportId: z.string().uuid(),
    reportRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    decision: CoaReviewDecisionSchema,
    actorId: z.string().min(1).max(128),
    occurredAt: z.string().refine(isValidIsoUtcTimestamp),
    reason: z.string().min(1).max(1000),
    assessedScope: CoaScopeKindSchema
  })
  .strict();
export type CoaReviewEventContract = z.infer<typeof CoaReviewEventContractSchema>;

// ============================================================================
// Command Input Schemas
// ============================================================================

export const CreateCoaMeasurementInputSchema = z
  .object({
    analyte: z.string().trim().min(1).max(128),
    resultKind: CoaResultKindSchema,
    resultValue: DecimalStringSchema.nullable().optional(),
    resultLimit: DecimalStringSchema.nullable().optional(),
    resultQualifier: CoaResultQualifierSchema.nullable().optional(),
    unit: z.string().trim().min(1).max(64),
    basis: z.string().trim().min(1).max(64),
    context: z.string().trim().min(1).max(64),
    quantityKind: z.string().trim().min(1).max(64),
    methodAsReported: z.string().trim().min(1).max(128).nullable().optional(),
    uncertaintyAbsolute: DecimalStringSchema.nullable().optional(),
    detectionLimit: DecimalStringSchema.nullable().optional(),
    quantificationLimit: DecimalStringSchema.nullable().optional(),
    analyticalQualifierCode: z.string().trim().min(1).max(64).nullable().optional(),
    analyticalQualifierExplanation: z.string().trim().min(1).max(512).nullable().optional()
  })
  .strict();
export type CreateCoaMeasurementInputContract = z.infer<typeof CreateCoaMeasurementInputSchema>;

export const CreateCoaReportRequestSchema = z
  .object({
    reportId: z.string().uuid().optional(),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    completenessStatus: CoaCompletenessStatusSchema,
    reportIdentifierAsClaimed: z.string().trim().min(1).max(128).nullable().optional(),
    reportDate: z.string().refine(isValidDateOnly).nullable().optional(),
    labNameAsClaimed: z.string().trim().min(1).max(255).nullable().optional(),
    sampleIdentifierAsClaimed: z.string().trim().min(1).max(128).nullable().optional(),
    scopeKind: CoaScopeKindSchema.nullable().optional(),
    scopeDescription: z.string().trim().min(1).max(1000).nullable().optional(),
    sampleDate: z.string().refine(isValidDateOnly).nullable().optional(),
    samplingMethodDescription: z.string().trim().min(1).max(1000).nullable().optional(),
    sampleToBatchAssociationAttestation: z.string().trim().min(1).max(2000).nullable().optional(),
    sampleToBatchAssociationConfirmed: z.boolean().nullable().optional(),
    verifiedLabIdentityEventId: z.string().uuid().nullable().optional(),
    measurements: z.array(CreateCoaMeasurementInputSchema).optional().default([])
  })
  .strict();
export type CreateCoaReportRequest = z.infer<typeof CreateCoaReportRequestSchema>;

export const SupersedeCoaReportRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    completenessStatus: CoaCompletenessStatusSchema,
    reportIdentifierAsClaimed: z.string().trim().min(1).max(128).nullable().optional(),
    reportDate: z.string().refine(isValidDateOnly).nullable().optional(),
    labNameAsClaimed: z.string().trim().min(1).max(255).nullable().optional(),
    sampleIdentifierAsClaimed: z.string().trim().min(1).max(128).nullable().optional(),
    scopeKind: CoaScopeKindSchema.nullable().optional(),
    scopeDescription: z.string().trim().min(1).max(1000).nullable().optional(),
    sampleDate: z.string().refine(isValidDateOnly).nullable().optional(),
    samplingMethodDescription: z.string().trim().min(1).max(1000).nullable().optional(),
    sampleToBatchAssociationAttestation: z.string().trim().min(1).max(2000).nullable().optional(),
    sampleToBatchAssociationConfirmed: z.boolean().nullable().optional(),
    verifiedLabIdentityEventId: z.string().uuid().nullable().optional(),
    measurements: z.array(CreateCoaMeasurementInputSchema).optional().default([])
  })
  .strict();
export type SupersedeCoaReportRequest = z.infer<typeof SupersedeCoaReportRequestSchema>;

export const ReviewCoaReportRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    decision: CoaReviewDecisionSchema,
    reason: z.string().trim().min(1).max(1000),
    assessedScope: CoaScopeKindSchema
  })
  .strict();
export type ReviewCoaReportRequest = z.infer<typeof ReviewCoaReportRequestSchema>;

export const ArchiveCoaReportRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT)
  })
  .strict();
export type ArchiveCoaReportRequest = z.infer<typeof ArchiveCoaReportRequestSchema>;

// ============================================================================
// Support Resolution Schemas
// ============================================================================

export const ResolveCoaMeasurementSupportRequestSchema = z
  .object({
    batchId: z.string().uuid(),
    reportId: z.string().uuid(),
    reportRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    measurementIds: z.array(z.string().uuid()).min(1),
    requiredUnit: z.string().trim().min(1).max(64),
    requiredBasis: z.string().trim().min(1).max(64),
    requiredContext: z.string().trim().min(1).max(64),
    requiredScope: CoaScopeKindSchema
  })
  .strict();
export type ResolveCoaMeasurementSupportRequest = z.infer<
  typeof ResolveCoaMeasurementSupportRequestSchema
>;

export const ResolvedMeasurementDetailSchema = z
  .object({
    measurementId: z.string().uuid(),
    analyte: z.string(),
    decimalValue: DecimalStringSchema,
    unit: z.string(),
    basis: z.string(),
    context: z.string(),
    quantityKind: z.string(),
    uncertaintyAbsolute: DecimalStringSchema.nullable(),
    detectionLimit: DecimalStringSchema.nullable(),
    quantificationLimit: DecimalStringSchema.nullable(),
    method: z.string().nullable(),
    analyticalQualifierCode: z.string().nullable(),
    analyticalQualifierExplanation: z.string().nullable()
  })
  .strict();
export type ResolvedMeasurementDetail = z.infer<typeof ResolvedMeasurementDetailSchema>;

export const ResolveCoaMeasurementSupportResponseSchema = z
  .object({
    isSupported: z.boolean(),
    reason: z.string().optional(),
    resolution: z
      .object({
        clientId: z.string().uuid(),
        batchId: z.string().uuid(),
        reportId: z.string().uuid(),
        reportRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
        evidenceId: z.string().uuid(),
        evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
        sourceObjectId: z.string().uuid(),
        assessedScope: CoaScopeKindSchema,
        verifiedLabIdentityEventId: z.string().uuid().nullable().optional(),
        measurements: z.array(ResolvedMeasurementDetailSchema)
      })
      .strict()
      .optional()
  })
  .strict();
export type ResolveCoaMeasurementSupportResponse = z.infer<
  typeof ResolveCoaMeasurementSupportResponseSchema
>;
