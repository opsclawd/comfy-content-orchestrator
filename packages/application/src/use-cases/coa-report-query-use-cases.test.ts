import { describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClientId,
  createCoaReportId,
  createEvidenceId,
  createSkuId,
  CrossBatchSourceError,
  NotFoundError,
  type BatchEvidenceLink
} from "@cco/domain";
import type {
  CoaReportRepositoryPort,
  EvidenceAssetRepositoryPort,
  ProductEvidenceRepositoryPort,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { CoaReportUseCases } from "./coa-report-query-use-cases.js";
import type { CreateCoaReportUseCase } from "./create-coa-report.js";
import type { SupersedeCoaReportUseCase } from "./supersede-coa-report.js";
import type { ReviewCoaReportUseCase } from "./review-coa-report.js";
import type { ArchiveCoaReportUseCase } from "./archive-coa-report.js";

describe("CoaReportUseCases", () => {
  const clientId = createClientId("11111111-1111-4111-8111-111111111111");
  const batchId = createBatchId("22222222-2222-4222-8222-222222222222");
  const otherBatchId = createBatchId("33333333-3333-4333-8333-333333333333");
  const reportId = createCoaReportId("44444444-4444-4444-8444-444444444444");
  const otherReportId = createCoaReportId("55555555-5555-4555-8555-555555555555");
  const evidenceId = createEvidenceId("66666666-6666-4666-8666-666666666666");

  const mockBatch = {
    clientId,
    batchId,
    skuId: createSkuId("77777777-7777-4777-8777-777777777777"),
    lotIdentifier: "LOT-001",
    displayName: "Lot 001",
    version: 1,
    currentFactsRevision: 1,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockReportInBatch = {
    clientId,
    reportId,
    batchId,
    evidenceId,
    currentRevision: 1,
    version: 1,
    createdAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockReportInOtherBatch = {
    clientId,
    reportId: otherReportId,
    batchId: otherBatchId,
    evidenceId,
    currentRevision: 1,
    version: 1,
    createdAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockRevision = {
    clientId,
    reportId,
    revision: 1,
    batchId,
    evidenceId,
    evidenceRevision: 1,
    completenessStatus: "complete" as const,
    reportIdentifierAsClaimed: "REP-1",
    reportDate: "2026-01-20",
    labNameAsClaimed: "Lab",
    sampleIdentifierAsClaimed: "SMP-1",
    scopeKind: "attributed_lot" as const,
    scopeDescription: "Scope",
    sampleDate: null,
    samplingMethodDescription: "Composite",
    sampleToBatchAssociationAttestation: "Certified",
    sampleToBatchAssociationConfirmed: true,
    verifiedLabIdentityEventId: null,
    assertedBy: "user-1",
    assertedAt: "2026-10-21T12:00:00.000Z",
    supersedesRevision: null,
    measurements: []
  };

  const createDeps = () => {
    const productEvidenceRepo: Partial<ProductEvidenceRepositoryPort> = {
      getBatchById: vi.fn(async (_cId, bId) => (bId === batchId ? mockBatch : null))
    };

    const coaRepo: Partial<CoaReportRepositoryPort> = {
      getReportById: vi.fn(async (_cId, rId) => {
        if (rId === reportId) return mockReportInBatch;
        if (rId === otherReportId) return mockReportInOtherBatch;
        return null;
      }),
      getReportRevision: vi.fn(async (_cId, rId, rev) =>
        rId === reportId && rev === 1
          ? {
              revision: mockRevision,
              measurements: [],
              reviewEvent: null
            }
          : null
      ),
      listReportsForBatch: vi.fn(async () => [mockReportInBatch])
    };

    const evidenceAssetRepo: Partial<EvidenceAssetRepositoryPort> = {
      getBatchEvidenceLink: vi.fn(async (_cId, bId, eId, rev) =>
        bId === batchId && eId === evidenceId && rev === 1
          ? ({} as unknown as BatchEvidenceLink)
          : null
      )
    };

    const uow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          productEvidence: productEvidenceRepo as ProductEvidenceRepositoryPort,
          coaReports: coaRepo as CoaReportRepositoryPort,
          evidenceAsset: evidenceAssetRepo as EvidenceAssetRepositoryPort
        } as unknown as UnitOfWorkContext)
      )
    };

    const createReportUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<CreateCoaReportUseCase["execute"]>)
    } as unknown as CreateCoaReportUseCase;
    const supersedeReportUseCase = {
      execute: vi.fn(
        async () => ({}) as unknown as ReturnType<SupersedeCoaReportUseCase["execute"]>
      )
    } as unknown as SupersedeCoaReportUseCase;
    const reviewReportUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<ReviewCoaReportUseCase["execute"]>)
    } as unknown as ReviewCoaReportUseCase;
    const archiveReportUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<ArchiveCoaReportUseCase["execute"]>)
    } as unknown as ArchiveCoaReportUseCase;

    const reviewerAuth = {
      assertCanReviewCoaReport: vi.fn(async (_c, actorId) => {
        if (actorId === "unauthorized") {
          throw new AccessDeniedError("Unauthorized CoA reviewer");
        }
      }),
      assertCanReviewClaim: vi.fn(),
      assertCanVerifyEvidence: vi.fn()
    };

    return {
      uow,
      createReportUseCase,
      supersedeReportUseCase,
      reviewReportUseCase,
      archiveReportUseCase,
      reviewerAuth
    };
  };

  it("throws NotFoundError when route batch does not exist", async () => {
    const deps = createDeps();
    const useCases = new CoaReportUseCases(
      deps.uow,
      deps.createReportUseCase,
      deps.supersedeReportUseCase,
      deps.reviewReportUseCase,
      deps.archiveReportUseCase,
      deps.reviewerAuth
    );

    await expect(useCases.getReportById(clientId, otherBatchId, reportId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws NotFoundError when report belongs to another batch (prevent cross-lot leak)", async () => {
    const deps = createDeps();
    const useCases = new CoaReportUseCases(
      deps.uow,
      deps.createReportUseCase,
      deps.supersedeReportUseCase,
      deps.reviewReportUseCase,
      deps.archiveReportUseCase,
      deps.reviewerAuth
    );

    // otherReportId exists for this client, but belongs to otherBatchId! Under batchId it must return 404!
    await expect(useCases.getReportById(clientId, batchId, otherReportId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws CrossBatchSourceError when creating a report with evidence from another batch", async () => {
    const deps = createDeps();
    const useCases = new CoaReportUseCases(
      deps.uow,
      deps.createReportUseCase,
      deps.supersedeReportUseCase,
      deps.reviewReportUseCase,
      deps.archiveReportUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.createCoaReport(clientId, batchId, {
        actionId: createActionId("018f6f00-0000-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-21T12:00:00.000Z",
        payload: {
          batchId,
          evidenceId: createEvidenceId("018f6f00-0000-7000-8000-000000000099"),
          evidenceRevision: 1,
          completenessStatus: "complete",
          measurements: []
        }
      })
    ).rejects.toThrow(CrossBatchSourceError);
  });

  it("throws AccessDeniedError when reviewer is not authorized to review CoA", async () => {
    const deps = createDeps();
    const useCases = new CoaReportUseCases(
      deps.uow,
      deps.createReportUseCase,
      deps.supersedeReportUseCase,
      deps.reviewReportUseCase,
      deps.archiveReportUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.reviewCoaReport(clientId, batchId, reportId, {
        actionId: createActionId("018f6f00-0000-7000-8000-000000000002"),
        clientId,
        actorId: "unauthorized",
        timestamp: "2026-10-21T12:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1,
          decision: "approved",
          reason: "Looks good",
          assessedScope: "attributed_lot"
        }
      })
    ).rejects.toThrow(AccessDeniedError);
  });
});
