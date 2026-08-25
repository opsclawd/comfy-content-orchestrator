import { notFound } from "next/navigation";
import { ApiClientError, getSceneReviewDetail } from "../../../api/client";
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
  try {
    detail = await getSceneReviewDetail(sceneId);
  } catch (err) {
    if (err instanceof ApiClientError && err.statusCode === 404) {
      notFound();
    }
    throw err;
  }

  return (
    <div className="scene-page-container">
      <SceneReviewDetailView detail={detail} />
    </div>
  );
}
