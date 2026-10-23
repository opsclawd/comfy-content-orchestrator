import type { BatchOriginKind, DateOnlyString, IsoTimestampString } from "@cco/shared";
import type {
  ActionId,
  BatchFactsRevision,
  BatchId,
  ClientId,
  EvidenceId,
  InitialBatchFactsInput,
  ProductBatch,
  ProductBatchCreationResult,
  ProductSku,
  SkuId
} from "@cco/domain";

// ============================================================================
// Command DTOs and Envelopes (ADR 0009 §8.3 & U5)
// ============================================================================

/**
 * Trusted command envelope containing authenticated client scope,
 * server-assigned actionId, authorized actor identity, and server timestamp.
 */
export interface CommandEnvelope<T> {
  readonly actionId: ActionId;
  readonly clientId: ClientId;
  readonly actorId: string;
  readonly timestamp: IsoTimestampString;
  readonly payload: T;
}

export interface CreateSkuCommand {
  readonly canonicalSku: string;
  readonly displayName: string;
}

export { type InitialBatchFactsInput } from "@cco/domain";

export interface CreateBatchCommand {
  readonly skuId: SkuId;
  readonly lotIdentifier: string;
  readonly displayName: string;
  readonly initialFacts?: InitialBatchFactsInput | undefined;
}

export interface AppendBatchFactsCommand {
  readonly batchId: BatchId;
  readonly expectedVersion: number;
  readonly originKind: BatchOriginKind;
  readonly producerIdentityAsClaimed: string | null;
  readonly productionStartDate: DateOnlyString | null;
  readonly productionEndDate: DateOnlyString | null;
  readonly originEvidenceId: EvidenceId | null;
  readonly originEvidenceRevision: number | null;
}

export interface UpdateSkuMetadataCommand {
  readonly skuId: SkuId;
  readonly expectedVersion: number;
  readonly displayName: string;
}

export interface UpdateBatchMetadataCommand {
  readonly batchId: BatchId;
  readonly expectedVersion: number;
  readonly displayName: string;
}

export interface ArchiveSkuCommand {
  readonly skuId: SkuId;
  readonly expectedVersion: number;
}

export interface ArchiveBatchCommand {
  readonly batchId: BatchId;
  readonly expectedVersion: number;
}

// ============================================================================
// Transition and Audit Results (ADR 0009 §5 & U2)
// ============================================================================

export { type ProductBatchCreationResult } from "@cco/domain";

export interface ProductSkuUpdateResult {
  readonly sku: ProductSku;
  readonly audit: {
    readonly previous: ProductSku;
    readonly current: ProductSku;
  };
}

export interface ProductBatchUpdateResult {
  readonly batch: ProductBatch;
  readonly audit: {
    readonly previous: ProductBatch;
    readonly current: ProductBatch;
  };
}

export interface ProductSkuArchiveResult {
  readonly sku: ProductSku;
  readonly audit: {
    readonly previous: ProductSku;
    readonly current: ProductSku;
  };
}

export interface ProductBatchArchiveResult {
  readonly batch: ProductBatch;
  readonly audit: {
    readonly previous: ProductBatch;
    readonly current: ProductBatch;
  };
}

// ============================================================================
// Repository Port Interface (ADR 0009 §8.4)
// ============================================================================

/**
 * Product-only repository port governing tenant-scoped ProductSku, ProductBatch,
 * and append-only BatchFactsRevision persistence.
 *
 * Persisted relational and concurrency guarantees:
 * 1. Tenant Isolation: Every operation is strictly scoped to `clientId`.
 * 2. Permanent Uniqueness:
 *    - `(client_id, canonical_sku)` is unique across all active and archived SKUs.
 *    - `(client_id, sku_id, lot_identifier)` is unique across all active and archived batches.
 * 3. Atomic Batch Creation:
 *    - `createBatch` persists the batch head (`version = 1, current_facts_revision = 1`)
 *      and its initial facts revision 1 in a single transaction.
 * 4. Atomic Facts Append:
 *    - `appendBatchFacts` inserts the next facts revision and advances the batch head
 *      (`version = version + 1, current_facts_revision = revision`) under an `expectedVersion` check.
 * 5. Optimistic Concurrency Control:
 *    - Metadata updates and archives check `expectedVersion` at commit time;
 *      mismatch aborts with `STALE_REVISION_CONFLICT`.
 * 6. Audit Preservation:
 *    - Mutation outputs carry before/after snapshots for durable audit logging.
 * 7. Receipt-First Replay:
 *    - Commands submitted with an already-committed `(client_id, action_id)` and matching
 *      payload SHA-256 replay the stored result without re-executing. Reused actionIds
 *      with altered payloads abort with `IDEMPOTENCY_CONFLICT`.
 * 8. Future Origin Evidence Precondition:
 *    - A non-null `(originEvidenceId, originEvidenceRevision)` asserts a lineage identifier,
 *      which future persistence (#473) must verify against `batch_evidence_links` of the
 *      same client and batch.
 */
export interface ProductEvidenceRepositoryPort {
  // Mutating Commands (enveloped with actionId, clientId, actorId, timestamp)
  createSku(cmd: CommandEnvelope<CreateSkuCommand>): Promise<ProductSku>;
  createBatch(cmd: CommandEnvelope<CreateBatchCommand>): Promise<ProductBatchCreationResult>;
  appendBatchFacts(cmd: CommandEnvelope<AppendBatchFactsCommand>): Promise<BatchFactsRevision>;
  updateSkuMetadata(
    cmd: CommandEnvelope<UpdateSkuMetadataCommand>
  ): Promise<ProductSkuUpdateResult>;
  updateBatchMetadata(
    cmd: CommandEnvelope<UpdateBatchMetadataCommand>
  ): Promise<ProductBatchUpdateResult>;
  archiveSku(cmd: CommandEnvelope<ArchiveSkuCommand>): Promise<ProductSkuArchiveResult>;
  archiveBatch(cmd: CommandEnvelope<ArchiveBatchCommand>): Promise<ProductBatchArchiveResult>;

  // Client-Scoped Read and Historical Ledger Queries
  getSkuById(clientId: ClientId, skuId: SkuId): Promise<ProductSku | null>;
  listSkus(
    clientId: ClientId,
    filter?: { readonly includeArchived?: boolean | undefined }
  ): Promise<readonly ProductSku[]>;
  getBatchById(clientId: ClientId, batchId: BatchId): Promise<ProductBatch | null>;
  getBatchHistory(clientId: ClientId, batchId: BatchId): Promise<readonly BatchFactsRevision[]>;
  listBatches(
    clientId: ClientId,
    filter?: {
      readonly skuId?: SkuId | undefined;
      readonly includeArchived?: boolean | undefined;
    }
  ): Promise<readonly ProductBatch[]>;
}
