import { notFound } from "next/navigation";
import {
  ApiClientError,
  getCampaignAnimatic,
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

  const deliveryReelPromise = getCampaignDeliveryReel(campaignId).catch((err: unknown) => {
    console.error(`Failed to fetch delivery reel for campaign ${campaignId}:`, err);
    return undefined;
  });

  const animaticPromise = getCampaignAnimatic(campaignId).catch((err: unknown) => {
    console.error(`Failed to fetch animatic for campaign ${campaignId}:`, err);
    return undefined;
  });

  let summary;
  try {
    summary = await getCampaignReviewSummary(campaignId);
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  const [deliveryReel, animatic] = await Promise.all([deliveryReelPromise, animaticPromise]);

  return (
    <div className="campaign-page-container">
      <CampaignReviewSummaryView
        summary={summary}
        deliveryReel={deliveryReel}
        animatic={animatic}
      />
    </div>
  );
}
