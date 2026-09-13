import { notFound } from "next/navigation";
import {
  ApiClientError,
  getCurrentProductionAttempt,
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
  try {
    const [detailResult, productionAttemptResult] = await Promise.all([
      getSceneReviewDetail(sceneId),
      getCurrentProductionAttempt(sceneId)
    ]);
    detail = detailResult;
    productionAttempt = productionAttemptResult;
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="scene-page-container">
      <SceneReviewDetailView detail={detail} productionAttempt={productionAttempt} />
    </div>
  );
}
