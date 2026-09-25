import { describe, expect, it, vi } from "vitest";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import type { ReferenceAssetRepository, ReviewMediaDeliveryPort } from "../ports/index.js";
import { ListClientReferencesUseCase } from "./list-client-references.js";

describe("ListClientReferencesUseCase", () => {
  const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";

  const asset1: ReferenceAsset = {
    id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73811" as ReferenceAssetId,
    clientId,
    storageBucket: "godzspeed-reference",
    storageObjectKey: `clients/${clientId}/references/hash111`,
    contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    width: 1920,
    height: 1080,
    mimeType: "image/png",
    displayName: "Asset 1",
    archivedAt: null
  };

  const asset2: ReferenceAsset = {
    id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73822" as ReferenceAssetId,
    clientId,
    storageBucket: "godzspeed-reference",
    storageObjectKey: `clients/${clientId}/references/hash222`,
    contentHashSha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    width: 1280,
    height: 720,
    mimeType: "image/jpeg",
    displayName: "Asset 2",
    archivedAt: null
  };

  it("lists active references with available preview URLs on signing success", async () => {
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientId: vi.fn().mockResolvedValue([asset1, asset2])
    };

    const delivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi
        .fn()
        .mockImplementation((loc) =>
          Promise.resolve(`https://preview.godzspeed.internal/${loc.key}`)
        )
    };

    const useCase = new ListClientReferencesUseCase({
      referenceAssetRepository: repo,
      mediaDelivery: delivery
    });

    const result = await useCase.execute({ clientId });
    expect(result.references).toHaveLength(2);
    expect(result.references[0]?.id).toBe(asset1.id);
    expect(result.references[0]?.previewAvailability).toBe("available");
    expect(result.references[0]?.previewUrl).toBe(
      `https://preview.godzspeed.internal/${asset1.storageObjectKey}`
    );

    expect(result.references[1]?.id).toBe(asset2.id);
    expect(result.references[1]?.previewAvailability).toBe("available");
  });

  it("isolates signing failure for one asset while healthy asset succeeds", async () => {
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientId: vi.fn().mockResolvedValue([asset1, asset2])
    };

    const delivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn().mockImplementation((loc) => {
        if (loc.key.includes("hash222")) {
          return Promise.reject(new Error("HeadObject NotFound"));
        }
        return Promise.resolve(`https://preview.godzspeed.internal/${loc.key}`);
      })
    };

    const useCase = new ListClientReferencesUseCase({
      referenceAssetRepository: repo,
      mediaDelivery: delivery
    });

    const result = await useCase.execute({ clientId });
    expect(result.references).toHaveLength(2);

    // asset 1 is healthy
    expect(result.references[0]?.id).toBe(asset1.id);
    expect(result.references[0]?.previewAvailability).toBe("available");
    expect(result.references[0]?.previewUrl).not.toBeNull();

    // asset 2 failed signing but its metadata is retained with unavailable state
    expect(result.references[1]?.id).toBe(asset2.id);
    expect(result.references[1]?.displayName).toBe("Asset 2");
    expect(result.references[1]?.previewAvailability).toBe("unavailable");
    expect(result.references[1]?.previewUrl).toBeNull();
  });

  it("returns empty array when client has no references", async () => {
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientId: vi.fn().mockResolvedValue([])
    };

    const useCase = new ListClientReferencesUseCase({
      referenceAssetRepository: repo
    });

    const result = await useCase.execute({ clientId });
    expect(result.references).toEqual([]);
  });
});
