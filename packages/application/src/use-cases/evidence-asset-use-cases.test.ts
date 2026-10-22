import { describe, expect, it, vi } from "vitest";
import { BUCKETS } from "@cco/shared";
import {
  AccessDeniedError,
  createBatchId,
  createClientId,
  createEvidenceId,
  createSha256Hex,
  createSkuId,
  createSourceObjectId,
  NotFoundError,
  type ReferenceAsset,
  type ReferenceAssetId,
  type SourceObject
} from "@cco/domain";
import type {
  EvidenceAssetRepositoryPort,
  ObjectStoragePort,
  ProductEvidenceRepositoryPort,
  ReferenceAssetRepository,
  ReviewMediaDeliveryPort,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { EvidenceAssetUseCases } from "./evidence-asset-use-cases.js";
import type { RegisterEvidenceAssetUseCase } from "./register-evidence-asset.js";
import type { LinkExistingDerivativeUseCase } from "./link-existing-derivative.js";
import type { RecordEvidenceVerificationEventUseCase } from "./record-evidence-verification-event.js";

describe("EvidenceAssetUseCases", () => {
  const clientId = createClientId("11111111-1111-4111-8111-111111111111");
  const batchId = createBatchId("22222222-2222-4222-8222-222222222222");
  const otherBatchId = createBatchId("33333333-3333-4333-8333-333333333333");
  const evidenceId = createEvidenceId("44444444-4444-4444-8444-444444444444");

  const mockBatch = {
    clientId,
    batchId,
    skuId: createSkuId("55555555-5555-4555-8555-555555555555"),
    lotIdentifier: "LOT-001",
    displayName: "Lot 001",
    version: 1,
    currentFactsRevision: 1,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockLink = {
    clientId,
    batchId,
    evidenceId,
    evidenceRevision: 1,
    purpose: "macro_hero_photo" as const,
    assertedBy: "user-1",
    assertedAt: "2026-10-21T12:00:00.000Z"
  };

  const mockSourceObj = {
    clientId,
    sourceObjectId: createSourceObjectId("66666666-6666-4666-8666-666666666666"),
    storageBucket: BUCKETS.EVIDENCE,
    storageObjectKey: `clients/${clientId}/evidence/originals/test-key`,
    originalSha256: createSha256Hex(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ),
    detectedMimeType: "image/jpeg",
    byteLength: 5000,
    uploadedAt: "2026-10-21T12:00:00.000Z",
    uploaderId: "user-1",
    accessClass: "restricted_original" as const,
    retentionClass: "source_evidence_archive" as const,
    retentionPolicyVersion: "policy-v1",
    availability: "available" as const,
    storageVersionId: null
  };

  const createDeps = () => {
    const productEvidenceRepo: Partial<ProductEvidenceRepositoryPort> = {
      getBatchById: vi.fn(async (_cId, bId) => (bId === batchId ? mockBatch : null))
    };

    const evidenceAssetRepo: Partial<EvidenceAssetRepositoryPort> = {
      getBatchEvidenceLink: vi.fn(async (_cId, bId, eId, rev) =>
        bId === batchId && eId === evidenceId && rev === 1 ? mockLink : null
      ),
      listBatchEvidence: vi.fn(async () => [mockLink]),
      getEvidenceById: vi.fn(async () => ({
        clientId,
        evidenceId,
        currentRevision: 1,
        version: 1,
        createdAt: "2026-10-21T12:00:00.000Z",
        archivedAt: null
      })),
      getEvidenceRevision: vi.fn(async () => ({
        clientId,
        evidenceId,
        revision: 1,
        sourceObjectId: mockSourceObj.sourceObjectId,
        sourceClass: "photo" as const,
        acquisitionMethod: "direct_upload" as const,
        submittedBy: "user-1",
        submittedAt: "2026-10-21T12:00:00.000Z",
        assertionText: "Photo",
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
      getSourceObjectById: vi.fn(async () => mockSourceObj as unknown as SourceObject),
      getDerivative: vi.fn(async () => null),
      listVerificationEvents: vi.fn(async () => [])
    };

    const referenceAssetRepo: Partial<ReferenceAssetRepository> = {
      findByIds: vi.fn(async (cId, ids) =>
        ids.includes("ref-123" as ReferenceAssetId)
          ? [
              {
                id: "ref-123" as ReferenceAssetId,
                clientId: cId,
                role: "product"
              } as unknown as ReferenceAsset
            ]
          : []
      )
    };

    const uow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          productEvidence: productEvidenceRepo as ProductEvidenceRepositoryPort,
          evidenceAsset: evidenceAssetRepo as EvidenceAssetRepositoryPort,
          referenceAssets: referenceAssetRepo as ReferenceAssetRepository
        } as unknown as UnitOfWorkContext)
      )
    };

    const registerUseCase = {
      execute: vi.fn(
        async () => ({}) as unknown as ReturnType<RegisterEvidenceAssetUseCase["execute"]>
      )
    } as unknown as RegisterEvidenceAssetUseCase;

    const linkDerivativeUseCase = {
      execute: vi.fn(
        async () => ({}) as unknown as ReturnType<LinkExistingDerivativeUseCase["execute"]>
      )
    } as unknown as LinkExistingDerivativeUseCase;

    const recordVerificationUseCase = {
      execute: vi.fn(
        async () => ({}) as unknown as ReturnType<RecordEvidenceVerificationEventUseCase["execute"]>
      )
    } as unknown as RecordEvidenceVerificationEventUseCase;

    const reviewerAuth = {
      assertCanReviewCoaReport: vi.fn(),
      assertCanReviewClaim: vi.fn(),
      assertCanVerifyEvidence: vi.fn(async (_c, actorId) => {
        if (actorId === "unauthorized") {
          throw new AccessDeniedError("Unauthorized verifier");
        }
      })
    };

    const mediaDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi.fn(async () => "https://storage.test/presigned-url")
    };

    const objectStorage: Partial<ObjectStoragePort> = {
      headObject: vi.fn(async () => ({
        bucket: BUCKETS.EVIDENCE,
        key: `clients/${clientId}/evidence/originals/test-key`,
        contentLength: 5000,
        lastModified: new Date(),
        eTag: "test"
      })),
      getObject: vi.fn(async () => ({
        bucket: BUCKETS.EVIDENCE,
        key: `clients/${clientId}/evidence/originals/test-key`,
        body: new Uint8Array([1, 2, 3])
      }))
    };

    return {
      uow,
      registerUseCase,
      linkDerivativeUseCase,
      recordVerificationUseCase,
      reviewerAuth,
      mediaDelivery,
      objectStorage
    };
  };

  it("throws NotFoundError when route batch does not exist", async () => {
    const deps = createDeps();
    const useCases = new EvidenceAssetUseCases(
      deps.uow,
      deps.registerUseCase,
      deps.linkDerivativeUseCase,
      deps.recordVerificationUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.getEvidenceRevision(clientId, otherBatchId, evidenceId, 1)
    ).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when target evidence revision is not linked to route batch", async () => {
    const deps = createDeps();
    const useCases = new EvidenceAssetUseCases(
      deps.uow,
      deps.registerUseCase,
      deps.linkDerivativeUseCase,
      deps.recordVerificationUseCase,
      deps.reviewerAuth
    );

    // revision 2 is not linked
    await expect(useCases.getEvidenceRevision(clientId, batchId, evidenceId, 2)).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws AccessDeniedError when verifier actor is unauthorized", async () => {
    const deps = createDeps();
    const useCases = new EvidenceAssetUseCases(
      deps.uow,
      deps.registerUseCase,
      deps.linkDerivativeUseCase,
      deps.recordVerificationUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.recordVerificationEvent(clientId, batchId, {
        clientId,
        evidenceId,
        evidenceRevision: 1,
        outcome: "verified",
        verificationKind: "independent_third_party_corroboration",
        factScope: "lab_identity",
        method: "test",
        reason: "test",
        actorId: "unauthorized"
      })
    ).rejects.toThrow(AccessDeniedError);
  });

  it("delivers presigned media url when source is available and linked to batch", async () => {
    const deps = createDeps();
    const useCases = new EvidenceAssetUseCases(
      deps.uow,
      deps.registerUseCase,
      deps.linkDerivativeUseCase,
      deps.recordVerificationUseCase,
      deps.reviewerAuth,
      deps.mediaDelivery,
      deps.objectStorage as unknown as ObjectStoragePort
    );

    const delivery = await useCases.deliverMedia(clientId, batchId, evidenceId, 1);
    expect(delivery.url).toBe("https://storage.test/presigned-url");
    expect(delivery.evidenceRevision).toBe(1);
    expect(deps.mediaDelivery.generatePresignedReadUrl).toHaveBeenCalled();
  });

  it("throws NotFoundError when superseding an evidence asset whose current revision is not linked to batch", async () => {
    const deps = createDeps();
    const useCases = new EvidenceAssetUseCases(
      deps.uow,
      deps.registerUseCase,
      deps.linkDerivativeUseCase,
      deps.recordVerificationUseCase,
      deps.reviewerAuth
    );

    const foreignEvidenceId = createEvidenceId("99999999-9999-4999-8999-999999999999");
    await expect(
      useCases.registerEvidenceAsset(clientId, batchId, {
        clientId,
        batchId,
        actorId: "operator",
        registrationIntent: "supersede",
        targetEvidenceId: foreignEvidenceId,
        expectedEvidenceVersion: 1,
        sourceClass: "photo",
        declaredMimeType: "image/jpeg",
        assertionText: "superseding",
        purpose: "macro_hero_photo",
        acquisitionMethod: "direct_upload",
        body: Buffer.from("test")
      })
    ).rejects.toThrow(NotFoundError);
  });

  it("succeeds and delegates when superseding an evidence asset whose current revision is linked to batch", async () => {
    const deps = createDeps();
    const useCases = new EvidenceAssetUseCases(
      deps.uow,
      deps.registerUseCase,
      deps.linkDerivativeUseCase,
      deps.recordVerificationUseCase,
      deps.reviewerAuth
    );

    const result = await useCases.registerEvidenceAsset(clientId, batchId, {
      clientId,
      batchId,
      actorId: "operator",
      registrationIntent: "supersede",
      targetEvidenceId: evidenceId,
      expectedEvidenceVersion: 1,
      sourceClass: "photo",
      declaredMimeType: "image/jpeg",
      assertionText: "superseding",
      purpose: "macro_hero_photo",
      acquisitionMethod: "direct_upload",
      body: Buffer.from("test")
    });

    expect(result).toBeDefined();
    expect(deps.registerUseCase.execute).toHaveBeenCalled();
  });
});
