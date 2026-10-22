import type { Pool, PoolClient } from "pg";
import {
  canonicalizeUtcTimestamp,
  type ClaimState,
  type ClaimDecisionKind,
  type ClaimInvalidationCause,
  type ClaimProofCategory,
  type ClaimSupportRole,
  type CanonicalClaimKind,
  type ClaimParameters
} from "@cco/shared";
import {
  createBatchId,
  createClaimDecisionEventId,
  createClaimId,
  createClaimLinkId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  createSha256Hex,
  createSkuId,
  createSourceObjectId,
  createVerificationEventId,
  evaluateClaimEligibility,
  linkEvidenceToClaim,
  normalizeClaimParameters,
  rehydrateClaimDecisionEvent,
  rehydrateClaimEvidenceLink,
  rehydrateProductClaim,
  rehydrateProductClaimRevision,
  reviewClaim,
  invalidateClaim,
  appendClaimRevisionToHead,
  createProductClaim,
  createProductClaimRevision,
  createClaimEvidenceLink,
  AccessDeniedError,
  ClaimSupportRequiredError,
  IdempotencyConflictError,
  NotFoundError,
  ProductValidationError,
  StaleRevisionConflictError,
  type BatchId,
  type ClaimDecisionEvent,
  type ClaimEvidenceLink,
  type ClaimId,
  type ClientId,
  type LinkDependencySnapshot,
  type ProductClaim,
  type ProductClaimRevision
} from "@cco/domain";
import type {
  AppendClaimRevisionRequest,
  CreateClaimRequest,
  InvalidateClaimRequest,
  LinkClaimEvidenceRequest,
  ResolveClaimResponse,
  ReviewClaimRequest
} from "@cco/contracts";
import type {
  CommandEnvelope,
  ProductClaimCreationResult,
  ProductClaimHistory,
  ProductClaimLinkResult,
  ProductClaimRepositoryPort,
  ProductClaimReviewResult,
  ProductClaimRevisionDetail,
  ProductClaimRevisionResult
} from "@cco/application";
import {
  computePayloadSha256,
  translateDatabaseError
} from "./postgres-product-evidence-repository.js";

export interface PostgresProductClaimRepositoryOptions {
  readonly externalTransaction?: boolean;
  readonly lockTimeoutMs?: number;
}

interface ClaimRow {
  readonly claim_id: string;
  readonly client_id: string;
  readonly sku_id: string;
  readonly batch_id: string;
  readonly current_revision: number;
  readonly state: ClaimState;
  readonly version: number;
  readonly invalidation_cause: ClaimInvalidationCause | null;
  readonly invalidation_source_ref: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
}

interface ClaimRevisionRow {
  readonly client_id: string;
  readonly claim_id: string;
  readonly revision: number;
  readonly batch_id: string;
  readonly canonical_kind: CanonicalClaimKind;
  readonly proof_category: ClaimProofCategory;
  readonly parameters_json: ClaimParameters;
  readonly display_wording: string | null;
  readonly policy_version: string;
  readonly asserted_by: string;
  readonly asserted_at: Date | string;
  readonly supersedes_revision: number | null;
}

interface ClaimSourceLinkRow {
  readonly link_id: string;
  readonly client_id: string;
  readonly claim_id: string;
  readonly claim_revision: number;
  readonly batch_id: string;
  readonly evidence_id: string;
  readonly evidence_revision: number;
  readonly source_object_id: string;
  readonly source_sha256: string;
  readonly support_role: ClaimSupportRole;
  readonly report_id: string | null;
  readonly report_revision: number | null;
  readonly measurement_id: string | null;
  readonly pinned_facts_revision: number | null;
  readonly attestation_fact_kind: string | null;
  readonly attestation_fact_value: string | null;
  readonly attestation_field_locator: string | null;
  readonly attestation_attribution: string | null;
  readonly attestation_actor_id: string | null;
  readonly attestation_occurred_at: Date | string | null;
  readonly attestation_verification_event_id: string | null;
  readonly derivative_asset_id: string | null;
}

interface ClaimDecisionEventRow {
  readonly event_id: string;
  readonly client_id: string;
  readonly claim_id: string;
  readonly claim_revision: number;
  readonly decision: ClaimDecisionKind;
  readonly actor_id: string;
  readonly occurred_at: Date | string;
  readonly reason: string;
  readonly policy_version: string;
  readonly dependency_fingerprint: string | null;
  readonly invalidation_cause: ClaimInvalidationCause | null;
  readonly source_event_id: string | null;
}

interface ReceiptRow {
  readonly client_id: string;
  readonly action_id: string;
  readonly command_name: string;
  readonly payload_sha256: string;
  readonly actor_id: string;
  readonly response_body: unknown;
  readonly committed_at: Date | string;
}

function isPool(client: Pool | PoolClient): client is Pool {
  return "totalCount" in client && typeof (client as Pool).totalCount === "number";
}

function assertClientIsPoolClient(
  client: Pool | PoolClient,
  errorMessage: string
): asserts client is PoolClient {
  if (isPool(client)) {
    throw new Error(errorMessage);
  }
}

export class PostgresProductClaimRepository implements ProductClaimRepositoryPort {
  constructor(
    private readonly client: Pool | PoolClient,
    private readonly options?: PostgresProductClaimRepositoryOptions
  ) {}

  private assertTransactionActive(client: PoolClient): void {
    if (!this.options?.externalTransaction) {
      throw new Error(
        "Mutating operations must run within an active UnitOfWork transaction ('BEGIN'). Ensure PostgresUnitOfWork is used."
      );
    }

    const clientStatus =
      typeof client.getTransactionStatus === "function" ? client.getTransactionStatus() : undefined;

    if (clientStatus !== "T") {
      throw new Error(
        "Mutating operations must run within an active UnitOfWork transaction ('BEGIN'). Ensure PostgresUnitOfWork is used."
      );
    }
  }

  private async acquireOrderedLocks(
    client: PoolClient,
    clientId: string,
    targets: {
      skuId: string;
      batchId: string;
      sourceObjectIds?: readonly string[];
      evidenceIds?: readonly string[];
      reportIds?: readonly string[];
      referenceAssetIds?: readonly string[];
      claimIds?: readonly string[];
    },
    claimMode: "FOR UPDATE" | "FOR SHARE" = "FOR UPDATE"
  ): Promise<void> {
    const timeout = this.options?.lockTimeoutMs ?? 5000;
    await client.query(`SET LOCAL lock_timeout = '${timeout}ms'`);

    // 1. SKU
    await client.query(
      `SELECT sku_id, archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2 FOR SHARE`,
      [clientId, targets.skuId]
    );

    // 2. Batch
    await client.query(
      `SELECT batch_id, archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2 FOR SHARE`,
      [clientId, targets.batchId]
    );

    // 3. Source objects sorted by ID
    if (targets.sourceObjectIds && targets.sourceObjectIds.length > 0) {
      const sorted = [...new Set(targets.sourceObjectIds)].sort();
      for (const id of sorted) {
        await client.query(
          `SELECT source_object_id, availability FROM source_objects WHERE client_id = $1 AND source_object_id = $2 FOR SHARE`,
          [clientId, id]
        );
      }
    }

    // 4. Evidence assets sorted by ID
    if (targets.evidenceIds && targets.evidenceIds.length > 0) {
      const sorted = [...new Set(targets.evidenceIds)].sort();
      for (const id of sorted) {
        await client.query(
          `SELECT evidence_id, archived_at FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2 FOR SHARE`,
          [clientId, id]
        );
      }
    }

    // 5. CoA reports sorted by ID
    if (targets.reportIds && targets.reportIds.length > 0) {
      const sorted = [...new Set(targets.reportIds)].sort();
      for (const id of sorted) {
        await client.query(
          `SELECT report_id, archived_at FROM coa_reports WHERE client_id = $1 AND report_id = $2 FOR SHARE`,
          [clientId, id]
        );
      }
    }

    // 6. Reference assets sorted by ID
    if (targets.referenceAssetIds && targets.referenceAssetIds.length > 0) {
      const sorted = [...new Set(targets.referenceAssetIds)].sort();
      for (const id of sorted) {
        await client.query(
          `SELECT asset_id, archived_at FROM reference_assets WHERE client_id = $1 AND asset_id = $2 FOR SHARE`,
          [clientId, id]
        );
      }
    }

    // 7. Product claims sorted by ID
    if (targets.claimIds && targets.claimIds.length > 0) {
      const sorted = [...new Set(targets.claimIds)].sort();
      for (const id of sorted) {
        await client.query(
          `SELECT claim_id, state, version FROM product_claims WHERE client_id = $1 AND claim_id = $2 ${claimMode}`,
          [clientId, id]
        );
      }
    }
  }

  private async acquireCommandAdvisoryLock(
    client: PoolClient,
    clientId: string,
    actionId: string
  ): Promise<void> {
    const timeout = this.options?.lockTimeoutMs ?? 5000;
    await client.query(`SET LOCAL lock_timeout = '${timeout}ms'`);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('product_evidence_registry'), hashtext($1 || '::' || $2))`,
      [clientId, actionId]
    );
  }

  private async checkOrReplayReceipt<R>(
    client: PoolClient,
    cmd: CommandEnvelope<unknown>,
    commandName: string
  ): Promise<{ readonly replay: boolean; readonly result?: R; readonly payloadHash: string }> {
    const payloadHash = computePayloadSha256(cmd.payload);

    const receiptRes = await client.query<ReceiptRow>(
      `SELECT client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at
       FROM product_evidence_command_receipts
       WHERE client_id = $1 AND action_id = $2`,
      [cmd.clientId, cmd.actionId]
    );

    if (receiptRes.rows.length > 0) {
      const receipt = receiptRes.rows[0]!;
      if (
        receipt.command_name === commandName &&
        receipt.payload_sha256 === payloadHash &&
        receipt.actor_id === cmd.actorId
      ) {
        return {
          replay: true,
          result:
            typeof receipt.response_body === "string"
              ? JSON.parse(receipt.response_body)
              : (receipt.response_body as R),
          payloadHash
        };
      }
      throw new IdempotencyConflictError(cmd.actionId);
    }

    return { replay: false, payloadHash };
  }

  private async storeReceipt(
    client: PoolClient,
    cmd: CommandEnvelope<unknown>,
    commandName: string,
    payloadHash: string,
    responseBody: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO product_evidence_command_receipts (
        client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cmd.clientId,
        cmd.actionId,
        commandName,
        payloadHash,
        cmd.actorId,
        JSON.stringify(responseBody),
        cmd.timestamp
      ]
    );
  }

  async createClaim(cmd: CommandEnvelope<CreateClaimRequest>): Promise<ProductClaimCreationResult> {
    assertClientIsPoolClient(
      this.client,
      "Mutating operations require a transaction-bound PoolClient. Inject PoolClient via PostgresUnitOfWork."
    );
    this.assertTransactionActive(this.client);

    try {
      await this.acquireCommandAdvisoryLock(this.client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } =
        await this.checkOrReplayReceipt<ProductClaimCreationResult>(
          this.client,
          cmd,
          "createClaim"
        );
      if (replay && result) {
        return {
          claim: rehydrateProductClaim(result.claim),
          revision: rehydrateProductClaimRevision(result.revision)
        };
      }

      // 1. Discover batch & SKU
      const batchRes = await this.client.query<{ sku_id: string; archived_at: Date | null }>(
        `SELECT sku_id, archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (batchRes.rows.length === 0) {
        throw new NotFoundError("ProductBatch", cmd.payload.batchId);
      }
      if (batchRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product batch is archived.", "BATCH_ARCHIVED");
      }
      const skuId = createSkuId(batchRes.rows[0]!.sku_id);

      // Lock SKU & Batch
      await this.acquireOrderedLocks(this.client, cmd.clientId, {
        skuId,
        batchId: cmd.payload.batchId
      });

      // Verify under lock
      const lockedBatchRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, cmd.payload.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product batch is archived.", "BATCH_ARCHIVED");
      }
      const lockedSkuRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product SKU is archived.", "SKU_ARCHIVED");
      }

      // 2. Build domain claim & revision
      const domainClaim = createProductClaim({
        clientId: cmd.clientId,
        skuId,
        batchId: createBatchId(cmd.payload.batchId),
        now: cmd.timestamp
      });

      const domainRevision = createProductClaimRevision({
        clientId: cmd.clientId,
        claimId: domainClaim.claimId,
        revision: 1,
        batchId: domainClaim.batchId,
        canonicalKind: cmd.payload.canonicalKind,
        proofCategory: cmd.payload.proofCategory,
        parameters: normalizeClaimParameters(cmd.payload.parameters),
        displayWording: cmd.payload.displayWording ?? null,
        assertedBy: cmd.actorId,
        assertedAt: cmd.timestamp
      });

      // 3. Insert claim head
      await this.client.query(
        `INSERT INTO product_claims (
          claim_id, client_id, sku_id, batch_id, current_revision, state, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          domainClaim.claimId,
          domainClaim.clientId,
          domainClaim.skuId,
          domainClaim.batchId,
          domainClaim.currentRevision,
          domainClaim.state,
          domainClaim.version,
          domainClaim.createdAt,
          domainClaim.updatedAt
        ]
      );

      // 4. Insert claim revision
      await this.client.query(
        `INSERT INTO product_claim_revisions (
          client_id, claim_id, revision, batch_id, canonical_kind, proof_category, parameters_json, display_wording, policy_version, asserted_by, asserted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          domainRevision.clientId,
          domainRevision.claimId,
          domainRevision.revision,
          domainRevision.batchId,
          domainRevision.canonicalKind,
          domainRevision.proofCategory,
          JSON.stringify(domainRevision.parameters),
          domainRevision.displayWording,
          domainRevision.policyVersion,
          domainRevision.assertedBy,
          domainRevision.assertedAt
        ]
      );

      const creationResult: ProductClaimCreationResult = {
        claim: domainClaim,
        revision: domainRevision
      };

      await this.storeReceipt(this.client, cmd, "createClaim", payloadHash, creationResult);

      return creationResult;
    } catch (err) {
      throw translateDatabaseError(err, { clientId: cmd.clientId });
    }
  }

  async appendClaimRevision(
    cmd: CommandEnvelope<AppendClaimRevisionRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimRevisionResult> {
    assertClientIsPoolClient(
      this.client,
      "Mutating operations require a transaction-bound PoolClient."
    );
    this.assertTransactionActive(this.client);

    try {
      await this.acquireCommandAdvisoryLock(this.client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } =
        await this.checkOrReplayReceipt<ProductClaimRevisionResult>(
          this.client,
          cmd,
          "appendClaimRevision"
        );
      if (replay && result) {
        return {
          claim: rehydrateProductClaim(result.claim),
          revision: rehydrateProductClaimRevision(result.revision)
        };
      }

      // 1. Read existing claim
      const claimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      if (claimRes.rows.length === 0) {
        throw new NotFoundError("ProductClaim", cmd.payload.claimId);
      }
      const existingClaim = this.mapRowToProductClaim(claimRes.rows[0]!);

      if (existingClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          existingClaim.version
        );
      }

      // Lock SKU, Batch, and Claim
      await this.acquireOrderedLocks(this.client, cmd.clientId, {
        skuId: existingClaim.skuId,
        batchId: existingClaim.batchId,
        claimIds: [existingClaim.claimId]
      });

      // Verify SKU and Batch under lock
      const lockedBatchRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, existingClaim.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product batch is archived.", "BATCH_ARCHIVED");
      }
      const lockedSkuRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, existingClaim.skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product SKU is archived.", "SKU_ARCHIVED");
      }

      // Re-read under lock
      const lockedClaimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      const lockedClaim = this.mapRowToProductClaim(lockedClaimRes.rows[0]!);

      if (lockedClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }

      // Call domain transition
      const { claim: updatedClaim, revision: newRevision } = appendClaimRevisionToHead(
        lockedClaim,
        cmd.payload.expectedVersion,
        {
          canonicalKind: cmd.payload.canonicalKind,
          proofCategory: cmd.payload.proofCategory,
          parameters: normalizeClaimParameters(cmd.payload.parameters),
          displayWording: cmd.payload.displayWording ?? null,
          assertedBy: cmd.actorId,
          assertedAt: cmd.timestamp
        },
        cmd.timestamp
      );

      // Insert revision
      await this.client.query(
        `INSERT INTO product_claim_revisions (
          client_id, claim_id, revision, batch_id, canonical_kind, proof_category, parameters_json, display_wording, policy_version, asserted_by, asserted_at, supersedes_revision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          newRevision.clientId,
          newRevision.claimId,
          newRevision.revision,
          newRevision.batchId,
          newRevision.canonicalKind,
          newRevision.proofCategory,
          JSON.stringify(newRevision.parameters),
          newRevision.displayWording,
          newRevision.policyVersion,
          newRevision.assertedBy,
          newRevision.assertedAt,
          newRevision.supersedesRevision
        ]
      );

      // Update head
      const updateRes = await this.client.query(
        `UPDATE product_claims
         SET current_revision = $1, state = $2, version = version + 1, invalidation_cause = NULL, invalidation_source_ref = NULL, updated_at = $3
         WHERE client_id = $4 AND claim_id = $5 AND version = $6`,
        [
          updatedClaim.currentRevision,
          updatedClaim.state,
          updatedClaim.updatedAt,
          cmd.clientId,
          cmd.payload.claimId,
          cmd.payload.expectedVersion
        ]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }

      const appendResult: ProductClaimRevisionResult = {
        claim: updatedClaim,
        revision: newRevision
      };

      await this.storeReceipt(this.client, cmd, "appendClaimRevision", payloadHash, appendResult);

      return appendResult;
    } catch (err) {
      throw translateDatabaseError(err, { clientId: cmd.clientId });
    }
  }

  async linkClaimEvidence(
    cmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimLinkResult> {
    assertClientIsPoolClient(
      this.client,
      "Mutating operations require a transaction-bound PoolClient."
    );
    this.assertTransactionActive(this.client);

    try {
      await this.acquireCommandAdvisoryLock(this.client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } =
        await this.checkOrReplayReceipt<ProductClaimLinkResult>(
          this.client,
          cmd,
          "linkClaimEvidence"
        );
      if (replay && result) {
        return {
          claim: rehydrateProductClaim(result.claim),
          links: result.links.map(rehydrateClaimEvidenceLink),
          decisionEvent: rehydrateClaimDecisionEvent(result.decisionEvent)
        };
      }

      // Read claim head
      const claimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      if (claimRes.rows.length === 0) {
        throw new NotFoundError("ProductClaim", cmd.payload.claimId);
      }
      const existingClaim = this.mapRowToProductClaim(claimRes.rows[0]!);

      if (existingClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          existingClaim.version
        );
      }
      if (existingClaim.currentRevision !== cmd.payload.claimRevision) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.claimRevision,
          existingClaim.currentRevision
        );
      }

      // Discover target dependencies
      const sourceObjectIds = cmd.payload.links.map((l) => l.sourceObjectId);
      const evidenceIds = cmd.payload.links.map((l) => l.evidenceId);
      const reportIds = cmd.payload.links
        .map((l) => l.reportId)
        .filter((id): id is string => Boolean(id));
      const referenceAssetIds = cmd.payload.links
        .map((l) => l.derivativeAssetId)
        .filter((id): id is string => Boolean(id));

      // Acquire ordered locks
      await this.acquireOrderedLocks(this.client, cmd.clientId, {
        skuId: existingClaim.skuId,
        batchId: existingClaim.batchId,
        sourceObjectIds,
        evidenceIds,
        reportIds,
        referenceAssetIds,
        claimIds: [existingClaim.claimId]
      });

      // Verify active SKU and Batch under lock
      const lockedBatchRes = await this.client.query<{
        sku_id: string;
        lot_identifier: string;
        current_facts_revision: number;
        archived_at: Date | null;
      }>(
        `SELECT sku_id, lot_identifier, current_facts_revision, archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, existingClaim.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product batch is archived.", "BATCH_ARCHIVED");
      }
      const lockedSkuRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, existingClaim.skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product SKU is archived.", "SKU_ARCHIVED");
      }

      // Re-read claim head under lock
      const lockedClaimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      const lockedClaim = this.mapRowToProductClaim(lockedClaimRes.rows[0]!);

      // Read target revision
      const revRes = await this.client.query<ClaimRevisionRow>(
        `SELECT * FROM product_claim_revisions
         WHERE client_id = $1 AND claim_id = $2 AND revision = $3`,
        [cmd.clientId, cmd.payload.claimId, cmd.payload.claimRevision]
      );
      if (revRes.rows.length === 0) {
        throw new NotFoundError("ProductClaimRevision", String(cmd.payload.claimRevision));
      }
      const revision = this.mapRowToProductClaimRevision(revRes.rows[0]!);

      if (revision.canonicalKind === "unsupported_manual") {
        throw new ClaimSupportRequiredError(
          "Cannot seal evidence links on unsupported_manual claim. Manual assertions remain draft/manual-review only."
        );
      }

      // Construct domain links
      const domainLinks: ClaimEvidenceLink[] = cmd.payload.links.map((item) => {
        return createClaimEvidenceLink({
          clientId: cmd.clientId,
          claimId: lockedClaim.claimId,
          claimRevision: cmd.payload.claimRevision,
          batchId: lockedClaim.batchId,
          evidenceId: createEvidenceId(item.evidenceId),
          evidenceRevision: item.evidenceRevision,
          sourceObjectId: createSourceObjectId(item.sourceObjectId),
          sourceSha256: createSha256Hex(item.sourceSha256),
          supportRole: item.supportRole,
          reportId: item.reportId ? createCoaReportId(item.reportId) : null,
          reportRevision: item.reportRevision ?? null,
          measurementId: item.measurementId ? createCoaMeasurementId(item.measurementId) : null,
          pinnedFactsRevision: item.pinnedFactsRevision ?? null,
          attestation: item.attestation
            ? {
                factKind: item.attestation.factKind,
                factValue: item.attestation.factValue,
                fieldLocator: item.attestation.fieldLocator,
                attribution: item.attestation.attribution,
                actorId: item.attestation.actorId,
                occurredAt: item.attestation.occurredAt,
                verificationEventId: item.attestation.verificationEventId
                  ? createVerificationEventId(item.attestation.verificationEventId)
                  : null
              }
            : null,
          derivativeAssetId: item.derivativeAssetId ?? null
        });
      });

      // Build link dependency snapshots and evaluate eligibility before sealing links
      const linkSnapshots = await this.buildLinkDependencySnapshots(
        this.client,
        cmd.clientId,
        domainLinks
      );

      const sku = {
        skuId: existingClaim.skuId,
        clientId: cmd.clientId,
        archivedAt: null
      };
      const batch = {
        batchId: existingClaim.batchId,
        skuId: existingClaim.skuId,
        clientId: cmd.clientId,
        lotIdentifier: lockedBatchRes.rows[0]!.lot_identifier,
        currentFactsRevision: lockedBatchRes.rows[0]!.current_facts_revision,
        archivedAt: null
      };

      const eligibility = evaluateClaimEligibility({
        claim: lockedClaim,
        revision,
        sku,
        batch,
        links: linkSnapshots
      });

      if (!eligibility.supportEligible) {
        throw new ClaimSupportRequiredError(
          `Cannot seal evidence links: underlying evidence is ineligible (${eligibility.blockReasons.map((r) => r.message).join("; ")})`
        );
      }

      // Call domain transition
      const { claim: updatedClaim, decisionEvent } = linkEvidenceToClaim(
        lockedClaim,
        cmd.payload.expectedVersion,
        cmd.payload.claimRevision,
        domainLinks,
        cmd.actorId,
        cmd.payload.reason,
        cmd.timestamp
      );

      // Insert links into claim_source_links
      for (const l of domainLinks) {
        await this.client.query(
          `INSERT INTO claim_source_links (
            link_id, client_id, claim_id, claim_revision, batch_id, evidence_id, evidence_revision,
            source_object_id, source_sha256, support_role, report_id, report_revision, measurement_id,
            pinned_facts_revision, attestation_fact_kind, attestation_fact_value, attestation_field_locator,
            attestation_attribution, attestation_actor_id, attestation_occurred_at, attestation_verification_event_id,
            derivative_asset_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, CURRENT_TIMESTAMP)`,
          [
            l.linkId,
            l.clientId,
            l.claimId,
            l.claimRevision,
            l.batchId,
            l.evidenceId,
            l.evidenceRevision,
            l.sourceObjectId,
            l.sourceSha256,
            l.supportRole,
            l.reportId,
            l.reportRevision,
            l.measurementId,
            l.pinnedFactsRevision,
            l.attestation?.factKind ?? null,
            l.attestation?.factValue ?? null,
            l.attestation?.fieldLocator ?? null,
            l.attestation?.attribution ?? null,
            l.attestation?.actorId ?? null,
            l.attestation?.occurredAt ?? null,
            l.attestation?.verificationEventId ?? null,
            l.derivativeAssetId
          ]
        );
      }

      // Insert decision event
      await this.client.query(
        `INSERT INTO claim_decision_events (
          event_id, client_id, claim_id, claim_revision, decision, actor_id, occurred_at, reason, policy_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          decisionEvent.eventId,
          decisionEvent.clientId,
          decisionEvent.claimId,
          decisionEvent.claimRevision,
          decisionEvent.decision,
          decisionEvent.actorId,
          decisionEvent.occurredAt,
          decisionEvent.reason,
          decisionEvent.policyVersion
        ]
      );

      // Update head
      const updateRes = await this.client.query(
        `UPDATE product_claims
         SET state = $1, version = version + 1, updated_at = $2
         WHERE client_id = $3 AND claim_id = $4 AND version = $5`,
        [
          updatedClaim.state,
          updatedClaim.updatedAt,
          cmd.clientId,
          cmd.payload.claimId,
          cmd.payload.expectedVersion
        ]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }

      const linkResult: ProductClaimLinkResult = {
        claim: updatedClaim,
        links: domainLinks,
        decisionEvent
      };

      await this.storeReceipt(this.client, cmd, "linkClaimEvidence", payloadHash, linkResult);

      return linkResult;
    } catch (err) {
      throw translateDatabaseError(err, { clientId: cmd.clientId });
    }
  }

  async reviewClaim(
    cmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimReviewResult> {
    assertClientIsPoolClient(
      this.client,
      "Mutating operations require a transaction-bound PoolClient."
    );
    this.assertTransactionActive(this.client);

    try {
      await this.acquireCommandAdvisoryLock(this.client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } =
        await this.checkOrReplayReceipt<ProductClaimReviewResult>(this.client, cmd, "reviewClaim");
      if (replay && result) {
        return {
          claim: rehydrateProductClaim(result.claim),
          decisionEvent: rehydrateClaimDecisionEvent(result.decisionEvent)
        };
      }

      // Read claim head
      const claimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      if (claimRes.rows.length === 0) {
        throw new NotFoundError("ProductClaim", cmd.payload.claimId);
      }
      const existingClaim = this.mapRowToProductClaim(claimRes.rows[0]!);

      if (existingClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          existingClaim.version
        );
      }
      if (existingClaim.currentRevision !== cmd.payload.claimRevision) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.claimRevision,
          existingClaim.currentRevision
        );
      }

      // Read links for this revision to discover dependency IDs
      const linksRes = await this.client.query<ClaimSourceLinkRow>(
        `SELECT * FROM claim_source_links
         WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3`,
        [cmd.clientId, cmd.payload.claimId, cmd.payload.claimRevision]
      );

      const sourceObjectIds = linksRes.rows.map((l) => l.source_object_id);
      const evidenceIds = linksRes.rows.map((l) => l.evidence_id);
      const reportIds = linksRes.rows
        .map((l) => l.report_id)
        .filter((id): id is string => Boolean(id));
      const referenceAssetIds = linksRes.rows
        .map((l) => l.derivative_asset_id)
        .filter((id): id is string => Boolean(id));

      // Acquire ordered locks
      await this.acquireOrderedLocks(this.client, cmd.clientId, {
        skuId: existingClaim.skuId,
        batchId: existingClaim.batchId,
        sourceObjectIds,
        evidenceIds,
        reportIds,
        referenceAssetIds,
        claimIds: [existingClaim.claimId]
      });

      // Verify active SKU and Batch under lock
      const lockedBatchRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
        [cmd.clientId, existingClaim.batchId]
      );
      if (lockedBatchRes.rows.length === 0 || lockedBatchRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product batch is archived.", "BATCH_ARCHIVED");
      }
      const lockedSkuRes = await this.client.query<{ archived_at: Date | null }>(
        `SELECT archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
        [cmd.clientId, existingClaim.skuId]
      );
      if (lockedSkuRes.rows.length === 0 || lockedSkuRes.rows[0]!.archived_at) {
        throw new AccessDeniedError("Parent product SKU is archived.", "SKU_ARCHIVED");
      }

      // Re-read under lock
      const lockedClaimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      const lockedClaim = this.mapRowToProductClaim(lockedClaimRes.rows[0]!);

      if (lockedClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }
      if (lockedClaim.currentRevision !== cmd.payload.claimRevision) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.claimRevision,
          lockedClaim.currentRevision
        );
      }

      // Read revision
      const revRes = await this.client.query<ClaimRevisionRow>(
        `SELECT * FROM product_claim_revisions
         WHERE client_id = $1 AND claim_id = $2 AND revision = $3`,
        [cmd.clientId, cmd.payload.claimId, cmd.payload.claimRevision]
      );
      if (revRes.rows.length === 0) {
        throw new NotFoundError("ProductClaimRevision", String(cmd.payload.claimRevision));
      }
      const revision = this.mapRowToProductClaimRevision(revRes.rows[0]!);

      // Evaluate eligibility snapshot before approval
      const resolution = await this.resolveClaimInternal(
        this.client,
        cmd.clientId,
        lockedClaim.claimId,
        lockedClaim.currentRevision
      );

      if (cmd.payload.decision === "approve") {
        if (!resolution.supportEligible) {
          throw new ClaimSupportRequiredError(
            `Cannot approve claim revision: underlying evidence is ineligible (${resolution.blockReasons.map((r) => r.message).join("; ")})`
          );
        }
      }

      // Collect attester IDs for separation of duties
      const attesterIds = linksRes.rows
        .map((r) => r.attestation_actor_id)
        .filter((id): id is string => Boolean(id));

      const { claim: updatedClaim, decisionEvent } = reviewClaim(
        lockedClaim,
        cmd.payload.expectedVersion,
        cmd.payload.claimRevision,
        cmd.payload.decision,
        cmd.actorId,
        cmd.payload.reason,
        revision.assertedBy,
        attesterIds,
        resolution.dependencyFingerprint,
        cmd.timestamp
      );

      // Insert decision event
      await this.client.query(
        `INSERT INTO claim_decision_events (
          event_id, client_id, claim_id, claim_revision, decision, actor_id, occurred_at, reason, policy_version, dependency_fingerprint
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          decisionEvent.eventId,
          decisionEvent.clientId,
          decisionEvent.claimId,
          decisionEvent.claimRevision,
          decisionEvent.decision,
          decisionEvent.actorId,
          decisionEvent.occurredAt,
          decisionEvent.reason,
          decisionEvent.policyVersion,
          decisionEvent.dependencyFingerprint
        ]
      );

      // Update head
      const updateRes = await this.client.query(
        `UPDATE product_claims
         SET state = $1, version = version + 1, updated_at = $2
         WHERE client_id = $3 AND claim_id = $4 AND version = $5`,
        [
          updatedClaim.state,
          updatedClaim.updatedAt,
          cmd.clientId,
          cmd.payload.claimId,
          cmd.payload.expectedVersion
        ]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }

      const reviewResult: ProductClaimReviewResult = {
        claim: updatedClaim,
        decisionEvent
      };

      await this.storeReceipt(this.client, cmd, "reviewClaim", payloadHash, reviewResult);

      return reviewResult;
    } catch (err) {
      throw translateDatabaseError(err, { clientId: cmd.clientId });
    }
  }

  async invalidateClaim(
    cmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimReviewResult> {
    assertClientIsPoolClient(
      this.client,
      "Mutating operations require a transaction-bound PoolClient."
    );
    this.assertTransactionActive(this.client);

    try {
      await this.acquireCommandAdvisoryLock(this.client, cmd.clientId, cmd.actionId);

      const { replay, result, payloadHash } =
        await this.checkOrReplayReceipt<ProductClaimReviewResult>(
          this.client,
          cmd,
          "invalidateClaim"
        );
      if (replay && result) {
        return {
          claim: rehydrateProductClaim(result.claim),
          decisionEvent: rehydrateClaimDecisionEvent(result.decisionEvent)
        };
      }

      // Read claim head
      const claimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      if (claimRes.rows.length === 0) {
        throw new NotFoundError("ProductClaim", cmd.payload.claimId);
      }
      const existingClaim = this.mapRowToProductClaim(claimRes.rows[0]!);

      if (existingClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          existingClaim.version
        );
      }
      if (existingClaim.currentRevision !== cmd.payload.claimRevision) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.claimRevision,
          existingClaim.currentRevision
        );
      }

      // Claim state check: only evidence_linked and reviewer_approved can be invalidated
      if (
        existingClaim.state !== "evidence_linked" &&
        existingClaim.state !== "reviewer_approved"
      ) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["state"],
            message: `Cannot invalidate claim in state "${existingClaim.state}". Only active states "evidence_linked" and "reviewer_approved" can be invalidated.`
          }
        ]);
      }

      // Read links for this revision to discover dependency IDs
      const linksRes = await this.client.query<ClaimSourceLinkRow>(
        `SELECT * FROM claim_source_links
         WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3`,
        [cmd.clientId, cmd.payload.claimId, cmd.payload.claimRevision]
      );

      const sourceObjectIds = linksRes.rows.map((l) => l.source_object_id);
      const evidenceIds = linksRes.rows.map((l) => l.evidence_id);
      const reportIds = linksRes.rows
        .map((l) => l.report_id)
        .filter((id): id is string => Boolean(id));
      const referenceAssetIds = linksRes.rows
        .map((l) => l.derivative_asset_id)
        .filter((id): id is string => Boolean(id));

      // Acquire ordered locks
      await this.acquireOrderedLocks(this.client, cmd.clientId, {
        skuId: existingClaim.skuId,
        batchId: existingClaim.batchId,
        sourceObjectIds,
        evidenceIds,
        reportIds,
        referenceAssetIds,
        claimIds: [existingClaim.claimId]
      });

      // Re-read under lock
      const lockedClaimRes = await this.client.query<ClaimRow>(
        `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
        [cmd.clientId, cmd.payload.claimId]
      );
      const lockedClaim = this.mapRowToProductClaim(lockedClaimRes.rows[0]!);

      if (lockedClaim.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }
      if (lockedClaim.currentRevision !== cmd.payload.claimRevision) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.claimRevision,
          lockedClaim.currentRevision
        );
      }
      if (lockedClaim.state !== "evidence_linked" && lockedClaim.state !== "reviewer_approved") {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["state"],
            message: `Cannot invalidate claim in state "${lockedClaim.state}". Only active states "evidence_linked" and "reviewer_approved" can be invalidated.`
          }
        ]);
      }

      // Evaluate eligibility snapshot to find matching real dependency failure
      const resolution = await this.resolveClaimInternal(
        this.client,
        cmd.clientId,
        lockedClaim.claimId,
        lockedClaim.currentRevision
      );

      // Verify that there is indeed an eligibility failure matching the requested invalidation cause
      const cause = cmd.payload.invalidationCause;
      let matchedSourceRef: string | null = null;

      const matchingBlock = resolution.blockReasons.find((b) => {
        if (cause === "source_archived") {
          return b.code === "PARENT_ARCHIVED" || b.code === "SOURCE_ARCHIVED";
        }
        if (cause === "source_superseded") {
          return b.code === "SOURCE_SUPERSEDED";
        }
        if (cause === "source_quarantined") {
          return b.code === "SOURCE_QUARANTINED";
        }
        if (cause === "integrity_failure") {
          return b.code === "SOURCE_DIGEST_MISMATCH";
        }
        if (cause === "source_disputed") {
          return b.code === "SOURCE_DISPUTED" || b.code === "VERIFICATION_WITHDRAWN";
        }
        if (cause === "batch_facts_changed") {
          return b.code === "FACTS_SUPERSEDED";
        }
        return false;
      });

      if (!matchingBlock || !matchingBlock.dependencyId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["invalidationCause"],
            message: `Claim ${cmd.payload.claimId} cannot be invalidated with cause "${cause}": no matching dependency failure found on eligible dependencies.`
          }
        ]);
      }

      matchedSourceRef = matchingBlock.dependencyId;

      const { claim: updatedClaim, decisionEvent } = invalidateClaim(
        lockedClaim,
        cause,
        cmd.payload.reason,
        matchedSourceRef,
        cmd.actorId,
        cmd.timestamp
      );

      // Insert decision event
      await this.client.query(
        `INSERT INTO claim_decision_events (
          event_id, client_id, claim_id, claim_revision, decision, actor_id, occurred_at, reason, policy_version, dependency_fingerprint, invalidation_cause, source_event_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          decisionEvent.eventId,
          decisionEvent.clientId,
          decisionEvent.claimId,
          decisionEvent.claimRevision,
          decisionEvent.decision,
          decisionEvent.actorId,
          decisionEvent.occurredAt,
          decisionEvent.reason,
          decisionEvent.policyVersion,
          decisionEvent.dependencyFingerprint,
          decisionEvent.invalidationCause,
          decisionEvent.sourceEventId
        ]
      );

      // Update head
      const updateRes = await this.client.query(
        `UPDATE product_claims
         SET state = $1, version = version + 1, invalidation_cause = $2, invalidation_source_ref = $3, updated_at = $4
         WHERE client_id = $5 AND claim_id = $6 AND version = $7`,
        [
          updatedClaim.state,
          updatedClaim.invalidationCause,
          updatedClaim.invalidationSourceRef,
          updatedClaim.updatedAt,
          cmd.clientId,
          cmd.payload.claimId,
          cmd.payload.expectedVersion
        ]
      );
      if (updateRes.rowCount === 0) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          lockedClaim.version
        );
      }

      const invalidationResult: ProductClaimReviewResult = {
        claim: updatedClaim,
        decisionEvent
      };

      await this.storeReceipt(this.client, cmd, "invalidateClaim", payloadHash, invalidationResult);

      return invalidationResult;
    } catch (err) {
      throw translateDatabaseError(err, { clientId: cmd.clientId });
    }
  }

  async getClaimById(clientId: ClientId, claimId: ClaimId): Promise<ProductClaim | null> {
    const res = await this.client.query<ClaimRow>(
      `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
      [clientId, claimId]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return this.mapRowToProductClaim(res.rows[0]!);
  }

  async getClaimRevision(
    clientId: ClientId,
    claimId: ClaimId,
    revision: number
  ): Promise<ProductClaimRevisionDetail | null> {
    const revRes = await this.client.query<ClaimRevisionRow>(
      `SELECT * FROM product_claim_revisions
       WHERE client_id = $1 AND claim_id = $2 AND revision = $3`,
      [clientId, claimId, revision]
    );
    if (revRes.rows.length === 0) {
      return null;
    }
    const rev = this.mapRowToProductClaimRevision(revRes.rows[0]!);

    const linksRes = await this.client.query<ClaimSourceLinkRow>(
      `SELECT * FROM claim_source_links
       WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3
       ORDER BY created_at ASC`,
      [clientId, claimId, revision]
    );
    const links = linksRes.rows.map((r) => this.mapRowToClaimEvidenceLink(r));

    const eventsRes = await this.client.query<ClaimDecisionEventRow>(
      `SELECT * FROM claim_decision_events
       WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3
       ORDER BY occurred_at ASC`,
      [clientId, claimId, revision]
    );
    const decisionEvents = eventsRes.rows.map((r) => this.mapRowToClaimDecisionEvent(r));

    return {
      revision: rev,
      links,
      decisionEvents
    };
  }

  async getClaimHistory(clientId: ClientId, claimId: ClaimId): Promise<ProductClaimHistory | null> {
    const claim = await this.getClaimById(clientId, claimId);
    if (!claim) {
      return null;
    }

    const revsRes = await this.client.query<ClaimRevisionRow>(
      `SELECT * FROM product_claim_revisions
       WHERE client_id = $1 AND claim_id = $2
       ORDER BY revision ASC`,
      [clientId, claimId]
    );

    const revisions: ProductClaimRevisionDetail[] = [];
    for (const r of revsRes.rows) {
      const detail = await this.getClaimRevision(clientId, claimId, r.revision);
      if (detail) {
        revisions.push(detail);
      }
    }

    const allEventsRes = await this.client.query<ClaimDecisionEventRow>(
      `SELECT * FROM claim_decision_events
       WHERE client_id = $1 AND claim_id = $2
       ORDER BY occurred_at ASC`,
      [clientId, claimId]
    );
    const events = allEventsRes.rows.map((r) => this.mapRowToClaimDecisionEvent(r));

    return {
      claim,
      revisions,
      events
    };
  }

  async listClaimsForBatch(clientId: ClientId, batchId: BatchId): Promise<readonly ProductClaim[]> {
    const res = await this.client.query<ClaimRow>(
      `SELECT * FROM product_claims
       WHERE client_id = $1 AND batch_id = $2 AND archived_at IS NULL
       ORDER BY created_at ASC`,
      [clientId, batchId]
    );
    return res.rows.map((r) => this.mapRowToProductClaim(r));
  }

  async resolveClaim(
    clientId: ClientId,
    claimId: ClaimId,
    revision?: number | undefined
  ): Promise<ResolveClaimResponse> {
    let client: PoolClient;
    let shouldRelease = false;
    let managedTransaction = false;

    if (isPool(this.client)) {
      client = await this.client.connect();
      shouldRelease = true;
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
      managedTransaction = true;
    } else {
      client = this.client;
      const status =
        typeof client.getTransactionStatus === "function"
          ? client.getTransactionStatus()
          : undefined;
      if (status !== "T" && !this.options?.externalTransaction) {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
        managedTransaction = true;
      }
    }

    try {
      const res = await this.resolveClaimInternal(client, clientId, claimId, revision);
      if (managedTransaction) {
        await client.query("COMMIT");
      }
      return res;
    } catch (err) {
      if (managedTransaction) {
        await client.query("ROLLBACK").catch(() => {});
      }
      throw translateDatabaseError(err, { clientId });
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  }

  private async buildLinkDependencySnapshots(
    client: PoolClient,
    clientId: ClientId,
    domainLinks: readonly ClaimEvidenceLink[]
  ): Promise<LinkDependencySnapshot[]> {
    const snapshots: LinkDependencySnapshot[] = [];

    for (const l of domainLinks) {
      // Evidence Asset
      const eaRes = await client.query<{ archived_at: Date | null; current_revision: number }>(
        `SELECT archived_at, current_revision FROM evidence_assets WHERE client_id = $1 AND evidence_id = $2`,
        [clientId, l.evidenceId]
      );
      const evidenceAsset =
        eaRes.rows.length > 0
          ? {
              evidenceId: l.evidenceId,
              clientId,
              currentRevision: eaRes.rows[0]!.current_revision,
              archivedAt: eaRes.rows[0]!.archived_at
                ? canonicalizeUtcTimestamp(eaRes.rows[0]!.archived_at.toISOString())
                : null
            }
          : null;

      // Evidence Revision
      const erRes = await client.query<{
        source_object_id: string;
        source_class: string;
        reported_capture_date: string | null;
      }>(
        `SELECT source_object_id, source_class, reported_capture_date FROM evidence_revisions
         WHERE client_id = $1 AND evidence_id = $2 AND revision = $3`,
        [clientId, l.evidenceId, l.evidenceRevision]
      );
      const evidenceRevision =
        erRes.rows.length > 0
          ? {
              evidenceId: l.evidenceId,
              revision: l.evidenceRevision,
              sourceObjectId: createSourceObjectId(erRes.rows[0]!.source_object_id),
              sourceClass: erRes.rows[0]!.source_class,
              captureDate: erRes.rows[0]!.reported_capture_date
            }
          : null;

      // Source Object
      const soRes = await client.query<{ original_sha256: string; availability: string }>(
        `SELECT original_sha256, availability FROM source_objects WHERE client_id = $1 AND source_object_id = $2`,
        [clientId, l.sourceObjectId]
      );
      const sourceObject =
        soRes.rows.length > 0
          ? {
              sourceObjectId: l.sourceObjectId,
              clientId,
              originalSha256: soRes.rows[0]!.original_sha256,
              availability: soRes.rows[0]!.availability
            }
          : null;

      // Batch evidence link
      const belRes = await client.query(
        `SELECT 1 FROM batch_evidence_links WHERE client_id = $1 AND batch_id = $2 AND evidence_id = $3 AND evidence_revision = $4`,
        [clientId, l.batchId, l.evidenceId, l.evidenceRevision]
      );
      const batchEvidenceLinkExists = belRes.rows.length > 0;

      // Disputes (ordered by occurred_at ASC, event_id ASC)
      const disputesRes = await client.query<{
        event_id: string;
        outcome: "disputed" | "rejected" | "withdrawn";
        withdrawal_event_id: string | null;
      }>(
        `SELECT event_id, outcome, withdrawal_event_id
         FROM evidence_verification_events
         WHERE client_id = $1 AND evidence_id = $2 AND evidence_revision = $3
         ORDER BY occurred_at ASC, event_id ASC`,
        [clientId, l.evidenceId, l.evidenceRevision]
      );

      // Relied-on verification event
      let reliedVerificationEvent: {
        eventId: string;
        outcome: "verified" | "rejected" | "disputed" | "withdrawn";
        withdrawalEventId?: string | null | undefined;
        factScope?: string | undefined;
        verificationKind?: string | undefined;
      } | null = null;

      if (l.attestation?.verificationEventId) {
        const rveRes = await client.query<{
          event_id: string;
          outcome: "verified" | "rejected" | "disputed" | "withdrawn";
          withdrawal_event_id: string | null;
          fact_scope: string | null;
          verification_kind: string | null;
        }>(
          `SELECT event_id, outcome, withdrawal_event_id, fact_scope, verification_kind
           FROM evidence_verification_events
           WHERE client_id = $1 AND event_id = $2`,
          [clientId, l.attestation.verificationEventId]
        );
        if (rveRes.rows.length > 0) {
          const row = rveRes.rows[0]!;
          const rwRes = await client.query(
            `SELECT 1 FROM evidence_verification_events
             WHERE client_id = $1 AND outcome = 'withdrawn' AND withdrawal_event_id = $2`,
            [clientId, row.event_id]
          );
          const isWithdrawn = rwRes.rows.length > 0 || row.outcome === "withdrawn";
          reliedVerificationEvent = {
            eventId: row.event_id,
            outcome: isWithdrawn ? ("withdrawn" as const) : row.outcome,
            withdrawalEventId: row.withdrawal_event_id,
            factScope: row.fact_scope ?? undefined,
            verificationKind: row.verification_kind ?? undefined
          };
        }
      }

      // Derivative asset
      let derivativeAsset = null;
      if (l.derivativeAssetId) {
        const daRes = await client.query<{
          asset_id: string;
          archived_at: Date | null;
        }>(
          `SELECT asset_id, archived_at FROM reference_assets
           WHERE client_id = $1 AND asset_id = $2`,
          [clientId, l.derivativeAssetId]
        );
        if (daRes.rows.length > 0) {
          derivativeAsset = {
            assetId: daRes.rows[0]!.asset_id,
            archivedAt: daRes.rows[0]!.archived_at
              ? canonicalizeUtcTimestamp(daRes.rows[0]!.archived_at.toISOString())
              : null
          };
        }
      }

      // CoA Report if linked
      let coaReport = null;
      let coaReportRevision = null;
      let coaReviewEvent = null;
      let coaMeasurement = null;
      let labVerificationEvent = null;

      if (l.reportId && l.reportRevision) {
        const crRes = await client.query<{
          current_revision: number;
          archived_at: Date | null;
          batch_id: string;
        }>(
          `SELECT current_revision, archived_at, batch_id FROM coa_reports WHERE client_id = $1 AND report_id = $2`,
          [clientId, l.reportId]
        );
        if (crRes.rows.length > 0) {
          coaReport = {
            reportId: l.reportId,
            clientId,
            batchId: createBatchId(crRes.rows[0]!.batch_id),
            currentRevision: crRes.rows[0]!.current_revision,
            archivedAt: crRes.rows[0]!.archived_at
              ? canonicalizeUtcTimestamp(crRes.rows[0]!.archived_at.toISOString())
              : null
          };
        }

        const crrRes = await client.query<{
          completeness_status: "draft" | "complete";
          scope_kind: "sample_only" | "attributed_lot" | null;
          verified_lab_identity_event_id: string | null;
        }>(
          `SELECT completeness_status, scope_kind, verified_lab_identity_event_id FROM coa_report_revisions
           WHERE client_id = $1 AND report_id = $2 AND revision = $3`,
          [clientId, l.reportId, l.reportRevision]
        );
        if (crrRes.rows.length > 0) {
          coaReportRevision = {
            reportId: l.reportId,
            revision: l.reportRevision,
            completenessStatus: crrRes.rows[0]!.completeness_status,
            scopeKind: crrRes.rows[0]!.scope_kind,
            verifiedLabIdentityEventId: crrRes.rows[0]!.verified_lab_identity_event_id
          };

          if (crrRes.rows[0]!.verified_lab_identity_event_id) {
            const lveRes = await client.query<{
              event_id: string;
              outcome: string;
              fact_scope: string;
              verification_kind: string;
              withdrawal_event_id: string | null;
            }>(
              `SELECT event_id, outcome, fact_scope, verification_kind, withdrawal_event_id FROM evidence_verification_events WHERE client_id = $1 AND event_id = $2`,
              [clientId, crrRes.rows[0]!.verified_lab_identity_event_id]
            );
            if (lveRes.rows.length > 0) {
              const r = lveRes.rows[0]!;
              const lwRes = await client.query(
                `SELECT 1 FROM evidence_verification_events
                 WHERE client_id = $1 AND outcome = 'withdrawn' AND withdrawal_event_id = $2`,
                [clientId, r.event_id]
              );
              const isWithdrawn = lwRes.rows.length > 0 || r.outcome === "withdrawn";
              labVerificationEvent = {
                eventId: r.event_id,
                outcome: isWithdrawn ? "withdrawn" : r.outcome,
                factScope: r.fact_scope,
                verificationKind: r.verification_kind,
                isWithdrawn
              };
            }
          }
        }

        const creRes = await client.query<{
          decision: "approved" | "rejected";
          assessed_scope: "sample_only" | "attributed_lot";
        }>(
          `SELECT decision, assessed_scope FROM coa_report_review_events
           WHERE client_id = $1 AND report_id = $2 AND report_revision = $3`,
          [clientId, l.reportId, l.reportRevision]
        );
        if (creRes.rows.length > 0) {
          coaReviewEvent = {
            decision: creRes.rows[0]!.decision,
            assessedScope: creRes.rows[0]!.assessed_scope
          };
        }

        if (l.measurementId) {
          const cmRes = await client.query<{
            analyte: string;
            result_kind: "quantified" | "below_limit" | "not_detected";
            result_value: string | null;
            unit: string;
            quantity_kind: string;
            basis: string;
            context: string;
          }>(
            `SELECT analyte, result_kind, result_value, unit, quantity_kind, basis, context
             FROM coa_measurements WHERE client_id = $1 AND report_id = $2 AND report_revision = $3 AND measurement_id = $4`,
            [clientId, l.reportId, l.reportRevision, l.measurementId]
          );
          if (cmRes.rows.length > 0) {
            coaMeasurement = {
              measurementId: l.measurementId,
              analyte: cmRes.rows[0]!.analyte,
              resultKind: cmRes.rows[0]!.result_kind,
              resultValue: cmRes.rows[0]!.result_value,
              unit: cmRes.rows[0]!.unit,
              quantityKind: cmRes.rows[0]!.quantity_kind,
              basis: cmRes.rows[0]!.basis,
              context: cmRes.rows[0]!.context
            };
          }
        }
      }

      snapshots.push({
        link: l,
        evidenceAsset,
        evidenceRevision,
        sourceObject,
        batchEvidenceLinkExists,
        disputes: disputesRes.rows.map((r) => ({
          eventId: r.event_id,
          outcome: r.outcome,
          withdrawalEventId: r.withdrawal_event_id
        })),
        reliedVerificationEvent,
        derivativeAsset,
        coaReport,
        coaReportRevision,
        coaReviewEvent,
        coaMeasurement,
        labVerificationEvent
      });
    }

    return snapshots;
  }

  private async resolveClaimInternal(
    client: PoolClient,
    clientId: ClientId,
    claimId: ClaimId,
    requestedRevision?: number
  ): Promise<ResolveClaimResponse> {
    const claimRes = await client.query<ClaimRow>(
      `SELECT * FROM product_claims WHERE client_id = $1 AND claim_id = $2`,
      [clientId, claimId]
    );
    if (claimRes.rows.length === 0) {
      throw new NotFoundError("ProductClaim", claimId);
    }
    const claim = this.mapRowToProductClaim(claimRes.rows[0]!);

    const targetRev = requestedRevision ?? claim.currentRevision;

    const revRes = await client.query<ClaimRevisionRow>(
      `SELECT * FROM product_claim_revisions
       WHERE client_id = $1 AND claim_id = $2 AND revision = $3`,
      [clientId, claimId, targetRev]
    );
    if (revRes.rows.length === 0) {
      throw new NotFoundError("ProductClaimRevision", String(targetRev));
    }
    const revision = this.mapRowToProductClaimRevision(revRes.rows[0]!);

    const linksRes = await client.query<ClaimSourceLinkRow>(
      `SELECT * FROM claim_source_links
       WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3
       ORDER BY created_at ASC`,
      [clientId, claimId, targetRev]
    );
    const domainLinks = linksRes.rows.map((r) => this.mapRowToClaimEvidenceLink(r));

    // Acquire ordered locks FOR SHARE on dependencies and claim
    const sourceObjectIds = domainLinks.map((l) => l.sourceObjectId);
    const evidenceIds = domainLinks.map((l) => l.evidenceId);
    const reportIds = domainLinks
      .map((l) => (l.reportId ? String(l.reportId) : null))
      .filter((id): id is string => Boolean(id));
    const referenceAssetIds = domainLinks
      .map((l) => (l.derivativeAssetId ? String(l.derivativeAssetId) : null))
      .filter((id): id is string => Boolean(id));

    await this.acquireOrderedLocks(
      client,
      clientId,
      {
        skuId: claim.skuId,
        batchId: claim.batchId,
        sourceObjectIds,
        evidenceIds,
        reportIds,
        referenceAssetIds,
        claimIds: [claim.claimId]
      },
      "FOR SHARE"
    );

    const skuRes = await client.query<{ sku_id: string; archived_at: Date | null }>(
      `SELECT sku_id, archived_at FROM product_skus WHERE client_id = $1 AND sku_id = $2`,
      [clientId, claim.skuId]
    );
    const sku = {
      skuId: claim.skuId,
      clientId,
      archivedAt: skuRes.rows[0]?.archived_at
        ? canonicalizeUtcTimestamp(skuRes.rows[0].archived_at.toISOString())
        : null
    };

    const batchRes = await client.query<{
      batch_id: string;
      sku_id: string;
      lot_identifier: string;
      current_facts_revision: number;
      archived_at: Date | null;
    }>(
      `SELECT batch_id, sku_id, lot_identifier, current_facts_revision, archived_at
       FROM product_batches WHERE client_id = $1 AND batch_id = $2`,
      [clientId, claim.batchId]
    );
    const batch = {
      batchId: claim.batchId,
      skuId: claim.skuId,
      clientId,
      lotIdentifier: batchRes.rows[0]?.lot_identifier ?? "",
      currentFactsRevision: batchRes.rows[0]?.current_facts_revision ?? 1,
      archivedAt: batchRes.rows[0]?.archived_at
        ? canonicalizeUtcTimestamp(batchRes.rows[0].archived_at.toISOString())
        : null
    };

    const dependencySnapshots = await this.buildLinkDependencySnapshots(
      client,
      clientId,
      domainLinks
    );

    const eventsRes = await client.query<ClaimDecisionEventRow>(
      `SELECT * FROM claim_decision_events
       WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3
       ORDER BY occurred_at DESC LIMIT 1`,
      [clientId, claimId, targetRev]
    );
    const latestEvent =
      eventsRes.rows.length > 0 ? this.mapRowToClaimDecisionEvent(eventsRes.rows[0]!) : null;

    const eligibility = evaluateClaimEligibility({
      claim,
      revision,
      sku,
      batch,
      links: dependencySnapshots,
      reviewEvent: latestEvent
    });

    const dependencyFingerprint = computePayloadSha256({
      claimId: claim.claimId,
      revision: revision.revision,
      links: domainLinks.map((l) => ({
        evidenceId: l.evidenceId,
        evidenceRevision: l.evidenceRevision,
        sha: l.sourceSha256,
        reportId: l.reportId,
        reportRevision: l.reportRevision,
        measurementId: l.measurementId
      }))
    });

    const allEventsRes = await client.query<ClaimDecisionEventRow>(
      `SELECT * FROM claim_decision_events
       WHERE client_id = $1 AND claim_id = $2 AND claim_revision = $3
       ORDER BY occurred_at ASC`,
      [clientId, claimId, targetRev]
    );
    const reviewEvents = allEventsRes.rows.map((r) => this.mapRowToClaimDecisionEvent(r));

    return {
      claim: {
        claimId: claim.claimId,
        clientId: claim.clientId,
        skuId: claim.skuId,
        batchId: claim.batchId,
        currentRevision: claim.currentRevision,
        state: claim.state,
        version: claim.version,
        invalidationCause: claim.invalidationCause,
        invalidationSourceRef: claim.invalidationSourceRef,
        createdAt: claim.createdAt,
        updatedAt: claim.updatedAt,
        archivedAt: claim.archivedAt
      },
      revision: {
        clientId: revision.clientId,
        claimId: revision.claimId,
        revision: revision.revision,
        batchId: revision.batchId,
        canonicalKind: revision.canonicalKind,
        proofCategory: revision.proofCategory,
        parameters: revision.parameters,
        displayWording: revision.displayWording,
        policyVersion: revision.policyVersion,
        assertedBy: revision.assertedBy,
        assertedAt: revision.assertedAt,
        supersedesRevision: revision.supersedesRevision
      },
      supportEligible: eligibility.supportEligible,
      canRequestReview: eligibility.canRequestReview,
      evidenceLinkApproved: eligibility.evidenceLinkApproved,
      provenanceCategory: eligibility.provenanceCategory,
      displayWordingStatus: eligibility.displayWordingStatus,
      blockReasons: eligibility.blockReasons.map((b) => ({
        code: b.code,
        dependencyId: b.dependencyId,
        message: b.message
      })),
      links: domainLinks.map((l, idx) => {
        const snap = dependencySnapshots[idx];
        return {
          linkId: l.linkId,
          clientId: l.clientId,
          claimId: l.claimId,
          claimRevision: l.claimRevision,
          batchId: l.batchId,
          evidenceId: l.evidenceId,
          evidenceRevision: l.evidenceRevision,
          sourceObjectId: l.sourceObjectId,
          sourceSha256: l.sourceSha256,
          supportRole: l.supportRole,
          sourceClass: snap?.evidenceRevision?.sourceClass,
          reportId: l.reportId ?? undefined,
          reportRevision: l.reportRevision ?? undefined,
          measurementId: l.measurementId ?? undefined,
          pinnedFactsRevision: l.pinnedFactsRevision ?? undefined,
          attestation: l.attestation ?? undefined,
          derivativeAssetId: l.derivativeAssetId ? String(l.derivativeAssetId) : undefined,
          measurementDetails: snap?.coaMeasurement
            ? {
                measurementId: snap.coaMeasurement.measurementId,
                analyte: snap.coaMeasurement.analyte,
                resultKind: snap.coaMeasurement.resultKind,
                resultValue: snap.coaMeasurement.resultValue,
                unit: snap.coaMeasurement.unit,
                quantityKind: snap.coaMeasurement.quantityKind,
                basis: snap.coaMeasurement.basis,
                context: snap.coaMeasurement.context
              }
            : undefined,
          reportDetails: snap?.coaReportRevision
            ? {
                reportId: snap.coaReportRevision.reportId,
                revision: snap.coaReportRevision.revision,
                completenessStatus: snap.coaReportRevision.completenessStatus,
                scopeKind: snap.coaReportRevision.scopeKind,
                verifiedLabIdentityEventId:
                  snap.coaReportRevision.verifiedLabIdentityEventId ?? undefined,
                labVerificationOutcome: snap.labVerificationEvent?.outcome
              }
            : undefined,
          verificationDetails: snap?.reliedVerificationEvent
            ? {
                eventId: snap.reliedVerificationEvent.eventId,
                outcome: snap.reliedVerificationEvent.outcome,
                verificationKind: snap.reliedVerificationEvent.verificationKind,
                factScope: snap.reliedVerificationEvent.factScope,
                isWithdrawn: snap.reliedVerificationEvent.outcome === "withdrawn"
              }
            : undefined
        };
      }),
      reviewEvents: reviewEvents.map((e) => ({
        eventId: e.eventId,
        clientId: e.clientId,
        claimId: e.claimId,
        claimRevision: e.claimRevision,
        decision: e.decision,
        actorId: e.actorId,
        occurredAt: e.occurredAt,
        reason: e.reason,
        policyVersion: e.policyVersion,
        dependencyFingerprint: e.dependencyFingerprint ?? undefined,
        invalidationCause: e.invalidationCause ?? undefined,
        sourceEventId: e.sourceEventId ?? undefined
      })),
      dependencyFingerprint
    };
  }

  private mapRowToProductClaim(row: ClaimRow): ProductClaim {
    return rehydrateProductClaim({
      claimId: createClaimId(row.claim_id),
      clientId: createClientId(row.client_id),
      skuId: createSkuId(row.sku_id),
      batchId: createBatchId(row.batch_id),
      currentRevision: row.current_revision,
      state: row.state,
      version: row.version,
      invalidationCause: row.invalidation_cause,
      invalidationSourceRef: row.invalidation_source_ref,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updatedAt:
        row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      archivedAt: row.archived_at
        ? row.archived_at instanceof Date
          ? row.archived_at.toISOString()
          : String(row.archived_at)
        : null
    });
  }

  private mapRowToProductClaimRevision(row: ClaimRevisionRow): ProductClaimRevision {
    return rehydrateProductClaimRevision({
      clientId: createClientId(row.client_id),
      claimId: createClaimId(row.claim_id),
      revision: row.revision,
      batchId: createBatchId(row.batch_id),
      canonicalKind: row.canonical_kind,
      proofCategory: row.proof_category,
      parameters: row.parameters_json,
      displayWording: row.display_wording,
      policyVersion: row.policy_version,
      assertedBy: row.asserted_by,
      assertedAt:
        row.asserted_at instanceof Date ? row.asserted_at.toISOString() : String(row.asserted_at),
      supersedesRevision: row.supersedes_revision
    });
  }

  private mapRowToClaimEvidenceLink(row: ClaimSourceLinkRow): ClaimEvidenceLink {
    return rehydrateClaimEvidenceLink({
      linkId: createClaimLinkId(row.link_id),
      clientId: createClientId(row.client_id),
      claimId: createClaimId(row.claim_id),
      claimRevision: row.claim_revision,
      batchId: createBatchId(row.batch_id),
      evidenceId: createEvidenceId(row.evidence_id),
      evidenceRevision: row.evidence_revision,
      sourceObjectId: createSourceObjectId(row.source_object_id),
      sourceSha256: createSha256Hex(row.source_sha256),
      supportRole: row.support_role,
      reportId: row.report_id ? createCoaReportId(row.report_id) : null,
      reportRevision: row.report_revision,
      measurementId: row.measurement_id ? createCoaMeasurementId(row.measurement_id) : null,
      pinnedFactsRevision: row.pinned_facts_revision,
      attestation:
        row.attestation_fact_kind && row.attestation_fact_value && row.attestation_actor_id
          ? {
              factKind: row.attestation_fact_kind,
              factValue: row.attestation_fact_value,
              fieldLocator: row.attestation_field_locator ?? "",
              attribution: row.attestation_attribution ?? "",
              actorId: row.attestation_actor_id,
              occurredAt:
                row.attestation_occurred_at instanceof Date
                  ? row.attestation_occurred_at.toISOString()
                  : String(row.attestation_occurred_at),
              verificationEventId: row.attestation_verification_event_id
                ? createVerificationEventId(row.attestation_verification_event_id)
                : null
            }
          : null,
      derivativeAssetId: row.derivative_asset_id
    });
  }

  private mapRowToClaimDecisionEvent(row: ClaimDecisionEventRow): ClaimDecisionEvent {
    return rehydrateClaimDecisionEvent({
      eventId: createClaimDecisionEventId(row.event_id),
      clientId: createClientId(row.client_id),
      claimId: createClaimId(row.claim_id),
      claimRevision: row.claim_revision,
      decision: row.decision,
      actorId: row.actor_id,
      occurredAt:
        row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at),
      reason: row.reason,
      policyVersion: row.policy_version,
      dependencyFingerprint: row.dependency_fingerprint,
      invalidationCause: row.invalidation_cause,
      sourceEventId: row.source_event_id
    });
  }

  async getCommandReceipt(
    clientId: ClientId,
    actionId: string
  ): Promise<{
    readonly clientId: ClientId;
    readonly actionId: string;
    readonly commandName: string;
    readonly payloadSha256: string;
    readonly actorId: string;
    readonly responseBody: unknown;
    readonly committedAt: string;
  } | null> {
    const res = await this.client.query<ReceiptRow>(
      `SELECT client_id, action_id, command_name, payload_sha256, actor_id, response_body, committed_at
       FROM product_evidence_command_receipts
       WHERE client_id = $1 AND action_id = $2`,
      [clientId, actionId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0]!;
    return {
      clientId: createClientId(r.client_id),
      actionId: r.action_id,
      commandName: r.command_name,
      payloadSha256: r.payload_sha256,
      actorId: r.actor_id,
      responseBody:
        typeof r.response_body === "string" ? JSON.parse(r.response_body) : r.response_body,
      committedAt:
        r.committed_at instanceof Date ? r.committed_at.toISOString() : String(r.committed_at)
    };
  }
}
