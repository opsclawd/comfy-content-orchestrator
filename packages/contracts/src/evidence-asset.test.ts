import { describe, expect, it } from "vitest";
import {
  LinkEvidenceDerivativeRequestSchema,
  RecordEvidenceVerificationEventRequestSchema,
  RegisterEvidenceAssetRequestSchema,
  SourceObjectSchema
} from "./evidence-asset.js";

describe("Evidence Asset Contract Schemas", () => {
  const validActionId = "018f0000-0010-7000-8000-000000000001";
  const validBatchId = "018f0000-0002-7000-8000-000000000001";
  const validEvidenceId = "018f0000-0006-7000-8000-000000000001";
  const validRefId = "018f0000-0004-7000-8000-000000000001";
  const validSha = "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0";

  it("parses valid RegisterEvidenceAssetRequest with initial_assertion", () => {
    const raw = {
      actionId: validActionId,
      batchId: validBatchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Packaging hero photo",
      declaredMimeType: "image/jpeg",
      registrationIntent: "initial_assertion",
      reportedCaptureDate: "2026-03-24",
      reportedCaptureTimestamp: "2026-03-24T12:00:00.000Z"
    };

    const parsed = RegisterEvidenceAssetRequestSchema.parse(raw);
    expect(parsed.purpose).toBe("macro_hero_photo");
    expect(parsed.registrationIntent).toBe("initial_assertion");
  });

  it("parses valid RegisterEvidenceAssetRequest with reusedSourceObjectId without declaredMimeType", () => {
    const raw = {
      actionId: validActionId,
      batchId: validBatchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Packaging hero photo",
      registrationIntent: "new_batch_assertion",
      reusedSourceObjectId: "018f0000-0005-7000-8000-000000000001"
    };

    const parsed = RegisterEvidenceAssetRequestSchema.parse(raw);
    expect(parsed.reusedSourceObjectId).toBe("018f0000-0005-7000-8000-000000000001");
  });

  it("fails RegisterEvidenceAssetRequest when declaredMimeType is missing without reusedSourceObjectId", () => {
    const raw = {
      actionId: validActionId,
      batchId: validBatchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Packaging hero photo",
      registrationIntent: "initial_assertion"
    };

    expect(() => RegisterEvidenceAssetRequestSchema.parse(raw)).toThrow();
  });

  it("fails RegisterEvidenceAssetRequest when supersede lacks targetEvidenceId or expectedVersion", () => {
    const raw = {
      actionId: validActionId,
      batchId: validBatchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Packaging hero photo",
      declaredMimeType: "image/jpeg",
      registrationIntent: "supersede"
    };

    expect(() => RegisterEvidenceAssetRequestSchema.parse(raw)).toThrow();
  });

  it("fails RegisterEvidenceAssetRequest when capture date and timestamp date mismatch", () => {
    const raw = {
      actionId: validActionId,
      batchId: validBatchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Packaging hero photo",
      declaredMimeType: "image/jpeg",
      registrationIntent: "initial_assertion",
      reportedCaptureDate: "2026-03-24",
      reportedCaptureTimestamp: "2026-03-25T12:00:00.000Z" // 25 != 24
    };

    expect(() => RegisterEvidenceAssetRequestSchema.parse(raw)).toThrow();
  });

  it("parses valid LinkEvidenceDerivativeRequest", () => {
    const raw = {
      actionId: validActionId,
      evidenceId: validEvidenceId,
      evidenceRevision: 1,
      referenceAssetId: validRefId,
      derivativeSha256: validSha,
      transformDescription: "Lanczos 1344x768 WebP",
      transformToolVersion: "sharp-0.34.5"
    };

    const parsed = LinkEvidenceDerivativeRequestSchema.parse(raw);
    expect(parsed.derivativeSha256).toBe(validSha);
  });

  it("parses valid RecordEvidenceVerificationEventRequest and rejects withdrawn without withdrawalEventId", () => {
    const valid = {
      actionId: validActionId,
      evidenceId: validEvidenceId,
      evidenceRevision: 1,
      outcome: "verified",
      verificationKind: "independent_third_party_corroboration",
      factScope: "full_document_authenticity",
      method: "third_party_lab_audit",
      reason: "Accreditation ISO 17025 confirmed"
    };
    expect(RecordEvidenceVerificationEventRequestSchema.parse(valid).outcome).toBe("verified");

    const invalidWithdrawn = {
      ...valid,
      outcome: "withdrawn"
    };
    expect(() => RecordEvidenceVerificationEventRequestSchema.parse(invalidWithdrawn)).toThrow();
  });

  it("parses valid SourceObject schema", () => {
    const raw = {
      clientId: "018f0000-0000-7000-8000-000000000001",
      sourceObjectId: "018f0000-0003-7000-8000-000000000001",
      storageBucket: "godzspeed-evidence",
      storageObjectKey:
        "clients/018f0000-0000-7000-8000-000000000001/evidence/originals/a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
      originalSha256: validSha,
      detectedMimeType: "image/jpeg",
      byteLength: 2048,
      uploadedAt: "2026-03-24T12:00:00.000Z",
      uploaderId: "uploader_1",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: "v1-legal-hold",
      availability: "available",
      storageVersionId: null
    };

    const parsed = SourceObjectSchema.parse(raw);
    expect(parsed.originalSha256).toBe(validSha);
  });
});
