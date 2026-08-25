import Link from "next/link";

export default function CampaignNotFound() {
  return (
    <section className="not-found-container" data-testid="campaign-not-found">
      <h1 className="not-found-title">Campaign Not Found</h1>
      <p className="not-found-message">
        The requested campaign review could not be found or does not exist.
      </p>
      <Link href="/" className="back-link" data-testid="back-to-hub-link">
        Return to Review Hub
      </Link>
    </section>
  );
}
