"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ClaimDateKind, ReportedCapturePrecision } from "@cco/shared";
import { generateUuidV7 } from "@cco/shared";
import type {
  AppendClaimRevisionHttpRequest,
  BatchFactsRevisionResponse,
  CanonicalClaimKindContract,
  ClaimInvalidationCauseContract,
  ClaimProofCategoryContract,
  ClaimSupportRoleContract,
  ClaimTimingKindContract,
  CreateClaimHttpRequest,
  DossierClaimItem,
  DossierCoaReportItem,
  DossierEvidenceItem,
  InvalidateClaimHttpRequest,
  LinkClaimEvidenceHttpRequest,
  ReviewClaimHttpRequest
} from "@cco/contracts";
import {
  appendClaimRevision,
  createProductClaim,
  invalidateClaim,
  linkClaimEvidence,
  reviewClaim,
  ProductEvidenceApiError
} from "../../api/product-evidence-client";
import { formatUtcDateTime } from "./format-decimal";
import {
  BlockedBadge,
  OperatorReviewedBadge,
  ReportedBadge,
  UnknownBadge
} from "./provenance-badges";

export interface ProductClaimsPanelProps {
  readonly clientId: string;
  readonly batchId: string;
  readonly claims: readonly DossierClaimItem[];
  readonly availableEvidence: readonly DossierEvidenceItem[];
  readonly availableCoas: readonly DossierCoaReportItem[];
  readonly factsHistory?: readonly BatchFactsRevisionResponse[];
  readonly onDossierUpdated: () => void;
  readonly isRefreshing?: boolean;
}

export function ProductClaimsPanel({
  clientId,
  batchId,
  claims,
  availableEvidence,
  availableCoas,
  factsHistory = [],
  onDossierUpdated,
  isRefreshing = false
}: ProductClaimsPanelProps): React.ReactElement {
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [showAppendModal, setShowAppendModal] = useState<{
    claimId: string;
    version: number;
    revision: number;
  } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState<{
    claimId: string;
    version: number;
    revision: number;
  } | null>(null);
  const [showInvalidateModal, setShowInvalidateModal] = useState<{
    claimId: string;
    version: number;
    revision: number;
  } | null>(null);
  const [showLinkModal, setShowLinkModal] = useState<{
    claimId: string;
    version: number;
    revision: number;
  } | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const proposeActionIdRef = useRef(generateUuidV7());
  const appendActionIdRef = useRef(generateUuidV7());
  const reviewActionIdRef = useRef(generateUuidV7());
  const invalidateActionIdRef = useRef(generateUuidV7());
  const linkActionIdRef = useRef(generateUuidV7());
  // Pins the attestation occurredAt timestamp for the life of the current
  // linkActionIdRef: a retry of an unedited payload must resend the exact
  // same attestation, not a fresh timestamp each attempt. Cleared whenever
  // linkActionIdRef rotates (new action) so the next attestation gets its
  // own timestamp.
  const linkAttestationOccurredAtRef = useRef<string | null>(null);

  // Propose / Append claim form state
  const [canonicalKind, setCanonicalKind] = useState<CanonicalClaimKindContract>(
    "certificate_panel_measurement"
  );
  const [proofCategory, setProofCategory] =
    useState<ClaimProofCategoryContract>("coa_measurement_backed");
  const [displayWording, setDisplayWording] = useState("");

  // Measurement claim fields
  const [analyte, setAnalyte] = useState("THC");
  const [exactDecimalValue, setExactDecimalValue] = useState("24.5000");
  const [unit, setUnit] = useState("percent");
  const [basis, setBasis] = useState("dry_weight");
  const [context, setContext] = useState("cannabinoid_profile");
  const [quantityKind, setQuantityKind] = useState("mass_fraction");
  const [requiredScope, setRequiredScope] = useState<"sample_only" | "attributed_lot">(
    "attributed_lot"
  );

  // Lot claim fields
  const [lotIdentifierInput, setLotIdentifierInput] = useState("");

  // Date claim fields
  const [dateKind, setDateKind] = useState<ClaimDateKind>("packaged_on");
  const [dateValue, setDateValue] = useState("");
  const [datePrecision, setDatePrecision] = useState<ReportedCapturePrecision>("date");

  // Lineage claim fields
  const [operationCode, setOperationCode] = useState("");
  const [originKind, setOriginKind] = useState<"own_production" | "partner_origin">(
    "own_production"
  );
  const [attributedParty, setAttributedParty] = useState("");
  const [claimedFacts, setClaimedFacts] = useState("");

  // Process timing claim fields
  const [operationName, setOperationName] = useState("");
  const [timingKind, setTimingKind] = useState<ClaimTimingKindContract>("duration");
  const [durationValue, setDurationValue] = useState("");
  const [durationUnit, setDurationUnit] = useState<"seconds" | "minutes" | "hours" | "days">(
    "days"
  );
  const [timestampStart, setTimestampStart] = useState("");
  const [timestampEnd, setTimestampEnd] = useState("");

  // Manual claim fields
  const [manualText, setManualText] = useState("");
  const [manualCategory, setManualCategory] = useState("custom_operator_claim");

  // Review form state
  const [reviewDecision, setReviewDecision] = useState<"approve" | "reject">("approve");
  const [reviewReason, setReviewReason] = useState("");

  // Invalidate form state
  const [invalidationCause, setInvalidationCause] =
    useState<ClaimInvalidationCauseContract>("source_superseded");
  const [invalidationReason, setInvalidationReason] = useState("");

  // Link Evidence form state
  const [linkEvidenceId, setLinkEvidenceId] = useState(
    availableEvidence[0]?.asset.evidenceId || ""
  );
  const [linkEvidenceRev, setLinkEvidenceRev] = useState(
    availableEvidence[0]?.asset.currentRevision || 1
  );
  const [linkSupportRole, setLinkSupportRole] =
    useState<ClaimSupportRoleContract>("primary_measurement");
  const [linkReportId, setLinkReportId] = useState(availableCoas[0]?.report.reportId || "");
  const [linkReportRev, setLinkReportRev] = useState(availableCoas[0]?.report.currentRevision || 1);
  const [linkMeasurementId, setLinkMeasurementId] = useState(
    availableCoas[0]?.currentRevision.measurements[0]?.measurementId || ""
  );
  const [linkFactsRev, setLinkFactsRev] = useState<string>("");
  const [includeAttestation, setIncludeAttestation] = useState(false);
  const [attestationFactKind, setAttestationFactKind] = useState("lot_identity");
  const [attestationFactValue, setAttestationFactValue] = useState("");
  const [attestationFieldLocator, setAttestationFieldLocator] = useState("");
  const [attestationAttribution, setAttestationAttribution] = useState("");
  const [attestationActorId, setAttestationActorId] = useState("");
  const [attestationVerificationEventId, setAttestationVerificationEventId] = useState("");

  // Auto-sync evidence and report selections when data loads
  useEffect(() => {
    const firstEv = availableEvidence[0];
    if (
      firstEv &&
      (!linkEvidenceId || !availableEvidence.some((ev) => ev.asset.evidenceId === linkEvidenceId))
    ) {
      setLinkEvidenceId(firstEv.asset.evidenceId);
      setLinkEvidenceRev(firstEv.asset.currentRevision);
    }
  }, [availableEvidence, linkEvidenceId]);

  useEffect(() => {
    const firstCoa = availableCoas[0];
    if (
      firstCoa &&
      (!linkReportId || !availableCoas.some((c) => c.report.reportId === linkReportId))
    ) {
      setLinkReportId(firstCoa.report.reportId);
      setLinkReportRev(firstCoa.report.currentRevision);
      if (firstCoa.currentRevision.measurements[0]) {
        setLinkMeasurementId(firstCoa.currentRevision.measurements[0].measurementId);
      }
      if (firstCoa.currentRevision.evidenceId) {
        setLinkEvidenceId(firstCoa.currentRevision.evidenceId);
        setLinkEvidenceRev(firstCoa.currentRevision.evidenceRevision);
      }
    }
  }, [availableCoas, linkReportId]);

  const buildClaimParameters = (): CreateClaimHttpRequest["parameters"] => {
    if (canonicalKind === "certificate_panel_measurement") {
      return {
        kind: "certificate_panel_measurement",
        measurements: [
          {
            analyte: analyte.trim(),
            exactDecimalValue: exactDecimalValue.trim(),
            unit: unit.trim(),
            quantityKind: quantityKind.trim(),
            basis: basis.trim(),
            context: context.trim(),
            requiredScope
          }
        ]
      };
    } else if (canonicalKind === "factual_lot_identifier") {
      return {
        kind: "factual_lot_identifier",
        lotIdentifier: lotIdentifierInput.trim()
      };
    } else if (canonicalKind === "packaged_or_harvest_date") {
      return {
        kind: "packaged_or_harvest_date",
        dateKind,
        dateValue: dateValue.trim(),
        reportedPrecision: datePrecision
      };
    } else if (canonicalKind === "cultivation_processing_lineage") {
      const facts = claimedFacts
        .split(/[\n,]+/)
        .map((f) => f.trim())
        .filter(Boolean);
      return {
        kind: "cultivation_processing_lineage",
        operationCode: operationCode.trim(),
        originKind,
        ...(attributedParty.trim() ? { attributedParty: attributedParty.trim() } : {}),
        claimedFacts: facts
      };
    } else if (canonicalKind === "logged_process_timing") {
      return {
        kind: "logged_process_timing",
        operationName: operationName.trim(),
        timingKind,
        ...(durationValue.trim()
          ? { duration: { value: durationValue.trim(), unit: durationUnit } }
          : {}),
        ...(timestampStart.trim() && timestampEnd.trim()
          ? { timestampRange: { start: timestampStart.trim(), end: timestampEnd.trim() } }
          : {})
      };
    } else {
      return {
        kind: "unsupported_manual",
        proposedText: manualText.trim(),
        categoryOrReason: manualCategory.trim()
      };
    }
  };

  const validateClaimForm = (): string | null => {
    if (canonicalKind === "cultivation_processing_lineage") {
      if (!operationCode.trim()) {
        return "Operation code is required for lineage claim.";
      }
      const facts = claimedFacts
        .split(/[\n,]+/)
        .map((f) => f.trim())
        .filter(Boolean);
      if (facts.length === 0) {
        return "At least one claimed fact is required for lineage claim.";
      }
    } else if (canonicalKind === "logged_process_timing") {
      if (!operationName.trim()) {
        return "Operation name is required for process timing claim.";
      }
      if (timingKind === "duration" && !durationValue.trim()) {
        return "Duration value is required for duration timing claim.";
      }
      if (timingKind === "timestamp_range" && (!timestampStart.trim() || !timestampEnd.trim())) {
        return "Both start and end timestamps are required for timestamp range claim.";
      }
    }
    return null;
  };

  const handleProposeClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    const validationErr = validateClaimForm();
    if (validationErr) {
      setFormError(validationErr);
      setIsSubmitting(false);
      return;
    }

    try {
      const parameters = buildClaimParameters();
      const actionId = proposeActionIdRef.current;
      const req: CreateClaimHttpRequest = {
        actionId,
        batchId,
        canonicalKind,
        proofCategory,
        parameters,
        ...(displayWording.trim() ? { displayWording: displayWording.trim() } : {})
      };

      await createProductClaim(clientId, batchId, req);
      proposeActionIdRef.current = generateUuidV7();
      setShowProposeModal(false);
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        onDossierUpdated();
      }
      setFormError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAppendRevision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAppendModal) return;
    setIsSubmitting(true);
    setFormError(null);

    const validationErr = validateClaimForm();
    if (validationErr) {
      setFormError(validationErr);
      setIsSubmitting(false);
      return;
    }

    try {
      const parameters = buildClaimParameters();
      const actionId = appendActionIdRef.current;
      const req: AppendClaimRevisionHttpRequest = {
        actionId,
        expectedVersion: showAppendModal.version,
        canonicalKind,
        proofCategory,
        parameters,
        ...(displayWording.trim() ? { displayWording: displayWording.trim() } : {})
      };

      await appendClaimRevision(clientId, batchId, showAppendModal.claimId, req);
      appendActionIdRef.current = generateUuidV7();
      setShowAppendModal(null);
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        // The modal's pinned expectedVersion is now stale; reload and
        // require a deliberate reopen rather than leaving the modal open
        // against a version that will only conflict again.
        onDossierUpdated();
        appendActionIdRef.current = generateUuidV7();
        setShowAppendModal(null);
        setFormError(
          "This claim was changed in the meantime. Reloaded the current state; please reopen to resubmit."
        );
        setIsSubmitting(false);
        return;
      }
      setFormError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showReviewModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const actionId = reviewActionIdRef.current;
      const req: ReviewClaimHttpRequest = {
        actionId,
        expectedVersion: showReviewModal.version,
        claimRevision: showReviewModal.revision,
        decision: reviewDecision,
        reason: reviewReason.trim()
      };
      await reviewClaim(clientId, batchId, showReviewModal.claimId, req);
      reviewActionIdRef.current = generateUuidV7();
      setShowReviewModal(null);
      setReviewReason("");
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        onDossierUpdated();
        reviewActionIdRef.current = generateUuidV7();
        setShowReviewModal(null);
        setFormError(
          "This claim was changed in the meantime. Reloaded the current state; please reopen review to resubmit."
        );
        setIsSubmitting(false);
        return;
      }
      setFormError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInvalidateClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showInvalidateModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const actionId = invalidateActionIdRef.current;
      const req: InvalidateClaimHttpRequest = {
        actionId,
        expectedVersion: showInvalidateModal.version,
        claimRevision: showInvalidateModal.revision,
        invalidationCause,
        reason: invalidationReason.trim()
      };
      await invalidateClaim(clientId, batchId, showInvalidateModal.claimId, req);
      invalidateActionIdRef.current = generateUuidV7();
      setShowInvalidateModal(null);
      setInvalidationReason("");
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        onDossierUpdated();
        invalidateActionIdRef.current = generateUuidV7();
        setShowInvalidateModal(null);
        setFormError(
          "This claim was changed in the meantime. Reloaded the current state; please reopen to resubmit."
        );
        setIsSubmitting(false);
        return;
      }
      setFormError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLinkEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showLinkModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const selectedEv = availableEvidence.find((ev) => ev.asset.evidenceId === linkEvidenceId);
      const rev =
        selectedEv?.revisions.find((r) => r.revision === Number(linkEvidenceRev)) ||
        selectedEv?.currentRevision;
      if (!rev) {
        setFormError(
          `Evidence revision ${linkEvidenceRev} not found for evidence ${linkEvidenceId}.`
        );
        setIsSubmitting(false);
        return;
      }
      const sourceObj = selectedEv?.sourceObjects.find(
        (s) => s.sourceObjectId === rev.sourceObjectId
      );
      if (!sourceObj) {
        setFormError(
          `Source object ${rev.sourceObjectId} for evidence ${linkEvidenceId} revision ${linkEvidenceRev} not found.`
        );
        setIsSubmitting(false);
        return;
      }

      if (linkSupportRole === "primary_measurement" && !linkMeasurementId.trim()) {
        setFormError("Primary measurement links must specify a measurement ID.");
        setIsSubmitting(false);
        return;
      }

      let attestation = undefined;
      if (includeAttestation && attestationFactValue.trim()) {
        if (linkAttestationOccurredAtRef.current === null) {
          linkAttestationOccurredAtRef.current = new Date().toISOString();
        }
        attestation = {
          factKind: attestationFactKind.trim() || "lot_identity",
          factValue: attestationFactValue.trim(),
          fieldLocator: attestationFieldLocator.trim() || "header",
          attribution: attestationAttribution.trim() || "Operator statement",
          actorId: attestationActorId.trim() || "operator-1",
          occurredAt: linkAttestationOccurredAtRef.current,
          ...(attestationVerificationEventId.trim()
            ? { verificationEventId: attestationVerificationEventId.trim() }
            : {})
        };
      }

      const actionId = linkActionIdRef.current;
      const req: LinkClaimEvidenceHttpRequest = {
        actionId,
        expectedVersion: showLinkModal.version,
        claimRevision: showLinkModal.revision,
        reason: "Linking supporting source evidence and measurement",
        links: [
          {
            evidenceId: linkEvidenceId,
            evidenceRevision: Number(linkEvidenceRev),
            sourceObjectId: sourceObj.sourceObjectId,
            sourceSha256: sourceObj.originalSha256,
            supportRole: linkSupportRole,
            ...(linkReportId
              ? { reportId: linkReportId, reportRevision: Number(linkReportRev) }
              : {}),
            ...(linkMeasurementId.trim() ? { measurementId: linkMeasurementId.trim() } : {}),
            ...(linkFactsRev.trim() ? { pinnedFactsRevision: Number(linkFactsRev.trim()) } : {}),
            ...(attestation ? { attestation } : {})
          }
        ]
      };

      await linkClaimEvidence(clientId, batchId, showLinkModal.claimId, req);
      linkActionIdRef.current = generateUuidV7();
      linkAttestationOccurredAtRef.current = null;
      setShowLinkModal(null);
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        onDossierUpdated();
        linkActionIdRef.current = generateUuidV7();
        linkAttestationOccurredAtRef.current = null;
        setShowLinkModal(null);
        setFormError(
          "This claim was changed in the meantime. Reloaded the current state; please reopen to resubmit."
        );
        setIsSubmitting(false);
        return;
      }
      setFormError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      id="product-claims-section"
      data-testid="product-claims-section"
      style={{ marginTop: "2rem" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem"
        }}
      >
        <div>
          <h2>Product Claims &amp; Proof Gates</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Factual assertions backed by verified measurements and photography. Blocks unverified
            copy.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowProposeModal(true);
          }}
          className="stage-draft-button"
          data-testid="propose-claim-button"
          style={{ padding: "0.4rem 0.8rem", fontSize: "0.875rem" }}
        >
          + Propose Claim
        </button>
      </div>

      {isRefreshing && (
        <div
          role="status"
          data-testid="claims-stale-banner"
          style={{
            padding: "0.5rem 0.75rem",
            marginBottom: "1rem",
            backgroundColor: "#fffbeb",
            color: "#92400e",
            borderRadius: "4px",
            fontSize: "0.85rem",
            border: "1px solid #fde68a"
          }}
        >
          Refreshing latest claims... Data may be temporarily stale.
        </div>
      )}

      {claims.length === 0 ? (
        <div
          data-testid="empty-claims-message"
          style={{ padding: "1.5rem", backgroundColor: "var(--bg-surface)", borderRadius: "8px" }}
        >
          <UnknownBadge detail="No product claims proposed" />
          <p style={{ marginTop: "0.5rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Propose a factual claim (e.g. chemical potency measurement, harvest date, or lot
            identity).
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {claims.map((item) => {
            const { claim, currentRevision, resolution } = item;
            const claimLinks = item.links ?? resolution.links ?? [];
            const claimEvents = item.decisionEvents ?? resolution.reviewEvents ?? [];
            const isEligible = resolution.supportEligible;

            return (
              <div
                key={claim.claimId}
                id={`claim-item-${claim.claimId}`}
                data-testid={`claim-item-${claim.claimId}`}
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderRadius: "8px",
                  padding: "1.25rem",
                  border: isEligible ? "1px solid #10b981" : "1px solid var(--border-subtle)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                    gap: "0.5rem"
                  }}
                >
                  <div>
                    <h3
                      style={{
                        fontSize: "1.05rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem"
                      }}
                    >
                      Claim: {currentRevision.canonicalKind}
                      {claim.state === "reviewer_approved" ? (
                        <OperatorReviewedBadge
                          isApproved={true}
                          detail="Approved"
                          testId={`claim-state-badge-${claim.claimId}`}
                        />
                      ) : (
                        <span
                          data-testid={`claim-state-badge-${claim.claimId}`}
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.4rem",
                            borderRadius: "4px",
                            fontWeight: 600,
                            backgroundColor:
                              claim.state === "invalidated"
                                ? "#450a0a"
                                : "var(--bg-surface-elevated)",
                            color: claim.state === "invalidated" ? "#fca5a5" : "var(--text-primary)"
                          }}
                        >
                          {claim.state}
                        </span>
                      )}
                    </h3>
                    <div
                      style={{
                        fontSize: "0.85rem",
                        color: "var(--text-secondary)",
                        marginTop: "0.25rem"
                      }}
                    >
                      Category: <strong>{currentRevision.proofCategory}</strong> • Resolved
                      Provenance: <strong>{resolution.provenanceCategory}</strong>
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        marginTop: "0.2rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        flexWrap: "wrap"
                      }}
                    >
                      <span>Asserted by:</span>
                      <ReportedBadge detail={currentRevision.assertedBy} />
                      <span>at {formatUtcDateTime(currentRevision.assertedAt)}</span>
                    </div>
                    {currentRevision.displayWording && (
                      <div
                        data-testid="claim-display-wording"
                        style={{
                          marginTop: "0.4rem",
                          fontSize: "0.9rem",
                          fontStyle: "italic",
                          color: "#38bdf8"
                        }}
                      >
                        &ldquo;{currentRevision.displayWording}&rdquo;
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {isEligible ? (
                      <span
                        data-testid="claim-eligible-badge"
                        style={{ color: "#10b981", fontWeight: 600, fontSize: "0.85rem" }}
                      >
                        ✓ Support Eligible
                      </span>
                    ) : (
                      <BlockedBadge detail="Support Blocked" testId="claim-blocked-badge" />
                    )}

                    <button
                      type="button"
                      data-testid={`append-claim-revision-button-${claim.claimId}`}
                      onClick={() => {
                        setFormError(null);
                        setShowAppendModal({
                          claimId: claim.claimId,
                          version: claim.version,
                          revision: claim.currentRevision
                        });
                      }}
                      style={{
                        padding: "0.3rem 0.6rem",
                        fontSize: "0.8rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-prominent)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        color: "var(--text-primary)",
                        cursor: "pointer"
                      }}
                    >
                      Correct Claim
                    </button>

                    <button
                      type="button"
                      data-testid={`link-evidence-button-${claim.claimId}`}
                      onClick={() => {
                        setFormError(null);
                        setShowLinkModal({
                          claimId: claim.claimId,
                          version: claim.version,
                          revision: claim.currentRevision
                        });
                      }}
                      style={{
                        padding: "0.3rem 0.6rem",
                        fontSize: "0.8rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-prominent)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        color: "var(--text-primary)",
                        cursor: "pointer"
                      }}
                    >
                      + Link Evidence
                    </button>

                    <button
                      type="button"
                      data-testid={`review-claim-button-${claim.claimId}`}
                      onClick={() => {
                        setFormError(null);
                        setShowReviewModal({
                          claimId: claim.claimId,
                          version: claim.version,
                          revision: claim.currentRevision
                        });
                      }}
                      style={{
                        padding: "0.3rem 0.6rem",
                        fontSize: "0.8rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-prominent)",
                        backgroundColor: "var(--bg-surface-elevated)",
                        color: "var(--text-primary)",
                        cursor: isRefreshing ? "not-allowed" : "pointer"
                      }}
                      disabled={isRefreshing}
                    >
                      Review Claim
                    </button>

                    {claim.state !== "invalidated" && (
                      <button
                        type="button"
                        data-testid={`invalidate-claim-button-${claim.claimId}`}
                        onClick={() => {
                          setFormError(null);
                          setShowInvalidateModal({
                            claimId: claim.claimId,
                            version: claim.version,
                            revision: claim.currentRevision
                          });
                        }}
                        style={{
                          padding: "0.3rem 0.6rem",
                          fontSize: "0.8rem",
                          borderRadius: "4px",
                          border: "1px solid var(--border-subtle)",
                          backgroundColor: "transparent",
                          color: "#ef4444",
                          cursor: "pointer"
                        }}
                      >
                        Invalidate
                      </button>
                    )}
                  </div>
                </div>

                {/* Resolution Block Reasons */}
                {resolution.blockReasons.length > 0 && (
                  <div
                    data-testid={`claim-block-reasons-${claim.claimId}`}
                    style={{
                      marginTop: "0.75rem",
                      padding: "0.6rem 0.75rem",
                      backgroundColor: "#450a0a",
                      borderRadius: "6px",
                      fontSize: "0.8rem",
                      color: "#fee2e2"
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                      Readiness Blocked:
                    </div>
                    <ul style={{ paddingLeft: "1.2rem", margin: 0 }}>
                      {resolution.blockReasons.map((br, idx) => (
                        <li key={idx} data-testid={`block-reason-${br.code}`}>
                          <strong>{br.code}</strong>
                          {br.dependencyId && (
                            <span
                              data-testid={`block-reason-dep-${br.code}`}
                              style={{ color: "var(--text-muted, #94a3b8)", marginLeft: "0.3rem" }}
                            >
                              ({br.dependencyId})
                            </span>
                          )}
                          : {br.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Supporting Evidence Links */}
                <div style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
                  <div
                    style={{
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      marginBottom: "0.25rem"
                    }}
                  >
                    Supporting Evidence ({claimLinks.length}):
                  </div>
                  {claimLinks.length === 0 ? (
                    <UnknownBadge detail="No supporting evidence linked" />
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      {claimLinks.map((link) => (
                        <div
                          key={link.linkId}
                          data-testid={`evidence-link-${link.linkId}`}
                          style={{
                            padding: "0.3rem 0.5rem",
                            backgroundColor: "var(--bg-surface-elevated)",
                            borderRadius: "4px",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            fontSize: "0.75rem",
                            flexWrap: "wrap"
                          }}
                        >
                          <ReportedBadge detail={link.supportRole} />
                          <a
                            href={`#evidence-revision-${link.evidenceId}-${link.evidenceRevision}`}
                            data-testid={`evidence-link-anchor-${link.linkId}`}
                            title={`Evidence ID: ${link.evidenceId}, Revision: ${link.evidenceRevision}`}
                            style={{ color: "#38bdf8", textDecoration: "underline" }}
                          >
                            Evidence: {link.evidenceId} (Rev {link.evidenceRevision})
                          </a>
                          {link.sourceSha256 && (
                            <span
                              style={{ color: "var(--text-secondary)" }}
                              title={`SHA-256: ${link.sourceSha256}`}
                            >
                              • SHA: <code>{link.sourceSha256.slice(0, 16)}…</code>
                            </span>
                          )}
                          {link.reportId && (
                            <a
                              href={`#coa-revision-${link.reportId}-${link.reportRevision || 1}`}
                              data-testid={`coa-link-anchor-${link.linkId}`}
                              title={`CoA Report ID: ${link.reportId}, Revision: ${link.reportRevision || 1}`}
                              style={{ color: "#38bdf8", textDecoration: "underline" }}
                            >
                              • CoA: {link.reportId}
                              {link.reportRevision ? ` (Rev ${link.reportRevision})` : ""}
                            </a>
                          )}
                          {link.measurementId && (
                            <a
                              href={`#measurement-row-${link.measurementId}`}
                              data-testid={`measurement-link-anchor-${link.linkId}`}
                              title={`Measurement ID: ${link.measurementId}`}
                              style={{ color: "#38bdf8", textDecoration: "underline" }}
                            >
                              • Meas: {link.measurementId}
                            </a>
                          )}
                          {link.pinnedFactsRevision && (
                            <span style={{ color: "var(--text-secondary)" }}>
                              • Facts Rev: {link.pinnedFactsRevision}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Decision Events / Review History */}
                {claimEvents.length > 0 && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)"
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Decision Events:</div>
                    {claimEvents.map((de) => (
                      <div
                        key={de.eventId}
                        data-testid={`claim-decision-${de.eventId}`}
                        style={{ padding: "0.15rem 0" }}
                      >
                        Decision: <strong>{de.decision}</strong> by {de.actorId} (
                        {formatUtcDateTime(de.occurredAt)}) • Reason: {de.reason}
                        {de.invalidationCause && (
                          <span> • Invalidation Cause: {de.invalidationCause}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Claim Revision History */}
                {item.revisions && item.revisions.length > 0 && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginBottom: "0.25rem"
                      }}
                    >
                      Claim Revision History ({item.revisions.length}):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                      {item.revisions.map((rev) => {
                        const isCurrent = rev.revision === currentRevision.revision;
                        return (
                          <div
                            key={rev.revision}
                            id={`claim-revision-${claim.claimId}-${rev.revision}`}
                            data-testid={`claim-revision-${claim.claimId}-${rev.revision}`}
                            style={{
                              padding: "0.4rem 0.6rem",
                              backgroundColor: "var(--bg-surface-elevated)",
                              borderRadius: "4px",
                              fontSize: "0.8rem",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: "0.5rem"
                            }}
                          >
                            <div>
                              <strong>Rev {rev.revision}</strong>{" "}
                              {isCurrent && (
                                <span style={{ color: "#10b981", fontSize: "0.75rem" }}>
                                  (Current)
                                </span>
                              )}
                              {" • "}
                              <span>Kind: {rev.canonicalKind}</span>
                              {" • "}
                              <span>Category: {rev.proofCategory}</span>
                              {" • "}
                              <span>
                                Asserted by {rev.assertedBy} at {formatUtcDateTime(rev.assertedAt)}
                              </span>
                              {rev.displayWording && (
                                <span> • &ldquo;{rev.displayWording}&rdquo;</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Propose Claim Modal */}
      {showProposeModal && (
        <div
          data-testid="propose-claim-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="propose-claim-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="propose-claim-modal-title">Propose Product Claim</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Define canonical claim kind and parameter assertions. Requires supporting evidence to
              pass readiness gates.
            </p>

            {formError && (
              <div
                data-testid="propose-claim-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleProposeClaim}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="propose-canonical-kind-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Canonical Claim Kind:
                </label>
                <select
                  id="propose-canonical-kind-select"
                  data-testid="claim-canonical-kind-select"
                  value={canonicalKind}
                  onChange={(e) => {
                    setCanonicalKind(e.target.value as CanonicalClaimKindContract);
                    proposeActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="certificate_panel_measurement">
                    certificate_panel_measurement
                  </option>
                  <option value="factual_lot_identifier">factual_lot_identifier</option>
                  <option value="packaged_or_harvest_date">packaged_or_harvest_date</option>
                  <option value="cultivation_processing_lineage">
                    cultivation_processing_lineage
                  </option>
                  <option value="logged_process_timing">logged_process_timing</option>
                  <option value="unsupported_manual">unsupported_manual</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="propose-proof-category-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Proof Category:
                </label>
                <select
                  id="propose-proof-category-select"
                  data-testid="claim-proof-category-select"
                  value={proofCategory}
                  onChange={(e) => {
                    setProofCategory(e.target.value as ClaimProofCategoryContract);
                    proposeActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="coa_measurement_backed">coa_measurement_backed</option>
                  <option value="production_record_backed">production_record_backed</option>
                  <option value="visual_evidence_backed">visual_evidence_backed</option>
                  <option value="human_attested_unverified">human_attested_unverified</option>
                </select>
              </div>

              {/* Conditional Parameter Inputs */}
              {canonicalKind === "certificate_panel_measurement" && (
                <div
                  style={{
                    backgroundColor: "var(--bg-surface-elevated)",
                    padding: "0.75rem",
                    borderRadius: "4px"
                  }}
                >
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                    Measurement Parameters:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <label
                        htmlFor="propose-param-analyte"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Analyte:
                      </label>
                      <input
                        id="propose-param-analyte"
                        type="text"
                        data-testid="param-analyte-input"
                        value={analyte}
                        onChange={(e) => {
                          setAnalyte(e.target.value);
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="propose-param-value"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Exact Value (Decimal String):
                      </label>
                      <input
                        id="propose-param-value"
                        type="text"
                        data-testid="param-value-input"
                        value={exactDecimalValue}
                        onChange={(e) => {
                          setExactDecimalValue(e.target.value);
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="propose-param-unit"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Unit:
                      </label>
                      <input
                        id="propose-param-unit"
                        type="text"
                        data-testid="param-unit-input"
                        value={unit}
                        onChange={(e) => {
                          setUnit(e.target.value);
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="propose-param-qkind"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Quantity Kind:
                      </label>
                      <input
                        id="propose-param-qkind"
                        type="text"
                        data-testid="param-quantity-kind-input"
                        value={quantityKind}
                        onChange={(e) => {
                          setQuantityKind(e.target.value);
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="propose-param-basis"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Basis:
                      </label>
                      <input
                        id="propose-param-basis"
                        type="text"
                        data-testid="param-basis-input"
                        value={basis}
                        onChange={(e) => {
                          setBasis(e.target.value);
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="propose-param-context"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Context:
                      </label>
                      <input
                        id="propose-param-context"
                        type="text"
                        data-testid="param-context-input"
                        value={context}
                        onChange={(e) => {
                          setContext(e.target.value);
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="propose-param-scope"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Required Scope:
                      </label>
                      <select
                        id="propose-param-scope"
                        data-testid="param-scope-select"
                        value={requiredScope}
                        onChange={(e) => {
                          setRequiredScope(e.target.value as "sample_only" | "attributed_lot");
                          proposeActionIdRef.current = generateUuidV7();
                        }}
                        style={{ width: "100%", padding: "0.3rem" }}
                      >
                        <option value="attributed_lot">attributed_lot</option>
                        <option value="sample_only">sample_only</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {canonicalKind === "factual_lot_identifier" && (
                <div>
                  <label
                    htmlFor="propose-param-lot"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Lot Identifier:
                  </label>
                  <input
                    id="propose-param-lot"
                    type="text"
                    data-testid="param-lot-input"
                    value={lotIdentifierInput}
                    onChange={(e) => {
                      setLotIdentifierInput(e.target.value);
                      proposeActionIdRef.current = generateUuidV7();
                    }}
                    required
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              )}

              {canonicalKind === "packaged_or_harvest_date" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="propose-param-date-kind"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Date Kind:
                    </label>
                    <select
                      id="propose-param-date-kind"
                      data-testid="param-date-kind-select"
                      value={dateKind}
                      onChange={(e) => {
                        setDateKind(e.target.value as ClaimDateKind);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="packaged_on">packaged_on</option>
                      <option value="harvested_on">harvested_on</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-date-val"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Date Value (YYYY-MM-DD):
                    </label>
                    <input
                      id="propose-param-date-val"
                      type="date"
                      data-testid="param-date-val-input"
                      value={dateValue}
                      onChange={(e) => {
                        setDateValue(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-date-precision"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Precision:
                    </label>
                    <select
                      id="propose-param-date-precision"
                      data-testid="param-date-precision-select"
                      value={datePrecision}
                      onChange={(e) => {
                        setDatePrecision(e.target.value as ReportedCapturePrecision);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="date">date</option>
                      <option value="minute">minute</option>
                      <option value="second">second</option>
                      <option value="millisecond">millisecond</option>
                    </select>
                  </div>
                </div>
              )}

              {canonicalKind === "cultivation_processing_lineage" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="propose-param-op-code"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Operation Code:
                    </label>
                    <input
                      id="propose-param-op-code"
                      type="text"
                      data-testid="param-operation-code"
                      value={operationCode}
                      onChange={(e) => {
                        setOperationCode(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-origin-kind"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Origin Kind:
                    </label>
                    <select
                      id="propose-param-origin-kind"
                      data-testid="param-origin-kind"
                      value={originKind}
                      onChange={(e) => {
                        setOriginKind(e.target.value as "own_production" | "partner_origin");
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="own_production">own_production</option>
                      <option value="partner_origin">partner_origin</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-party"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Attributed Party (Optional):
                    </label>
                    <input
                      id="propose-param-party"
                      type="text"
                      data-testid="param-attributed-party"
                      value={attributedParty}
                      onChange={(e) => {
                        setAttributedParty(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-claimed-facts"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Claimed Facts (Comma-separated):
                    </label>
                    <input
                      id="propose-param-claimed-facts"
                      type="text"
                      data-testid="param-claimed-facts"
                      value={claimedFacts}
                      onChange={(e) => {
                        setClaimedFacts(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                </div>
              )}

              {canonicalKind === "logged_process_timing" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="propose-param-op-name"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Operation Name:
                    </label>
                    <input
                      id="propose-param-op-name"
                      type="text"
                      data-testid="param-op-name"
                      value={operationName}
                      onChange={(e) => {
                        setOperationName(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-timing-kind"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Timing Kind:
                    </label>
                    <select
                      id="propose-param-timing-kind"
                      data-testid="param-timing-kind"
                      value={timingKind}
                      onChange={(e) => {
                        setTimingKind(e.target.value as ClaimTimingKindContract);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="duration">duration</option>
                      <option value="timestamp_range">timestamp_range</option>
                    </select>
                  </div>
                  {timingKind === "duration" ? (
                    <>
                      <div>
                        <label
                          htmlFor="propose-param-duration-val"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Duration Value:
                        </label>
                        <input
                          id="propose-param-duration-val"
                          type="text"
                          data-testid="param-duration-value"
                          value={durationValue}
                          onChange={(e) => {
                            setDurationValue(e.target.value);
                            proposeActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="propose-param-duration-unit"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Duration Unit:
                        </label>
                        <select
                          id="propose-param-duration-unit"
                          data-testid="param-duration-unit"
                          value={durationUnit}
                          onChange={(e) => {
                            setDurationUnit(
                              e.target.value as "seconds" | "minutes" | "hours" | "days"
                            );
                            proposeActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        >
                          <option value="seconds">seconds</option>
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                          <option value="days">days</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label
                          htmlFor="propose-param-ts-start"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Timestamp Start (ISO UTC):
                        </label>
                        <input
                          id="propose-param-ts-start"
                          type="text"
                          data-testid="param-timestamp-start"
                          value={timestampStart}
                          placeholder="2026-03-01T00:00:00Z"
                          onChange={(e) => {
                            setTimestampStart(e.target.value);
                            proposeActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="propose-param-ts-end"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Timestamp End (ISO UTC):
                        </label>
                        <input
                          id="propose-param-ts-end"
                          type="text"
                          data-testid="param-timestamp-end"
                          value={timestampEnd}
                          placeholder="2026-03-15T00:00:00Z"
                          onChange={(e) => {
                            setTimestampEnd(e.target.value);
                            proposeActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {canonicalKind === "unsupported_manual" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="propose-param-manual-cat"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Category or Reason:
                    </label>
                    <input
                      id="propose-param-manual-cat"
                      type="text"
                      data-testid="param-manual-category"
                      value={manualCategory}
                      onChange={(e) => {
                        setManualCategory(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="propose-param-manual-text"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Proposed Manual Text:
                    </label>
                    <textarea
                      id="propose-param-manual-text"
                      data-testid="param-manual-text"
                      value={manualText}
                      onChange={(e) => {
                        setManualText(e.target.value);
                        proposeActionIdRef.current = generateUuidV7();
                      }}
                      required
                      rows={2}
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="propose-claim-display-wording"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Display Wording (Optional Consumer Copy):
                </label>
                <input
                  id="propose-claim-display-wording"
                  type="text"
                  data-testid="claim-display-wording-input"
                  value={displayWording}
                  onChange={(e) => {
                    setDisplayWording(e.target.value);
                    proposeActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. 24.5% THC by dry weight"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowProposeModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-propose-claim-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Submitting..." : "Propose Claim"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Append Claim Revision (Correction) Modal */}
      {showAppendModal && (
        <div
          data-testid="append-claim-revision-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="append-claim-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "600px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="append-claim-modal-title">Correct Claim (New Revision)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Appends a new immutable revision to claim {showAppendModal.claimId.slice(0, 8)}…
              (expected version {showAppendModal.version}).
            </p>

            {formError && (
              <div
                data-testid="append-claim-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleAppendRevision}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="append-canonical-kind-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Canonical Claim Kind:
                </label>
                <select
                  id="append-canonical-kind-select"
                  data-testid="append-canonical-kind-select"
                  value={canonicalKind}
                  onChange={(e) => {
                    setCanonicalKind(e.target.value as CanonicalClaimKindContract);
                    appendActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="certificate_panel_measurement">
                    certificate_panel_measurement
                  </option>
                  <option value="factual_lot_identifier">factual_lot_identifier</option>
                  <option value="packaged_or_harvest_date">packaged_or_harvest_date</option>
                  <option value="cultivation_processing_lineage">
                    cultivation_processing_lineage
                  </option>
                  <option value="logged_process_timing">logged_process_timing</option>
                  <option value="unsupported_manual">unsupported_manual</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="append-proof-category-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Proof Category:
                </label>
                <select
                  id="append-proof-category-select"
                  data-testid="append-proof-category-select"
                  value={proofCategory}
                  onChange={(e) => {
                    setProofCategory(e.target.value as ClaimProofCategoryContract);
                    appendActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="coa_measurement_backed">coa_measurement_backed</option>
                  <option value="production_record_backed">production_record_backed</option>
                  <option value="visual_evidence_backed">visual_evidence_backed</option>
                  <option value="human_attested_unverified">human_attested_unverified</option>
                </select>
              </div>

              {canonicalKind === "certificate_panel_measurement" && (
                <div
                  style={{
                    backgroundColor: "var(--bg-surface-elevated)",
                    padding: "0.75rem",
                    borderRadius: "4px"
                  }}
                >
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                    Measurement Parameters:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <label
                        htmlFor="append-param-analyte"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Analyte:
                      </label>
                      <input
                        id="append-param-analyte"
                        type="text"
                        value={analyte}
                        onChange={(e) => {
                          setAnalyte(e.target.value);
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="append-param-value"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Exact Value (Decimal String):
                      </label>
                      <input
                        id="append-param-value"
                        type="text"
                        value={exactDecimalValue}
                        onChange={(e) => {
                          setExactDecimalValue(e.target.value);
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="append-param-unit"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Unit:
                      </label>
                      <input
                        id="append-param-unit"
                        type="text"
                        value={unit}
                        onChange={(e) => {
                          setUnit(e.target.value);
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="append-param-qkind"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Quantity Kind:
                      </label>
                      <input
                        id="append-param-qkind"
                        type="text"
                        value={quantityKind}
                        onChange={(e) => {
                          setQuantityKind(e.target.value);
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="append-param-basis"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Basis:
                      </label>
                      <input
                        id="append-param-basis"
                        type="text"
                        value={basis}
                        onChange={(e) => {
                          setBasis(e.target.value);
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="append-param-context"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Context:
                      </label>
                      <input
                        id="append-param-context"
                        type="text"
                        value={context}
                        onChange={(e) => {
                          setContext(e.target.value);
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        required
                        style={{ width: "100%", padding: "0.3rem" }}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="append-param-scope"
                        style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                      >
                        Required Scope:
                      </label>
                      <select
                        id="append-param-scope"
                        value={requiredScope}
                        onChange={(e) => {
                          setRequiredScope(e.target.value as "sample_only" | "attributed_lot");
                          appendActionIdRef.current = generateUuidV7();
                        }}
                        style={{ width: "100%", padding: "0.3rem" }}
                      >
                        <option value="attributed_lot">attributed_lot</option>
                        <option value="sample_only">sample_only</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {canonicalKind === "factual_lot_identifier" && (
                <div>
                  <label
                    htmlFor="append-param-lot"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Lot Identifier:
                  </label>
                  <input
                    id="append-param-lot"
                    type="text"
                    value={lotIdentifierInput}
                    onChange={(e) => {
                      setLotIdentifierInput(e.target.value);
                      appendActionIdRef.current = generateUuidV7();
                    }}
                    required
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              )}

              {canonicalKind === "packaged_or_harvest_date" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="append-param-date-kind"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Date Kind:
                    </label>
                    <select
                      id="append-param-date-kind"
                      value={dateKind}
                      onChange={(e) => {
                        setDateKind(e.target.value as ClaimDateKind);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="packaged_on">packaged_on</option>
                      <option value="harvested_on">harvested_on</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-date-val"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Date Value (YYYY-MM-DD):
                    </label>
                    <input
                      id="append-param-date-val"
                      type="date"
                      value={dateValue}
                      onChange={(e) => {
                        setDateValue(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-date-precision"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Precision:
                    </label>
                    <select
                      id="append-param-date-precision"
                      value={datePrecision}
                      onChange={(e) => {
                        setDatePrecision(e.target.value as ReportedCapturePrecision);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="date">date</option>
                      <option value="minute">minute</option>
                      <option value="second">second</option>
                      <option value="millisecond">millisecond</option>
                    </select>
                  </div>
                </div>
              )}

              {canonicalKind === "cultivation_processing_lineage" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="append-param-op-code"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Operation Code:
                    </label>
                    <input
                      id="append-param-op-code"
                      type="text"
                      value={operationCode}
                      onChange={(e) => {
                        setOperationCode(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-origin-kind"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Origin Kind:
                    </label>
                    <select
                      id="append-param-origin-kind"
                      value={originKind}
                      onChange={(e) => {
                        setOriginKind(e.target.value as "own_production" | "partner_origin");
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="own_production">own_production</option>
                      <option value="partner_origin">partner_origin</option>
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-party"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Attributed Party (Optional):
                    </label>
                    <input
                      id="append-param-party"
                      type="text"
                      value={attributedParty}
                      onChange={(e) => {
                        setAttributedParty(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-claimed-facts"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Claimed Facts (Comma-separated):
                    </label>
                    <input
                      id="append-param-claimed-facts"
                      type="text"
                      value={claimedFacts}
                      onChange={(e) => {
                        setClaimedFacts(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                </div>
              )}

              {canonicalKind === "logged_process_timing" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="append-param-op-name"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Operation Name:
                    </label>
                    <input
                      id="append-param-op-name"
                      type="text"
                      value={operationName}
                      onChange={(e) => {
                        setOperationName(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.3rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-timing-kind"
                      style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                    >
                      Timing Kind:
                    </label>
                    <select
                      id="append-param-timing-kind"
                      value={timingKind}
                      onChange={(e) => {
                        setTimingKind(e.target.value as ClaimTimingKindContract);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.3rem" }}
                    >
                      <option value="duration">duration</option>
                      <option value="timestamp_range">timestamp_range</option>
                    </select>
                  </div>
                  {timingKind === "duration" ? (
                    <>
                      <div>
                        <label
                          htmlFor="append-param-duration-val"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Duration Value:
                        </label>
                        <input
                          id="append-param-duration-val"
                          type="text"
                          value={durationValue}
                          onChange={(e) => {
                            setDurationValue(e.target.value);
                            appendActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="append-param-duration-unit"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Duration Unit:
                        </label>
                        <select
                          id="append-param-duration-unit"
                          value={durationUnit}
                          onChange={(e) => {
                            setDurationUnit(
                              e.target.value as "seconds" | "minutes" | "hours" | "days"
                            );
                            appendActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        >
                          <option value="seconds">seconds</option>
                          <option value="minutes">minutes</option>
                          <option value="hours">hours</option>
                          <option value="days">days</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label
                          htmlFor="append-param-ts-start"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Timestamp Start (ISO UTC):
                        </label>
                        <input
                          id="append-param-ts-start"
                          type="text"
                          value={timestampStart}
                          placeholder="2026-03-01T00:00:00Z"
                          onChange={(e) => {
                            setTimestampStart(e.target.value);
                            appendActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="append-param-ts-end"
                          style={{ fontSize: "0.8rem", display: "block", marginBottom: "0.2rem" }}
                        >
                          Timestamp End (ISO UTC):
                        </label>
                        <input
                          id="append-param-ts-end"
                          type="text"
                          value={timestampEnd}
                          placeholder="2026-03-15T00:00:00Z"
                          onChange={(e) => {
                            setTimestampEnd(e.target.value);
                            appendActionIdRef.current = generateUuidV7();
                          }}
                          style={{ width: "100%", padding: "0.3rem" }}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {canonicalKind === "unsupported_manual" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <div>
                    <label
                      htmlFor="append-param-manual-cat"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Category or Reason:
                    </label>
                    <input
                      id="append-param-manual-cat"
                      type="text"
                      value={manualCategory}
                      onChange={(e) => {
                        setManualCategory(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      required
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="append-param-manual-text"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Proposed Manual Text:
                    </label>
                    <textarea
                      id="append-param-manual-text"
                      value={manualText}
                      onChange={(e) => {
                        setManualText(e.target.value);
                        appendActionIdRef.current = generateUuidV7();
                      }}
                      required
                      rows={2}
                      style={{ width: "100%", padding: "0.4rem" }}
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="append-claim-display-wording"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Display Wording (Optional Consumer Copy):
                </label>
                <input
                  id="append-claim-display-wording"
                  type="text"
                  value={displayWording}
                  onChange={(e) => {
                    setDisplayWording(e.target.value);
                    appendActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. 24.5% THC by dry weight"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowAppendModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-append-claim-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Submitting..." : "Append New Revision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Claim Modal */}
      {showReviewModal && (
        <div
          data-testid="claim-review-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-claim-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "100%",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="review-claim-modal-title">Review Product Claim</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Authoritative review decision. Self-approval is rejected by server gates.
            </p>

            {formError && (
              <div
                data-testid="review-claim-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleReviewClaim}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="claim-review-decision-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Decision:
                </label>
                <select
                  id="claim-review-decision-select"
                  data-testid="claim-review-decision-select"
                  value={reviewDecision}
                  onChange={(e) => {
                    setReviewDecision(e.target.value as "approve" | "reject");
                    reviewActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="approve">approve</option>
                  <option value="reject">reject</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="claim-review-reason-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Reason / Audit Notes:
                </label>
                <textarea
                  id="claim-review-reason-input"
                  data-testid="claim-review-reason-input"
                  value={reviewReason}
                  onChange={(e) => {
                    setReviewReason(e.target.value);
                    reviewActionIdRef.current = generateUuidV7();
                  }}
                  required
                  rows={3}
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowReviewModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-claim-review-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Recording..." : "Record Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invalidate Claim Modal */}
      {showInvalidateModal && (
        <div
          data-testid="invalidate-claim-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invalidate-claim-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "100%",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="invalidate-claim-modal-title">Invalidate Product Claim</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Transition claim to invalidated state with recorded domain cause.
            </p>

            {formError && (
              <div
                data-testid="invalidate-claim-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleInvalidateClaim}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="invalidation-cause-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Invalidation Cause:
                </label>
                <select
                  id="invalidation-cause-select"
                  data-testid="invalidation-cause-select"
                  value={invalidationCause}
                  onChange={(e) => {
                    setInvalidationCause(e.target.value as ClaimInvalidationCauseContract);
                    invalidateActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="source_superseded">source_superseded</option>
                  <option value="source_disputed">source_disputed</option>
                  <option value="source_archived">source_archived</option>
                  <option value="integrity_failure">integrity_failure</option>
                  <option value="batch_facts_changed">batch_facts_changed</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="invalidation-reason-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Reason:
                </label>
                <textarea
                  id="invalidation-reason-input"
                  data-testid="invalidation-reason-input"
                  value={invalidationReason}
                  onChange={(e) => {
                    setInvalidationReason(e.target.value);
                    invalidateActionIdRef.current = generateUuidV7();
                  }}
                  required
                  rows={3}
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowInvalidateModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-invalidate-claim-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Invalidating..." : "Confirm Invalidation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link Evidence Modal */}
      {showLinkModal && (
        <div
          data-testid="link-evidence-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-evidence-modal-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "550px",
              width: "100%",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="link-evidence-modal-title">Link Supporting Evidence to Claim</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Pin specific evidence assets, revisions, and analytical measurement IDs to
              substantiate this claim.
            </p>

            {formError && (
              <div
                data-testid="link-evidence-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleLinkEvidence}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="link-evidence-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Evidence Asset:
                </label>
                <select
                  id="link-evidence-select"
                  data-testid="link-evidence-select"
                  value={linkEvidenceId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setLinkEvidenceId(id);
                    linkActionIdRef.current = generateUuidV7();
                    const match = availableEvidence.find((ev) => ev.asset.evidenceId === id);
                    if (match) setLinkEvidenceRev(match.asset.currentRevision);
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                  required
                >
                  {availableEvidence.map((ev) => (
                    <option key={ev.asset.evidenceId} value={ev.asset.evidenceId}>
                      Ev {ev.asset.evidenceId.slice(0, 8)}… (Rev {ev.asset.currentRevision})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="link-evidence-revision-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Evidence Revision:
                </label>
                <input
                  id="link-evidence-revision-input"
                  type="number"
                  min="1"
                  data-testid="link-evidence-revision-input"
                  value={linkEvidenceRev}
                  onChange={(e) => {
                    setLinkEvidenceRev(Number(e.target.value));
                    linkActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="link-support-role-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Support Role:
                </label>
                <select
                  id="link-support-role-select"
                  data-testid="link-support-role-select"
                  value={linkSupportRole}
                  onChange={(e) => {
                    setLinkSupportRole(e.target.value as ClaimSupportRoleContract);
                    linkActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="primary_measurement">primary_measurement</option>
                  <option value="corroborating_record">corroborating_record</option>
                  <option value="visual_reference">visual_reference</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="link-coa-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Associated CoA Report (Optional):
                </label>
                <select
                  id="link-coa-select"
                  data-testid="link-coa-select"
                  value={linkReportId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setLinkReportId(id);
                    linkActionIdRef.current = generateUuidV7();
                    const match = availableCoas.find((c) => c.report.reportId === id);
                    if (match) {
                      setLinkReportRev(match.report.currentRevision);
                      if (match.currentRevision.measurements[0]) {
                        setLinkMeasurementId(match.currentRevision.measurements[0].measurementId);
                      }
                      if (match.currentRevision.evidenceId) {
                        setLinkEvidenceId(match.currentRevision.evidenceId);
                        setLinkEvidenceRev(match.currentRevision.evidenceRevision);
                      }
                    }
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="">None</option>
                  {availableCoas.map((c) => (
                    <option key={c.report.reportId} value={c.report.reportId}>
                      CoA {c.report.reportId.slice(0, 8)}… (
                      {c.currentRevision.labNameAsClaimed || "Lab"})
                    </option>
                  ))}
                </select>
              </div>

              {linkReportId && (
                <div>
                  <label
                    htmlFor="link-coa-revision-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    CoA Report Revision:
                  </label>
                  <input
                    id="link-coa-revision-input"
                    type="number"
                    min="1"
                    data-testid="link-coa-revision-input"
                    value={linkReportRev}
                    onChange={(e) => {
                      setLinkReportRev(Number(e.target.value));
                      linkActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              )}

              {(() => {
                const selectedCoa = availableCoas.find((c) => c.report.reportId === linkReportId);
                const measurements = selectedCoa?.currentRevision.measurements ?? [];
                if (measurements.length === 0) return null;
                return (
                  <div>
                    <label
                      htmlFor="link-measurement-select"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Select Measurement from CoA:
                    </label>
                    <select
                      id="link-measurement-select"
                      data-testid="link-measurement-select"
                      value={linkMeasurementId}
                      onChange={(e) => {
                        setLinkMeasurementId(e.target.value);
                        linkActionIdRef.current = generateUuidV7();
                      }}
                      style={{ width: "100%", padding: "0.4rem" }}
                    >
                      <option value="">-- Choose Measurement --</option>
                      {measurements.map((m) => (
                        <option key={m.measurementId} value={m.measurementId}>
                          {m.analyte}: {m.resultValue ?? m.resultLimit ?? m.resultKind} {m.unit} (
                          {m.context})
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              <div>
                <label
                  htmlFor="link-measurement-id-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Measurement ID (UUID):
                </label>
                <input
                  id="link-measurement-id-input"
                  type="text"
                  data-testid="link-measurement-id-input"
                  value={linkMeasurementId}
                  onChange={(e) => {
                    setLinkMeasurementId(e.target.value);
                    linkActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="Measurement UUID from CoA Panel"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div>
                <label
                  htmlFor="link-facts-revision-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Pinned Batch Facts Revision (Optional):
                </label>
                {factsHistory.length > 0 && (
                  <select
                    id="link-facts-revision-select"
                    data-testid="link-facts-revision-select"
                    value={linkFactsRev}
                    onChange={(e) => {
                      setLinkFactsRev(e.target.value);
                      linkActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", marginBottom: "0.3rem" }}
                  >
                    <option value="">None / Custom Revision</option>
                    {factsHistory.map((f) => (
                      <option key={f.revision} value={String(f.revision)}>
                        Rev {f.revision} (Origin: {f.originKind})
                      </option>
                    ))}
                  </select>
                )}
                <input
                  id="link-facts-revision-input"
                  type="number"
                  min="1"
                  data-testid="link-facts-revision-input"
                  value={linkFactsRev}
                  onChange={(e) => {
                    setLinkFactsRev(e.target.value);
                    linkActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. 1"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  marginTop: "0.5rem",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: "0.5rem"
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    fontSize: "0.85rem",
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    data-testid="link-attestation-toggle"
                    checked={includeAttestation}
                    onChange={(e) => {
                      setIncludeAttestation(e.target.checked);
                      linkActionIdRef.current = generateUuidV7();
                    }}
                  />
                  <span>Attach Source Fact Attestation (Optional)</span>
                </label>

                {includeAttestation && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                      padding: "0.5rem",
                      backgroundColor: "var(--bg-surface-elevated)",
                      borderRadius: "4px"
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <label
                          htmlFor="link-attestation-kind"
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)"
                          }}
                        >
                          Fact Kind
                        </label>
                        <input
                          id="link-attestation-kind"
                          type="text"
                          data-testid="link-attestation-kind-input"
                          value={attestationFactKind}
                          onChange={(e) => {
                            setAttestationFactKind(e.target.value);
                            linkActionIdRef.current = generateUuidV7();
                          }}
                          placeholder="e.g. lot_identity"
                          style={{ width: "100%", padding: "0.35rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="link-attestation-value"
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)"
                          }}
                        >
                          Fact Value
                        </label>
                        <input
                          id="link-attestation-value"
                          type="text"
                          data-testid="link-attestation-value-input"
                          value={attestationFactValue}
                          onChange={(e) => {
                            setAttestationFactValue(e.target.value);
                            linkActionIdRef.current = generateUuidV7();
                          }}
                          placeholder="e.g. LOT-477-ORIGINAL"
                          style={{ width: "100%", padding: "0.35rem" }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <label
                          htmlFor="link-attestation-locator"
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)"
                          }}
                        >
                          Field Locator
                        </label>
                        <input
                          id="link-attestation-locator"
                          type="text"
                          data-testid="link-attestation-locator-input"
                          value={attestationFieldLocator}
                          onChange={(e) => {
                            setAttestationFieldLocator(e.target.value);
                            linkActionIdRef.current = generateUuidV7();
                          }}
                          placeholder="e.g. section_header"
                          style={{ width: "100%", padding: "0.35rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="link-attestation-attribution"
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)"
                          }}
                        >
                          Attribution
                        </label>
                        <input
                          id="link-attestation-attribution"
                          type="text"
                          data-testid="link-attestation-attribution-input"
                          value={attestationAttribution}
                          onChange={(e) => {
                            setAttestationAttribution(e.target.value);
                            linkActionIdRef.current = generateUuidV7();
                          }}
                          placeholder="e.g. Verified packaging run sheet"
                          style={{ width: "100%", padding: "0.35rem" }}
                        />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <label
                          htmlFor="link-attestation-actor"
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)"
                          }}
                        >
                          Attesting Actor (Optional)
                        </label>
                        <input
                          id="link-attestation-actor"
                          type="text"
                          data-testid="link-attestation-actor-input"
                          value={attestationActorId}
                          onChange={(e) => {
                            setAttestationActorId(e.target.value);
                            linkActionIdRef.current = generateUuidV7();
                          }}
                          placeholder="e.g. operator-1"
                          style={{ width: "100%", padding: "0.35rem" }}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="link-attestation-event-id"
                          style={{
                            display: "block",
                            fontSize: "0.75rem",
                            color: "var(--text-secondary)"
                          }}
                        >
                          Verification Event ID (Optional UUID)
                        </label>
                        <input
                          id="link-attestation-event-id"
                          type="text"
                          data-testid="link-attestation-event-id-input"
                          value={attestationVerificationEventId}
                          onChange={(e) => {
                            setAttestationVerificationEventId(e.target.value);
                            linkActionIdRef.current = generateUuidV7();
                          }}
                          placeholder="Verification Event UUID"
                          style={{ width: "100%", padding: "0.35rem" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowLinkModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-link-evidence-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Linking..." : "Link Evidence to Claim"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
