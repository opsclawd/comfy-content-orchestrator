import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BUCKETS, type DateOnlyString, type IsoTimestampString } from "@cco/shared";
import {
  AccessDeniedError,
  createBatchId,
  createClientId,
  createDerivativeId,
  createEvidenceId,
  createSourceObjectId,
  CrossBatchSourceError,
  IdempotencyConflictError,
  NotFoundError,
  ProductValidationError,
  QuotaExceededError,
  SourceIntegrityMismatchError,
  type BatchEvidenceLink,
  type EvidenceAsset,
  type EvidenceDerivative,
  type EvidenceRevision,
  type Sha256Hex,
  type SourceObject
} from "@cco/domain";
import {
  DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
  ObjectAlreadyExistsError,
  StorageIntegrityViolationError,
  type EvidenceAssetRepositoryPort,
  type EvidenceLockCoordinatorPort,
  type EvidenceStoragePolicyConfig,
  type ObjectStoragePort,
  type OriginalsInspectionPort,
  type UnitOfWork,
  type UnitOfWorkContext
} from "../ports/index.js";
import {
  computeCanonicalPayloadSha256,
  RegisterEvidenceAssetUseCase,
  type RegisterEvidenceAssetInput
} from "./register-evidence-asset.js";

describe("RegisterEvidenceAssetUseCase", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f0000-0000-7000-8000-000000000002");
  const dummyBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const dummySha256 = crypto.createHash("sha256").update(dummyBytes).digest("hex") as Sha256Hex;

  function createTestDependencies(overrides?: {
    objectStorage?: Partial<ObjectStoragePort>;
    originalsInspector?: Partial<OriginalsInspectionPort>;
    lockCoordinator?: Partial<EvidenceLockCoordinatorPort>;
    evidenceAssetRepo?: Partial<EvidenceAssetRepositoryPort>;
    storagePolicy?: EvidenceStoragePolicyConfig;
  }) {
    const storedBlobs = new Map<string, Buffer>();
    storedBlobs.set(
      `clients/${clientId}/evidence/originals/${dummySha256}`,
      Buffer.from(dummyBytes)
    );

    const objectStorage: ObjectStoragePort = {
      putObject: vi.fn(async (params) => {
        if (params.ifNoneMatch === "*" && storedBlobs.has(params.key)) {
          throw new ObjectAlreadyExistsError("Object exists", params.bucket, params.key);
        }
        const buf = Buffer.isBuffer(params.body) ? params.body : Buffer.from(params.body);
        storedBlobs.set(params.key, buf);
        return { bucket: params.bucket, key: params.key };
      }),
      getObject: vi.fn(async (params) => {
        const body = storedBlobs.get(params.key);
        if (!body) return undefined;
        return {
          bucket: params.bucket,
          key: params.key,
          body,
          contentType: "image/jpeg",
          contentLength: body.length
        };
      }),
      deleteObject: vi.fn(async () => {}),
      copyObject: vi.fn(async (_from, to) => to),
      headObject: vi.fn(async () => undefined),
      ...overrides?.objectStorage
    };

    const originalsInspector: OriginalsInspectionPort = {
      inspectAndValidate: vi.fn(async (bytes, declaredMime, sourceClass) => {
        return {
          detectedMimeType: declaredMime,
          byteLength: bytes.byteLength,
          sourceClass,
          width: 100,
          height: 100
        };
      }),
      ...overrides?.originalsInspector
    };

    const lockCoordinator: EvidenceLockCoordinatorPort = {
      withSourceLock: vi.fn(async (_client, _sha, callback) => callback()),
      withCommandLock: vi.fn(async (_client, _action, callback) => callback()),
      withLockSession: vi.fn(async (_client, callback) =>
        callback({
          acquireCommandLock: vi.fn().mockResolvedValue(undefined),
          acquireSourceLock: vi.fn().mockResolvedValue(undefined)
        })
      ),
      ...overrides?.lockCoordinator
    };

    let reservationCounter = 0;
    const evidenceAssetRepo = {
      registerEvidence: vi.fn(async (cmd) => {
        const asset: EvidenceAsset = {
          clientId: cmd.clientId,
          evidenceId:
            cmd.payload.targetEvidenceId ??
            createEvidenceId("018f0000-0000-7000-8000-000000000010"),
          currentRevision: 1,
          version: 1,
          createdAt: cmd.timestamp,
          archivedAt: null
        };
        const rev: EvidenceRevision = {
          clientId: cmd.clientId,
          evidenceId: asset.evidenceId,
          revision: 1,
          sourceObjectId:
            cmd.payload.sourceObjectId ??
            cmd.payload.reusedSourceObjectId ??
            createSourceObjectId("018f0000-0000-7000-8000-000000000099"),
          sourceClass: cmd.payload.sourceClass,
          acquisitionMethod: cmd.payload.acquisitionMethod,
          submittedBy: cmd.actorId,
          submittedAt: cmd.timestamp,
          assertionText: cmd.payload.assertionText,
          reportedCaptureDate: (cmd.payload.reportedCaptureDate ?? null) as DateOnlyString | null,
          reportedCaptureTimestamp: (cmd.payload.reportedCaptureTimestamp ??
            null) as IsoTimestampString | null,
          reportedCapturePrecision: cmd.payload.reportedCapturePrecision ?? null,
          captureContext: cmd.payload.captureContext,
          rightsStatus: cmd.payload.rightsStatus,
          consentStatus: cmd.payload.consentStatus,
          rightsAttribution: cmd.payload.rightsAttribution,
          rightsDocumentLocator: cmd.payload.rightsDocumentLocator,
          supersedesRevision: null
        };
        const src: SourceObject = {
          clientId: cmd.clientId,
          sourceObjectId:
            cmd.payload.sourceObjectId ??
            cmd.payload.reusedSourceObjectId ??
            createSourceObjectId("018f0000-0000-7000-8000-000000000099"),
          storageBucket: cmd.payload.storageBucket,
          storageObjectKey: cmd.payload.storageObjectKey,
          originalSha256: cmd.payload.originalSha256,
          detectedMimeType: cmd.payload.detectedMimeType,
          byteLength: cmd.payload.byteLength,
          uploadedAt: cmd.timestamp,
          uploaderId: cmd.actorId,
          accessClass: "restricted_original",
          retentionClass: "source_evidence_archive",
          retentionPolicyVersion: cmd.payload.retentionPolicyVersion,
          availability: "available",
          storageVersionId: null
        };
        const link: BatchEvidenceLink = {
          clientId: cmd.clientId,
          batchId: cmd.payload.batchId,
          evidenceId: asset.evidenceId,
          evidenceRevision: 1,
          purpose: cmd.payload.purpose,
          assertedBy: cmd.actorId,
          assertedAt: cmd.timestamp
        };
        let derivative: EvidenceDerivative | null = null;
        if (cmd.payload.derivative) {
          derivative = {
            clientId: cmd.clientId,
            derivativeId: createDerivativeId("018f0000-0000-7000-8000-000000000020"),
            evidenceId: asset.evidenceId,
            evidenceRevision: 1,
            referenceAssetId: cmd.payload.derivative.referenceAssetId,
            derivativeSha256: cmd.payload.derivative.derivativeSha256,
            transformDescription: cmd.payload.derivative.transformDescription,
            transformToolVersion: cmd.payload.derivative.transformToolVersion ?? null,
            createdBy: cmd.actorId,
            createdAt: cmd.timestamp
          };
        }
        return {
          evidenceAsset: asset,
          evidenceRevision: rev,
          sourceObject: src,
          batchEvidenceLink: link,
          derivative,
          isNewSourceObject: !cmd.payload.reusedSourceObjectId
        };
      }),
      linkDerivative: vi.fn(),
      appendVerificationEvent: vi.fn(),
      quarantineSourceObject: vi.fn(async () => {}),
      createIngestReservation: vi.fn(async () => `res-${++reservationCounter}`),
      completeIngestReservation: vi.fn(async () => {}),
      getClientStorageUsage: vi.fn(async () => ({
        totalStoredBytes: 1000,
        activeReservedBytes: 0,
        concurrentInflightCount: 0
      })),
      getCommandReceipt: vi.fn(async () => null),
      getSourceObjectById: vi.fn(async (cid, soid) => ({
        clientId: cid,
        sourceObjectId: soid,
        storageBucket: BUCKETS.EVIDENCE,
        storageObjectKey: `clients/${cid}/evidence/originals/${dummySha256}`,
        originalSha256: dummySha256,
        detectedMimeType: "image/jpeg",
        byteLength: dummyBytes.byteLength,
        uploadedAt: "2026-10-19T00:00:00.000Z",
        uploaderId: "user-1",
        accessClass: "restricted_original" as const,
        retentionClass: "source_evidence_archive" as const,
        retentionPolicyVersion: "v1",
        availability: "available" as const,
        storageVersionId: null
      })),
      getEvidenceById: vi.fn(async (cid, eid) => ({
        clientId: cid,
        evidenceId: eid,
        currentRevision: 1,
        version: 1,
        createdAt: "2026-10-19T00:00:00.000Z",
        archivedAt: null
      })),
      getEvidenceRevision: vi.fn(async (cid, eid, rev) => ({
        clientId: cid,
        evidenceId: eid,
        revision: rev,
        sourceObjectId: createSourceObjectId("018f0000-0000-7000-8000-000000000099"),
        sourceClass: "photo" as const,
        acquisitionMethod: "direct_upload" as const,
        submittedBy: "user-1",
        submittedAt: "2026-10-19T00:00:00.000Z",
        assertionText: "Target evidence",
        reportedCaptureDate: null,
        reportedCaptureTimestamp: null,
        reportedCapturePrecision: null,
        captureContext: null,
        rightsStatus: "granted" as const,
        consentStatus: "granted" as const,
        rightsAttribution: null,
        rightsDocumentLocator: null,
        supersedesRevision: null
      })),
      getEvidenceEligibility: vi.fn(async () => ({
        isEligible: true,
        reason: "eligible" as const
      })),
      ...overrides?.evidenceAssetRepo
    } as unknown as EvidenceAssetRepositoryPort;

    const unitOfWork: UnitOfWork = {
      execute: vi.fn(async (work) => {
        const ctx = {
          evidenceAsset: evidenceAssetRepo
        } as unknown as UnitOfWorkContext;
        return await work(ctx);
      })
    };

    return {
      unitOfWork,
      objectStorage,
      originalsInspector,
      lockCoordinator,
      evidenceAssetRepo,
      storagePolicy: overrides?.storagePolicy ?? DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
      storedBlobs
    };
  }

  const baseInput: RegisterEvidenceAssetInput = {
    clientId,
    batchId,
    body: dummyBytes,
    declaredMimeType: "image/jpeg",
    purpose: "macro_hero_photo",
    sourceClass: "photo",
    acquisitionMethod: "direct_upload",
    assertionText: "Direct macro photograph taken of batch flower in clean room.",
    reportedCaptureDate: "2026-10-19",
    reportedCaptureTimestamp: "2026-10-19T14:30:00.000Z",
    reportedCapturePrecision: "minute",
    rightsStatus: "granted",
    consentStatus: "granted",
    registrationIntent: "initial_assertion",
    actorId: "operator-1"
  };

  it("successfully registers an evidence asset with clean inspection and storage verification", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    const result = await useCase.execute(baseInput);

    expect(result.evidenceAsset.clientId).toBe(clientId);
    expect(result.evidenceRevision.assertionText).toBe(baseInput.assertionText);
    expect(result.sourceObject.originalSha256).toBe(dummySha256);
    expect(result.batchEvidenceLink.purpose).toBe("macro_hero_photo");

    expect(deps.objectStorage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "godzspeed-evidence",
        key: `clients/${clientId}/evidence/originals/${dummySha256}`,
        ifNoneMatch: "*"
      })
    );
    expect(deps.evidenceAssetRepo.createIngestReservation).toHaveBeenCalled();
    expect(deps.evidenceAssetRepo.completeIngestReservation).toHaveBeenCalledWith(
      expect.any(String),
      "committed"
    );
  });

  it("refuses assumed production archival when policy is unapproved in production", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase({
      ...deps,
      storagePolicy: {
        policyId: "unapproved-prod-policy",
        isProductionApproved: false,
        environment: "production",
        maxClientStorageBytes: 1000000,
        maxConcurrentUploads: 5,
        limitsPerSourceClass: {
          photo: 100000,
          document: 100000,
          coa: 100000,
          process_record: 100000,
          raw: 100000,
          video: 0
        }
      }
    });

    await expect(useCase.execute(baseInput)).rejects.toThrow(AccessDeniedError);
    await expect(useCase.execute(baseInput)).rejects.toThrow(
      /Production evidence archival policy has not been signed off/
    );
  });

  it("rejects empty body when reusedSourceObjectId is not provided", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        body: Buffer.alloc(0)
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects non-UUIDv7 actionId", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        actionId: "018f0000-0000-4000-8000-000000000001" // v4, not v7
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects files exceeding source class limits", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase({
      ...deps,
      storagePolicy: {
        policyId: "test-policy",
        isProductionApproved: true,
        environment: "test",
        maxClientStorageBytes: 1000000,
        maxConcurrentUploads: 5,
        limitsPerSourceClass: {
          photo: 5,
          document: 1000,
          coa: 1000,
          process_record: 1000,
          raw: 1000,
          video: 0
        }
      }
    });

    await expect(useCase.execute(baseInput)).rejects.toThrow(ProductValidationError);
    await expect(useCase.execute(baseInput)).rejects.toThrow(/exceeds maximum limit of 5 bytes/);
  });

  it("rejects mismatch between reportedCaptureDate and reportedCaptureTimestamp", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        reportedCaptureDate: "2026-10-18",
        reportedCaptureTimestamp: "2026-10-19T14:30:00.000Z"
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects when storage quota is exceeded", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getClientStorageUsage: vi.fn(async () => ({
          totalStoredBytes: 9_999_999_999,
          activeReservedBytes: 0,
          concurrentInflightCount: 0
        }))
      }
    });
    const useCase = new RegisterEvidenceAssetUseCase({
      ...deps,
      storagePolicy: {
        policyId: "test-policy",
        isProductionApproved: true,
        environment: "test",
        maxClientStorageBytes: 1000,
        maxConcurrentUploads: 5,
        limitsPerSourceClass: {
          photo: 100000,
          document: 100000,
          coa: 100000,
          process_record: 100000,
          raw: 100000,
          video: 0
        }
      }
    });

    await expect(useCase.execute(baseInput)).rejects.toThrow(QuotaExceededError);
  });

  it("handles storage collision when existing object matches hash", async () => {
    const deps = createTestDependencies();
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    const result = await useCase.execute(baseInput);

    expect(result.sourceObject.originalSha256).toBe(dummySha256);
  });

  it("fails closed when storage collision contains tampered bytes", async () => {
    const deps = createTestDependencies();
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;
    deps.storedBlobs.set(key, Buffer.from("TAMPERED_BYTES_DIFFERENT_HASH"));

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);
  });

  it("quarantines the existing committed source object and throws SourceIntegrityMismatchError when getObject throws StorageIntegrityViolationError during a storage collision read (proven oversized content or storage-side checksum mismatch)", async () => {
    const existingSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000066");
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;

    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async (params) => {
          if (params.key === key) {
            throw new StorageIntegrityViolationError(
              "Observed content length exceeds declared maxBytes during collision readback.",
              params.bucket,
              params.key
            );
          }
          return undefined;
        })
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => ({
          clientId,
          sourceObjectId: existingSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: key,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });
    // A collision occurs because this hash was already persisted (dedup) --
    // the storedBlobs presence is irrelevant here since getObject is overridden.
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      existingSourceId,
      expect.stringContaining("Storage collision read failed")
    );
  });

  it("propagates a transient/transport error unchanged (does not quarantine) when getObject fails during a storage collision read without proving corruption", async () => {
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;

    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async (params) => {
          if (params.key === key) {
            throw new Error("ECONNRESET: connection reset by peer");
          }
          return undefined;
        })
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => {
          throw new Error("should not be called for a transient error");
        })
      }
    });
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow("ECONNRESET");

    expect(deps.evidenceAssetRepo.quarantineSourceObject).not.toHaveBeenCalled();
  });

  it("quarantines the existing committed source object when the SECOND (readback) getObject call throws StorageIntegrityViolationError after a successful collision hash check (dedup path)", async () => {
    const existingSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000067");
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;
    let getObjectCallCount = 0;

    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async (params) => {
          getObjectCallCount++;
          if (params.key === key && getObjectCallCount === 1) {
            // First (collision) GET: bytes match, so the collision check passes.
            return {
              bucket: params.bucket,
              key: params.key,
              body: dummyBytes,
              contentType: "image/jpeg",
              contentLength: dummyBytes.length
            };
          }
          if (params.key === key && getObjectCallCount === 2) {
            // Second (readback) GET: storage proves corruption this time.
            throw new StorageIntegrityViolationError(
              "Stored checksum metadata does not match computed hash on readback.",
              params.bucket,
              params.key
            );
          }
          return undefined;
        })
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => ({
          clientId,
          sourceObjectId: existingSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: key,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      existingSourceId,
      expect.stringContaining("Storage readback failed")
    );
  });

  it("quarantines the existing committed source object when the SECOND (readback) GET returns a mismatched stored MIME type after a successful collision hash check (dedup path)", async () => {
    const existingSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000068");
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;
    let getObjectCallCount = 0;

    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async (params) => {
          getObjectCallCount++;
          if (params.key === key && getObjectCallCount === 1) {
            return {
              bucket: params.bucket,
              key: params.key,
              body: dummyBytes,
              contentType: "image/jpeg",
              contentLength: dummyBytes.length
            };
          }
          if (params.key === key && getObjectCallCount === 2) {
            // Same bytes, but the storage-reported MIME type has drifted
            // from what was originally uploaded for this hash.
            return {
              bucket: params.bucket,
              key: params.key,
              body: dummyBytes,
              contentType: "application/pdf",
              contentLength: dummyBytes.length
            };
          }
          return undefined;
        })
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => ({
          clientId,
          sourceObjectId: existingSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: key,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      existingSourceId,
      "Storage readback byte integrity mismatch"
    );
  });

  it("does not attempt to quarantine on a readback mismatch for a genuinely fresh PUT with no prior committed source under this hash", async () => {
    const deps = createTestDependencies({
      objectStorage: {
        putObject: vi.fn(async (params) => {
          // No collision: this is a brand-new key, never persisted before.
          return { bucket: params.bucket, key: params.key };
        }),
        getObject: vi.fn(async (params) => {
          // Readback (the only getObject call in the non-collision path)
          // returns corrupted bytes.
          return {
            bucket: params.bucket,
            key: params.key,
            body: Buffer.from("CORRUPT_BYTES_DIFFERENT_HASH"),
            contentType: "image/jpeg",
            contentLength: 28
          };
        })
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => {
          throw new Error("should not be called when there was no collision");
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).not.toHaveBeenCalled();
  });

  it("quarantines the existing committed source object when the FIRST (collision) getObject returns undefined (blob proven missing, not thrown)", async () => {
    const existingSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000069");
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;

    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async () => undefined)
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => ({
          clientId,
          sourceObjectId: existingSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: key,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      existingSourceId,
      "Storage collision read returned no object (blob missing)"
    );
  });

  it("quarantines the existing committed source object when the SECOND (readback) getObject returns undefined after a successful collision hash check (dedup path)", async () => {
    const existingSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000070");
    const key = `clients/${clientId}/evidence/originals/${dummySha256}`;
    let getObjectCallCount = 0;

    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async (params) => {
          getObjectCallCount++;
          if (params.key === key && getObjectCallCount === 1) {
            return {
              bucket: params.bucket,
              key: params.key,
              body: dummyBytes,
              contentType: "image/jpeg",
              contentLength: dummyBytes.length
            };
          }
          return undefined;
        })
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => ({
          clientId,
          sourceObjectId: existingSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: key,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });
    deps.storedBlobs.set(key, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      existingSourceId,
      "Storage readback returned no object (blob missing)"
    );
  });

  it("does not attempt to quarantine when the readback getObject returns undefined for a genuinely fresh PUT with no prior committed source", async () => {
    const deps = createTestDependencies({
      objectStorage: {
        putObject: vi.fn(async (params) => ({ bucket: params.bucket, key: params.key })),
        getObject: vi.fn(async () => undefined)
      },
      evidenceAssetRepo: {
        getSourceObjectByHash: vi.fn(async () => {
          throw new Error("should not be called when there was no collision");
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).not.toHaveBeenCalled();
  });

  it("marks reservation abandoned on database transaction failure after S3 PUT", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        registerEvidence: vi.fn(async () => {
          throw new Error("DB transaction deadlock or failure");
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(useCase.execute(baseInput)).rejects.toThrow("DB transaction deadlock or failure");

    // Reservation should be marked abandoned to retain quota accounting for the orphan blob
    expect(deps.evidenceAssetRepo.completeIngestReservation).toHaveBeenCalledWith(
      expect.any(String),
      "abandoned"
    );

    // Stored blob should NOT be deleted
    expect(deps.objectStorage.deleteObject).not.toHaveBeenCalled();
  });

  it("supports reusing existing source object without re-uploading bytes", async () => {
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000055");
    const existingSource: SourceObject = {
      sourceObjectId: reusedSourceId,
      clientId,
      storageBucket: "godzspeed-evidence",
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      uploaderId: "operator-original",
      uploadedAt: "2026-10-18T10:00:00.000Z",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: "v1",
      availability: "available",
      storageVersionId: null
    };

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => existingSource)
      }
    });
    deps.storedBlobs.set(existingSource.storageObjectKey, dummyBytes);

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    const result = await useCase.execute({
      clientId,
      batchId,
      reusedSourceObjectId: reusedSourceId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Reusing verified source for batch assertion.",
      registrationIntent: "new_batch_assertion",
      actorId: "operator-1"
    });

    expect(result.sourceObject.sourceObjectId).toBe(reusedSourceId);
    expect(deps.objectStorage.putObject).not.toHaveBeenCalled();
    expect(deps.evidenceAssetRepo.createIngestReservation).not.toHaveBeenCalled();
  });

  it("quarantines source object and throws SourceIntegrityMismatchError if reused source bytes are corrupt", async () => {
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000055");
    const existingSource: SourceObject = {
      sourceObjectId: reusedSourceId,
      clientId,
      storageBucket: "godzspeed-evidence",
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      uploaderId: "operator-original",
      uploadedAt: "2026-10-18T10:00:00.000Z",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: "v1",
      availability: "available",
      storageVersionId: null
    };

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => existingSource)
      }
    });
    // Set corrupted bytes
    deps.storedBlobs.set(existingSource.storageObjectKey, Buffer.from("CORRUPT_BYTES_NOW"));

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        clientId,
        batchId,
        reusedSourceObjectId: reusedSourceId,
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Reusing source.",
        registrationIntent: "new_batch_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      reusedSourceId,
      "Storage byte integrity mismatch"
    );
  });

  it("quarantines source object and throws SourceIntegrityMismatchError when getObject throws StorageIntegrityViolationError for a reused source (proven oversized content or storage-side checksum mismatch)", async () => {
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000055");
    const existingSource: SourceObject = {
      sourceObjectId: reusedSourceId,
      clientId,
      storageBucket: "godzspeed-evidence",
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      uploaderId: "operator-original",
      uploadedAt: "2026-10-18T10:00:00.000Z",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: "v1",
      availability: "available",
      storageVersionId: null
    };

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => existingSource)
      },
      objectStorage: {
        getObject: vi.fn(async () => {
          throw new StorageIntegrityViolationError(
            "Checksum mismatch on getObject: stored checksum abc, calculated def",
            "godzspeed-evidence",
            existingSource.storageObjectKey
          );
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        clientId,
        batchId,
        reusedSourceObjectId: reusedSourceId,
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Reusing source.",
        registrationIntent: "new_batch_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      reusedSourceId,
      expect.stringContaining("Checksum mismatch on getObject")
    );
  });

  it("does NOT quarantine and propagates a transient/transport error from getObject unchanged for a reused source (e.g. network timeout, auth failure)", async () => {
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000055");
    const existingSource: SourceObject = {
      sourceObjectId: reusedSourceId,
      clientId,
      storageBucket: "godzspeed-evidence",
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      uploaderId: "operator-original",
      uploadedAt: "2026-10-18T10:00:00.000Z",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: "v1",
      availability: "available",
      storageVersionId: null
    };
    const transientError = new Error("ECONNRESET: socket hang up while reading from S3");

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => existingSource)
      },
      objectStorage: {
        getObject: vi.fn(async () => {
          throw transientError;
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        clientId,
        batchId,
        reusedSourceObjectId: reusedSourceId,
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Reusing source.",
        registrationIntent: "new_batch_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(transientError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).not.toHaveBeenCalled();
  });

  it("fails closed when evidence storage policy configuration is missing", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase({
      ...deps,
      storagePolicy: undefined
    });

    await expect(useCase.execute(baseInput)).rejects.toThrow(
      "Evidence storage policy configuration is required but was not provided."
    );
  });

  it("fails closed when storage policy limits are invalid", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase({
      ...deps,
      storagePolicy: {
        ...DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
        maxClientStorageBytes: -1
      }
    });

    await expect(useCase.execute(baseInput)).rejects.toThrow(
      "Evidence storage policy specifies invalid quota, capacity, or policy identity limits."
    );
  });

  it("replays committed receipt on identical actionId without storage side effects", async () => {
    const actionId = "018f0000-0000-7000-8000-000000000099";
    const expectedResponse = {
      evidenceAsset: { evidenceId: createEvidenceId("018f0000-0000-7000-8000-000000000010") },
      evidenceRevision: { revision: 1 },
      sourceObject: {
        sourceObjectId: createSourceObjectId("018f0000-0000-7000-8000-000000000099")
      },
      batchEvidenceLink: { purpose: "macro_hero_photo" },
      derivative: null
    };

    const expectedPayload = {
      batchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Direct macro photograph taken of batch flower in clean room.",
      reportedCaptureDate: "2026-10-19",
      reportedCaptureTimestamp: "2026-10-19T14:30:00.000Z",
      reportedCapturePrecision: "minute",
      captureContext: null,
      rightsStatus: "granted",
      consentStatus: "granted",
      rightsAttribution: null,
      rightsDocumentLocator: null,
      registrationIntent: "initial_assertion",
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      storageBucket: BUCKETS.EVIDENCE,
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      retentionPolicyVersion: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY.policyId,
      expectedEvidenceVersion: undefined,
      targetEvidenceId: undefined,
      reusedSourceObjectId: undefined,
      derivative: undefined
    };
    const payloadSha = computeCanonicalPayloadSha256("registerEvidence", expectedPayload);

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getCommandReceipt: vi.fn(async () => ({
          commandName: "registerEvidence",
          payloadSha256: payloadSha,
          actorId: "operator-1",
          responseBody: expectedResponse
        }))
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    const result = await useCase.execute({
      ...baseInput,
      actionId
    });

    expect(result).toEqual(expectedResponse);
    // Verified that S3 PUT and Quota reservation were NOT executed on receipt replay
    expect(deps.objectStorage.putObject).not.toHaveBeenCalled();
    expect(deps.evidenceAssetRepo.createIngestReservation).not.toHaveBeenCalled();
  });

  it("throws IdempotencyConflictError when actionId is reused with changed payload", async () => {
    const actionId = "018f0000-0000-7000-8000-000000000099";
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getCommandReceipt: vi.fn(async () => ({
          commandName: "registerEvidence",
          payloadSha256: "different-payload-sha256",
          actorId: "operator-1",
          responseBody: {}
        }))
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        ...baseInput,
        actionId
      })
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("replays receipt for reusedSourceObjectId even if source was subsequently archived", async () => {
    const actionId = "018f0000-0000-7000-8000-000000000098";
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000077");
    const archivedSource: SourceObject = {
      sourceObjectId: reusedSourceId,
      clientId,
      storageBucket: BUCKETS.EVIDENCE,
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      uploadedAt: "2026-10-19T10:00:00.000Z",
      uploaderId: "uploader-1",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY.policyId,
      availability: "archived", // Archived!
      storageVersionId: null
    };

    const expectedResponse = {
      evidenceAsset: { evidenceId: createEvidenceId("018f0000-0000-7000-8000-000000000010") },
      evidenceRevision: { revision: 1 },
      sourceObject: archivedSource,
      batchEvidenceLink: { purpose: "macro_hero_photo" },
      derivative: null
    };

    const expectedPayload = {
      batchId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Reusing source.",
      reportedCaptureDate: null,
      reportedCaptureTimestamp: null,
      reportedCapturePrecision: null,
      captureContext: null,
      rightsStatus: "unknown",
      consentStatus: "unknown",
      rightsAttribution: null,
      rightsDocumentLocator: null,
      registrationIntent: "new_batch_assertion",
      originalSha256: dummySha256,
      detectedMimeType: "image/jpeg",
      byteLength: dummyBytes.length,
      storageBucket: BUCKETS.EVIDENCE,
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      retentionPolicyVersion: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY.policyId,
      expectedEvidenceVersion: undefined,
      targetEvidenceId: undefined,
      reusedSourceObjectId: reusedSourceId,
      derivative: undefined
    };
    const payloadSha = computeCanonicalPayloadSha256("registerEvidence", expectedPayload);

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => archivedSource),
        getCommandReceipt: vi.fn(async () => ({
          commandName: "registerEvidence",
          payloadSha256: payloadSha,
          actorId: "operator-1",
          responseBody: expectedResponse
        }))
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    const result = await useCase.execute({
      clientId,
      batchId,
      reusedSourceObjectId: reusedSourceId,
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      assertionText: "Reusing source.",
      registrationIntent: "new_batch_assertion",
      actorId: "operator-1",
      actionId
    });

    expect(result).toEqual(expectedResponse);
  });

  it("rejects reusedSourceObjectId when stored MIME type does not match sourceClass", async () => {
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000078");
    const pdfSource: SourceObject = {
      sourceObjectId: reusedSourceId,
      clientId,
      storageBucket: BUCKETS.EVIDENCE,
      storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
      originalSha256: dummySha256,
      detectedMimeType: "application/pdf", // PDF stored
      byteLength: dummyBytes.length,
      uploadedAt: "2026-10-19T10:00:00.000Z",
      uploaderId: "uploader-1",
      accessClass: "restricted_original",
      retentionClass: "source_evidence_archive",
      retentionPolicyVersion: DEFAULT_DEV_EVIDENCE_STORAGE_POLICY.policyId,
      availability: "available",
      storageVersionId: null
    };

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => pdfSource)
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        clientId,
        batchId,
        reusedSourceObjectId: reusedSourceId,
        purpose: "macro_hero_photo",
        sourceClass: "photo", // photo expects JPEG/PNG/WebP, not PDF!
        acquisitionMethod: "direct_upload",
        assertionText: "Reusing PDF as photo.",
        registrationIntent: "new_batch_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(/not permitted for source class/);
  });

  it("rejects reusing source object if source object availability is quarantined", async () => {
    const quarantinedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000077");
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => ({
          clientId,
          sourceObjectId: quarantinedSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "quarantined" as const,
          storageVersionId: null
        }))
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        clientId,
        batchId,
        reusedSourceObjectId: quarantinedSourceId,
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Reusing quarantined source.",
        registrationIntent: "new_batch_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(AccessDeniedError);
  });

  it("rejects reusing source object if declaredMimeType mismatches source object detectedMimeType", async () => {
    const reusedSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000078");
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getSourceObjectById: vi.fn(async () => ({
          clientId,
          sourceObjectId: reusedSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: `clients/${clientId}/evidence/originals/${dummySha256}`,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        clientId,
        batchId,
        reusedSourceObjectId: reusedSourceId,
        declaredMimeType: "image/png", // Mismatches stored "image/jpeg"
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Mismatched declared mime.",
        registrationIntent: "new_batch_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(/does not match reused source object MIME type/);
  });

  it("rejects when neither body nor reusedSourceObjectId is provided", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    await expect(
      useCase.execute({
        clientId,
        batchId,
        declaredMimeType: "image/jpeg",
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Missing body and reusedSourceObjectId.",
        registrationIntent: "initial_assertion",
        actorId: "operator-1"
      })
    ).rejects.toThrow(/Source evidence body or reusedSourceObjectId is required/);
  });

  it("fails closed when storage policy specifies ceiling exceeding limits in production", async () => {
    const deps = createTestDependencies();
    const useCase = new RegisterEvidenceAssetUseCase({
      ...deps,
      storagePolicy: {
        ...DEFAULT_DEV_EVIDENCE_STORAGE_POLICY,
        environment: "production",
        isProductionApproved: true,
        reviewedProductionApprovalIdentity: "REV-AUTH-001",
        limitsPerSourceClass: {
          ...DEFAULT_DEV_EVIDENCE_STORAGE_POLICY.limitsPerSourceClass,
          photo: 50 * 1024 * 1024 // Exceeds 10 MiB ceiling!
        }
      }
    });

    await expect(useCase.execute(baseInput)).rejects.toThrow(/exceeds validated ceiling/);
  });

  it("propagates CrossBatchSourceError when superseding with changed target batch", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        registerEvidence: vi.fn(async () => {
          throw new CrossBatchSourceError(
            "Target evidence asset is associated with a different batch",
            { existingBatchId: "batch-original" }
          );
        })
      }
    });
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        registrationIntent: "supersede",
        targetEvidenceId: createEvidenceId("018f0000-0000-7000-8000-000000000010"),
        expectedEvidenceVersion: 1
      })
    ).rejects.toThrow(CrossBatchSourceError);
  });

  it("propagates CrossBatchSourceError when superseding using an already-used foreign-lot source", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        registerEvidence: vi.fn(async () => {
          throw new CrossBatchSourceError("Source hash is already associated with another batch", {
            existingBatchId: "batch-foreign"
          });
        })
      }
    });
    const useCase = new RegisterEvidenceAssetUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        registrationIntent: "supersede",
        targetEvidenceId: createEvidenceId("018f0000-0000-7000-8000-000000000010"),
        expectedEvidenceVersion: 1
      })
    ).rejects.toThrow(CrossBatchSourceError);
  });

  it("quarantines target source object and throws SourceIntegrityMismatchError when target source bytes are corrupt during supersede", async () => {
    const targetEvidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000050");
    const targetSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000051");
    const targetKey = `clients/${clientId}/evidence/originals/${dummySha256}`;

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getEvidenceById: vi.fn(async () => ({
          clientId,
          evidenceId: targetEvidenceId,
          currentRevision: 1,
          version: 1,
          createdAt: "2026-10-19T00:00:00.000Z",
          archivedAt: null
        })),
        getEvidenceRevision: vi.fn(async () => ({
          clientId,
          evidenceId: targetEvidenceId,
          revision: 1,
          sourceObjectId: targetSourceId,
          sourceClass: "photo" as const,
          acquisitionMethod: "direct_upload" as const,
          submittedBy: "user-1",
          submittedAt: "2026-10-19T00:00:00.000Z",
          assertionText: "Target evidence",
          reportedCaptureDate: null,
          reportedCaptureTimestamp: null,
          reportedCapturePrecision: null,
          captureContext: null,
          rightsStatus: "granted" as const,
          consentStatus: "granted" as const,
          rightsAttribution: null,
          rightsDocumentLocator: null,
          supersedesRevision: null
        })),
        getSourceObjectById: vi.fn(async () => ({
          clientId,
          sourceObjectId: targetSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: targetKey,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      }
    });

    // Make the target stored blob corrupt
    deps.storedBlobs.set(targetKey, Buffer.from("CORRUPT_BYTES_DIFFERENT_HASH"));

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        ...baseInput,
        registrationIntent: "supersede",
        targetEvidenceId,
        expectedEvidenceVersion: 1
      })
    ).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      targetSourceId,
      expect.stringContaining("integrity mismatch")
    );
  });

  it("quarantines target source object and throws SourceIntegrityMismatchError when getObject throws StorageIntegrityViolationError during supersede (proven oversized content or storage-side checksum mismatch)", async () => {
    const targetEvidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000050");
    const targetSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000051");
    const targetKey = `clients/${clientId}/evidence/originals/${dummySha256}`;

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getEvidenceById: vi.fn(async () => ({
          clientId,
          evidenceId: targetEvidenceId,
          currentRevision: 1,
          version: 1,
          createdAt: "2026-10-19T00:00:00.000Z",
          archivedAt: null
        })),
        getEvidenceRevision: vi.fn(async () => ({
          clientId,
          evidenceId: targetEvidenceId,
          revision: 1,
          sourceObjectId: targetSourceId,
          sourceClass: "photo" as const,
          acquisitionMethod: "direct_upload" as const,
          submittedBy: "user-1",
          submittedAt: "2026-10-19T00:00:00.000Z",
          assertionText: "Target evidence",
          reportedCaptureDate: null,
          reportedCaptureTimestamp: null,
          reportedCapturePrecision: null,
          captureContext: null,
          rightsStatus: "granted" as const,
          consentStatus: "granted" as const,
          rightsAttribution: null,
          rightsDocumentLocator: null,
          supersedesRevision: null
        })),
        getSourceObjectById: vi.fn(async () => ({
          clientId,
          sourceObjectId: targetSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: targetKey,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      },
      objectStorage: {
        getObject: vi.fn(async () => {
          throw new StorageIntegrityViolationError(
            "Object ContentLength exceeds maxBytes limit",
            BUCKETS.EVIDENCE,
            targetKey
          );
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        ...baseInput,
        registrationIntent: "supersede",
        targetEvidenceId,
        expectedEvidenceVersion: 1
      })
    ).rejects.toThrow(SourceIntegrityMismatchError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      targetSourceId,
      expect.stringContaining("ContentLength exceeds maxBytes")
    );
  });

  it("does NOT quarantine and propagates a transient/transport error from getObject unchanged during supersede (e.g. network timeout, auth failure)", async () => {
    const targetEvidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000050");
    const targetSourceId = createSourceObjectId("018f0000-0000-7000-8000-000000000051");
    const targetKey = `clients/${clientId}/evidence/originals/${dummySha256}`;
    const transientError = new Error("ECONNRESET: socket hang up while reading from S3");

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getEvidenceById: vi.fn(async () => ({
          clientId,
          evidenceId: targetEvidenceId,
          currentRevision: 1,
          version: 1,
          createdAt: "2026-10-19T00:00:00.000Z",
          archivedAt: null
        })),
        getEvidenceRevision: vi.fn(async () => ({
          clientId,
          evidenceId: targetEvidenceId,
          revision: 1,
          sourceObjectId: targetSourceId,
          sourceClass: "photo" as const,
          acquisitionMethod: "direct_upload" as const,
          submittedBy: "user-1",
          submittedAt: "2026-10-19T00:00:00.000Z",
          assertionText: "Target evidence",
          reportedCaptureDate: null,
          reportedCaptureTimestamp: null,
          reportedCapturePrecision: null,
          captureContext: null,
          rightsStatus: "granted" as const,
          consentStatus: "granted" as const,
          rightsAttribution: null,
          rightsDocumentLocator: null,
          supersedesRevision: null
        })),
        getSourceObjectById: vi.fn(async () => ({
          clientId,
          sourceObjectId: targetSourceId,
          storageBucket: BUCKETS.EVIDENCE,
          storageObjectKey: targetKey,
          originalSha256: dummySha256,
          detectedMimeType: "image/jpeg",
          byteLength: dummyBytes.byteLength,
          uploadedAt: "2026-10-19T00:00:00.000Z",
          uploaderId: "user-1",
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "v1",
          availability: "available" as const,
          storageVersionId: null
        }))
      },
      objectStorage: {
        getObject: vi.fn(async () => {
          throw transientError;
        })
      }
    });

    const useCase = new RegisterEvidenceAssetUseCase(deps);
    await expect(
      useCase.execute({
        ...baseInput,
        registrationIntent: "supersede",
        targetEvidenceId,
        expectedEvidenceVersion: 1
      })
    ).rejects.toThrow(transientError);

    expect(deps.evidenceAssetRepo.quarantineSourceObject).not.toHaveBeenCalled();
  });
});
