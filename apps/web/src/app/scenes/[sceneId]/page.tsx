import { notFound } from "next/navigation";
import {
  ApiClientError,
  getCurrentProductionAttempt,
  getSceneProductionInspection,
  getSceneReviewDetail
} from "../../../api/client";
import { SceneReviewDetailView } from "../../../components/scene-review-detail";

export const dynamic = "force-dynamic";

export interface ScenePageProps {
  params: Promise<{
    sceneId: string;
  }>;
}

export default async function ScenePage({ params }: ScenePageProps) {
  const { sceneId } = await params;

  let detail;
  let productionAttempt;
  let productionInspection = null;
  try {
    const [detailResult, productionAttemptResult, inspectionResult] = await Promise.all([
      getSceneReviewDetail(sceneId),
      getCurrentProductionAttempt(sceneId),
      getSceneProductionInspection(sceneId).catch(() => null)
    ]);
    detail = detailResult;
    productionAttempt = productionAttemptResult;
    productionInspection = inspectionResult;
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="scene-page-container">
      <SceneReviewDetailView
        detail={detail}
        productionAttempt={productionAttempt}
        productionInspection={productionInspection}
      />
    </div>
  );
}
