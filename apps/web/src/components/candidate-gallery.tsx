import React from "react";
import type { SceneReviewCandidateGroup } from "@cco/contracts";
import { CandidateMedia } from "./candidate-media";
import { formatDateTime } from "./format-review-value";

export interface CandidateGalleryProps {
  candidatesByRevision: SceneReviewCandidateGroup[];
  currentSpecRevision: number;
  selectedCandidateId?: string | undefined;
  selectedCandidateRevision?: number | undefined;
}

export function CandidateGallery({
  candidatesByRevision,
  currentSpecRevision,
  selectedCandidateId,
  selectedCandidateRevision
}: CandidateGalleryProps) {
  const totalCandidates = candidatesByRevision.reduce(
    (acc, group) => acc + group.candidates.length,
    0
  );

  if (candidatesByRevision.length === 0 || totalCandidates === 0) {
    return (
      <section className="candidate-gallery-section" aria-label="Candidate History">
        <h2>Candidate History</h2>
        <div className="empty-state" data-testid="no-candidates-state">
          <p>No candidates have been generated for this scene.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="candidate-gallery-section" aria-label="Candidate History">
      <h2>Candidate History</h2>
      <div className="candidate-groups-list">
        {candidatesByRevision.map((group) => {
          const isCurrent = group.specRevision === currentSpecRevision;
          const revisionType = isCurrent ? "current" : "historical";

          return (
            <div
              key={group.specRevision}
              className={`candidate-revision-group candidate-revision-${revisionType}`}
              data-testid="candidate-revision-group"
              data-revision-type={revisionType}
            >
              <div className="revision-group-header">
                <h3 className="revision-group-heading" data-testid="revision-group-heading">
                  Revision {group.specRevision} — {revisionType}
                </h3>
                <span
                  className={`revision-badge revision-badge-${revisionType}`}
                  data-testid={`revision-badge-${revisionType}`}
                >
                  {isCurrent ? "Current Spec" : "Historical Spec"}
                </span>
              </div>

              <div className="candidate-grid">
                {group.candidates.map((candidate) => {
                  const isSelected =
                    selectedCandidateId === candidate.candidateId &&
                    selectedCandidateRevision === candidate.specRevision;

                  return (
                    <article
                      key={candidate.candidateId}
                      className={`candidate-card ${isSelected ? "candidate-card-selected" : ""} ${
                        !isCurrent ? "candidate-card-historical" : ""
                      }`}
                      data-testid="candidate-card"
                      data-candidate-id={candidate.candidateId}
                    >
                      <div className="candidate-card-media-wrapper">
                        <CandidateMedia
                          media={candidate.media}
                          specRevision={candidate.specRevision}
                          variantOrdinal={candidate.variantOrdinal}
                        />
                      </div>

                      <div className="candidate-card-body">
                        <div className="candidate-card-header">
                          <span className="candidate-variant-label">
                            Variant #{candidate.variantOrdinal}
                          </span>
                          {isSelected && (
                            <span
                              className="candidate-selected-badge"
                              data-testid="candidate-selected-badge"
                            >
                              Selected
                            </span>
                          )}
                        </div>

                        <dl className="candidate-metadata-list">
                          <div className="candidate-metadata-row">
                            <dt>Candidate ID:</dt>
                            <dd className="candidate-id-value">{candidate.candidateId}</dd>
                          </div>
                          <div className="candidate-metadata-row">
                            <dt>Content Hash:</dt>
                            <dd className="candidate-hash-value">{candidate.contentHash}</dd>
                          </div>
                          <div className="candidate-metadata-row">
                            <dt>Created:</dt>
                            <dd className="candidate-time-value">
                              {formatDateTime(candidate.createdAt)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default CandidateGallery;
