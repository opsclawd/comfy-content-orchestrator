import { describe, expect, it } from "vitest";
import { normalizeDecimalString, type ClaimProofCategory } from "@cco/shared";
import {
  appendClaimRevisionToHead,
  createClaimEvidenceLink,
  createProductClaim,
  createProductClaimRevision,
  invalidateClaim,
  linkEvidenceToClaim,
  reviewClaim,
  type ClaimEvidenceLink
} from "./product-claim.js";
import {
  createBatchId,
  createClaimId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  createSha256Hex,
  createSkuId,
  createSourceObjectId
} from "./identifiers.js";
import {
  AccessDeniedError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";

describe("ProductClaim Domain Entity & Transitions", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const skuId = createSkuId("018f6f00-0000-7000-8000-000000000002");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000003");
  const claimId = createClaimId("018f6f00-0000-7000-8000-000000000004");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000005");
  const sourceObjectId = createSourceObjectId("018f6f00-0000-7000-8000-000000000006");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000007");
  const measurementId = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000008");
  const sha256 = createSha256Hex("a".repeat(64));

  function makeSampleLink(): ClaimEvidenceLink {
    return createClaimEvidenceLink({
      clientId,
      claimId,
      claimRevision: 1,
      batchId,
      evidenceId,
      evidenceRevision: 1,
      sourceObjectId,
      sourceSha256: sha256,
      supportRole: "primary_measurement",
      reportId,
      reportRevision: 1,
      measurementId
    });
  }

  describe("createProductClaim", () => {
    it("creates a new claim head in draft state with version 1 and currentRevision 1", () => {
      const claim = createProductClaim({
        claimId,
        clientId,
        skuId,
        batchId,
        now: "2026-10-20T12:00:00.000Z"
      });

      expect(claim.claimId).toBe(claimId);
      expect(claim.clientId).toBe(clientId);
      expect(claim.skuId).toBe(skuId);
      expect(claim.batchId).toBe(batchId);
      expect(claim.currentRevision).toBe(1);
      expect(claim.state).toBe("draft");
      expect(claim.version).toBe(1);
      expect(claim.invalidationCause).toBeNull();
      expect(claim.archivedAt).toBeNull();
    });
  });

  describe("createProductClaimRevision", () => {
    it("creates a valid certificate_panel_measurement revision preserving exact decimal string", () => {
      const rev = createProductClaimRevision({
        clientId,
        claimId,
        revision: 1,
        batchId,
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          measurements: [
            {
              analyte: "THCA",
              exactDecimalValue: normalizeDecimalString("24.5000"),
              unit: "percent_w_w",
              quantityKind: "mass_fraction",
              basis: "dry_weight",
              context: "flower",
              requiredScope: "sample_only"
            }
          ]
        },
        assertedBy: "author-1"
      });

      expect(rev.revision).toBe(1);
      expect(rev.canonicalKind).toBe("certificate_panel_measurement");
      expect(rev.parameters.kind).toBe("certificate_panel_measurement");
      if (rev.parameters.kind === "certificate_panel_measurement") {
        expect(rev.parameters.measurements[0]?.exactDecimalValue).toBe("24.5000");
      }
    });

    it("rejects revision 1 if supersedesRevision is set", () => {
      expect(() =>
        createProductClaimRevision({
          clientId,
          claimId,
          revision: 1,
          batchId,
          canonicalKind: "factual_lot_identifier",
          proofCategory: "production_record_backed",
          parameters: { kind: "factual_lot_identifier", lotIdentifier: "LOT-001" },
          assertedBy: "author-1",
          supersedesRevision: 0
        })
      ).toThrow(NonMonotonicRevisionError);
    });

    it("rejects non-monotonic revision progression", () => {
      expect(() =>
        createProductClaimRevision({
          clientId,
          claimId,
          revision: 2,
          batchId,
          canonicalKind: "factual_lot_identifier",
          proofCategory: "production_record_backed",
          parameters: { kind: "factual_lot_identifier", lotIdentifier: "LOT-001" },
          assertedBy: "author-1",
          supersedesRevision: null
        })
      ).toThrow(NonMonotonicRevisionError);

      expect(() =>
        createProductClaimRevision({
          clientId,
          claimId,
          revision: 3,
          batchId,
          canonicalKind: "factual_lot_identifier",
          proofCategory: "production_record_backed",
          parameters: { kind: "factual_lot_identifier", lotIdentifier: "LOT-001" },
          assertedBy: "author-1",
          supersedesRevision: 1
        })
      ).toThrow(NonMonotonicRevisionError);
    });

    it("rejects negative decimal measurement values", () => {
      expect(() =>
        createProductClaimRevision({
          clientId,
          claimId,
          revision: 1,
          batchId,
          canonicalKind: "certificate_panel_measurement",
          proofCategory: "coa_measurement_backed",
          parameters: {
            kind: "certificate_panel_measurement",
            measurements: [
              {
                analyte: "THC",
                exactDecimalValue: normalizeDecimalString("-5.0"),
                unit: "percent_w_w",
                quantityKind: "mass_fraction",
                basis: "dry_weight",
                context: "flower",
                requiredScope: "sample_only"
              }
            ]
          },
          assertedBy: "author-1"
        })
      ).toThrow(ProductValidationError);
    });

    it("rejects mismatch between parameter kind and canonicalKind", () => {
      expect(() =>
        createProductClaimRevision({
          clientId,
          claimId,
          revision: 1,
          batchId,
          canonicalKind: "factual_lot_identifier",
          proofCategory: "production_record_backed",
          parameters: {
            kind: "unsupported_manual",
            proposedText: "arbitrary",
            categoryOrReason: "test"
          },
          assertedBy: "author-1"
        })
      ).toThrow(ProductValidationError);
    });

    it("rejects human_attested_unverified proofCategory on structured claims", () => {
      expect(() =>
        createProductClaimRevision({
          clientId,
          claimId,
          revision: 1,
          batchId,
          canonicalKind: "factual_lot_identifier",
          proofCategory: "human_attested_unverified" as ClaimProofCategory,
          parameters: { kind: "factual_lot_identifier", lotIdentifier: "LOT-001" },
          assertedBy: "author-1"
        })
      ).toThrow(ProductValidationError);
    });
  });

  describe("createClaimEvidenceLink", () => {
    it("rejects incomplete measurement tuples (missing reportId or measurementId)", () => {
      expect(() =>
        createClaimEvidenceLink({
          clientId,
          claimId,
          claimRevision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          sourceObjectId,
          sourceSha256: sha256,
          supportRole: "primary_measurement",
          measurementId
          // reportId and reportRevision omitted
        })
      ).toThrow(ProductValidationError);
    });

    it("rejects primary_measurement role without measurementId", () => {
      expect(() =>
        createClaimEvidenceLink({
          clientId,
          claimId,
          claimRevision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          sourceObjectId,
          sourceSha256: sha256,
          supportRole: "primary_measurement"
        })
      ).toThrow(ProductValidationError);
    });

    it("rejects measurementId with non-primary_measurement support role", () => {
      expect(() =>
        createClaimEvidenceLink({
          clientId,
          claimId,
          claimRevision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          sourceObjectId,
          sourceSha256: sha256,
          supportRole: "corroborating_record",
          reportId,
          reportRevision: 1,
          measurementId
        })
      ).toThrow(ProductValidationError);
    });
  });

  describe("linkEvidenceToClaim", () => {
    it("transitions draft claim to evidence_linked state and increments version", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();

      const { claim: linkedClaim, decisionEvent } = linkEvidenceToClaim(
        claim,
        1,
        1,
        [link],
        "author-1",
        "Linked CoA measurements"
      );

      expect(linkedClaim.state).toBe("evidence_linked");
      expect(linkedClaim.version).toBe(2);
      expect(decisionEvent.decision).toBe("link_evidence");
      expect(decisionEvent.claimRevision).toBe(1);
    });

    it("rejects linking if claim is not in draft state", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");

      expect(() =>
        linkEvidenceToClaim(linkedClaim, 2, 1, [link], "author-1", "Link again")
      ).toThrow(ProductValidationError);
    });

    it("rejects linking on stale version", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();

      expect(() => linkEvidenceToClaim(claim, 999, 1, [link], "author-1", "Linked")).toThrow(
        StaleRevisionConflictError
      );
    });
  });

  describe("reviewClaim", () => {
    it("approves an evidence_linked claim and transitions to reviewer_approved", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");

      const { claim: approvedClaim, decisionEvent } = reviewClaim(
        linkedClaim,
        2,
        1,
        "approve",
        "reviewer-1",
        "Evidence linkages verified against laboratory CoA",
        "author-1"
      );

      expect(approvedClaim.state).toBe("reviewer_approved");
      expect(approvedClaim.version).toBe(3);
      expect(decisionEvent.decision).toBe("approve");
      expect(decisionEvent.actorId).toBe("reviewer-1");
    });

    it("rejects self-approval when reviewer is the claim author", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");

      expect(() =>
        reviewClaim(linkedClaim, 2, 1, "approve", "author-1", "Self approving", "author-1")
      ).toThrow(AccessDeniedError);
    });

    it("rejects self-approval when reviewer is a source fact attester", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");

      expect(() =>
        reviewClaim(linkedClaim, 2, 1, "approve", "attester-99", "Reviewing", "author-1", [
          "attester-99"
        ])
      ).toThrow(AccessDeniedError);
    });

    it("records rejection decision and transitions to rejected", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");

      const { claim: rejectedClaim, decisionEvent } = reviewClaim(
        linkedClaim,
        2,
        1,
        "reject",
        "reviewer-1",
        "Missing required SOP citation",
        "author-1"
      );

      expect(rejectedClaim.state).toBe("rejected");
      expect(rejectedClaim.version).toBe(3);
      expect(decisionEvent.decision).toBe("reject");
    });
  });

  describe("invalidateClaim", () => {
    it("invalidates an approved claim on dependency failure", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");
      const { claim: approvedClaim } = reviewClaim(
        linkedClaim,
        2,
        1,
        "approve",
        "reviewer-1",
        "Approved",
        "author-1"
      );

      const { claim: invalidatedClaim, decisionEvent } = invalidateClaim(
        approvedClaim,
        "source_superseded",
        "Underlying CoA report was superseded",
        "report:001"
      );

      expect(invalidatedClaim.state).toBe("invalidated");
      expect(invalidatedClaim.invalidationCause).toBe("source_superseded");
      expect(invalidatedClaim.version).toBe(4);
      expect(decisionEvent.decision).toBe("invalidate");
      expect(decisionEvent.invalidationCause).toBe("source_superseded");
    });

    it("rejects invalidating a draft claim", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      expect(() => invalidateClaim(claim, "source_archived", "Archived")).toThrow(
        ProductValidationError
      );
    });
  });

  describe("appendClaimRevisionToHead", () => {
    it("appends next revision to invalidated claim, resetting state to draft", () => {
      const claim = createProductClaim({ claimId, clientId, skuId, batchId });
      const link = makeSampleLink();
      const { claim: linkedClaim } = linkEvidenceToClaim(claim, 1, 1, [link], "author-1", "Linked");
      const { claim: invalidatedClaim } = invalidateClaim(
        linkedClaim,
        "source_superseded",
        "Superseded"
      );

      const { claim: revisedHead, revision: rev2 } = appendClaimRevisionToHead(
        invalidatedClaim,
        3,
        {
          canonicalKind: "certificate_panel_measurement",
          proofCategory: "coa_measurement_backed",
          parameters: {
            kind: "certificate_panel_measurement",
            measurements: [
              {
                analyte: "THCA",
                exactDecimalValue: normalizeDecimalString("22.1000"),
                unit: "percent_w_w",
                quantityKind: "mass_fraction",
                basis: "dry_weight",
                context: "flower",
                requiredScope: "sample_only"
              }
            ]
          },
          assertedBy: "author-2"
        }
      );

      expect(revisedHead.currentRevision).toBe(2);
      expect(revisedHead.state).toBe("draft");
      expect(revisedHead.version).toBe(4);
      expect(revisedHead.invalidationCause).toBeNull();
      expect(rev2.revision).toBe(2);
      expect(rev2.supersedesRevision).toBe(1);
    });
  });
});
