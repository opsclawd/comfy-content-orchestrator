"use client";

import { useState } from "react";
import type { MediaAvailability } from "@cco/contracts";

export interface CandidateMediaProps {
  media: MediaAvailability;
  revision?: number;
  specRevision?: number;
  variantOrdinal: number;
}

export function CandidateMedia({
  media,
  revision,
  specRevision,
  variantOrdinal
}: CandidateMediaProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const rev = revision ?? specRevision ?? 1;

  if (!media.available || !media.url) {
    return (
      <div className="candidate-media-unavailable" data-testid="candidate-media-unavailable">
        <p className="candidate-media-status-text">
          Media unavailable; candidate provenance retained
        </p>
      </div>
    );
  }

  const failed = failedUrl === media.url;

  if (failed) {
    return (
      <div className="candidate-media-expired" data-testid="candidate-media-expired">
        <p className="candidate-media-status-text">Media expired or unavailable</p>
        <button
          type="button"
          className="candidate-media-refresh-btn"
          data-testid="candidate-media-refresh-btn"
          onClick={() => {
            if (typeof window !== "undefined" && window.location) {
              window.location.reload();
            }
          }}
        >
          Refresh page
        </button>
      </div>
    );
  }

  return (
    <div className="candidate-media-container" data-testid="candidate-media-container">
      <img
        src={media.url}
        alt={`Candidate revision ${rev} variant ${variantOrdinal}`}
        className="candidate-media-img"
        data-testid="candidate-media-img"
        onError={() => setFailedUrl(media.url ?? null)}
      />
    </div>
  );
}

export default CandidateMedia;
