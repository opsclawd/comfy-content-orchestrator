"use client";

import React, { useEffect, useReducer, useRef } from "react";
import Link from "next/link";
import type { SceneReviewDetailReadModel, H3ProductionInspectionReadModel } from "@cco/contracts";
import type { CurrentProductionAttemptReadModel } from "../api/client";
import { CandidateGallery } from "./candidate-gallery";
import { ReviewCommandControls } from "./review-command-controls";
import { ProductionReviewPanel } from "./production-review-panel";
import { ShotPlanPanel } from "./shot-plan-panel";
import {
  areCommandsDisabled,
  createInitialState,
  transitionReviewCommandState,
  type ReviewCommandEvent,
  type ReviewCommandState
} from "./review-command-state";
import {
  formatReviewAction,
  formatSceneStatus,
  formatDurationMs,
  formatDateTime
} from "./format-review-value";

export interface SceneReviewDetailProps {
  detail: SceneReviewDetailReadModel;
  productionAttempt?: CurrentProductionAttemptReadModel | undefined;
  productionInspection?: H3ProductionInspectionReadModel | null | undefined;
  onDetailChange?: ((detail: SceneReviewDetailReadModel) => void) | undefined;
}

export function SceneReviewDetailView({
  detail,
  productionAttempt,
  productionInspection,
  onDetailChange
}: SceneReviewDetailProps) {
  const { configuration, approval } = detail;
  const hasReferences = configuration.referenceIds && configuration.referenceIds.length > 0;
  const hasLora =
    configuration.loraConfigurationId !== null && configuration.loraConfigurationId !== undefined;
  const hasSelection = Boolean(detail.selectedCandidateId);
  const hasApproval = Boolean(approval);

  const [state, dispatch] = useReducer(
    (prevState: ReviewCommandState, event: ReviewCommandEvent) =>
      transitionReviewCommandState(prevState, event).state,
    detail,
    createInitialState
  );
  const disabled = areCommandsDisabled(state);

  const prevDetailRef = useRef(detail);
  useEffect(() => {
    if (prevDetailRef.current !== detail) {
      prevDetailRef.current = detail;
      dispatch({ type: "REFRESH_SUCCESS", detail });
    }
  }, [detail]);

  function handleSelectCandidate(candidateId: string) {
    dispatch({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "candidate_select",
        payload: { candidateId },
        displayLabel: formatReviewAction("candidate_select")
      }
    });
  }

  return (
    <div className="scene-detail-shell" data-testid="scene-review-detail">
      <nav className="scene-detail-nav" aria-label="Breadcrumb">
        <Link
          href={`/campaigns/${detail.campaignId}`}
          className="back-link"
          data-testid="back-to-campaign-link"
        >
          ← Back to Campaign
        </Link>
      </nav>

      <header className="scene-header">
        <div className="scene-header-main">
          <h1 className="scene-title">Scene Review</h1>
          <div className="scene-status-row">
            <span className="status-badge" data-status={detail.status}>
              {formatSceneStatus(detail.status)} ({detail.status})
            </span>
            <span className="spec-revision-badge">Revision {detail.specRevision}</span>
          </div>
        </div>
        <div className="scene-meta">
          <span className="scene-meta-item">
            <strong>Scene ID:</strong> <code>{detail.sceneId}</code>
          </span>
          <span className="scene-meta-item">
            <strong>Campaign ID:</strong> <code>{detail.campaignId}</code>
          </span>
        </div>
      </header>

      <div className="scene-detail-grid">
        {/* Configuration Summary */}
        <section
          id="scene-references"
          className="scene-section configuration-section"
          aria-label="Scene Configuration"
        >
          <h2>Scene Configuration</h2>
          <dl className="definition-list" data-testid="scene-configuration">
            <div className="definition-item">
              <dt>Prompt</dt>
              <dd className="prompt-content" data-testid="scene-prompt">
                {configuration.prompt}
              </dd>
            </div>
            <div className="definition-item">
              <dt>Reference Images</dt>
              <dd data-testid="scene-references">
                {detail.boundReferences && detail.boundReferences.length > 0 ? (
                  <div
                    className="scene-production-references-grid"
                    data-testid="scene-production-references-grid"
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                      marginTop: "0.25rem"
                    }}
                  >
                    {detail.boundReferences.map((binding) => {
                      const hasPreview =
                        binding.previewAvailability === "available" && Boolean(binding.previewUrl);
                      const displayName =
                        binding.displayName || binding.referenceAssetId.slice(0, 8);
                      return (
                        <div
                          key={binding.referenceAssetId}
                          className="scene-reference-chip"
                          data-testid={`scene-reference-chip-${binding.referenceAssetId}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            padding: "0.25rem 0.5rem",
                            backgroundColor: "var(--bg-surface, #1e293b)",
                            border: "1px solid var(--border-subtle, #334155)",
                            borderRadius: "var(--radius-sm, 6px)",
                            fontSize: "0.8125rem"
                          }}
                        >
                          <div
                            style={{
                              width: "24px",
                              height: "24px",
                              borderRadius: "3px",
                              overflow: "hidden",
                              backgroundColor: "#020617",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0
                            }}
                          >
                            {hasPreview ? (
                              <img
                                src={binding.previewUrl!}
                                alt={displayName}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <span
                                style={{
                                  fontSize: "0.625rem",
                                  color: "var(--text-muted, #94a3b8)"
                                }}
                              >
                                Img
                              </span>
                            )}
                          </div>
                          <span style={{ fontWeight: 600 }}>{displayName}</span>
                          <span
                            style={{
                              fontSize: "0.6875rem",
                              padding: "0.0625rem 0.25rem",
                              borderRadius: "3px",
                              backgroundColor: "rgba(56, 189, 248, 0.15)",
                              color: "var(--color-primary, #38bdf8)"
                            }}
                          >
                            {binding.role}
                          </span>
                          {binding.libraryRole && (
                            <span
                              style={{
                                fontSize: "0.6875rem",
                                color: "var(--text-muted, #94a3b8)"
                              }}
                            >
                              (lib: {binding.libraryRole})
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : hasReferences ? (
                  <ul className="reference-list">
                    {configuration.referenceIds.map((refId) => (
                      <li key={refId} className="reference-item">
                        <code>{refId}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="empty-value">None</span>
                )}
              </dd>
            </div>
            <div className="definition-item">
              <dt>Engine Profile</dt>
              <dd data-testid="scene-engine">
                <code>{configuration.engineProfileId}</code>
              </dd>
            </div>
            <div className="definition-item">
              <dt>Target Duration</dt>
              <dd data-testid="scene-duration">{formatDurationMs(configuration.durationMs)}</dd>
            </div>
            <div className="definition-item">
              <dt>LoRA Configuration</dt>
              <dd data-testid="scene-lora">
                {hasLora ? (
                  <code>{configuration.loraConfigurationId}</code>
                ) : (
                  <span className="empty-value">None</span>
                )}
              </dd>
            </div>
          </dl>
        </section>

        {/* Review & Approval State */}
        <section
          id="scene-previs"
          className="scene-section review-state-section"
          aria-label="Review State"
        >
          <h2>Review & Approval State</h2>
          <dl className="definition-list" data-testid="scene-review-state">
            <div className="definition-item">
              <dt>Selected Candidate</dt>
              <dd data-testid="selection-status">
                {hasSelection ? (
                  <div className="selection-info">
                    <span className="selection-candidate-id">
                      <code>{detail.selectedCandidateId}</code>
                    </span>
                    {detail.selectedCandidateRevision !== undefined && (
                      <span className="selection-revision-badge">
                        (Revision {detail.selectedCandidateRevision})
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="empty-value">No candidate selected</span>
                )}
              </dd>
            </div>
            <div className="definition-item">
              <dt>Approval Status</dt>
              <dd data-testid="approval-status">
                {hasApproval && approval ? (
                  <div className="approval-info">
                    <span className="approval-badge">Approved (Rev {approval.revision})</span>
                    <span className="approval-by">
                      By: <strong>{approval.approvedBy}</strong>
                    </span>
                    <span className="approval-at">At: {formatDateTime(approval.approvedAt)}</span>
                  </div>
                ) : (
                  <span className="empty-value">Not approved</span>
                )}
              </dd>
            </div>
            {detail.selectedShotPlanId && (
              <div className="definition-item">
                <dt>Selected Shot Plan</dt>
                <dd data-testid="selected-shot-plan-status">
                  <code>{detail.selectedShotPlanId}</code>
                  {detail.selectedShotPlanRevision !== undefined && (
                    <span className="selection-revision-badge">
                      {" "}
                      (Revision {detail.selectedShotPlanRevision})
                    </span>
                  )}
                </dd>
              </div>
            )}
            {detail.approvedShotPlanId && (
              <div className="definition-item">
                <dt>Approved Shot Plan</dt>
                <dd data-testid="approved-shot-plan-status">
                  <code>{detail.approvedShotPlanId}</code>
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Interactive Review Command Controls */}
        <ReviewCommandControls
          detail={detail}
          productionAttempt={productionAttempt}
          productionInspection={productionInspection}
          state={state}
          dispatch={dispatch}
          disabled={disabled}
          onDetailChange={onDetailChange}
        />
      </div>

      {/* Structured Shot Plans */}
      <ShotPlanPanel
        shotPlans={detail.shotPlans ?? []}
        selectedShotPlanId={detail.selectedShotPlanId}
        approvedShotPlanId={detail.approvedShotPlanId}
        currentSpecRevision={detail.specRevision}
        candidatesByRevision={detail.candidatesByRevision}
        allowedActions={detail.allowedActions}
        state={state}
        dispatch={dispatch}
        disabled={disabled}
        sceneId={detail.sceneId}
        productionInspection={productionInspection}
      />

      {/* Production Review Panel (when production attempt exists) */}
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={productionAttempt}
        state={state}
        dispatch={dispatch}
        disabled={disabled}
      />

      {/* Candidate History Gallery */}
      <CandidateGallery
        candidatesByRevision={detail.candidatesByRevision}
        currentSpecRevision={detail.specRevision}
        selectedCandidateId={detail.selectedCandidateId}
        selectedCandidateRevision={detail.selectedCandidateRevision}
        onSelectCandidate={handleSelectCandidate}
        disabled={disabled}
      />
    </div>
  );
}

export default SceneReviewDetailView;
