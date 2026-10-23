import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DossierCoaReportItem, DossierEvidenceItem } from "@cco/contracts";
import { CoaReportsPanel } from "./coa-reports-panel.js";

const sampleUuid = "22222222-2222-2222-2222-222222222222";
const now = "2026-10-21T18:00:00.000Z";

const mockEvidence: DossierEvidenceItem[] = [
  {
    asset: {
      clientId: sampleUuid,
      evidenceId: sampleUuid,
      currentRevision: 1,
      version: 1,
      createdAt: now,
      archivedAt: null
    },
    currentRevision: {
      clientId: sampleUuid,
      evidenceId: sampleUuid,
      revision: 1,
      sourceObjectId: sampleUuid,
      sourceClass: "coa",
      acquisitionMethod: "direct_upload",
      submittedBy: "operator-1",
      submittedAt: now,
      assertionText: "Lab Report PDF",
      reportedCaptureDate: "2026-10-15",
      reportedCaptureTimestamp: null,
      reportedCapturePrecision: "date",
      captureContext: null,
      rightsStatus: "granted",
      consentStatus: "granted",
      rightsAttribution: "Standard lab release",
      rightsDocumentLocator: null,
      supersedesRevision: null
    },
    revisions: [],
    sourceObjects: [
      {
        sourceObjectId: sampleUuid,
        originalSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        detectedMimeType: "application/pdf",
        byteLength: 2048,
        uploadedAt: now,
        uploaderId: "operator-1",
        accessClass: "restricted_original",
        retentionClass: "source_evidence_archive",
        retentionPolicyVersion: "1.0",
        availability: "available"
      }
    ],
    derivatives: [],
    verificationEvents: []
  }
];

const mockCoaReports: DossierCoaReportItem[] = [
  {
    report: {
      clientId: sampleUuid,
      batchId: sampleUuid,
      reportId: sampleUuid,
      evidenceId: sampleUuid,
      currentRevision: 1,
      version: 1,
      createdAt: now,
      archivedAt: null
    },
    currentRevision: {
      clientId: sampleUuid,
      reportId: sampleUuid,
      revision: 1,
      batchId: sampleUuid,
      evidenceId: sampleUuid,
      evidenceRevision: 1,
      completenessStatus: "complete",
      reportIdentifierAsClaimed: "RPT-ANALYTICAL-99",
      reportDate: "2026-10-15",
      labNameAsClaimed: "Apex Analytics Lab",
      sampleIdentifierAsClaimed: null,
      scopeKind: "attributed_lot",
      scopeDescription: null,
      sampleDate: null,
      samplingMethodDescription: null,
      sampleToBatchAssociationAttestation: null,
      sampleToBatchAssociationConfirmed: null,
      verifiedLabIdentityEventId: null,
      measurements: [
        {
          measurementId: sampleUuid,
          clientId: sampleUuid,
          reportId: sampleUuid,
          reportRevision: 1,
          batchId: sampleUuid,
          evidenceId: sampleUuid,
          evidenceRevision: 1,
          analyte: "THC",
          resultKind: "quantified",
          resultValue: "24.5000",
          resultLimit: null,
          resultQualifier: null,
          unit: "percent",
          basis: "dry_weight",
          context: "cannabinoid_profile",
          quantityKind: "mass_fraction",
          methodAsReported: "HPLC-UV",
          uncertaintyAbsolute: null,
          detectionLimit: null,
          quantificationLimit: null,
          analyticalQualifierCode: null,
          analyticalQualifierExplanation: null
        }
      ],
      supersedesRevision: null,
      assertedBy: "operator-1",
      assertedAt: now
    },
    revisions: [],
    reviewEvents: [
      {
        eventId: sampleUuid,
        clientId: sampleUuid,
        reportId: sampleUuid,
        reportRevision: 1,
        decision: "approved",
        actorId: "director-reviewer-1",
        occurredAt: now,
        reason: "Valid accredited report",
        assessedScope: "attributed_lot"
      }
    ]
  }
];

describe("CoaReportsPanel", () => {
  it("renders CoA reports, measurements, and review badges", () => {
    const html = renderToStaticMarkup(
      <CoaReportsPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        coaReports={mockCoaReports}
        availableEvidence={mockEvidence}
        onDossierUpdated={vi.fn()}
      />
    );

    expect(html).toContain("RPT-ANALYTICAL-99");
    expect(html).toContain("Apex Analytics Lab");
    expect(html).toContain("THC");
    expect(html).toContain("24.5000");
    expect(html).toContain("percent");
    expect(html).toContain("dry_weight");
    expect(html).toContain("approved by director-reviewer-1");
    expect(html).toContain("Recorded by:");
    expect(html).toContain("operator-1");
    expect(html).toContain("HPLC-UV");
    expect(html).toContain("mass_fraction");
  });

  it("displays Unreviewed Transcription (Rev 2) when superseded to Rev 2 even if Rev 1 was approved", () => {
    const supersededReport: DossierCoaReportItem = {
      report: {
        clientId: sampleUuid,
        batchId: sampleUuid,
        reportId: sampleUuid,
        evidenceId: sampleUuid,
        currentRevision: 2,
        version: 2,
        createdAt: now,
        archivedAt: null
      },
      currentRevision: {
        ...mockCoaReports[0]!.currentRevision,
        revision: 2,
        supersedesRevision: 1,
        assertedBy: "operator-2",
        assertedAt: now
      },
      revisions: [
        mockCoaReports[0]!.currentRevision,
        {
          ...mockCoaReports[0]!.currentRevision,
          revision: 2,
          supersedesRevision: 1,
          assertedBy: "operator-2",
          assertedAt: now
        }
      ],
      // Review event is strictly for Revision 1
      reviewEvents: [
        {
          eventId: sampleUuid,
          clientId: sampleUuid,
          reportId: sampleUuid,
          reportRevision: 1,
          decision: "approved",
          actorId: "director-reviewer-1",
          occurredAt: now,
          reason: "Approved rev 1",
          assessedScope: "attributed_lot"
        }
      ]
    };

    const html = renderToStaticMarkup(
      <CoaReportsPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        coaReports={[supersededReport]}
        availableEvidence={mockEvidence}
        onDossierUpdated={vi.fn()}
      />
    );

    // Current revision (Rev 2) must show as Unreviewed Transcription (Rev 2)
    expect(html).toContain("Unreviewed Transcription (Rev 2)");
    // Must show recorder of Rev 2
    expect(html).toContain("operator-2");
    // Lineage must list Rev 1 as approved and Rev 2 as unreviewed
    expect(html).toContain("Report Revision History");
    expect(html).toContain("Rev 1");
    expect(html).toContain("Rev 2");
    expect(html).toContain("approved by director-reviewer-1 (Rev 1)");
    expect(html).toContain("Unreviewed (Rev 2)");
  });

  it("renders empty state when no CoA reports exist", () => {
    const html = renderToStaticMarkup(
      <CoaReportsPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        coaReports={[]}
        availableEvidence={mockEvidence}
        onDossierUpdated={vi.fn()}
      />
    );

    expect(html).toContain("No Certificate of Analysis transcribed");
  });
});
