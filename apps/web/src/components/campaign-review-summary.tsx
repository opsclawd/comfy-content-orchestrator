import Link from "next/link";
import type { CampaignReviewSummary } from "@cco/contracts";

export interface CampaignReviewSummaryProps {
  summary: CampaignReviewSummary;
}

export function CampaignReviewSummaryView({ summary }: CampaignReviewSummaryProps) {
  const statusEntries = Object.entries(summary.scenesByStatus);

  return (
    <div className="campaign-summary-shell" data-testid="campaign-summary">
      <header className="campaign-header">
        <h1 className="campaign-title" data-testid="campaign-name">
          {summary.campaignName}
        </h1>
        <div className="campaign-meta">
          <span className="campaign-id-label">Campaign ID: {summary.campaignId}</span>
          <span className="campaign-updated-at" data-testid="campaign-updated-at">
            Updated: {summary.updatedAt}
          </span>
        </div>
      </header>

      <section className="metrics-section" aria-label="Campaign Metrics">
        <div className="metric-grid" data-testid="campaign-metrics">
          <div className="metric-card" data-testid="metric-total-scenes">
            <span className="metric-label">Total Scenes</span>
            <span className="metric-value">{summary.totalScenes}</span>
          </div>
          <div className="metric-card" data-testid="metric-pending-review">
            <span className="metric-label">Pending Review</span>
            <span className="metric-value">{summary.pendingReviewCount}</span>
          </div>
          <div className="metric-card" data-testid="metric-approved">
            <span className="metric-label">Approved</span>
            <span className="metric-value">{summary.approvedCount}</span>
          </div>
          <div className="metric-card" data-testid="metric-completed">
            <span className="metric-label">Completed</span>
            <span className="metric-value">{summary.completedCount}</span>
          </div>
        </div>
      </section>

      {statusEntries.length > 0 && (
        <section className="status-breakdown-section" aria-label="Status Breakdown">
          <h2>Status Breakdown</h2>
          <ul className="status-breakdown-list" data-testid="scenes-by-status">
            {statusEntries.map(([status, count]) => (
              <li
                key={status}
                className="status-breakdown-item"
                data-testid={`status-count-${status}`}
              >
                <span className="status-badge" data-status={status}>
                  {status}
                </span>
                <span className="status-count">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="scenes-section" aria-label="Scenes List">
        <h2>Scenes</h2>
        {summary.scenes.length === 0 ? (
          <div className="empty-state" data-testid="empty-campaign-state">
            <p>No scenes found in this campaign.</p>
          </div>
        ) : (
          <ul className="scene-list" data-testid="scene-list">
            {summary.scenes.map((scene) => (
              <li key={scene.sceneId} className="scene-row" data-testid="scene-row">
                <Link
                  href={`/scenes/${scene.sceneId}`}
                  className="scene-link"
                  data-testid="scene-link"
                >
                  <div className="scene-info">
                    <span className="scene-id">{scene.sceneId}</span>
                    <span className="scene-revision">Revision {scene.specRevision}</span>
                  </div>
                  <span className="status-badge" data-status={scene.status}>
                    {scene.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default CampaignReviewSummaryView;
