"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import type { CurrentProductionAttemptReadModel } from "../api/client";
import {
  areCommandsDisabled,
  type ReviewCommandEvent,
  type ReviewCommandState
} from "./review-command-state";
import { formatReviewAction } from "./format-review-value";

export interface ProductionReviewPanelProps {
  detail: SceneReviewDetailReadModel;
  productionAttempt?: CurrentProductionAttemptReadModel | undefined;
  state: ReviewCommandState;
  dispatch: (event: ReviewCommandEvent) => void;
  disabled?: boolean | undefined;
}

export function ProductionReviewPanel({
  detail,
  productionAttempt,
  state,
  dispatch,
  disabled: propsDisabled
}: ProductionReviewPanelProps) {
  const router = useRouter();
  const [playerError, setPlayerError] = useState(false);

  const mediaUrl = productionAttempt?.media?.url;
  const prevMediaUrlRef = useRef(mediaUrl);

  useEffect(() => {
    if (prevMediaUrlRef.current !== mediaUrl) {
      prevMediaUrlRef.current = mediaUrl;
      setPlayerError(false);
    }
  }, [mediaUrl]);

  if (!productionAttempt) {
    return null;
  }

  const disabled = propsDisabled ?? areCommandsDisabled(state);
  const isStaleSpec = detail.specRevision !== productionAttempt.specRevision;

  const canAccept =
    Boolean(productionAttempt.productionJobId) &&
    detail.allowedActions?.includes("production_accept");
  const canRerender =
    Boolean(productionAttempt.productionJobId) &&
    detail.allowedActions?.includes("production_rerender");

  const handleAccept = () => {
    if (!productionAttempt.productionJobId) return;
    dispatch({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "production_accept",
        payload: {
          expectedProductionJobId: productionAttempt.productionJobId
        },
        displayLabel: formatReviewAction("production_accept")
      }
    });
  };

  const handleRerender = () => {
    if (!productionAttempt.productionJobId) return;
    dispatch({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "production_rerender",
        payload: {
          expectedProductionJobId: productionAttempt.productionJobId
        },
        displayLabel: formatReviewAction("production_rerender")
      }
    });
  };

  const isRendering =
    productionAttempt.technicalState === "queued" ||
    productionAttempt.technicalState === "leased" ||
    productionAttempt.technicalState === "rendering";

  const isFailed =
    productionAttempt.technicalState === "failed" ||
    productionAttempt.technicalState === "cancelled";

  const isMediaUnavailable = productionAttempt.availability !== "available" || playerError;

  const renderContent = () => {
    if (isRendering) {
      return (
        <div
          className="production-status-banner production-rendering-banner"
          data-testid="production-rendering-banner"
          role="status"
        >
          <h3>Rendering in Progress</h3>
          <p>
            Production clip is currently {productionAttempt.technicalState} (attempt #
            {productionAttempt.attemptOrdinal}).
          </p>
        </div>
      );
    }

    if (isFailed) {
      return (
        <div
          className="production-status-banner production-failed-banner"
          data-testid="production-failed-banner"
          role="alert"
        >
          <h3>Production Attempt Failed</h3>
          <p>
            Production attempt #{productionAttempt.attemptOrdinal} ended in state{" "}
            <strong>{productionAttempt.technicalState}</strong>.
          </p>
        </div>
      );
    }

    if (isMediaUnavailable) {
      return (
        <div
          className="production-status-banner production-media-unavailable"
          data-testid="production-media-unavailable"
          role="alert"
        >
          <h3>Media Unavailable</h3>
          <p>
            {playerError
              ? "This clip's preview link has expired or encountered a playback error."
              : "Production media is currently unavailable or missing."}
          </p>
          <button
            type="button"
            className="retry-button reload-media-button"
            data-testid="reload-production-media-button"
            onClick={() => router.refresh()}
          >
            Reload Media
          </button>
        </div>
      );
    }

    if (!productionAttempt.reviewReady) {
      return (
        <div
          className="production-status-banner production-not-ready-banner"
          data-testid="production-not-ready-banner"
          role="status"
        >
          <h3>Not Ready for Review</h3>
          <p>Production attempt #{productionAttempt.attemptOrdinal} is not ready for review.</p>
        </div>
      );
    }

    if (productionAttempt.media?.url) {
      return (
        <div className="production-clip-container">
          <video
            key={productionAttempt.media.url}
            controls
            src={productionAttempt.media.url}
            data-testid="production-clip-player"
            onError={() => setPlayerError(true)}
          />
        </div>
      );
    }

    return (
      <div
        className="production-status-banner production-media-unavailable"
        data-testid="production-media-unavailable"
        role="alert"
      >
        <h3>Media Unavailable</h3>
        <p>Production media URL is missing.</p>
        <button
          type="button"
          className="retry-button reload-media-button"
          data-testid="reload-production-media-button"
          onClick={() => router.refresh()}
        >
          Reload Media
        </button>
      </div>
    );
  };

  return (
    <section
      className="scene-section production-review-surface"
      aria-label="Production Review"
      data-testid="production-review-panel"
    >
      <div className="production-review-header">
        <div className="production-header-info">
          <h2>Production Review</h2>
          <div className="production-attempt-identity" data-testid="production-attempt-identity">
            <span className="identity-badge">Attempt #{productionAttempt.attemptOrdinal}</span>
            <span className="identity-badge">Spec Rev {productionAttempt.specRevision}</span>
            <span className="identity-badge status-badge">{productionAttempt.technicalState}</span>
            {productionAttempt.productionJobId && (
              <span className="identity-badge job-badge">
                Job: <code>{productionAttempt.productionJobId}</code>
              </span>
            )}
          </div>
        </div>

        {(canAccept || canRerender) && (
          <div className="production-review-actions" data-testid="production-review-actions">
            {canAccept && (
              <button
                type="button"
                className="review-action-btn review-action-production_accept"
                data-testid="action-button-production_accept"
                data-action="production_accept"
                disabled={disabled}
                onClick={handleAccept}
              >
                {formatReviewAction("production_accept")}
              </button>
            )}
            {canRerender && (
              <button
                type="button"
                className="review-action-btn review-action-production_rerender"
                data-testid="action-button-production_rerender"
                data-action="production_rerender"
                disabled={disabled}
                onClick={handleRerender}
              >
                {formatReviewAction("production_rerender")}
              </button>
            )}
          </div>
        )}
      </div>

      {isStaleSpec && (
        <div
          className="review-conflict-banner"
          data-testid="production-stale-spec-banner"
          role="alert"
        >
          <h3>Spec Revision Mismatch</h3>
          <p>
            This production attempt was generated for spec revision{" "}
            <strong>{productionAttempt.specRevision}</strong>, but the scene is at spec revision{" "}
            <strong>{detail.specRevision}</strong>.
          </p>
        </div>
      )}

      <div className="production-review-body">{renderContent()}</div>
    </section>
  );
}

export default ProductionReviewPanel;
