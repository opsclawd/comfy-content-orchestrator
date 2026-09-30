"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { CampaignAnimaticReadModel } from "@cco/contracts";
import { CampaignAnimaticPlayer } from "./animatic/campaign-animatic-player";

export interface CampaignAnimaticPanelProps {
  readonly animatic?: CampaignAnimaticReadModel | undefined;
}

export function CampaignAnimaticPanel({
  animatic
}: CampaignAnimaticPanelProps): React.JSX.Element | null {
  const router = useRouter();

  if (!animatic) {
    return null;
  }

  const handleRefresh = () => {
    router.refresh();
  };

  const totalSeconds = (animatic.totalDurationMs / 1000).toFixed(1);

  return (
    <section
      className="campaign-animatic-section"
      data-testid="campaign-animatic-panel"
      aria-label="Campaign Storyboard Animatic"
    >
      <div className="animatic-panel-header">
        <div className="animatic-header-title-group">
          <div className="animatic-title-row">
            <h2 className="animatic-panel-title">Storyboard Animatic / Rough Cut</h2>
            <span className="animatic-planning-badge" data-testid="animatic-panel-planning-badge">
              PLANNING ONLY
            </span>
          </div>
          <p className="animatic-panel-description">
            Continuous sequence of selected current-revision ShotPlans in canonical scene order.
            Evaluates sequence pacing, camera flow, and story continuity before H3 GPU production.
          </p>
        </div>

        <div className="animatic-stats-row" data-testid="animatic-panel-stats">
          <div className="animatic-stat-pill" data-testid="animatic-metric-duration">
            <span className="stat-label">Duration</span>
            <span className="stat-value">{totalSeconds}s</span>
          </div>
          <div className="animatic-stat-pill" data-testid="animatic-metric-scenes">
            <span className="stat-label">Scenes</span>
            <span className="stat-value">{animatic.totalScenes}</span>
          </div>
          <div className="animatic-stat-pill" data-testid="animatic-metric-approved">
            <span className="stat-label">Approved</span>
            <span className="stat-value stat-approved">{animatic.approvedShotCount}</span>
          </div>
          <div className="animatic-stat-pill" data-testid="animatic-metric-draft">
            <span className="stat-label">Selected Drafts</span>
            <span className="stat-value stat-draft">{animatic.draftShotCount}</span>
          </div>
          <div
            className={`animatic-stat-pill ${animatic.gapCount > 0 ? "stat-pill-warning" : ""}`}
            data-testid="animatic-metric-gaps"
          >
            <span className="stat-label">Gaps / Blockers</span>
            <span className={`stat-value ${animatic.gapCount > 0 ? "stat-gap" : ""}`}>
              {animatic.gapCount}
            </span>
          </div>
        </div>
      </div>

      {animatic.gapCount > 0 && (
        <div className="animatic-gap-summary-callout" data-testid="animatic-gap-summary-callout">
          <span className="gap-callout-icon" aria-hidden="true">
            ⚠️
          </span>
          <span className="gap-callout-text">
            {animatic.gapCount} {animatic.gapCount === 1 ? "scene has" : "scenes have"} no valid
            ShotPlan selected. Missing selections are rendered as timing gaps and must be resolved
            prior to MiniMax-H3 production admission.
          </span>
        </div>
      )}

      <div className="animatic-player-container">
        <CampaignAnimaticPlayer animatic={animatic} onRefresh={handleRefresh} />
      </div>

      <div className="animatic-panel-footer">
        <span className="animatic-snapshot-tag" data-testid="animatic-snapshot-tag">
          Snapshot: <code>{animatic.readSnapshotId.slice(0, 12)}</code>
        </span>
        <span className="animatic-non-production-disclaimer">
          Planning animatic — non-production media. Zero GPU rendering or assembly mutations
          incurred.
        </span>
      </div>
    </section>
  );
}
