"use client";

import React, { useEffect, useRef, useState } from "react";
import { generateUuidV7 } from "@cco/shared";
import type {
  CoaCompletenessStatusContract,
  CoaResultKindContract,
  CoaResultQualifierContract,
  CoaReviewDecisionContract,
  CoaScopeKindContract,
  CreateCoaMeasurementInputContract,
  CreateCoaReportHttpRequest,
  DossierCoaReportItem,
  DossierEvidenceItem,
  ReviewCoaReportHttpRequest,
  SupersedeCoaReportHttpRequest
} from "@cco/contracts";
import {
  archiveCoaReport,
  createCoaReport,
  reviewCoaReport,
  supersedeCoaReport,
  ProductEvidenceApiError
} from "../../api/product-evidence-client";
import { formatExactDecimal, formatUtcDateTime } from "./format-decimal";
import {
  BlockedBadge,
  OperatorReviewedBadge,
  ReportedBadge,
  UnknownBadge
} from "./provenance-badges";

export interface CoaReportsPanelProps {
  readonly clientId: string;
  readonly batchId: string;
  readonly coaReports: readonly DossierCoaReportItem[];
  readonly availableEvidence: readonly DossierEvidenceItem[];
  readonly onDossierUpdated: () => void;
  readonly isRefreshing?: boolean;
}

interface MeasurementRowDraft {
  analyte: string;
  resultKind: CoaResultKindContract;
  resultValue: string;
  unit: string;
  basis: string;
  context: string;
  quantityKind: string;
  resultLimit: string;
  resultQualifier: string;
  methodAsReported: string;
  uncertaintyAbsolute?: string;
  detectionLimit?: string;
  quantificationLimit?: string;
  analyticalQualifierCode?: string;
  analyticalQualifierExplanation?: string;
}

const defaultRow = (): MeasurementRowDraft => ({
  analyte: "THC",
  resultKind: "quantified",
  resultValue: "24.5000",
  unit: "percent",
  basis: "dry_weight",
  context: "cannabinoid_profile",
  quantityKind: "mass_fraction",
  resultLimit: "",
  resultQualifier: "",
  methodAsReported: "HPLC-DAD",
  uncertaintyAbsolute: "",
  detectionLimit: "",
  quantificationLimit: "",
  analyticalQualifierCode: "",
  analyticalQualifierExplanation: ""
});

const formatMeasurementDraft = (m: MeasurementRowDraft): CreateCoaMeasurementInputContract => {
  let resultValue: string | null = null;
  let resultLimit: string | null = null;
  let resultQualifier: CoaResultQualifierContract | null = null;

  if (m.resultKind === "quantified") {
    resultValue = m.resultValue.trim() || null;
    resultLimit = null;
    resultQualifier = null;
  } else if (m.resultKind === "below_limit") {
    resultValue = null;
    resultLimit = m.resultLimit.trim() ? m.resultLimit.trim() : null;
    resultQualifier = (m.resultQualifier.trim() as CoaResultQualifierContract) || "lt";
  } else if (m.resultKind === "not_detected") {
    resultValue = null;
    resultLimit = null;
    resultQualifier = null;
  }

  return {
    analyte: m.analyte.trim(),
    resultKind: m.resultKind,
    resultValue,
    resultLimit,
    resultQualifier,
    unit: m.unit.trim(),
    basis: m.basis.trim(),
    context: m.context.trim(),
    quantityKind: m.quantityKind.trim(),
    methodAsReported: m.methodAsReported.trim() || null,
    uncertaintyAbsolute: m.uncertaintyAbsolute?.trim() || null,
    detectionLimit: m.detectionLimit?.trim() || null,
    quantificationLimit: m.quantificationLimit?.trim() || null,
    analyticalQualifierCode: m.analyticalQualifierCode?.trim() || null,
    analyticalQualifierExplanation: m.analyticalQualifierExplanation?.trim() || null
  };
};

export function CoaReportsPanel({
  clientId,
  batchId,
  coaReports,
  availableEvidence,
  onDossierUpdated,
  isRefreshing = false
}: CoaReportsPanelProps): React.ReactElement {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState<{
    reportId: string;
    version: number;
  } | null>(null);
  const [showSupersedeModal, setShowSupersedeModal] = useState<{
    reportId: string;
    version: number;
    item: DossierCoaReportItem;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createActionIdRef = useRef(generateUuidV7());
  const reviewActionIdRef = useRef(generateUuidV7());
  const supersedeActionIdRef = useRef(generateUuidV7());
  const archiveActionIdRef = useRef(generateUuidV7());

  // Create form state
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(
    availableEvidence[0]?.asset.evidenceId || ""
  );
  const [evidenceRev, setEvidenceRev] = useState(availableEvidence[0]?.asset.currentRevision || 1);

  useEffect(() => {
    const firstEvidence = availableEvidence[0];
    if (
      firstEvidence &&
      (!selectedEvidenceId ||
        !availableEvidence.some((ev) => ev.asset.evidenceId === selectedEvidenceId))
    ) {
      setSelectedEvidenceId(firstEvidence.asset.evidenceId);
      setEvidenceRev(firstEvidence.asset.currentRevision);
    }
  }, [availableEvidence, selectedEvidenceId]);

  const [completeness, setCompleteness] = useState<CoaCompletenessStatusContract>("complete");
  const [reportIdentifier, setReportIdentifier] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [labName, setLabName] = useState("");
  const [sampleIdentifier, setSampleIdentifier] = useState("");
  const [scopeKind, setScopeKind] = useState<CoaScopeKindContract>("attributed_lot");
  const [sampleDate, setSampleDate] = useState("");
  const [associationAttestation, setAssociationAttestation] = useState("");
  const [measurements, setMeasurements] = useState<MeasurementRowDraft[]>([defaultRow()]);

  // Review form state
  const [reviewDecision, setReviewDecision] = useState<CoaReviewDecisionContract>("approved");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewScope, setReviewScope] = useState<CoaScopeKindContract>("attributed_lot");

  // Editing the measurement rows changes the payload for whichever
  // create/supersede submission is pending, so the pinned per-form action
  // IDs must rotate here: a retry of an unedited payload should keep its
  // actionId, but an edited payload must mint a new one.
  const rotateMeasurementDependentActionIds = () => {
    createActionIdRef.current = generateUuidV7();
    supersedeActionIdRef.current = generateUuidV7();
  };

  const handleAddMeasurementRow = () => {
    setMeasurements([...measurements, defaultRow()]);
    rotateMeasurementDependentActionIds();
  };

  const handleRemoveMeasurementRow = (idx: number) => {
    setMeasurements(measurements.filter((_, i) => i !== idx));
    rotateMeasurementDependentActionIds();
  };

  const handleUpdateMeasurementRow = (idx: number, patch: Partial<MeasurementRowDraft>) => {
    setMeasurements(measurements.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
    rotateMeasurementDependentActionIds();
  };

  const handleCreateCoa = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      if (!selectedEvidenceId) {
        setFormError("Must link to a source evidence asset.");
        setIsSubmitting(false);
        return;
      }

      const formattedMeasurements = measurements.map(formatMeasurementDraft);

      const actionId = createActionIdRef.current;
      const req: CreateCoaReportHttpRequest = {
        actionId,
        batchId,
        evidenceId: selectedEvidenceId,
        evidenceRevision: Number(evidenceRev),
        completenessStatus: completeness,
        reportIdentifierAsClaimed: reportIdentifier.trim() || null,
        reportDate: reportDate.trim() || null,
        labNameAsClaimed: labName.trim() || null,
        sampleIdentifierAsClaimed: sampleIdentifier.trim() || null,
        scopeKind,
        sampleDate: sampleDate.trim() || null,
        sampleToBatchAssociationAttestation: associationAttestation.trim() || null,
        measurements: formattedMeasurements
      };

      await createCoaReport(clientId, batchId, req);
      createActionIdRef.current = generateUuidV7();
      setShowCreateModal(false);
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

  const handleReviewCoa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showReviewModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const actionId = reviewActionIdRef.current;
      const req: ReviewCoaReportHttpRequest = {
        actionId,
        expectedVersion: showReviewModal.version,
        decision: reviewDecision,
        reason: reviewReason.trim(),
        assessedScope: reviewScope
      };

      await reviewCoaReport(clientId, batchId, showReviewModal.reportId, req);
      reviewActionIdRef.current = generateUuidV7();
      setShowReviewModal(null);
      setReviewReason("");
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        // The modal's pinned expectedVersion is now stale. Close it instead
        // of leaving it open against a version that will only conflict
        // again: reload the fresh dossier and require the operator to
        // deliberately reopen review on the current revision.
        onDossierUpdated();
        reviewActionIdRef.current = generateUuidV7();
        setShowReviewModal(null);
        setFormError(
          "This report was changed by another review in the meantime. Reloaded the current state; please reopen review to resubmit."
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

  const handleSupersedeCoa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showSupersedeModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const formattedMeasurements = measurements.map(formatMeasurementDraft);

      const currentRev = showSupersedeModal.item.currentRevision;
      const actionId = supersedeActionIdRef.current;
      const req: SupersedeCoaReportHttpRequest = {
        actionId,
        expectedVersion: showSupersedeModal.version,
        evidenceRevision: currentRev.evidenceRevision,
        completenessStatus: completeness,
        reportIdentifierAsClaimed: reportIdentifier.trim() || null,
        reportDate: reportDate.trim() || null,
        labNameAsClaimed: labName.trim() || null,
        sampleIdentifierAsClaimed: sampleIdentifier.trim() || null,
        scopeKind,
        scopeDescription: currentRev.scopeDescription,
        sampleDate: sampleDate.trim() || null,
        samplingMethodDescription: currentRev.samplingMethodDescription,
        sampleToBatchAssociationAttestation: associationAttestation.trim() || null,
        sampleToBatchAssociationConfirmed: currentRev.sampleToBatchAssociationConfirmed,
        verifiedLabIdentityEventId: currentRev.verifiedLabIdentityEventId,
        measurements: formattedMeasurements
      };

      await supersedeCoaReport(clientId, batchId, showSupersedeModal.reportId, req);
      supersedeActionIdRef.current = generateUuidV7();
      setShowSupersedeModal(null);
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        // Same stale-version handling as handleReviewCoa: close rather than
        // leaving the modal open against an expectedVersion that will only
        // conflict again.
        onDossierUpdated();
        supersedeActionIdRef.current = generateUuidV7();
        setShowSupersedeModal(null);
        setFormError(
          "This report was changed in the meantime. Reloaded the current state; please reopen supersede to resubmit."
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

  const handleArchiveReport = async (reportId: string, version: number) => {
    if (
      !confirm(
        "Are you sure you want to archive this CoA report? Pinned claims may be invalidated."
      )
    )
      return;
    try {
      const actionId = archiveActionIdRef.current;
      await archiveCoaReport(clientId, batchId, reportId, {
        actionId,
        expectedVersion: version
      });
      archiveActionIdRef.current = generateUuidV7();
      onDossierUpdated();
    } catch (err) {
      alert(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    }
  };

  return (
    <section
      id="coa-reports-section"
      data-testid="coa-reports-section"
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
          <h2>Analytical Laboratory Reports (CoA)</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Transcribed lab measurement panels pinned to source evidence. Strictly preserves decimal
            values.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowCreateModal(true);
          }}
          className="stage-draft-button"
          data-testid="transcribe-coa-button"
          style={{ padding: "0.4rem 0.8rem", fontSize: "0.875rem" }}
        >
          + Transcribe CoA Report
        </button>
      </div>

      {isRefreshing && (
        <div
          role="status"
          data-testid="coa-stale-banner"
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
          Refreshing latest analytical reports... Data may be temporarily stale.
        </div>
      )}

      {coaReports.length === 0 ? (
        <div
          data-testid="empty-coa-message"
          style={{ padding: "1.5rem", backgroundColor: "var(--bg-surface)", borderRadius: "8px" }}
        >
          <UnknownBadge detail="No Certificate of Analysis transcribed" />
          <p style={{ marginTop: "0.5rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Transcribe an analytical test report to substantiate chemical potency, contaminant, or
            safety claims.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {coaReports.map((item) => {
            const rev = item.currentRevision;
            const currentRevisionReviews = (item.reviewEvents ?? []).filter(
              (ev) => ev.reportRevision === rev.revision
            );
            const latestReview =
              currentRevisionReviews.length > 0
                ? currentRevisionReviews[currentRevisionReviews.length - 1]
                : undefined;

            return (
              <div
                key={item.report.reportId}
                id={`coa-report-item-${item.report.reportId}`}
                data-testid={`coa-report-item-${item.report.reportId}`}
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderRadius: "8px",
                  padding: "1.25rem",
                  border: "1px solid var(--border-subtle)"
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
                      Lab Report:{" "}
                      {rev.reportIdentifierAsClaimed || item.report.reportId.slice(0, 8)}
                      {item.report.archivedAt && <BlockedBadge detail="Archived" />}
                    </h3>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        marginTop: "0.25rem"
                      }}
                    >
                      Report Date: {rev.reportDate || "—"} • Lab:{" "}
                      {rev.labNameAsClaimed || <UnknownBadge detail="Unverified Lab" />} • Scope:{" "}
                      {rev.scopeKind || "—"}
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
                      <span>
                        Pinned Source: Ev {rev.evidenceId.slice(0, 8)}… (Rev {rev.evidenceRevision})
                      </span>
                      <span>•</span>
                      <span>Recorded by:</span>
                      <ReportedBadge detail={rev.assertedBy} />
                      <span>at {formatUtcDateTime(rev.assertedAt)}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    {latestReview ? (
                      <OperatorReviewedBadge
                        detail={`${latestReview.decision} by ${latestReview.actorId}`}
                        isApproved={latestReview.decision === "approved"}
                        testId="coa-review-badge"
                      />
                    ) : (
                      <UnknownBadge
                        detail={`Unreviewed Transcription (Rev ${rev.revision})`}
                        testId="coa-unreviewed-badge"
                      />
                    )}

                    <button
                      type="button"
                      data-testid={`review-coa-button-${item.report.reportId}`}
                      onClick={() => {
                        setFormError(null);
                        setShowReviewModal({
                          reportId: item.report.reportId,
                          version: item.report.version
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
                      Record Review
                    </button>

                    <button
                      type="button"
                      data-testid={`supersede-coa-button-${item.report.reportId}`}
                      onClick={() => {
                        setFormError(null);
                        setReportIdentifier(rev.reportIdentifierAsClaimed || "");
                        setReportDate(rev.reportDate || "");
                        setLabName(rev.labNameAsClaimed || "");
                        setSampleIdentifier(rev.sampleIdentifierAsClaimed || "");
                        setCompleteness(rev.completenessStatus);
                        setScopeKind(rev.scopeKind || "attributed_lot");
                        setSampleDate(rev.sampleDate || "");
                        setAssociationAttestation(rev.sampleToBatchAssociationAttestation || "");
                        setMeasurements(
                          rev.measurements.map((m) => ({
                            analyte: m.analyte,
                            resultKind: m.resultKind,
                            resultValue: m.resultValue || "",
                            unit: m.unit,
                            basis: m.basis,
                            context: m.context,
                            quantityKind: m.quantityKind,
                            resultLimit: m.resultLimit || "",
                            resultQualifier: m.resultQualifier || "",
                            methodAsReported: m.methodAsReported || "",
                            uncertaintyAbsolute: m.uncertaintyAbsolute || "",
                            detectionLimit: m.detectionLimit || "",
                            quantificationLimit: m.quantificationLimit || "",
                            analyticalQualifierCode: m.analyticalQualifierCode || "",
                            analyticalQualifierExplanation: m.analyticalQualifierExplanation || ""
                          }))
                        );
                        setShowSupersedeModal({
                          reportId: item.report.reportId,
                          version: item.report.version,
                          item
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
                      Supersede Panel
                    </button>

                    <button
                      type="button"
                      data-testid={`archive-coa-button-${item.report.reportId}`}
                      onClick={() => handleArchiveReport(item.report.reportId, item.report.version)}
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
                      Archive
                    </button>
                  </div>
                </div>

                {/* Measurement Panel Table */}
                <div style={{ marginTop: "1rem", overflowX: "auto" }}>
                  <table
                    data-testid={`measurement-panel-table-${item.report.reportId}`}
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.85rem",
                      backgroundColor: "var(--bg-surface-elevated)",
                      borderRadius: "6px"
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border-prominent)",
                          textAlign: "left",
                          color: "var(--text-muted)"
                        }}
                      >
                        <th style={{ padding: "0.5rem" }}>Analyte</th>
                        <th style={{ padding: "0.5rem" }}>Kind</th>
                        <th style={{ padding: "0.5rem" }}>Exact Value / Limit</th>
                        <th style={{ padding: "0.5rem" }}>Unit</th>
                        <th style={{ padding: "0.5rem" }}>Basis</th>
                        <th style={{ padding: "0.5rem" }}>Context</th>
                        <th style={{ padding: "0.5rem" }}>Quantity Kind</th>
                        <th style={{ padding: "0.5rem" }}>Uncertainty</th>
                        <th style={{ padding: "0.5rem" }}>Method</th>
                        <th style={{ padding: "0.5rem" }}>Provenance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rev.measurements.map((m) => (
                        <tr
                          key={m.measurementId}
                          id={`measurement-row-${m.measurementId}`}
                          data-testid={`measurement-row-${m.measurementId}`}
                          style={{ borderBottom: "1px solid var(--border-subtle)" }}
                        >
                          <td style={{ padding: "0.5rem", fontWeight: 600 }}>{m.analyte}</td>
                          <td style={{ padding: "0.5rem" }}>{m.resultKind}</td>
                          <td
                            data-testid={`measurement-value-${m.analyte}`}
                            style={{
                              padding: "0.5rem",
                              fontFamily: "var(--font-mono)",
                              fontWeight: 600
                            }}
                          >
                            {m.resultKind === "quantified"
                              ? formatExactDecimal(m.resultValue)
                              : m.resultKind === "below_limit"
                                ? `< ${formatExactDecimal(m.resultLimit)} (${m.resultQualifier || "lt"})`
                                : "Not Detected"}
                            {(m.detectionLimit || m.quantificationLimit) && (
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                {m.detectionLimit ? `LOD: ${m.detectionLimit} ` : ""}
                                {m.quantificationLimit ? `LOQ: ${m.quantificationLimit}` : ""}
                              </div>
                            )}
                            {m.analyticalQualifierCode && (
                              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                                Qualifier: {m.analyticalQualifierCode}
                                {m.analyticalQualifierExplanation
                                  ? ` (${m.analyticalQualifierExplanation})`
                                  : ""}
                              </div>
                            )}
                          </td>
                          <td
                            data-testid={`measurement-unit-${m.analyte}`}
                            style={{ padding: "0.5rem" }}
                          >
                            {m.unit}
                          </td>
                          <td style={{ padding: "0.5rem" }}>{m.basis}</td>
                          <td style={{ padding: "0.5rem" }}>{m.context}</td>
                          <td
                            style={{
                              padding: "0.5rem",
                              fontSize: "0.8rem",
                              color: "var(--text-secondary)"
                            }}
                          >
                            {m.quantityKind}
                          </td>
                          <td style={{ padding: "0.5rem", fontSize: "0.8rem" }}>
                            {m.uncertaintyAbsolute ? `±${m.uncertaintyAbsolute}` : "—"}
                          </td>
                          <td style={{ padding: "0.5rem" }}>{m.methodAsReported || "—"}</td>
                          <td style={{ padding: "0.5rem" }}>
                            <ReportedBadge detail={rev.labNameAsClaimed || "Reported"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Review Decisions History */}
                {item.reviewEvents.length > 0 && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)"
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Review History:</div>
                    {item.reviewEvents.map((ev) => (
                      <div
                        key={ev.eventId}
                        data-testid={`coa-review-event-${ev.eventId}`}
                        style={{ padding: "0.2rem 0" }}
                      >
                        Decision: <strong>{ev.decision}</strong> by {ev.actorId} (
                        {formatUtcDateTime(ev.occurredAt)}) • Reason: {ev.reason} (Scope:{" "}
                        {ev.assessedScope}) • Applies to Rev {ev.reportRevision}
                      </div>
                    ))}
                  </div>
                )}

                {/* CoA Report Revision History */}
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
                      Report Revision History ({item.revisions.length}):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                      {item.revisions.map((r) => {
                        const isCurrent = r.revision === rev.revision;
                        const rReviews = (item.reviewEvents ?? []).filter(
                          (ev) => ev.reportRevision === r.revision
                        );
                        const rLatestReview =
                          rReviews.length > 0 ? rReviews[rReviews.length - 1] : undefined;
                        return (
                          <div
                            key={r.revision}
                            id={`coa-revision-${item.report.reportId}-${r.revision}`}
                            data-testid={`coa-revision-${item.report.reportId}-${r.revision}`}
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
                              <strong>Rev {r.revision}</strong>{" "}
                              {isCurrent && (
                                <span style={{ color: "#10b981", fontSize: "0.75rem" }}>
                                  (Current)
                                </span>
                              )}
                              {" • "}
                              <span>Report ID: {r.reportIdentifierAsClaimed || "—"}</span>
                              {" • "}
                              <span>Lab: {r.labNameAsClaimed || "—"}</span>
                              {" • "}
                              <span>
                                Recorded by {r.assertedBy} at {formatUtcDateTime(r.assertedAt)}
                              </span>
                              {" • "}
                              <span>{r.measurements.length} Measurements</span>
                              <a
                                href="#product-claims-section"
                                style={{
                                  fontSize: "0.75rem",
                                  color: "#38bdf8",
                                  marginLeft: "0.5rem",
                                  textDecoration: "underline"
                                }}
                              >
                                ↑ Return to Claims
                              </a>
                            </div>
                            <div>
                              {rLatestReview ? (
                                <OperatorReviewedBadge
                                  detail={`${rLatestReview.decision} by ${rLatestReview.actorId} (Rev ${r.revision})`}
                                  isApproved={rLatestReview.decision === "approved"}
                                />
                              ) : (
                                <UnknownBadge detail={`Unreviewed (Rev ${r.revision})`} />
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

      {/* Create / Transcribe CoA Modal */}
      {showCreateModal && (
        <div
          data-testid="transcribe-coa-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-coa-modal-title"
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
              maxWidth: "850px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="create-coa-modal-title">Transcribe Certificate of Analysis (CoA)</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Pin transcriptions to registered original evidence. Do not convert units or round
              decimals.
            </p>

            {formError && (
              <div
                data-testid="create-coa-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleCreateCoa}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="coa-evidence-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Source Evidence Attachment:
                  </label>
                  <select
                    id="coa-evidence-select"
                    data-testid="coa-evidence-select"
                    value={selectedEvidenceId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setSelectedEvidenceId(nextId);
                      createActionIdRef.current = generateUuidV7();
                      const match = availableEvidence.find((ev) => ev.asset.evidenceId === nextId);
                      if (match) {
                        setEvidenceRev(match.asset.currentRevision);
                      }
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
                    htmlFor="coa-evidence-rev-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Evidence Revision:
                  </label>
                  <input
                    id="coa-evidence-rev-input"
                    type="number"
                    data-testid="coa-evidence-rev-input"
                    value={evidenceRev}
                    onChange={(e) => {
                      setEvidenceRev(Number(e.target.value));
                      createActionIdRef.current = generateUuidV7();
                    }}
                    min={1}
                    required
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="coa-report-id-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Report Identifier:
                  </label>
                  <input
                    id="coa-report-id-input"
                    type="text"
                    data-testid="coa-report-id-input"
                    value={reportIdentifier}
                    onChange={(e) => {
                      setReportIdentifier(e.target.value);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="e.g. LAB-2026-098"
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="coa-report-date-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Report Date:
                  </label>
                  <input
                    id="coa-report-date-input"
                    type="date"
                    data-testid="coa-report-date-input"
                    value={reportDate}
                    onChange={(e) => {
                      setReportDate(e.target.value);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="coa-lab-name-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Claimed Lab Name:
                  </label>
                  <input
                    id="coa-lab-name-input"
                    type="text"
                    data-testid="coa-lab-name-input"
                    value={labName}
                    onChange={(e) => {
                      setLabName(e.target.value);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="e.g. Cascade Analytical Laboratories"
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="coa-sample-id-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Sample Identifier:
                  </label>
                  <input
                    id="coa-sample-id-input"
                    type="text"
                    data-testid="coa-sample-id-input"
                    value={sampleIdentifier}
                    onChange={(e) => {
                      setSampleIdentifier(e.target.value);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="e.g. SMP-991"
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="coa-scope-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Scope Kind:
                  </label>
                  <select
                    id="coa-scope-select"
                    data-testid="coa-scope-select"
                    value={scopeKind}
                    onChange={(e) => {
                      setScopeKind(e.target.value as CoaScopeKindContract);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  >
                    <option value="attributed_lot">attributed_lot</option>
                    <option value="sample_only">sample_only</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="coa-completeness-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Completeness:
                  </label>
                  <select
                    id="coa-completeness-select"
                    data-testid="coa-completeness-select"
                    value={completeness}
                    onChange={(e) => {
                      setCompleteness(e.target.value as CoaCompletenessStatusContract);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  >
                    <option value="complete">complete</option>
                    <option value="draft">draft</option>
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="coa-sample-date-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Sample Date:
                  </label>
                  <input
                    id="coa-sample-date-input"
                    data-testid="coa-sample-date-input"
                    type="date"
                    value={sampleDate}
                    onChange={(e) => {
                      setSampleDate(e.target.value);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="coa-assoc-attestation-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Sample to Batch Association Attestation:
                  </label>
                  <input
                    id="coa-assoc-attestation-input"
                    data-testid="coa-assoc-attestation-input"
                    type="text"
                    value={associationAttestation}
                    onChange={(e) => {
                      setAssociationAttestation(e.target.value);
                      createActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="e.g. Sample pulled directly from lot barrel A1"
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>

              {/* Dynamic Measurement Rows */}
              <div style={{ marginTop: "0.5rem" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem"
                  }}
                >
                  <label style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    Analytical Measurements Panel:
                  </label>
                  <button
                    type="button"
                    onClick={handleAddMeasurementRow}
                    data-testid="add-measurement-row-button"
                    style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                  >
                    + Add Measurement
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {measurements.map((row, idx) => (
                    <div
                      key={idx}
                      data-testid={`measurement-draft-row-${idx}`}
                      style={{
                        backgroundColor: "var(--bg-surface-elevated)",
                        padding: "0.75rem",
                        borderRadius: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem"
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.2fr 1fr 1.2fr 1fr 1fr 1fr auto",
                          gap: "0.4rem",
                          alignItems: "end"
                        }}
                      >
                        <div>
                          <label
                            htmlFor={`create-m-analyte-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Analyte
                          </label>
                          <input
                            id={`create-m-analyte-${idx}`}
                            type="text"
                            placeholder="Analyte"
                            data-testid={`row-analyte-${idx}`}
                            value={row.analyte}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { analyte: e.target.value });
                              createActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`create-m-kind-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Kind
                          </label>
                          <select
                            id={`create-m-kind-${idx}`}
                            value={row.resultKind}
                            data-testid={`row-kind-${idx}`}
                            onChange={(e) => {
                              const nextKind = e.target.value as CoaResultKindContract;
                              handleUpdateMeasurementRow(idx, {
                                resultKind: nextKind,
                                ...(nextKind === "below_limit" && !row.resultLimit
                                  ? {
                                      resultLimit: row.resultValue || "0.01",
                                      resultQualifier: row.resultQualifier || "lt"
                                    }
                                  : {})
                              });
                              createActionIdRef.current = generateUuidV7();
                            }}
                            style={{ width: "100%", padding: "0.35rem" }}
                          >
                            <option value="quantified">quantified</option>
                            <option value="below_limit">below_limit</option>
                            <option value="not_detected">not_detected</option>
                          </select>
                        </div>
                        {row.resultKind === "quantified" && (
                          <div>
                            <label
                              htmlFor={`create-m-value-${idx}`}
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "var(--text-secondary)",
                                marginBottom: "0.2rem"
                              }}
                            >
                              Exact Value
                            </label>
                            <input
                              id={`create-m-value-${idx}`}
                              type="text"
                              placeholder="e.g. 24.5000"
                              data-testid={`row-value-${idx}`}
                              value={row.resultValue}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, { resultValue: e.target.value });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              required
                              style={{ width: "100%", padding: "0.35rem" }}
                            />
                          </div>
                        )}
                        {row.resultKind === "below_limit" && (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1.2fr 1fr",
                              gap: "0.25rem"
                            }}
                          >
                            <div>
                              <label
                                htmlFor={`create-m-limit-${idx}`}
                                style={{
                                  display: "block",
                                  fontSize: "0.75rem",
                                  color: "var(--text-secondary)",
                                  marginBottom: "0.2rem"
                                }}
                              >
                                Limit
                              </label>
                              <input
                                id={`create-m-limit-${idx}`}
                                type="text"
                                placeholder="0.01"
                                data-testid={`row-limit-${idx}`}
                                value={row.resultLimit}
                                onChange={(e) => {
                                  handleUpdateMeasurementRow(idx, { resultLimit: e.target.value });
                                  createActionIdRef.current = generateUuidV7();
                                }}
                                required
                                style={{ width: "100%", padding: "0.35rem" }}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`create-m-qualifier-${idx}`}
                                style={{
                                  display: "block",
                                  fontSize: "0.75rem",
                                  color: "var(--text-secondary)",
                                  marginBottom: "0.2rem"
                                }}
                              >
                                Qual
                              </label>
                              <select
                                id={`create-m-qualifier-${idx}`}
                                data-testid={`row-qualifier-${idx}`}
                                value={row.resultQualifier || "lt"}
                                onChange={(e) => {
                                  handleUpdateMeasurementRow(idx, {
                                    resultQualifier: e.target.value
                                  });
                                  createActionIdRef.current = generateUuidV7();
                                }}
                                style={{ width: "100%", padding: "0.35rem" }}
                              >
                                <option value="lt">&lt; (lt)</option>
                                <option value="lte">&le; (lte)</option>
                              </select>
                            </div>
                          </div>
                        )}
                        {row.resultKind === "not_detected" && (
                          <div>
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                marginBottom: "0.2rem"
                              }}
                            >
                              Result
                            </span>
                            <div
                              style={{
                                padding: "0.35rem",
                                fontSize: "0.8rem",
                                color: "var(--text-muted)"
                              }}
                            >
                              Not Detected
                            </div>
                          </div>
                        )}
                        <div>
                          <label
                            htmlFor={`create-m-unit-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Unit
                          </label>
                          <input
                            id={`create-m-unit-${idx}`}
                            type="text"
                            placeholder="percent"
                            data-testid={`row-unit-${idx}`}
                            value={row.unit}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { unit: e.target.value });
                              createActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`create-m-basis-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Basis
                          </label>
                          <input
                            id={`create-m-basis-${idx}`}
                            type="text"
                            placeholder="dry_weight"
                            data-testid={`row-basis-${idx}`}
                            value={row.basis}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { basis: e.target.value });
                              createActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`create-m-context-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Context
                          </label>
                          <input
                            id={`create-m-context-${idx}`}
                            type="text"
                            placeholder="cannabinoid"
                            data-testid={`row-context-${idx}`}
                            value={row.context}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { context: e.target.value });
                              createActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMeasurementRow(idx)}
                          disabled={measurements.length === 1}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            padding: "0.35rem"
                          }}
                          aria-label={`Remove measurement row ${idx + 1}`}
                        >
                          ✕
                        </button>
                      </div>

                      <details style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>
                          Advanced Analytical Details (Quantity Kind, Method, Uncertainty, LOD/LOQ)
                        </summary>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr 1fr",
                            gap: "0.4rem",
                            marginTop: "0.4rem"
                          }}
                        >
                          <div>
                            <label
                              htmlFor={`create-m-qkind-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Quantity Kind
                            </label>
                            <input
                              id={`create-m-qkind-${idx}`}
                              type="text"
                              data-testid={`row-qkind-${idx}`}
                              value={row.quantityKind}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, { quantityKind: e.target.value });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`create-m-method-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Method
                            </label>
                            <input
                              id={`create-m-method-${idx}`}
                              type="text"
                              placeholder="HPLC-DAD"
                              data-testid={`row-method-${idx}`}
                              value={row.methodAsReported}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  methodAsReported: e.target.value
                                });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`create-m-uncertainty-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Uncertainty
                            </label>
                            <input
                              id={`create-m-uncertainty-${idx}`}
                              type="text"
                              placeholder="e.g. 0.05"
                              data-testid={`row-uncertainty-${idx}`}
                              value={row.uncertaintyAbsolute || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  uncertaintyAbsolute: e.target.value
                                });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`create-m-lod-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              LOD
                            </label>
                            <input
                              id={`create-m-lod-${idx}`}
                              type="text"
                              placeholder="LOD"
                              value={row.detectionLimit || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, { detectionLimit: e.target.value });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`create-m-loq-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              LOQ
                            </label>
                            <input
                              id={`create-m-loq-${idx}`}
                              type="text"
                              placeholder="LOQ"
                              data-testid={`row-loq-${idx}`}
                              value={row.quantificationLimit || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  quantificationLimit: e.target.value
                                });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`create-m-qualcode-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Qualifier Code
                            </label>
                            <input
                              id={`create-m-qualcode-${idx}`}
                              type="text"
                              placeholder="e.g. J"
                              data-testid={`row-qualcode-${idx}`}
                              value={row.analyticalQualifierCode || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  analyticalQualifierCode: e.target.value
                                });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`create-m-qualexpl-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Qualifier Explanation
                            </label>
                            <input
                              id={`create-m-qualexpl-${idx}`}
                              type="text"
                              placeholder="Explain qualifier code"
                              data-testid={`row-qualexpl-${idx}`}
                              value={row.analyticalQualifierExplanation || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  analyticalQualifierExplanation: e.target.value
                                });
                                createActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-transcribe-coa-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Submitting..." : "Save Transcribed CoA"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record Review Modal */}
      {showReviewModal && (
        <div
          data-testid="coa-review-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-coa-modal-title"
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
            <h3 id="review-coa-modal-title">Record CoA Review Decision</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Authorized independent reviewer inspection. Self-approval is strictly forbidden.
            </p>

            {formError && (
              <div
                data-testid="review-coa-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleReviewCoa}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="coa-review-decision-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Decision:
                </label>
                <select
                  id="coa-review-decision-select"
                  data-testid="coa-review-decision-select"
                  value={reviewDecision}
                  onChange={(e) => {
                    setReviewDecision(e.target.value as CoaReviewDecisionContract);
                    reviewActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="approved">approved</option>
                  <option value="rejected">rejected</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="coa-review-scope-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Assessed Scope:
                </label>
                <select
                  id="coa-review-scope-select"
                  data-testid="coa-review-scope-select"
                  value={reviewScope}
                  onChange={(e) => {
                    setReviewScope(e.target.value as CoaScopeKindContract);
                    reviewActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="attributed_lot">attributed_lot</option>
                  <option value="sample_only">sample_only</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="coa-review-reason-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Review Reason / Audit Log:
                </label>
                <textarea
                  id="coa-review-reason-input"
                  data-testid="coa-review-reason-input"
                  value={reviewReason}
                  onChange={(e) => {
                    setReviewReason(e.target.value);
                    reviewActionIdRef.current = generateUuidV7();
                  }}
                  required
                  rows={3}
                  placeholder="Explain comparison against original laboratory PDF"
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
                  data-testid="submit-coa-review-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Recording..." : "Record Review Decision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supersede Modal */}
      {showSupersedeModal && (
        <div
          data-testid="supersede-coa-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="supersede-coa-modal-title"
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
              maxWidth: "850px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="supersede-coa-modal-title">Supersede CoA Measurement Panel</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Submits a complete replacement measurement panel. Prior revision remains immutable
              history.
            </p>

            {formError && (
              <div
                data-testid="supersede-coa-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleSupersedeCoa}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="supersede-report-id-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Report Identifier:
                  </label>
                  <input
                    id="supersede-report-id-input"
                    data-testid="supersede-report-id-input"
                    type="text"
                    value={reportIdentifier}
                    onChange={(e) => {
                      setReportIdentifier(e.target.value);
                      supersedeActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="supersede-lab-name-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Lab Name:
                  </label>
                  <input
                    id="supersede-lab-name-input"
                    data-testid="supersede-lab-name-input"
                    type="text"
                    value={labName}
                    onChange={(e) => {
                      setLabName(e.target.value);
                      supersedeActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="supersede-sample-date-input"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Sample Date:
                  </label>
                  <input
                    id="supersede-sample-date-input"
                    type="date"
                    data-testid="supersede-sample-date-input"
                    value={sampleDate}
                    onChange={(e) => {
                      setSampleDate(e.target.value);
                      supersedeActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="supersede-scope-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Scope Kind:
                  </label>
                  <select
                    id="supersede-scope-select"
                    data-testid="supersede-scope-select"
                    value={scopeKind}
                    onChange={(e) => {
                      setScopeKind(e.target.value as CoaScopeKindContract);
                      supersedeActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  >
                    <option value="attributed_lot">attributed_lot</option>
                    <option value="sample_only">sample_only</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="supersede-attestation-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Sample to Batch Association Attestation:
                </label>
                <input
                  id="supersede-attestation-input"
                  type="text"
                  data-testid="supersede-attestation-input"
                  value={associationAttestation}
                  onChange={(e) => {
                    setAssociationAttestation(e.target.value);
                    supersedeActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Sample pulled directly from lot barrel A1"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              {/* Dynamic Measurement Rows */}
              <div style={{ marginTop: "0.5rem" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.5rem"
                  }}
                >
                  <label style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                    Replacement Measurements:
                  </label>
                  <button
                    type="button"
                    onClick={handleAddMeasurementRow}
                    style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                  >
                    + Add Measurement
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  {measurements.map((row, idx) => (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "var(--bg-surface-elevated)",
                        padding: "0.75rem",
                        borderRadius: "6px",
                        border: "1px solid var(--border-subtle)"
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.2fr 1fr 1.4fr 0.9fr 0.9fr 1fr auto",
                          gap: "0.5rem",
                          alignItems: "end"
                        }}
                      >
                        <div>
                          <label
                            htmlFor={`supersede-m-analyte-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Analyte
                          </label>
                          <input
                            id={`supersede-m-analyte-${idx}`}
                            type="text"
                            placeholder="Analyte"
                            data-testid={`supersede-row-analyte-${idx}`}
                            value={row.analyte}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { analyte: e.target.value });
                              supersedeActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`supersede-m-kind-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Kind
                          </label>
                          <select
                            id={`supersede-m-kind-${idx}`}
                            value={row.resultKind}
                            data-testid={`supersede-row-kind-${idx}`}
                            onChange={(e) => {
                              const nextKind = e.target.value as CoaResultKindContract;
                              handleUpdateMeasurementRow(idx, {
                                resultKind: nextKind,
                                ...(nextKind === "below_limit" && !row.resultLimit
                                  ? {
                                      resultLimit: row.resultValue || "0.01",
                                      resultQualifier: row.resultQualifier || "lt"
                                    }
                                  : {})
                              });
                              supersedeActionIdRef.current = generateUuidV7();
                            }}
                            style={{ width: "100%", padding: "0.35rem" }}
                          >
                            <option value="quantified">quantified</option>
                            <option value="below_limit">below_limit</option>
                            <option value="not_detected">not_detected</option>
                          </select>
                        </div>
                        {row.resultKind === "quantified" && (
                          <div>
                            <label
                              htmlFor={`supersede-m-value-${idx}`}
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "var(--text-secondary)",
                                marginBottom: "0.2rem"
                              }}
                            >
                              Exact Value
                            </label>
                            <input
                              id={`supersede-m-value-${idx}`}
                              type="text"
                              placeholder="e.g. 24.5000"
                              data-testid={`supersede-row-value-${idx}`}
                              value={row.resultValue}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, { resultValue: e.target.value });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              required
                              style={{ width: "100%", padding: "0.35rem" }}
                            />
                          </div>
                        )}
                        {row.resultKind === "below_limit" && (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1.2fr 1fr",
                              gap: "0.25rem"
                            }}
                          >
                            <div>
                              <label
                                htmlFor={`supersede-m-limit-${idx}`}
                                style={{
                                  display: "block",
                                  fontSize: "0.75rem",
                                  color: "var(--text-secondary)",
                                  marginBottom: "0.2rem"
                                }}
                              >
                                Limit
                              </label>
                              <input
                                id={`supersede-m-limit-${idx}`}
                                type="text"
                                placeholder="0.01"
                                data-testid={`supersede-row-limit-${idx}`}
                                value={row.resultLimit}
                                onChange={(e) => {
                                  handleUpdateMeasurementRow(idx, { resultLimit: e.target.value });
                                  supersedeActionIdRef.current = generateUuidV7();
                                }}
                                required
                                style={{ width: "100%", padding: "0.35rem" }}
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`supersede-m-qualifier-${idx}`}
                                style={{
                                  display: "block",
                                  fontSize: "0.75rem",
                                  color: "var(--text-secondary)",
                                  marginBottom: "0.2rem"
                                }}
                              >
                                Qual
                              </label>
                              <select
                                id={`supersede-m-qualifier-${idx}`}
                                data-testid={`supersede-row-qualifier-${idx}`}
                                value={row.resultQualifier || "lt"}
                                onChange={(e) => {
                                  handleUpdateMeasurementRow(idx, {
                                    resultQualifier: e.target.value
                                  });
                                  supersedeActionIdRef.current = generateUuidV7();
                                }}
                                style={{ width: "100%", padding: "0.35rem" }}
                              >
                                <option value="lt">&lt; (lt)</option>
                                <option value="lte">&le; (lte)</option>
                              </select>
                            </div>
                          </div>
                        )}
                        {row.resultKind === "not_detected" && (
                          <div>
                            <span
                              style={{
                                display: "block",
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                marginBottom: "0.2rem"
                              }}
                            >
                              Result
                            </span>
                            <div
                              style={{
                                padding: "0.35rem",
                                fontSize: "0.8rem",
                                color: "var(--text-muted)"
                              }}
                            >
                              Not Detected
                            </div>
                          </div>
                        )}
                        <div>
                          <label
                            htmlFor={`supersede-m-unit-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Unit
                          </label>
                          <input
                            id={`supersede-m-unit-${idx}`}
                            type="text"
                            placeholder="percent"
                            data-testid={`supersede-row-unit-${idx}`}
                            value={row.unit}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { unit: e.target.value });
                              supersedeActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`supersede-m-basis-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Basis
                          </label>
                          <input
                            id={`supersede-m-basis-${idx}`}
                            type="text"
                            placeholder="dry_weight"
                            data-testid={`supersede-row-basis-${idx}`}
                            value={row.basis}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { basis: e.target.value });
                              supersedeActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <div>
                          <label
                            htmlFor={`supersede-m-context-${idx}`}
                            style={{
                              display: "block",
                              fontSize: "0.75rem",
                              color: "var(--text-secondary)",
                              marginBottom: "0.2rem"
                            }}
                          >
                            Context
                          </label>
                          <input
                            id={`supersede-m-context-${idx}`}
                            type="text"
                            placeholder="cannabinoid"
                            data-testid={`supersede-row-context-${idx}`}
                            value={row.context}
                            onChange={(e) => {
                              handleUpdateMeasurementRow(idx, { context: e.target.value });
                              supersedeActionIdRef.current = generateUuidV7();
                            }}
                            required
                            style={{ width: "100%", padding: "0.35rem" }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveMeasurementRow(idx)}
                          disabled={measurements.length === 1}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            padding: "0.35rem"
                          }}
                          aria-label={`Remove measurement row ${idx + 1}`}
                        >
                          ✕
                        </button>
                      </div>

                      <details style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                        <summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>
                          Advanced Analytical Details (Quantity Kind, Method, Uncertainty, LOD/LOQ)
                        </summary>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr 1fr",
                            gap: "0.4rem",
                            marginTop: "0.4rem"
                          }}
                        >
                          <div>
                            <label
                              htmlFor={`supersede-m-qkind-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Quantity Kind
                            </label>
                            <input
                              id={`supersede-m-qkind-${idx}`}
                              type="text"
                              data-testid={`supersede-row-qkind-${idx}`}
                              value={row.quantityKind}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, { quantityKind: e.target.value });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`supersede-m-method-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Method
                            </label>
                            <input
                              id={`supersede-m-method-${idx}`}
                              type="text"
                              placeholder="HPLC-DAD"
                              data-testid={`supersede-row-method-${idx}`}
                              value={row.methodAsReported}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  methodAsReported: e.target.value
                                });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`supersede-m-uncertainty-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Uncertainty
                            </label>
                            <input
                              id={`supersede-m-uncertainty-${idx}`}
                              type="text"
                              placeholder="e.g. 0.05"
                              data-testid={`supersede-row-uncertainty-${idx}`}
                              value={row.uncertaintyAbsolute || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  uncertaintyAbsolute: e.target.value
                                });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`supersede-m-lod-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              LOD
                            </label>
                            <input
                              id={`supersede-m-lod-${idx}`}
                              type="text"
                              placeholder="LOD"
                              value={row.detectionLimit || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, { detectionLimit: e.target.value });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`supersede-m-loq-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              LOQ
                            </label>
                            <input
                              id={`supersede-m-loq-${idx}`}
                              type="text"
                              placeholder="LOQ"
                              data-testid={`supersede-row-loq-${idx}`}
                              value={row.quantificationLimit || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  quantificationLimit: e.target.value
                                });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`supersede-m-qualcode-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Qualifier Code
                            </label>
                            <input
                              id={`supersede-m-qualcode-${idx}`}
                              type="text"
                              placeholder="e.g. J"
                              data-testid={`supersede-row-qualcode-${idx}`}
                              value={row.analyticalQualifierCode || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  analyticalQualifierCode: e.target.value
                                });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`supersede-m-qualexpl-${idx}`}
                              style={{ display: "block", fontSize: "0.75rem" }}
                            >
                              Qualifier Explanation
                            </label>
                            <input
                              id={`supersede-m-qualexpl-${idx}`}
                              type="text"
                              placeholder="Explain qualifier code"
                              data-testid={`supersede-row-qualexpl-${idx}`}
                              value={row.analyticalQualifierExplanation || ""}
                              onChange={(e) => {
                                handleUpdateMeasurementRow(idx, {
                                  analyticalQualifierExplanation: e.target.value
                                });
                                supersedeActionIdRef.current = generateUuidV7();
                              }}
                              style={{ width: "100%", padding: "0.3rem" }}
                            />
                          </div>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowSupersedeModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-supersede-coa-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Superseding..." : "Submit Superseding Revision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
