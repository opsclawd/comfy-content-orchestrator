import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { DossierClaimItem } from "@cco/contracts";
import { ProductClaimsPanel } from "./product-claims-panel.js";

const sampleUuid = "55555555-5555-5555-5555-555555555555";
const now = "2026-10-21T18:00:00.000Z";

const mockClaims: DossierClaimItem[] = [
  {
    claim: {
      clientId: sampleUuid,
      skuId: sampleUuid,
      batchId: sampleUuid,
      claimId: sampleUuid,
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
      parameters: {
        kind: "certificate_panel_measurement",
        panelName: "Cannabinoid Potency",
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
      displayWording: "Potent 24.5000% THC by dry weight",
      proofCategory: "coa_measurement_backed",
      policyVersion: "1.0.0",
      supersedesRevision: null,
      assertedBy: "operator-1",
      assertedAt: now
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
        sourceSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        supportRole: "primary_measurement",
        pinnedFactsRevision: 1
      }
    ],
    decisionEvents: [],
    resolution: {
      claim: {
        clientId: sampleUuid,
        skuId: sampleUuid,
        batchId: sampleUuid,
        claimId: sampleUuid,
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
        parameters: {
          kind: "certificate_panel_measurement",
          panelName: "Cannabinoid Potency",
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
        displayWording: "Potent 24.5000% THC by dry weight",
        proofCategory: "coa_measurement_backed",
        policyVersion: "1.0.0",
        supersedesRevision: null,
        assertedBy: "operator-1",
        assertedAt: now
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
          sourceSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          supportRole: "primary_measurement",
          pinnedFactsRevision: 1
        }
      ],
      reviewEvents: [],
      dependencyFingerprint: "fingerprint-valid"
    }
  }
];

describe("ProductClaimsPanel", () => {
  it("renders product claims, parameters, eligible status, and display copy", () => {
    const html = renderToStaticMarkup(
      <ProductClaimsPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        claims={mockClaims}
        availableEvidence={[]}
        availableCoas={[]}
        onDossierUpdated={vi.fn()}
      />
    );

    expect(html).toContain("certificate_panel_measurement");
    expect(html).toContain("Potent 24.5000% THC by dry weight");
    expect(html).toContain("Support Eligible");
    expect(html).toContain("coa_measurement_backed");
    expect(html).toContain("lab_reported");
    expect(html).toContain("primary_measurement");
    expect(html).toContain("Asserted by:");
    expect(html).toContain("operator-1");
    expect(html).toContain(`href="#evidence-revision-${sampleUuid}-1"`);
  });

  it("renders blocked reasons with dependencyId and claim revision history", () => {
    const blockedClaimWithLineage: DossierClaimItem = {
      ...mockClaims[0]!,
      revisions: [
        mockClaims[0]!.currentRevision,
        {
          ...mockClaims[0]!.currentRevision,
          revision: 2,
          supersedesRevision: 1,
          displayWording: "Revised 25% THC claim",
          assertedBy: "operator-2",
          assertedAt: now
        }
      ],
      currentRevision: {
        ...mockClaims[0]!.currentRevision,
        revision: 2,
        supersedesRevision: 1,
        displayWording: "Revised 25% THC claim",
        assertedBy: "operator-2",
        assertedAt: now
      },
      resolution: {
        ...mockClaims[0]!.resolution,
        supportEligible: false,
        blockReasons: [
          {
            code: "SCOPE_INSUFFICIENT",
            message: "Assessed CoA scope does not cover attributed lot.",
            dependencyId: "dep-scope-err-123"
          }
        ]
      }
    };

    const html = renderToStaticMarkup(
      <ProductClaimsPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        claims={[blockedClaimWithLineage]}
        availableEvidence={[]}
        availableCoas={[]}
        onDossierUpdated={vi.fn()}
      />
    );

    // Block reason and dependency ID
    expect(html).toContain("SCOPE_INSUFFICIENT");
    expect(html).toContain("(dep-scope-err-123)");
    expect(html).toContain("Support Blocked");

    // Lineage
    expect(html).toContain("Claim Revision History (2)");
    expect(html).toContain("Rev 1");
    expect(html).toContain("Rev 2");
    expect(html).toContain("operator-2");
    expect(html).toContain("Revised 25% THC claim");
  });

  it("renders empty state when no claims exist", () => {
    const html = renderToStaticMarkup(
      <ProductClaimsPanel
        clientId={sampleUuid}
        batchId={sampleUuid}
        claims={[]}
        availableEvidence={[]}
        availableCoas={[]}
        onDossierUpdated={vi.fn()}
      />
    );

    expect(html).toContain("No product claims proposed");
  });
});
