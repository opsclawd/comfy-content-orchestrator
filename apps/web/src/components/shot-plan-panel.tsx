"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ReviewAction,
  ShotPlanReviewItem,
  ShotPlanReferenceBindingReviewItem,
  SceneReviewCandidateGroup,
  CandidateReadModel
} from "@cco/contracts";
import { compileShotPlanAnimaticTimeline } from "@cco/contracts";
import { ShotPlanAnimaticPlayer } from "./animatic/shot-plan-animatic-player.js";
import type { ReviewCommandEvent, ReviewCommandState } from "./review-command-state";
import {
  formatDurationMs,
  formatReviewAction,
  formatShotFraming,
  formatCameraAngle,
  formatCameraMovement,
  formatMovementSpeed,
  formatBlockingPosition,
  formatLightingStyle,
  formatSceneSlug
} from "./format-review-value";

export const RUNTIME_SUPPORTED_FRAME_ANCHOR_TARGETS = new Set(["first_frame"] as const);

export interface AnchorValidationResult {
  readonly isValid: boolean;
  readonly isMissing: boolean;
  readonly reason?: string | undefined;
  readonly target?: string | undefined;
  readonly candidateId?: string | undefined;
}

export function validateFrameAnchor(
  plan: ShotPlanReviewItem,
  currentSpecRevision: number,
  candidateGroups: readonly SceneReviewCandidateGroup[] = []
): AnchorValidationResult {
  if (plan.routingMode !== "frame_anchored") {
    return { isValid: true, isMissing: false };
  }

  const target = plan.continuity?.frameAnchorTarget;
  const candidateId = plan.continuity?.anchorCandidateId ?? undefined;
  const expectedHash = plan.continuity?.anchorMediaHashSha256 ?? undefined;

  if (!target || target === "none") {
    return {
      isValid: false,
      isMissing: true,
      reason:
        "Frame-anchored execution requires an explicitly declared frameAnchorTarget (supported: 'first_frame')."
    };
  }

  if (target !== "first_frame") {
    return {
      isValid: false,
      isMissing: false,
      target,
      candidateId,
      reason: `Frame anchor target "${target}" is not supported by runtime profile (only "first_frame" is currently supported).`
    };
  }

  if (!candidateId) {
    return {
      isValid: false,
      isMissing: true,
      target,
      reason: "Frame-anchored execution requires an explicitly declared anchorCandidateId."
    };
  }

  if (!expectedHash) {
    return {
      isValid: false,
      isMissing: true,
      target,
      candidateId,
      reason: "Frame-anchored execution requires an explicitly declared anchorMediaHashSha256."
    };
  }

  let matchedCandidate: CandidateReadModel | undefined;
  for (const group of candidateGroups) {
    const found = group.candidates.find((c) => c.candidateId === candidateId);
    if (found) {
      matchedCandidate = found;
      break;
    }
  }

  if (!matchedCandidate) {
    return {
      isValid: false,
      isMissing: false,
      target,
      candidateId,
      reason: `Authoritative anchor candidate "${candidateId}" was not found in candidate history.`
    };
  }

  if (matchedCandidate.specRevision !== currentSpecRevision) {
    return {
      isValid: false,
      isMissing: false,
      target,
      candidateId,
      reason: `Authoritative anchor candidate "${candidateId}" belongs to revision ${matchedCandidate.specRevision}, which does not match current scene revision ${currentSpecRevision}.`
    };
  }

  if (plan.sceneId && matchedCandidate.sceneId && matchedCandidate.sceneId !== plan.sceneId) {
    return {
      isValid: false,
      isMissing: false,
      target,
      candidateId,
      reason: `Authoritative anchor candidate "${candidateId}" belongs to scene "${matchedCandidate.sceneId}", not "${plan.sceneId}".`
    };
  }

  if (matchedCandidate.contentHash !== expectedHash) {
    return {
      isValid: false,
      isMissing: false,
      target,
      candidateId,
      reason: `Authoritative anchor candidate "${candidateId}" content hash "${matchedCandidate.contentHash}" does not match ShotPlan declared anchorMediaHashSha256 "${expectedHash}".`
    };
  }

  return {
    isValid: true,
    isMissing: false,
    target,
    candidateId
  };
}

export interface GenerateShotPlansOptions {
  readonly variantCount: number;
  readonly reroll: boolean;
}

export interface ShotPlanPanelProps {
  shotPlans?: ShotPlanReviewItem[] | undefined;
  selectedShotPlanId?: string | undefined;
  approvedShotPlanId?: string | undefined;
  currentSpecRevision: number;
  candidatesByRevision?: SceneReviewCandidateGroup[] | undefined;
  allowedActions?: ReviewAction[] | undefined;
  state?: ReviewCommandState | undefined;
  dispatch?: ((event: ReviewCommandEvent) => void) | undefined;
  onSelectShotPlan?: ((shotPlanId: string) => void) | undefined;
  onApproveShotPlan?: ((shotPlanId: string) => void) | undefined;
  disabled?: boolean | undefined;
  sceneId?: string | undefined;
  onGenerateShotPlans?: ((options: GenerateShotPlansOptions) => Promise<void>) | undefined;
  onRefresh?: (() => void | Promise<void>) | undefined;
}

export function ShotPlanPanel({
  shotPlans = [],
  selectedShotPlanId,
  approvedShotPlanId,
  currentSpecRevision,
  candidatesByRevision,
  allowedActions,
  state: stateProp,
  dispatch,
  onSelectShotPlan,
  onApproveShotPlan,
  disabled = false,
  sceneId,
  onGenerateShotPlans,
  onRefresh
}: ShotPlanPanelProps) {
  const candidateGroups = candidatesByRevision ?? stateProp?.detail?.candidatesByRevision ?? [];
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [activeBeatByPlan, setActiveBeatByPlan] = useState<Record<string, number | null>>({});

  let router: { refresh: () => void } | null = null;
  try {
    router = useRouter();
  } catch {
    router = null;
  }

  async function handleGenerateShotPlans() {
    if (isGenerating || disabled || !sceneId) {
      return;
    }

    setIsGenerating(true);
    setGenerationError(null);

    try {
      if (onGenerateShotPlans) {
        await onGenerateShotPlans({ variantCount: 2, reroll: false });
      } else {
        const res = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/shot-plans`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ variantCount: 2, reroll: false })
        });

        if (!res.ok) {
          let errorData: unknown;
          try {
            errorData = await res.json();
          } catch {
            errorData = null;
          }
          throw { status: res.status, error: errorData };
        }
      }

      if (onRefresh) {
        await onRefresh();
      }
      if (router) {
        router.refresh();
      }
    } catch (err: unknown) {
      let formatted = "Failed to generate shot plans. Please try again.";

      if (typeof err === "object" && err !== null) {
        const status =
          "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : "status" in err
              ? (err as { status: number }).status
              : undefined;

        const errorPayload =
          "error" in err
            ? (err as { error: unknown }).error
            : "body" in err
              ? (err as { body: unknown }).body
              : err;

        if (typeof errorPayload === "object" && errorPayload !== null) {
          const code =
            "code" in errorPayload ? String((errorPayload as { code: unknown }).code) : undefined;
          const message =
            "message" in errorPayload
              ? String((errorPayload as { message: unknown }).message)
              : undefined;

          if (code === "CLOUD_PLANNING_NOT_AUTHORIZED" || status === 403) {
            formatted = message
              ? `Cloud planning not authorized: ${message}`
              : "Cloud planning is not authorized for this client. Please check your configuration.";
          } else if (code === "CONFIGURATION_ERROR" || status === 503) {
            formatted = message
              ? `Planning configuration error: ${message}`
              : "Shot plan planning is unavailable because planning model clients are not configured.";
          } else if (message && status !== undefined && status < 500) {
            formatted = message;
          }
        }
      }

      setGenerationError(formatted);
    } finally {
      setIsGenerating(false);
    }
  }

  if (!shotPlans || shotPlans.length === 0) {
    return (
      <section
        className="scene-section shot-plan-panel-surface"
        aria-label="Shot Plan Proposals"
        data-testid="shot-plan-panel"
      >
        <div className="shot-plan-panel-header">
          <h2>Structured Shot Plans</h2>
        </div>
        <div className="empty-state" data-testid="no-shot-plans-state">
          <p>No shot plans have been generated for this scene.</p>
          <div className="empty-state-actions">
            <button
              type="button"
              className="action-button generate-shot-plans-button"
              data-testid="generate-shot-plans-button"
              onClick={handleGenerateShotPlans}
              disabled={disabled || isGenerating || !sceneId}
              aria-busy={isGenerating ? "true" : undefined}
            >
              {isGenerating ? "Generating Shot Plans..." : "Generate Shot Plans"}
            </button>
          </div>
          {isGenerating && (
            <div
              className="generating-indicator"
              data-testid="generating-shot-plans-status"
              role="status"
              aria-live="polite"
            >
              Generating shot plans (2 variants)...
            </div>
          )}
          {generationError && (
            <div className="review-error-banner" data-testid="shot-plan-error-message" role="alert">
              <p>{generationError}</p>
            </div>
          )}
        </div>
      </section>
    );
  }

  const canSelectAction = allowedActions ? allowedActions.includes("select_shotplan") : true;
  const canApproveAction = allowedActions ? allowedActions.includes("approve_shotplan") : true;

  function handleSelect(shotPlanId: string) {
    if (onSelectShotPlan) {
      onSelectShotPlan(shotPlanId);
      return;
    }
    if (dispatch) {
      dispatch({
        type: "REQUEST_CONFIRMATION",
        stagedAction: {
          action: "select_shotplan",
          payload: {
            shotPlanId,
            expectedSpecRevision: currentSpecRevision
          },
          displayLabel: formatReviewAction("select_shotplan")
        }
      });
    }
  }

  function handleApprove(shotPlanId: string) {
    const plan = shotPlans.find((p) => p.shotPlanId === shotPlanId);
    if (plan?.routingMode === "frame_anchored") {
      const validation = validateFrameAnchor(plan, currentSpecRevision, candidateGroups);
      if (!validation.isValid) {
        return;
      }
    }
    if (onApproveShotPlan) {
      onApproveShotPlan(shotPlanId);
      return;
    }
    if (dispatch) {
      dispatch({
        type: "REQUEST_CONFIRMATION",
        stagedAction: {
          action: "approve_shotplan",
          payload: {
            shotPlanId,
            expectedSpecRevision: currentSpecRevision
          },
          displayLabel: formatReviewAction("approve_shotplan")
        }
      });
    }
  }

  return (
    <section
      className="scene-section shot-plan-panel-surface"
      aria-label="Shot Plan Proposals"
      data-testid="shot-plan-panel"
    >
      <div className="shot-plan-panel-header">
        <div className="shot-plan-header-title">
          <h2>Structured Shot Plans &amp; Intent</h2>
          <span className="authority-role-pill intent-authority-pill">
            Structured Production Intent
          </span>
        </div>
        <p className="shot-plan-panel-subhead">
          Director approval binds to structured ShotPlan intent. Visual authority is provided by
          role-bound reference assets. Previs is a non-authoritative visualization.
        </p>
      </div>

      <div className="shot-plan-cards-grid">
        {shotPlans.map((plan) => {
          const isSelected = selectedShotPlanId === plan.shotPlanId;
          const isApproved = approvedShotPlanId === plan.shotPlanId || plan.status === "approved";
          const isCurrent = plan.isCurrentRevision && plan.specRevision === currentSpecRevision;
          const isFrameAnchored = plan.routingMode === "frame_anchored";
          const anchorValidation = validateFrameAnchor(plan, currentSpecRevision, candidateGroups);
          const hasValidAnchor = anchorValidation.isValid;

          return (
            <article
              key={plan.shotPlanId}
              className={`shot-plan-card storyboard-panel ${isSelected ? "shot-plan-card-selected" : ""} ${
                isApproved ? "shot-plan-card-approved" : ""
              } ${!isCurrent ? "shot-plan-card-stale" : ""}`}
              data-testid="shot-plan-card"
              data-shot-plan-id={plan.shotPlanId}
              data-status={plan.status}
              data-routing-mode={plan.routingMode}
            >
              {/* Card Header & Slate Slugline */}
              <div className="shot-plan-card-header">
                <div className="shot-plan-card-title-row">
                  <div className="shot-plan-slate-info">
                    <span className="storyboard-slate-title" data-testid="storyboard-slate-title">
                      SCENE {formatSceneSlug(plan.sceneId ?? sceneId)} · SHOTPLAN V
                      {plan.variantOrdinal}
                    </span>
                    <span className="shot-plan-variant-label">Variant #{plan.variantOrdinal}</span>
                  </div>
                  <div className="shot-plan-badges">
                    <span
                      className="shot-plan-status-badge"
                      data-testid="shot-plan-status"
                      data-status={plan.status}
                    >
                      {plan.status.toUpperCase()}
                    </span>
                    <span
                      className="shot-plan-routing-badge"
                      data-testid="shot-plan-routing-mode"
                      data-mode={plan.routingMode}
                    >
                      {isFrameAnchored ? "Frame Anchored" : "Reference Directed"}
                    </span>
                    <span
                      className={`shot-plan-revision-badge ${
                        isCurrent ? "revision-current" : "revision-stale"
                      }`}
                      data-testid="shot-plan-revision-badge"
                    >
                      Rev {plan.specRevision} {isCurrent ? "(Current)" : "(Stale)"}
                    </span>
                    {isSelected && (
                      <span className="badge-selected" data-testid="shot-plan-selected-badge">
                        Selected Plan
                      </span>
                    )}
                    {isApproved && (
                      <span className="badge-approved" data-testid="shot-plan-approved-badge">
                        Approved Intent
                      </span>
                    )}
                  </div>
                </div>

                {isFrameAnchored &&
                  (hasValidAnchor ? (
                    <div
                      className="shot-plan-frame-anchor-notice"
                      data-testid="shot-plan-frame-anchor-notice"
                      data-status="valid"
                    >
                      <strong>Declared Target:</strong>{" "}
                      <code data-testid="shot-plan-frame-anchor-target">
                        {plan.continuity?.frameAnchorTarget}
                      </code>{" "}
                      | <strong>Authoritative Anchor Asset:</strong>{" "}
                      <code data-testid="shot-plan-frame-anchor-asset">
                        {plan.continuity?.anchorCandidateId}
                      </code>{" "}
                      (Explicitly declared frame asset)
                    </div>
                  ) : (
                    <div
                      className="shot-plan-frame-anchor-notice shot-plan-frame-anchor-invalid"
                      data-testid="shot-plan-frame-anchor-notice"
                      data-status={anchorValidation.isMissing ? "missing" : "invalid"}
                    >
                      <span
                        className="shot-plan-frame-anchor-missing-message shot-plan-frame-anchor-invalid-message"
                        data-testid={
                          anchorValidation.isMissing
                            ? "shot-plan-frame-anchor-missing"
                            : "shot-plan-frame-anchor-invalid"
                        }
                      >
                        <strong>
                          {anchorValidation.isMissing
                            ? "Missing authoritative anchor:"
                            : "Invalid authoritative anchor:"}
                        </strong>{" "}
                        {anchorValidation.reason}
                      </span>
                    </div>
                  ))}
              </div>

              {/* Two-Column Storyboard Body */}
              <div className="storyboard-panel-body">
                {/* Left Column: Storyboard Viewfinder Frame & Authority Badge */}
                <div className="storyboard-media-col">
                  <div
                    className="storyboard-viewfinder-box shot-plan-previs-box"
                    data-testid="shot-plan-previs-visualization"
                  >
                    <div className="previs-box-header">
                      <span className="previs-label-title">
                        Previs Visualization (Non-Authoritative)
                      </span>
                      <span className="previs-label-note">
                        {isFrameAnchored
                          ? hasValidAnchor
                            ? "Anchor source for declared frame-anchored route"
                            : anchorValidation.isMissing
                              ? "Non-authoritative visualization; missing declared frame anchor"
                              : "Non-authoritative visualization; invalid declared frame anchor"
                          : "Proposed shot intent; not conditioned as first-frame in reference-directed H3"}
                      </span>
                    </div>

                    <ShotPlanAnimaticPlayer
                      timeline={compileShotPlanAnimaticTimeline(plan)}
                      isCurrentRevision={
                        plan.isCurrentRevision ?? plan.specRevision === currentSpecRevision
                      }
                      onActiveBeatChange={(beatIndex) => {
                        setActiveBeatByPlan((prev) => ({
                          ...prev,
                          [plan.shotPlanId]: beatIndex
                        }));
                      }}
                    />

                    {/* Persistent Visual Treatment Banner */}
                    <div
                      className={`storyboard-non-production-badge ${
                        isFrameAnchored
                          ? hasValidAnchor
                            ? "badge-frame-anchor-valid"
                            : "badge-frame-anchor-invalid"
                          : "badge-previs-non-production"
                      }`}
                      data-testid="previs-non-production-badge"
                      data-routing-mode={plan.routingMode}
                    >
                      <span className="badge-text">
                        {!isFrameAnchored
                          ? "Storyboard / Previs — non-production image"
                          : hasValidAnchor
                            ? `Frame Anchor Candidate — conditional pixel anchor (${plan.continuity?.frameAnchorTarget})`
                            : "Storyboard / Previs — non-production image (missing frame anchor)"}
                      </span>
                      <span className="badge-subtext">
                        {!isFrameAnchored
                          ? "Visual truth is supplied by bound reference assets. Previs pixels are not conditioned into production."
                          : hasValidAnchor
                            ? `Declared target: ${plan.continuity?.frameAnchorTarget} | Anchor asset: ${plan.continuity?.anchorCandidateId}`
                            : (anchorValidation.reason ??
                              "Authoritative anchor candidate is missing or unverified.")}
                      </span>
                    </div>

                    {plan.previs?.reviewNotes && (
                      <p className="previs-review-notes" data-testid="previs-review-notes">
                        <em>Previs notes:</em> {plan.previs.reviewNotes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right Column: Authoritative Structured ShotPlan Metadata */}
                <div
                  className="storyboard-metadata-col shot-plan-intent-details"
                  data-testid="shot-plan-intent-details"
                >
                  {/* Camera Sluglines Callout */}
                  <div
                    className="storyboard-camera-callout"
                    data-testid="storyboard-camera-callout"
                  >
                    <div className="camera-slugline-primary" data-testid="shot-plan-framing">
                      <span className="slugline-main">
                        {formatShotFraming(plan.framing).toUpperCase()} ·{" "}
                        {formatCameraAngle(plan.angle).toUpperCase()} · {plan.lensIntent}
                      </span>
                      <span className="technical-code-caption">
                        <code>{plan.framing}</code> / <code>{plan.angle}</code>
                      </span>
                    </div>

                    <div className="camera-slugline-movement" data-testid="shot-plan-camera">
                      <span className="slugline-movement-main">
                        {formatCameraMovement(plan.cameraMovement).toUpperCase()} ·{" "}
                        {formatMovementSpeed(plan.movementSpeed).toUpperCase()}
                      </span>
                      <div className="technical-code-caption">
                        <strong>Movement:</strong> {plan.cameraMovement} ({plan.movementSpeed})
                        <br />
                        <strong>Lens:</strong> {plan.lensIntent}
                        <br />
                        <strong>Position:</strong> {plan.cameraPosition}
                      </div>
                    </div>

                    {plan.cameraPromptDescription && (
                      <p className="camera-prompt-desc">{plan.cameraPromptDescription}</p>
                    )}
                  </div>

                  {/* Staging & Blocking */}
                  {plan.subjects && plan.subjects.length > 0 && (
                    <div className="storyboard-blocking-section">
                      <h5 className="storyboard-section-title">Staging &amp; Blocking</h5>
                      <div data-testid="shot-plan-subjects">
                        <ul className="storyboard-blocking-list subjects-list">
                          {plan.subjects.map((sub, idx) => {
                            const boundRef = sub.referenceAssetId
                              ? plan.boundReferences?.find(
                                  (r) => r.referenceAssetId === sub.referenceAssetId
                                )
                              : plan.boundReferences?.find((r) => r.role === sub.role);
                            const rolePrefix = sub.role === "product" ? "Product" : "Subject";
                            return (
                              <li key={idx} className="storyboard-blocking-item">
                                <span className="blocking-entity">
                                  <strong>{rolePrefix}:</strong> {sub.subjectId}
                                </span>{" "}
                                <span className="blocking-ref-tag" data-testid="blocking-ref-tag">
                                  [{boundRef?.displayName ?? "unbound"} ·{" "}
                                  {boundRef?.role ?? sub.role}]
                                </span>{" "}
                                ·{" "}
                                <span className="blocking-trajectory">
                                  {formatBlockingPosition(sub.initialPosition)} →{" "}
                                  {sub.movementTrajectory}
                                </span>
                                {sub.interactionSummary ? (
                                  <span className="blocking-interaction">
                                    {" "}
                                    — {sub.interactionSummary}
                                  </span>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* Action Summary & Temporal Beats */}
                  <div className="storyboard-action-section">
                    <h5 className="storyboard-section-title">Action Summary</h5>
                    <p className="action-summary-text" data-testid="shot-plan-action">
                      {plan.actionSummary}
                    </p>

                    {plan.beats && plan.beats.length > 0 && (
                      <div className="storyboard-beats-sublist" data-testid="shot-plan-beats">
                        <h6 className="storyboard-subsection-title">Temporal Beats</h6>
                        <ol className="beats-list">
                          {plan.beats.map((beat) => {
                            const isActive = activeBeatByPlan[plan.shotPlanId] === beat.beatIndex;
                            return (
                              <li
                                key={beat.beatIndex}
                                className={`storyboard-beat-item ${isActive ? "storyboard-beat-item-active" : ""}`}
                                data-active-beat={isActive ? "true" : undefined}
                              >
                                [{beat.startMs}ms - {beat.endMs}ms] {beat.description} (Camera:{" "}
                                {beat.cameraAction}, Subject: {beat.subjectAction})
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    )}
                  </div>

                  {/* Environment & Lighting Concept */}
                  <div className="storyboard-env-lighting-section">
                    <h5 className="storyboard-section-title">Environment &amp; Lighting</h5>
                    <div className="storyboard-env-lighting" data-testid="shot-plan-lighting-env">
                      <strong>Lighting:</strong> {formatLightingStyle(plan.lightingStyle)}{" "}
                      <span className="technical-code-caption">({plan.lightingStyle})</span>
                      <br />
                      <strong>Environment:</strong> {plan.environmentDescription}
                      {plan.atmosphere ? (
                        <>
                          <br />
                          <strong>Atmosphere:</strong> {plan.atmosphere}
                        </>
                      ) : null}
                      {plan.colorPalette && plan.colorPalette.length > 0 ? (
                        <>
                          <br />
                          <strong>Palette:</strong> {plan.colorPalette.join(", ")}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Bound References Strip (Beside the image) */}
                  <div
                    className="shot-plan-references-section storyboard-reference-strip"
                    data-testid="shot-plan-references"
                  >
                    <div className="references-header">
                      <h4>Authoritative Reference Assets (Visual Authority)</h4>
                      <span className="references-note">
                        Joined persisted bindings scoped to scene revision
                      </span>
                    </div>
                    {plan.boundReferences && plan.boundReferences.length > 0 ? (
                      <div className="reference-badges-grid">
                        {plan.boundReferences.map((ref: ShotPlanReferenceBindingReviewItem) => (
                          <div
                            key={ref.referenceAssetId}
                            className="reference-binding-card"
                            data-testid="shot-plan-reference-item"
                            data-asset-id={ref.referenceAssetId}
                            data-role={ref.role}
                          >
                            {ref.previewUrl && ref.previewAvailability === "available" ? (
                              <div className="ref-preview-thumbnail">
                                <img
                                  src={ref.previewUrl}
                                  alt={ref.displayName ?? ref.referenceAssetId}
                                  className="ref-thumb-img"
                                  data-testid="reference-preview-image"
                                />
                              </div>
                            ) : (
                              <div className="ref-preview-placeholder">
                                <span>No preview</span>
                              </div>
                            )}
                            <div className="ref-binding-info">
                              <span className="ref-name">
                                {ref.displayName || <code>{ref.referenceAssetId.slice(0, 8)}</code>}
                              </span>
                              <span className="ref-role-pill" data-role={ref.role}>
                                {ref.role}
                              </span>
                              {ref.width && ref.height && (
                                <span className="ref-dims">
                                  {ref.width}×{ref.height}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-references" data-testid="empty-references">
                        <span>No bound references</span>
                      </div>
                    )}
                  </div>

                  {/* Technical Footprint & Duration */}
                  <div className="storyboard-technical-footprint">
                    <div className="technical-footprint-item">
                      <span className="technical-footprint-label">Duration:</span>{" "}
                      <span data-testid="shot-plan-duration">
                        {formatDurationMs(plan.targetDurationMs)} ({plan.targetFrameCount} frames)
                      </span>
                    </div>
                    <div className="technical-footprint-item">
                      <span className="technical-footprint-label">Routing Mode:</span>{" "}
                      <span>{isFrameAnchored ? "Frame Anchored" : "Reference Directed"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Variant Actions */}
              <div className="shot-plan-card-actions" data-testid="shot-plan-card-actions">
                <button
                  type="button"
                  className="shot-plan-action-btn select-plan-btn"
                  data-testid="shot-plan-select-button"
                  data-shot-plan-id={plan.shotPlanId}
                  disabled={disabled || !isCurrent || isSelected || !canSelectAction}
                  onClick={() => handleSelect(plan.shotPlanId)}
                >
                  {isSelected ? "Selected" : "Select Plan"}
                </button>
                <button
                  type="button"
                  className="shot-plan-action-btn approve-plan-btn"
                  data-testid="shot-plan-approve-button"
                  data-shot-plan-id={plan.shotPlanId}
                  disabled={
                    disabled || !isCurrent || isApproved || !canApproveAction || !hasValidAnchor
                  }
                  onClick={() => handleApprove(plan.shotPlanId)}
                >
                  {isApproved ? "Approved Intent" : "Approve Intent"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default ShotPlanPanel;
