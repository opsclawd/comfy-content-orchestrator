import { describe, expect, it } from "vitest";
import {
  CreateCoaReportRequestSchema,
  ResolveCoaMeasurementSupportRequestSchema,
  ResolveCoaMeasurementSupportResponseSchema,
  ReviewCoaReportRequestSchema,
  SupersedeCoaReportRequestSchema
} from "./coa-report.js";

describe("CoA Report Contracts & Schemas", () => {
  it("validates and preserves exact decimal strings in create request", () => {
    const raw = {
      batchId: "018f6f00-0000-7000-8000-000000000001",
      evidenceId: "018f6f00-0000-7000-8000-000000000002",
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

    const parsed = CreateCoaReportRequestSchema.parse(raw);
    expect(parsed.measurements[0]?.resultValue).toBe("24.5000");
    expect(typeof parsed.measurements[0]?.resultValue).toBe("string");
    expect(parsed.measurements[0]?.uncertaintyAbsolute).toBe("0.2500");
  });

  it("rejects numbers, floats, and scientific notation in decimal fields", () => {
    const raw = {
      batchId: "018f6f00-0000-7000-8000-000000000001",
      evidenceId: "018f6f00-0000-7000-8000-000000000002",
      evidenceRevision: 1,
      completenessStatus: "draft",
      measurements: [
        {
          analyte: "THCA",
          resultKind: "quantified",
          resultValue: 24.5, // Numeric float rejected by schema
          unit: "percent_w_w",
          basis: "dry_weight",
          context: "flower",
          quantityKind: "mass_fraction"
        }
      ]
    };

    expect(() => CreateCoaReportRequestSchema.parse(raw)).toThrow();
  });

  it("validates review request schema", () => {
    const raw = {
      expectedVersion: 1,
      decision: "approved",
      reason: "Transcription verified against original certificate PDF",
      assessedScope: "sample_only"
    };
    const parsed = ReviewCoaReportRequestSchema.parse(raw);
    expect(parsed.decision).toBe("approved");
    expect(parsed.assessedScope).toBe("sample_only");
  });

  it("validates supersede request schema", () => {
    const raw = {
      expectedVersion: 1,
      evidenceRevision: 2,
      completenessStatus: "draft",
      measurements: []
    };
    const parsed = SupersedeCoaReportRequestSchema.parse(raw);
    expect(parsed.expectedVersion).toBe(1);
    expect(parsed.evidenceRevision).toBe(2);
  });

  it("validates resolve measurement support request & response schemas", () => {
    const req = {
      batchId: "018f6f00-0000-7000-8000-000000000001",
      reportId: "018f6f00-0000-7000-8000-000000000002",
      reportRevision: 1,
      measurementIds: ["018f6f00-0000-7000-8000-000000000003"],
      requiredUnit: "percent_w_w",
      requiredBasis: "dry_weight",
      requiredContext: "flower",
      requiredScope: "sample_only"
    };
    const parsedReq = ResolveCoaMeasurementSupportRequestSchema.parse(req);
    expect(parsedReq.reportRevision).toBe(1);

    const resp = {
      isSupported: true,
      resolution: {
        clientId: "018f6f00-0000-7000-8000-000000000000",
        batchId: "018f6f00-0000-7000-8000-000000000001",
        reportId: "018f6f00-0000-7000-8000-000000000002",
        reportRevision: 1,
        evidenceId: "018f6f00-0000-7000-8000-000000000004",
        evidenceRevision: 1,
        sourceObjectId: "018f6f00-0000-7000-8000-000000000005",
        assessedScope: "sample_only",
        measurements: [
          {
            measurementId: "018f6f00-0000-7000-8000-000000000003",
            analyte: "THCA",
            decimalValue: "24.5000",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "flower",
            quantityKind: "mass_fraction",
            uncertaintyAbsolute: "0.2500",
            detectionLimit: null,
            quantificationLimit: null,
            method: "HPLC-DAD",
            analyticalQualifierCode: null,
            analyticalQualifierExplanation: null
          }
        ]
      }
    };
    const parsedResp = ResolveCoaMeasurementSupportResponseSchema.parse(resp);
    expect(parsedResp.isSupported).toBe(true);
    expect(parsedResp.resolution?.measurements[0]?.decimalValue).toBe("24.5000");
  });

  it("fails closed when required query fields are missing in resolve request", () => {
    const incompleteReq = {
      batchId: "018f6f00-0000-7000-8000-000000000001",
      reportId: "018f6f00-0000-7000-8000-000000000002",
      reportRevision: 1,
      measurementIds: ["018f6f00-0000-7000-8000-000000000003"]
      // missing requiredUnit, requiredBasis, requiredContext, requiredScope
    };
    expect(() => ResolveCoaMeasurementSupportRequestSchema.parse(incompleteReq)).toThrow();
  });
});
