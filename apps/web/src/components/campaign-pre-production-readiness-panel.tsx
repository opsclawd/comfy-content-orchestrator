import type React from "react";
import Link from "next/link";
import type {
  CampaignPreProductionReadinessReadModel,
  CampaignReadinessBlocker,
  CampaignReadinessSceneProjection
} from "@cco/contracts";

export interface CampaignPreProductionReadinessPanelProps {
  readonly readiness?: CampaignPreProductionReadinessReadModel | undefined;
}

function blockerHref(blocker: Pick<CampaignReadinessBlocker, "drillDown">): string {
  return `/scenes/${blocker.drillDown.sceneId}#${blocker.drillDown.section}`;
}

function SceneBlockerRow({
  scene
}: {
  readonly scene: CampaignReadinessSceneProjection;
}): React.JSX.Element {
  return (
    <li
      className="readiness-scene-row"
      data-testid="readiness-attention-row"
      data-stale={scene.staleness.isStaleAfterRevisionChange ? "true" : undefined}
      data-status={scene.status}
    >
      <div className="readiness-scene-heading">
        <span className="readiness-scene-order">
          Scene {scene.sceneOrder.toString().padStart(2, "0")}
        </span>
        {scene.staleness.isStaleAfterRevisionChange && (
          <span className="readiness-stale-badge" data-testid="readiness-stale-badge">
            STALE
          </span>
        )}
      </div>
      <ul className="readiness-blocker-list">
        {scene.blockers.map((blocker) => (
          <li
            key={blocker.code}
            className="readiness-blocker-item"
            data-severity={blocker.severity}
          >
            <Link href={blockerHref(blocker)} className="readiness-blocker-link">
              {blocker.message}
            </Link>
            <span className="readiness-remediation-hint">{blocker.remediationHint}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function CampaignPreProductionReadinessPanel({
  readiness
}: CampaignPreProductionReadinessPanelProps): React.JSX.Element | null {
  if (!readiness) {
    return null;
  }

  if (readiness.aggregates.totalScenes === 0) {
    return (
      <section
        className="campaign-readiness-section"
        data-testid="campaign-readiness-panel"
        aria-label="Pre-Production Readiness"
      >
        <div className="readiness-empty-state" data-testid="readiness-empty-state">
          No scenes found in this campaign yet.
        </div>
      </section>
    );
  }

  const needsAttentionScenes = readiness.scenes.filter((s) => s.status === "needs_attention");
  const blockedScenes = readiness.scenes.filter((s) => s.status === "blocked_for_planning");
  const readyScenes = readiness.scenes.filter((s) => s.status === "planning_ready");
  const advisories = readiness.scenes.flatMap((s) =>
    s.advisories.map((advisory) => ({ scene: s, advisory }))
  );

  return (
    <section
      className="campaign-readiness-section"
      data-testid="campaign-readiness-panel"
      aria-label="Pre-Production Readiness"
    >
      <div className="readiness-panel-header">
        <div className="readiness-header-title-group">
          <div className="readiness-title-row">
            <h2 className="readiness-panel-title">Pre-Production Readiness</h2>
            <span className="readiness-planning-badge" data-testid="readiness-panel-planning-badge">
              PLANNING PREREQUISITES ONLY
            </span>
          </div>
          <p className="readiness-panel-description">{readiness.planningOnlyNotice}</p>
        </div>

        <div className="readiness-headline" data-testid="readiness-headline">
          {readiness.aggregates.planningReadyCount} / {readiness.aggregates.totalScenes} scenes
          planning-ready
        </div>

        <div className="readiness-stats-row" data-testid="readiness-panel-stats">
          <div className="readiness-stat-pill" data-testid="readiness-metric-current-references">
            <span className="stat-label">Current References</span>
            <span className="stat-value">{readiness.aggregates.currentReferenceSceneCount}</span>
          </div>
          <div className="readiness-stat-pill" data-testid="readiness-metric-current-shot-plans">
            <span className="stat-label">Current ShotPlans</span>
            <span className="stat-value">
              {readiness.aggregates.scenesWithCurrentShotPlansCount}
            </span>
          </div>
          <div className="readiness-stat-pill" data-testid="readiness-metric-selections">
            <span className="stat-label">Selections</span>
            <span className="stat-value">{readiness.aggregates.scenesWithSelectionCount}</span>
          </div>
          <div className="readiness-stat-pill" data-testid="readiness-metric-approved">
            <span className="stat-label">Approved</span>
            <span className="stat-value stat-approved">
              {readiness.aggregates.approvedSceneCount}
            </span>
          </div>
          <div className="readiness-stat-pill" data-testid="readiness-metric-previs">
            <span className="stat-label">Previs</span>
            <span className="stat-value">{readiness.aggregates.scenesWithPrevisCount}</span>
          </div>
          <div className="readiness-stat-pill" data-testid="readiness-metric-animatic">
            <span className="stat-label">In Animatic</span>
            <span className="stat-value">{readiness.aggregates.scenesInCampaignAnimaticCount}</span>
          </div>
          <div
            className={`readiness-stat-pill ${readiness.aggregates.staleSceneCount > 0 ? "stat-pill-warning" : ""}`}
            data-testid="readiness-metric-stale"
          >
            <span className="stat-label">Stale</span>
            <span className="stat-value stat-stale">{readiness.aggregates.staleSceneCount}</span>
          </div>
        </div>
      </div>

      {blockedScenes.length > 0 && (
        <div
          className="readiness-group readiness-group-blocked"
          data-testid="readiness-blocked-group"
        >
          <h3 className="readiness-group-title">Blocked for planning</h3>
          <ul className="readiness-scene-list">
            {blockedScenes.map((scene) => (
              <SceneBlockerRow key={scene.sceneId} scene={scene} />
            ))}
          </ul>
        </div>
      )}

      {needsAttentionScenes.length > 0 && (
        <div
          className="readiness-group readiness-group-attention"
          data-testid="readiness-attention-group"
        >
          <h3 className="readiness-group-title">Needs attention</h3>
          <ul className="readiness-scene-list">
            {needsAttentionScenes.map((scene) => (
              <SceneBlockerRow key={scene.sceneId} scene={scene} />
            ))}
          </ul>
        </div>
      )}

      {readyScenes.length > 0 && (
        <div className="readiness-group readiness-group-ready" data-testid="readiness-ready-group">
          <h3 className="readiness-group-title">Ready</h3>
          <p className="readiness-ready-rollup" data-testid="readiness-ready-rollup">
            Scenes {readyScenes.map((s) => s.sceneOrder.toString().padStart(2, "0")).join(", ")}
          </p>
        </div>
      )}

      {advisories.length > 0 && (
        <div className="readiness-advisories" data-testid="readiness-advisories">
          {advisories.map(({ scene, advisory }) => (
            <div key={`${scene.sceneId}-${advisory.code}`} className="readiness-advisory-item">
              <Link href={blockerHref(advisory)} className="readiness-advisory-link">
                {advisory.message}
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="readiness-panel-footer">
        <span className="readiness-snapshot-tag" data-testid="readiness-snapshot-tag">
          Snapshot: <code>{readiness.readSnapshotId.slice(0, 12)}</code>
        </span>
      </div>
    </section>
  );
}
