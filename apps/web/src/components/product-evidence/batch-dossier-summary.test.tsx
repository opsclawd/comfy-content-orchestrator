import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BatchEvidenceDossier } from "@cco/contracts";
import { BatchDossierSummary } from "./batch-dossier-summary.js";

const sampleUuid = "11111111-1111-1111-1111-111111111111";
const now = "2026-10-21T18:00:00.000Z";

function createMockDossier(overrides: Partial<BatchEvidenceDossier> = {}): BatchEvidenceDossier {
  return {
    schemaVersion: "1.0.0",
    clientId: sampleUuid,
    sku: {
      clientId: sampleUuid,
      skuId: sampleUuid,
      canonicalSku: "SKU-OGKUSH-01",
      displayName: "OG Kush Cartridge 1g",
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    },
    batch: {
      clientId: sampleUuid,
      batchId: sampleUuid,
      skuId: sampleUuid,
      lotIdentifier: "LOT-2026-X1",
      displayName: "Batch X1 October",
      version: 2,
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
        originKind: "own_production",
        producerIdentityAsClaimed: "Emerald Apex Grow",
        productionStartDate: "2026-08-01",
        productionEndDate: "2026-08-15",
        originEvidenceId: null,
        originEvidenceRevision: null,
        assertedBy: "director-1",
        assertedAt: now,
        supersedesRevision: null
      }
    ],
    evidenceLinks: [],
    evidence: [],
    coaReports: [],
    claims: [],
    resolvedAt: now,
    ...overrides
  };
}

describe("BatchDossierSummary", () => {
  it("renders SKU, lot, and version identifiers", () => {
    const dossier = createMockDossier();
    const html = renderToStaticMarkup(
      <BatchDossierSummary dossier={dossier} onRefresh={vi.fn()} isRefreshing={false} />
    );

    expect(html).toContain("SKU-OGKUSH-01");
    expect(html).toContain("OG Kush Cartridge 1g");
    expect(html).toContain("LOT-2026-X1");
    expect(html).toContain("Batch X1 October");
    expect(html).toContain("Batch v2");
    expect(html).toContain("Facts Rev 1");
  });

  it("reports facts gaps when origin is unknown or production dates are missing", () => {
    const incompleteDossier = createMockDossier({
      factsHistory: [
        {
          clientId: sampleUuid,
          batchId: sampleUuid,
          revision: 1,
          originKind: "unknown",
          producerIdentityAsClaimed: null,
          productionStartDate: null,
          productionEndDate: null,
          originEvidenceId: null,
          originEvidenceRevision: null,
          assertedBy: "director-1",
          assertedAt: now,
          supersedesRevision: null
        }
      ]
    });

    const html = renderToStaticMarkup(
      <BatchDossierSummary dossier={incompleteDossier} onRefresh={vi.fn()} />
    );

    expect(html).toContain("Unknown Production Origin");
    expect(html).toContain("Unrecorded Production Dates");
  });

  it("reports blocked claims if present in dossier", () => {
    const dossierWithBlockedClaims = createMockDossier({
      claims: [
        {
          claim: {
            clientId: sampleUuid,
            skuId: sampleUuid,
            batchId: sampleUuid,
            claimId: sampleUuid,
            currentRevision: 1,
            state: "evidence_linked",
            version: 1,
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
            parameters: {
              kind: "certificate_panel_measurement",
              measurements: [
                {
                  analyte: "THC",
                  exactDecimalValue: "24.5000",
                  unit: "percent",
                  quantityKind: "mass_fraction",
                  basis: "dry_weight",
                  context: "cannabinoid_profile",
                  requiredScope: "attributed_lot"
                }
              ]
            },
            displayWording: null,
            proofCategory: "coa_measurement_backed",
            policyVersion: "1.0.0",
            supersedesRevision: null,
            assertedBy: "user-1",
            assertedAt: now
          },
          revisions: [],
          links: [],
          decisionEvents: [],
          resolution: {
            claim: {
              clientId: sampleUuid,
              skuId: sampleUuid,
              batchId: sampleUuid,
              claimId: sampleUuid,
              currentRevision: 1,
              state: "evidence_linked",
              version: 1,
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
              parameters: {
                kind: "certificate_panel_measurement",
                measurements: [
                  {
                    analyte: "THC",
                    exactDecimalValue: "24.5000",
                    unit: "percent",
                    quantityKind: "mass_fraction",
                    basis: "dry_weight",
                    context: "cannabinoid_profile",
                    requiredScope: "attributed_lot"
                  }
                ]
              },
              displayWording: null,
              proofCategory: "coa_measurement_backed",
              policyVersion: "1.0.0",
              supersedesRevision: null,
              assertedBy: "user-1",
              assertedAt: now
            },
            supportEligible: false,
            canRequestReview: false,
            evidenceLinkApproved: false,
            provenanceCategory: "manual_unverified",
            displayWordingStatus: "none",
            blockReasons: [
              {
                code: "EVIDENCE_LINKS_MISSING",
                message: "Claim has no verified supporting evidence links"
              }
            ],
            links: [],
            reviewEvents: [],
            dependencyFingerprint: "fingerprint-1"
          }
        }
      ]
    });

    const html = renderToStaticMarkup(
      <BatchDossierSummary dossier={dossierWithBlockedClaims} onRefresh={vi.fn()} />
    );

    expect(html).toContain("1 Blocked");
    expect(html).toContain('data-testid="summary-claims-readiness"');
  });

  it("renders detail navigation links to all four batch sections", () => {
    const dossier = createMockDossier();
    const html = renderToStaticMarkup(
      <BatchDossierSummary dossier={dossier} onRefresh={vi.fn()} />
    );

    expect(html).toContain('href="#batch-facts-section"');
    expect(html).toContain('data-testid="link-batch-facts-detail"');
    expect(html).toContain('href="#source-evidence-section"');
    expect(html).toContain('data-testid="link-source-evidence-detail"');
    expect(html).toContain('href="#coa-reports-section"');
    expect(html).toContain('data-testid="link-coa-reports-detail"');
    expect(html).toContain('href="#product-claims-section"');
    expect(html).toContain('data-testid="link-product-claims-detail"');
    expect(html).toContain('data-testid="link-facts-gaps-detail"');
  });
});
