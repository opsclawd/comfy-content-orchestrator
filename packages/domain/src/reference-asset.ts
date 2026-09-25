import type { SceneId } from "./identifiers.js";
import type { ReferenceGroupId } from "./reference-group.js";

export { type ReferenceGroupId, type ReferenceGroup } from "./reference-group.js";

export const REFERENCE_ROLES = [
  "subject_identity",
  "product",
  "location",
  "style",
  "composition"
] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

declare const ReferenceAssetIdBrand: unique symbol;
export type ReferenceAssetId = string & { readonly [ReferenceAssetIdBrand]: true };

export interface ReferenceAsset {
  readonly id: ReferenceAssetId;
  readonly clientId: string;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHashSha256: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly mimeType?: string | undefined;
  readonly displayName?: string | undefined;
  readonly archivedAt?: string | null | undefined;
  readonly groupId?: ReferenceGroupId | null | undefined;
  // Legacy / convenience fields
  readonly assetType?: string | undefined;
  readonly sceneId?: SceneId | undefined;
}

export interface SceneReferenceBinding {
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly referenceAssetId: ReferenceAssetId;
  readonly role: ReferenceRole;
  readonly weight?: number | null | undefined;
  readonly hints?: Record<string, unknown> | null | undefined;
  readonly archivedAt?: string | null | undefined;
}
