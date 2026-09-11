import CampaignCreationForm from "../../../components/campaign-creation-form";

export const dynamic = "force-dynamic";

export default function NewCampaignPage() {
  return (
    <div className="campaign-page-container">
      <CampaignCreationForm />
    </div>
  );
}
