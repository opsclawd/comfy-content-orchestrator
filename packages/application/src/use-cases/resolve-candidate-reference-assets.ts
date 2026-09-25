import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import {
  ArchivedReferenceBindingError,
  CrossClientReferenceBindingError,
  ReferenceAssetNotFoundError
} from "@cco/domain";
import type {
  ReferenceAssetRepository,
  ReferenceAssetRepositoryOptions
} from "../ports/reference-asset-repository.js";

export function canonicalizeCandidateReferenceAssetIds(
  candidateIds?: readonly string[] | readonly ReferenceAssetId[] | undefined
): readonly ReferenceAssetId[] {
  if (!candidateIds || candidateIds.length === 0) {
    return Object.freeze([]);
  }
  const unique = Array.from(new Set(candidateIds.map((id) => String(id).trim()))).filter(
    (id) => id.length > 0
  );
  unique.sort();
  return Object.freeze(unique as ReferenceAssetId[]);
}

export async function resolveCandidateReferenceAssets(
  repository: ReferenceAssetRepository,
  clientId: string,
  candidateIds?: readonly string[] | readonly ReferenceAssetId[] | undefined,
  options?: Pick<ReferenceAssetRepositoryOptions, "forUpdate">
): Promise<readonly ReferenceAsset[]> {
  const canonicalIds = canonicalizeCandidateReferenceAssetIds(candidateIds);
  if (canonicalIds.length === 0) {
    return Object.freeze([]);
  }

  const queryOptions = {
    includeArchived: true,
    ...(options?.forUpdate ? { forUpdate: true } : {})
  };

  const assets = await repository.findByIds(clientId, canonicalIds, queryOptions);
  const assetMap = new Map(assets.map((a) => [a.id as string, a]));

  for (const id of canonicalIds) {
    const asset = assetMap.get(id as string);
    if (!asset) {
      if (typeof repository.findByIdsGlobal === "function") {
        const globalAssets = await repository.findByIdsGlobal([id], queryOptions);
        if (globalAssets.length > 0 && globalAssets[0]?.clientId !== clientId) {
          throw new CrossClientReferenceBindingError(clientId, id, globalAssets[0]!.clientId);
        }
      }
      throw new ReferenceAssetNotFoundError(id);
    }
    if (asset.clientId !== clientId) {
      throw new CrossClientReferenceBindingError(clientId, asset.id, asset.clientId);
    }
    if (asset.archivedAt != null) {
      throw new ArchivedReferenceBindingError(asset.id);
    }
  }

  const sorted = [...assets].sort((a, b) => (a.id as string).localeCompare(b.id as string));
  return Object.freeze(sorted);
}
