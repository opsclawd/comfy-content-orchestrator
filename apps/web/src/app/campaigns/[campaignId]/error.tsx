"use client";

export interface CampaignErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function CampaignError({ error: _error, reset }: CampaignErrorProps) {
  return (
    <section className="error-container" data-testid="campaign-error" role="alert">
      <h1 className="error-title">Campaign Review Unavailable</h1>
      <p className="error-message">
        A temporary error occurred while loading this campaign review. Please try again.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="retry-button"
        data-testid="retry-button"
      >
        Retry
      </button>
    </section>
  );
}
