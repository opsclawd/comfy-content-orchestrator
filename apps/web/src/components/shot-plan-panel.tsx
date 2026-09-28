"use client";

import React from "react";
import type {
  ReviewAction,
  ShotPlanReviewItem,
  ShotPlanReferenceBindingReviewItem,
  SceneReviewCandidateGroup,
  CandidateReadModel
} from "@cco/contracts";
import type { ReviewCommandEvent, ReviewCommandState } from "./review-command-state";
import { formatDurationMs, formatReviewAction } from "./format-review-value";

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
  disabled = false
}: ShotPlanPanelProps) {
  const candidateGroups = candidatesByRevision ?? stateProp?.detail?.candidatesByRevision ?? [];

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
              className={`shot-plan-card ${isSelected ? "shot-plan-card-selected" : ""} ${
                isApproved ? "shot-plan-card-approved" : ""
              } ${!isCurrent ? "shot-plan-card-stale" : ""}`}
              data-testid="shot-plan-card"
              data-shot-plan-id={plan.shotPlanId}
              data-status={plan.status}
              data-routing-mode={plan.routingMode}
            >
              {/* Card Header & Status */}
              <div className="shot-plan-card-header">
                <div className="shot-plan-card-title-row">
                  <span className="shot-plan-variant-label">Variant #{plan.variantOrdinal}</span>
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
                        {plan.continuity.frameAnchorTarget}
                      </code>{" "}
                      | <strong>Authoritative Anchor Asset:</strong>{" "}
                      <code data-testid="shot-plan-frame-anchor-asset">
                        {plan.continuity.anchorCandidateId}
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

              {/* Previs Visualization Section */}
              <div className="shot-plan-previs-box" data-testid="shot-plan-previs-visualization">
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
                {plan.previs?.media.available && plan.previs.media.url ? (
                  <div className="previs-media-container">
                    <img
                      src={plan.previs.media.url}
                      alt={`Previs visualization for Variant #${plan.variantOrdinal}`}
                      className="previs-image"
                      data-testid="previs-preview-image"
                    />
                  </div>
                ) : (
                  <div className="previs-unavailable" data-testid="previs-unavailable">
                    <span>Previs visualization not rendered</span>
                  </div>
                )}
                {plan.previs?.reviewNotes && (
                  <p className="previs-review-notes" data-testid="previs-review-notes">
                    <em>Previs notes:</em> {plan.previs.reviewNotes}
                  </p>
                )}
              </div>

              {/* Structured Production Intent Details */}
              <div className="shot-plan-intent-details" data-testid="shot-plan-intent-details">
                <dl className="intent-attribute-list">
                  <div className="intent-attribute-item">
                    <dt>Duration &amp; Frames</dt>
                    <dd data-testid="shot-plan-duration">
                      {formatDurationMs(plan.targetDurationMs)} ({plan.targetFrameCount} frames)
                    </dd>
                  </div>

                  <div className="intent-attribute-item">
                    <dt>Framing &amp; Angle</dt>
                    <dd data-testid="shot-plan-framing">
                      <code>{plan.framing}</code> / <code>{plan.angle}</code>
                    </dd>
                  </div>

                  <div className="intent-attribute-item">
                    <dt>Camera &amp; Lens</dt>
                    <dd data-testid="shot-plan-camera">
                      <strong>Movement:</strong> {plan.cameraMovement} ({plan.movementSpeed})<br />
                      <strong>Lens:</strong> {plan.lensIntent}
                      <br />
                      <strong>Position:</strong> {plan.cameraPosition}
                    </dd>
                  </div>

                  <div className="intent-attribute-item">
                    <dt>Camera Description</dt>
                    <dd className="camera-prompt-desc">{plan.cameraPromptDescription}</dd>
                  </div>

                  <div className="intent-attribute-item">
                    <dt>Action Summary</dt>
                    <dd className="action-summary-text" data-testid="shot-plan-action">
                      {plan.actionSummary}
                    </dd>
                  </div>

                  <div className="intent-attribute-item">
                    <dt>Lighting &amp; Environment</dt>
                    <dd data-testid="shot-plan-lighting-env">
                      <strong>Lighting:</strong> {plan.lightingStyle}
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
                    </dd>
                  </div>

                  {plan.subjects && plan.subjects.length > 0 && (
                    <div className="intent-attribute-item">
                      <dt>Subject Blocking</dt>
                      <dd data-testid="shot-plan-subjects">
                        <ul className="subjects-list">
                          {plan.subjects.map((sub, idx) => (
                            <li key={idx}>
                              <strong>{sub.subjectId}</strong> ({sub.role}, {sub.initialPosition}):{" "}
                              {sub.movementTrajectory}
                              {sub.interactionSummary ? ` — ${sub.interactionSummary}` : ""}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}

                  {plan.beats && plan.beats.length > 0 && (
                    <div className="intent-attribute-item">
                      <dt>Temporal Beats</dt>
                      <dd data-testid="shot-plan-beats">
                        <ol className="beats-list">
                          {plan.beats.map((beat) => (
                            <li key={beat.beatIndex}>
                              [{beat.startMs}ms - {beat.endMs}ms] {beat.description} (Camera:{" "}
                              {beat.cameraAction}, Subject: {beat.subjectAction})
                            </li>
                          ))}
                        </ol>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Bound References (Visual Authority) */}
              <div className="shot-plan-references-section" data-testid="shot-plan-references">
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
