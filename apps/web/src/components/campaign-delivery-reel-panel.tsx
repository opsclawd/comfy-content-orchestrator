"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { CampaignDeliveryReelReadModel } from "@cco/contracts";
import { formatDurationMs } from "./format-review-value";

export interface CampaignDeliveryReelPanelProps {
  deliveryReel?: CampaignDeliveryReelReadModel | undefined;
}

export function CampaignDeliveryReelPanel({ deliveryReel }: CampaignDeliveryReelPanelProps) {
  const router = useRouter();
  const [playerError, setPlayerError] = useState(false);

  const mediaUrl = deliveryReel?.media?.url;
  const prevMediaUrlRef = useRef(mediaUrl);

  useEffect(() => {
    if (prevMediaUrlRef.current !== mediaUrl) {
      prevMediaUrlRef.current = mediaUrl;
      setPlayerError(false);
    }
  }, [mediaUrl]);

  if (!deliveryReel) {
    return null;
  }

  const handleReload = () => {
    setPlayerError(false);
    router.refresh();
  };

  const isNotStarted = deliveryReel.status === "not-started";
  const isAssembling = deliveryReel.status === "assembling";
  const isFailed = deliveryReel.status === "failed";
  const isUnavailable =
    deliveryReel.status === "unavailable-artifact" ||
    playerError ||
    (deliveryReel.status === "completed" && !deliveryReel.media?.url);
  const isCompleted =
    deliveryReel.status === "completed" && Boolean(deliveryReel.media?.url) && !playerError;

  const renderContent = () => {
    if (isNotStarted) {
      return (
        <div
          className="delivery-status-banner delivery-not-started-banner"
          data-testid="delivery-reel-not-started"
          role="status"
        >
          <h3>Delivery Reel Not Started</h3>
          <p>Scene renders must be completed and accepted before delivery assembly begins.</p>
        </div>
      );
    }

    if (isAssembling) {
      return (
        <div
          className="delivery-status-banner delivery-assembling-banner"
          data-testid="delivery-reel-assembling"
          role="status"
        >
          <h3>Assembly in Progress</h3>
          <p>Delivery reel assembly is currently in progress.</p>
          {deliveryReel.assemblyJobId && (
            <div className="delivery-reel-meta">
              <span className="identity-badge job-badge" data-testid="delivery-reel-job-id">
                Job: <code>{deliveryReel.assemblyJobId}</code>
              </span>
            </div>
          )}
        </div>
      );
    }

    if (isFailed) {
      return (
        <div
          className="delivery-status-banner delivery-failed-banner"
          data-testid="delivery-reel-failed"
          role="alert"
        >
          <h3>Delivery Reel Assembly Failed</h3>
          <p data-testid="delivery-reel-error">
            {deliveryReel.error ?? "An error occurred during delivery reel assembly."}
          </p>
          {deliveryReel.assemblyJobId && (
            <div className="delivery-reel-meta">
              <span className="identity-badge job-badge" data-testid="delivery-reel-job-id">
                Job: <code>{deliveryReel.assemblyJobId}</code>
              </span>
            </div>
          )}
        </div>
      );
    }

    if (isUnavailable) {
      return (
        <div
          className="delivery-status-banner delivery-unavailable-banner"
          data-testid="delivery-reel-unavailable"
          role="alert"
        >
          <div data-testid="delivery-reel-unavailable-artifact">
            <h3>Delivery Media Unavailable</h3>
            <p data-testid="delivery-reel-unavailable-reason">
              {playerError
                ? "Delivery reel playback link expired or encountered an error."
                : (deliveryReel.reason ?? "Delivery media or manifest is unavailable in storage.")}
            </p>
            {deliveryReel.assemblyId && (
              <div className="delivery-reel-meta">
                <span className="identity-badge" data-testid="delivery-reel-assembly-id">
                  Assembly: <code>{deliveryReel.assemblyId}</code>
                </span>
              </div>
            )}
            <button
              type="button"
              className="reload-reel-button"
              data-testid="reload-delivery-reel-button"
              onClick={handleReload}
            >
              Reload Reel
            </button>
          </div>
        </div>
      );
    }

    if (isCompleted && deliveryReel.media) {
      const { media } = deliveryReel;
      return (
        <div className="delivery-reel-completed-container" data-testid="delivery-reel-completed">
          <div className="delivery-reel-completed-header">
            <h3>Final Delivery Reel</h3>
            <div className="delivery-reel-meta">
              {deliveryReel.assemblyId && (
                <span className="identity-badge" data-testid="delivery-reel-assembly-id">
                  Assembly: <code>{deliveryReel.assemblyId}</code>
                </span>
              )}
              {deliveryReel.assemblyJobId && (
                <span className="identity-badge job-badge" data-testid="delivery-reel-job-id">
                  Job: <code>{deliveryReel.assemblyJobId}</code>
                </span>
              )}
              {media.durationMs !== undefined && (
                <span className="identity-badge" data-testid="delivery-reel-duration">
                  {formatDurationMs(media.durationMs)}
                </span>
              )}
              {media.width !== undefined && media.height !== undefined && (
                <span className="identity-badge" data-testid="delivery-reel-resolution">
                  {media.width}x{media.height}
                </span>
              )}
              {media.sha256 && (
                <span className="identity-badge" data-testid="delivery-reel-sha256">
                  SHA: <code>{media.sha256.slice(0, 12)}...</code>
                </span>
              )}
            </div>
          </div>

          <div className="delivery-reel-video-container" data-testid="delivery-reel-video">
            <video
              key={media.url}
              controls
              src={media.url}
              data-testid="delivery-reel-player"
              onError={() => setPlayerError(true)}
            />
          </div>

          <div className="delivery-reel-actions">
            <a
              href={media.url}
              download={`campaign-${deliveryReel.campaignId}-reel.mp4`}
              className="download-delivery-reel-button"
              data-testid="delivery-reel-download-link"
              role="button"
            >
              <span data-testid="delivery-reel-download-button">Download Final Reel (.mp4)</span>
            </a>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <section
      className="delivery-reel-surface campaign-delivery-reel-surface"
      aria-label="Campaign Delivery Reel"
      data-testid="campaign-delivery-reel-panel"
      data-status={deliveryReel.status}
    >
      <div
        className="delivery-reel-panel"
        data-testid="delivery-reel-panel"
        data-status={deliveryReel.status}
      >
        <div className="delivery-reel-header">
          <div className="delivery-reel-header-info">
            <h2>Campaign Delivery Reel</h2>
            <div className="delivery-reel-identity">
              <span
                className="identity-badge status-badge"
                data-testid="delivery-reel-state"
                data-status={deliveryReel.status}
              >
                {deliveryReel.status}
                <span
                  className="sr-only"
                  data-testid={`delivery-reel-state-${deliveryReel.status}`}
                />
              </span>
            </div>
          </div>
        </div>

        <div className="delivery-reel-body">{renderContent()}</div>
      </div>
    </section>
  );
}

export default CampaignDeliveryReelPanel;
