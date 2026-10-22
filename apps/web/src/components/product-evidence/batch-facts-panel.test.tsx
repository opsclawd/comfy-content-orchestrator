import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BatchFactsRevisionResponse, ProductBatchResponse } from "@cco/contracts";
import { BatchFactsPanel } from "./batch-facts-panel.js";

const sampleUuid = "44444444-4444-4444-4444-444444444444";
const now = "2026-10-21T18:00:00.000Z";

const mockBatch: ProductBatchResponse = {
  clientId: sampleUuid,
  batchId: sampleUuid,
  skuId: sampleUuid,
  lotIdentifier: "LOT-BATCH-99",
  displayName: "Fall Harvest Batch",
  version: 2,
  currentFactsRevision: 2,
  createdAt: now,
  updatedAt: now,
  archivedAt: null
};

const mockFactsHistory: BatchFactsRevisionResponse[] = [
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
    assertedBy: "intake-bot",
    assertedAt: now,
    supersedesRevision: null
  },
  {
    clientId: sampleUuid,
    batchId: sampleUuid,
    revision: 2,
    originKind: "own_production",
    producerIdentityAsClaimed: "Apex Cultivation Farm",
    productionStartDate: "2026-09-01",
    productionEndDate: "2026-09-20",
    originEvidenceId: null,
    originEvidenceRevision: null,
    assertedBy: "grow-director",
    assertedAt: now,
    supersedesRevision: 1
  }
];

describe("BatchFactsPanel", () => {
  it("renders current facts revision and historical revisions", () => {
    const html = renderToStaticMarkup(
      <BatchFactsPanel
        clientId={sampleUuid}
        batch={mockBatch}
        factsHistory={mockFactsHistory}
        onDossierUpdated={vi.fn()}
      />
    );

    expect(html).toContain("Active Facts Revision 2");
    expect(html).toContain("Apex Cultivation Farm");
    expect(html).toContain("2026-09-01");
    expect(html).toContain("2026-09-20");
    expect(html).toContain("own_production");
    expect(html).toContain("Asserted by grow-director");
  });
});
