import { describe, expect, it, vi } from "vitest";
import { createBatchId, createClientId } from "@cco/domain";
import type { BatchEvidenceDossier } from "@cco/contracts";
import type { BatchEvidenceDossierQueries } from "../ports/batch-evidence-dossier-queries.js";
import { ResolveBatchEvidenceDossierUseCase } from "./resolve-batch-evidence-dossier.js";

describe("ResolveBatchEvidenceDossierUseCase", () => {
  const clientId = createClientId("11111111-1111-4111-8111-111111111111");
  const batchId = createBatchId("22222222-2222-4222-8222-222222222222");

  const mockDossier: BatchEvidenceDossier = {
    schemaVersion: "1.0.0",
    clientId,
    sku: {} as unknown as BatchEvidenceDossier["sku"],
    batch: {} as unknown as BatchEvidenceDossier["batch"],
    factsHistory: [],
    evidenceLinks: [],
    evidence: [],
    coaReports: [],
    claims: [],
    resolvedAt: "2026-10-21T12:00:00.000Z"
  };

  it("delegates to BatchEvidenceDossierQueries adapter", async () => {
    const queries: BatchEvidenceDossierQueries = {
      resolveDossier: vi.fn(async () => mockDossier)
    };

    const useCase = new ResolveBatchEvidenceDossierUseCase(queries);
    const result = await useCase.execute({ clientId, batchId });

    expect(result).toBe(mockDossier);
    expect(queries.resolveDossier).toHaveBeenCalledWith(clientId, batchId);
  });
});
