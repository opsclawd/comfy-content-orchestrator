import type {
  BatchFactsRevisionResponse,
  ProductBatchCreationResultResponse,
  ProductBatchResponse,
  ProductSkuResponse
} from "@cco/contracts";
import type {
  BatchFactsRevision,
  ProductBatch,
  ProductBatchCreationResult,
  ProductSku
} from "@cco/domain";

/**
 * Serializes a domain ProductSku snapshot into an allowlisted, wire-safe ProductSkuResponse DTO.
 * Explicitly copies allowlisted fields and ensures explicit nulls for optional fields.
 * Prevents internal properties or storage references from leaking through the contract boundary.
 */
export function serializeProductSku(sku: ProductSku): ProductSkuResponse {
  return {
    clientId: sku.clientId,
    skuId: sku.skuId,
    canonicalSku: sku.canonicalSku,
    displayName: sku.displayName,
    version: sku.version,
    createdAt: sku.createdAt,
    updatedAt: sku.updatedAt,
    archivedAt: sku.archivedAt ?? null
  };
}

/**
 * Serializes a domain ProductBatch snapshot into an allowlisted, wire-safe ProductBatchResponse DTO.
 */
export function serializeProductBatch(batch: ProductBatch): ProductBatchResponse {
  return {
    clientId: batch.clientId,
    batchId: batch.batchId,
    skuId: batch.skuId,
    lotIdentifier: batch.lotIdentifier,
    displayName: batch.displayName,
    version: batch.version,
    currentFactsRevision: batch.currentFactsRevision,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    archivedAt: batch.archivedAt ?? null
  };
}

/**
 * Serializes a domain BatchFactsRevision into an allowlisted, wire-safe BatchFactsRevisionResponse DTO.
 */
export function serializeBatchFactsRevision(facts: BatchFactsRevision): BatchFactsRevisionResponse {
  return {
    clientId: facts.clientId,
    batchId: facts.batchId,
    revision: facts.revision,
    originKind: facts.originKind,
    producerIdentityAsClaimed: facts.producerIdentityAsClaimed ?? null,
    productionStartDate: facts.productionStartDate ?? null,
    productionEndDate: facts.productionEndDate ?? null,
    originEvidenceId: facts.originEvidenceId ?? null,
    originEvidenceRevision: facts.originEvidenceRevision ?? null,
    assertedBy: facts.assertedBy,
    assertedAt: facts.assertedAt,
    supersedesRevision: facts.supersedesRevision ?? null
  };
}

/**
 * Serializes a domain ProductBatchCreationResult into its composite wire-safe DTO.
 */
export function serializeProductBatchCreationResult(
  result: ProductBatchCreationResult
): ProductBatchCreationResultResponse {
  return {
    batch: serializeProductBatch(result.batch),
    initialFacts: serializeBatchFactsRevision(result.initialFacts)
  };
}
