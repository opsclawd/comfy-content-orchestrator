/**
 * Deterministic, fail-closed eligibility evaluator for batch-scoped product claims.
 *
 * Sink-pure domain module: zero database or network calls.
 * Reused across link-sealing, review-approval, and read-plane projection.
 */

import {
  compareDecimalStrings,
  CLAIM_POLICY_VERSION,
  type ClaimBlockReason,
  type ClaimBlockReasonCode,
  type ClaimProvenanceCategory,
  type IsoTimestampString
} from "@cco/shared";
import type {
  BatchId,
  ClientId,
  CoaMeasurementId,
  CoaReportId,
  DerivativeId,
  EvidenceId,
  SkuId,
  SourceObjectId
} from "./identifiers.js";
import type {
  ClaimDecisionEvent,
  ClaimEvidenceLink,
  ProductClaim,
  ProductClaimRevision
} from "./product-claim.js";

// ============================================================================
// Snapshot Inputs
// ============================================================================

export interface EvidenceVerificationSnapshot {
  readonly eventId: string;
  readonly outcome: "verified" | "rejected" | "disputed" | "withdrawn";
  readonly withdrawalEventId?: string | null | undefined;
  readonly factScope?: string | undefined;
  readonly verificationKind?: string | undefined;
  readonly isWithdrawn?: boolean | undefined;
}

export interface LinkDependencySnapshot {
  readonly link: ClaimEvidenceLink;
  readonly evidenceAsset: {
    readonly evidenceId: EvidenceId;
    readonly clientId: ClientId;
    readonly currentRevision: number;
    readonly archivedAt: IsoTimestampString | null;
  } | null;
  readonly evidenceRevision: {
    readonly evidenceId: EvidenceId;
    readonly revision: number;
    readonly sourceObjectId: SourceObjectId;
    readonly sourceClass: string;
    readonly captureDate?: string | null | undefined;
  } | null;
  readonly sourceObject: {
    readonly sourceObjectId: SourceObjectId;
    readonly clientId: ClientId;
    readonly originalSha256: string;
    readonly availability: string;
  } | null;
  readonly batchEvidenceLinkExists: boolean;
  readonly disputes: readonly EvidenceVerificationSnapshot[];
  readonly reliedVerificationEvent?: EvidenceVerificationSnapshot | null | undefined;
  readonly coaReport?:
    | {
        readonly reportId: CoaReportId;
        readonly clientId: ClientId;
        readonly batchId: BatchId;
        readonly currentRevision: number;
        readonly archivedAt: IsoTimestampString | null;
      }
    | null
    | undefined;
  readonly coaReportRevision?:
    | {
        readonly reportId: CoaReportId;
        readonly revision: number;
        readonly completenessStatus: "draft" | "complete";
        readonly scopeKind?: "sample_only" | "attributed_lot" | null | undefined;
        readonly verifiedLabIdentityEventId?: string | null | undefined;
      }
    | null
    | undefined;
  readonly coaReviewEvent?:
    | {
        readonly decision: "approved" | "rejected";
        readonly assessedScope: "sample_only" | "attributed_lot";
      }
    | null
    | undefined;
  readonly coaMeasurement?:
    | {
        readonly measurementId: CoaMeasurementId;
        readonly analyte: string;
        readonly resultKind: "quantified" | "below_limit" | "not_detected";
        readonly resultValue?: string | null | undefined;
        readonly unit: string;
        readonly quantityKind: string;
        readonly basis: string;
        readonly context: string;
      }
    | null
    | undefined;
  readonly labVerificationEvent?:
    | {
        readonly eventId: string;
        readonly outcome: string;
        readonly factScope: string;
        readonly verificationKind: string;
        readonly isWithdrawn?: boolean | undefined;
      }
    | null
    | undefined;
  readonly derivativeAsset?:
    | {
        readonly assetId: DerivativeId | string;
        readonly archivedAt: IsoTimestampString | null;
      }
    | null
    | undefined;
}

export interface ClaimEligibilitySnapshot {
  readonly claim: ProductClaim;
  readonly revision: ProductClaimRevision;
  readonly sku: {
    readonly skuId: SkuId;
    readonly clientId: ClientId;
    readonly archivedAt: IsoTimestampString | null;
  };
  readonly batch: {
    readonly batchId: BatchId;
    readonly skuId: SkuId;
    readonly clientId: ClientId;
    readonly lotIdentifier: string;
    readonly currentFactsRevision: number;
    readonly archivedAt: IsoTimestampString | null;
  };
  readonly links: readonly LinkDependencySnapshot[];
  readonly reviewEvent?: ClaimDecisionEvent | null | undefined;
}

// ============================================================================
// Evaluation Output
// ============================================================================

export interface ClaimEligibilityResult {
  readonly supportEligible: boolean;
  readonly canRequestReview: boolean;
  readonly evidenceLinkApproved: boolean;
  readonly blockReasons: readonly ClaimBlockReason[];
  readonly provenanceCategory: ClaimProvenanceCategory;
  readonly displayWordingStatus: "none" | "manual_review_required" | "manual_review_approved";
}

// Words/phrases indicating unsupported medical, effect, or superlative assertions
const FORBIDDEN_PROMOTIONAL_REGEX =
  /\b(cures?|treats?|healing|heals?|miracle|guaranteed|100%\s*pure|zero\s*pesticides?|pesticide[- ]free|best\s*in\s*class|superior)\b/i;

export function evaluateClaimEligibility(
  snapshot: ClaimEligibilitySnapshot
): ClaimEligibilityResult {
  const blockReasons: ClaimBlockReason[] = [];
  const addBlock = (code: ClaimBlockReasonCode, message: string, dependencyId?: string) => {
    blockReasons.push({ code, message, dependencyId });
  };

  const { claim, revision, sku, batch, links, reviewEvent } = snapshot;

  // 1. Cross-tenant boundaries
  if (
    sku.clientId !== claim.clientId ||
    batch.clientId !== claim.clientId ||
    revision.clientId !== claim.clientId
  ) {
    addBlock("TENANT_MISMATCH", "Cross-tenant identifier mismatch between claim, SKU, or batch.");
  }
  if (batch.skuId !== sku.skuId || claim.skuId !== sku.skuId) {
    addBlock("SKU_MISMATCH", "Batch or claim does not belong to declared SKU.");
  }
  if (claim.batchId !== batch.batchId || revision.batchId !== batch.batchId) {
    addBlock("BATCH_MISMATCH", "Claim or revision does not belong to declared batch.");
  }

  // Policy version check
  if (revision.policyVersion !== CLAIM_POLICY_VERSION) {
    addBlock(
      "UNSUPPORTED_CLAIM_FAMILY",
      `Unsupported claim policy version "${revision.policyVersion}". Expected "${CLAIM_POLICY_VERSION}".`
    );
  }

  // Revision supersession check
  const isCurrentRevision = revision.revision === claim.currentRevision;
  if (!isCurrentRevision) {
    addBlock(
      "SOURCE_SUPERSEDED",
      `Claim revision ${revision.revision} is superseded by current revision ${claim.currentRevision}.`
    );
  }

  // 2. Parent active hierarchy
  if (sku.archivedAt !== null) {
    addBlock("PARENT_ARCHIVED", "Parent Product SKU is archived.", sku.skuId);
  }
  if (batch.archivedAt !== null) {
    addBlock("PARENT_ARCHIVED", "Parent Product Batch is archived.", batch.batchId);
  }

  // 3. Terminal state check on claim revision
  if (isCurrentRevision) {
    if (claim.state === "invalidated") {
      addBlock(
        "CLAIM_INVALIDATED",
        `Claim revision is invalidated: ${claim.invalidationCause ?? "unknown reason"}`
      );
    }
    if (claim.state === "rejected") {
      addBlock(
        "CLAIM_REVIEW_REJECTED",
        "Claim revision was rejected by human compliance reviewer."
      );
    }
  } else {
    if (reviewEvent?.decision === "invalidate") {
      addBlock("CLAIM_INVALIDATED", `Claim revision was invalidated: ${reviewEvent.reason}`);
    } else if (reviewEvent?.decision === "reject") {
      addBlock(
        "CLAIM_REVIEW_REJECTED",
        "Claim revision was rejected by human compliance reviewer."
      );
    }
  }

  // 4. Unsupported or freeform claims
  if (revision.canonicalKind === "unsupported_manual") {
    addBlock(
      "UNSUPPORTED_CLAIM_FAMILY",
      "Manual and free-form assertions remain draft/manual-review only; autonomous approval is prohibited."
    );
  }
  if (revision.proofCategory === "human_attested_unverified") {
    addBlock(
      "UNSUPPORTED_CLAIM_FAMILY",
      "Unverified human-attested claims remain manual-review only; autonomous approval is prohibited."
    );
  }

  // 5. Display wording inspection
  let displayWordingStatus: "none" | "manual_review_required" | "manual_review_approved" = "none";
  if (revision.displayWording) {
    displayWordingStatus = "manual_review_required";
    if (FORBIDDEN_PROMOTIONAL_REGEX.test(revision.displayWording)) {
      addBlock(
        "UNSUPPORTED_PROMOTIONAL_COPY",
        "Display wording contains unsupported medical, effect, or unverifiable superlative assertions."
      );
    }
  }

  // 6. Evidence Link set validation
  if (links.length === 0) {
    addBlock("EVIDENCE_LINKS_MISSING", "Claim revision has zero linked evidence assets.");
  }

  // Determine provenance category based on links and proof
  const provenanceCategory: ClaimProvenanceCategory = deriveProvenanceCategory(revision, links);

  for (const item of links) {
    const { link, evidenceAsset, evidenceRevision, sourceObject } = item;

    // Check link tenant & batch
    if (link.clientId !== claim.clientId) {
      addBlock("TENANT_MISMATCH", "Evidence link belongs to a different client.", link.evidenceId);
    }
    if (link.batchId !== claim.batchId) {
      addBlock(
        "BATCH_MISMATCH",
        "Evidence link does not reference the claim batch.",
        link.evidenceId
      );
    }
    if (!item.batchEvidenceLinkExists) {
      addBlock("BATCH_MISMATCH", "Evidence asset is not linked to batch.", link.evidenceId);
    }

    // Source object integrity and availability
    if (!sourceObject) {
      addBlock("SOURCE_NOT_FOUND", "Underlying SourceObject does not exist.", link.sourceObjectId);
    } else {
      if (sourceObject.originalSha256 !== link.sourceSha256) {
        addBlock(
          "SOURCE_DIGEST_MISMATCH",
          `Source SHA-256 digest "${sourceObject.originalSha256}" does not match pinned digest "${link.sourceSha256}".`,
          link.sourceObjectId
        );
      }
      if (sourceObject.availability === "quarantined") {
        addBlock("SOURCE_QUARANTINED", "Source object is quarantined.", link.sourceObjectId);
      } else if (
        sourceObject.availability === "archived" ||
        sourceObject.availability === "deleted_under_retention"
      ) {
        addBlock(
          "SOURCE_ARCHIVED",
          "Source object is archived or deleted under retention.",
          link.sourceObjectId
        );
      }
    }

    // Evidence Asset state and revision pinning
    if (!evidenceAsset) {
      addBlock("SOURCE_NOT_FOUND", "Parent EvidenceAsset does not exist.", link.evidenceId);
    } else {
      if (evidenceAsset.archivedAt !== null) {
        addBlock("SOURCE_ARCHIVED", "Evidence asset is archived.", link.evidenceId);
      }
      if (evidenceAsset.currentRevision !== link.evidenceRevision) {
        addBlock(
          "SOURCE_SUPERSEDED",
          `Evidence asset current revision ${evidenceAsset.currentRevision} has superseded pinned revision ${link.evidenceRevision}.`,
          link.evidenceId
        );
      }
    }

    if (!evidenceRevision) {
      addBlock("SOURCE_NOT_FOUND", "Pinned EvidenceRevision does not exist.", link.evidenceId);
    } else {
      if (evidenceRevision.sourceObjectId !== link.sourceObjectId) {
        addBlock(
          "SOURCE_NOT_FOUND",
          `Evidence revision sourceObjectId "${evidenceRevision.sourceObjectId}" does not match linked sourceObjectId "${link.sourceObjectId}".`,
          link.sourceObjectId
        );
      }
    }

    // Active disputes check
    const activeDisputes = new Set<string>();
    for (const d of item.disputes) {
      if (d.outcome === "disputed" || d.outcome === "rejected") {
        activeDisputes.add(d.eventId);
      } else if (d.outcome === "withdrawn" && d.withdrawalEventId) {
        activeDisputes.delete(d.withdrawalEventId);
      }
    }
    if (activeDisputes.size > 0) {
      addBlock(
        "SOURCE_DISPUTED",
        "Evidence revision has active dispute or rejection event.",
        link.evidenceId
      );
    }

    // Relied-on verification event check
    if (link.attestation) {
      if (!link.attestation.verificationEventId) {
        addBlock(
          "VERIFICATION_MISSING",
          "Source fact attestation requires an active positive verification event reference."
        );
      } else if (!item.reliedVerificationEvent) {
        addBlock(
          "VERIFICATION_MISSING",
          "Relied-on verification event not found.",
          link.attestation.verificationEventId
        );
      } else if (
        item.reliedVerificationEvent.outcome !== "verified" ||
        item.reliedVerificationEvent.isWithdrawn === true
      ) {
        addBlock(
          "VERIFICATION_WITHDRAWN",
          "Relied-on verification event is not verified or has been withdrawn.",
          link.attestation.verificationEventId
        );
      }
    }

    // Pinned facts revision
    if (link.pinnedFactsRevision !== null && link.pinnedFactsRevision !== undefined) {
      if (batch.currentFactsRevision !== link.pinnedFactsRevision) {
        addBlock(
          "FACTS_SUPERSEDED",
          `Batch facts revision has advanced to ${batch.currentFactsRevision} (pinned: ${link.pinnedFactsRevision}).`,
          batch.batchId
        );
      }
    }

    // Derivative asset
    if (item.derivativeAsset && item.derivativeAsset.archivedAt !== null) {
      addBlock(
        "SOURCE_ARCHIVED",
        "Pinned visual reference derivative is archived.",
        String(item.derivativeAsset.assetId)
      );
    }

    // Analytical CoA measurement link checks
    if (link.measurementId) {
      if (revision.canonicalKind !== "certificate_panel_measurement") {
        addBlock(
          "UNSUPPORTED_CLAIM_FAMILY",
          `Measurement links are only permitted on certificate_panel_measurement claims, but got ${revision.canonicalKind}.`,
          link.evidenceId
        );
      }
      if (link.supportRole !== "primary_measurement") {
        addBlock(
          "MEASUREMENT_MISMATCH",
          `Measurement links must have supportRole 'primary_measurement', got '${link.supportRole}'.`,
          link.evidenceId
        );
      }
      validateCoaMeasurementLink(item, revision, addBlock, claim);
    } else {
      if (link.supportRole === "primary_measurement") {
        addBlock(
          "MEASUREMENT_MISMATCH",
          "Evidence links with supportRole 'primary_measurement' must provide a measurementId.",
          link.evidenceId
        );
      }
    }
  }

  // 7. Proposition correspondence checks
  validatePropositionCorrespondence(snapshot, addBlock);

  // 8. Overall states
  const supportEligible = blockReasons.length === 0;
  const canRequestReview =
    supportEligible &&
    isCurrentRevision &&
    revision.canonicalKind !== "unsupported_manual" &&
    claim.state === "evidence_linked";
  const evidenceLinkApproved =
    supportEligible &&
    isCurrentRevision &&
    claim.state === "reviewer_approved" &&
    reviewEvent?.decision === "approve";

  return {
    supportEligible,
    canRequestReview,
    evidenceLinkApproved,
    blockReasons,
    provenanceCategory,
    displayWordingStatus
  };
}

function deriveProvenanceCategory(
  revision: ProductClaimRevision,
  links: readonly LinkDependencySnapshot[]
): ClaimProvenanceCategory {
  if (
    revision.proofCategory === "human_attested_unverified" ||
    revision.canonicalKind === "unsupported_manual"
  ) {
    return "manual_unverified";
  }
  if (links.length === 0) {
    return "manual_unverified";
  }

  if (revision.canonicalKind === "certificate_panel_measurement") {
    const hasMeasurement = links.some((l) => Boolean(l.link.measurementId));
    if (hasMeasurement) {
      return "lab_reported";
    }
    return "manual_unverified";
  }

  if (revision.canonicalKind === "cultivation_processing_lineage") {
    if (
      revision.parameters.kind === "cultivation_processing_lineage" &&
      revision.parameters.originKind === "partner_origin"
    ) {
      return "partner_process_record";
    }
    return "operator_attested_sop";
  }

  const hasPhoto = links.some(
    (l) =>
      l.evidenceRevision?.sourceClass === "photo" || l.evidenceRevision?.sourceClass === "video"
  );
  if (hasPhoto) {
    return "source_photo";
  }

  return "operator_attested_sop";
}

function validateCoaMeasurementLink(
  item: LinkDependencySnapshot,
  revision: ProductClaimRevision,
  addBlock: (code: ClaimBlockReasonCode, message: string, id?: string) => void,
  claim: ProductClaim
): void {
  const {
    link,
    coaReport,
    coaReportRevision,
    coaReviewEvent,
    coaMeasurement,
    labVerificationEvent
  } = item;

  if (!coaReport) {
    addBlock(
      "SOURCE_NOT_FOUND",
      "Underlying CoA report does not exist.",
      link.reportId ? String(link.reportId) : undefined
    );
    return;
  }
  if (coaReport.clientId !== claim.clientId) {
    addBlock(
      "TENANT_MISMATCH",
      `CoA report clientId "${coaReport.clientId}" does not match claim clientId "${claim.clientId}".`,
      String(coaReport.reportId)
    );
  }
  if (coaReport.batchId !== claim.batchId) {
    addBlock(
      "BATCH_MISMATCH",
      `CoA report batchId "${coaReport.batchId}" does not match claim batchId "${claim.batchId}".`,
      String(coaReport.reportId)
    );
  }
  if (coaReport.archivedAt !== null) {
    addBlock("SOURCE_ARCHIVED", "Underlying CoA report is archived.", String(coaReport.reportId));
  }
  if (coaReport.currentRevision !== link.reportRevision) {
    addBlock(
      "SOURCE_SUPERSEDED",
      `CoA report current revision ${coaReport.currentRevision} has superseded pinned revision ${link.reportRevision}.`,
      String(coaReport.reportId)
    );
  }

  if (!coaReportRevision) {
    addBlock(
      "SOURCE_NOT_FOUND",
      "CoA report revision does not exist.",
      link.reportId ? String(link.reportId) : undefined
    );
    return;
  }
  if (coaReportRevision.completenessStatus !== "complete") {
    addBlock(
      "REPORT_DRAFT_INCOMPLETE",
      "CoA report revision is draft/incomplete.",
      String(coaReport.reportId)
    );
  }

  if (!coaReviewEvent) {
    addBlock(
      "REPORT_NOT_APPROVED",
      "CoA report has not received compliance review approval.",
      String(coaReport.reportId)
    );
  } else if (coaReviewEvent.decision !== "approved") {
    addBlock(
      "REPORT_REJECTED",
      "CoA report was rejected during compliance review.",
      String(coaReport.reportId)
    );
  }

  // Lab identity corroboration if referenced
  if (coaReportRevision.verifiedLabIdentityEventId) {
    if (
      !labVerificationEvent ||
      labVerificationEvent.isWithdrawn ||
      labVerificationEvent.outcome !== "verified"
    ) {
      addBlock(
        "VERIFICATION_WITHDRAWN",
        "Referenced accredited laboratory verification event has been withdrawn or is unverified.",
        coaReportRevision.verifiedLabIdentityEventId
      );
    }
  }

  if (!coaMeasurement) {
    addBlock(
      "MEASUREMENT_NOT_FOUND",
      "Pinned analytical measurement does not exist.",
      link.measurementId ? String(link.measurementId) : undefined
    );
    return;
  }

  if (coaMeasurement.resultKind !== "quantified") {
    addBlock(
      "MEASUREMENT_MISMATCH",
      `Analytical measurement result is "${coaMeasurement.resultKind}", which cannot support a quantified numerical claim.`,
      String(coaMeasurement.measurementId)
    );
    return;
  }
  if (!coaMeasurement.resultValue || compareDecimalStrings(coaMeasurement.resultValue, "0") < 0) {
    addBlock(
      "MEASUREMENT_MISMATCH",
      "Analytical measurement value is negative or missing.",
      String(coaMeasurement.measurementId)
    );
    return;
  }

  // Scope check against panel requirement
  if (
    revision.canonicalKind === "certificate_panel_measurement" &&
    revision.parameters.kind === "certificate_panel_measurement"
  ) {
    const requiredItem = revision.parameters.measurements.find(
      (m) =>
        m.analyte.toLowerCase() === coaMeasurement.analyte.toLowerCase() &&
        m.quantityKind === coaMeasurement.quantityKind
    );
    if (!requiredItem) {
      addBlock(
        "MEASUREMENT_MISMATCH",
        `Linked measurement "${coaMeasurement.analyte}" (${coaMeasurement.quantityKind}) does not match any declared panel item.`,
        String(coaMeasurement.measurementId)
      );
      return;
    }

    if (
      requiredItem.requiredScope === "attributed_lot" &&
      coaReviewEvent?.assessedScope === "sample_only"
    ) {
      addBlock(
        "SCOPE_INSUFFICIENT",
        `Report assessed scope is "sample_only", which cannot support lot-attributed claim for ${requiredItem.analyte}.`,
        String(coaReport.reportId)
      );
    }
    if (requiredItem.unit !== coaMeasurement.unit) {
      addBlock(
        "MEASUREMENT_MISMATCH",
        `Unit mismatch for ${requiredItem.analyte}: claimed "${requiredItem.unit}", measured "${coaMeasurement.unit}".`,
        String(coaMeasurement.measurementId)
      );
    }
    if (requiredItem.basis !== coaMeasurement.basis) {
      addBlock(
        "MEASUREMENT_MISMATCH",
        `Basis mismatch for ${requiredItem.analyte}: claimed "${requiredItem.basis}", measured "${coaMeasurement.basis}".`,
        String(coaMeasurement.measurementId)
      );
    }
    if (requiredItem.context !== coaMeasurement.context) {
      addBlock(
        "MEASUREMENT_MISMATCH",
        `Context mismatch for ${requiredItem.analyte}: claimed "${requiredItem.context}", measured "${coaMeasurement.context}".`,
        String(coaMeasurement.measurementId)
      );
    }
    if (
      compareDecimalStrings(requiredItem.exactDecimalValue, coaMeasurement.resultValue ?? "") !== 0
    ) {
      addBlock(
        "MEASUREMENT_MISMATCH",
        `Value mismatch for ${requiredItem.analyte}: claimed "${requiredItem.exactDecimalValue}", measured "${coaMeasurement.resultValue}".`,
        String(coaMeasurement.measurementId)
      );
    }
  }
}

function validatePropositionCorrespondence(
  snapshot: ClaimEligibilitySnapshot,
  addBlock: (code: ClaimBlockReasonCode, message: string, id?: string) => void
): void {
  const { revision, batch, links } = snapshot;

  switch (revision.canonicalKind) {
    case "factual_lot_identifier": {
      if (revision.parameters.kind === "factual_lot_identifier") {
        if (revision.parameters.lotIdentifier !== batch.lotIdentifier) {
          addBlock(
            "SOURCE_FACT_MISMATCH",
            `Claimed lotIdentifier "${revision.parameters.lotIdentifier}" does not match batch lot "${batch.lotIdentifier}".`
          );
        }
        const hasAttestation = links.some(
          (l) =>
            l.link.attestation &&
            l.link.attestation.factKind === "lot_identifier" &&
            l.link.attestation.factValue === batch.lotIdentifier
        );
        if (!hasAttestation) {
          addBlock(
            "SOURCE_FACT_MISMATCH",
            "Batch row alone does not prove lot identifier source; pinned source attestation is required."
          );
        }
      }
      break;
    }
    case "packaged_or_harvest_date": {
      if (revision.parameters.kind === "packaged_or_harvest_date") {
        const { dateKind, dateValue } = revision.parameters;
        const matchingLink = links.find(
          (l) =>
            l.link.attestation &&
            l.link.attestation.factKind === dateKind &&
            l.link.attestation.factValue === dateValue
        );
        if (!matchingLink) {
          addBlock(
            "SOURCE_FACT_MISMATCH",
            `No pinned source fact attestation found corresponding to ${dateKind} "${dateValue}".`
          );
        }
      }
      break;
    }
    case "certificate_panel_measurement": {
      if (revision.parameters.kind === "certificate_panel_measurement") {
        const declaredItems = revision.parameters.measurements;
        const measurementLinks = links.filter((l) => Boolean(l.link.measurementId));

        for (const item of declaredItems) {
          const matchingLinks = measurementLinks.filter(
            (l) =>
              l.coaMeasurement &&
              l.coaMeasurement.analyte.toLowerCase() === item.analyte.toLowerCase() &&
              l.coaMeasurement.quantityKind === item.quantityKind
          );
          if (matchingLinks.length === 0) {
            addBlock(
              "MEASUREMENT_NOT_FOUND",
              `Panel analyte "${item.analyte}" (${item.quantityKind}) has no matching linked measurement.`
            );
          } else if (matchingLinks.length > 1) {
            addBlock(
              "MEASUREMENT_MISMATCH",
              `Panel analyte "${item.analyte}" (${item.quantityKind}) matches multiple linked measurements (1-to-1 required).`
            );
          }
        }

        for (const l of measurementLinks) {
          if (l.coaMeasurement) {
            const matchesDeclared = declaredItems.some(
              (m) =>
                m.analyte.toLowerCase() === l.coaMeasurement!.analyte.toLowerCase() &&
                m.quantityKind === l.coaMeasurement!.quantityKind
            );
            if (!matchesDeclared) {
              addBlock(
                "MEASUREMENT_MISMATCH",
                `Linked measurement "${l.coaMeasurement.analyte}" (${l.coaMeasurement.quantityKind}) does not correspond to any declared panel item.`,
                String(l.coaMeasurement.measurementId)
              );
            }
          }
        }
      }
      break;
    }
    case "cultivation_processing_lineage": {
      if (revision.parameters.kind === "cultivation_processing_lineage") {
        const params = revision.parameters;
        const matchingLink = links.find((l) => {
          const att = l.link.attestation;
          if (!att || att.factKind !== "operation_lineage") return false;
          if (l.evidenceRevision && l.evidenceRevision.sourceClass === "coa") return false;
          if (!att.fieldLocator || att.fieldLocator.trim().length === 0) return false;
          if (!att.factValue || att.factValue.trim().length === 0) return false;

          const matchesCode = att.factValue === params.operationCode;
          const matchesFact = params.claimedFacts.some((f: string) => f === att.factValue);
          if (!matchesCode && !matchesFact) return false;

          if (params.originKind === "partner_origin") {
            if (params.attributedParty && att.attribution !== params.attributedParty) {
              return false;
            }
          }
          return true;
        });

        if (!matchingLink) {
          addBlock(
            "SOURCE_FACT_MISMATCH",
            "Lineage claim requires a pinned operational source fact attestation corresponding to operationCode, claimedFacts, and attribution."
          );
        }
      }
      break;
    }
    case "logged_process_timing": {
      if (revision.parameters.kind === "logged_process_timing") {
        const params = revision.parameters;
        const matchingLink = links.find((l) => {
          const att = l.link.attestation;
          if (!att || att.factKind !== "process_timing") return false;
          if (l.evidenceRevision && l.evidenceRevision.sourceClass === "coa") return false;
          if (!att.fieldLocator || att.fieldLocator.trim().length === 0) return false;
          if (!att.factValue || att.factValue.trim().length === 0) return false;

          if (params.timingKind === "duration") {
            const dur = params.duration;
            if (dur && !att.factValue.includes(dur.value)) {
              return false;
            }
          } else if (params.timingKind === "timestamp_range") {
            const tr = params.timestampRange;
            if (tr && !att.factValue.includes(tr.start) && !att.factValue.includes(tr.end)) {
              return false;
            }
          }
          return true;
        });

        if (!matchingLink) {
          addBlock(
            "SOURCE_FACT_MISMATCH",
            "Logged timing claim requires a pinned process log attestation corresponding to operationName, duration, or timestampRange."
          );
        }
      }
      break;
    }
    case "unsupported_manual":
      break;
  }
}
