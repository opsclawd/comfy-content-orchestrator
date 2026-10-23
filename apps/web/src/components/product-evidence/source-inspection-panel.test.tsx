import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DossierEvidenceItem } from "@cco/contracts";
import { SourceInspectionPanel } from "./source-inspection-panel.js";

const sampleUuid = "33333333-3333-3333-3333-333333333333";
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
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      submittedBy: "director-photographer",
      submittedAt: now,
      assertionText: "Hero trichome macro capture",
      reportedCaptureDate: "2026-10-18",
      reportedCaptureTimestamp: null,
      reportedCapturePrecision: "date",
      captureContext: "Field camera Sony A7IV",
      rightsStatus: "granted",
      consentStatus: "granted",
      rightsAttribution: "Photographer work-for-hire contract",
      rightsDocumentLocator: null,
      supersedesRevision: null
    },
    revisions: [],
    sourceObjects: [
      {
        sourceObjectId: sampleUuid,
        originalSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        byteLength: 4194304,
        detectedMimeType: "image/png",
        uploadedAt: now,
        uploaderId: "user-1",
        accessClass: "restricted_original",
        retentionClass: "source_evidence_archive",
        retentionPolicyVersion: "1.0",
        availability: "available"
      }
    ],
    verificationEvents: [
      {
        eventId: sampleUuid,
        clientId: sampleUuid,
        evidenceId: sampleUuid,
        evidenceRevision: 1,
        verificationKind: "independent_third_party_corroboration",
        outcome: "verified",
        factScope: "provenance_metadata",
        method: "photographic_metadata_audit",
        reason: "EXIF and GPS coordinates match cultivation site",
        verifiedPartyReference: "Apex Quality Auditors",
        withdrawalEventId: null,
        actorId: "auditor-1",
        occurredAt: now
      }
    ],
    derivatives: [
      {
        derivativeId: sampleUuid,
        clientId: sampleUuid,
        evidenceId: sampleUuid,
        evidenceRevision: 1,
        referenceAssetId: sampleUuid,
        derivativeSha256: "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
        transformDescription: "WebP 400x400 thumbnail downscale",
        transformToolVersion: null,
        createdBy: "user-1",
        createdAt: now
      }
    ]
  }
];

describe("SourceInspectionPanel", () => {
  it("renders evidence metadata without raw internal paths or secrets", () => {
    const html = renderToStaticMarkup(
      <SourceInspectionPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        evidence={mockEvidence}
        onDossierUpdated={vi.fn()}
      />
    );

    // Safe projections present
    expect(html).toContain("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    expect(html).toContain("4.00 MiB");
    expect(html).toContain("image/png");
    expect(html).toContain("Hero trichome macro capture");
    expect(html).toContain("Apex Quality Auditors");
    expect(html).toContain("WebP 400x400 thumbnail downscale");

    // Provenance badges present
    expect(html).toContain("Independently Sourced");
    expect(html).toContain("Derivative");

    // Ensure raw filesystem or bucket keys are not surfaced
    expect(html).not.toContain("/var/lib/minio");
    expect(html).not.toContain("s3://");
    expect(html).not.toContain("/storage/");
  });

  it("renders empty state when no evidence registered", () => {
    const html = renderToStaticMarkup(
      <SourceInspectionPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        evidence={[]}
        onDossierUpdated={vi.fn()}
      />
    );

    expect(html).toContain("No source evidence registered");
  });

  it("renders rights, consent, submitter provenance and revision lineage", () => {
    const multiRevEvidence: DossierEvidenceItem[] = [
      {
        ...mockEvidence[0]!,
        revisions: [
          mockEvidence[0]!.currentRevision!,
          {
            ...mockEvidence[0]!.currentRevision!,
            revision: 2,
            sourceObjectId: "44444444-4444-4444-4444-444444444444",
            assertionText: "Replacement higher-res scan",
            supersedesRevision: 1,
            rightsStatus: "unknown",
            consentStatus: "unknown"
          }
        ],
        sourceObjects: [
          mockEvidence[0]!.sourceObjects[0]!,
          {
            sourceObjectId: "44444444-4444-4444-4444-444444444444",
            originalSha256: "9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff",
            byteLength: 8388608,
            detectedMimeType: "image/png",
            uploadedAt: now,
            uploaderId: "user-2",
            accessClass: "restricted_original",
            retentionClass: "source_evidence_archive",
            retentionPolicyVersion: "1.0",
            availability: "available"
          }
        ],
        verificationEvents: [
          mockEvidence[0]!.verificationEvents[0]!,
          {
            eventId: "55555555-5555-5555-5555-555555555555",
            clientId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 2,
            verificationKind: "human_internal_review",
            outcome: "withdrawn",
            factScope: "provenance_metadata",
            method: "internal_exif_review",
            reason: "Incorrect camera serial number recorded",
            verifiedPartyReference: null,
            withdrawalEventId: null,
            actorId: "internal-reviewer",
            occurredAt: now
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <SourceInspectionPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        evidence={multiRevEvidence}
        onDossierUpdated={vi.fn()}
      />
    );

    // Provenance details
    expect(html).toContain("Rights: granted");
    expect(html).toContain("Consent: granted");
    expect(html).toContain("Photographer work-for-hire contract");
    expect(html).toContain("Submitter: director-photographer");

    // Revision lineage rendered
    expect(html).toContain("Evidence Revision Lineage (2)");
    expect(html).toContain("Rev 1");
    expect(html).toContain("Rev 2");
    expect(html).toContain("supersedes Rev 1");
    expect(html).toContain("Inspect Rev 1 Media");
    expect(html).toContain("Inspect Rev 2 Media");

    // Verification event with revision and status
    expect(html).toContain("withdrawn • provenance_metadata (Rev 2)");
  });

  it("adversarial provenance: disputed, rejected, and internal review events are never badged as Independently Sourced", () => {
    const adversarialEventsEvidence: DossierEvidenceItem[] = [
      {
        ...mockEvidence[0]!,
        verificationEvents: [
          {
            eventId: "11111111-1111-1111-1111-111111111111",
            clientId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 1,
            verificationKind: "independent_third_party_corroboration",
            outcome: "disputed",
            factScope: "provenance_metadata",
            method: "audit",
            reason: "Third party dispute logged",
            verifiedPartyReference: "Lab Corp",
            withdrawalEventId: null,
            actorId: "actor-1",
            occurredAt: now
          },
          {
            eventId: "22222222-2222-2222-2222-222222222222",
            clientId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 1,
            verificationKind: "independent_third_party_corroboration",
            outcome: "rejected",
            factScope: "provenance_metadata",
            method: "audit",
            reason: "Signature rejected",
            verifiedPartyReference: "Lab Corp",
            withdrawalEventId: null,
            actorId: "actor-2",
            occurredAt: now
          },
          {
            eventId: "33333333-3333-3333-3333-333333333333",
            clientId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 1,
            verificationKind: "human_internal_review",
            outcome: "verified",
            factScope: "provenance_metadata",
            method: "internal_review",
            reason: "Internal operator check",
            verifiedPartyReference: null,
            withdrawalEventId: null,
            actorId: "operator-1",
            occurredAt: now
          },
          {
            eventId: "44444444-4444-4444-4444-444444444444",
            clientId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 1,
            verificationKind: "submitter_attestation",
            outcome: "verified",
            factScope: "provenance_metadata",
            method: "attestation",
            reason: "Photographer attestation",
            verifiedPartyReference: null,
            withdrawalEventId: null,
            actorId: "photographer-1",
            occurredAt: now
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <SourceInspectionPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        evidence={adversarialEventsEvidence}
        onDossierUpdated={vi.fn()}
      />
    );

    // Disputed and rejected are blocked
    expect(html).toContain("disputed • provenance_metadata (Rev 1)");
    expect(html).toContain("rejected • provenance_metadata (Rev 1)");

    // Internal review is Operator Reviewed
    expect(html).toContain("Operator Reviewed • provenance_metadata (Rev 1)");

    // Submitter attestation is Submitter Attested
    expect(html).toContain("Submitter Attested • provenance_metadata (Rev 1)");

    // Crucially: none of these should produce an "Independently Sourced" badge
    expect(html).not.toContain("Independently Sourced");
  });
});
