import type { SceneId } from "./scene.js";

declare const ReferenceAssetIdBrand: unique symbol;
export type ReferenceAssetId = string & { readonly [ReferenceAssetIdBrand]: true };

export interface ReferenceAsset {
  readonly id: ReferenceAssetId;
  readonly sceneId: SceneId;
  readonly assetType: string;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHashSha256: string;
}
