import { describe, expect, it } from "vitest";
import { normalizeDecimalString } from "@cco/shared";
import {
  evaluateClaimEligibility,
  type ClaimEligibilitySnapshot,
  type LinkDependencySnapshot
} from "./claim-eligibility.js";
import {
  createClaimEvidenceLink,
  createProductClaim,
  createProductClaimRevision
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
  createSourceObjectId,
  createVerificationEventId
} from "./identifiers.js";

describe("Deterministic Claim Eligibility Evaluator", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const skuId = createSkuId("018f6f00-0000-7000-8000-000000000002");
  const batchLotA = createBatchId("018f6f00-0000-7000-8000-000000000003");
  const batchLotB = createBatchId("018f6f00-0000-7000-8000-000000000004");
  const claimId = createClaimId("018f6f00-0000-7000-8000-000000000005");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000006");
  const sourceObjectId = createSourceObjectId("018f6f00-0000-7000-8000-000000000007");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000008");
  const measurementId = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000009");
  const sha256 = createSha256Hex("b".repeat(64));

  function makeBaselineSnapshot(
    overrides?: Partial<ClaimEligibilitySnapshot>
  ): ClaimEligibilitySnapshot {
    const claim = createProductClaim({
      claimId,
      clientId,
      skuId,
      batchId: batchLotA
    });

    const revision = createProductClaimRevision({
      clientId,
      claimId,
      revision: 1,
      batchId: batchLotA,
      canonicalKind: "certificate_panel_measurement",
      proofCategory: "coa_measurement_backed",
      parameters: {
        kind: "certificate_panel_measurement",
        measurements: [
          {
            analyte: "Total Terpenes",
            exactDecimalValue: normalizeDecimalString("7.00"),
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

    const link = createClaimEvidenceLink({
      clientId,
      claimId,
      claimRevision: 1,
      batchId: batchLotA,
      evidenceId,
      evidenceRevision: 1,
      sourceObjectId,
      sourceSha256: sha256,
      supportRole: "primary_measurement",
      reportId,
      reportRevision: 1,
      measurementId
    });

    const linkSnapshot: LinkDependencySnapshot = {
      link,
      evidenceAsset: {
        evidenceId,
        clientId,
        currentRevision: 1,
        archivedAt: null
      },
      evidenceRevision: {
        evidenceId,
        revision: 1,
        sourceObjectId,
        sourceClass: "coa"
      },
      sourceObject: {
        sourceObjectId,
        clientId,
        originalSha256: sha256,
        availability: "available"
      },
      batchEvidenceLinkExists: true,
      disputes: [],
      coaReport: {
        reportId,
        clientId,
        batchId: batchLotA,
        currentRevision: 1,
        archivedAt: null
      },
      coaReportRevision: {
        reportId,
        revision: 1,
        completenessStatus: "complete",
        scopeKind: "sample_only"
      },
      coaReviewEvent: {
        decision: "approved",
        assessedScope: "sample_only"
      },
      coaMeasurement: {
        measurementId,
        analyte: "Total Terpenes",
        resultKind: "quantified",
        resultValue: "7.00",
        unit: "percent_w_w",
        quantityKind: "mass_fraction",
        basis: "dry_weight",
        context: "flower"
      }
    };

    return {
      claim,
      revision,
      sku: { skuId, clientId, archivedAt: null },
      batch: {
        batchId: batchLotA,
        skuId,
        clientId,
        lotIdentifier: "LOT-A",
        currentFactsRevision: 1,
        archivedAt: null
      },
      links: [linkSnapshot],
      ...overrides
    };
  }

  it("evaluates a valid eligible measurement claim", () => {
    const snapshot = makeBaselineSnapshot();
    const result = evaluateClaimEligibility(snapshot);

    expect(result.supportEligible).toBe(true);
    expect(result.blockReasons).toHaveLength(0);
    expect(result.provenanceCategory).toBe("lab_reported");
  });

  // Acceptance 1: Lot A claims 'terpenes 7%' referencing lot B's 7% CoA
  it("rejects Lot A claim referencing Lot B's CoA even under the same SKU", () => {
    const base = makeBaselineSnapshot();
    const lotBLink = createClaimEvidenceLink({
      ...base.links[0]!.link,
      batchId: batchLotA
    });

    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          link: lotBLink,
          coaReport: {
            ...base.links[0]!.coaReport!,
            batchId: batchLotB
          },
          batchEvidenceLinkExists: true
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "BATCH_MISMATCH")).toBe(true);
  });

  // Acceptance 2: CoA revision supersession, source dispute, archival, and changed measurement
  it("blocks claim resolution when CoA report revision has been superseded", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          coaReport: {
            ...base.links[0]!.coaReport!,
            currentRevision: 2
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "SOURCE_SUPERSEDED")).toBe(true);
  });

  it("blocks claim resolution when source object has an active dispute", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          disputes: [
            {
              eventId: "dispute-001",
              outcome: "disputed"
            }
          ]
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "SOURCE_DISPUTED")).toBe(true);
  });

  it("blocks claim resolution when source object is quarantined", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          sourceObject: {
            ...base.links[0]!.sourceObject!,
            availability: "quarantined"
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "SOURCE_QUARANTINED")).toBe(true);
  });

  it("blocks claim resolution when measured value does not match claimed value", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          coaMeasurement: {
            ...base.links[0]!.coaMeasurement!,
            resultValue: "5.50"
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "MEASUREMENT_MISMATCH")).toBe(true);
  });

  // Acceptance 3: Provenance category derivation
  it("labels lab data as lab_reported, partner process as partner_process_record, operator claims as operator_attested_sop, and manual assertions as manual_unverified", () => {
    const base = makeBaselineSnapshot();
    const labResult = evaluateClaimEligibility(base);
    expect(labResult.provenanceCategory).toBe("lab_reported");

    // Partner lineage
    const partnerRev = createProductClaimRevision({
      clientId,
      claimId,
      revision: 1,
      batchId: batchLotA,
      canonicalKind: "cultivation_processing_lineage",
      proofCategory: "production_record_backed",
      parameters: {
        kind: "cultivation_processing_lineage",
        operationCode: "OP-PARTNER",
        originKind: "partner_origin",
        attributedParty: "Emerald Hills Partner Farm",
        claimedFacts: ["Living Soil Cultivation"]
      },
      assertedBy: "author-1"
    });
    const partnerSnapshot: ClaimEligibilitySnapshot = {
      ...base,
      revision: partnerRev,
      links: [
        {
          ...base.links[0]!,
          link: {
            ...base.links[0]!.link,
            measurementId: null,
            supportRole: "corroborating_record",
            attestation: {
              factKind: "operation_lineage",
              factValue: "Living Soil Cultivation",
              fieldLocator: "SOP-12",
              attribution: "Emerald Hills Partner Farm",
              actorId: "attester-1",
              occurredAt: "2026-10-18T12:00:00.000Z",
              verificationEventId: createVerificationEventId("018f6f00-0000-7000-8000-000000000099")
            }
          },
          evidenceRevision: {
            ...base.links[0]!.evidenceRevision!,
            sourceClass: "process_record"
          },
          reliedVerificationEvent: {
            eventId: "018f6f00-0000-7000-8000-000000000099",
            outcome: "verified"
          },
          coaReport: null,
          coaReportRevision: null,
          coaReviewEvent: null,
          coaMeasurement: null
        }
      ]
    };
    const partnerResult = evaluateClaimEligibility(partnerSnapshot);
    expect(partnerResult.provenanceCategory).toBe("partner_process_record");
    expect(partnerResult.supportEligible).toBe(true);
    expect(partnerResult.blockReasons).toHaveLength(0);

    // Unsupported manual
    const manualRev = createProductClaimRevision({
      clientId,
      claimId,
      revision: 1,
      batchId: batchLotA,
      canonicalKind: "unsupported_manual",
      proofCategory: "human_attested_unverified",
      parameters: {
        kind: "unsupported_manual",
        proposedText: "Super potent flower",
        categoryOrReason: "marketing"
      },
      assertedBy: "author-1"
    });
    const manualResult = evaluateClaimEligibility({
      ...base,
      revision: manualRev,
      links: []
    });
    expect(manualResult.provenanceCategory).toBe("manual_unverified");
    expect(manualResult.provenanceCategory).not.toBe("lab_reported");
  });

  // Acceptance 4: Approval impossible with no evidence, unknown units, cross-client, stale revision, mismatched scope
  it("blocks approval when evidence link set is empty", () => {
    const base = makeBaselineSnapshot();
    const result = evaluateClaimEligibility({ ...base, links: [] });
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "EVIDENCE_LINKS_MISSING")).toBe(true);
  });

  it("blocks approval when sample_only CoA report is used for lot-attributed claim", () => {
    const base = makeBaselineSnapshot();
    const lotWideRev = createProductClaimRevision({
      clientId,
      claimId,
      revision: 1,
      batchId: batchLotA,
      canonicalKind: "certificate_panel_measurement",
      proofCategory: "coa_measurement_backed",
      parameters: {
        kind: "certificate_panel_measurement",
        measurements: [
          {
            analyte: "Total Terpenes",
            exactDecimalValue: normalizeDecimalString("7.00"),
            unit: "percent_w_w",
            quantityKind: "mass_fraction",
            basis: "dry_weight",
            context: "flower",
            requiredScope: "attributed_lot"
          }
        ]
      },
      assertedBy: "author-1"
    });

    const result = evaluateClaimEligibility({
      ...base,
      revision: lotWideRev
    });
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "SCOPE_INSUFFICIENT")).toBe(true);
  });

  it("blocks approval when measurement is below_limit instead of quantified", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          coaMeasurement: {
            ...base.links[0]!.coaMeasurement!,
            resultKind: "below_limit",
            resultValue: null
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "MEASUREMENT_MISMATCH")).toBe(true);
  });

  it("blocks approval when display wording contains forbidden medical claims or superlatives", () => {
    const base = makeBaselineSnapshot();
    const wordingRev = createProductClaimRevision({
      ...base.revision,
      displayWording: "Guaranteed to cure anxiety with 100% pure terpenes"
    });

    const result = evaluateClaimEligibility({ ...base, revision: wordingRev });
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "UNSUPPORTED_PROMOTIONAL_COPY")).toBe(true);
  });

  it("blocks approval for cross-client references", () => {
    const otherClient = createClientId("018f6f00-9999-7000-8000-000000000001");
    const base = makeBaselineSnapshot();
    const result = evaluateClaimEligibility({
      ...base,
      sku: { ...base.sku, clientId: otherClient }
    });
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "TENANT_MISMATCH")).toBe(true);
  });

  it("blocks claim when panel measurement analyte matches but quantityKind mismatches", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          coaMeasurement: {
            ...base.links[0]!.coaMeasurement!,
            quantityKind: "volume_fraction"
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "MEASUREMENT_MISMATCH")).toBe(true);
  });

  it("blocks claim when labVerificationEvent is withdrawn", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          coaReportRevision: {
            ...base.links[0]!.coaReportRevision!,
            verifiedLabIdentityEventId: "lab-event-1"
          },
          labVerificationEvent: {
            eventId: "lab-event-1",
            outcome: "verified",
            factScope: "lab_identity",
            verificationKind: "iso_17025_accreditation",
            isWithdrawn: true
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "VERIFICATION_WITHDRAWN")).toBe(true);
  });

  it("blocks claim when non-CoA attestation reliedVerificationEvent is withdrawn", () => {
    const base = makeBaselineSnapshot();
    const partnerRev = createProductClaimRevision({
      clientId,
      claimId,
      revision: 1,
      batchId: batchLotA,
      canonicalKind: "cultivation_processing_lineage",
      proofCategory: "production_record_backed",
      parameters: {
        kind: "cultivation_processing_lineage",
        operationCode: "OP-PARTNER",
        originKind: "partner_origin",
        attributedParty: "Emerald Hills Partner Farm",
        claimedFacts: ["Living Soil Cultivation"]
      },
      assertedBy: "author-1"
    });
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      revision: partnerRev,
      links: [
        {
          ...base.links[0]!,
          link: {
            ...base.links[0]!.link,
            measurementId: null,
            supportRole: "corroborating_record",
            attestation: {
              factKind: "operation_lineage",
              factValue: "Living Soil Cultivation",
              fieldLocator: "SOP-12",
              attribution: "Emerald Hills Partner Farm",
              actorId: "attester-1",
              occurredAt: "2026-10-18T12:00:00.000Z",
              verificationEventId: createVerificationEventId("018f6f00-0000-7000-8000-000000000099")
            }
          },
          evidenceRevision: {
            ...base.links[0]!.evidenceRevision!,
            sourceClass: "process_record"
          },
          reliedVerificationEvent: {
            eventId: "018f6f00-0000-7000-8000-000000000099",
            outcome: "verified",
            isWithdrawn: true
          },
          coaReport: null,
          coaReportRevision: null,
          coaReviewEvent: null,
          coaMeasurement: null
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "VERIFICATION_WITHDRAWN")).toBe(true);
  });

  it("blocks claim when evidenceRevision sourceObjectId mismatches link sourceObjectId", () => {
    const otherSourceObjectId = createSourceObjectId("018f6f00-9999-7000-8000-000000000099");
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      links: [
        {
          ...base.links[0]!,
          evidenceRevision: {
            ...base.links[0]!.evidenceRevision!,
            sourceObjectId: otherSourceObjectId
          }
        }
      ]
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "SOURCE_NOT_FOUND")).toBe(true);
  });

  it("blocks claim and prevents review request when claim revision is superseded", () => {
    const base = makeBaselineSnapshot();
    const snapshot: ClaimEligibilitySnapshot = {
      ...base,
      claim: {
        ...base.claim,
        currentRevision: 2
      }
    };

    const result = evaluateClaimEligibility(snapshot);
    expect(result.supportEligible).toBe(false);
    expect(result.canRequestReview).toBe(false);
    expect(result.evidenceLinkApproved).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "SOURCE_SUPERSEDED")).toBe(true);
  });

  it("preserves manual_review_required for valid non-promotional display wording", () => {
    const base = makeBaselineSnapshot();
    const wordingRev = createProductClaimRevision({
      ...base.revision,
      displayWording: "Laboratory confirmed 7.00% total terpenes"
    });

    const result = evaluateClaimEligibility({ ...base, revision: wordingRev });
    expect(result.supportEligible).toBe(true);
    expect(result.displayWordingStatus).toBe("manual_review_required");
  });

  it("blocks claim when non-measurement claim links a measurement", () => {
    const base = makeBaselineSnapshot();
    const dateRev = createProductClaimRevision({
      clientId,
      claimId,
      revision: 1,
      batchId: batchLotA,
      canonicalKind: "packaged_or_harvest_date",
      proofCategory: "production_record_backed",
      parameters: {
        kind: "packaged_or_harvest_date",
        dateKind: "packaged_on",
        dateValue: "2026-10-15",
        reportedPrecision: "date"
      },
      assertedBy: "author-1"
    });

    const result = evaluateClaimEligibility({
      ...base,
      revision: dateRev
    });
    expect(result.supportEligible).toBe(false);
    expect(result.blockReasons.some((r) => r.code === "UNSUPPORTED_CLAIM_FAMILY")).toBe(true);
  });
});
