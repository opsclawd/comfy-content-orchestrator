import type { ReferenceAsset, SceneId } from "@cco/domain";

export interface ReferenceAssetRepository {
  readonly listBySceneId: (sceneId: SceneId) => Promise<readonly ReferenceAsset[]>;
}
