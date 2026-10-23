import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  CLAIM_POLICY_VERSION,
  createActionId,
  createBatchId,
  createClaimId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  createSha256Hex,
  createSkuId,
  createSourceObjectId,
  IdempotencyConflictError,
  normalizeClaimParameters,
  type ClaimId
} from "@cco/domain";
import type { CommandEnvelope } from "@cco/application";
import type { CreateClaimRequest, LinkClaimEvidenceRequest } from "@cco/contracts";
import { PostgresProductClaimRepository } from "./postgres-product-claim-repository.js";
import { computePayloadSha256 } from "./postgres-product-evidence-repository.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("PostgresProductClaimRepository unit tests", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000002");
  const claimId = createClaimId("018f6f00-0000-7000-8000-000000000003");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000004");
  const sourceObjectId = createSourceObjectId("018f6f00-0000-7000-8000-000000000005");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000006");
  const measurementId = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000007");
  const sha256 = createSha256Hex(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  const skuId = createSkuId("018f6f00-0000-7000-8000-000000000099");

  function createMockPoolClient(
    handler: (
      normSql: string,
      params?: unknown[]
    ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>
  ) {
    return {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        return await handler(normalizeSql(sql), params);
      }),
      getTransactionStatus: vi.fn(() => "T"),
      release: vi.fn()
    } as unknown as PoolClient;
  }

  const validCreatePayload: CreateClaimRequest = {
    batchId,
    canonicalKind: "certificate_panel_measurement",
    proofCategory: "coa_measurement_backed",
    parameters: {
      kind: "certificate_panel_measurement",
      panelName: "Cannabinoids",
      measurements: [
        {
          analyte: "THCA",
          exactDecimalValue: "24.5000",
          unit: "percent_w_w",
          basis: "dry_weight",
          context: "flower",
          quantityKind: "mass_fraction",
          requiredScope: "sample_only"
        }
      ]
    },
    displayWording: "Laboratory verified 24.5% THCA"
  };

  const createCmd: CommandEnvelope<CreateClaimRequest> = {
    actionId: createActionId("018f6f00-0000-7000-8000-000000000010"),
    clientId,
    actorId: "compliance-officer",
    timestamp: "2026-10-19T12:00:00.000Z",
    payload: validCreatePayload
  };

  describe("Transaction enforcement", () => {
    it("fails fast if mutations are called against an unbound Pool instead of a PoolClient", async () => {
      const fakePool = {
        totalCount: 5,
        connect: async () => ({}),
        query: async () => ({ rows: [] })
      } as unknown as Pool;

      const repo = new PostgresProductClaimRepository(fakePool);
      await expect(repo.createClaim(createCmd)).rejects.toThrow(
        /Mutating operations require a transaction-bound PoolClient/
      );
    });

    it("fails fast if externalTransaction option is false", async () => {
      const mockClient = createMockPoolClient(async () => ({ rows: [] }));
      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: false });
      await expect(repo.createClaim(createCmd)).rejects.toThrow(
        /Mutating operations must run within an active UnitOfWork transaction/
      );
    });

    it("fails fast if getTransactionStatus reports idle", async () => {
      const mockClient = {
        query: vi.fn(),
        getTransactionStatus: vi.fn(() => "I"),
        release: vi.fn()
      } as unknown as PoolClient;

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      await expect(repo.createClaim(createCmd)).rejects.toThrow(/active UnitOfWork transaction/);
    });
  });

  describe("Receipt deduplication and idempotency", () => {
    it("replays previously committed receipt when actionId matches exactly", async () => {
      const payloadHash = computePayloadSha256(createCmd.payload);
      const cachedResult = {
        claim: {
          claimId,
          clientId,
          skuId,
          batchId,
          currentRevision: 1,
          state: "draft" as const,
          version: 1,
          invalidationCause: null,
          invalidationSourceRef: null,
          createdAt: "2026-10-19T12:00:00.000Z",
          updatedAt: "2026-10-19T12:00:00.000Z",
          archivedAt: null
        },
        revision: {
          clientId,
          claimId,
          revision: 1,
          batchId,
          canonicalKind: "certificate_panel_measurement" as const,
          proofCategory: "coa_measurement_backed" as const,
          parameters: normalizeClaimParameters(validCreatePayload.parameters),
          displayWording: validCreatePayload.displayWording ?? null,
          policyVersion: CLAIM_POLICY_VERSION,
          assertedBy: "compliance-officer",
          assertedAt: "2026-10-19T12:00:00.000Z",
          supersedesRevision: null
        }
      };

      const mockClient = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return {
            rows: [
              {
                client_id: clientId,
                action_id: createCmd.actionId,
                command_name: "createClaim",
                payload_sha256: payloadHash,
                actor_id: createCmd.actorId,
                response_body: cachedResult,
                committed_at: new Date()
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      const result = await repo.createClaim(createCmd);

      expect(result).toEqual(cachedResult);
      // Ensure no insert queries were executed
      expect(mockClient.query).toHaveBeenCalledTimes(3);
      const queries = (
        mockClient.query as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.map((c) => c[0] as string);
      expect(queries.some((q) => q.toUpperCase().includes("INSERT"))).toBe(false);
    });

    it("throws IdempotencyConflictError if actionId matches but payloadHash differs", async () => {
      const mockClient = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return {
            rows: [
              {
                client_id: clientId,
                action_id: createCmd.actionId,
                command_name: "createClaim",
                payload_sha256: "different-hash",
                actor_id: createCmd.actorId,
                response_body: {},
                committed_at: new Date()
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      await expect(repo.createClaim(createCmd)).rejects.toThrow(IdempotencyConflictError);
    });

    it("throws IdempotencyConflictError if actionId matches but actorId differs", async () => {
      const payloadHash = computePayloadSha256(createCmd.payload);
      const mockClient = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return {
            rows: [
              {
                client_id: clientId,
                action_id: createCmd.actionId,
                command_name: "createClaim",
                payload_sha256: payloadHash,
                actor_id: "different-actor",
                response_body: {},
                committed_at: new Date()
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      await expect(repo.createClaim(createCmd)).rejects.toThrow(IdempotencyConflictError);
    });

    it("throws IdempotencyConflictError if actionId matches but command_name differs", async () => {
      const payloadHash = computePayloadSha256(createCmd.payload);
      const mockClient = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return {
            rows: [
              {
                client_id: clientId,
                action_id: createCmd.actionId,
                command_name: "appendClaimRevision",
                payload_sha256: payloadHash,
                actor_id: createCmd.actorId,
                response_body: {},
                committed_at: new Date()
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      await expect(repo.createClaim(createCmd)).rejects.toThrow(IdempotencyConflictError);
    });
  });

  describe("Lock acquisition sequence", () => {
    it("acquires locks in canonical order: SKU -> Batch -> Claims on createClaim", async () => {
      const queryLog: string[] = [];

      const mockClient = createMockPoolClient(async (sql) => {
        queryLog.push(sql);
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("FROM product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                client_id: clientId,
                sku_id: skuId,
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM product_skus")) {
          return {
            rows: [
              {
                sku_id: skuId,
                client_id: clientId,
                archived_at: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      await repo.createClaim(createCmd);

      // Check lock query sequence:
      // First, receipt check
      // Second, SKU share lock
      // Third, Batch share lock
      // Fourth, insert product_claims
      // Fifth, insert product_claim_revisions
      // Sixth, record receipt
      const skuLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM product_skus") && q.includes("FOR SHARE")
      );
      const batchLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM product_batches") && q.includes("FOR SHARE")
      );
      const insertClaimIndex = queryLog.findIndex((q) => q.includes("INSERT INTO product_claims"));
      const insertRevisionIndex = queryLog.findIndex((q) =>
        q.includes("INSERT INTO product_claim_revisions")
      );
      const insertReceiptIndex = queryLog.findIndex((q) =>
        q.includes("INSERT INTO product_evidence_command_receipts")
      );

      expect(skuLockIndex).toBeGreaterThan(-1);
      expect(batchLockIndex).toBeGreaterThan(skuLockIndex);
      expect(insertClaimIndex).toBeGreaterThan(batchLockIndex);
      expect(insertRevisionIndex).toBeGreaterThan(insertClaimIndex);
      expect(insertReceiptIndex).toBeGreaterThan(insertRevisionIndex);
    });
  });

  describe("Link claim evidence command", () => {
    const linkCmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }> = {
      actionId: createActionId("018f6f00-0000-7000-8000-000000000020"),
      clientId,
      actorId: "compliance-officer",
      timestamp: "2026-10-19T13:00:00.000Z",
      payload: {
        claimId,
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Attaching laboratory certificate",
        links: [
          {
            evidenceId,
            evidenceRevision: 1,
            sourceObjectId,
            sourceSha256: sha256,
            supportRole: "primary_measurement",
            reportId,
            reportRevision: 1,
            measurementId
          }
        ]
      }
    };

    it("acquires locks in canonical order: SKU -> Batch -> SourceObjects -> EvidenceAssets -> CoaReports -> Claims", async () => {
      const queryLog: string[] = [];

      const mockClient = createMockPoolClient(async (sql) => {
        queryLog.push(sql);
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("FROM product_claims")) {
          return {
            rows: [
              {
                claim_id: claimId,
                client_id: clientId,
                sku_id: skuId,
                batch_id: batchId,
                current_revision: 1,
                state: "draft",
                version: 1,
                invalidation_cause: null,
                invalidation_source_ref: null,
                created_at: new Date(),
                updated_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM product_claim_revisions")) {
          return {
            rows: [
              {
                client_id: clientId,
                claim_id: claimId,
                revision: 1,
                batch_id: batchId,
                canonical_kind: "certificate_panel_measurement",
                proof_category: "coa_measurement_backed",
                parameters_json: validCreatePayload.parameters,
                display_wording: "Laboratory verified 24.5% THCA",
                policy_version: CLAIM_POLICY_VERSION,
                asserted_by: "compliance-officer",
                asserted_at: new Date(),
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("FROM product_skus")) {
          return { rows: [{ sku_id: skuId, client_id: clientId, archived_at: null }] };
        }
        if (sql.includes("FROM product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                client_id: clientId,
                sku_id: skuId,
                lot_identifier: "LOT-123",
                current_facts_revision: 1,
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM source_objects")) {
          return {
            rows: [
              {
                object_id: sourceObjectId,
                source_object_id: sourceObjectId,
                original_sha256: sha256,
                availability: "available",
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM evidence_assets")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                client_id: clientId,
                current_revision: 1,
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM evidence_revisions")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                revision: 1,
                source_object_id: sourceObjectId,
                source_class: "coa",
                reported_capture_date: "2026-10-18"
              }
            ]
          };
        }
        if (sql.includes("FROM batch_evidence_links")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("FROM coa_reports")) {
          return {
            rows: [
              {
                report_id: reportId,
                client_id: clientId,
                batch_id: batchId,
                current_revision: 1,
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM coa_report_revisions")) {
          return {
            rows: [
              {
                report_id: reportId,
                revision: 1,
                completeness_status: "complete",
                scope_kind: "sample_only",
                verified_lab_identity_event_id: null
              }
            ]
          };
        }
        if (sql.includes("FROM coa_report_review_events")) {
          return {
            rows: [
              {
                report_id: reportId,
                report_revision: 1,
                decision: "approved",
                assessed_scope: "sample_only"
              }
            ]
          };
        }
        if (sql.includes("FROM coa_measurements")) {
          return {
            rows: [
              {
                measurement_id: measurementId,
                report_id: reportId,
                report_revision: 1,
                analyte: "THCA",
                result_kind: "quantified",
                result_value: "24.5000",
                unit: "percent_w_w",
                quantity_kind: "mass_fraction",
                basis: "dry_weight",
                context: "flower"
              }
            ]
          };
        }
        if (sql.includes("FROM claim_source_links")) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      });

      const repo = new PostgresProductClaimRepository(mockClient, { externalTransaction: true });
      await repo.linkClaimEvidence(linkCmd);

      const skuLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM product_skus") && q.includes("FOR SHARE")
      );
      const batchLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM product_batches") && q.includes("FOR SHARE")
      );
      const sourceObjectLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM source_objects") && q.includes("FOR SHARE")
      );
      const evidenceLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM evidence_assets") && q.includes("FOR SHARE")
      );
      const reportLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM coa_reports") && q.includes("FOR SHARE")
      );
      const claimLockIndex = queryLog.findIndex(
        (q) => q.includes("FROM product_claims") && q.includes("FOR UPDATE")
      );

      expect(skuLockIndex).toBeGreaterThan(-1);
      expect(batchLockIndex).toBeGreaterThan(skuLockIndex);
      expect(sourceObjectLockIndex).toBeGreaterThan(batchLockIndex);
      expect(evidenceLockIndex).toBeGreaterThan(sourceObjectLockIndex);
      expect(reportLockIndex).toBeGreaterThan(evidenceLockIndex);
      expect(claimLockIndex).toBeGreaterThan(reportLockIndex);
    });
  });
});
