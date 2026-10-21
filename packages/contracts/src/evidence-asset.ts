import { z } from "zod";
import {
  BATCH_EVIDENCE_PURPOSES,
  CONSENT_STATUSES,
  EVIDENCE_ACQUISITION_METHODS,
  EVIDENCE_REGISTRATION_INTENTS,
  EVIDENCE_SOURCE_CLASSES,
  isValidDateOnly,
  isValidIsoUtcTimestamp,
  LEGAL_RIGHTS_STATUSES,
  MAX_POSITIVE_INT,
  MIN_POSITIVE_INT,
  REPORTED_CAPTURE_PRECISIONS,
  SOURCE_OBJECT_AVAILABILITIES,
  VERIFICATION_FACT_SCOPES,
  VERIFICATION_KINDS,
  VERIFICATION_OUTCOMES
} from "@cco/shared";

// ============================================================================
// Enums & Controlled Vocabulary Schemas
// ============================================================================

export const EvidenceSourceClassSchema = z.enum(EVIDENCE_SOURCE_CLASSES);
export type EvidenceSourceClassContract = z.infer<typeof EvidenceSourceClassSchema>;

export const EvidenceAcquisitionMethodSchema = z.enum(EVIDENCE_ACQUISITION_METHODS);
export type EvidenceAcquisitionMethodContract = z.infer<typeof EvidenceAcquisitionMethodSchema>;

export const LegalRightsStatusSchema = z.enum(LEGAL_RIGHTS_STATUSES);
export type LegalRightsStatusContract = z.infer<typeof LegalRightsStatusSchema>;

export const ConsentStatusSchema = z.enum(CONSENT_STATUSES);
export type ConsentStatusContract = z.infer<typeof ConsentStatusSchema>;

export const BatchEvidencePurposeSchema = z.enum(BATCH_EVIDENCE_PURPOSES);
export type BatchEvidencePurposeContract = z.infer<typeof BatchEvidencePurposeSchema>;

export const VerificationOutcomeSchema = z.enum(VERIFICATION_OUTCOMES);
export type VerificationOutcomeContract = z.infer<typeof VerificationOutcomeSchema>;

export const VerificationKindSchema = z.enum(VERIFICATION_KINDS);
export type VerificationKindContract = z.infer<typeof VerificationKindSchema>;

export const VerificationFactScopeSchema = z.enum(VERIFICATION_FACT_SCOPES);
export type VerificationFactScopeContract = z.infer<typeof VerificationFactScopeSchema>;

export const SourceObjectAvailabilitySchema = z.enum(SOURCE_OBJECT_AVAILABILITIES);
export type SourceObjectAvailabilityContract = z.infer<typeof SourceObjectAvailabilitySchema>;

export const EvidenceRegistrationIntentSchema = z.enum(EVIDENCE_REGISTRATION_INTENTS);
export type EvidenceRegistrationIntentContract = z.infer<typeof EvidenceRegistrationIntentSchema>;

export const ReportedCapturePrecisionSchema = z.enum(REPORTED_CAPTURE_PRECISIONS);
export type ReportedCapturePrecisionContract = z.infer<typeof ReportedCapturePrecisionSchema>;

// ============================================================================
// Entity Schemas
// ============================================================================

export const SourceObjectSchema = z
  .object({
    clientId: z.string().uuid(),
    sourceObjectId: z.string().uuid(),
    storageBucket: z.string().min(1),
    storageObjectKey: z.string().min(1),
    originalSha256: z.string().regex(/^[0-9a-f]{64}$/),
    detectedMimeType: z.string().min(1),
    byteLength: z.number().int().positive(),
    uploadedAt: z.string().refine(isValidIsoUtcTimestamp),
    uploaderId: z.string().min(1),
    accessClass: z.literal("restricted_original"),
    retentionClass: z.literal("source_evidence_archive"),
    retentionPolicyVersion: z.string().min(1),
    availability: SourceObjectAvailabilitySchema,
    storageVersionId: z.string().nullable()
  })
  .strict();
export type SourceObjectContract = z.infer<typeof SourceObjectSchema>;

export const EvidenceAssetSchema = z
  .object({
    clientId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    currentRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    version: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    createdAt: z.string().refine(isValidIsoUtcTimestamp),
    archivedAt: z.string().refine(isValidIsoUtcTimestamp).nullable()
  })
  .strict();
export type EvidenceAssetContract = z.infer<typeof EvidenceAssetSchema>;

export const EvidenceRevisionSchema = z
  .object({
    clientId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    revision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    sourceObjectId: z.string().uuid(),
    sourceClass: EvidenceSourceClassSchema,
    acquisitionMethod: EvidenceAcquisitionMethodSchema,
    submittedBy: z.string().min(1),
    submittedAt: z.string().refine(isValidIsoUtcTimestamp),
    assertionText: z.string().min(1).max(4000),
    reportedCaptureDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "reportedCaptureDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .nullable(),
    reportedCaptureTimestamp: z
      .string()
      .refine(isValidIsoUtcTimestamp, {
        message: "reportedCaptureTimestamp must be a valid ISO 8601 UTC timestamp"
      })
      .nullable(),
    reportedCapturePrecision: ReportedCapturePrecisionSchema.nullable(),
    captureContext: z.string().nullable(),
    rightsStatus: LegalRightsStatusSchema,
    consentStatus: ConsentStatusSchema,
    rightsAttribution: z.string().nullable(),
    rightsDocumentLocator: z.string().nullable(),
    supersedesRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT).nullable()
  })
  .strict();
export type EvidenceRevisionContract = z.infer<typeof EvidenceRevisionSchema>;

export const BatchEvidenceLinkSchema = z
  .object({
    clientId: z.string().uuid(),
    batchId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    purpose: BatchEvidencePurposeSchema,
    assertedBy: z.string().min(1),
    assertedAt: z.string().refine(isValidIsoUtcTimestamp)
  })
  .strict();
export type BatchEvidenceLinkContract = z.infer<typeof BatchEvidenceLinkSchema>;

export const EvidenceDerivativeSchema = z
  .object({
    clientId: z.string().uuid(),
    derivativeId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    referenceAssetId: z.string().uuid(),
    derivativeSha256: z.string().regex(/^[0-9a-f]{64}$/),
    transformDescription: z.string().min(1),
    transformToolVersion: z.string().nullable(),
    createdBy: z.string().min(1),
    createdAt: z.string().refine(isValidIsoUtcTimestamp)
  })
  .strict();
export type EvidenceDerivativeContract = z.infer<typeof EvidenceDerivativeSchema>;

export const EvidenceVerificationEventSchema = z
  .object({
    clientId: z.string().uuid(),
    eventId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    outcome: VerificationOutcomeSchema,
    verificationKind: VerificationKindSchema,
    factScope: VerificationFactScopeSchema,
    actorId: z.string().min(1),
    occurredAt: z.string().refine(isValidIsoUtcTimestamp),
    method: z.string().min(1),
    reason: z.string().min(1),
    verifiedPartyReference: z.string().nullable(),
    withdrawalEventId: z.string().uuid().nullable()
  })
  .strict();
export type EvidenceVerificationEventContract = z.infer<typeof EvidenceVerificationEventSchema>;

// ============================================================================
// Public Request / Command Schemas
// ============================================================================

export const RegisterEvidenceAssetRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    batchId: z.string().uuid(),
    purpose: BatchEvidencePurposeSchema,
    sourceClass: EvidenceSourceClassSchema,
    acquisitionMethod: EvidenceAcquisitionMethodSchema,
    assertionText: z.string().min(1).max(4000),
    reportedCaptureDate: z
      .string()
      .refine(isValidDateOnly, {
        message: "reportedCaptureDate must be a valid Gregorian date (YYYY-MM-DD)"
      })
      .optional(),
    reportedCaptureTimestamp: z
      .string()
      .refine(isValidIsoUtcTimestamp, {
        message: "reportedCaptureTimestamp must be a valid ISO 8601 UTC timestamp"
      })
      .optional(),
    reportedCapturePrecision: ReportedCapturePrecisionSchema.optional(),
    captureContext: z.string().max(2000).optional(),
    rightsStatus: LegalRightsStatusSchema.optional(),
    consentStatus: ConsentStatusSchema.optional(),
    rightsAttribution: z.string().max(1000).optional(),
    rightsDocumentLocator: z.string().max(1000).optional(),
    declaredMimeType: z.string().min(1).optional(),
    registrationIntent: EvidenceRegistrationIntentSchema,
    reusedSourceObjectId: z.string().uuid().optional(),
    expectedEvidenceVersion: z
      .number()
      .int()
      .min(MIN_POSITIVE_INT)
      .max(MAX_POSITIVE_INT)
      .optional(),
    targetEvidenceId: z.string().uuid().optional(),
    derivative: z
      .object({
        referenceAssetId: z.string().uuid(),
        derivativeSha256: z.string().regex(/^[0-9a-f]{64}$/),
        transformDescription: z.string().min(1).max(2000),
        transformToolVersion: z.string().max(128).optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.reusedSourceObjectId && !val.declaredMimeType) {
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
export type RegisterEvidenceAssetRequest = z.infer<typeof RegisterEvidenceAssetRequestSchema>;

export const LinkEvidenceDerivativeRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    referenceAssetId: z.string().uuid(),
    derivativeSha256: z.string().regex(/^[0-9a-f]{64}$/),
    transformDescription: z.string().min(1).max(2000),
    transformToolVersion: z.string().max(128).optional()
  })
  .strict();
export type LinkEvidenceDerivativeRequest = z.infer<typeof LinkEvidenceDerivativeRequestSchema>;

export const RecordEvidenceVerificationEventRequestSchema = z
  .object({
    actionId: z.string().uuid(),
    evidenceId: z.string().uuid(),
    evidenceRevision: z.number().int().min(MIN_POSITIVE_INT).max(MAX_POSITIVE_INT),
    outcome: VerificationOutcomeSchema,
    verificationKind: VerificationKindSchema,
    factScope: VerificationFactScopeSchema,
    method: z.string().min(1).max(1000),
    reason: z.string().min(1).max(2000),
    verifiedPartyReference: z.string().max(500).optional(),
    withdrawalEventId: z.string().uuid().optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.outcome === "withdrawn" && !val.withdrawalEventId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["withdrawalEventId"],
        message: "withdrawalEventId is required when outcome is 'withdrawn'"
      });
    }
  });
export type RecordEvidenceVerificationEventRequest = z.infer<
  typeof RecordEvidenceVerificationEventRequestSchema
>;

// ============================================================================
// Public Result / Response Schemas
// ============================================================================

export const RegisterEvidenceAssetResponseSchema = z
  .object({
    evidenceAsset: EvidenceAssetSchema,
    evidenceRevision: EvidenceRevisionSchema,
    sourceObject: SourceObjectSchema,
    batchEvidenceLink: BatchEvidenceLinkSchema,
    derivative: EvidenceDerivativeSchema.nullable()
  })
  .strict();
export type RegisterEvidenceAssetResponse = z.infer<typeof RegisterEvidenceAssetResponseSchema>;
