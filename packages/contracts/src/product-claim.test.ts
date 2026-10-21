import { describe, expect, it } from "vitest";
import {
  CreateClaimRequestSchema,
  LinkClaimEvidenceRequestSchema,
  ReviewClaimRequestSchema,
  ResolveClaimResponseSchema
} from "./product-claim.js";

describe("ProductClaim Contracts Zod Schemas", () => {
  const validBatchId = "018f6f00-0000-7000-8000-000000000001";
  const validClaimId = "018f6f00-0000-7000-8000-000000000002";
  const validClientId = "018f6f00-0000-7000-8000-000000000003";
  const validSkuId = "018f6f00-0000-7000-8000-000000000004";
  const validEvidenceId = "018f6f00-0000-7000-8000-000000000005";
  const validSourceObjectId = "018f6f00-0000-7000-8000-000000000006";
  const validSha256 = "c".repeat(64);

  describe("CreateClaimRequestSchema", () => {
    it("parses valid CreateClaimRequest for lot identifier", () => {
      const payload = {
        batchId: validBatchId,
        canonicalKind: "factual_lot_identifier",
        proofCategory: "production_record_backed",
        parameters: {
          kind: "factual_lot_identifier",
          lotIdentifier: "LOT-2026-IND-042"
        },
        displayWording: "Harvest Lot 042"
      };

      const result = CreateClaimRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("parses valid CreateClaimRequest for certificate panel measurement", () => {
      const payload = {
        batchId: validBatchId,
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          measurements: [
            {
              analyte: "Total THC",
              exactDecimalValue: "24.5000",
              unit: "percent_w_w",
              quantityKind: "mass_fraction",
              basis: "dry_weight",
              context: "flower",
              requiredScope: "sample_only"
            }
          ]
        }
      };

      const result = CreateClaimRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("rejects non-decimal floating point number in exactDecimalValue", () => {
      const payload = {
        batchId: validBatchId,
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          measurements: [
            {
              analyte: "Total THC",
              exactDecimalValue: "24.5e0", // exponential notation forbidden
              unit: "percent_w_w",
              quantityKind: "mass_fraction",
              basis: "dry_weight",
              context: "flower",
              requiredScope: "sample_only"
            }
          ]
        }
      };

      const result = CreateClaimRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("rejects unknown extra fields due to strict mode", () => {
      const payload = {
        batchId: validBatchId,
        canonicalKind: "factual_lot_identifier",
        proofCategory: "production_record_backed",
        parameters: {
          kind: "factual_lot_identifier",
          lotIdentifier: "LOT-001"
        },
        extraField: "forbidden"
      };

      const result = CreateClaimRequestSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("LinkClaimEvidenceRequestSchema", () => {
    it("parses valid LinkClaimEvidenceRequest", () => {
      const payload = {
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Linking laboratory report",
        links: [
          {
            evidenceId: validEvidenceId,
            evidenceRevision: 1,
            sourceObjectId: validSourceObjectId,
            sourceSha256: validSha256,
            supportRole: "primary_measurement",
            reportId: "018f6f00-0000-7000-8000-000000000007",
            reportRevision: 1,
            measurementId: "018f6f00-0000-7000-8000-000000000008"
          }
        ]
      };

      const result = LinkClaimEvidenceRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("ReviewClaimRequestSchema", () => {
    it("parses valid ReviewClaimRequest", () => {
      const payload = {
        expectedVersion: 2,
        claimRevision: 1,
        decision: "approve",
        reason: "Independent review confirmed measurement correspondence"
      };

      const result = ReviewClaimRequestSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("ResolveClaimResponseSchema", () => {
    it("validates structured ResolveClaimResponse", () => {
      const response = {
        claim: {
          claimId: validClaimId,
          clientId: validClientId,
          skuId: validSkuId,
          batchId: validBatchId,
          currentRevision: 1,
          state: "reviewer_approved",
          version: 3,
          invalidationCause: null,
          invalidationSourceRef: null,
          createdAt: "2026-10-20T12:00:00.000Z",
          updatedAt: "2026-10-20T12:30:00.000Z",
          archivedAt: null
        },
        revision: {
          clientId: validClientId,
          claimId: validClaimId,
          revision: 1,
          batchId: validBatchId,
          canonicalKind: "certificate_panel_measurement",
          proofCategory: "coa_measurement_backed",
          parameters: {
            kind: "certificate_panel_measurement",
            measurements: [
              {
                analyte: "Total THC",
                exactDecimalValue: "24.5000",
                unit: "percent_w_w",
                quantityKind: "mass_fraction",
                basis: "dry_weight",
                context: "flower",
                requiredScope: "sample_only"
              }
            ]
          },
          displayWording: "Total THC 24.50%",
          policyVersion: "claim_policy_v1",
          assertedBy: "author-1",
          assertedAt: "2026-10-20T12:00:00.000Z",
          supersedesRevision: null
        },
        supportEligible: true,
        canRequestReview: false,
        evidenceLinkApproved: true,
        provenanceCategory: "lab_reported",
        displayWordingStatus: "manual_review_approved",
        blockReasons: [],
        links: [
          {
            linkId: "018f6f00-0000-7000-8000-000000000010",
            clientId: validClientId,
            claimId: validClaimId,
            claimRevision: 1,
            batchId: validBatchId,
            evidenceId: validEvidenceId,
            evidenceRevision: 1,
            sourceObjectId: validSourceObjectId,
            sourceSha256: validSha256,
            supportRole: "primary_measurement",
            reportId: "018f6f00-0000-7000-8000-000000000007",
            reportRevision: 1,
            measurementId: "018f6f00-0000-7000-8000-000000000008"
          }
        ],
        reviewEvents: [
          {
            eventId: "018f6f00-0000-7000-8000-000000000020",
            clientId: validClientId,
            claimId: validClaimId,
            claimRevision: 1,
            decision: "approve",
            actorId: "reviewer-1",
            occurredAt: "2026-10-20T12:30:00.000Z",
            reason: "Verified against CoA",
            policyVersion: "claim_policy_v1",
            dependencyFingerprint: "fingerprint-123"
          }
        ],
        dependencyFingerprint: "fingerprint-123"
      };

      const result = ResolveClaimResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("validates ResolveClaimResponse with enriched source/measurement/verification details", () => {
      const response = {
        claim: {
          claimId: validClaimId,
          clientId: validClientId,
          skuId: validSkuId,
          batchId: validBatchId,
          currentRevision: 1,
          state: "reviewer_approved",
          version: 3,
          invalidationCause: null,
          invalidationSourceRef: null,
          createdAt: "2026-10-20T12:00:00.000Z",
          updatedAt: "2026-10-20T12:30:00.000Z",
          archivedAt: null
        },
        revision: {
          clientId: validClientId,
          claimId: validClaimId,
          revision: 1,
          batchId: validBatchId,
          canonicalKind: "certificate_panel_measurement",
          proofCategory: "coa_measurement_backed",
          parameters: {
            kind: "certificate_panel_measurement",
            measurements: [
              {
                analyte: "Total THC",
                exactDecimalValue: "24.5000",
                unit: "percent_w_w",
                quantityKind: "mass_fraction",
                basis: "dry_weight",
                context: "flower",
                requiredScope: "sample_only"
              }
            ]
          },
          displayWording: "Total THC 24.50%",
          policyVersion: "claim_policy_v1",
          assertedBy: "author-1",
          assertedAt: "2026-10-20T12:00:00.000Z",
          supersedesRevision: null
        },
        supportEligible: true,
        canRequestReview: false,
        evidenceLinkApproved: true,
        provenanceCategory: "lab_reported",
        displayWordingStatus: "manual_review_approved",
        blockReasons: [],
        links: [
          {
            linkId: "018f6f00-0000-7000-8000-000000000010",
            clientId: validClientId,
            claimId: validClaimId,
            claimRevision: 1,
            batchId: validBatchId,
            evidenceId: validEvidenceId,
            evidenceRevision: 1,
            sourceObjectId: validSourceObjectId,
            sourceSha256: validSha256,
            supportRole: "primary_measurement",
            reportId: "018f6f00-0000-7000-8000-000000000007",
            reportRevision: 1,
            measurementId: "018f6f00-0000-7000-8000-000000000008",
            sourceClass: "coa",
            measurementDetails: {
              measurementId: "018f6f00-0000-7000-8000-000000000008",
              analyte: "Total THC",
              resultKind: "quantified",
              resultValue: "24.5000",
              unit: "percent_w_w",
              quantityKind: "mass_fraction",
              basis: "dry_weight",
              context: "flower"
            },
            reportDetails: {
              reportId: "018f6f00-0000-7000-8000-000000000007",
              revision: 1,
              completenessStatus: "complete",
              scopeKind: "sample_only",
              verifiedLabIdentityEventId: "018f6f00-0000-7000-8000-000000000021",
              labVerificationOutcome: "verified"
            },
            verificationDetails: {
              eventId: "018f6f00-0000-7000-8000-000000000022",
              outcome: "verified",
              verificationKind: "third_party_audit",
              factScope: "panel_results",
              isWithdrawn: false
            }
          }
        ],
        reviewEvents: [
          {
            eventId: "018f6f00-0000-7000-8000-000000000020",
            clientId: validClientId,
            claimId: validClaimId,
            claimRevision: 1,
            decision: "approve",
            actorId: "reviewer-1",
            occurredAt: "2026-10-20T12:30:00.000Z",
            reason: "Verified against CoA",
            policyVersion: "claim_policy_v1",
            dependencyFingerprint: "fingerprint-123"
          }
        ],
        dependencyFingerprint: "fingerprint-123"
      };

      const result = ResolveClaimResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });
});
