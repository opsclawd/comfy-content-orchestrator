// @ts-expect-error TS2835: Next.js App Router webpack resolves extensionless relative paths
import { getHealth, type HealthResponse } from "../api/client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let health: HealthResponse | null = null;
  let error: string | null = null;

  try {
    health = await getHealth();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section data-testid="review-hub-home">
      <h1>Director Review Hub</h1>
      <p>Private Review Plane &amp; Orchestrator Control</p>
      <div data-testid="control-api-status">
        <h2>Control API Status</h2>
        {health ? (
          <div>
            <span data-testid="health-status">Status: {health.status}</span>
            <span data-testid="health-timestamp">Timestamp: {health.timestamp}</span>
          </div>
        ) : (
          <div data-testid="health-error">
            <span>Unavailable: {error}</span>
          </div>
        )}
      </div>
    </section>
  );
}
