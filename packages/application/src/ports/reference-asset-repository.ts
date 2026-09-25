import type {
  ReferenceAsset,
  ReferenceAssetId,
  ReferenceGroupId,
  ReferenceRole,
  SceneId,
  SceneReferenceBinding
} from "@cco/domain";

export interface ReferenceAssetRepositoryOptions {
  readonly includeArchived?: boolean | undefined;
  readonly specRevision?: number | undefined;
  readonly groupId?: ReferenceGroupId | undefined;
  readonly forUpdate?: boolean | undefined;
}

export interface ReferenceAssetRepository {
  readonly listBySceneId: (
    sceneId: SceneId,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "specRevision">
  ) => Promise<readonly ReferenceAsset[]>;

  readonly findByIds: (
    clientId: string,
    ids: readonly ReferenceAssetId[],
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "forUpdate">
  ) => Promise<readonly ReferenceAsset[]>;

  readonly findByIdsGlobal?: (
    ids: readonly ReferenceAssetId[],
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "forUpdate">
  ) => Promise<readonly ReferenceAsset[]>;

  readonly findByClientId?: (
    clientId: string,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "groupId">
  ) => Promise<readonly ReferenceAsset[]>;

  readonly listBindingsBySceneId?: (
    sceneId: SceneId,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived" | "specRevision">
  ) => Promise<readonly SceneReferenceBinding[]>;

  readonly saveBindings?: (
    sceneId: SceneId,
    bindings: readonly SceneReferenceBinding[]
  ) => Promise<void>;

  readonly save?: (asset: ReferenceAsset) => Promise<ReferenceAsset>;
  readonly archive?: (clientId: string, id: ReferenceAssetId) => Promise<boolean>;
  readonly updateLibraryRole?: (
    clientId: string,
    id: ReferenceAssetId,
    role: ReferenceRole
  ) => Promise<ReferenceAsset | undefined>;

  readonly findByClientAndContentHash?: (
    clientId: string,
    contentHashSha256: string,
    options?: Pick<ReferenceAssetRepositoryOptions, "includeArchived">
  ) => Promise<ReferenceAsset | undefined>;

  readonly saveOrReactivateByContentHash?: (asset: ReferenceAsset) => Promise<ReferenceAsset>;
  readonly withLock?: <T>(key: string, action: () => Promise<T>) => Promise<T>;
}
