import {
  ReferenceAssetListResponseSchema,
  ReferenceAssetResponseSchema,
  type ReferenceAssetListResponse,
  type ReferenceAssetResponse
} from "@cco/contracts";
import type { ReferenceAssetRepository, ReviewMediaDeliveryPort } from "../ports/index.js";

export interface ListClientReferencesInput {
  readonly clientId: string;
}

export interface ListClientReferencesDependencies {
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
}

export class ListClientReferencesUseCase {
  constructor(private readonly dependencies: ListClientReferencesDependencies) {}

  async execute(input: ListClientReferencesInput): Promise<ReferenceAssetListResponse> {
    const { referenceAssetRepository, mediaDelivery } = this.dependencies;

    const assets = referenceAssetRepository.findByClientId
      ? await referenceAssetRepository.findByClientId(input.clientId, { includeArchived: false })
      : [];

    const references: ReferenceAssetResponse[] = await Promise.all(
      assets.map(async (asset) => {
        let previewUrl: string | null = null;
        let previewAvailability: "available" | "unavailable" = "unavailable";

        if (mediaDelivery) {
          try {
            previewUrl = await mediaDelivery.generatePresignedReadUrl({
              bucket: asset.storageBucket,
              key: asset.storageObjectKey,
              contentHash: asset.contentHashSha256
            });
            previewAvailability = "available";
          } catch {
            // One unavailable preview must never fail the whole list.
            previewUrl = null;
            previewAvailability = "unavailable";
          }
        }

        return ReferenceAssetResponseSchema.parse({
          id: asset.id,
          clientId: asset.clientId,
          assetType: asset.assetType ?? "image",
          storageBucket: asset.storageBucket,
          storageObjectKey: asset.storageObjectKey,
          contentHashSha256: asset.contentHashSha256,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType ?? "image/png",
          displayName: asset.displayName,
          libraryRole: asset.libraryRole ?? null,
          archivedAt: asset.archivedAt ?? null,
          groupId: asset.groupId ?? null,
          previewUrl,
          previewAvailability
        });
      })
    );

    return ReferenceAssetListResponseSchema.parse({ references });
  }
}
