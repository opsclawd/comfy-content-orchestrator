import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BUCKETS } from "@cco/shared";
import type { ReferenceAssetResponse } from "@cco/contracts";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import {
  ObjectAlreadyExistsError,
  type ImageInspectionPort,
  type ObjectStoragePort,
  type ReferenceAssetRepository,
  type ReviewMediaDeliveryPort,
  type ValidatedImageMetadata
} from "../ports/index.js";
import { UploadReferenceAssetUseCase } from "./upload-reference-asset.js";

describe("UploadReferenceAssetUseCase", () => {
  const clientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const dummyBytes = Buffer.from("test image content bytes");
  const dummySha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  const fakeValidator: ImageInspectionPort = {
    inspectAndValidate: vi.fn().mockResolvedValue({
      detectedMimeType: "image/png",
      width: 1920,
      height: 1080,
      byteLength: dummyBytes.length
    } as ValidatedImageMetadata)
  };

  it("successfully stores new reference asset and generates preview URL", async () => {
    const putObjectSpy = vi.fn().mockResolvedValue({
      bucket: BUCKETS.REFERENCE,
      key: `clients/${clientId}/references/${dummySha256}`
    });
    const fakeStorage: ObjectStoragePort = {
      putObject: putObjectSpy,
      getObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn()
    };

    const savedAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${dummySha256}`,
      contentHashSha256: dummySha256,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Hero Image",
      archivedAt: null
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn().mockResolvedValue(savedAsset)
    };

    const delivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi
        .fn()
        .mockResolvedValue("https://preview.godzspeed.internal/ref.png")
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator,
      mediaDelivery: delivery
    });

    const result = await useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png",
      displayName: "Hero Image"
    });

    expect(result.id).toBe(savedAsset.id);
    expect(result.clientId).toBe(clientId);
    expect(result.previewAvailability).toBe("available");
    expect(result.previewUrl).toBe("https://preview.godzspeed.internal/ref.png");
    expect(putObjectSpy).toHaveBeenCalledTimes(1);
    expect(putObjectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: BUCKETS.REFERENCE,
        ifNoneMatch: "*"
      })
    );
  });

  it("converges idempotently on active asset without duplicate storage write", async () => {
    const putObjectSpy = vi.fn();
    const fakeStorage: ObjectStoragePort = {
      putObject: putObjectSpy,
      getObject: vi.fn(),
      copyObject: vi.fn()
    };

    const existingActiveAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${dummySha256}`,
      contentHashSha256: dummySha256,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Original Name",
      archivedAt: null
    };

    const saveSpy = vi.fn();
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(existingActiveAsset),
      saveOrReactivateByContentHash: saveSpy
    };

    const delivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi
        .fn()
        .mockResolvedValue("https://preview.godzspeed.internal/active.png")
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator,
      mediaDelivery: delivery
    });

    const result = await useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png",
      displayName: "New Different Name"
    });

    expect(result.id).toBe(existingActiveAsset.id);
    expect(result.displayName).toBe("Original Name");
    expect(putObjectSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("reactivates archived asset atomically without storage write", async () => {
    const putObjectSpy = vi.fn();
    const fakeStorage: ObjectStoragePort = {
      putObject: putObjectSpy,
      getObject: vi.fn(),
      copyObject: vi.fn()
    };

    const existingArchivedAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${dummySha256}`,
      contentHashSha256: dummySha256,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Established Name",
      archivedAt: "2026-09-24T12:00:00.000Z"
    };

    const reactivatedAsset: ReferenceAsset = {
      ...existingArchivedAsset,
      archivedAt: null
    };

    const reactivateSpy = vi.fn().mockResolvedValue(reactivatedAsset);
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(existingArchivedAsset),
      saveOrReactivateByContentHash: reactivateSpy
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator
    });

    const result = await useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png"
    });

    expect(result.id).toBe(existingArchivedAsset.id);
    expect(result.archivedAt).toBeNull();
    expect(putObjectSpy).not.toHaveBeenCalled();
    expect(reactivateSpy).toHaveBeenCalledTimes(1);
    expect(reactivateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: existingArchivedAsset.id,
        archivedAt: null
      })
    );
  });

  it("cleans up staged object if database persistence fails on initial upload", async () => {
    const deleteObjectSpy = vi.fn().mockResolvedValue(undefined);
    const fakeStorage: ObjectStoragePort = {
      putObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${dummySha256}`
      }),
      getObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: deleteObjectSpy
    };

    const dbError = new Error("Database connection lost");
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn().mockRejectedValue(dbError)
    };

    const loggerErrorSpy = vi.fn();
    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator,
      logger: { error: loggerErrorSpy }
    });

    await expect(
      useCase.execute({
        clientId,
        body: dummyBytes,
        declaredMimeType: "image/png"
      })
    ).rejects.toThrow("Database connection lost");

    expect(deleteObjectSpy).toHaveBeenCalledTimes(1);
  });

  it("does not delete object on database persistence failure if object existed beforehand", async () => {
    const deleteObjectSpy = vi.fn();
    const fakeStorage: ObjectStoragePort = {
      putObject: vi
        .fn()
        .mockRejectedValue(
          new ObjectAlreadyExistsError(
            BUCKETS.REFERENCE,
            `clients/${clientId}/references/${dummySha256}`
          )
        ),
      getObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db`,
        body: dummyBytes
      }),
      copyObject: vi.fn(),
      deleteObject: deleteObjectSpy
    };

    const dbError = new Error("DB unique conflict");
    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn().mockRejectedValue(dbError)
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator
    });

    await expect(
      useCase.execute({
        clientId,
        body: dummyBytes,
        declaredMimeType: "image/png"
      })
    ).rejects.toThrow("DB unique conflict");

    expect(deleteObjectSpy).not.toHaveBeenCalled();
  });

  it("returns previewAvailability unavailable if preview signing fails", async () => {
    const fakeStorage: ObjectStoragePort = {
      putObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${dummySha256}`
      }),
      getObject: vi.fn(),
      copyObject: vi.fn()
    };

    const savedAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${dummySha256}`,
      contentHashSha256: dummySha256,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      archivedAt: null
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn().mockResolvedValue(savedAsset)
    };

    const failingDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn().mockRejectedValue(new Error("HeadObject 404"))
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator,
      mediaDelivery: failingDelivery
    });

    const result = await useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png"
    });

    expect(result.previewAvailability).toBe("unavailable");
    expect(result.previewUrl).toBeNull();
  });

  it("does not delete object on database persistence failure if another concurrent request committed a row referencing it", async () => {
    const deleteObjectSpy = vi.fn();
    const fakeStorage: ObjectStoragePort = {
      putObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${dummySha256}`
      }),
      getObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: deleteObjectSpy
    };

    const committedAsset: ReferenceAsset = {
      id: "concurrent-winner-id" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${dummySha256}`,
      contentHashSha256: "1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db",
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Concurrent Winner",
      archivedAt: null
    };

    // Pre-check returns undefined (first upload check), but after putObject, another request committed it
    const findSpy = vi
      .fn()
      .mockResolvedValueOnce(undefined) // initial pre-check
      .mockResolvedValueOnce(committedAsset); // cleanup check finds the concurrently committed row

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: findSpy,
      saveOrReactivateByContentHash: vi.fn().mockRejectedValue(new Error("Serialization failure"))
    };

    const warnLoggerSpy = vi.fn();
    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator,
      logger: { error: vi.fn(), warn: warnLoggerSpy }
    });

    await expect(
      useCase.execute({
        clientId,
        body: dummyBytes,
        declaredMimeType: "image/png"
      })
    ).rejects.toThrow("Serialization failure");

    // Must NOT delete object bytes because a committed row exists!
    expect(deleteObjectSpy).not.toHaveBeenCalled();
    expect(warnLoggerSpy).toHaveBeenCalledWith(expect.stringContaining("retaining object bytes"));
  });

  it("does not delete object on database persistence failure if checking for existing row throws", async () => {
    const deleteObjectSpy = vi.fn();
    const fakeStorage: ObjectStoragePort = {
      putObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${dummySha256}`
      }),
      getObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: deleteObjectSpy
    };

    const findSpy = vi
      .fn()
      .mockResolvedValueOnce(undefined) // initial pre-check
      .mockRejectedValueOnce(new Error("Connection reset during check")); // cleanup check fails

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: findSpy,
      saveOrReactivateByContentHash: vi.fn().mockRejectedValue(new Error("DB error"))
    };

    const warnLoggerSpy = vi.fn();
    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator,
      logger: { error: vi.fn(), warn: warnLoggerSpy }
    });

    await expect(
      useCase.execute({
        clientId,
        body: dummyBytes,
        declaredMimeType: "image/png"
      })
    ).rejects.toThrow("DB error");

    // Fail closed: must NOT delete object bytes if we cannot verify absence of committed row
    expect(deleteObjectSpy).not.toHaveBeenCalled();
  });

  it("rejects collision if existing object cannot be retrieved or verified", async () => {
    const fakeStorage: ObjectStoragePort = {
      putObject: vi
        .fn()
        .mockRejectedValue(
          new ObjectAlreadyExistsError(
            BUCKETS.REFERENCE,
            `clients/${clientId}/references/1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db`
          )
        ),
      getObject: vi.fn().mockResolvedValue(undefined),
      copyObject: vi.fn()
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn()
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator
    });

    await expect(
      useCase.execute({
        clientId,
        body: dummyBytes,
        declaredMimeType: "image/png"
      })
    ).rejects.toThrow("could not be verified on collision");
  });

  it("rejects collision if existing object has mismatched content hash", async () => {
    const fakeStorage: ObjectStoragePort = {
      putObject: vi
        .fn()
        .mockRejectedValue(
          new ObjectAlreadyExistsError(
            BUCKETS.REFERENCE,
            `clients/${clientId}/references/1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db`
          )
        ),
      getObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db`,
        body: Buffer.from("completely corrupt / different bytes")
      }),
      copyObject: vi.fn()
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn()
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator
    });

    await expect(
      useCase.execute({
        clientId,
        body: dummyBytes,
        declaredMimeType: "image/png"
      })
    ).rejects.toThrow("has mismatched checksum");
  });

  it("converges on collision when headObject has no checksum but getObject content matches", async () => {
    const expectedHash = "1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db";
    const fakeStorage: ObjectStoragePort = {
      putObject: vi
        .fn()
        .mockRejectedValue(
          new ObjectAlreadyExistsError(
            BUCKETS.REFERENCE,
            `clients/${clientId}/references/${expectedHash}`
          )
        ),
      headObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${expectedHash}`
        // no checksumSha256
      }),
      getObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${expectedHash}`,
        body: dummyBytes
      }),
      copyObject: vi.fn()
    };

    const savedAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${expectedHash}`,
      contentHashSha256: expectedHash,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      archivedAt: null
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn().mockResolvedValue(savedAsset)
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator
    });

    const result = await useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png"
    });

    expect(result.id).toBe(savedAsset.id);
  });

  it("serializes concurrent uploads for identical key and prevents check-then-delete race on persistence failure", async () => {
    const stored = new Map<string, Buffer | Uint8Array>();
    const deletedKeys: string[] = [];

    const storage: ObjectStoragePort = {
      putObject: vi.fn().mockImplementation(async (input) => {
        const fullKey = `${input.bucket}/${input.key}`;
        if (input.ifNoneMatch === "*" && stored.has(fullKey)) {
          throw new ObjectAlreadyExistsError(input.bucket, input.key);
        }
        stored.set(fullKey, input.body);
        return { bucket: input.bucket, key: input.key };
      }),
      getObject: vi.fn().mockImplementation(async (loc) => {
        const fullKey = `${loc.bucket}/${loc.key}`;
        const body = stored.get(fullKey);
        if (!body) return undefined;
        return { bucket: loc.bucket, key: loc.key, body };
      }),
      copyObject: vi.fn(),
      deleteObject: vi.fn().mockImplementation(async (loc) => {
        const fullKey = `${loc.bucket}/${loc.key}`;
        stored.delete(fullKey);
        deletedKeys.push(fullKey);
      })
    };

    let callCount = 0;
    let committedRow: ReferenceAsset | undefined;
    const computedSha = "1bf573ab532d77b456f402349b56f81e58fab2505e91213ef8c8ddc6809134db";

    const savedAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73888" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${computedSha}`,
      contentHashSha256: computedSha,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Req 2",
      archivedAt: null
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockImplementation(async () => committedRow),
      saveOrReactivateByContentHash: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Request 1 fails database persistence
          throw new Error("DB transient failure for request 1");
        }
        committedRow = savedAsset;
        return savedAsset;
      })
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: storage,
      imageValidator: fakeValidator
    });

    // Launch both uploads concurrently
    const promise1 = useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png",
      displayName: "Req 1"
    });

    const promise2 = useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png",
      displayName: "Req 2"
    });

    const results = await Promise.allSettled([promise1, promise2]);

    expect(results[0].status).toBe("rejected");
    expect((results[0] as PromiseRejectedResult).reason.message).toContain("DB transient failure");

    expect(results[1].status).toBe("fulfilled");
    expect((results[1] as PromiseFulfilledResult<ReferenceAssetResponse>).value.id).toBe(
      savedAsset.id
    );

    // Stored object must remain valid for the successful request
    const finalStored = await storage.getObject({
      bucket: BUCKETS.REFERENCE,
      key: `clients/${clientId}/references/${computedSha}`
    });
    expect(finalStored).toBeDefined();
    expect(finalStored?.body).toEqual(dummyBytes);
  });

  it("delegates to repository withLock when available for cross-process coordination", async () => {
    const withLockSpy = vi.fn().mockImplementation(async (_key, action) => action());
    const savedAsset: ReferenceAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as ReferenceAssetId,
      clientId,
      storageBucket: BUCKETS.REFERENCE,
      storageObjectKey: `clients/${clientId}/references/${dummySha256}`,
      contentHashSha256: dummySha256,
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      archivedAt: null
    };

    const repo: ReferenceAssetRepository = {
      listBySceneId: vi.fn(),
      findByIds: vi.fn(),
      findByClientAndContentHash: vi.fn().mockResolvedValue(undefined),
      saveOrReactivateByContentHash: vi.fn().mockResolvedValue(savedAsset),
      withLock: withLockSpy
    };

    const fakeStorage: ObjectStoragePort = {
      putObject: vi.fn().mockResolvedValue({
        bucket: BUCKETS.REFERENCE,
        key: `clients/${clientId}/references/${dummySha256}`
      }),
      getObject: vi.fn(),
      copyObject: vi.fn()
    };

    const useCase = new UploadReferenceAssetUseCase({
      referenceAssetRepository: repo,
      objectStorage: fakeStorage,
      imageValidator: fakeValidator
    });

    const result = await useCase.execute({
      clientId,
      body: dummyBytes,
      declaredMimeType: "image/png"
    });

    const computedSha = crypto.createHash("sha256").update(dummyBytes).digest("hex");
    expect(result.id).toBe(savedAsset.id);
    expect(withLockSpy).toHaveBeenCalledTimes(1);
    expect(withLockSpy).toHaveBeenCalledWith(
      `clients/${clientId}/references/${computedSha}`,
      expect.any(Function)
    );
  });
});
