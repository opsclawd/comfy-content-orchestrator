import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  AccessDeniedError,
  ConcurrencyConflictError,
  createActionId,
  createBatchId,
  createClientId,
  createEvidenceId,
  createSourceObjectId,
  MimeConflictError,
  ProductValidationError,
  ReportDisputedError,
  SourceSupersededError,
  type Sha256Hex
} from "@cco/domain";
import type {
  LinkEvidenceDerivativeCommandPayload,
  RegisterEvidenceCommandPayload
} from "@cco/application";
import { PostgresEvidenceAssetRepository } from "./postgres-evidence-asset-repository.js";

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("PostgresEvidenceAssetRepository unit tests", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f0000-0000-7000-8000-000000000002");
  const evidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000010");
  const sourceObjectId = createSourceObjectId("018f0000-0000-7000-8000-000000000020");
  const sha256 = "1111111111111111111111111111111111111111111111111111111111111111" as Sha256Hex;
  const derivativeSha256 =
    "2222222222222222222222222222222222222222222222222222222222222222" as Sha256Hex;
  const referenceAssetId = "018f0000-0000-7000-8000-000000000030";
  const canonicalKey = `clients/${clientId}/evidence/originals/${sha256}`;

  const validRegisterPayload: RegisterEvidenceCommandPayload = {
    batchId,
    purpose: "macro_hero_photo",
    sourceClass: "photo",
    acquisitionMethod: "direct_upload",
    assertionText: "Valid assertion text",
    reportedCaptureDate: null,
    reportedCaptureTimestamp: null,
    reportedCapturePrecision: null,
    captureContext: null,
    rightsStatus: "granted",
    consentStatus: "granted",
    rightsAttribution: null,
    rightsDocumentLocator: null,
    registrationIntent: "initial_assertion",
    originalSha256: sha256,
    detectedMimeType: "image/jpeg",
    byteLength: 1024,
    storageBucket: "restricted-evidence",
    storageObjectKey: canonicalKey,
    retentionPolicyVersion: "v1"
  };

  function createMockPoolClient(
    handler: (normSql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  ) {
    let lastSkuArchivedAt: Date | null | undefined;
    let lastBatchArchivedAt: Date | null | undefined;

    return {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const norm = normalizeSql(sql);
        const result = await handler(norm, params);

        if (result.rows.length > 0) {
          if ("sku_archived_at" in result.rows[0]!) {
            lastSkuArchivedAt = result.rows[0]!.sku_archived_at as Date | null;
          }
          if ("batch_archived_at" in result.rows[0]!) {
            lastBatchArchivedAt = result.rows[0]!.batch_archived_at as Date | null;
          }
        }

        const lower = norm.toLowerCase();
        if (lower.includes("from product_skus") && result.rows.length === 0) {
          const skuId = (params?.[1] as string) || "018f0000-0000-7000-8000-000000000005";
          return {
            rows: [
              {
                sku_id: skuId,
                archived_at: lastSkuArchivedAt ?? null
              }
            ]
          };
        }

        if (
          lower.includes("from product_batches") &&
          lower.includes("for") &&
          result.rows.length === 0
        ) {
          const bId = (params?.[1] as string) || "018f0000-0000-7000-8000-000000000002";
          return {
            rows: [
              {
                batch_id: bId,
                archived_at: lastBatchArchivedAt ?? null,
                sku_id: (params?.[1] as string) || "018f0000-0000-7000-8000-000000000005"
              }
            ]
          };
        }

        if (lower.includes("from batch_evidence_links") && result.rows.length > 0) {
          return {
            rows: result.rows.map((r) => ({
              batch_id: r.batch_id ?? "018f0000-0000-7000-8000-000000000002",
              sku_id: r.sku_id ?? "018f0000-0000-7000-8000-000000000005",
              ...r
            }))
          };
        }

        return result;
      }),
      getTransactionStatus: vi.fn(() => "T"),
      release: vi.fn()
    } as unknown as PoolClient;
  }

  describe("Transaction enforcement", () => {
    it("fails fast if mutations are called against a Pool instead of a PoolClient", async () => {
      const fakePool = {
        connect: async () => ({}),
        query: async () => ({ rows: [] })
      } as unknown as Pool;

      const repo = new PostgresEvidenceAssetRepository(fakePool);
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validRegisterPayload
        })
      ).rejects.toThrow(/Mutating operations require a transaction-bound PoolClient/);
    });

    it("fails fast if externalTransaction option is false", async () => {
      const fakeClient = createMockPoolClient(async () => ({ rows: [] }));
      const repo = new PostgresEvidenceAssetRepository(fakeClient, { externalTransaction: false });

      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validRegisterPayload
        })
      ).rejects.toThrow(/Mutating operations must run within an active UnitOfWork transaction/);
    });

    it("fails fast if client transaction status is not 'T'", async () => {
      const fakeClient = createMockPoolClient(async () => ({ rows: [] }));
      (fakeClient.getTransactionStatus as ReturnType<typeof vi.fn>).mockReturnValue("I");
      const repo = new PostgresEvidenceAssetRepository(fakeClient, { externalTransaction: true });

      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validRegisterPayload
        })
      ).rejects.toThrow(/Mutating operations require an active transaction block/);
    });
  });

  describe("registerEvidence enforcement", () => {
    it("rejects when the parent SKU is archived", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: null,
                sku_id: "018f0000-0000-7000-8000-000000000005",
                sku_archived_at: new Date("2026-10-01T00:00:00.000Z") // SKU is archived!
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validRegisterPayload
        })
      ).rejects.toThrow(AccessDeniedError);
    });

    it("rejects when the batch is archived", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: new Date("2026-10-01T00:00:00.000Z"), // Batch is archived!
                sku_id: "018f0000-0000-7000-8000-000000000005",
                sku_archived_at: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validRegisterPayload
        })
      ).rejects.toThrow(AccessDeniedError);
    });

    it("rejects when reused source object is unavailable", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: null,
                sku_id: "018f0000-0000-7000-8000-000000000005",
                sku_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "quarantined", // Unavailable!
                original_sha256: sha256,
                detected_mime_type: "image/jpeg",
                byte_length: 1024,
                storage_bucket: "restricted-evidence",
                storage_object_key: canonicalKey,
                uploaded_at: new Date(),
                uploader_id: "u1",
                access_class: "restricted_original",
                retention_class: "source_evidence_archive",
                retention_policy_version: "v1",
                storage_version_id: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: {
            ...validRegisterPayload,
            reusedSourceObjectId: sourceObjectId
          }
        })
      ).rejects.toThrow(AccessDeniedError);
    });

    it("rejects when reused source object detectedMimeType or byteLength mismatches", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: null,
                sku_id: "sku-1",
                sku_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available",
                original_sha256: sha256,
                detected_mime_type: "image/png", // Mismatch!
                byte_length: 1024,
                storage_bucket: "restricted-evidence",
                storage_object_key: canonicalKey,
                uploaded_at: new Date(),
                uploader_id: "u1",
                access_class: "restricted_original",
                retention_class: "source_evidence_archive",
                retention_policy_version: "v1",
                storage_version_id: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: {
            ...validRegisterPayload,
            reusedSourceObjectId: sourceObjectId
          }
        })
      ).rejects.toThrow(ProductValidationError);
    });

    it("rejects when reused source object has an active dispute", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: null,
                sku_id: "sku-1",
                sku_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects") && sql.includes("FOR UPDATE")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available",
                original_sha256: sha256,
                detected_mime_type: "image/jpeg",
                byte_length: 1024,
                storage_bucket: "restricted-evidence",
                storage_object_key: canonicalKey,
                uploaded_at: new Date(),
                uploader_id: "u1",
                access_class: "restricted_original",
                retention_class: "source_evidence_archive",
                retention_policy_version: "v1",
                storage_version_id: null
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links")) {
          return { rows: [] };
        }
        if (sql.includes("source_objects") && sql.includes("FOR SHARE")) {
          return { rows: [{ 1: 1 }] };
        }
        if (sql.includes("evidence_verification_events")) {
          return {
            rows: [
              {
                event_id: "018f0000-0000-7000-8000-000000000088",
                outcome: "disputed",
                withdrawal_event_id: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: {
            ...validRegisterPayload,
            reusedSourceObjectId: sourceObjectId
          }
        })
      ).rejects.toThrow(ReportDisputedError);
    });

    it("rejects duplicate assertion on the same batch with ConcurrencyConflictError", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: null,
                sku_id: "sku-1",
                sku_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available",
                original_sha256: sha256,
                detected_mime_type: "image/jpeg",
                byte_length: 1024,
                storage_bucket: "restricted-evidence",
                storage_object_key: canonicalKey,
                uploaded_at: new Date(),
                uploader_id: "u1",
                access_class: "restricted_original",
                retention_class: "source_evidence_archive",
                retention_policy_version: "v1",
                storage_version_id: null
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links") && sql.includes("l.batch_id != $3")) {
          return { rows: [] };
        }
        if (sql.includes("evidence_verification_events")) {
          return { rows: [] };
        }
        if (sql.includes("batch_evidence_links") && sql.includes("l.batch_id = $3")) {
          return { rows: [{ evidence_id: "018f0000-0000-7000-8000-000000000055" }] };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: {
            ...validRegisterPayload,
            reusedSourceObjectId: sourceObjectId
          }
        })
      ).rejects.toThrow(ConcurrencyConflictError);
    });

    it("in supersede: rejects if target evidence asset has active dispute", async () => {
      const targetEvidenceId = createEvidenceId("018f0000-0000-7000-8000-000000000050");
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("product_batches")) {
          return {
            rows: [
              {
                batch_id: batchId,
                archived_at: null,
                sku_id: "sku-1",
                sku_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects") && sql.includes("original_sha256 = $2 FOR UPDATE")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available",
                original_sha256: sha256,
                detected_mime_type: "image/jpeg",
                byte_length: 1024,
                storage_bucket: "restricted-evidence",
                storage_object_key: canonicalKey,
                uploaded_at: new Date(),
                uploader_id: "u1",
                access_class: "restricted_original",
                retention_class: "source_evidence_archive",
                retention_policy_version: "v1",
                storage_version_id: null
              }
            ]
          };
        }
        if (
          sql.includes("evidence_assets") &&
          sql.includes("WHERE client_id = $1 AND evidence_id = $2 FOR UPDATE")
        ) {
          return {
            rows: [
              {
                evidence_id: targetEvidenceId,
                client_id: clientId,
                current_revision: 1,
                version: 1,
                created_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        if (
          sql.includes("evidence_verification_events") &&
          sql.includes("WHERE client_id = $1 AND evidence_id = $2")
        ) {
          return {
            rows: [
              {
                event_id: "018f0000-0000-7000-8000-000000000088",
                outcome: "rejected",
                withdrawal_event_id: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.registerEvidence({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: {
            ...validRegisterPayload,
            registrationIntent: "supersede",
            targetEvidenceId,
            expectedEvidenceVersion: 1
          }
        })
      ).rejects.toThrow(ReportDisputedError);
    });
  });

  describe("linkDerivative enforcement", () => {
    const validLinkPayload: LinkEvidenceDerivativeCommandPayload = {
      evidenceId,
      evidenceRevision: 1,
      referenceAssetId,
      derivativeSha256,
      transformDescription: "Downsampled WebP preview",
      transformToolVersion: "sharp@0.33.5"
    };

    it("rejects if target evidence revision is superseded", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("evidence_revisions")) {
          return {
            rows: [
              {
                client_id: clientId,
                evidence_id: evidenceId,
                revision: 1,
                source_object_id: sourceObjectId
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links")) {
          return {
            rows: [
              {
                sku_archived_at: null,
                batch_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available"
              }
            ]
          };
        }
        if (sql.includes("evidence_assets")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                client_id: clientId,
                current_revision: 2, // Current is 2, attempted is 1!
                version: 2,
                created_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.linkDerivative({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validLinkPayload
        })
      ).rejects.toThrow(SourceSupersededError);
    });

    it("rejects if associated batch is archived", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("evidence_assets")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                client_id: clientId,
                current_revision: 1,
                version: 1,
                created_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("evidence_revisions")) {
          return {
            rows: [
              {
                client_id: clientId,
                evidence_id: evidenceId,
                revision: 1,
                source_object_id: sourceObjectId,
                source_class: "photo",
                acquisition_method: "direct_upload",
                submitted_by: "actor-1",
                submitted_at: new Date(),
                assertion_text: "Text",
                reported_capture_date: null,
                reported_capture_timestamp: null,
                reported_capture_precision: null,
                capture_context: null,
                rights_status: "granted",
                consent_status: "granted",
                rights_attribution: null,
                rights_document_locator: null,
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links")) {
          return {
            rows: [
              {
                sku_archived_at: null,
                batch_archived_at: new Date("2026-10-01T00:00:00.000Z") // Batch archived!
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.linkDerivative({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validLinkPayload
        })
      ).rejects.toThrow(AccessDeniedError);
    });

    it("rejects if associated SKU is archived", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("evidence_assets")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                client_id: clientId,
                current_revision: 1,
                version: 1,
                created_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("evidence_revisions")) {
          return {
            rows: [
              {
                client_id: clientId,
                evidence_id: evidenceId,
                revision: 1,
                source_object_id: sourceObjectId,
                source_class: "photo",
                acquisition_method: "direct_upload",
                submitted_by: "actor-1",
                submitted_at: new Date(),
                assertion_text: "Text",
                reported_capture_date: null,
                reported_capture_timestamp: null,
                reported_capture_precision: null,
                capture_context: null,
                rights_status: "granted",
                consent_status: "granted",
                rights_attribution: null,
                rights_document_locator: null,
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links")) {
          return {
            rows: [
              {
                sku_archived_at: new Date("2026-10-01T00:00:00.000Z"), // SKU archived!
                batch_archived_at: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.linkDerivative({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validLinkPayload
        })
      ).rejects.toThrow(AccessDeniedError);
    });

    it("rejects if evidence asset has an active dispute", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("evidence_assets")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                client_id: clientId,
                current_revision: 1,
                version: 1,
                created_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("evidence_revisions")) {
          return {
            rows: [
              {
                client_id: clientId,
                evidence_id: evidenceId,
                revision: 1,
                source_object_id: sourceObjectId,
                source_class: "photo",
                acquisition_method: "direct_upload",
                submitted_by: "actor-1",
                submitted_at: new Date(),
                assertion_text: "Text",
                reported_capture_date: null,
                reported_capture_timestamp: null,
                reported_capture_precision: null,
                capture_context: null,
                rights_status: "granted",
                consent_status: "granted",
                rights_attribution: null,
                rights_document_locator: null,
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links")) {
          return {
            rows: [
              {
                sku_archived_at: null,
                batch_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available"
              }
            ]
          };
        }
        if (sql.includes("evidence_verification_events e JOIN evidence_revisions r")) {
          return { rows: [] }; // No source object dispute
        }
        if (
          sql.includes("evidence_verification_events WHERE client_id = $1 AND evidence_id = $2")
        ) {
          return {
            rows: [
              {
                event_id: "018f0000-0000-7000-8000-000000000088",
                outcome: "disputed",
                withdrawal_event_id: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.linkDerivative({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validLinkPayload
        })
      ).rejects.toThrow(ReportDisputedError);
    });

    it("rejects if reference asset content hash mismatches derivative hash", async () => {
      const client = createMockPoolClient(async (sql) => {
        if (sql.includes("product_evidence_command_receipts")) {
          return { rows: [] };
        }
        if (sql.includes("evidence_assets")) {
          return {
            rows: [
              {
                evidence_id: evidenceId,
                client_id: clientId,
                current_revision: 1,
                version: 1,
                created_at: new Date(),
                archived_at: null
              }
            ]
          };
        }
        if (sql.includes("evidence_revisions")) {
          return {
            rows: [
              {
                client_id: clientId,
                evidence_id: evidenceId,
                revision: 1,
                source_object_id: sourceObjectId,
                source_class: "photo",
                acquisition_method: "direct_upload",
                submitted_by: "actor-1",
                submitted_at: new Date(),
                assertion_text: "Text",
                reported_capture_date: null,
                reported_capture_timestamp: null,
                reported_capture_precision: null,
                capture_context: null,
                rights_status: "granted",
                consent_status: "granted",
                rights_attribution: null,
                rights_document_locator: null,
                supersedes_revision: null
              }
            ]
          };
        }
        if (sql.includes("batch_evidence_links")) {
          return {
            rows: [
              {
                sku_archived_at: null,
                batch_archived_at: null
              }
            ]
          };
        }
        if (sql.includes("source_objects")) {
          return {
            rows: [
              {
                source_object_id: sourceObjectId,
                client_id: clientId,
                availability: "available"
              }
            ]
          };
        }
        if (sql.includes("evidence_verification_events")) {
          return { rows: [] };
        }
        if (sql.includes("reference_assets")) {
          return {
            rows: [
              {
                asset_id: referenceAssetId,
                content_hash_sha256:
                  "9999999999999999999999999999999999999999999999999999999999999999", // Mismatched!
                archived_at: null
              }
            ]
          };
        }
        return { rows: [] };
      });

      const repo = new PostgresEvidenceAssetRepository(client, { externalTransaction: true });
      await expect(
        repo.linkDerivative({
          clientId,
          actionId: createActionId("018f0000-0000-7000-8000-000000000099"),
          actorId: "actor-1",
          timestamp: "2026-10-20T00:00:00.000Z",
          payload: validLinkPayload
        })
      ).rejects.toThrow(MimeConflictError);
    });
  });
});
