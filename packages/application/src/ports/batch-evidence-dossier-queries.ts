import type { BatchId, ClientId } from "@cco/domain";
import type { BatchEvidenceDossier } from "@cco/contracts";

export interface BatchEvidenceDossierQueries {
  resolveDossier(clientId: ClientId, batchId: BatchId): Promise<BatchEvidenceDossier>;
}
