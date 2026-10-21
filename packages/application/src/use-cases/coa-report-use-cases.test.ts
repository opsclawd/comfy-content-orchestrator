import { describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClientId,
  createCoaMeasurement,
  createCoaMeasurementId,
  createCoaReport,
  createCoaReportId,
  createCoaReportRevision,
  createCoaReviewEventId,
  createEvidenceId,
  ProductValidationError,
  type ActionId,
  type BatchId
} from "@cco/domain";
import type { CreateCoaReportRequest } from "@cco/contracts";
import { AllowAllReviewerAuthorizationAdapter } from "../ports/index.js";
import type {
  CoaReportCreationResult,
  CoaReportRepositoryPort,
  CoaReportReviewResult,
  CoaReportSupersessionResult,
  CommandEnvelope,
  ReviewerAuthorizationPort,
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { CreateCoaReportUseCase } from "./create-coa-report.js";
import { SupersedeCoaReportUseCase } from "./supersede-coa-report.js";
import { ReviewCoaReportUseCase } from "./review-coa-report.js";
import { ArchiveCoaReportUseCase } from "./archive-coa-report.js";

describe("CoA Report Application Use Cases", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000002");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000003");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000004");
  const measurementId = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000005");

  function createMockUow(mockCoaRepo?: Partial<CoaReportRepositoryPort>): UnitOfWork {
    return {
      execute: async <TResult>(
        work: (ctx: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> => {
        const ctx: UnitOfWorkContext = {
          scenes: {} as unknown as SceneRepository,
          reviewEvents: {} as unknown as ReviewEventStore,
          candidates: {} as unknown as StoryboardCandidateRepository,
          coaReports: mockCoaRepo as CoaReportRepositoryPort
        };
        return work(ctx);
      }
    };
  }

  const validMeasurement = createCoaMeasurement({
    measurementId,
    clientId,
    reportId,
    reportRevision: 1,
    batchId,
    evidenceId,
    evidenceRevision: 1,
    analyte: "THCA",
    resultKind: "quantified",
    resultValue: "24.5000",
    unit: "percent_w_w",
    basis: "dry_weight",
    context: "flower",
    quantityKind: "mass_fraction"
  });

  const validCreatePayload: CreateCoaReportRequest = {
    batchId,
    evidenceId,
    evidenceRevision: 1,
    completenessStatus: "complete",
    reportIdentifierAsClaimed: "RPT-2026-001",
    reportDate: "2026-10-18",
    labNameAsClaimed: "Steep Hill Analytical",
    sampleIdentifierAsClaimed: "SMPL-882",
    scopeKind: "sample_only",
    scopeDescription: "One 5g representative sample",
    sampleToBatchAssociationConfirmed: true,
    sampleToBatchAssociationAttestation: "CoC matches registered lot",
    measurements: [
      {
        analyte: "THCA",
        resultKind: "quantified",
        resultValue: "24.5000",
        unit: "percent_w_w",
        basis: "dry_weight",
        context: "flower",
        quantityKind: "mass_fraction",
        uncertaintyAbsolute: "0.2500"
      }
    ]
  };

  const validCreateCmd: CommandEnvelope<CreateCoaReportRequest> = {
    actionId: createActionId("018f6f00-0000-7000-8000-000000000099"),
    clientId,
    actorId: "compliance-officer",
    timestamp: "2026-10-19T12:00:00.000Z",
    payload: validCreatePayload
  };

  describe("CreateCoaReportUseCase", () => {
    it("validates command envelope and rejects invalid UUIDv7 actionId", async () => {
      const uow = createMockUow();
      const useCase = new CreateCoaReportUseCase(uow);

      await expect(
        useCase.execute({
          ...validCreateCmd,
          actionId: "not-a-v7-uuid" as unknown as ActionId
        })
      ).rejects.toThrow(ProductValidationError);
    });

    it("rejects invalid payload violating schema", async () => {
      const uow = createMockUow();
      const useCase = new CreateCoaReportUseCase(uow);

      await expect(
        useCase.execute({
          ...validCreateCmd,
          payload: {
            ...validCreatePayload,
            batchId: "invalid-batch" as unknown as BatchId
          }
        })
      ).rejects.toThrow(ProductValidationError);
    });

    it("executes within UOW transaction and invokes repository createReport", async () => {
      const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
      const revision = createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-2026-001",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill Analytical",
          sampleIdentifierAsClaimed: "SMPL-882",
          scopeKind: "sample_only",
          scopeDescription: "One 5g representative sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches registered lot",
          assertedBy: "compliance-officer"
        },
        [validMeasurement]
      );
      const expectedResult: CoaReportCreationResult = {
        report,
        revision,
        measurements: [validMeasurement]
      };

      const mockRepo: Partial<CoaReportRepositoryPort> = {
        createReport: vi.fn(async () => expectedResult)
      };
      const uow = createMockUow(mockRepo);
      const useCase = new CreateCoaReportUseCase(uow);

      const result = await useCase.execute(validCreateCmd);
      expect(result).toBe(expectedResult);
      expect(mockRepo.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: validCreateCmd.actionId,
          clientId: validCreateCmd.clientId
        })
      );
    });
  });

  describe("SupersedeCoaReportUseCase", () => {
    const validSupersedePayload = {
      reportId,
      expectedVersion: 1,
      evidenceRevision: 1,
      completenessStatus: "complete" as const,
      reportIdentifierAsClaimed: "RPT-2026-001",
      reportDate: "2026-10-18",
      labNameAsClaimed: "Steep Hill Analytical",
      sampleIdentifierAsClaimed: "SMPL-882",
      scopeKind: "sample_only" as const,
      scopeDescription: "One 5g representative sample",
      sampleToBatchAssociationConfirmed: true,
      sampleToBatchAssociationAttestation: "CoC matches registered lot",
      measurements: [
        {
          analyte: "THCA",
          resultKind: "quantified" as const,
          resultValue: "24.5000",
          unit: "percent_w_w",
          basis: "dry_weight",
          context: "flower",
          quantityKind: "mass_fraction"
        }
      ]
    };

    const validSupersedeCmd: CommandEnvelope<typeof validSupersedePayload> = {
      actionId: createActionId("018f6f00-0000-7000-8000-000000000098"),
      clientId,
      actorId: "compliance-officer",
      timestamp: "2026-10-19T13:00:00.000Z",
      payload: validSupersedePayload
    };

    it("validates reportId and expectedVersion, delegating to repository supersedeReport", async () => {
      const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
      const rev2Measurement = createCoaMeasurement({
        measurementId,
        clientId,
        reportId,
        reportRevision: 2,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        analyte: "THCA",
        resultKind: "quantified",
        resultValue: "24.5000",
        unit: "percent_w_w",
        basis: "dry_weight",
        context: "flower",
        quantityKind: "mass_fraction"
      });
      const revision = createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 2,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-2026-001",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill Analytical",
          sampleIdentifierAsClaimed: "SMPL-882",
          scopeKind: "sample_only",
          scopeDescription: "One 5g representative sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches registered lot",
          assertedBy: "compliance-officer",
          supersedesRevision: 1
        },
        [rev2Measurement]
      );
      const expectedResult: CoaReportSupersessionResult = {
        report: { ...report, currentRevision: 2, version: 2 },
        revision,
        measurements: [rev2Measurement],
        audit: { previous: report, current: { ...report, currentRevision: 2, version: 2 } }
      };

      const mockRepo: Partial<CoaReportRepositoryPort> = {
        supersedeReport: vi.fn(async () => expectedResult)
      };
      const uow = createMockUow(mockRepo);
      const useCase = new SupersedeCoaReportUseCase(uow);

      const result = await useCase.execute(validSupersedeCmd);
      expect(result).toBe(expectedResult);
      expect(mockRepo.supersedeReport).toHaveBeenCalled();
    });
  });

  describe("ReviewCoaReportUseCase", () => {
    const validReviewPayload = {
      reportId,
      expectedVersion: 1,
      decision: "approved" as const,
      reason: "Transcription verified against original laboratory PDF",
      assessedScope: "sample_only" as const
    };

    const validReviewCmd: CommandEnvelope<typeof validReviewPayload> = {
      actionId: createActionId("018f6f00-0000-7000-8000-000000000097"),
      clientId,
      actorId: "independent-reviewer",
      timestamp: "2026-10-19T14:00:00.000Z",
      payload: validReviewPayload
    };

    it("enforces separation of duties and rejects self-approval by transcriber", async () => {
      const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
      const revision = createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-2026-001",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill Analytical",
          sampleIdentifierAsClaimed: "SMPL-882",
          scopeKind: "sample_only",
          scopeDescription: "One 5g representative sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches registered lot",
          assertedBy: "compliance-officer" // Recorder is compliance-officer
        },
        [validMeasurement]
      );

      const mockRepo: Partial<CoaReportRepositoryPort> = {
        getReportById: vi.fn(async () => report),
        getReportRevision: vi.fn(async () => ({
          revision,
          measurements: [validMeasurement],
          reviewEvent: null
        })),
        reviewReportRevision: vi.fn(async (cmd) => {
          if (cmd.payload.decision === "approved" && cmd.actorId === revision.assertedBy) {
            throw new AccessDeniedError(
              "Self-approval forbidden: reviewer cannot be the recorder who asserted this report revision"
            );
          }
          return {} as CoaReportReviewResult;
        })
      };
      const uow = createMockUow(mockRepo);
      const useCase = new ReviewCoaReportUseCase(uow, new AllowAllReviewerAuthorizationAdapter());

      // Attempt self-approval by compliance-officer
      await expect(
        useCase.execute({
          ...validReviewCmd,
          actorId: "compliance-officer" // Same actor as assertedBy
        })
      ).rejects.toThrow(AccessDeniedError);
    });

    it("checks ReviewerAuthorizationPort and rejects unauthorized reviewer", async () => {
      const mockAuth: ReviewerAuthorizationPort = {
        assertCanReviewCoaReport: vi.fn(async () => {
          throw new AccessDeniedError("Reviewer lacks compliance-review authority");
        }),
        assertCanReviewClaim: vi.fn(async () => {})
      };

      const uow = createMockUow({});
      const useCase = new ReviewCoaReportUseCase(uow, mockAuth);

      await expect(useCase.execute(validReviewCmd)).rejects.toThrow(AccessDeniedError);
      expect(mockAuth.assertCanReviewCoaReport).toHaveBeenCalledWith(
        validReviewCmd.clientId,
        validReviewCmd.actorId
      );
    });

    it("replays committed review receipt even after report is superseded or archived", async () => {
      const mockResult: CoaReportReviewResult = {
        report: createCoaReport({ clientId, reportId, batchId, evidenceId }),
        reviewEvent: {
          eventId: createCoaReviewEventId("018f6f00-0000-7000-8000-000000000099"),
          clientId,
          reportId,
          reportRevision: 1,
          decision: "approved",
          actorId: "reviewer-1",
          occurredAt: "2026-10-19T14:00:00.000Z",
          reason: "Approved from stored receipt",
          assessedScope: "sample_only"
        }
      };

      const mockRepo: Partial<CoaReportRepositoryPort> = {
        reviewReportRevision: vi.fn(async () => mockResult)
      };
      const uow = createMockUow(mockRepo);
      const useCase = new ReviewCoaReportUseCase(uow, new AllowAllReviewerAuthorizationAdapter());

      const res = await useCase.execute(validReviewCmd);
      expect(res).toBe(mockResult);
      expect(mockRepo.reviewReportRevision).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: validReviewCmd.actionId,
          clientId,
          actorId: validReviewCmd.actorId
        })
      );
    });

    it("fails closed with AccessDeniedError when default ReviewCoaReportUseCase is invoked without explicit authorization adapter", async () => {
      const uow = createMockUow({});
      const defaultUseCase = new ReviewCoaReportUseCase(uow);
      await expect(defaultUseCase.execute(validReviewCmd)).rejects.toThrow(AccessDeniedError);
    });

    it("rejects command envelope when actorId is longer than 128 characters", async () => {
      const uow = createMockUow({});
      const useCase = new ReviewCoaReportUseCase(uow, new AllowAllReviewerAuthorizationAdapter());
      await expect(
        useCase.execute({
          ...validReviewCmd,
          actorId: "A".repeat(129)
        })
      ).rejects.toThrow(ProductValidationError);
    });

    it("approves report revision when reviewer is distinct and authorized", async () => {
      const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
      const revision = createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-2026-001",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill Analytical",
          sampleIdentifierAsClaimed: "SMPL-882",
          scopeKind: "sample_only",
          scopeDescription: "One 5g representative sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches registered lot",
          assertedBy: "compliance-officer"
        },
        [validMeasurement]
      );

      const reviewEvent = {
        eventId: createCoaReviewEventId("018f6f00-0000-7000-8000-000000000088"),
        clientId,
        reportId,
        reportRevision: 1,
        decision: "approved" as const,
        actorId: "independent-reviewer",
        occurredAt: "2026-10-19T14:00:00.000Z",
        reason: "Transcription verified against original laboratory PDF",
        assessedScope: "sample_only" as const
      };

      const expectedResult: CoaReportReviewResult = {
        report: { ...report, version: 2 },
        reviewEvent
      };

      const mockRepo: Partial<CoaReportRepositoryPort> = {
        getReportById: vi.fn(async () => report),
        getReportRevision: vi.fn(async () => ({
          revision,
          measurements: [validMeasurement],
          reviewEvent: null
        })),
        reviewReportRevision: vi.fn(async () => expectedResult)
      };

      const uow = createMockUow(mockRepo);
      const useCase = new ReviewCoaReportUseCase(uow, new AllowAllReviewerAuthorizationAdapter());

      const result = await useCase.execute(validReviewCmd);
      expect(result).toBe(expectedResult);
      expect(mockRepo.reviewReportRevision).toHaveBeenCalled();
    });
  });

  describe("ArchiveCoaReportUseCase", () => {
    it("archives report and delegates to repository archiveReport", async () => {
      const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
      const expectedResult = {
        report: { ...report, version: 2, archivedAt: "2026-10-19T15:00:00.000Z" },
        audit: {
          previous: report,
          current: { ...report, version: 2, archivedAt: "2026-10-19T15:00:00.000Z" }
        }
      };

      const mockRepo: Partial<CoaReportRepositoryPort> = {
        archiveReport: vi.fn(async () => expectedResult)
      };
      const uow = createMockUow(mockRepo);
      const useCase = new ArchiveCoaReportUseCase(uow);

      const result = await useCase.execute({
        actionId: createActionId("018f6f00-0000-7000-8000-000000000096"),
        clientId,
        actorId: "compliance-officer",
        timestamp: "2026-10-19T15:00:00.000Z",
        payload: {
          reportId,
          expectedVersion: 1
        }
      });

      expect(result).toBe(expectedResult);
      expect(mockRepo.archiveReport).toHaveBeenCalled();
    });
  });
});
