import type { ReferenceRole } from "@cco/contracts";

export class ReferenceCanonicalizationError extends Error {
  override readonly name = "ReferenceCanonicalizationError";
  readonly code: string;

  constructor(message: string, code: string = "INVALID_REFERENCE_BINDING", options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export const ROLE_PRIORITY: Readonly<Record<ReferenceRole, number>> = Object.freeze({
  subject_identity: 0,
  product: 1,
  location: 2,
  style: 3,
  composition: 4
});

export interface ReferenceAssetLike {
  readonly id: string;
  readonly clientId: string;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHashSha256: string;
  readonly assetType?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly displayName?: string | undefined;
  readonly description?: string | null | undefined;
  readonly libraryRole?: ReferenceRole | null | undefined;
  readonly archivedAt?: string | null | undefined;
  readonly groupId?: string | null | undefined;
}

export interface ReferenceBindingLike {
  readonly referenceAssetId: string;
  readonly role: ReferenceRole;
  readonly weight?: number | null | undefined;
  readonly hints?: Record<string, unknown> | null | undefined;
  readonly archivedAt?: string | null | undefined;
  readonly sceneId?: string | undefined;
  readonly specRevision?: number | undefined;
}

export interface CanonicalReferenceEntry {
  readonly slotIndex: number; // 1-based (1..9)
  readonly promptTag: string; // "<Picture 1>" .. "<Picture 9>"
  readonly role: ReferenceRole;
  readonly referenceAssetId: string;
  readonly contentHashSha256: string;
  readonly asset: ReferenceAssetLike;
}

export interface CanonicalizeReferenceBindingsOptions {
  readonly bindings: readonly ReferenceBindingLike[];
  readonly assetsById: ReadonlyMap<string, ReferenceAssetLike> | Record<string, ReferenceAssetLike>;
}

export function canonicalizeReferenceBindings(
  options: CanonicalizeReferenceBindingsOptions
): readonly CanonicalReferenceEntry[] {
  const { bindings, assetsById } = options;

  const getAsset = (id: string): ReferenceAssetLike | undefined => {
    if (assetsById instanceof Map) {
      return assetsById.get(id) ?? assetsById.get(id.toLowerCase());
    }
    return (
      (assetsById as Record<string, ReferenceAssetLike>)[id] ??
      (assetsById as Record<string, ReferenceAssetLike>)[id.toLowerCase()]
    );
  };

  // 1. Filter out explicitly archived bindings
  const activeBindings = bindings.filter((b) => !b.archivedAt);

  // 2. Enforce maximum cardinality (0..9)
  if (activeBindings.length > 9) {
    throw new ReferenceCanonicalizationError(
      `Cannot exceed 9 reference assets for MiniMax-H3 reference-directed execution (received ${activeBindings.length})`,
      "REFERENCE_LIMIT_EXCEEDED"
    );
  }

  // 3. Check for duplicate (role, referenceAssetId) pairs and validate individual bindings
  const seenPairs = new Set<string>();

  for (const binding of activeBindings) {
    const canonicalAssetId = binding.referenceAssetId.toLowerCase();
    const pairKey = `${binding.role}:${canonicalAssetId}`;
    if (seenPairs.has(pairKey)) {
      throw new ReferenceCanonicalizationError(
        `Duplicate reference binding for role "${binding.role}" and asset "${binding.referenceAssetId}"`,
        "DUPLICATE_REFERENCE_BINDING"
      );
    }
    seenPairs.add(pairKey);

    // Validate weight: only default (1.0 or omitted/null) is supported by H3
    if (binding.weight !== null && binding.weight !== undefined && binding.weight !== 1) {
      throw new ReferenceCanonicalizationError(
        `Unsupported reference weight: ${binding.weight}. MiniMax-H3 supports only equal structural weights (weight=1).`,
        "UNSUPPORTED_REFERENCE_WEIGHT"
      );
    }

    // Validate hints: no unrepresented regional/spatial hints
    if (
      binding.hints !== null &&
      binding.hints !== undefined &&
      Object.keys(binding.hints).length > 0
    ) {
      throw new ReferenceCanonicalizationError(
        `Unsupported reference hints: ${JSON.stringify(binding.hints)}. MiniMax-H3 does not support spatial/regional hints.`,
        "UNSUPPORTED_REFERENCE_HINTS"
      );
    }

    // Validate asset existence and media type
    const asset = getAsset(binding.referenceAssetId);
    if (!asset) {
      throw new ReferenceCanonicalizationError(
        `Reference asset "${binding.referenceAssetId}" not found in provided asset map`,
        "REFERENCE_ASSET_NOT_FOUND"
      );
    }

    if (asset.archivedAt) {
      throw new ReferenceCanonicalizationError(
        `Reference asset "${binding.referenceAssetId}" is archived and cannot be used`,
        "REFERENCE_ASSET_ARCHIVED"
      );
    }

    if (
      asset.assetType &&
      asset.assetType !== "image" &&
      asset.assetType !== "reference_image" &&
      !asset.assetType.toLowerCase().includes("image")
    ) {
      throw new ReferenceCanonicalizationError(
        `Unsupported reference assetType "${asset.assetType}" for asset "${asset.id}". MiniMax-H3 supports only image references.`,
        "UNSUPPORTED_REFERENCE_MEDIA"
      );
    }

    if (!asset.mimeType || !asset.mimeType.toLowerCase().startsWith("image/")) {
      throw new ReferenceCanonicalizationError(
        `Unsupported reference mimeType "${asset.mimeType}" for asset "${asset.id}". MiniMax-H3 supports only image references.`,
        "UNSUPPORTED_REFERENCE_MEDIA"
      );
    }
  }

  // 4. Sort deterministically:
  //    Primary: ascending role priority (subject_identity -> product -> location -> style -> composition)
  //    Secondary: ascending Unicode code-point order of lowercase referenceAssetId
  const sortedBindings = [...activeBindings].sort((a, b) => {
    const priorityA = ROLE_PRIORITY[a.role];
    const priorityB = ROLE_PRIORITY[b.role];

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    const idA = a.referenceAssetId.toLowerCase();
    const idB = b.referenceAssetId.toLowerCase();

    if (idA < idB) return -1;
    if (idA > idB) return 1;
    return 0;
  });

  // 5. Construct canonical reference entries with 1-based slotIndex and <Picture n> tag
  return Object.freeze(
    sortedBindings.map((binding, idx) => {
      const slotIndex = idx + 1;
      const promptTag = `<Picture ${slotIndex}>`;
      const asset = getAsset(binding.referenceAssetId)!;

      return Object.freeze({
        slotIndex,
        promptTag,
        role: binding.role,
        referenceAssetId: binding.referenceAssetId,
        contentHashSha256: asset.contentHashSha256,
        asset
      });
    })
  );
}
