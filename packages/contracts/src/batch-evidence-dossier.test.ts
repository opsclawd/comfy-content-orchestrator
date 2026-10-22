import { describe, expect, it } from "vitest";
import { BatchEvidenceDossierSchema, type BatchEvidenceDossier } from "./batch-evidence-dossier.js";

describe("BatchEvidenceDossier contract", () => {
  const sampleUuid = "11111111-1111-4111-8111-111111111111";
  const sampleSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const now = "2026-10-21T12:00:00.000Z";

  const createSampleDossier = (): BatchEvidenceDossier => ({
    schemaVersion: "1.0.0",
    clientId: sampleUuid,
    sku: {
      clientId: sampleUuid,
      skuId: sampleUuid,
      canonicalSku: "SKU-TEST-001",
      displayName: "Test SKU Product",
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    },
    batch: {
      clientId: sampleUuid,
      batchId: sampleUuid,
      skuId: sampleUuid,
      lotIdentifier: "LOT-2026-001",
      displayName: "Test Lot 001",
      version: 1,
      currentFactsRevision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    },
    factsHistory: [
      {
        clientId: sampleUuid,
        batchId: sampleUuid,
        revision: 1,
        originKind: "partner_origin",
        producerIdentityAsClaimed: "Farm Co",
        productionStartDate: "2026-01-01",
        productionEndDate: "2026-01-15",
        originEvidenceId: null,
        originEvidenceRevision: null,
        assertedBy: "user-1",
        assertedAt: now,
        supersedesRevision: null
      }
    ],
    evidenceLinks: [
      {
        clientId: sampleUuid,
        batchId: sampleUuid,
        evidenceId: sampleUuid,
        evidenceRevision: 1,
        purpose: "coa_test_report",
        assertedBy: "user-1",
        assertedAt: now
      }
    ],
    evidence: [
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
          submittedBy: "user-1",
          submittedAt: now,
          assertionText: "CoA PDF from Testing Lab",
          reportedCaptureDate: "2026-01-20",
          reportedCaptureTimestamp: null,
          reportedCapturePrecision: "date",
          captureContext: null,
          rightsStatus: "granted",
          consentStatus: "granted",
          rightsAttribution: null,
          rightsDocumentLocator: null,
          supersedesRevision: null
        },
        revisions: [],
        sourceObjects: [
          {
            sourceObjectId: sampleUuid,
            originalSha256: sampleSha,
            detectedMimeType: "application/pdf",
            byteLength: 45000,
            uploadedAt: now,
            uploaderId: "user-1",
            accessClass: "restricted_original",
            retentionClass: "source_evidence_archive",
            retentionPolicyVersion: "policy-v1",
            availability: "available"
          }
        ],
        derivatives: [],
        verificationEvents: [
          {
            clientId: sampleUuid,
            eventId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 1,
            outcome: "verified",
            verificationKind: "independent_third_party_corroboration",
            factScope: "lab_identity",
            actorId: "system:verifier",
            occurredAt: now,
            method: "sha256_readback",
            reason: "Initial readback verification passed",
            verifiedPartyReference: null,
            withdrawalEventId: null
          }
        ]
      }
    ],
    coaReports: [
      {
        report: {
          clientId: sampleUuid,
          reportId: sampleUuid,
          batchId: sampleUuid,
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
          reportIdentifierAsClaimed: "REP-9999",
          reportDate: "2026-01-21",
          labNameAsClaimed: "Analytical Testing Labs",
          sampleIdentifierAsClaimed: "SMP-1234",
          scopeKind: "attributed_lot",
          scopeDescription: "Lot representative sample",
          sampleDate: "2026-01-19",
          samplingMethodDescription: "Composite core sampling",
          sampleToBatchAssociationAttestation: "Certified sample",
          sampleToBatchAssociationConfirmed: true,
          verifiedLabIdentityEventId: null,
          assertedBy: "user-1",
          assertedAt: now,
          supersedesRevision: null,
          measurements: [
            {
              measurementId: sampleUuid,
              clientId: sampleUuid,
              reportId: sampleUuid,
              reportRevision: 1,
              batchId: sampleUuid,
              evidenceId: sampleUuid,
              evidenceRevision: 1,
              analyte: "Total Cannabinoids",
              resultKind: "quantified",
              resultValue: "24.5000",
              resultLimit: null,
              resultQualifier: null,
              unit: "percent",
              basis: "dry_weight",
              context: "finished_product",
              quantityKind: "mass_fraction",
              methodAsReported: "HPLC-UV",
              uncertaintyAbsolute: "0.2500",
              detectionLimit: "0.0100",
              quantificationLimit: "0.0500",
              analyticalQualifierCode: null,
              analyticalQualifierExplanation: null
            }
          ]
        },
        revisions: [],
        reviewEvents: [
          {
            eventId: sampleUuid,
            clientId: sampleUuid,
            reportId: sampleUuid,
            reportRevision: 1,
            decision: "approved",
            actorId: "compliance-reviewer-1",
            occurredAt: now,
            reason: "Lab transcript verified against PDF",
            assessedScope: "attributed_lot"
          }
        ]
      }
    ],
    claims: [
      {
        claim: {
          claimId: sampleUuid,
          clientId: sampleUuid,
          skuId: sampleUuid,
          batchId: sampleUuid,
          currentRevision: 1,
          state: "reviewer_approved",
          version: 2,
          invalidationCause: null,
          invalidationSourceRef: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null
        },
        currentRevision: {
          clientId: sampleUuid,
          claimId: sampleUuid,
          revision: 1,
          batchId: sampleUuid,
          canonicalKind: "certificate_panel_measurement",
          proofCategory: "coa_measurement_backed",
          parameters: {
            kind: "certificate_panel_measurement",
            measurements: [
              {
                analyte: "Total Cannabinoids",
                exactDecimalValue: "24.5000",
                unit: "percent",
                quantityKind: "mass_fraction",
                basis: "dry_weight",
                context: "finished_product",
                requiredScope: "attributed_lot"
              }
            ]
          },
          displayWording: "Contains 24.5000% total cannabinoids",
          policyVersion: "claim_policy_v1",
          assertedBy: "user-1",
          assertedAt: now,
          supersedesRevision: null
        },
        revisions: [],
        links: [
          {
            linkId: sampleUuid,
            clientId: sampleUuid,
            claimId: sampleUuid,
            claimRevision: 1,
            batchId: sampleUuid,
            evidenceId: sampleUuid,
            evidenceRevision: 1,
            sourceObjectId: sampleUuid,
            sourceSha256: sampleSha,
            supportRole: "primary_measurement",
            reportId: sampleUuid,
            reportRevision: 1,
            measurementId: sampleUuid
          }
        ],
        decisionEvents: [
          {
            eventId: sampleUuid,
            clientId: sampleUuid,
            claimId: sampleUuid,
            claimRevision: 1,
            decision: "approve",
            actorId: "legal-reviewer-1",
            occurredAt: now,
            reason: "Approved based on valid CoA",
            policyVersion: "claim_policy_v1",
            dependencyFingerprint: "fingerprint-123"
          }
        ],
        resolution: {
          claim: {
            claimId: sampleUuid,
            clientId: sampleUuid,
            skuId: sampleUuid,
            batchId: sampleUuid,
            currentRevision: 1,
            state: "reviewer_approved",
            version: 2,
            invalidationCause: null,
            invalidationSourceRef: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null
          },
          revision: {
            clientId: sampleUuid,
            claimId: sampleUuid,
            revision: 1,
            batchId: sampleUuid,
            canonicalKind: "certificate_panel_measurement",
            proofCategory: "coa_measurement_backed",
            parameters: {
              kind: "certificate_panel_measurement",
              measurements: [
                {
                  analyte: "Total Cannabinoids",
                  exactDecimalValue: "24.5000",
                  unit: "percent",
                  quantityKind: "mass_fraction",
                  basis: "dry_weight",
                  context: "finished_product",
                  requiredScope: "attributed_lot"
                }
              ]
            },
            displayWording: "Contains 24.5000% total cannabinoids",
            policyVersion: "claim_policy_v1",
            assertedBy: "user-1",
            assertedAt: now,
            supersedesRevision: null
          },
          supportEligible: true,
          canRequestReview: false,
          evidenceLinkApproved: true,
          provenanceCategory: "lab_reported",
          displayWordingStatus: "manual_review_approved",
          blockReasons: [],
          links: [
            {
              linkId: sampleUuid,
              clientId: sampleUuid,
              claimId: sampleUuid,
              claimRevision: 1,
              batchId: sampleUuid,
              evidenceId: sampleUuid,
              evidenceRevision: 1,
              sourceObjectId: sampleUuid,
              sourceSha256: sampleSha,
              supportRole: "primary_measurement",
              reportId: sampleUuid,
              reportRevision: 1,
              measurementId: sampleUuid
            }
          ],
          reviewEvents: [
            {
              eventId: sampleUuid,
              clientId: sampleUuid,
              claimId: sampleUuid,
              claimRevision: 1,
              decision: "approve",
              actorId: "legal-reviewer-1",
              occurredAt: now,
              reason: "Approved based on valid CoA",
              policyVersion: "claim_policy_v1",
              dependencyFingerprint: "fingerprint-123"
            }
          ],
          dependencyFingerprint: "fingerprint-123"
        }
      }
    ],
    resolvedAt: now
  });

  it("successfully parses a complete, valid BatchEvidenceDossier", () => {
    const dossier = createSampleDossier();
    const result = BatchEvidenceDossierSchema.safeParse(dossier);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe("1.0.0");
      expect(result.data.sku.canonicalSku).toBe("SKU-TEST-001");
      expect(result.data.batch.lotIdentifier).toBe("LOT-2026-001");
      expect(result.data.coaReports[0]?.currentRevision.measurements[0]?.resultValue).toBe(
        "24.5000"
      );
    }
  });

  it("preserves exact decimal strings 24.5000 and 0.2500 without numeric coercion", () => {
    const dossier = createSampleDossier();
    const parsed = BatchEvidenceDossierSchema.parse(dossier);
    const measurement = parsed.coaReports[0]!.currentRevision.measurements[0]!;
    expect(measurement.resultValue).toBe("24.5000");
    expect(measurement.uncertaintyAbsolute).toBe("0.2500");
    expect(typeof measurement.resultValue).toBe("string");
    expect(typeof measurement.uncertaintyAbsolute).toBe("string");
  });

  it("rejects when internal storage locator is injected into sourceObjects", () => {
    const dossier = createSampleDossier() as unknown as Record<string, unknown>;
    const evidenceItem = (dossier.evidence as Record<string, unknown>[])[0]!;
    const sourceObj = (evidenceItem.sourceObjects as Record<string, unknown>[])[0]!;
    sourceObj.storageBucket = "leaked-bucket";

    const result = BatchEvidenceDossierSchema.safeParse(dossier);
    expect(result.success).toBe(false);
  });

  it("rejects when schemaVersion is invalid or missing", () => {
    const dossier = createSampleDossier() as unknown as Record<string, unknown>;
    dossier.schemaVersion = "2.0.0";
    const result = BatchEvidenceDossierSchema.safeParse(dossier);
    expect(result.success).toBe(false);
  });
});
