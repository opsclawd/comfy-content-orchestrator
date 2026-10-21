import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  createClientId,
  createDerivativeId,
  createEvidenceId,
  createSourceObjectId,
  MimeConflictError,
  NotFoundError,
  ProductValidationError,
  ReportDisputedError,
  SourceIntegrityMismatchError,
  SourceSupersededError,
  type EvidenceAsset,
  type EvidenceDerivative,
  type EvidenceRevision,
  type Sha256Hex,
  type SourceObject
} from "@cco/domain";
import {
  StorageIntegrityViolationError,
  type EvidenceAssetRepositoryPort,
  type EvidenceLockCoordinatorPort,
  type ObjectStoragePort,
  type UnitOfWork,
  type UnitOfWorkContext
} from "../ports/index.js";
import {
  LinkExistingDerivativeUseCase,
  type LinkExistingDerivativeInput
} from "./link-existing-derivative.js";

describe("LinkExistingDerivativeUseCase", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const evidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000010");
  const sourceObjectId = createSourceObjectId("018f0000-0000-7000-8000-000000000011");
  const referenceAssetId = "018f0000-0000-7000-8000-000000000020";
  const derivativeSha256 =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Sha256Hex;

  const validSourceBytes = Buffer.from("authentic original capture bytes");
  const validSourceSha256 = crypto
    .createHash("sha256")
    .update(validSourceBytes)
    .digest("hex") as Sha256Hex;

  const mockRevision: EvidenceRevision = {
    clientId,
    evidenceId,
    revision: 1,
    sourceObjectId,
    sourceClass: "photo",
    acquisitionMethod: "direct_upload",
    submittedBy: "photographer-1",
    submittedAt: "2026-10-19T10:00:00.000Z",
    assertionText: "Direct macro capture",
    reportedCaptureDate: "2026-10-19",
    reportedCaptureTimestamp: "2026-10-19T10:00:00.000Z",
    reportedCapturePrecision: "second",
    captureContext: null,
    rightsStatus: "granted",
    consentStatus: "granted",
    rightsAttribution: "Macro Studio LLC",
    rightsDocumentLocator: null,
    supersedesRevision: null
  };

  const mockSourceObject: SourceObject = {
    sourceObjectId,
    clientId,
    storageBucket: "restricted-original",
    storageObjectKey: `clients/${clientId}/evidence/originals/${validSourceSha256}`,
    originalSha256: validSourceSha256,
    detectedMimeType: "image/jpeg",
    byteLength: validSourceBytes.byteLength,
    uploaderId: "uploader-1",
    uploadedAt: "2026-10-19T10:00:00.000Z",
    accessClass: "restricted_original",
    retentionClass: "source_evidence_archive",
    retentionPolicyVersion: "v1",
    availability: "available",
    storageVersionId: null
  };

  const mockEvidenceAsset: EvidenceAsset = {
    clientId,
    evidenceId,
    currentRevision: 1,
    version: 1,
    createdAt: "2026-10-19T10:00:00.000Z",
    archivedAt: null
  };

  function createTestDependencies(overrides?: {
    evidenceAssetRepo?: Partial<EvidenceAssetRepositoryPort>;
    objectStorage?: Partial<ObjectStoragePort>;
  }) {
    const evidenceAssetRepo = {
      registerEvidence: vi.fn(),
      linkDerivative: vi.fn(async (cmd) => {
        const deriv: EvidenceDerivative = {
          clientId: cmd.clientId,
          derivativeId: createDerivativeId("018f0000-0000-7000-8000-000000000099"),
          evidenceId: cmd.payload.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision,
          referenceAssetId: cmd.payload.referenceAssetId,
          derivativeSha256: cmd.payload.derivativeSha256,
          transformDescription: cmd.payload.transformDescription,
          transformToolVersion: cmd.payload.transformToolVersion ?? null,
          createdBy: cmd.actorId,
          createdAt: "2026-10-20T00:00:00.000Z"
        };
        return deriv;
      }),
      appendVerificationEvent: vi.fn(),
      quarantineSourceObject: vi.fn(async () => {}),
      createIngestReservation: vi.fn(),
      completeIngestReservation: vi.fn(),
      getClientStorageUsage: vi.fn(),
      getCommandReceipt: vi.fn(async () => null),
      getEvidenceById: vi.fn(async () => mockEvidenceAsset),
      getEvidenceEligibility: vi.fn(async () => ({
        isEligible: true,
        reason: "eligible" as const
      })),
      getEvidenceRevision: vi.fn(async () => mockRevision),
      getSourceObjectById: vi.fn(async () => mockSourceObject),
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

    const objectStorage: ObjectStoragePort = {
      getObject: vi.fn(async () => ({
        bucket: "restricted-original",
        key: `clients/${clientId}/evidence/originals/${validSourceSha256}`,
        body: validSourceBytes,
        contentType: "image/jpeg"
      })),
      putObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn(),
      listObjects: vi.fn(),
      copyObject: vi.fn(),
      createPresignedGetUrl: vi.fn(),
      ...overrides?.objectStorage
    } as unknown as ObjectStoragePort;

    return { unitOfWork, evidenceAssetRepo, objectStorage };
  }

  const baseInput: LinkExistingDerivativeInput = {
    clientId,
    evidenceId,
    evidenceRevision: 1,
    referenceAssetId,
    derivativeSha256,
    transformDescription: "Downsampled 1024x1024 WebP for real-time viewport preview",
    transformToolVersion: "sharp@0.33.5",
    actorId: "operator-1"
  };

  it("successfully links an existing derivative after verifying source bytes", async () => {
    const deps = createTestDependencies();
    const useCase = new LinkExistingDerivativeUseCase(deps);

    const result = await useCase.execute(baseInput);

    expect(result.evidenceId).toBe(evidenceId);
    expect(result.referenceAssetId).toBe(referenceAssetId);
    expect(result.derivativeSha256).toBe(derivativeSha256);
    expect(deps.objectStorage.getObject).toHaveBeenCalledWith(
      {
        bucket: mockSourceObject.storageBucket,
        key: mockSourceObject.storageObjectKey
      },
      expect.objectContaining({ maxBytes: expect.any(Number) })
    );
    expect(deps.evidenceAssetRepo.linkDerivative).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId,
        payload: expect.objectContaining({
          evidenceId,
          evidenceRevision: 1,
          referenceAssetId,
          derivativeSha256
        })
      })
    );
  });

  it("quarantines source object and throws SourceIntegrityMismatchError if persisted bytes are corrupt", async () => {
    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async () => ({
          bucket: "restricted-original",
          key: `clients/${clientId}/evidence/originals/${validSourceSha256}`,
          body: Buffer.from("tampered corrupted bytes!"),
          contentType: "image/jpeg"
        }))
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);
    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      sourceObjectId,
      "Storage byte integrity mismatch"
    );
  });

  it("quarantines source object and throws NotFoundError if storage blob is missing", async () => {
    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async () => undefined)
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);
    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      sourceObjectId,
      "Storage blob missing"
    );
  });

  it("quarantines source object and throws SourceIntegrityMismatchError when getObject throws StorageIntegrityViolationError (proven oversized content or storage-side checksum mismatch)", async () => {
    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async () => {
          throw new StorageIntegrityViolationError(
            "Checksum mismatch on getObject: stored checksum abc, calculated def",
            "restricted-original",
            "some-key"
          );
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceIntegrityMismatchError);
    expect(deps.evidenceAssetRepo.quarantineSourceObject).toHaveBeenCalledWith(
      clientId,
      sourceObjectId,
      expect.stringContaining("Checksum mismatch on getObject")
    );
  });

  it("does NOT quarantine and propagates a transient/transport error from getObject unchanged (e.g. network timeout, auth failure)", async () => {
    const transientError = new Error("ECONNRESET: socket hang up while reading from S3");
    const deps = createTestDependencies({
      objectStorage: {
        getObject: vi.fn(async () => {
          throw transientError;
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(transientError);
    expect(deps.evidenceAssetRepo.quarantineSourceObject).not.toHaveBeenCalled();
  });

  it("rejects invalid UUID identifiers", async () => {
    const deps = createTestDependencies();
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        referenceAssetId: "not-a-uuid"
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("rejects non-UUIDv7 actionId", async () => {
    const deps = createTestDependencies();
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(
      useCase.execute({
        ...baseInput,
        actionId: "018f0000-0000-4000-8000-000000000001" // v4, not v7
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("returns cached result on idempotent replay without re-checking storage", async () => {
    const cachedDeriv: EvidenceDerivative = {
      clientId,
      derivativeId: createDerivativeId("018f0000-0000-7000-8000-000000000099"),
      evidenceId,
      evidenceRevision: 1,
      referenceAssetId,
      derivativeSha256,
      transformDescription: "Cached",
      transformToolVersion: null,
      createdBy: "operator-1",
      createdAt: "2026-10-20T00:00:00.000Z"
    };

    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getCommandReceipt: vi.fn(async () => ({
          commandName: "linkDerivative",
          payloadSha256: "abc",
          actorId: "operator-1",
          responseBody: cachedDeriv
        })),
        linkDerivative: vi.fn(async () => cachedDeriv)
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    const result = await useCase.execute(baseInput);
    expect(result).toBe(cachedDeriv);
    expect(deps.objectStorage.getObject).not.toHaveBeenCalled();
  });

  it("propagates repository NotFoundError if target reference asset does not exist", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        linkDerivative: vi.fn(async () => {
          throw new NotFoundError("ReferenceAsset", referenceAssetId);
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(NotFoundError);
  });

  it("propagates repository AccessDeniedError if target reference asset is archived", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        linkDerivative: vi.fn(async () => {
          throw new AccessDeniedError("Target reference asset is archived.", "REFERENCE_ARCHIVED");
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(AccessDeniedError);
  });

  it("propagates repository AccessDeniedError if associated batch is archived", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        linkDerivative: vi.fn(async () => {
          throw new AccessDeniedError("Associated batch is archived.", "BATCH_ARCHIVED");
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(AccessDeniedError);
  });

  it("propagates repository AccessDeniedError if associated SKU is archived", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        linkDerivative: vi.fn(async () => {
          throw new AccessDeniedError("Associated SKU is archived.", "SKU_ARCHIVED");
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(AccessDeniedError);
  });

  it("propagates repository MimeConflictError if derivative hash mismatches reference asset hash", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        linkDerivative: vi.fn(async () => {
          throw new MimeConflictError(
            "Derivative SHA-256 does not match referenced ReferenceAsset hash."
          );
        })
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(MimeConflictError);
  });

  it("rejects linking derivative if target evidence asset is archived", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getEvidenceById: vi.fn(async () => ({
          ...mockEvidenceAsset,
          archivedAt: "2026-10-20T00:00:00.000Z"
        }))
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(AccessDeniedError);
  });

  it("rejects linking derivative if target evidence revision has been superseded", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getEvidenceById: vi.fn(async () => ({
          ...mockEvidenceAsset,
          currentRevision: 2
        }))
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(SourceSupersededError);
  });

  it("rejects linking derivative if target evidence revision has an active dispute", async () => {
    const deps = createTestDependencies({
      evidenceAssetRepo: {
        getEvidenceEligibility: vi.fn(async () => ({
          isEligible: false,
          reason: "source_disputed" as const
        }))
      }
    });
    const useCase = new LinkExistingDerivativeUseCase(deps);

    await expect(useCase.execute(baseInput)).rejects.toThrow(ReportDisputedError);
  });

  it("coordinates command lock and source lock on dedicated lock session", async () => {
    const deps = createTestDependencies();
    const acquireCommandLock = vi.fn().mockResolvedValue(undefined);
    const acquireSourceLock = vi.fn().mockResolvedValue(undefined);
    const mockLockCoordinator: EvidenceLockCoordinatorPort = {
      withSourceLock: vi.fn(),
      withCommandLock: vi.fn(),
      withLockSession: vi.fn(async (_cid, action) => {
        return await action({
          acquireCommandLock,
          acquireSourceLock
        });
      })
    };

    const useCase = new LinkExistingDerivativeUseCase({
      ...deps,
      lockCoordinator: mockLockCoordinator
    });

    const result = await useCase.execute(baseInput);
    expect(result.derivativeId).toBeDefined();
    expect(mockLockCoordinator.withLockSession).toHaveBeenCalledWith(
      clientId,
      expect.any(Function)
    );
    expect(acquireCommandLock).toHaveBeenCalled();
    expect(acquireSourceLock).toHaveBeenCalledWith(validSourceSha256);
  });
});
