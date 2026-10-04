"use client";

import React, { useState } from "react";
import type { H3ProductionInspectionReadModel } from "@cco/contracts";

export interface ProductionInputInspectorProps {
  readonly inspection: H3ProductionInspectionReadModel | null | undefined;
  readonly isLoading?: boolean | undefined;
  readonly error?: string | null | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly isCompact?: boolean | undefined;
}

export function ProductionInputInspector({
  inspection,
  isLoading,
  error,
  onRefresh,
  isCompact = false
}: ProductionInputInspectorProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  function handleCopyFingerprint() {
    if (!inspection?.productionInputFingerprint) return;
    void navigator.clipboard.writeText(inspection.productionInputFingerprint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (isLoading) {
    return (
      <div
        className="production-input-inspector-loading"
        data-testid="inspector-loading"
        role="status"
        aria-label="Loading production input inspection"
      >
        <div className="inspector-skeleton-pulse">
          <div className="skeleton-line title" />
          <div className="skeleton-line fingerprint" />
          <div className="skeleton-line details" />
        </div>
        <p>Inspecting production inputs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="production-input-inspector-error" data-testid="inspector-error" role="alert">
        <h4>Inspection Unavailable</h4>
        <p>{error}</p>
        {onRefresh && (
          <button
            type="button"
            className="action-button secondary-action"
            onClick={onRefresh}
            data-testid="inspector-retry-button"
          >
            Retry Inspection
          </button>
        )}
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="production-input-inspector-empty" data-testid="inspector-empty">
        <p>No production inspection data available for this scene.</p>
      </div>
    );
  }

  const {
    authority,
    route,
    visualInputs,
    instruction,
    admission,
    runtimeContext,
    productionInputFingerprint
  } = inspection;

  const readinessBadgeClass =
    admission.readiness === "ready"
      ? "readiness-badge-ready"
      : admission.readiness === "awaiting_approval"
        ? "readiness-badge-awaiting"
        : "readiness-badge-blocked";

  const readinessLabel =
    admission.readiness === "ready"
      ? "READY FOR ADMISSION"
      : admission.readiness === "awaiting_approval"
        ? "AWAITING APPROVAL"
        : "ADMISSION BLOCKED";

  return (
    <section
      className={`production-input-inspector ${isCompact ? "compact" : ""}`}
      data-testid="production-input-inspector"
      aria-label="H3 Production Input Inspector"
    >
      {/* Header with Title and Readiness Badge */}
      <div className="inspector-header">
        <div className="inspector-title-row">
          <div className="inspector-title-group">
            <h3>PRODUCTION INPUT</h3>
            <span className="inspector-subtitle">What H3 will receive</span>
          </div>
          <div className="inspector-actions-row">
            <span
              className={`inspector-readiness-badge ${readinessBadgeClass}`}
              data-testid="inspector-readiness-badge"
              data-readiness={admission.readiness}
            >
              {readinessLabel}
            </span>
            {onRefresh && (
              <button
                type="button"
                className="inspector-refresh-button"
                onClick={onRefresh}
                title="Re-inspect production inputs"
                data-testid="inspector-refresh-button"
              >
                ↻
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Deterministic Production Input Fingerprint */}
      <div className="inspector-fingerprint-section" data-testid="inspector-fingerprint-section">
        <div className="fingerprint-label-row">
          <span className="fingerprint-label">Production Input Fingerprint:</span>
          <button
            type="button"
            className="fingerprint-copy-button"
            onClick={handleCopyFingerprint}
            data-testid="copy-fingerprint-button"
            title="Copy full 64-character SHA-256 fingerprint"
          >
            {copied ? "Copied!" : "Copy Hash"}
          </button>
        </div>
        <div className="fingerprint-value-row">
          <code
            className="inspector-fingerprint"
            data-testid="inspector-fingerprint"
            title={productionInputFingerprint}
          >
            {productionInputFingerprint}
          </code>
        </div>
        <span className="fingerprint-explanation">
          Pure SHA-256 hash over canonical instructions, visual references in slot order, frame
          anchor, and target geometry.
        </span>
      </div>

      {/* Blockers Alert (if blocked) */}
      {admission.blockers.length > 0 && (
        <div className="inspector-blockers-alert" data-testid="inspector-blockers" role="alert">
          <h4>Admission Blockers ({admission.blockers.length})</h4>
          <ul className="inspector-blocker-list">
            {admission.blockers.map((b, idx) => (
              <li key={`${b.code}-${idx}`} className="inspector-blocker-item">
                <code className="blocker-code">{b.code}</code>: {b.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Authority & Revision Context */}
      <div className="inspector-section inspector-authority" data-testid="inspector-authority">
        <h4>Authority &amp; Versioning</h4>
        <div className="inspector-grid grid-2">
          <div className="inspector-field">
            <span className="field-label">Scene ID:</span>
            <code className="field-value">{authority.sceneId}</code>
          </div>
          <div className="inspector-field">
            <span className="field-label">Spec Revision:</span>
            <span className="field-value">Revision {authority.specRevision}</span>
          </div>
          <div className="inspector-field">
            <span className="field-label">Shot Plan ID:</span>
            <code className="field-value">{authority.shotPlanId ?? "None"}</code>
          </div>
          <div className="inspector-field">
            <span className="field-label">Shot Plan Status:</span>
            <span className="field-value">
              {authority.shotPlanStatus ?? "None"}
              {authority.variantOrdinal ? ` (Variant #${authority.variantOrdinal})` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Route & Target Geometry */}
      <div className="inspector-section inspector-route" data-testid="inspector-route">
        <h4>Target Route &amp; Geometry</h4>
        <div className="inspector-grid grid-3">
          <div className="inspector-field">
            <span className="field-label">Routing Mode:</span>
            <span className="field-value mode-badge" data-mode={route.routingMode}>
              {route.routingMode}
            </span>
          </div>
          <div className="inspector-field">
            <span className="field-label">Render Profile:</span>
            <code className="field-value">{route.renderProfileKey}</code>
          </div>
          <div className="inspector-field">
            <span className="field-label">Workflow Template:</span>
            <code className="field-value">{route.workflowTemplate}</code>
          </div>
          <div className="inspector-field">
            <span className="field-label">Dimensions &amp; FPS:</span>
            <span className="field-value">
              {route.width}x{route.height} @ {route.fps} fps
            </span>
          </div>
          <div className="inspector-field">
            <span className="field-label">Target Duration:</span>
            <span className="field-value">
              {route.targetFrameCount} frames ({route.targetDurationMs}ms)
            </span>
          </div>
          <div className="inspector-field">
            <span className="field-label">Execution Ceiling:</span>
            <span className="field-value">
              {runtimeContext.durationCeilingSeconds ?? 60} seconds
            </span>
          </div>
        </div>
      </div>

      {/* Visual Inputs & Non-Authoritative Previs Invariant Notice */}
      <div
        className="inspector-section inspector-visual-inputs"
        data-testid="inspector-visual-inputs"
      >
        <div className="visual-inputs-header">
          <h4>Visual Inputs</h4>
          <span className="previs-review-only-notice" data-testid="previs-review-only-notice">
            Previs candidate stills are non-authoritative review evidence and never condition
            diffusion or alter fingerprint.
          </span>
        </div>

        {route.routingMode === "reference_directed" && (
          <div className="inspector-references-container" data-testid="inspector-references-list">
            {visualInputs.references.length === 0 ? (
              <p className="no-visual-inputs-message">No visual references bound to this scene.</p>
            ) : (
              <div className="inspector-references-table-wrapper">
                <table className="inspector-references-table">
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>Tag</th>
                      <th>Reference Asset</th>
                      <th>Role</th>
                      <th>Content Hash</th>
                      <th>Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visualInputs.references.map((ref) => (
                      <tr key={`${ref.slotIndex}-${ref.referenceAssetId}`}>
                        <td>
                          <span className="slot-badge">#{ref.slotIndex}</span>
                        </td>
                        <td>
                          <code className="prompt-tag-badge">{ref.promptTag}</code>
                        </td>
                        <td>
                          <div className="reference-name-cell">
                            <span className="asset-display-name">{ref.displayName}</span>
                            <code className="asset-id-subtext">{ref.referenceAssetId}</code>
                          </div>
                        </td>
                        <td>
                          <span className="role-tag" data-role={ref.role}>
                            {ref.role}
                          </span>
                        </td>
                        <td>
                          <code className="hash-preview" title={ref.contentHashSha256}>
                            {ref.contentHashSha256.slice(0, 12)}...
                          </code>
                        </td>
                        <td>
                          {ref.previewUrl ? (
                            <img
                              src={ref.previewUrl}
                              alt={ref.displayName}
                              className="reference-thumbnail"
                            />
                          ) : (
                            <span className="thumbnail-unavailable">No preview</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {route.routingMode === "frame_anchored" && (
          <div className="inspector-frame-anchor-card" data-testid="inspector-frame-anchor">
            {visualInputs.frameAnchor ? (
              <div className="frame-anchor-details">
                <div className="inspector-field">
                  <span className="field-label">Anchor Target:</span>
                  <span className="field-value">{visualInputs.frameAnchor.frameAnchorTarget}</span>
                </div>
                <div className="inspector-field">
                  <span className="field-label">Candidate ID:</span>
                  <code className="field-value">{visualInputs.frameAnchor.anchorCandidateId}</code>
                </div>
                <div className="inspector-field">
                  <span className="field-label">Anchor Media Hash:</span>
                  <code
                    className="field-value"
                    title={visualInputs.frameAnchor.anchorMediaHashSha256}
                  >
                    {visualInputs.frameAnchor.anchorMediaHashSha256.slice(0, 16)}...
                  </code>
                </div>
                {visualInputs.frameAnchor.previewUrl && (
                  <div className="frame-anchor-preview">
                    <img
                      src={visualInputs.frameAnchor.previewUrl}
                      alt="Frame anchor preview"
                      className="anchor-thumbnail"
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="no-visual-inputs-message">
                No frame anchor candidate bound to this scene.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Instruction & Camera Intent */}
      <div className="inspector-section inspector-instruction" data-testid="inspector-instruction">
        <h4>Compiled Instruction</h4>
        <blockquote className="inspector-compiled-prompt" data-testid="inspector-compiled-prompt">
          {instruction.compiledText}
        </blockquote>
        <div className="instruction-hash-row">
          <span className="hash-label">Instruction Hash:</span>
          <code className="instruction-hash" title={instruction.compiledSha256}>
            {instruction.compiledSha256}
          </code>
        </div>

        {instruction.cameraIntentSummary && (
          <div className="inspector-camera-summary" data-testid="inspector-camera-summary">
            <h5>Camera Intent Summary</h5>
            <div className="inspector-grid grid-3">
              <div className="inspector-field">
                <span className="field-label">Framing:</span>
                <span className="field-value">{instruction.cameraIntentSummary.framing}</span>
              </div>
              <div className="inspector-field">
                <span className="field-label">Angle:</span>
                <span className="field-value">{instruction.cameraIntentSummary.angle}</span>
              </div>
              <div className="inspector-field">
                <span className="field-label">Movement:</span>
                <span className="field-value">
                  {instruction.cameraIntentSummary.cameraMovement} (
                  {instruction.cameraIntentSummary.movementSpeed})
                </span>
              </div>
              <div className="inspector-field">
                <span className="field-label">Lens:</span>
                <span className="field-value">{instruction.cameraIntentSummary.lensIntent}</span>
              </div>
              <div className="inspector-field">
                <span className="field-label">Position:</span>
                <span className="field-value">
                  {instruction.cameraIntentSummary.cameraPosition}
                </span>
              </div>
              {instruction.cameraIntentSummary.cameraPromptDescription && (
                <div className="inspector-field col-span-2">
                  <span className="field-label">Camera Prompt Note:</span>
                  <span className="field-value">
                    {instruction.cameraIntentSummary.cameraPromptDescription}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
