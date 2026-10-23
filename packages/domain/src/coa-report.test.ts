import { describe, expect, it } from "vitest";
import { createCoaMeasurement } from "./coa-measurement.js";
import {
  archiveCoaReport,
  createCoaReport,
  createCoaReportReviewEvent,
  createCoaReportRevision,
  rehydrateCoaReport,
  rehydrateCoaReportReviewEvent,
  rehydrateCoaReportRevision,
  supersedeCoaReport
} from "./coa-report.js";
import {
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId
} from "./identifiers.js";
import {
  AccessDeniedError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";

describe("CoaReport and CoaReportRevision Invariants", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000002");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000003");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000004");

  const measurement1 = createCoaMeasurement({
    measurementId: createCoaMeasurementId("018f6f00-0000-7000-8000-000000000010"),
    clientId,
    reportId,
    reportRevision: 1,
    batchId,
    evidenceId,
    evidenceRevision: 1,
    analyte: "THCA",
    resultKind: "quantified",
    resultValue: "22.50",
    unit: "percent_w_w",
    basis: "dry_weight",
    context: "flower",
    quantityKind: "mass_fraction"
  });

  const measurement2 = createCoaMeasurement({
    measurementId: createCoaMeasurementId("018f6f00-0000-7000-8000-000000000011"),
    clientId,
    reportId,
    reportRevision: 1,
    batchId,
    evidenceId,
    evidenceRevision: 1,
    analyte: "CBDA",
    resultKind: "quantified",
    resultValue: "0.15",
    unit: "percent_w_w",
    basis: "dry_weight",
    context: "flower",
    quantityKind: "mass_fraction"
  });

  it("creates a report head with revision 1 and version 1", () => {
    const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
    expect(report.currentRevision).toBe(1);
    expect(report.version).toBe(1);
    expect(report.archivedAt).toBeNull();
  });

  it("creates a draft revision permitting null metadata", () => {
    const draftRev = createCoaReportRevision(
      {
        clientId,
        reportId,
        revision: 1,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "draft",
        assertedBy: "Lab Technician"
      },
      []
    );
    expect(draftRev.completenessStatus).toBe("draft");
    expect(draftRev.reportIdentifierAsClaimed).toBeNull();
    expect(draftRev.reportDate).toBeNull();
  });

  it("creates a complete revision when all requirements are satisfied", () => {
    const completeRev = createCoaReportRevision(
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
        scopeDescription: "One 5g representative sample tested as received",
        sampleToBatchAssociationConfirmed: true,
        sampleToBatchAssociationAttestation:
          "Chain of custody form 882 specifies lot identifier matches registered batch",
        assertedBy: "Compliance Officer"
      },
      [measurement1, measurement2]
    );
    expect(completeRev.completenessStatus).toBe("complete");
    expect(completeRev.reportIdentifierAsClaimed).toBe("RPT-2026-001");
  });

  it("rejects complete revision missing required metadata or measurements", () => {
    expect(() =>
      createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-2026-001",
          // missing reportDate
          labNameAsClaimed: "Steep Hill Analytical",
          sampleIdentifierAsClaimed: "SMPL-882",
          scopeKind: "sample_only",
          scopeDescription: "One 5g sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches",
          assertedBy: "Compliance Officer"
        },
        [measurement1]
      )
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaReportRevision(
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
          scopeDescription: "One 5g sample",
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches",
          assertedBy: "Compliance Officer"
        },
        [] // empty measurements
      )
    ).toThrow(ProductValidationError);
  });

  it("requires samplingMethodDescription when scopeKind is attributed_lot", () => {
    expect(() =>
      createCoaReportRevision(
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
          scopeKind: "attributed_lot",
          scopeDescription: "Composite sample of harvest lot",
          // missing samplingMethodDescription
          sampleToBatchAssociationConfirmed: true,
          sampleToBatchAssociationAttestation: "CoC matches",
          assertedBy: "Compliance Officer"
        },
        [measurement1]
      )
    ).toThrow(ProductValidationError);
  });

  it("enforces date chronology: sampleDate <= reportDate <= recording date", () => {
    expect(() =>
      createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "draft",
          reportDate: "2026-10-15",
          sampleDate: "2026-10-16", // sampleDate later than reportDate
          assertedBy: "Technician"
        },
        []
      )
    ).toThrow(ProductValidationError);

    expect(() =>
      createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "draft",
          reportDate: "2026-10-25", // future date relative to assertedAt
          assertedAt: "2026-10-20T12:00:00.000Z",
          assertedBy: "Technician"
        },
        []
      )
    ).toThrow(ProductValidationError);
  });

  it("rejects duplicate parameter context within same revision", () => {
    const dupMeasurement = createCoaMeasurement({
      measurementId: createCoaMeasurementId("018f6f00-0000-7000-8000-000000000012"),
      clientId,
      reportId,
      reportRevision: 1,
      batchId,
      evidenceId,
      evidenceRevision: 1,
      analyte: "THCA", // Same analyte
      resultKind: "quantified",
      resultValue: "23.00",
      unit: "percent_w_w",
      basis: "dry_weight", // Same basis
      context: "flower", // Same context
      quantityKind: "mass_fraction"
    });

    expect(() =>
      createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "draft",
          assertedBy: "Technician"
        },
        [measurement1, dupMeasurement]
      )
    ).toThrow(ProductValidationError);
  });

  it("allows same analyte with distinct context (e.g. rep_1 vs rep_2)", () => {
    const rep1 = createCoaMeasurement({
      measurementId: createCoaMeasurementId("018f6f00-0000-7000-8000-000000000013"),
      clientId,
      reportId,
      reportRevision: 1,
      batchId,
      evidenceId,
      evidenceRevision: 1,
      analyte: "THCA",
      resultKind: "quantified",
      resultValue: "22.50",
      unit: "percent_w_w",
      basis: "dry_weight",
      context: "rep_1",
      quantityKind: "mass_fraction"
    });

    const rep2 = createCoaMeasurement({
      measurementId: createCoaMeasurementId("018f6f00-0000-7000-8000-000000000014"),
      clientId,
      reportId,
      reportRevision: 1,
      batchId,
      evidenceId,
      evidenceRevision: 1,
      analyte: "THCA",
      resultKind: "quantified",
      resultValue: "22.70",
      unit: "percent_w_w",
      basis: "dry_weight",
      context: "rep_2",
      quantityKind: "mass_fraction"
    });

    const rev = createCoaReportRevision(
      {
        clientId,
        reportId,
        revision: 1,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "draft",
        assertedBy: "Technician"
      },
      [rep1, rep2]
    );
    expect(rev.revision).toBe(1);
  });

  it("enforces monotonic predecessor on revisions", () => {
    expect(() =>
      createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "draft",
          assertedBy: "Technician",
          supersedesRevision: 1
        },
        []
      )
    ).toThrow(NonMonotonicRevisionError);

    expect(() =>
      createCoaReportRevision(
        {
          clientId,
          reportId,
          revision: 2,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "draft",
          assertedBy: "Technician",
          supersedesRevision: 0 // must be 1
        },
        []
      )
    ).toThrow(NonMonotonicRevisionError);
  });

  it("supersedes report under expectedVersion check", () => {
    const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
    const { current: nextReport } = supersedeCoaReport(report, 1);
    expect(nextReport.currentRevision).toBe(2);
    expect(nextReport.version).toBe(2);

    expect(() => supersedeCoaReport(report, 2)).toThrow(StaleRevisionConflictError);
  });

  it("archives report and rejects further updates", () => {
    const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
    const { current: archivedReport } = archiveCoaReport(report, 1);
    expect(archivedReport.archivedAt).not.toBeNull();
    expect(archivedReport.version).toBe(2);

    expect(() => supersedeCoaReport(archivedReport, 2)).toThrow(AccessDeniedError);
    expect(() => archiveCoaReport(archivedReport, 2)).toThrow(AccessDeniedError);
  });

  describe("Review Events & Approval Invariants", () => {
    const report = createCoaReport({ clientId, reportId, batchId, evidenceId });
    const completeRev = createCoaReportRevision(
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
        sampleToBatchAssociationAttestation: "CoC verified",
        assertedBy: "Compliance Officer"
      },
      [measurement1]
    );

    const draftRev = createCoaReportRevision(
      {
        clientId,
        reportId,
        revision: 1,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "draft",
        assertedBy: "Technician"
      },
      []
    );

    it("rejects approval of a draft revision", () => {
      expect(() =>
        createCoaReportReviewEvent(
          {
            clientId,
            reportId,
            reportRevision: 1,
            decision: "approved",
            actorId: "compliance-officer",
            reason: "Looks good",
            assessedScope: "sample_only"
          },
          report,
          draftRev
        )
      ).toThrow(ProductValidationError);
    });

    it("rejects assessedScope 'attributed_lot' when report is scoped as 'sample_only'", () => {
      expect(() =>
        createCoaReportReviewEvent(
          {
            clientId,
            reportId,
            reportRevision: 1,
            decision: "approved",
            actorId: "compliance-officer",
            reason: "Approved lot-wide",
            assessedScope: "attributed_lot"
          },
          report,
          completeRev
        )
      ).toThrow(ProductValidationError);
    });

    it("rejects self-approval when reviewer actorId matches revision assertedBy", () => {
      expect(() =>
        createCoaReportReviewEvent(
          {
            clientId,
            reportId,
            reportRevision: 1,
            decision: "approved",
            actorId: completeRev.assertedBy, // Self-approval!
            reason: "I approve my own transcription",
            assessedScope: "sample_only"
          },
          report,
          completeRev
        )
      ).toThrow(AccessDeniedError);
    });

    it("rejects assertedBy or actorId longer than 128 characters", () => {
      const longName = "A".repeat(129);
      expect(() =>
        createCoaReportRevision(
          {
            clientId,
            reportId,
            revision: 1,
            batchId,
            evidenceId,
            evidenceRevision: 1,
            completenessStatus: "draft",
            assertedBy: longName
          },
          []
        )
      ).toThrow(ProductValidationError);

      expect(() =>
        createCoaReportReviewEvent(
          {
            clientId,
            reportId,
            reportRevision: 1,
            decision: "approved",
            actorId: longName,
            reason: "Valid reason",
            assessedScope: "sample_only"
          },
          report,
          completeRev
        )
      ).toThrow(ProductValidationError);
    });

    it("approves complete revision and advances head version with revision unchanged", () => {
      const { event, updatedHead } = createCoaReportReviewEvent(
        {
          clientId,
          reportId,
          reportRevision: 1,
          decision: "approved",
          actorId: "compliance-officer",
          reason: "Verified laboratory transcription matches original certificate",
          assessedScope: "sample_only"
        },
        report,
        completeRev
      );
      expect(event.decision).toBe("approved");
      expect(event.assessedScope).toBe("sample_only");
      expect(updatedHead.version).toBe(2);
      expect(updatedHead.currentRevision).toBe(1);
    });

    it("rehydrates report, revision, and review events accurately", () => {
      const rehydratedReport = rehydrateCoaReport(report);
      expect(rehydratedReport).toEqual(report);

      const rehydratedRevision = rehydrateCoaReportRevision(completeRev);
      expect(rehydratedRevision).toEqual(completeRev);

      const { event } = createCoaReportReviewEvent(
        {
          clientId,
          reportId,
          reportRevision: 1,
          decision: "approved",
          actorId: "compliance-officer",
          reason: "Approved",
          assessedScope: "sample_only"
        },
        report,
        completeRev
      );
      const rehydratedEvent = rehydrateCoaReportReviewEvent(event);
      expect(rehydratedEvent).toEqual(event);
    });
  });
});
