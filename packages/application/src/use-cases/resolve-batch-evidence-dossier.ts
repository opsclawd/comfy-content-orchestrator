import type { BatchId, ClientId } from "@cco/domain";
import type { BatchEvidenceDossier } from "@cco/contracts";
import type { BatchEvidenceDossierQueries } from "../ports/batch-evidence-dossier-queries.js";

export interface ResolveBatchEvidenceDossierInput {
  readonly clientId: ClientId;
  readonly batchId: BatchId;
}

export class ResolveBatchEvidenceDossierUseCase {
  constructor(private readonly dossierQueries: BatchEvidenceDossierQueries) {}

  async execute(input: ResolveBatchEvidenceDossierInput): Promise<BatchEvidenceDossier> {
    return this.dossierQueries.resolveDossier(input.clientId, input.batchId);
  }
}
