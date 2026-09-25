import { describe, expect, it, vi } from "vitest";
import type { ReferenceAsset, ReferenceAssetId, ReferenceRole } from "@cco/domain";
import type { ReferenceAssetRepository, ReviewMediaDeliveryPort } from "../ports/index.js";
import {
  UpdateReferenceAssetRoleUseCase,
  ReferenceAssetNotFoundError
} from "./update-reference-asset-role.js";

describe("UpdateReferenceAssetRoleUseCase", () => {
  const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const referenceId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId;

  const existingAsset: ReferenceAsset = {
    id: referenceId,
    clientId,
    storageBucket: "godzspeed-reference",
    storageObjectKey: `clients/${clientId}/references/hash123`,
    contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    width: 1920,
    height: 1080,
    mimeType: "image/png",
    displayName: "Legacy Asset",
    libraryRole: null,
    archivedAt: null
  };

  it("successfully updates library role of existing reference asset", async () => {
    const updatedAsset: ReferenceAsset = {
      ...existingAsset,
      libraryRole: "product"
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      updateLibraryRole: vi.fn().mockResolvedValue(updatedAsset)
    };

    const delivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi
        .fn()
        .mockResolvedValue("https://preview.godzspeed.internal/prod.png")
    };

    const useCase = new UpdateReferenceAssetRoleUseCase({
      referenceAssetRepository: repo,
      mediaDelivery: delivery
    });

    const result = await useCase.execute({
      clientId,
      referenceId,
      role: "product"
    });

    expect(result.id).toBe(referenceId);
    expect(result.libraryRole).toBe("product");
    expect(result.previewAvailability).toBe("available");
    expect(result.previewUrl).toBe("https://preview.godzspeed.internal/prod.png");
    expect(repo.updateLibraryRole).toHaveBeenCalledWith(clientId, referenceId, "product");
  });

  it("throws ReferenceAssetNotFoundError if asset is not found", async () => {
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      updateLibraryRole: vi.fn().mockResolvedValue(undefined)
    };

    const useCase = new UpdateReferenceAssetRoleUseCase({
      referenceAssetRepository: repo
    });

    await expect(
      useCase.execute({
        clientId,
        referenceId,
        role: "location"
      })
    ).rejects.toThrow(ReferenceAssetNotFoundError);
  });

  it("rejects invalid reference role", async () => {
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      updateLibraryRole: vi.fn()
    };

    const useCase = new UpdateReferenceAssetRoleUseCase({
      referenceAssetRepository: repo
    });

    await expect(
      useCase.execute({
        clientId,
        referenceId,
        role: "invalid_role" as unknown as ReferenceRole
      })
    ).rejects.toThrow("Invalid reference role");
  });
});
