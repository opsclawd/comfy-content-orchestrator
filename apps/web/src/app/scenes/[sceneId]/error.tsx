"use client";

export interface SceneErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function SceneError({ error: _error, reset }: SceneErrorProps) {
  return (
    <section className="error-container" data-testid="scene-error" role="alert">
      <h1 className="error-title">Scene Review Unavailable</h1>
      <p className="error-message">
        A temporary error occurred while loading this scene review. Please try again.
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
