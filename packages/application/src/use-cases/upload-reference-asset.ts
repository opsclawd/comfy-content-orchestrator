import crypto from "node:crypto";
import { BUCKETS } from "@cco/shared";
import { ReferenceAssetResponseSchema, type ReferenceAssetResponse } from "@cco/contracts";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import {
  ObjectAlreadyExistsError,
  type ImageInspectionLimits,
  type ImageInspectionPort,
  type ObjectStoragePort,
  type ReferenceAssetRepository,
  type ReviewMediaDeliveryPort,
  type SupportedReferenceMimeType
} from "../ports/index.js";

export interface UploadReferenceAssetInput {
  readonly clientId: string;
  readonly body: Buffer | Uint8Array;
  readonly declaredMimeType: string;
  readonly displayName?: string | undefined;
}

export interface UploadReferenceAssetDependencies {
  readonly referenceAssetRepository: ReferenceAssetRepository;
  readonly objectStorage: ObjectStoragePort;
  readonly imageValidator: ImageInspectionPort;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
  readonly limits?: ImageInspectionLimits | undefined;
  readonly logger?:
    | {
        error(message: string, ...args: unknown[]): void;
        warn?(message: string, ...args: unknown[]): void;
        info?(message: string, ...args: unknown[]): void;
      }
    | undefined;
}

function deterministicDisplayName(sha256: string, mimeType: SupportedReferenceMimeType): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return `${sha256.slice(0, 16)}.${extension}`;
}

class KeyedMutex {
  private readonly queues = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previousLock = this.queues.get(key) ?? Promise.resolve();
    const chained = previousLock.then(
      () => currentLock,
      () => currentLock
    );
    this.queues.set(key, chained);

    await previousLock.catch(() => {});

    return () => {
      release();
      if (this.queues.get(key) === chained) {
        this.queues.delete(key);
      }
    };
  }
}

export class UploadReferenceAssetUseCase {
  private static readonly keyMutex = new KeyedMutex();

  constructor(private readonly dependencies: UploadReferenceAssetDependencies) {}

  async execute(input: UploadReferenceAssetInput): Promise<ReferenceAssetResponse> {
    const { referenceAssetRepository, objectStorage, imageValidator, limits, logger } =
      this.dependencies;

    // 1. Validate image buffer and MIME declarations
    const validated = await imageValidator.inspectAndValidate(
      input.body,
      input.declaredMimeType,
      limits
    );

    // 2. Compute SHA-256 over exact persisted bytes
    const exactBytes = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    const sha256 = crypto.createHash("sha256").update(exactBytes).digest("hex");

    const storageKey = `clients/${input.clientId}/references/${sha256}`;
    const storageBucket = BUCKETS.REFERENCE;

    // Serialize claim, persistence, and cleanup per key (via cross-process repository lock if available, or process-local mutex)
    const runLocked = async <T>(action: () => Promise<T>): Promise<T> => {
      if (referenceAssetRepository.withLock) {
        return referenceAssetRepository.withLock(storageKey, action);
      }
      const releaseLocalLock = await UploadReferenceAssetUseCase.keyMutex.acquire(storageKey);
      try {
        return await action();
      } finally {
        releaseLocalLock();
      }
    };

    return runLocked(async () => {
      // 3. Pre-check existing row by client and content hash (including archived)
      if (referenceAssetRepository.findByClientAndContentHash) {
        const existing = await referenceAssetRepository.findByClientAndContentHash(
          input.clientId,
          sha256,
          { includeArchived: true }
        );

        if (existing) {
          let activeAsset = existing;
          // If archived, reactivate atomically without duplicate storage write
          if (existing.archivedAt != null) {
            if (!referenceAssetRepository.saveOrReactivateByContentHash) {
              throw new Error("Repository does not support saveOrReactivateByContentHash");
            }
            activeAsset = await referenceAssetRepository.saveOrReactivateByContentHash({
              ...existing,
              archivedAt: null
            });
          }

          return await this.buildResponse(activeAsset);
        }
      }

      // 4. Staged conditional storage write
      let objectCreatedByUs = false;
      try {
        await objectStorage.putObject({
          bucket: storageBucket,
          key: storageKey,
          body: exactBytes,
          contentType: validated.detectedMimeType,
          checksumSha256: sha256,
          ifNoneMatch: "*"
        });
        objectCreatedByUs = true;
      } catch (error) {
        if (error instanceof ObjectAlreadyExistsError) {
          // Race condition: verify existing object bytes before converging
          const existingObject = await objectStorage.getObject({
            bucket: storageBucket,
            key: storageKey
          });
          if (!existingObject || !existingObject.body) {
            throw new Error(`Storage object at ${storageKey} could not be verified on collision`);
          }
          const existingBytes = Buffer.isBuffer(existingObject.body)
            ? existingObject.body
            : Buffer.from(existingObject.body);
          const existingSha256 = crypto.createHash("sha256").update(existingBytes).digest("hex");
          if (existingSha256 !== sha256) {
            throw new Error(`Storage object at ${storageKey} has mismatched checksum`);
          }

          objectCreatedByUs = false;
        } else {
          throw error;
        }
      }

      // 5. Atomic database persistence / convergence
      const finalDisplayName =
        input.displayName ?? deterministicDisplayName(sha256, validated.detectedMimeType);

      const assetToPersist: ReferenceAsset = {
        id: crypto.randomUUID() as ReferenceAssetId,
        clientId: input.clientId,
        assetType: "image",
        storageBucket,
        storageObjectKey: storageKey,
        contentHashSha256: sha256,
        width: validated.width,
        height: validated.height,
        mimeType: validated.detectedMimeType,
        displayName: finalDisplayName,
        archivedAt: null
      };

      let persistedAsset: ReferenceAsset;
      try {
        if (!referenceAssetRepository.saveOrReactivateByContentHash) {
          throw new Error("Repository does not support saveOrReactivateByContentHash");
        }
        persistedAsset =
          await referenceAssetRepository.saveOrReactivateByContentHash(assetToPersist);
      } catch (persistError) {
        // Clean up staged object only if this request created it and no committed row references it
        if (objectCreatedByUs && objectStorage.deleteObject) {
          let shouldDelete = false;
          try {
            if (referenceAssetRepository.findByClientAndContentHash) {
              const existingRow = await referenceAssetRepository.findByClientAndContentHash(
                input.clientId,
                sha256,
                { includeArchived: true }
              );
              if (!existingRow) {
                shouldDelete = true;
              } else {
                logger?.warn?.(
                  `Staged object at ${storageKey} was created by this request, but a database row now references it; retaining object bytes.`
                );
              }
            } else {
              logger?.warn?.(
                `Cannot verify whether a committed row references ${storageKey}; retaining object for reconciliation.`
              );
            }
          } catch (checkError) {
            logger?.warn?.(
              `Failed to check for existing rows referencing ${storageKey}; retaining object to avoid orphan row pointing at missing bytes`,
              checkError
            );
          }

          if (shouldDelete) {
            try {
              await objectStorage.deleteObject({ bucket: storageBucket, key: storageKey });
            } catch (cleanupError) {
              logger?.error(
                "Failed to clean up staged reference object after database persistence failure",
                cleanupError
              );
            }
          }
        }
        throw persistError;
      }

      return await this.buildResponse(persistedAsset);
    });
  }

  private async buildResponse(asset: ReferenceAsset): Promise<ReferenceAssetResponse> {
    let previewUrl: string | null = null;
    let previewAvailability: "available" | "unavailable" = "unavailable";

    if (this.dependencies.mediaDelivery) {
      try {
        previewUrl = await this.dependencies.mediaDelivery.generatePresignedReadUrl({
          bucket: asset.storageBucket,
          key: asset.storageObjectKey,
          contentHash: asset.contentHashSha256
        });
        previewAvailability = "available";
      } catch {
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
      archivedAt: asset.archivedAt ?? null,
      groupId: asset.groupId ?? null,
      previewUrl,
      previewAvailability
    });
  }
}
