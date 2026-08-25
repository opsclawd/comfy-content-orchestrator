import React from "react";
import Link from "next/link";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import { CandidateGallery } from "./candidate-gallery";
import {
  formatSceneStatus,
  formatReviewAction,
  formatDurationMs,
  formatDateTime
} from "./format-review-value";

export interface SceneReviewDetailProps {
  detail: SceneReviewDetailReadModel;
}

export function SceneReviewDetailView({ detail }: SceneReviewDetailProps) {
  const { configuration, approval } = detail;
  const hasReferences = configuration.referenceIds && configuration.referenceIds.length > 0;
  const hasLora =
    configuration.loraConfigurationId !== null && configuration.loraConfigurationId !== undefined;
  const hasSelection = Boolean(detail.selectedCandidateId);
  const hasApproval = Boolean(approval);
  const hasAllowedActions = detail.allowedActions && detail.allowedActions.length > 0;

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
            <div className="definition-item full-width">
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

        {/* Server Allowed Actions (Informational Only) */}
        <section
          className="scene-section allowed-actions-section"
          aria-label="Server-Available Actions"
          data-testid="allowed-actions-section"
        >
          <h2>Server-Available Actions</h2>
          <p className="actions-disclaimer">
            The following review actions are currently permitted by the server for this scene state
            (read-only view):
          </p>
          {hasAllowedActions ? (
            <ul className="action-chips-list" data-testid="action-chips-list">
              {detail.allowedActions.map((action) => (
                <li key={action} className="action-chip" data-action={action}>
                  <span className="action-chip-label">{formatReviewAction(action)}</span>
                  <code className="action-chip-code">({action})</code>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-actions" data-testid="empty-actions">
              <span className="empty-value">No actions available</span>
            </div>
          )}
        </section>
      </div>

      {/* Candidate History Gallery */}
      <CandidateGallery
        candidatesByRevision={detail.candidatesByRevision}
        currentSpecRevision={detail.specRevision}
        selectedCandidateId={detail.selectedCandidateId}
        selectedCandidateRevision={detail.selectedCandidateRevision}
      />
    </div>
  );
}

export default SceneReviewDetailView;
