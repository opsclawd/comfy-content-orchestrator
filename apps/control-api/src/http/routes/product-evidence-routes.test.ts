import { describe, expect, it, vi } from "vitest";
import {
  createBatchId,
  createClaimId,
  createClientId,
  createCoaReportId,
  createEvidenceId,
  createSkuId
} from "@cco/domain";
import type {
  BatchEvidenceDossier,
  BatchEvidenceLinkContract,
  BatchFactsRevisionResponse,
  ClaimDecisionEventContract,
  CoaReportContract,
  CoaReportRevisionContract,
  CoaReviewEventContract,
  EvidenceAssetContract,
  EvidenceDerivativeContract,
  EvidenceRevisionContract,
  ProductBatchResponse,
  ProductClaimContract,
  ProductClaimRevisionContract,
  ProductSkuResponse,
  RegisterEvidenceAssetResponse
} from "@cco/contracts";
import { createControlApiApp } from "../app.js";
import type { ControlApiContainer, ControlApiDependencies, ControlApiUseCases } from "../types.js";

const clientId1 = createClientId("11111111-1111-4111-8111-111111111111");
const clientId2 = createClientId("22222222-2222-4222-8222-222222222222");
const skuId = createSkuId("33333333-3333-4333-8333-333333333333");
const batchId = createBatchId("44444444-4444-4444-8444-444444444444");
const evidenceId = createEvidenceId("55555555-5555-4555-8555-555555555555");
const coaReportId = createCoaReportId("66666666-6666-4666-8666-666666666666");
const claimId = createClaimId("77777777-7777-4777-8777-777777777777");

const mockSku: ProductSkuResponse = {
  clientId: clientId1,
  skuId,
  canonicalSku: "SKU-PREMIUM-001",
  displayName: "Premium Widget",
  version: 1,
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
  archivedAt: null
};

const mockBatch: ProductBatchResponse = {
  clientId: clientId1,
  batchId,
  skuId,
  lotIdentifier: "LOT-2026-001",
  displayName: "Batch 001",
  version: 1,
  currentFactsRevision: 1,
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
  archivedAt: null
};

const mockFactsRevision: BatchFactsRevisionResponse = {
  clientId: clientId1,
  batchId,
  revision: 2,
  originKind: "own_production",
  producerIdentityAsClaimed: "Acme Farm",
  productionStartDate: "2026-10-01",
  productionEndDate: "2026-10-15",
  originEvidenceId: null,
  originEvidenceRevision: null,
  assertedBy: "user-1",
  assertedAt: "2026-10-21T12:00:00.000Z",
  supersedesRevision: 1
};

const mockEvidenceAsset: EvidenceAssetContract = {
  evidenceId,
  clientId: clientId1,
  currentRevision: 1,
  version: 1,
  createdAt: "2026-10-21T12:00:00.000Z",
  archivedAt: null
};

const mockEvidenceRevision: EvidenceRevisionContract = {
  evidenceId,
  clientId: clientId1,
  revision: 1,
  sourceObjectId: "88888888-8888-4888-8888-888888888888",
  sourceClass: "photo",
  acquisitionMethod: "direct_upload",
  submittedBy: "uploader-1",
  submittedAt: "2026-10-21T12:00:00.000Z",
  assertionText: "Front label macro capture",
  reportedCaptureDate: "2026-10-20",
  reportedCaptureTimestamp: "2026-10-20T12:00:00.000Z",
  reportedCapturePrecision: "second",
  captureContext: "Laboratory lightbox",
  rightsStatus: "granted",
  consentStatus: "granted",
  rightsAttribution: "Acme QA",
  rightsDocumentLocator: null,
  supersedesRevision: null
};

const mockBatchEvidenceLink: BatchEvidenceLinkContract = {
  clientId: clientId1,
  batchId,
  evidenceId,
  evidenceRevision: 1,
  purpose: "macro_hero_photo",
  assertedBy: "user-1",
  assertedAt: "2026-10-21T12:00:00.000Z"
};

const mockDerivative: EvidenceDerivativeContract = {
  clientId: clientId1,
  derivativeId: "99999999-9999-4999-8999-999999999999",
  evidenceId,
  evidenceRevision: 1,
  referenceAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  derivativeSha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  transformDescription: "Cleaned crop 1024x1024",
  transformToolVersion: "v1.0.0",
  createdBy: "system",
  createdAt: "2026-10-21T12:00:00.000Z"
};

const mockRegisterResult: RegisterEvidenceAssetResponse = {
  evidenceAsset: mockEvidenceAsset,
  evidenceRevision: mockEvidenceRevision,
  sourceObject: {
    clientId: clientId1,
    sourceObjectId: "88888888-8888-4888-8888-888888888888",
    originalSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    detectedMimeType: "image/jpeg",
    byteLength: 5000,
    uploadedAt: "2026-10-21T12:00:00.000Z",
    uploaderId: "uploader-1",
    accessClass: "restricted_original",
    retentionClass: "source_evidence_archive",
    retentionPolicyVersion: "policy-v1",
    availability: "available",
    storageBucket: "internal-secret-bucket",
    storageObjectKey: "internal-secret-key",
    storageVersionId: "internal-ver"
  },
  batchEvidenceLink: mockBatchEvidenceLink,
  derivative: null
};

const mockCoaReport: CoaReportContract = {
  clientId: clientId1,
  reportId: coaReportId,
  batchId,
  evidenceId,
  currentRevision: 1,
  version: 1,
  createdAt: "2026-10-21T12:00:00.000Z",
  archivedAt: null
};

const mockCoaRevision: CoaReportRevisionContract = {
  clientId: clientId1,
  reportId: coaReportId,
  revision: 1,
  batchId,
  evidenceId,
  evidenceRevision: 1,
  completenessStatus: "complete",
  reportIdentifierAsClaimed: "COA-2026-001",
  reportDate: "2026-10-20",
  labNameAsClaimed: "Analytical Labs Inc",
  sampleIdentifierAsClaimed: "SAMP-001",
  scopeKind: "attributed_lot",
  scopeDescription: "Full compliance panel",
  sampleDate: "2026-10-18",
  samplingMethodDescription: "Composite sample",
  sampleToBatchAssociationAttestation: "Direct custody transfer",
  sampleToBatchAssociationConfirmed: true,
  verifiedLabIdentityEventId: null,
  assertedBy: "user-1",
  assertedAt: "2026-10-21T12:00:00.000Z",
  supersedesRevision: null,
  measurements: []
};

const mockCoaReviewEvent: CoaReviewEventContract = {
  eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  clientId: clientId1,
  reportId: coaReportId,
  reportRevision: 1,
  decision: "approved",
  reason: "CoA verified against lab records",
  actorId: "reviewer-alice",
  occurredAt: "2026-10-21T12:30:00.000Z",
  assessedScope: "attributed_lot"
};

const mockClaim: ProductClaimContract = {
  claimId,
  clientId: clientId1,
  skuId,
  batchId,
  currentRevision: 1,
  state: "draft",
  version: 1,
  invalidationCause: null,
  invalidationSourceRef: null,
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
  archivedAt: null
};

const mockClaimRevision: ProductClaimRevisionContract = {
  clientId: clientId1,
  claimId,
  revision: 1,
  batchId,
  canonicalKind: "factual_lot_identifier",
  proofCategory: "production_record_backed",
  parameters: {
    kind: "factual_lot_identifier",
    lotIdentifier: "LOT-2026-001"
  },
  displayWording: "Batch LOT-2026-001",
  policyVersion: "policy-v1",
  assertedBy: "user-1",
  assertedAt: "2026-10-21T12:00:00.000Z",
  supersedesRevision: null
};

const mockClaimDecisionEvent: ClaimDecisionEventContract = {
  eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  clientId: clientId1,
  claimId,
  claimRevision: 1,
  decision: "approve",
  reason: "Evidence verified",
  actorId: "reviewer-alice",
  occurredAt: "2026-10-21T12:25:00.000Z",
  policyVersion: "policy-v1"
};

const mockDossier: BatchEvidenceDossier = {
  schemaVersion: "1.0.0",
  clientId: clientId1,
  sku: mockSku,
  batch: mockBatch,
  factsHistory: [mockFactsRevision],
  evidenceLinks: [mockBatchEvidenceLink],
  evidence: [
    {
      asset: mockEvidenceAsset,
      currentRevision: mockEvidenceRevision,
      revisions: [mockEvidenceRevision],
      sourceObjects: [
        {
          sourceObjectId: "88888888-8888-4888-8888-888888888888",
          originalSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          detectedMimeType: "image/jpeg",
          byteLength: 5000,
          uploadedAt: "2026-10-21T12:00:00.000Z",
          uploaderId: "uploader-1",
          accessClass: "restricted_original",
          retentionClass: "source_evidence_archive",
          retentionPolicyVersion: "policy-v1",
          availability: "available"
        }
      ],
      derivatives: [mockDerivative],
      verificationEvents: []
    }
  ],
  coaReports: [
    {
      report: mockCoaReport,
      currentRevision: mockCoaRevision,
      revisions: [mockCoaRevision],
      reviewEvents: [mockCoaReviewEvent]
    }
  ],
  claims: [
    {
      claim: mockClaim,
      currentRevision: mockClaimRevision,
      revisions: [mockClaimRevision],
      links: [],
      decisionEvents: [],
      resolution: {
        claim: mockClaim,
        revision: mockClaimRevision,
        supportEligible: true,
        canRequestReview: false,
        evidenceLinkApproved: true,
        provenanceCategory: "lab_reported",
        displayWordingStatus: "manual_review_approved",
        blockReasons: [],
        links: [],
        reviewEvents: [],
        dependencyFingerprint: "fp-1"
      }
    }
  ],
  resolvedAt: "2026-10-21T13:00:00.000Z"
};

function createTestApp(options?: {
  authenticatedClientId?: string | null;
  reviewerId?: string;
  overrides?: {
    useCases?: Partial<ControlApiContainer["useCases"]>;
    queries?: Partial<ControlApiContainer["queries"]>;
  };
}) {
  const createProductSku = { execute: vi.fn(async () => mockSku) };
  const getProductSku = { execute: vi.fn(async (_cId, id) => (id === skuId ? mockSku : null)) };
  const listProductSkus = { execute: vi.fn(async () => [mockSku]) };
  const updateProductSkuMetadata = {
    execute: vi.fn(async () => ({ sku: { ...mockSku, version: 2 }, isIdempotentReplay: false }))
  };
  const archiveProductSku = {
    execute: vi.fn(async () => ({
      sku: { ...mockSku, archivedAt: "2026-10-21T13:00:00.000Z" },
      isIdempotentReplay: false
    }))
  };

  const createProductBatch = {
    execute: vi.fn(async () => ({
      batch: mockBatch,
      initialFacts: mockFactsRevision,
      isIdempotentReplay: false
    }))
  };
  const getProductBatch = {
    execute: vi.fn(async (_cId, id) => (id === batchId ? mockBatch : null))
  };
  const listProductBatches = { execute: vi.fn(async () => [mockBatch]) };
  const updateProductBatchMetadata = {
    execute: vi.fn(async () => ({ batch: { ...mockBatch, version: 2 }, isIdempotentReplay: false }))
  };
  const archiveProductBatch = {
    execute: vi.fn(async () => ({
      batch: { ...mockBatch, archivedAt: "2026-10-21T13:00:00.000Z" },
      isIdempotentReplay: false
    }))
  };
  const appendBatchFacts = {
    execute: vi.fn(async () => mockFactsRevision)
  };
  const getBatchFactsHistory = {
    execute: vi.fn(async () => [mockFactsRevision])
  };

  const evidenceAsset = {
    registerEvidenceAsset: vi.fn(async () => mockRegisterResult),
    linkDerivative: vi.fn(async () => mockDerivative),
    recordVerificationEvent: vi.fn(async () => ({
      clientId: clientId1,
      eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      evidenceId,
      evidenceRevision: 1,
      outcome: "verified" as const,
      verificationKind: "manual_inspector" as const,
      actorId: options?.reviewerId ?? "alice",
      evidenceHashAtVerification:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      notes: "Visual check passed",
      withdrawalReason: null,
      withdrawalEventId: null,
      createdAt: "2026-10-21T12:15:00.000Z"
    })),
    listBatchEvidence: vi.fn(async () => ({
      evidence: [
        {
          evidenceId: mockEvidenceAsset.evidenceId,
          currentRevision: mockEvidenceAsset.currentRevision,
          version: mockEvidenceAsset.version,
          createdAt: mockEvidenceAsset.createdAt,
          archivedAt: mockEvidenceAsset.archivedAt,
          linkedRevisions: [1]
        }
      ]
    })),
    getEvidenceAssetHead: vi.fn(async () => ({
      evidenceId: mockEvidenceAsset.evidenceId,
      currentRevision: mockEvidenceAsset.currentRevision,
      version: mockEvidenceAsset.version,
      createdAt: mockEvidenceAsset.createdAt,
      archivedAt: mockEvidenceAsset.archivedAt,
      linkedRevisions: [1]
    })),
    getEvidenceRevision: vi.fn(async () => mockEvidenceRevision),
    getDerivative: vi.fn(async () => mockDerivative),
    listVerificationEvents: vi.fn(async () => ({ events: [] })),
    deliverMedia: vi.fn(async () => ({
      clientId: clientId1,
      batchId,
      evidenceId,
      evidenceRevision: 1,
      sourceObjectId: "88888888-8888-4888-8888-888888888888",
      originalSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      detectedMimeType: "image/jpeg",
      byteLength: 5000,
      url: "https://signed.storage.cco.local/presigned-media-read",
      expiresAt: "2026-10-21T12:05:00.000Z"
    }))
  };

  const coaReport = {
    createCoaReport: vi.fn(async () => ({
      report: mockCoaReport,
      currentRevision: mockCoaRevision
    })),
    listReportsForBatch: vi.fn(async () => ({ reports: [mockCoaReport] })),
    getReportById: vi.fn(async () => ({ report: mockCoaReport, currentRevision: mockCoaRevision })),
    getReportRevision: vi.fn(async () => mockCoaRevision),
    supersedeCoaReport: vi.fn(async () => ({
      report: { ...mockCoaReport, version: 2 },
      currentRevision: mockCoaRevision
    })),
    reviewCoaReport: vi.fn(async () => ({
      report: { ...mockCoaReport, version: 2 },
      decisionEvent: mockCoaReviewEvent
    })),
    archiveCoaReport: vi.fn(async () => ({
      ...mockCoaReport,
      archivedAt: "2026-10-21T13:00:00.000Z"
    }))
  };

  const claim = {
    createClaim: vi.fn(async () => ({ claim: mockClaim, revision: mockClaimRevision })),
    listClaimsForBatch: vi.fn(async () => ({ claims: [mockClaim] })),
    getClaimById: vi.fn(async () => ({
      claim: mockClaim,
      currentRevision: mockClaimRevision,
      links: [],
      events: []
    })),
    getClaimRevision: vi.fn(async () => mockClaimRevision),
    appendClaimRevision: vi.fn(async () => ({
      claim: { ...mockClaim, currentRevision: 2, version: 2 },
      revision: { ...mockClaimRevision, revision: 2 }
    })),
    linkClaimEvidence: vi.fn(async () => ({
      links: [
        {
          linkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          claimId,
          claimRevision: 1,
          evidenceId,
          evidenceRevision: 1,
          sourceDocumentId: null,
          panelId: null,
          analyteId: null,
          linkedAt: "2026-10-21T12:20:00.000Z"
        }
      ]
    })),
    reviewClaim: vi.fn(async () => ({
      claim: { ...mockClaim, state: "reviewer_approved" as const, version: 2 },
      decisionEvent: mockClaimDecisionEvent
    })),
    invalidateClaim: vi.fn(async () => ({
      claim: {
        ...mockClaim,
        state: "invalidated" as const,
        invalidationCause: "source_disputed" as const,
        version: 2
      },
      decisionEvent: {
        decisionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        claimId,
        claimRevision: 1,
        decision: "rejected" as const,
        reason: "Lab result disputed",
        decidedBy: options?.reviewerId ?? "alice",
        decidedAt: "2026-10-21T12:35:00.000Z"
      }
    }))
  };

  const resolveBatchEvidenceDossier = {
    execute: vi.fn(async () => mockDossier)
  };

  const container: ControlApiContainer = {
    dependencies: {} as unknown as ControlApiDependencies,
    useCases: {
      createProductSku,
      getProductSku,
      listProductSkus,
      updateProductSkuMetadata,
      archiveProductSku,
      createProductBatch,
      getProductBatch,
      listProductBatches,
      updateProductBatchMetadata,
      archiveProductBatch,
      appendBatchFacts,
      getBatchFactsHistory,
      evidenceAsset,
      coaReport,
      claim,
      resolveBatchEvidenceDossier,
      ...options?.overrides?.useCases
    } as unknown as ControlApiUseCases,
    queries: {
      ...options?.overrides?.queries
    }
  };

  const authenticatedClientId =
    options?.authenticatedClientId !== undefined ? options.authenticatedClientId : clientId1;

  const app = createControlApiApp(container, {
    clientContextResolver: {
      resolve: async () => authenticatedClientId
    },
    reviewerIdentityResolver: {
      resolve: async () => options?.reviewerId ?? "reviewer-alice"
    }
  });

  return {
    app,
    createProductSku,
    getProductSku,
    listProductSkus,
    updateProductSkuMetadata,
    archiveProductSku,
    createProductBatch,
    getProductBatch,
    listProductBatches,
    updateProductBatchMetadata,
    archiveProductBatch,
    appendBatchFacts,
    getBatchFactsHistory,
    evidenceAsset,
    coaReport,
    claim,
    resolveBatchEvidenceDossier
  };
}

describe("Product Evidence Routes HTTP Surface", () => {
  describe("Authentication & Tenant Scoping", () => {
    it("returns 401 when no client is authenticated", async () => {
      const { app } = createTestApp({ authenticatedClientId: null });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/product-skus`
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 403 when authenticated client does not match URL clientId", async () => {
      const { app } = createTestApp({ authenticatedClientId: clientId2 });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/product-skus`
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error).toBe("FORBIDDEN");
    });
  });

  describe("Product SKU Routes", () => {
    it("POST /product-skus creates SKU and returns 201", async () => {
      const { app, createProductSku } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/product-skus`,
        payload: {
          actionId: "a0000000-0000-4000-8000-000000000001",
          canonicalSku: "SKU-PREMIUM-001",
          displayName: "Premium Widget"
        }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.skuId).toBe(skuId);
      expect(createProductSku.execute).toHaveBeenCalled();
    });

    it("GET /product-skus lists SKUs and returns 200", async () => {
      const { app, listProductSkus } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/product-skus`
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.skus).toHaveLength(1);
      expect(listProductSkus.execute).toHaveBeenCalledWith(clientId1, expect.anything());
    });

    it("GET /product-skus/:skuId returns 200 when found", async () => {
      const { app, getProductSku } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/product-skus/${skuId}`
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().skuId).toBe(skuId);
      expect(getProductSku.execute).toHaveBeenCalledWith(clientId1, skuId);
    });

    it("GET /product-skus/:skuId returns 404 when not found", async () => {
      const { app } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/product-skus/99999999-9999-4999-8999-999999999999`
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("NOT_FOUND");
    });

    it("PATCH /product-skus/:skuId updates metadata and returns 200", async () => {
      const { app, updateProductSkuMetadata } = createTestApp();

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/clients/${clientId1}/product-skus/${skuId}`,
        payload: {
          actionId: "a0000000-0000-4000-8000-000000000002",
          expectedVersion: 1,
          displayName: "Updated Widget"
        }
      });

      expect(res.statusCode).toBe(200);
      expect(updateProductSkuMetadata.execute).toHaveBeenCalled();
    });

    it("POST /product-skus/:skuId/archive archives SKU and returns 200", async () => {
      const { app, archiveProductSku } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/product-skus/${skuId}/archive`,
        payload: {
          actionId: "a0000000-0000-4000-8000-000000000003",
          expectedVersion: 1
        }
      });

      expect(res.statusCode).toBe(200);
      expect(archiveProductSku.execute).toHaveBeenCalled();
    });
  });

  describe("Product Batch & Facts Routes", () => {
    it("POST /batches creates Batch and returns 201", async () => {
      const { app, createProductBatch } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches`,
        payload: {
          actionId: "b0000000-0000-4000-8000-000000000001",
          skuId,
          lotIdentifier: "LOT-2026-001",
          displayName: "Batch 001"
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().batch.batchId).toBe(batchId);
      expect(createProductBatch.execute).toHaveBeenCalled();
    });

    it("GET /batches lists Batches and returns 200", async () => {
      const { app, listProductBatches } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches`
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().batches).toHaveLength(1);
      expect(listProductBatches.execute).toHaveBeenCalledWith(clientId1, expect.anything());
    });

    it("POST /batches/:batchId/facts appends facts revision and returns 201", async () => {
      const { app, appendBatchFacts } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/facts`,
        payload: {
          actionId: "b0000000-0000-4000-8000-000000000002",
          expectedVersion: 1,
          originKind: "own_production",
          producerIdentityAsClaimed: "Acme Farm",
          productionStartDate: "2026-10-01",
          productionEndDate: "2026-10-15"
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().revision).toBe(2);
      expect(appendBatchFacts.execute).toHaveBeenCalled();
    });

    it("GET /batches/:batchId/facts returns facts history with 200", async () => {
      const { app, getBatchFactsHistory } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/facts`
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().revisions).toHaveLength(1);
      expect(getBatchFactsHistory.execute).toHaveBeenCalledWith(clientId1, batchId);
    });
  });

  describe("Evidence Asset, Derivative, Verification & Media Routes", () => {
    it("POST /batches/:batchId/evidence registers reused source and returns 201 without storage keys", async () => {
      const { app, evidenceAsset } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/evidence`,
        payload: {
          actionId: "c0000000-0000-4000-8000-000000000001",
          batchId,
          purpose: "macro_hero_photo",
          sourceClass: "photo",
          acquisitionMethod: "direct_upload",
          assertionText: "Front label macro capture",
          registrationIntent: "initial_assertion",
          reusedSourceObjectId: "88888888-8888-4888-8888-888888888888"
        }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.evidenceAsset.evidenceId).toBe(evidenceId);
      expect(body.sourceObject.originalSha256).toBeDefined();
      // Verify storage bucket / key are stripped
      expect(body.sourceObject.storageBucket).toBeUndefined();
      expect(body.sourceObject.storageObjectKey).toBeUndefined();
      expect(evidenceAsset.registerEvidenceAsset).toHaveBeenCalled();
    });

    it("GET /batches/:batchId/evidence lists batch evidence summaries", async () => {
      const { app, evidenceAsset } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/evidence`
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().evidence).toHaveLength(1);
      expect(evidenceAsset.listBatchEvidence).toHaveBeenCalledWith(clientId1, batchId);
    });

    it("POST /batches/:batchId/evidence/:evidenceId/revisions/:revision/derivative links derivative", async () => {
      const { app, evidenceAsset } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/evidence/${evidenceId}/revisions/1/derivative`,
        payload: {
          actionId: "d0000000-0000-4000-8000-000000000001",
          referenceAssetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          derivativeSha256: "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
          transformDescription: "Cleaned crop 1024x1024",
          transformToolVersion: "v1.0.0"
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().derivativeId).toBe(mockDerivative.derivativeId);
      expect(evidenceAsset.linkDerivative).toHaveBeenCalled();
    });

    it("POST /batches/:batchId/evidence/:evidenceId/revisions/:revision/verification-events records event", async () => {
      const { app, evidenceAsset } = createTestApp({ reviewerId: "inspector-bob" });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/evidence/${evidenceId}/revisions/1/verification-events`,
        payload: {
          actionId: "e0000000-0000-4000-8000-000000000001",
          outcome: "verified",
          verificationKind: "human_internal_review",
          factScope: "provenance_metadata",
          method: "Visual inspection against physical sample",
          reason: "Visual check passed"
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().outcome).toBe("verified");
      expect(evidenceAsset.recordVerificationEvent).toHaveBeenCalled();
    });

    it("GET /batches/:batchId/evidence/:evidenceId/revisions/:revision/media delivers signed short-lived URL", async () => {
      const { app, evidenceAsset } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/evidence/${evidenceId}/revisions/1/media`
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.url).toContain("https://");
      expect(body.expiresAt).toBeDefined();
      expect(evidenceAsset.deliverMedia).toHaveBeenCalledWith(clientId1, batchId, evidenceId, 1);
    });

    it("rejects non-integer revision with 400 ProductValidationError", async () => {
      const { app } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/evidence/${evidenceId}/revisions/abc/media`
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("VALIDATION_ERROR");
    });
  });

  describe("CoA Report Routes", () => {
    it("POST /batches/:batchId/coa-reports creates report and returns 201", async () => {
      const { app, coaReport } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/coa-reports`,
        payload: {
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73008",
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "COA-2026-001",
          reportDate: "2026-10-20",
          labNameAsClaimed: "Analytical Labs Inc"
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().report.reportId).toBe(coaReportId);
      expect(coaReport.createCoaReport).toHaveBeenCalled();
    });

    it("POST /batches/:batchId/coa-reports/:reportId/review reviews report with actor and returns 200", async () => {
      const { app, coaReport } = createTestApp({ reviewerId: "lead-chemist" });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/coa-reports/${coaReportId}/review`,
        payload: {
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73009",
          expectedVersion: 1,
          decision: "approved",
          reason: "CoA verified against lab records",
          assessedScope: "attributed_lot"
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().report.reportId).toBe(coaReportId);
      expect(coaReport.reviewCoaReport).toHaveBeenCalled();
    });

    it("GET /batches/:batchId/coa-reports lists reports with 200", async () => {
      const { app, coaReport } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/coa-reports`
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().reports).toHaveLength(1);
      expect(coaReport.listReportsForBatch).toHaveBeenCalledWith(clientId1, batchId);
    });
  });

  describe("Product Claim Routes", () => {
    it("POST /batches/:batchId/claims creates claim and returns 201", async () => {
      const { app, claim } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/claims`,
        payload: {
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73010",
          batchId,
          canonicalKind: "factual_lot_identifier",
          proofCategory: "production_record_backed",
          parameters: {
            kind: "factual_lot_identifier",
            lotIdentifier: "LOT-2026-001"
          },
          displayWording: "Batch LOT-2026-001"
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().claimId).toBe(claimId);
      expect(claim.createClaim).toHaveBeenCalled();
    });

    it("GET /batches/:batchId/claims/:claimId returns 200 with full ProductClaimDetailResponse", async () => {
      const { app, claim } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/claims/${claimId}`
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.claim.claimId).toBe(claimId);
      expect(body.currentRevision.claimId).toBe(claimId);
      expect(Array.isArray(body.links)).toBe(true);
      expect(Array.isArray(body.events)).toBe(true);
      expect(claim.getClaimById).toHaveBeenCalledWith(clientId1, batchId, claimId);
    });

    it("POST /batches/:batchId/claims/:claimId/evidence-links links evidence and returns 200", async () => {
      const { app, claim } = createTestApp();

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/claims/${claimId}/evidence-links`,
        payload: {
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73011",
          expectedVersion: 1,
          claimRevision: 1,
          reason: "Linking lot verification image",
          links: [
            {
              evidenceId,
              evidenceRevision: 1,
              sourceObjectId: "88888888-8888-4888-8888-888888888888",
              sourceSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              supportRole: "corroborating_record"
            }
          ]
        }
      });

      expect(res.statusCode).toBe(200);
      expect(claim.linkClaimEvidence).toHaveBeenCalled();
    });

    it("POST /batches/:batchId/claims/:claimId/review reviews claim and returns 200", async () => {
      const { app, claim } = createTestApp({ reviewerId: "compliance-officer" });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/claims/${claimId}/review`,
        payload: {
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73012",
          expectedVersion: 1,
          claimRevision: 1,
          decision: "approve",
          reason: "Evidence verified"
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().claim.state).toBe("reviewer_approved");
      expect(claim.reviewClaim).toHaveBeenCalled();
    });

    it("POST /batches/:batchId/claims/:claimId/invalidate invalidates claim and returns 200", async () => {
      const { app, claim } = createTestApp({ reviewerId: "compliance-officer" });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/claims/${claimId}/invalidate`,
        payload: {
          actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73013",
          expectedVersion: 1,
          claimRevision: 1,
          invalidationCause: "source_disputed",
          reason: "Lab result disputed"
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().claim.state).toBe("invalidated");
      expect(res.json().claim.invalidationCause).toBe("source_disputed");
      expect(claim.invalidateClaim).toHaveBeenCalled();
    });
  });

  describe("Batch Evidence Dossier Query Route", () => {
    it("GET /batches/:batchId/dossier returns complete explicit provenance dossier with 200", async () => {
      const { app, resolveBatchEvidenceDossier } = createTestApp();

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/clients/${clientId1}/batches/${batchId}/dossier`
      });

      expect(res.statusCode).toBe(200);
      const dossier = res.json();
      expect(dossier.schemaVersion).toBe("1.0.0");
      expect(dossier.clientId).toBe(clientId1);
      expect(dossier.sku.skuId).toBe(skuId);
      expect(dossier.batch.batchId).toBe(batchId);
      expect(dossier.evidence).toHaveLength(1);
      expect(dossier.coaReports).toHaveLength(1);
      expect(dossier.claims).toHaveLength(1);
      expect(resolveBatchEvidenceDossier.execute).toHaveBeenCalledWith({
        clientId: clientId1,
        batchId
      });
    });
  });
});
