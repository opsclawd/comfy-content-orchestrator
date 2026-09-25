import { ReferenceAssetResponseSchema, type ReferenceAssetResponse } from "@cco/contracts";
import {
  assertValidReferenceRole,
  ReferenceAssetNotFoundError,
  type ReferenceAssetId,
  type ReferenceRole
} from "@cco/domain";
export { ReferenceAssetNotFoundError } from "@cco/domain";
import type { ReferenceAssetRepository, ReviewMediaDeliveryPort } from "../ports/index.js";

export interface UpdateReferenceAssetRoleInput {
  readonly clientId: string;
  readonly referenceId: ReferenceAssetId;
  readonly role: ReferenceRole;
}

export interface UpdateReferenceAssetRoleDependencies {
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
}

export class UpdateReferenceAssetRoleUseCase {
  constructor(private readonly dependencies: UpdateReferenceAssetRoleDependencies) {}

  async execute(input: UpdateReferenceAssetRoleInput): Promise<ReferenceAssetResponse> {
    assertValidReferenceRole(input.role);
    const { referenceAssetRepository, mediaDelivery } = this.dependencies;
    if (!referenceAssetRepository.updateLibraryRole) {
      throw new Error("Repository does not support updateLibraryRole");
    }

    const updated = await referenceAssetRepository.updateLibraryRole(
      input.clientId,
      input.referenceId,
      input.role
    );

    if (!updated) {
      throw new ReferenceAssetNotFoundError(input.referenceId);
    }

    let previewUrl: string | null = null;
    let previewAvailability: "available" | "unavailable" = "unavailable";

    if (mediaDelivery) {
      try {
        previewUrl = await mediaDelivery.generatePresignedReadUrl({
          bucket: updated.storageBucket,
          key: updated.storageObjectKey,
          contentHash: updated.contentHashSha256
        });
        previewAvailability = "available";
      } catch {
        previewUrl = null;
        previewAvailability = "unavailable";
      }
    }

    return ReferenceAssetResponseSchema.parse({
      id: updated.id,
      clientId: updated.clientId,
      assetType: updated.assetType ?? "image",
      storageBucket: updated.storageBucket,
      storageObjectKey: updated.storageObjectKey,
      contentHashSha256: updated.contentHashSha256,
      width: updated.width,
      height: updated.height,
      mimeType: updated.mimeType ?? "image/png",
      displayName: updated.displayName,
      libraryRole: updated.libraryRole ?? null,
      archivedAt: updated.archivedAt ?? null,
      groupId: updated.groupId ?? null,
      previewUrl,
      previewAvailability
    });
  }
}
