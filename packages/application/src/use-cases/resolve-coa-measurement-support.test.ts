import { describe, expect, it, vi } from "vitest";
import {
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  ProductValidationError
} from "@cco/domain";
import type { ResolveCoaMeasurementSupportResponse } from "@cco/contracts";
import type {
  CoaReportRepositoryPort,
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { ResolveCoaMeasurementSupportUseCase } from "./resolve-coa-measurement-support.js";

describe("ResolveCoaMeasurementSupportUseCase", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000002");
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

  const validQuery = {
    clientId,
    batchId,
    reportId,
    reportRevision: 1,
    measurementIds: [measurementId],
    requiredUnit: "percent_w_w",
    requiredBasis: "dry_weight",
    requiredContext: "flower",
    requiredScope: "sample_only" as const
  };

  it("rejects invalid input schema (missing measurementIds)", async () => {
    const uow = createMockUow();
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    await expect(
      useCase.execute({
        ...validQuery,
        measurementIds: [] // min(1) violation
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("delegates resolution query to repository", async () => {
    const mockResponse: ResolveCoaMeasurementSupportResponse = {
      isSupported: true,
      resolution: {
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        evidenceId: "018f6f00-0000-7000-8000-000000000003",
        evidenceRevision: 1,
        sourceObjectId: "018f6f00-0000-7000-8000-000000000006",
        assessedScope: "sample_only",
        verifiedLabIdentityEventId: null,
        measurements: [
          {
            measurementId,
            analyte: "THCA",
            decimalValue: "24.5000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.2500",
            detectionLimit: null,
            quantificationLimit: null,
            method: null,
            analyticalQualifierCode: null,
            analyticalQualifierExplanation: null
          }
        ]
      }
    };

    const mockRepo: Partial<CoaReportRepositoryPort> = {
      resolveMeasurementSupport: vi.fn(async () => mockResponse)
    };

    const uow = createMockUow(mockRepo);
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    const result = await useCase.execute(validQuery);
    expect(result.isSupported).toBe(true);
    expect(result.resolution?.measurements[0]?.decimalValue).toBe("24.5000");
    expect(mockRepo.resolveMeasurementSupport).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId,
        batchId,
        reportId,
        reportRevision: 1
      })
    );
  });

  it("handles denial responses with specific failure reasons", async () => {
    const reasons = [
      "report_superseded",
      "report_archived",
      "mixed_measurement_contexts",
      "lab_verification_withdrawn",
      "source_disputed",
      "source_quarantined",
      "scope_insufficient",
      "unsupported_analytical_tuple"
    ] as const;

    for (const reason of reasons) {
      const mockRepo: Partial<CoaReportRepositoryPort> = {
        resolveMeasurementSupport: vi.fn(async () => ({
          isSupported: false,
          reason
        }))
      };

      const uow = createMockUow(mockRepo);
      const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

      const result = await useCase.execute(validQuery);
      expect(result.isSupported).toBe(false);
      expect(result.reason).toBe(reason);
    }
  });

  it("preserves exact decimal strings and analytical qualifiers on resolution output", async () => {
    const mockResponse: ResolveCoaMeasurementSupportResponse = {
      isSupported: true,
      resolution: {
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        evidenceId: "018f6f00-0000-7000-8000-000000000003",
        evidenceRevision: 1,
        sourceObjectId: "018f6f00-0000-7000-8000-000000000006",
        assessedScope: "attributed_lot",
        verifiedLabIdentityEventId: "018f6f00-0000-7000-8000-000000000007",
        measurements: [
          {
            measurementId,
            analyte: "delta-9-THC",
            decimalValue: "0.299999999999999999999999999999",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.005000000000000000000000000000",
            detectionLimit: "0.001000000000000000000000000000",
            quantificationLimit: "0.005000000000000000000000000000",
            method: "HPLC-DAD",
            analyticalQualifierCode: "negative_as_reported",
            analyticalQualifierExplanation: "Baseline drift correction"
          }
        ]
      }
    };

    const mockRepo: Partial<CoaReportRepositoryPort> = {
      resolveMeasurementSupport: vi.fn(async () => mockResponse)
    };

    const uow = createMockUow(mockRepo);
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    const result = await useCase.execute({
      ...validQuery,
      requiredScope: "attributed_lot"
    });

    expect(result.isSupported).toBe(true);
    expect(result.resolution?.measurements[0]?.decimalValue).toBe(
      "0.299999999999999999999999999999"
    );
    expect(result.resolution?.measurements[0]?.analyticalQualifierCode).toBe(
      "negative_as_reported"
    );
    expect(result.resolution?.assessedScope).toBe("attributed_lot");
  });

  it("rejects invalid clientId format", async () => {
    const uow = createMockUow();
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    await expect(
      useCase.execute({
        ...validQuery,
        clientId: "not-a-uuid"
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("throws when UnitOfWorkContext.coaReports is not configured", async () => {
    const uow = createMockUow(undefined);
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    await expect(useCase.execute(validQuery)).rejects.toThrow(
      "UnitOfWorkContext.coaReports is not configured for this UnitOfWork implementation."
    );
  });

  it("rejects invalid scope string in request schema", async () => {
    const uow = createMockUow();
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    await expect(
      useCase.execute({
        ...validQuery,
        requiredScope: "global_universe" as unknown as "sample_only"
      })
    ).rejects.toThrow(ProductValidationError);
  });

  it("handles multi-measurement panel resolution correctly", async () => {
    const measurementId2 = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000006");
    const mockResponse: ResolveCoaMeasurementSupportResponse = {
      isSupported: true,
      resolution: {
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        evidenceId: "018f6f00-0000-7000-8000-000000000003",
        evidenceRevision: 1,
        sourceObjectId: "018f6f00-0000-7000-8000-000000000006",
        assessedScope: "sample_only",
        verifiedLabIdentityEventId: null,
        measurements: [
          {
            measurementId,
            analyte: "THCA",
            decimalValue: "24.5000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.2500",
            detectionLimit: null,
            quantificationLimit: null,
            method: null,
            analyticalQualifierCode: null,
            analyticalQualifierExplanation: null
          },
          {
            measurementId: measurementId2,
            analyte: "CBDA",
            decimalValue: "1.2000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.0500",
            detectionLimit: null,
            quantificationLimit: null,
            method: null,
            analyticalQualifierCode: null,
            analyticalQualifierExplanation: null
          }
        ]
      }
    };

    const mockRepo: Partial<CoaReportRepositoryPort> = {
      resolveMeasurementSupport: vi.fn(async () => mockResponse)
    };

    const uow = createMockUow(mockRepo);
    const useCase = new ResolveCoaMeasurementSupportUseCase(uow);

    const result = await useCase.execute({
      ...validQuery,
      measurementIds: [measurementId, measurementId2]
    });

    expect(result.isSupported).toBe(true);
    expect(result.resolution?.measurements.length).toBe(2);
    expect(result.resolution?.measurements[1]?.analyte).toBe("CBDA");
  });
});
