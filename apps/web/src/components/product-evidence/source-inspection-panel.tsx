"use client";

import React, { useEffect, useRef, useState } from "react";
import type { BatchEvidencePurpose, ReportedCapturePrecision } from "@cco/shared";
import { generateUuidV7 } from "@cco/shared";
import type {
  ConsentStatusContract,
  DossierEvidenceItem,
  EvidenceAcquisitionMethodContract,
  EvidenceMediaDeliveryResponse,
  EvidenceSourceClassContract,
  LegalRightsStatusContract,
  LinkEvidenceDerivativeRequest,
  RecordEvidenceVerificationEventRequest,
  VerificationFactScopeContract,
  VerificationKindContract,
  VerificationOutcomeContract
} from "@cco/contracts";
import {
  fetchEvidenceMedia,
  linkEvidenceDerivative,
  recordEvidenceVerificationEvent,
  registerEvidenceAssetMultipart,
  registerEvidenceAssetReuse,
  ProductEvidenceApiError
} from "../../api/product-evidence-client";
import { formatByteLength, formatUtcDateTime } from "./format-decimal";
import {
  DerivativeBadge,
  IndependentlyCorroboratedBadge,
  OperatorAttestedBadge,
  OperatorReviewedBadge,
  UnknownBadge,
  BlockedBadge
} from "./provenance-badges";

export interface SourceInspectionPanelProps {
  readonly clientId: string;
  readonly batchId: string;
  readonly evidence: readonly DossierEvidenceItem[];
  readonly onDossierUpdated: () => void;
  readonly isRefreshing?: boolean;
}

export function SourceInspectionPanel({
  clientId,
  batchId,
  evidence,
  onDossierUpdated,
  isRefreshing = false
}: SourceInspectionPanelProps): React.ReactElement {
  const [activeMedia, setActiveMedia] = useState<{
    evidenceId: string;
    revision: number;
    delivery?: EvidenceMediaDeliveryResponse | null;
    error?: string;
    isLoading?: boolean;
    // True when this revision was the asset's current head at the moment
    // the viewer was opened. Deliberately inspecting an older revision via
    // the revision history list (exact historic source inspection) is a
    // supported workflow and must stay open even though it is not current;
    // only a viewer that WAS current and has since been superseded while
    // open should be auto-invalidated.
    openedAsCurrentRevision?: boolean;
  } | null>(null);

  const mediaRequestIdRef = useRef(0);
  const registerActionIdRef = useRef(generateUuidV7());
  const derivativeActionIdRef = useRef(generateUuidV7());
  const verifyActionIdRef = useRef(generateUuidV7());

  // Clear active media on scope change. Bumping mediaRequestIdRef here (not
  // just clearing state) ensures an in-flight fetchEvidenceMedia request
  // started under the PREVIOUS scope cannot resurrect activeMedia after it
  // resolves: handleInspectMedia's requestId check will no longer match.
  useEffect(() => {
    mediaRequestIdRef.current++;
    setActiveMedia(null);
  }, [clientId, batchId]);

  // Clear active media if currently viewed evidence is no longer available
  // or was superseded. A viewer deliberately opened on an older revision
  // (exact historic source inspection, via the revision history list) stays
  // open even though it is not current; a viewer that WAS current when
  // opened and has since been superseded while still open must not keep
  // reading as a live inspection of the current source.
  useEffect(() => {
    if (!activeMedia) return;
    const current = evidence.find((e) => e.asset.evidenceId === activeMedia.evidenceId);
    const targetRev = current?.revisions.find((r) => r.revision === activeMedia.revision);
    const targetSource = targetRev
      ? current?.sourceObjects.find((s) => s.sourceObjectId === targetRev.sourceObjectId)
      : null;
    const isAvailable =
      targetSource &&
      (("availabilityStatus" in targetSource && targetSource.availabilityStatus === "available") ||
        ("availability" in targetSource && targetSource.availability === "available"));
    const supersededWhileOpen =
      activeMedia.openedAsCurrentRevision === true &&
      current !== undefined &&
      current.asset.currentRevision !== activeMedia.revision;

    if (!current || !targetRev || !isAvailable || supersededWhileOpen) {
      // Also invalidate any in-flight lookup for the now-stale scope so a
      // late response cannot re-populate activeMedia after this clears it.
      mediaRequestIdRef.current++;
      setActiveMedia(null);
    }
  }, [evidence, activeMedia?.evidenceId, activeMedia?.revision]);

  // Expiration timer for active media URL
  useEffect(() => {
    if (!activeMedia?.delivery) return;
    const expiresAtMs = new Date(activeMedia.delivery.expiresAt).getTime();
    const delay = Math.max(0, expiresAtMs - Date.now());
    const timer = setTimeout(() => {
      setActiveMedia((curr) =>
        curr && curr.delivery
          ? {
              ...curr,
              delivery: null,
              error: "Inspection media access has expired (300-second TTL). Please re-authorize."
            }
          : curr
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [activeMedia?.delivery]);

  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerMode, setRegisterMode] = useState<"upload" | "reuse">("upload");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Upload fields
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState<BatchEvidencePurpose>("macro_hero_photo");
  const [registrationIntent, setRegistrationIntent] = useState<
    "initial_assertion" | "new_batch_assertion" | "supersede"
  >("initial_assertion");
  const [sourceClass, setSourceClass] = useState<EvidenceSourceClassContract>("photo");
  const [acquisitionMethod, setAcquisitionMethod] =
    useState<EvidenceAcquisitionMethodContract>("direct_upload");
  const [declaredMimeType, setDeclaredMimeType] = useState("image/png");
  const [reportedCaptureDate, setReportedCaptureDate] = useState("");
  const [reportedPrecision, setReportedPrecision] = useState<ReportedCapturePrecision>("date");
  const [captureContext, setCaptureContext] = useState("");
  const [assertionText, setAssertionText] = useState("Original product evidence capture");
  const [rightsStatus, setRightsStatus] = useState<LegalRightsStatusContract>("unknown");
  const [consentStatus, setConsentStatus] = useState<ConsentStatusContract>("unknown");
  const [rightsAttribution, setRightsAttribution] = useState("");
  const [targetEvidenceId, setTargetEvidenceId] = useState("");
  const [expectedEvidenceVersion, setExpectedEvidenceVersion] = useState<number>(1);
  const [reusedSourceObjectId, setReusedSourceObjectId] = useState("");

  // Derivative modal
  const [showDerivativeModal, setShowDerivativeModal] = useState<{
    evidenceId: string;
    revision: number;
  } | null>(null);
  const [refAssetId, setRefAssetId] = useState("");
  const [transformHash, setTransformHash] = useState("");
  const [transformDescription, setTransformDescription] = useState(
    "Render reference asset transform"
  );

  // Verification event modal
  const [showVerifyModal, setShowVerifyModal] = useState<{
    evidenceId: string;
    revision: number;
  } | null>(null);
  const [verifyKind, setVerifyKind] = useState<VerificationKindContract>(
    "independent_third_party_corroboration"
  );
  const [verifyOutcome, setVerifyOutcome] = useState<VerificationOutcomeContract>("verified");
  const [verifyScope, setVerifyScope] =
    useState<VerificationFactScopeContract>("provenance_metadata");
  const [verifyMethod, setVerifyMethod] = useState("third_party_audit");
  const [verifyReason, setVerifyReason] = useState("");
  const [corroboratingParty, setCorroboratingParty] = useState("");
  const [withdrawalTargetId, setWithdrawalTargetId] = useState("");

  const handleInspectMedia = async (evidenceId: string, revision: number) => {
    const requestId = ++mediaRequestIdRef.current;
    const assetAtOpen = evidence.find((e) => e.asset.evidenceId === evidenceId);
    const openedAsCurrentRevision = assetAtOpen?.asset.currentRevision === revision;
    setActiveMedia({ evidenceId, revision, isLoading: true, openedAsCurrentRevision });
    try {
      const delivery = await fetchEvidenceMedia(clientId, batchId, evidenceId, revision);
      if (requestId === mediaRequestIdRef.current) {
        setActiveMedia({
          evidenceId,
          revision,
          delivery,
          isLoading: false,
          openedAsCurrentRevision
        });
      }
    } catch (err) {
      if (requestId === mediaRequestIdRef.current) {
        const msg =
          err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err);
        setActiveMedia({
          evidenceId,
          revision,
          error: msg,
          isLoading: false,
          openedAsCurrentRevision
        });
      }
    }
  };

  const handleCloseMedia = () => {
    mediaRequestIdRef.current++;
    setActiveMedia(null);
  };

  const handleRegisterEvidence = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      const actionId = registerActionIdRef.current;
      if (registerMode === "upload") {
        if (!uploadFile) {
          setFormError("Please select a file to upload.");
          setIsSubmitting(false);
          return;
        }

        const metadata = {
          actionId,
          batchId,
          purpose,
          sourceClass,
          registrationIntent,
          declaredMimeType: declaredMimeType || uploadFile.type,
          acquisitionMethod,
          assertionText: assertionText.trim() || "Original source capture",
          ...(reportedCaptureDate ? { reportedCaptureDate } : {}),
          reportedCapturePrecision: reportedPrecision,
          ...(captureContext.trim() ? { captureContext: captureContext.trim() } : {}),
          rightsStatus,
          consentStatus,
          ...(rightsAttribution.trim() ? { rightsAttribution: rightsAttribution.trim() } : {}),
          ...(registrationIntent === "supersede"
            ? {
                targetEvidenceId,
                expectedEvidenceVersion: Number(expectedEvidenceVersion)
              }
            : {})
        };

        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("metadata", JSON.stringify(metadata));

        await registerEvidenceAssetMultipart(clientId, batchId, formData);
      } else {
        await registerEvidenceAssetReuse(clientId, batchId, {
          actionId,
          batchId,
          purpose,
          sourceClass,
          registrationIntent,
          declaredMimeType,
          acquisitionMethod,
          assertionText: assertionText.trim() || "Reused source object",
          reusedSourceObjectId: reusedSourceObjectId.trim(),
          ...(reportedCaptureDate ? { reportedCaptureDate } : {}),
          reportedCapturePrecision: reportedPrecision,
          ...(captureContext.trim() ? { captureContext: captureContext.trim() } : {}),
          rightsStatus,
          consentStatus,
          ...(rightsAttribution.trim() ? { rightsAttribution: rightsAttribution.trim() } : {}),
          ...(registrationIntent === "supersede"
            ? {
                targetEvidenceId,
                expectedEvidenceVersion: Number(expectedEvidenceVersion)
              }
            : {})
        });
      }

      registerActionIdRef.current = generateUuidV7();
      setShowRegisterModal(false);
      setUploadFile(null);
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
  const handleLinkDerivative = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showDerivativeModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const actionId = derivativeActionIdRef.current;
      const req: LinkEvidenceDerivativeRequest = {
        actionId,
        evidenceId: showDerivativeModal.evidenceId,
        evidenceRevision: showDerivativeModal.revision,
        referenceAssetId: refAssetId.trim(),
        derivativeSha256: transformHash.trim(),
        transformDescription: transformDescription.trim()
      };
      await linkEvidenceDerivative(
        clientId,
        batchId,
        showDerivativeModal.evidenceId,
        showDerivativeModal.revision,
        req
      );
      derivativeActionIdRef.current = generateUuidV7();
      setShowDerivativeModal(null);
      setRefAssetId("");
      setTransformHash("");
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        // The pinned evidenceId/revision this modal targets is now stale;
        // reload and require a deliberate reopen rather than retry against
        // a revision that will only conflict again.
        onDossierUpdated();
        derivativeActionIdRef.current = generateUuidV7();
        setShowDerivativeModal(null);
        setFormError(
          "This evidence was changed in the meantime. Reloaded the current state; please reopen to resubmit."
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

  const handleRecordVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showVerifyModal) return;
    setIsSubmitting(true);
    setFormError(null);

    try {
      const actionId = verifyActionIdRef.current;
      const req: RecordEvidenceVerificationEventRequest = {
        actionId,
        evidenceId: showVerifyModal.evidenceId,
        evidenceRevision: showVerifyModal.revision,
        outcome: verifyOutcome,
        verificationKind: verifyKind,
        factScope: verifyScope,
        method: verifyMethod.trim(),
        reason: verifyReason.trim(),
        ...(corroboratingParty.trim() ? { verifiedPartyReference: corroboratingParty.trim() } : {}),
        ...(withdrawalTargetId.trim() ? { withdrawalEventId: withdrawalTargetId.trim() } : {})
      };
      await recordEvidenceVerificationEvent(
        clientId,
        batchId,
        showVerifyModal.evidenceId,
        showVerifyModal.revision,
        req
      );
      verifyActionIdRef.current = generateUuidV7();
      setShowVerifyModal(null);
      setVerifyReason("");
      setCorroboratingParty("");
      setWithdrawalTargetId("");
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        onDossierUpdated();
        verifyActionIdRef.current = generateUuidV7();
        setShowVerifyModal(null);
        setFormError(
          "This evidence was changed in the meantime. Reloaded the current state; please reopen to resubmit."
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
      id="source-evidence-section"
      data-testid="source-evidence-section"
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
          <h2>Source Evidence &amp; Provenance</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Immutable original capture media and corroboration records. Safe projection without
            storage paths.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowRegisterModal(true);
          }}
          disabled={isRefreshing}
          className="stage-draft-button"
          data-testid="register-evidence-button"
          style={{ padding: "0.4rem 0.8rem", fontSize: "0.875rem" }}
        >
          + Register Evidence
        </button>
      </div>

      {isRefreshing && (
        <div
          data-testid="source-stale-banner"
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: "#451a03",
            border: "1px solid #f59e0b",
            borderRadius: "4px",
            color: "#fef3c7",
            fontSize: "0.85rem",
            marginBottom: "1rem"
          }}
        >
          Dossier is refreshing. Evidence registration and verification controls are temporarily
          disabled to prevent stale decisions.
        </div>
      )}

      {evidence.length === 0 ? (
        <div
          data-testid="empty-evidence-message"
          style={{ padding: "1.5rem", backgroundColor: "var(--bg-surface)", borderRadius: "8px" }}
        >
          <UnknownBadge detail="No source evidence registered for this batch" />
          <p style={{ marginTop: "0.5rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Register original photographs, CoA scans, or packaging capture to anchor product claims.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {evidence.map((item) => {
            const rev = item.currentRevision;
            const sourceObj = rev?.sourceObjectId
              ? item.sourceObjects?.find((s) => s.sourceObjectId === rev.sourceObjectId)
              : undefined;

            return (
              <div
                key={item.asset.evidenceId}
                id={`evidence-item-${item.asset.evidenceId}`}
                data-testid={`evidence-item-${item.asset.evidenceId}`}
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
                        fontSize: "1rem",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem"
                      }}
                    >
                      Evidence {item.asset.evidenceId.slice(0, 8)}…
                      {item.asset.archivedAt && <BlockedBadge detail="Archived" />}
                    </h3>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-secondary)",
                        marginTop: "0.25rem"
                      }}
                    >
                      Revision: {item.asset.currentRevision} • Version: {item.asset.version} •
                      Created: {formatUtcDateTime(item.asset.createdAt)}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      type="button"
                      data-testid={`inspect-media-button-${item.asset.evidenceId}`}
                      onClick={() =>
                        handleInspectMedia(item.asset.evidenceId, item.asset.currentRevision)
                      }
                      disabled={isRefreshing}
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
                      Inspect Original Media
                    </button>
                    <button
                      type="button"
                      data-testid={`link-derivative-button-${item.asset.evidenceId}`}
                      onClick={() => {
                        setFormError(null);
                        setShowDerivativeModal({
                          evidenceId: item.asset.evidenceId,
                          revision: item.asset.currentRevision
                        });
                      }}
                      disabled={isRefreshing}
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
                      + Derivative Link
                    </button>
                    <button
                      type="button"
                      data-testid={`record-verification-button-${item.asset.evidenceId}`}
                      onClick={() => {
                        setFormError(null);
                        setShowVerifyModal({
                          evidenceId: item.asset.evidenceId,
                          revision: item.asset.currentRevision
                        });
                      }}
                      disabled={isRefreshing}
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
                      + Verification Event
                    </button>
                  </div>
                </div>

                {/* Safe Source Object Details */}
                {sourceObj ? (
                  <div
                    style={{
                      marginTop: "1rem",
                      fontSize: "0.85rem",
                      backgroundColor: "var(--bg-surface-elevated)",
                      padding: "0.75rem",
                      borderRadius: "6px"
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: "0.25rem",
                        color: "var(--text-primary)"
                      }}
                    >
                      Cryptographic Source Object (Safe Projection)
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "0.5rem"
                      }}
                    >
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>SHA-256: </span>
                        <code
                          data-testid="source-sha256"
                          style={{ fontSize: "0.75rem", wordBreak: "break-all" }}
                        >
                          {sourceObj.originalSha256}
                        </code>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>MIME: </span>
                        <span>{sourceObj.detectedMimeType}</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Size: </span>
                        <span>{formatByteLength(sourceObj.byteLength)}</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Availability: </span>
                        <span data-testid="source-availability">{sourceObj.availability}</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Uploaded: </span>
                        <span>{formatUtcDateTime(sourceObj.uploadedAt)}</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Retention: </span>
                        <span>
                          {sourceObj.retentionClass} (v{sourceObj.retentionPolicyVersion})
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: "0.75rem" }}>
                    <UnknownBadge detail="No source object attached" />
                  </div>
                )}

                {/* Capture & Context Details */}
                {rev && (
                  <div
                    style={{
                      marginTop: "0.75rem",
                      fontSize: "0.85rem",
                      color: "var(--text-secondary)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.25rem"
                    }}
                  >
                    <div>
                      <span>
                        Capture Date:{" "}
                        {rev.reportedCaptureDate || <UnknownBadge detail="Date Unknown" />}{" "}
                      </span>
                      {rev.reportedCapturePrecision && (
                        <span>(Precision: {rev.reportedCapturePrecision}) </span>
                      )}
                      {rev.acquisitionMethod && <span>• Method: {rev.acquisitionMethod} </span>}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                        flexWrap: "wrap"
                      }}
                    >
                      <span>Provenance: </span>
                      <OperatorAttestedBadge detail={`Submitter: ${rev.submittedBy}`} />
                      <span>at {formatUtcDateTime(rev.submittedAt)}</span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        alignItems: "center",
                        flexWrap: "wrap"
                      }}
                    >
                      <span>Rights &amp; Consent: </span>
                      {rev.rightsStatus === "unknown" ? (
                        <UnknownBadge detail="Rights Unknown" />
                      ) : (
                        <span data-testid="evidence-rights-status" style={{ fontWeight: 600 }}>
                          Rights: {rev.rightsStatus}
                        </span>
                      )}
                      {rev.consentStatus === "unknown" ? (
                        <UnknownBadge detail="Consent Unknown" />
                      ) : (
                        <span data-testid="evidence-consent-status" style={{ fontWeight: 600 }}>
                          Consent: {rev.consentStatus}
                        </span>
                      )}
                      {rev.rightsAttribution && (
                        <span
                          data-testid="evidence-rights-attribution"
                          style={{ color: "var(--text-muted)" }}
                        >
                          ({rev.rightsAttribution})
                        </span>
                      )}
                    </div>

                    {rev.captureContext && <div>Context: {rev.captureContext}</div>}
                    {rev.assertionText && <div>Assertion: {rev.assertionText}</div>}
                  </div>
                )}

                {/* Revision Lineage History */}
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
                      Evidence Revision Lineage ({item.revisions.length}):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                      {item.revisions.map((r) => {
                        const rSourceObj = item.sourceObjects?.find(
                          (s) => s.sourceObjectId === r.sourceObjectId
                        );
                        const isCurrent = r.revision === item.asset.currentRevision;
                        return (
                          <div
                            key={r.revision}
                            id={`evidence-revision-${item.asset.evidenceId}-${r.revision}`}
                            data-testid={`evidence-revision-${item.asset.evidenceId}-${r.revision}`}
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
                              {r.supersedesRevision && (
                                <span> supersedes Rev {r.supersedesRevision}</span>
                              )}
                              {" • "}
                              <span>
                                SHA:{" "}
                                {rSourceObj
                                  ? `${rSourceObj.originalSha256.slice(0, 8)}…`
                                  : "No object"}
                              </span>
                              {" • "}
                              <span>
                                By: {r.submittedBy} ({formatUtcDateTime(r.submittedAt)})
                              </span>
                              {" • "}
                              <span>Rights: {r.rightsStatus}</span>
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
                            <button
                              type="button"
                              onClick={() => handleInspectMedia(item.asset.evidenceId, r.revision)}
                              disabled={isRefreshing}
                              style={{
                                padding: "0.2rem 0.5rem",
                                fontSize: "0.75rem",
                                borderRadius: "4px",
                                border: "1px solid var(--border-subtle)",
                                cursor: "pointer"
                              }}
                            >
                              Inspect Rev {r.revision} Media
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Derivatives */}
                {item.derivatives.length > 0 && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginBottom: "0.25rem"
                      }}
                    >
                      Associated Derivatives (Not Original Source):
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {item.derivatives.map((deriv) => (
                        <div
                          key={deriv.derivativeId}
                          data-testid={`derivative-${deriv.derivativeId}`}
                          style={{
                            padding: "0.25rem 0.5rem",
                            border: "1px dashed var(--border-prominent)",
                            borderRadius: "4px",
                            fontSize: "0.75rem"
                          }}
                        >
                          <DerivativeBadge detail={deriv.transformDescription} />
                          <span style={{ marginLeft: "0.25rem" }}>
                            Ref: {deriv.referenceAssetId.slice(0, 8)}… (SHA:{" "}
                            {deriv.derivativeSha256.slice(0, 8)}…)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Verification Events */}
                {item.verificationEvents.length > 0 && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginBottom: "0.25rem"
                      }}
                    >
                      Verification Events:
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                      {(() => {
                        // A later "withdrawn" event references the original
                        // positive event it supersedes via withdrawalEventId.
                        // A positive event targeted this way is no longer
                        // effective and must not still read as a live,
                        // currently-independent/corroborated/reviewed badge.
                        const effectivelyWithdrawnIds = new Set(
                          item.verificationEvents
                            .filter((e) => e.outcome === "withdrawn" && e.withdrawalEventId)
                            .map((e) => e.withdrawalEventId as string)
                        );
                        return item.verificationEvents.map((evt) => {
                          const isEffectivelyWithdrawn = effectivelyWithdrawnIds.has(evt.eventId);
                          return (
                            <div
                              key={evt.eventId}
                              data-testid={`verification-event-${evt.eventId}`}
                              style={{
                                padding: "0.3rem 0.5rem",
                                backgroundColor: "var(--bg-surface-elevated)",
                                borderRadius: "4px",
                                fontSize: "0.75rem",
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem"
                              }}
                            >
                              {evt.outcome === "withdrawn" ||
                              evt.outcome === "disputed" ||
                              evt.outcome === "rejected" ? (
                                <BlockedBadge
                                  detail={`${evt.outcome} • ${evt.factScope} (Rev ${evt.evidenceRevision})`}
                                  testId={`verification-outcome-${evt.eventId}`}
                                />
                              ) : isEffectivelyWithdrawn ? (
                                <BlockedBadge
                                  detail={`superseded by withdrawal • ${evt.factScope} (Rev ${evt.evidenceRevision})`}
                                  testId={`verification-outcome-${evt.eventId}`}
                                />
                              ) : evt.outcome === "verified" &&
                                (evt.verificationKind === "independent_third_party_corroboration" ||
                                  (evt.verificationKind as string) ===
                                    "independent_third_party_verification" ||
                                  (evt.verificationKind as string) ===
                                    "cryptographic_issuer_signature") ? (
                                <IndependentlyCorroboratedBadge
                                  detail={`Independently Sourced • ${evt.factScope} (Rev ${evt.evidenceRevision})`}
                                  testId={`verification-outcome-${evt.eventId}`}
                                />
                              ) : evt.outcome === "verified" &&
                                evt.verificationKind === "human_internal_review" ? (
                                <OperatorReviewedBadge
                                  detail={`Operator Reviewed • ${evt.factScope} (Rev ${evt.evidenceRevision})`}
                                  isApproved={true}
                                  testId={`verification-outcome-${evt.eventId}`}
                                />
                              ) : evt.outcome === "verified" &&
                                evt.verificationKind === "submitter_attestation" ? (
                                <OperatorAttestedBadge
                                  detail={`Submitter Attested • ${evt.factScope} (Rev ${evt.evidenceRevision})`}
                                  testId={`verification-outcome-${evt.eventId}`}
                                />
                              ) : (
                                <UnknownBadge
                                  detail={`${evt.verificationKind} (${evt.outcome}) • ${evt.factScope} (Rev ${evt.evidenceRevision})`}
                                  testId={`verification-outcome-${evt.eventId}`}
                                />
                              )}
                              <span>
                                {evt.method} by {evt.verifiedPartyReference || evt.actorId}:{" "}
                                {evt.reason} ({formatUtcDateTime(evt.occurredAt)})
                                {evt.withdrawalEventId &&
                                  ` [Withdraws ${evt.withdrawalEventId.slice(0, 8)}…]`}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Ephemeral Media Modal / Viewer */}
      {activeMedia && (
        <div
          data-testid="media-inspection-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="media-inspection-title"
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
              maxWidth: "800px",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem"
              }}
            >
              <h3 id="media-inspection-title" style={{ fontSize: "1.1rem" }}>
                Original Source Media Inspection
              </h3>
              <button
                type="button"
                onClick={handleCloseMedia}
                aria-label="Close Inspection"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.25rem"
                }}
              >
                ✕ Close Inspection
              </button>
            </div>

            {activeMedia.isLoading && (
              <div data-testid="media-loading">Loading authorized source media...</div>
            )}

            {activeMedia.error && (
              <div
                data-testid="media-error"
                style={{
                  color: "#ef4444",
                  padding: "1rem",
                  backgroundColor: "#450a0a",
                  borderRadius: "6px"
                }}
              >
                <BlockedBadge detail="Delivery Denied" />
                <p style={{ marginTop: "0.5rem" }}>{activeMedia.error}</p>
                <button
                  type="button"
                  onClick={() => handleInspectMedia(activeMedia.evidenceId, activeMedia.revision)}
                  style={{ marginTop: "0.5rem", padding: "0.3rem 0.6rem", fontSize: "0.8rem" }}
                >
                  Retry Media Authorization
                </button>
              </div>
            )}

            {activeMedia.delivery && (
              <div data-testid="media-content">
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--text-secondary)",
                    marginBottom: "0.75rem"
                  }}
                >
                  <span>Original SHA: {activeMedia.delivery.originalSha256.slice(0, 16)}… </span>
                  <span>• Type: {activeMedia.delivery.detectedMimeType} </span>
                  <span>• Size: {formatByteLength(activeMedia.delivery.byteLength)} </span>
                  <div>
                    Expires in 300 seconds (at {formatUtcDateTime(activeMedia.delivery.expiresAt)})
                  </div>
                </div>

                {activeMedia.delivery.detectedMimeType.startsWith("image/") ? (
                  <img
                    data-testid="inspected-media-image"
                    src={activeMedia.delivery.url}
                    alt="Inspected Original Source Media"
                    onError={() =>
                      setActiveMedia((curr) =>
                        curr
                          ? {
                              ...curr,
                              delivery: null,
                              error: "Failed to render media image in browser."
                            }
                          : curr
                      )
                    }
                    style={{
                      maxWidth: "100%",
                      maxHeight: "500px",
                      objectFit: "contain",
                      borderRadius: "4px"
                    }}
                  />
                ) : activeMedia.delivery.detectedMimeType === "application/pdf" ? (
                  <div>
                    <iframe
                      data-testid="inspected-source-pdf"
                      src={activeMedia.delivery.url}
                      title="Inspected PDF"
                      onError={() =>
                        setActiveMedia((curr) =>
                          curr
                            ? {
                                ...curr,
                                delivery: null,
                                error: "Failed to render PDF preview in browser."
                              }
                            : curr
                        )
                      }
                      style={{
                        width: "100%",
                        height: "450px",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "4px"
                      }}
                    />
                    <div style={{ marginTop: "0.5rem" }}>
                      <a
                        href={activeMedia.delivery.url}
                        target="_blank"
                        rel="noreferrer"
                        data-testid="pdf-safe-open-link"
                        style={{ fontSize: "0.85rem" }}
                      >
                        Open PDF in Secure Viewer ↗
                      </a>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p>Binary format: {activeMedia.delivery.detectedMimeType}</p>
                    <a href={activeMedia.delivery.url} target="_blank" rel="noreferrer" download>
                      Download Original Bytes
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Register Evidence Modal */}
      {showRegisterModal && (
        <div
          data-testid="register-evidence-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="register-evidence-title"
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
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem"
              }}
            >
              <h3 id="register-evidence-title">Register Source Evidence</h3>
              <button
                type="button"
                onClick={() => setShowRegisterModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-secondary)",
                  fontSize: "1.2rem",
                  cursor: "pointer"
                }}
              >
                ✕
              </button>
            </div>

            {formError && (
              <div
                data-testid="register-error"
                style={{ color: "#ef4444", marginBottom: "1rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleRegisterEvidence}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div style={{ display: "flex", gap: "1rem" }}>
                <label>
                  <input
                    type="radio"
                    name="registerMode"
                    value="upload"
                    checked={registerMode === "upload"}
                    onChange={() => {
                      setRegisterMode("upload");
                      registerActionIdRef.current = generateUuidV7();
                    }}
                  />{" "}
                  Upload New File
                </label>
                <label>
                  <input
                    type="radio"
                    name="registerMode"
                    value="reuse"
                    checked={registerMode === "reuse"}
                    onChange={() => {
                      setRegisterMode("reuse");
                      registerActionIdRef.current = generateUuidV7();
                    }}
                  />{" "}
                  Reuse Known Source Object ID
                </label>
              </div>

              {registerMode === "upload" ? (
                <div>
                  <label
                    htmlFor="reg-evidence-file"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Source Media File:
                  </label>
                  <input
                    id="reg-evidence-file"
                    type="file"
                    data-testid="evidence-file-input"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setUploadFile(file);
                      registerActionIdRef.current = generateUuidV7();
                      if (file) {
                        setDeclaredMimeType(file.type || "image/png");
                        if (file.type === "application/pdf") {
                          setSourceClass("coa");
                        }
                      }
                    }}
                    required
                  />
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="reg-reuse-source-id"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Source Object ID (UUID):
                  </label>
                  <input
                    id="reg-reuse-source-id"
                    type="text"
                    data-testid="reuse-source-id-input"
                    value={reusedSourceObjectId}
                    onChange={(e) => {
                      setReusedSourceObjectId(e.target.value);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="00000000-0000-7000-8000-000000000000"
                    required
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="reg-intent-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Registration Intent:
                  </label>
                  <select
                    id="reg-intent-select"
                    data-testid="registration-intent-select"
                    value={registrationIntent}
                    onChange={(e) => {
                      setRegistrationIntent(
                        e.target.value as "initial_assertion" | "new_batch_assertion" | "supersede"
                      );
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  >
                    <option value="initial_assertion">initial_assertion</option>
                    <option value="new_batch_assertion">new_batch_assertion</option>
                    <option value="supersede">supersede</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="reg-purpose-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Purpose:
                  </label>
                  <select
                    id="reg-purpose-select"
                    data-testid="evidence-purpose-select"
                    value={purpose}
                    onChange={(e) => {
                      setPurpose(e.target.value as BatchEvidencePurpose);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  >
                    <option value="macro_hero_photo">macro_hero_photo</option>
                    <option value="coa_test_report">coa_test_report</option>
                    <option value="cultivation_log">cultivation_log</option>
                    <option value="processing_record">processing_record</option>
                    <option value="packaging_spec">packaging_spec</option>
                    <option value="general_supporting_evidence">general_supporting_evidence</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="reg-source-class-select"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Source Class:
                  </label>
                  <select
                    id="reg-source-class-select"
                    data-testid="source-class-select"
                    value={sourceClass}
                    onChange={(e) => {
                      setSourceClass(e.target.value as EvidenceSourceClassContract);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  >
                    <option value="photo">photo</option>
                    <option value="coa">coa</option>
                    <option value="document">document</option>
                    <option value="raw">raw</option>
                    <option value="video">video</option>
                    <option value="process_record">process_record</option>
                  </select>
                </div>
              </div>

              {registrationIntent === "supersede" && (
                <>
                  <div>
                    <label
                      htmlFor="reg-target-evidence-id"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Target Evidence ID to Supersede:
                    </label>
                    <input
                      id="reg-target-evidence-id"
                      type="text"
                      data-testid="target-evidence-id-input"
                      value={targetEvidenceId}
                      onChange={(e) => {
                        setTargetEvidenceId(e.target.value);
                        registerActionIdRef.current = generateUuidV7();
                      }}
                      placeholder="UUID"
                      required
                      style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="reg-expected-version"
                      style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                    >
                      Expected Evidence Version:
                    </label>
                    <input
                      id="reg-expected-version"
                      type="number"
                      data-testid="expected-version-input"
                      value={expectedEvidenceVersion}
                      onChange={(e) => {
                        setExpectedEvidenceVersion(Number(e.target.value));
                        registerActionIdRef.current = generateUuidV7();
                      }}
                      min={1}
                      required
                      style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                    />
                  </div>
                </>
              )}

              <div>
                <label
                  htmlFor="reg-acquisition-method-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Acquisition Method:
                </label>
                <select
                  id="reg-acquisition-method-select"
                  data-testid="acquisition-method-select"
                  value={acquisitionMethod}
                  onChange={(e) => {
                    setAcquisitionMethod(e.target.value as EvidenceAcquisitionMethodContract);
                    registerActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                >
                  <option value="direct_upload">direct_upload</option>
                  <option value="supplier_submission">supplier_submission</option>
                  <option value="field_capture">field_capture</option>
                  <option value="lab_transfer">lab_transfer</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="reg-capture-date"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Reported Capture Date:
                  </label>
                  <input
                    id="reg-capture-date"
                    type="date"
                    data-testid="capture-date-input"
                    value={reportedCaptureDate}
                    onChange={(e) => {
                      setReportedCaptureDate(e.target.value);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="reg-capture-precision"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Capture Precision:
                  </label>
                  <select
                    id="reg-capture-precision"
                    data-testid="capture-precision-select"
                    value={reportedPrecision}
                    onChange={(e) => {
                      setReportedPrecision(e.target.value as ReportedCapturePrecision);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  >
                    <option value="date">date</option>
                    <option value="minute">minute</option>
                    <option value="second">second</option>
                    <option value="millisecond">millisecond</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-capture-context"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Capture Context:
                </label>
                <input
                  id="reg-capture-context"
                  type="text"
                  data-testid="capture-context-input"
                  value={captureContext}
                  onChange={(e) => {
                    setCaptureContext(e.target.value);
                    registerActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Lab counter intake photo"
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="reg-rights-status"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Legal Rights Status:
                  </label>
                  <select
                    id="reg-rights-status"
                    data-testid="rights-status-select"
                    value={rightsStatus}
                    onChange={(e) => {
                      setRightsStatus(e.target.value as LegalRightsStatusContract);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  >
                    <option value="unknown">unknown</option>
                    <option value="granted">granted</option>
                    <option value="restricted">restricted</option>
                    <option value="denied">denied</option>
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="reg-consent-status"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Consent Status:
                  </label>
                  <select
                    id="reg-consent-status"
                    data-testid="consent-status-select"
                    value={consentStatus}
                    onChange={(e) => {
                      setConsentStatus(e.target.value as ConsentStatusContract);
                      registerActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  >
                    <option value="unknown">unknown</option>
                    <option value="granted">granted</option>
                    <option value="restricted">restricted</option>
                    <option value="denied">denied</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="reg-rights-attribution"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Rights Attribution (Optional):
                </label>
                <input
                  id="reg-rights-attribution"
                  type="text"
                  data-testid="rights-attribution-input"
                  value={rightsAttribution}
                  onChange={(e) => {
                    setRightsAttribution(e.target.value);
                    registerActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Contract ref, photographer name, or studio waiver"
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                />
              </div>

              <div>
                <label
                  htmlFor="reg-assertion-text"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Assertion Text:
                </label>
                <input
                  id="reg-assertion-text"
                  type="text"
                  data-testid="assertion-text-input"
                  value={assertionText}
                  onChange={(e) => {
                    setAssertionText(e.target.value);
                    registerActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Unaltered photo taken on arrival"
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  required
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
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  disabled={isSubmitting || isRefreshing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-register-evidence-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Registering..." : "Register Source Evidence"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Derivative Modal */}
      {showDerivativeModal && (
        <div
          data-testid="derivative-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="derivative-modal-title"
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
            <h3 id="derivative-modal-title">Link Reference Derivative</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Link a pre-processed reference image (MiniMax-H3 / ComfyUI) to this original evidence
              revision.
            </p>

            {formError && (
              <div style={{ color: "#ef4444", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                {formError}
              </div>
            )}

            <form
              onSubmit={handleLinkDerivative}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="deriv-ref-asset-id"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Reference Asset ID:
                </label>
                <input
                  id="deriv-ref-asset-id"
                  type="text"
                  data-testid="ref-asset-id-input"
                  value={refAssetId}
                  onChange={(e) => {
                    setRefAssetId(e.target.value);
                    derivativeActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="UUID"
                  required
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                />
              </div>
              <div>
                <label
                  htmlFor="deriv-transform-hash"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Derivative SHA-256 Hash:
                </label>
                <input
                  id="deriv-transform-hash"
                  type="text"
                  data-testid="transform-hash-input"
                  value={transformHash}
                  onChange={(e) => {
                    setTransformHash(e.target.value);
                    derivativeActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="64-character lowercase hex"
                  required
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                />
              </div>
              <div>
                <label
                  htmlFor="deriv-transform-desc"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Transform Description:
                </label>
                <input
                  id="deriv-transform-desc"
                  type="text"
                  data-testid="derivative-role-input"
                  value={transformDescription}
                  onChange={(e) => {
                    setTransformDescription(e.target.value);
                    derivativeActionIdRef.current = generateUuidV7();
                  }}
                  required
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
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
                <button type="button" onClick={() => setShowDerivativeModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-derivative-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Linking..." : "Link Derivative"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Verification Event Modal */}
      {showVerifyModal && (
        <div
          data-testid="verification-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-modal-title"
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
            <h3 id="verify-modal-title">Record Evidence Verification Event</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Attestation or independent corroboration for this evidence revision.
            </p>

            {formError && (
              <div style={{ color: "#ef4444", marginBottom: "0.5rem", fontSize: "0.85rem" }}>
                {formError}
              </div>
            )}

            <form
              onSubmit={handleRecordVerification}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="verify-outcome-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Outcome:
                </label>
                <select
                  id="verify-outcome-select"
                  data-testid="verify-outcome-select"
                  value={verifyOutcome}
                  onChange={(e) => {
                    setVerifyOutcome(e.target.value as VerificationOutcomeContract);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                >
                  <option value="verified">verified</option>
                  <option value="disputed">disputed</option>
                  <option value="rejected">rejected</option>
                  <option value="withdrawn">withdrawn</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="verify-kind-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Verification Kind:
                </label>
                <select
                  id="verify-kind-select"
                  data-testid="verify-kind-select"
                  value={verifyKind}
                  onChange={(e) => {
                    setVerifyKind(e.target.value as VerificationKindContract);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                >
                  <option value="independent_third_party_corroboration">
                    independent_third_party_corroboration
                  </option>
                  <option value="human_internal_review">human_internal_review</option>
                  <option value="submitter_attestation">submitter_attestation</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="verify-scope-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Fact Scope:
                </label>
                <select
                  id="verify-scope-select"
                  data-testid="verify-scope-select"
                  value={verifyScope}
                  onChange={(e) => {
                    setVerifyScope(e.target.value as VerificationFactScopeContract);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                >
                  <option value="provenance_metadata">provenance_metadata</option>
                  <option value="capture_circumstances">capture_circumstances</option>
                  <option value="lab_identity">lab_identity</option>
                  <option value="chain_of_custody">chain_of_custody</option>
                  <option value="full_document_authenticity">full_document_authenticity</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="verify-method-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Method:
                </label>
                <input
                  id="verify-method-input"
                  type="text"
                  data-testid="verify-method-input"
                  value={verifyMethod}
                  onChange={(e) => {
                    setVerifyMethod(e.target.value);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="corroborating-party-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Verified Party Reference (Optional):
                </label>
                <input
                  id="corroborating-party-input"
                  type="text"
                  data-testid="corroborating-party-input"
                  value={corroboratingParty}
                  onChange={(e) => {
                    setCorroboratingParty(e.target.value);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Certified Lab Auditor"
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                />
              </div>
              <div>
                <label
                  htmlFor="verify-reason-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Reason / Notes:
                </label>
                <textarea
                  id="verify-reason-input"
                  data-testid="verify-reason-input"
                  value={verifyReason}
                  onChange={(e) => {
                    setVerifyReason(e.target.value);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  required
                  rows={2}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
                />
              </div>
              <div>
                <label
                  htmlFor="withdrawal-target-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Withdrawal Target Event ID (Optional):
                </label>
                <input
                  id="withdrawal-target-input"
                  type="text"
                  data-testid="withdrawal-target-input"
                  value={withdrawalTargetId}
                  onChange={(e) => {
                    setWithdrawalTargetId(e.target.value);
                    verifyActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="UUID of event to withdraw"
                  style={{ width: "100%", padding: "0.4rem", borderRadius: "4px" }}
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
                <button type="button" onClick={() => setShowVerifyModal(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-verify-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Recording..." : "Record Verification"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
