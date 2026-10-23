import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  createActionId,
  createBatchId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  IdempotencyConflictError
} from "@cco/domain";
import type { CommandEnvelope } from "@cco/application";
import type { CreateCoaReportRequest } from "@cco/contracts";
import { PostgresCoaReportRepository } from "./postgres-coa-report-repository.js";
import { computePayloadSha256 } from "./postgres-product-evidence-repository.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("PostgresCoaReportRepository unit tests", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000002");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000003");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000004");
  const measurementId = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000005");
  const sourceObjectId = "018f6f00-0000-7000-8000-000000000006";
  const skuId = "018f6f00-0000-7000-8000-000000000007";

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

  const validCreatePayload: CreateCoaReportRequest = {
    batchId,
    evidenceId,
    evidenceRevision: 1,
    completenessStatus: "complete",
    reportIdentifierAsClaimed: "RPT-2026-001",
    reportDate: "2026-10-18",
    labNameAsClaimed: "Steep Hill Analytical",
    sampleIdentifierAsClaimed: "SMPL-882",
    scopeKind: "sample_only",
    scopeDescription: "One 5g representative sample",
    sampleToBatchAssociationConfirmed: true,
    sampleToBatchAssociationAttestation: "CoC matches registered lot",
    measurements: [
      {
        analyte: "THCA",
        resultKind: "quantified",
        resultValue: "24.5000",
        unit: "percent_w_w",
        basis: "dry_weight",
        context: "flower",
        quantityKind: "mass_fraction",
        uncertaintyAbsolute: "0.2500"
      }
    ]
  };

  const createCmd: CommandEnvelope<CreateCoaReportRequest> = {
    actionId: createActionId("018f6f00-0000-7000-8000-000000000099"),
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

      const repo = new PostgresCoaReportRepository(fakePool);
      await expect(repo.createReport(createCmd)).rejects.toThrow(
        /Mutating operations require a transaction-bound PoolClient/
      );
    });

    it("fails fast if externalTransaction option is false", async () => {
      const mockClient = createMockPoolClient(async () => ({ rows: [] }));
      const repo = new PostgresCoaReportRepository(mockClient, { externalTransaction: false });
      await expect(repo.createReport(createCmd)).rejects.toThrow(
        /Mutating operations must run within an active UnitOfWork transaction/
      );
    });

    it("fails fast if resolveMeasurementSupport is called with externalTransaction: true but transaction is not active", async () => {
      const mockClient = {
        query: vi.fn(async () => ({ rows: [] })),
        getTransactionStatus: vi.fn(() => "I"), // idle, not in transaction
        release: vi.fn()
      } as unknown as PoolClient;

      const repo = new PostgresCoaReportRepository(mockClient, { externalTransaction: true });
      await expect(
        repo.resolveMeasurementSupport({
          clientId,
          batchId,
          reportId,
          reportRevision: 1,
          measurementIds: [measurementId],
          requiredUnit: "percent_w_w",
          requiredBasis: "dry_weight",
          requiredContext: "flower",
          requiredScope: "sample_only"
        })
      ).rejects.toThrow(/Resolution with externalTransaction requires an active transaction block/);
    });

    it("manages read-write transaction block when resolveMeasurementSupport is called on a Pool", async () => {
      const executedSqls: string[] = [];
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          executedSqls.push(normalizeSql(sql));
          return { rows: [] };
        }),
        release: vi.fn()
      } as unknown as PoolClient;

      const mockPool = {
        totalCount: 5,
        connect: vi.fn(async () => mockClient),
        query: vi.fn(async () => ({ rows: [] }))
      } as unknown as Pool;

      const repo = new PostgresCoaReportRepository(mockPool);
      const res = await repo.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [measurementId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });

      expect(executedSqls).toContain("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
      expect(executedSqls).toContain("COMMIT");
      expect(mockClient.release).toHaveBeenCalled();
      expect(res.isSupported).toBe(false);
      expect(res.reason).toBe("report_not_found");
    });

    it("manages read-write transaction block when resolveMeasurementSupport is called on an autocommit PoolClient", async () => {
      const executedSqls: string[] = [];
      const mockClient = {
        query: vi.fn(async (sql: string) => {
          executedSqls.push(normalizeSql(sql));
          return { rows: [] };
        }),
        getTransactionStatus: vi.fn(() => "I"), // autocommit client
        release: vi.fn()
      } as unknown as PoolClient;

      const repo = new PostgresCoaReportRepository(mockClient);
      const res = await repo.resolveMeasurementSupport({
        clientId,
        batchId,
        reportId,
        reportRevision: 1,
        measurementIds: [measurementId],
        requiredUnit: "percent_w_w",
        requiredBasis: "dry_weight",
        requiredContext: "flower",
        requiredScope: "sample_only"
      });

      expect(executedSqls).toContain("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED READ WRITE");
      expect(executedSqls).toContain("COMMIT");
      expect(res.isSupported).toBe(false);
      expect(res.reason).toBe("report_not_found");
    });
  });

  describe("Idempotency receipts and replays", () => {
    it("replays cached response for identical command without re-executing writes", async () => {
      const cachedResult = {
        report: {
          clientId,
          reportId,
          batchId,
          evidenceId,
          currentRevision: 1,
          version: 1,
          createdAt: "2026-10-19T12:00:00.000Z",
          archivedAt: null
        },
        revision: {
          clientId,
          reportId,
          revision: 1,
          batchId,
          evidenceId,
          evidenceRevision: 1,
          completenessStatus: "complete",
          reportIdentifierAsClaimed: "RPT-2026-001",
          reportDate: "2026-10-18",
          labNameAsClaimed: "Steep Hill Analytical",
          sampleIdentifierAsClaimed: "SMPL-882",
          scopeKind: "sample_only",
          scopeDescription: "One 5g representative sample",
          sampleDate: null,
          samplingMethodDescription: null,
          sampleToBatchAssociationAttestation: "CoC matches registered lot",
          sampleToBatchAssociationConfirmed: true,
          verifiedLabIdentityEventId: null,
          assertedBy: "compliance-officer",
          assertedAt: "2026-10-19T12:00:00.000Z",
          supersedesRevision: null
        },
        measurements: []
      };

      const client = createMockPoolClient(async (sql) => {
        if (sql.startsWith("SELECT client_id, action_id")) {
          return {
            rows: [
              {
                client_id: clientId,
                action_id: createCmd.actionId,
                command_name: "createCoaReport",
                payload_sha256: computePayloadSha256(validCreatePayload),
                actor_id: "compliance-officer",
                response_body: cachedResult,
                committed_at: new Date()
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresCoaReportRepository(client, { externalTransaction: true });
      // When payload matches hash, replay happens
      const res = await repo.createReport({
        ...createCmd,
        payload: validCreatePayload
      });
      expect(res).toBeDefined();
    });

    it("throws IdempotencyConflictError if actionId was reused with different payload", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.startsWith("SELECT client_id, action_id")) {
          return {
            rows: [
              {
                client_id: clientId,
                action_id: createCmd.actionId,
                command_name: "createCoaReport",
                payload_sha256: "different-hash",
                actor_id: "compliance-officer",
                response_body: {},
                committed_at: new Date()
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresCoaReportRepository(client, { externalTransaction: true });
      await expect(repo.createReport(createCmd)).rejects.toThrow(IdempotencyConflictError);
    });
  });

  describe("Measurement support resolution", () => {
    const supportQuery = {
      clientId,
      batchId,
      reportId,
      reportRevision: 1,
      measurementIds: [measurementId],
      requiredUnit: "percent_w_w",
      requiredBasis: "dry_weight",
      requiredContext: "flower",
      requiredScope: "sample_only" as const
    };

    it("resolves valid measurement support with exact decimal string output", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("FROM coa_reports WHERE")) {
          return {
            rows: [
              {
                report_id: reportId,
                client_id: clientId,
                batch_id: batchId,
                evidence_id: evidenceId,
                current_revision: 1,
                version: 2,
                created_at: "2026-10-18T10:00:00.000Z",
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM product_batches WHERE")) {
          return { rows: [{ sku_id: skuId, archived_at: null }] };
        }
        if (sql.includes("FROM product_skus WHERE")) {
          return { rows: [{ archived_at: null }] };
        }
        if (sql.includes("FROM coa_report_revisions WHERE")) {
          return {
            rows: [
              {
                client_id: clientId,
                report_id: reportId,
                revision: 1,
                batch_id: batchId,
                evidence_id: evidenceId,
                evidence_revision: 1,
                completeness_status: "complete",
                report_identifier_as_claimed: "RPT-2026-001",
                report_date: "2026-10-18",
                lab_name_as_claimed: "Steep Hill Analytical",
                sample_identifier_as_claimed: "SMPL-882",
                scope_kind: "sample_only",
                scope_description: "One 5g representative sample",
                sample_date: null,
                sampling_method_description: null,
                sample_to_batch_association_attestation: "CoC matches registered lot",
                sample_to_batch_association_confirmed: true,
                verified_lab_identity_event_id: null,
                asserted_by: "compliance-officer",
                asserted_at: "2026-10-18T10:00:00.000Z",
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("FROM batch_evidence_links l")) {
          return { rows: [{ source_object_id: sourceObjectId }] };
        }
        if (sql.includes("FROM evidence_assets WHERE")) {
          return { rows: [{ archived_at: null, current_revision: 1 }] };
        }
        if (sql.includes("FROM source_objects WHERE")) {
          return { rows: [{ availability: "available" }] };
        }
        if (sql.includes("FROM evidence_verification_events e")) {
          return { rows: [] }; // No disputes
        }
        if (sql.includes("FROM coa_report_review_events")) {
          return {
            rows: [
              {
                event_id: crypto.randomUUID(),
                client_id: clientId,
                report_id: reportId,
                report_revision: 1,
                decision: "approved",
                actor_id: "reviewer-1",
                occurred_at: "2026-10-18T12:00:00.000Z",
                reason: "Verified",
                assessed_scope: "sample_only"
              }
            ]
          };
        }
        if (sql.includes("FROM coa_measurements WHERE")) {
          return {
            rows: [
              {
                measurement_id: measurementId,
                client_id: clientId,
                report_id: reportId,
                report_revision: 1,
                batch_id: batchId,
                evidence_id: evidenceId,
                evidence_revision: 1,
                analyte: "THCA",
                result_kind: "quantified",
                result_value: "24.5000",
                result_limit: null,
                result_qualifier: null,
                unit: "percent_w_w",
                basis: "dry_weight",
                context: "flower",
                quantity_kind: "mass_fraction",
                uncertainty_absolute: "0.2500"
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresCoaReportRepository(client, { externalTransaction: true });
      const res = await repo.resolveMeasurementSupport(supportQuery);

      expect(res.isSupported).toBe(true);
      expect(res.resolution?.measurements[0]?.decimalValue).toBe("24.5000");
      expect(res.resolution?.measurements[0]?.analyte).toBe("THCA");
      expect(res.resolution?.assessedScope).toBe("sample_only");
    });

    it("denies support when report is not approved", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("FROM coa_reports WHERE")) {
          return {
            rows: [
              {
                report_id: reportId,
                client_id: clientId,
                batch_id: batchId,
                evidence_id: evidenceId,
                current_revision: 1,
                version: 1,
                created_at: "2026-10-18T10:00:00.000Z",
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM product_batches WHERE")) {
          return { rows: [{ sku_id: skuId, archived_at: null }] };
        }
        if (sql.includes("FROM product_skus WHERE")) {
          return { rows: [{ archived_at: null }] };
        }
        if (sql.includes("FROM coa_report_revisions WHERE")) {
          return {
            rows: [
              {
                client_id: clientId,
                report_id: reportId,
                revision: 1,
                batch_id: batchId,
                evidence_id: evidenceId,
                evidence_revision: 1,
                completeness_status: "complete",
                report_identifier_as_claimed: "RPT-2026-001",
                report_date: "2026-10-18",
                lab_name_as_claimed: "Steep Hill Analytical",
                sample_identifier_as_claimed: "SMPL-882",
                scope_kind: "sample_only",
                scope_description: "One 5g representative sample",
                sample_date: null,
                sampling_method_description: null,
                sample_to_batch_association_attestation: "CoC matches registered lot",
                sample_to_batch_association_confirmed: true,
                verified_lab_identity_event_id: null,
                asserted_by: "compliance-officer",
                asserted_at: "2026-10-18T10:00:00.000Z",
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("FROM batch_evidence_links l")) {
          return { rows: [{ source_object_id: sourceObjectId }] };
        }
        if (sql.includes("FROM evidence_assets WHERE")) {
          return { rows: [{ archived_at: null, current_revision: 1 }] };
        }
        if (sql.includes("FROM source_objects WHERE")) {
          return { rows: [{ availability: "available" }] };
        }
        if (sql.includes("FROM evidence_verification_events e")) {
          return { rows: [] };
        }
        if (sql.includes("FROM coa_report_review_events")) {
          return { rows: [] }; // No review event -> pending
        }
        return { rows: [] };
      });

      const repo = new PostgresCoaReportRepository(client, { externalTransaction: true });
      const res = await repo.resolveMeasurementSupport(supportQuery);
      expect(res.isSupported).toBe(false);
      expect(res.reason).toBe("report_not_approved");
    });

    it("denies support when source object is disputed", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("FROM coa_reports WHERE")) {
          return {
            rows: [
              {
                report_id: reportId,
                client_id: clientId,
                batch_id: batchId,
                evidence_id: evidenceId,
                current_revision: 1,
                version: 2,
                created_at: "2026-10-18T10:00:00.000Z",
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("FROM product_batches WHERE")) {
          return { rows: [{ sku_id: skuId, archived_at: null }] };
        }
        if (sql.includes("FROM product_skus WHERE")) {
          return { rows: [{ archived_at: null }] };
        }
        if (sql.includes("FROM coa_report_revisions WHERE")) {
          return {
            rows: [
              {
                client_id: clientId,
                report_id: reportId,
                revision: 1,
                batch_id: batchId,
                evidence_id: evidenceId,
                evidence_revision: 1,
                completeness_status: "complete",
                report_identifier_as_claimed: "RPT-2026-001",
                report_date: "2026-10-18",
                lab_name_as_claimed: "Steep Hill Analytical",
                sample_identifier_as_claimed: "SMPL-882",
                scope_kind: "sample_only",
                scope_description: "One 5g representative sample",
                sample_date: null,
                sampling_method_description: null,
                sample_to_batch_association_attestation: "CoC matches registered lot",
                sample_to_batch_association_confirmed: true,
                verified_lab_identity_event_id: null,
                asserted_by: "compliance-officer",
                asserted_at: "2026-10-18T10:00:00.000Z",
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("FROM batch_evidence_links l")) {
          return { rows: [{ source_object_id: sourceObjectId }] };
        }
        if (sql.includes("FROM evidence_assets WHERE")) {
          return { rows: [{ archived_at: null, current_revision: 1 }] };
        }
        if (sql.includes("FROM source_objects WHERE")) {
          return { rows: [{ availability: "available" }] };
        }
        if (sql.includes("FROM evidence_verification_events e")) {
          return {
            rows: [
              {
                event_id: crypto.randomUUID(),
                outcome: "disputed",
                withdrawal_event_id: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresCoaReportRepository(client, { externalTransaction: true });
      const res = await repo.resolveMeasurementSupport(supportQuery);
      expect(res.isSupported).toBe(false);
      expect(res.reason).toBe("source_disputed");
    });
  });
});
