import { notFound } from "next/navigation";
import {
  ApiClientError,
  getCampaignDeliveryReel,
  getCampaignReviewSummary
} from "../../../api/client";
import { CampaignReviewSummaryView } from "../../../components/campaign-review-summary";

export const dynamic = "force-dynamic";

export interface CampaignPageProps {
  params: Promise<{
    campaignId: string;
  }>;
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { campaignId } = await params;

  let summary;
  let deliveryReel;
  try {
    [summary, deliveryReel] = await Promise.all([
      getCampaignReviewSummary(campaignId),
      getCampaignDeliveryReel(campaignId)
    ]);
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="campaign-page-container">
      <CampaignReviewSummaryView summary={summary} deliveryReel={deliveryReel} />
    </div>
  );
}
