"use client";

import React, { useEffect, useReducer, useRef } from "react";
import Link from "next/link";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import { CandidateGallery } from "./candidate-gallery";
import { ReviewCommandControls } from "./review-command-controls";
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
  onDetailChange?: ((detail: SceneReviewDetailReadModel) => void) | undefined;
}

export function SceneReviewDetailView({ detail, onDetailChange }: SceneReviewDetailProps) {
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
        <section className="scene-section configuration-section" aria-label="Scene Configuration">
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
                {hasReferences ? (
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
        <section className="scene-section review-state-section" aria-label="Review State">
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
          </dl>
        </section>

        {/* Interactive Review Command Controls */}
        <ReviewCommandControls
          detail={detail}
          state={state}
          dispatch={dispatch}
          disabled={disabled}
          onDetailChange={onDetailChange}
        />
      </div>

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
