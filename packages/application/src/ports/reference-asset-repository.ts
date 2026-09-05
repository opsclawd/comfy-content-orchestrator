import type { ReferenceAsset, ReferenceAssetId, SceneId } from "@cco/domain";

export interface ReferenceAssetRepository {
  readonly listBySceneId: (sceneId: SceneId) => Promise<readonly ReferenceAsset[]>;
  readonly findByIds: (
    clientId: string,
    ids: readonly ReferenceAssetId[]
  ) => Promise<readonly ReferenceAsset[]>;
}
