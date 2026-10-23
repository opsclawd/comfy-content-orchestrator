import { describe, expect, it } from "vitest";
import {
  SafeSourceObjectResponseSchema,
  EvidenceMediaDeliveryResponseSchema,
  InvalidateClaimRequestSchema,
  ProductEvidenceHttpErrorResponseSchema
} from "./product-evidence-http.js";

describe("product-evidence-http contracts", () => {
  const sampleUuid = "11111111-1111-4111-8111-111111111111";
  const sampleSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const now = "2026-10-21T12:00:00.000Z";

  describe("SafeSourceObjectResponseSchema", () => {
    it("accepts a valid safe source object without internal storage fields", () => {
      const valid = {
        sourceObjectId: sampleUuid,
        originalSha256: sampleSha,
        detectedMimeType: "image/jpeg",
        byteLength: 1024,
        uploadedAt: now,
        uploaderId: "user-123",
        accessClass: "restricted_original" as const,
        retentionClass: "source_evidence_archive" as const,
        retentionPolicyVersion: "policy-v1",
        availability: "available" as const
      };

      const result = SafeSourceObjectResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects internal storage fields (bucket, key, versionId)", () => {
      const withInternalKeys = {
        sourceObjectId: sampleUuid,
        originalSha256: sampleSha,
        detectedMimeType: "image/jpeg",
        byteLength: 1024,
        uploadedAt: now,
        uploaderId: "user-123",
        accessClass: "restricted_original",
        retentionClass: "source_evidence_archive",
        retentionPolicyVersion: "policy-v1",
        availability: "available",
        storageBucket: "internal-bucket",
        storageObjectKey: "internal/key",
        storageVersionId: "v1"
      };

      const result = SafeSourceObjectResponseSchema.safeParse(withInternalKeys);
      expect(result.success).toBe(false);
    });
  });

  describe("EvidenceMediaDeliveryResponseSchema", () => {
    it("accepts valid delivery response with signed url and expiration", () => {
      const valid = {
        clientId: sampleUuid,
        batchId: sampleUuid,
        evidenceId: sampleUuid,
        evidenceRevision: 1,
        sourceObjectId: sampleUuid,
        originalSha256: sampleSha,
        detectedMimeType: "image/jpeg",
        byteLength: 2048,
        url: "https://storage.example.com/signed-url?token=xyz",
        expiresAt: now
      };

      const result = EvidenceMediaDeliveryResponseSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid URL or missing expiration", () => {
      const invalid = {
        clientId: sampleUuid,
        batchId: sampleUuid,
        evidenceId: sampleUuid,
        evidenceRevision: 1,
        sourceObjectId: sampleUuid,
        originalSha256: sampleSha,
        detectedMimeType: "image/jpeg",
        byteLength: 2048,
        url: "not-a-url",
        expiresAt: "invalid-date"
      };

      const result = EvidenceMediaDeliveryResponseSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("InvalidateClaimRequestSchema", () => {
    const validUuidV7 = "018e69e0-8a6a-72cb-b1b7-ec79a1f73001";

    it("accepts valid invalidation command", () => {
      const valid = {
        actionId: validUuidV7,
        expectedVersion: 1,
        claimRevision: 1,
        invalidationCause: "source_superseded",
        reason: "Source evidence superseded by lab revision"
      };

      const result = InvalidateClaimRequestSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects unknown invalidation cause", () => {
      const invalid = {
        actionId: validUuidV7,
        expectedVersion: 1,
        claimRevision: 1,
        invalidationCause: "unknown_cause",
        reason: "Manual reason"
      };

      const result = InvalidateClaimRequestSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("ProductEvidenceHttpErrorResponseSchema", () => {
    it("accepts normalized AccessDenied subcodes", () => {
      const errors = [
        { error: "SELF_APPROVAL_FORBIDDEN", message: "Self-approval is forbidden." },
        { error: "COA_REPORT_ARCHIVED", message: "CoA report is archived." },
        { error: "EVIDENCE_ARCHIVED", message: "Evidence asset is archived." },
        { error: "AUTHENTICATION_REQUIRED", message: "Missing principal." },
        { error: "FORBIDDEN", message: "Cross-client access forbidden." },
        { error: "PAYLOAD_TOO_LARGE", message: "Upload payload exceeds limit." },
        { error: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported media type." },
        { error: "INTERNAL_ERROR", message: "An unexpected error occurred." }
      ];

      for (const err of errors) {
        const result = ProductEvidenceHttpErrorResponseSchema.safeParse(err);
        expect(result.success).toBe(true);
      }
    });

    it("accepts validation error envelope", () => {
      const validationErr = {
        error: "VALIDATION_ERROR",
        issues: [
          {
            code: "INVALID_IDENTIFIER",
            path: ["batchId"],
            message: "batchId must be a valid UUID"
          }
        ]
      };

      const result = ProductEvidenceHttpErrorResponseSchema.safeParse(validationErr);
      expect(result.success).toBe(true);
    });
  });
});
