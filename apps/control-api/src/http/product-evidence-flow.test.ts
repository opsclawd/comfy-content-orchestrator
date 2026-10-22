import { describe, expect, it } from "vitest";
import {
  BatchEvidenceDossierSchema,
  SafeSourceObjectResponseSchema,
  type AppendBatchFactsRequest,
  type AppendClaimRevisionRequest,
  type ArchiveCoaReportRequest,
  type ArchiveBatchRequest,
  type ArchiveSkuRequest,
  type BatchEvidenceDossier,
  type BatchEvidenceLinkContract,
  type BatchFactsRevisionResponse,
  type ClaimDecisionEventContract,
  type ClaimEvidenceLinkContract,
  type CoaMeasurementContract,
  type CoaReportContract,
  type CoaReportRevisionContract,
  type CoaReviewEventContract,
  type CreateClaimRequest,
  type CreateCoaReportRequest,
  type CreateBatchRequest,
  type CreateSkuRequest,
  type EvidenceAssetContract,
  type EvidenceDerivativeContract,
  type EvidenceRevisionContract,
  type EvidenceVerificationEventContract,
  type InvalidateClaimRequest,
  type LinkClaimEvidenceRequest,
  type ProductBatchResponse,
  type ProductClaimContract,
  type ProductClaimRevisionContract,
  type ProductSkuResponse,
  type ReviewClaimRequest,
  type ReviewCoaReportRequest,
  type SupersedeCoaReportRequest,
  type UpdateBatchMetadataRequest,
  type UpdateSkuMetadataRequest
} from "@cco/contracts";
import type {
  CommandEnvelope,
  LinkExistingDerivativeInput,
  RecordEvidenceVerificationEventInput,
  RegisterEvidenceAssetInput
} from "@cco/application";
import {
  createBatchId,
  createClaimId,
  createClientId,
  createCoaReportId,
  createEvidenceId,
  createSkuId,
  IdempotencyConflictError,
  NotFoundError,
  StaleRevisionConflictError,
  type BatchId,
  type ClaimId,
  type ClientId,
  type CoaReportId,
  type EvidenceId,
  type SkuId
} from "@cco/domain";
import { createControlApiApp } from "./app.js";
import type { ControlApiContainer, ControlApiDependencies, ControlApiUseCases } from "./types.js";

interface StatefulTestHarness {
  readonly skus: Map<string, ProductSkuResponse>;
  readonly batches: Map<string, ProductBatchResponse>;
  readonly facts: Map<string, BatchFactsRevisionResponse[]>;
  readonly evidenceAssets: Map<string, EvidenceAssetContract>;
  readonly evidenceRevisions: Map<string, EvidenceRevisionContract[]>;
  readonly batchEvidenceLinks: Map<string, BatchEvidenceLinkContract[]>;
  readonly derivatives: Map<string, EvidenceDerivativeContract>;
  readonly verificationEvents: Map<string, EvidenceVerificationEventContract[]>;
  readonly coaReports: Map<string, CoaReportContract>;
  readonly coaRevisions: Map<string, CoaReportRevisionContract[]>;
  readonly coaReviewEvents: Map<string, CoaReviewEventContract[]>;
  readonly claims: Map<string, ProductClaimContract>;
  readonly claimRevisions: Map<string, ProductClaimRevisionContract[]>;
  readonly claimLinks: Map<string, ClaimEvidenceLinkContract[]>;
  readonly claimDecisionEvents: Map<string, ClaimDecisionEventContract[]>;
  readonly receipts: Map<string, { payloadSha256: string; response: unknown }>;
}

function createStatefulTestContainer(harness: StatefulTestHarness): ControlApiContainer {
  const checkIdempotency = <T>(
    key: string,
    payloadHash: string,
    execute: () => T
  ): { result: T; isReplay: boolean } => {
    const existing = harness.receipts.get(key);
    if (existing) {
      if (existing.payloadSha256 === payloadHash) {
        return { result: existing.response as T, isReplay: true };
      }
      throw new IdempotencyConflictError(key);
    }
    const result = execute();
    harness.receipts.set(key, { payloadSha256: payloadHash, response: result });
    return { result, isReplay: false };
  };

  const createProductSku = {
    execute: async (cmd: CommandEnvelope<CreateSkuRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const skuId = createSkuId("018e69e0-8a6a-72cb-b1b7-ec79a1f73801");
        const sku: ProductSkuResponse = {
          clientId: cmd.clientId,
          skuId,
          canonicalSku: cmd.payload.canonicalSku,
          displayName: cmd.payload.displayName,
          version: 1,
          createdAt: "2026-10-21T12:00:00.000Z",
          updatedAt: "2026-10-21T12:00:00.000Z",
          archivedAt: null
        };
        harness.skus.set(`${cmd.clientId}::${skuId}`, sku);
        return sku;
      }).result;
    }
  };

  const getProductSku = {
    execute: async (clientId: ClientId, skuId: SkuId) => {
      return harness.skus.get(`${clientId}::${skuId}`) ?? null;
    }
  };

  const listProductSkus = {
    execute: async (clientId: ClientId) => {
      return Array.from(harness.skus.values()).filter((s) => s.clientId === clientId);
    }
  };

  const updateProductSkuMetadata = {
    execute: async (cmd: CommandEnvelope<UpdateSkuMetadataRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const existing = [...harness.skus.values()].find(
          (candidate) => candidate.clientId === cmd.clientId
        );
        if (!existing) throw new NotFoundError("ProductSku", "unknown");
        const key = `${cmd.clientId}::${existing.skuId}`;
        if (existing.version !== cmd.payload.expectedVersion) {
          throw new StaleRevisionConflictError(
            "ProductSku",
            cmd.payload.expectedVersion,
            existing.version
          );
        }
        const updated: ProductSkuResponse = {
          ...existing,
          displayName: cmd.payload.displayName,
          version: existing.version + 1,
          updatedAt: "2026-10-21T12:05:00.000Z"
        };
        harness.skus.set(key, updated);
        return { sku: updated, isIdempotentReplay: false };
      }).result;
    }
  };

  const archiveProductSku = {
    execute: async (cmd: CommandEnvelope<ArchiveSkuRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const existing = [...harness.skus.values()].find(
          (candidate) => candidate.clientId === cmd.clientId
        );
        if (!existing) throw new NotFoundError("ProductSku", "unknown");
        const key = `${cmd.clientId}::${existing.skuId}`;
        if (existing.version !== cmd.payload.expectedVersion) {
          throw new StaleRevisionConflictError(
            "ProductSku",
            cmd.payload.expectedVersion,
            existing.version
          );
        }
        const archived: ProductSkuResponse = {
          ...existing,
          version: existing.version + 1,
          archivedAt: "2026-10-21T12:06:00.000Z",
          updatedAt: "2026-10-21T12:06:00.000Z"
        };
        harness.skus.set(key, archived);
        return { sku: archived, isIdempotentReplay: false };
      }).result;
    }
  };

  const createProductBatch = {
    execute: async (cmd: CommandEnvelope<CreateBatchRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const skuKey = `${cmd.clientId}::${cmd.payload.skuId}`;
        if (!harness.skus.has(skuKey)) throw new NotFoundError("ProductSku", cmd.payload.skuId);

        const batchId = createBatchId("018e69e0-8a6a-72cb-b1b7-ec79a1f73802");
        const batch: ProductBatchResponse = {
          clientId: cmd.clientId,
          batchId,
          skuId: cmd.payload.skuId,
          lotIdentifier: cmd.payload.lotIdentifier,
          displayName: cmd.payload.displayName,
          version: 1,
          currentFactsRevision: 1,
          createdAt: "2026-10-21T12:10:00.000Z",
          updatedAt: "2026-10-21T12:10:00.000Z",
          archivedAt: null
        };
        harness.batches.set(`${cmd.clientId}::${batchId}`, batch);

        const factsRevision: BatchFactsRevisionResponse = {
          clientId: cmd.clientId,
          batchId,
          revision: 1,
          originKind: cmd.payload.initialFacts?.originKind ?? "own_production",
          producerIdentityAsClaimed:
            cmd.payload.initialFacts?.producerIdentityAsClaimed ?? "Acme Labs",
          productionStartDate: cmd.payload.initialFacts?.productionStartDate ?? "2026-10-01",
          productionEndDate: cmd.payload.initialFacts?.productionEndDate ?? "2026-10-15",
          originEvidenceId: null,
          originEvidenceRevision: null,
          assertedBy: cmd.actorId,
          assertedAt: "2026-10-21T12:10:00.000Z",
          supersedesRevision: null
        };
        harness.facts.set(`${cmd.clientId}::${batchId}`, [factsRevision]);

        return { batch, initialFacts: factsRevision, isIdempotentReplay: false };
      }).result;
    }
  };

  const getProductBatch = {
    execute: async (clientId: ClientId, batchId: BatchId) => {
      return harness.batches.get(`${clientId}::${batchId}`) ?? null;
    }
  };

  const listProductBatches = {
    execute: async (clientId: ClientId) => {
      return Array.from(harness.batches.values()).filter((b) => b.clientId === clientId);
    }
  };

  const updateProductBatchMetadata = {
    execute: async (cmd: CommandEnvelope<UpdateBatchMetadataRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const existing = [...harness.batches.values()].find(
          (candidate) => candidate.clientId === cmd.clientId
        );
        if (!existing) throw new NotFoundError("ProductBatch", "unknown");
        const key = `${cmd.clientId}::${existing.batchId}`;
        if (existing.version !== cmd.payload.expectedVersion) {
          throw new StaleRevisionConflictError(
            "ProductBatch",
            cmd.payload.expectedVersion,
            existing.version
          );
        }
        const updated: ProductBatchResponse = {
          ...existing,
          displayName: cmd.payload.displayName,
          version: existing.version + 1,
          updatedAt: "2026-10-21T12:12:00.000Z"
        };
        harness.batches.set(key, updated);
        return { batch: updated, isIdempotentReplay: false };
      }).result;
    }
  };

  const archiveProductBatch = {
    execute: async (cmd: CommandEnvelope<ArchiveBatchRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const existing = [...harness.batches.values()].find(
          (candidate) => candidate.clientId === cmd.clientId
        );
        if (!existing) throw new NotFoundError("ProductBatch", "unknown");
        const key = `${cmd.clientId}::${existing.batchId}`;
        if (existing.version !== cmd.payload.expectedVersion) {
          throw new StaleRevisionConflictError(
            "ProductBatch",
            cmd.payload.expectedVersion,
            existing.version
          );
        }
        const archived: ProductBatchResponse = {
          ...existing,
          version: existing.version + 1,
          archivedAt: "2026-10-21T12:13:00.000Z",
          updatedAt: "2026-10-21T12:13:00.000Z"
        };
        harness.batches.set(key, archived);
        return { batch: archived, isIdempotentReplay: false };
      }).result;
    }
  };

  const appendBatchFacts = {
    execute: async (cmd: CommandEnvelope<AppendBatchFactsRequest>) => {
      const receiptKey = `${cmd.clientId}::${cmd.actionId}`;
      const payloadHash = JSON.stringify(cmd.payload);
      return checkIdempotency(receiptKey, payloadHash, () => {
        const batch = [...harness.batches.values()].find(
          (candidate) => candidate.clientId === cmd.clientId
        );
        if (!batch) throw new NotFoundError("ProductBatch", "unknown");
        if (batch.currentFactsRevision !== cmd.payload.expectedVersion) {
          throw new StaleRevisionConflictError(
            "BatchFactsRevision",
            cmd.payload.expectedVersion,
            batch.currentFactsRevision
          );
        }
        const nextRev = batch.currentFactsRevision + 1;
        const newFact: BatchFactsRevisionResponse = {
          clientId: cmd.clientId,
          batchId: batch.batchId,
          revision: nextRev,
          originKind: cmd.payload.originKind,
          producerIdentityAsClaimed: cmd.payload.producerIdentityAsClaimed ?? null,
          productionStartDate: cmd.payload.productionStartDate ?? null,
          productionEndDate: cmd.payload.productionEndDate ?? null,
          originEvidenceId: cmd.payload.originEvidenceId ?? null,
          originEvidenceRevision: cmd.payload.originEvidenceRevision ?? null,
          assertedBy: cmd.actorId,
          assertedAt: "2026-10-21T12:15:00.000Z",
          supersedesRevision: batch.currentFactsRevision
        };
        const scopedBatchKey = `${cmd.clientId}::${batch.batchId}`;
        const history = harness.facts.get(scopedBatchKey) ?? [];
        history.push(newFact);
        harness.facts.set(scopedBatchKey, history);
        harness.batches.set(scopedBatchKey, {
          ...batch,
          currentFactsRevision: nextRev,
          version: batch.version + 1
        });
        return newFact;
      }).result;
    }
  };

  const getBatchFactsHistory = {
    execute: async (clientId: ClientId, batchId: BatchId) => {
      const key = `${clientId}::${batchId}`;
      if (!harness.batches.has(key)) throw new NotFoundError("ProductBatch", batchId);
      return harness.facts.get(key) ?? [];
    }
  };

  const evidenceAsset = {
    registerEvidenceAsset: async (
      clientId: ClientId,
      batchId: BatchId,
      input: RegisterEvidenceAssetInput
    ) => {
      const batchKey = `${clientId}::${batchId}`;
      if (!harness.batches.has(batchKey)) throw new NotFoundError("ProductBatch", batchId);

      const evidenceId = createEvidenceId("018e69e0-8a6a-72cb-b1b7-ec79a1f73803");
      const sourceObjectId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73804";
      const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      const asset: EvidenceAssetContract = {
        clientId,
        evidenceId,
        currentRevision: 1,
        version: 1,
        createdAt: "2026-10-21T12:20:00.000Z",
        archivedAt: null
      };
      harness.evidenceAssets.set(`${clientId}::${evidenceId}`, asset);

      const revision: EvidenceRevisionContract = {
        clientId,
        evidenceId,
        revision: 1,
        sourceObjectId,
        sourceClass: input.sourceClass,
        acquisitionMethod: input.acquisitionMethod,
        submittedBy: input.actorId,
        submittedAt: "2026-10-21T12:20:00.000Z",
        assertionText: input.assertionText,
        reportedCaptureDate: input.reportedCaptureDate ?? null,
        reportedCaptureTimestamp: input.reportedCaptureTimestamp ?? null,
        reportedCapturePrecision: input.reportedCapturePrecision ?? null,
        captureContext: input.captureContext ?? null,
        rightsStatus: input.rightsStatus ?? "granted",
        consentStatus: input.consentStatus ?? "granted",
        rightsAttribution: input.rightsAttribution ?? null,
        rightsDocumentLocator: input.rightsDocumentLocator ?? null,
        supersedesRevision: null
      };
      harness.evidenceRevisions.set(`${clientId}::${evidenceId}`, [revision]);

      const link: BatchEvidenceLinkContract = {
        clientId,
        batchId,
        evidenceId,
        evidenceRevision: 1,
        purpose: input.purpose,
        assertedBy: input.actorId,
        assertedAt: "2026-10-21T12:20:00.000Z"
      };
      const existingLinks = harness.batchEvidenceLinks.get(batchKey) ?? [];
      existingLinks.push(link);
      harness.batchEvidenceLinks.set(batchKey, existingLinks);

      return {
        evidenceAsset: asset,
        evidenceRevision: revision,
        sourceObject: {
          sourceObjectId,
          originalSha256: sha256,
          detectedMimeType: "image/jpeg",
          byteLength: 2048,
          uploadedAt: "2026-10-21T12:20:00.000Z",
          uploaderId: input.actorId,
          accessClass: "restricted_original" as const,
          retentionClass: "source_evidence_archive" as const,
          retentionPolicyVersion: "policy-v1",
          availability: "available" as const,
          storageBucket: "secret-internal-bucket",
          storageObjectKey: "secret-internal-key",
          storageVersionId: "v1"
        },
        batchEvidenceLink: link,
        derivative: null
      };
    },

    linkDerivative: async (
      clientId: ClientId,
      batchId: BatchId,
      input: LinkExistingDerivativeInput
    ) => {
      const batchKey = `${clientId}::${batchId}`;
      if (!harness.batches.has(batchKey)) throw new NotFoundError("ProductBatch", batchId);

      const deriv: EvidenceDerivativeContract = {
        clientId,
        derivativeId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73805",
        evidenceId: input.evidenceId,
        evidenceRevision: input.evidenceRevision,
        referenceAssetId: input.referenceAssetId,
        derivativeSha256: input.derivativeSha256,
        transformDescription: input.transformDescription,
        transformToolVersion: input.transformToolVersion ?? null,
        createdBy: input.actorId,
        createdAt: "2026-10-21T12:25:00.000Z"
      };
      harness.derivatives.set(`${clientId}::${input.evidenceId}::${input.evidenceRevision}`, deriv);
      return deriv;
    },

    getDerivative: async (
      clientId: ClientId,
      _batchId: BatchId,
      evidenceId: EvidenceId,
      revision: number
    ) => {
      const key = `${clientId}::${evidenceId}::${revision}`;
      const deriv = harness.derivatives.get(key);
      if (!deriv) throw new NotFoundError("EvidenceDerivative", `${evidenceId}:${revision}`);
      return deriv;
    },

    recordVerificationEvent: async (
      clientId: ClientId,
      batchId: BatchId,
      input: RecordEvidenceVerificationEventInput
    ) => {
      const batchKey = `${clientId}::${batchId}`;
      if (!harness.batches.has(batchKey)) throw new NotFoundError("ProductBatch", batchId);

      const event: EvidenceVerificationEventContract = {
        clientId,
        eventId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73806",
        evidenceId: input.evidenceId,
        evidenceRevision: input.evidenceRevision,
        outcome: input.outcome,
        verificationKind: input.verificationKind,
        factScope: input.factScope,
        method: input.method,
        reason: input.reason,
        verifiedPartyReference: input.verifiedPartyReference ?? null,
        actorId: input.actorId,
        occurredAt: "2026-10-21T12:30:00.000Z",
        withdrawalEventId: input.withdrawalEventId ?? null
      };
      const key = `${clientId}::${input.evidenceId}::${input.evidenceRevision}`;
      const events = harness.verificationEvents.get(key) ?? [];
      events.push(event);
      harness.verificationEvents.set(key, events);
      return event;
    },

    listVerificationEvents: async (
      clientId: ClientId,
      _batchId: BatchId,
      evidenceId: EvidenceId,
      revision: number
    ) => {
      const key = `${clientId}::${evidenceId}::${revision}`;
      return { events: harness.verificationEvents.get(key) ?? [] };
    },

    listBatchEvidence: async (clientId: ClientId, batchId: BatchId) => {
      const links = harness.batchEvidenceLinks.get(`${clientId}::${batchId}`) ?? [];
      return {
        evidence: links.map((l) => ({
          evidenceId: l.evidenceId,
          currentRevision: l.evidenceRevision,
          version: 1,
          createdAt: l.assertedAt,
          archivedAt: null,
          linkedRevisions: [l.evidenceRevision]
        }))
      };
    },

    getEvidenceAssetHead: async (clientId: ClientId, _batchId: BatchId, evidenceId: EvidenceId) => {
      const asset = harness.evidenceAssets.get(`${clientId}::${evidenceId}`);
      if (!asset) throw new NotFoundError("EvidenceAsset", evidenceId);
      return {
        evidenceId: asset.evidenceId,
        currentRevision: asset.currentRevision,
        version: asset.version,
        createdAt: asset.createdAt,
        archivedAt: asset.archivedAt,
        linkedRevisions: [1]
      };
    },

    getEvidenceRevision: async (
      clientId: ClientId,
      _batchId: BatchId,
      evidenceId: EvidenceId,
      revision: number
    ) => {
      const revs = harness.evidenceRevisions.get(`${clientId}::${evidenceId}`) ?? [];
      const found = revs.find((r) => r.revision === revision);
      if (!found) throw new NotFoundError("EvidenceRevision", `${evidenceId}:${revision}`);
      return found;
    },

    deliverMedia: async (
      clientId: ClientId,
      batchId: BatchId,
      evidenceId: EvidenceId,
      revision: number
    ) => {
      const revs = harness.evidenceRevisions.get(`${clientId}::${evidenceId}`) ?? [];
      const found = revs.find((r) => r.revision === revision);
      if (!found) throw new NotFoundError("EvidenceRevision", `${evidenceId}:${revision}`);
      return {
        clientId,
        batchId,
        evidenceId,
        evidenceRevision: revision,
        sourceObjectId: found.sourceObjectId,
        originalSha256: "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
        detectedMimeType: "image/jpeg",
        byteLength: 2048,
        url: "https://signed.storage.cco.local/presigned-media-read?token=valid-300s",
        expiresAt: "2026-10-21T12:35:00.000Z"
      };
    }
  };

  const coaReport = {
    createCoaReport: async (
      clientId: ClientId,
      batchId: BatchId,
      cmd: CommandEnvelope<CreateCoaReportRequest>
    ) => {
      const reportId = createCoaReportId("018e69e0-8a6a-72cb-b1b7-ec79a1f73807");
      const report: CoaReportContract = {
        clientId,
        reportId,
        batchId,
        evidenceId: cmd.payload.evidenceId,
        currentRevision: 1,
        version: 1,
        createdAt: "2026-10-21T12:40:00.000Z",
        archivedAt: null
      };
      harness.coaReports.set(`${clientId}::${reportId}`, report);

      const measurements: CoaMeasurementContract[] = (cmd.payload.measurements ?? []).map(
        (m: NonNullable<CreateCoaReportRequest["measurements"]>[number], idx: number) => ({
          measurementId: `018e69e0-8a6a-72cb-b1b7-ec79a1f738${80 + idx}`,
          clientId,
          reportId,
          reportRevision: 1,
          batchId,
          evidenceId: cmd.payload.evidenceId,
          evidenceRevision: cmd.payload.evidenceRevision,
          analyte: m.analyte,
          resultKind: m.resultKind,
          resultValue: m.resultValue ?? null,
          resultLimit: m.resultLimit ?? null,
          resultQualifier: m.resultQualifier ?? null,
          unit: m.unit,
          basis: m.basis,
          context: m.context,
          quantityKind: m.quantityKind,
          methodAsReported: m.methodAsReported ?? null,
          uncertaintyAbsolute: m.uncertaintyAbsolute ?? null,
          detectionLimit: m.detectionLimit ?? null,
          quantificationLimit: m.quantificationLimit ?? null,
          analyticalQualifierCode: m.analyticalQualifierCode ?? null,
          analyticalQualifierExplanation: m.analyticalQualifierExplanation ?? null
        })
      );

      const revision: CoaReportRevisionContract = {
        clientId,
        reportId,
        revision: 1,
        batchId,
        evidenceId: cmd.payload.evidenceId,
        evidenceRevision: cmd.payload.evidenceRevision,
        completenessStatus: cmd.payload.completenessStatus,
        reportIdentifierAsClaimed: cmd.payload.reportIdentifierAsClaimed ?? null,
        reportDate: cmd.payload.reportDate ?? null,
        labNameAsClaimed: cmd.payload.labNameAsClaimed ?? null,
        sampleIdentifierAsClaimed: cmd.payload.sampleIdentifierAsClaimed ?? null,
        scopeKind: cmd.payload.scopeKind ?? "attributed_lot",
        scopeDescription: cmd.payload.scopeDescription ?? null,
        sampleDate: cmd.payload.sampleDate ?? null,
        samplingMethodDescription: cmd.payload.samplingMethodDescription ?? null,
        sampleToBatchAssociationAttestation:
          cmd.payload.sampleToBatchAssociationAttestation ?? null,
        sampleToBatchAssociationConfirmed: cmd.payload.sampleToBatchAssociationConfirmed ?? true,
        verifiedLabIdentityEventId: null,
        assertedBy: cmd.actorId,
        assertedAt: "2026-10-21T12:40:00.000Z",
        supersedesRevision: null,
        measurements
      };
      harness.coaRevisions.set(`${clientId}::${reportId}`, [revision]);

      return { report, currentRevision: revision };
    },

    listReportsForBatch: async (clientId: ClientId, batchId: BatchId) => {
      const reports = Array.from(harness.coaReports.values()).filter(
        (r) => r.clientId === clientId && r.batchId === batchId
      );
      return { reports };
    },

    getReportById: async (clientId: ClientId, batchId: BatchId, reportId: CoaReportId) => {
      const report = harness.coaReports.get(`${clientId}::${reportId}`);
      if (!report || report.batchId !== batchId) throw new NotFoundError("CoaReport", reportId);
      const revs = harness.coaRevisions.get(`${clientId}::${reportId}`) ?? [];
      return { report, currentRevision: revs[revs.length - 1] };
    },

    getReportRevision: async (
      clientId: ClientId,
      _batchId: BatchId,
      reportId: CoaReportId,
      revision: number
    ) => {
      const revs = harness.coaRevisions.get(`${clientId}::${reportId}`) ?? [];
      const found = revs.find((r) => r.revision === revision);
      if (!found) throw new NotFoundError("CoaReportRevision", `${reportId}:${revision}`);
      return found;
    },

    supersedeCoaReport: async (
      clientId: ClientId,
      batchId: BatchId,
      reportId: CoaReportId,
      cmd: CommandEnvelope<SupersedeCoaReportRequest>
    ) => {
      const report = harness.coaReports.get(`${clientId}::${reportId}`);
      if (!report || report.batchId !== batchId) throw new NotFoundError("CoaReport", reportId);
      if (report.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          report.version
        );
      }
      const updatedReport = {
        ...report,
        version: report.version + 1,
        currentRevision: report.currentRevision + 1
      };
      harness.coaReports.set(`${clientId}::${reportId}`, updatedReport);
      return { report: updatedReport, currentRevision: {} as unknown as CoaReportRevisionContract };
    },

    reviewCoaReport: async (
      clientId: ClientId,
      batchId: BatchId,
      reportId: CoaReportId,
      cmd: CommandEnvelope<ReviewCoaReportRequest>
    ) => {
      const report = harness.coaReports.get(`${clientId}::${reportId}`);
      if (!report || report.batchId !== batchId) throw new NotFoundError("CoaReport", reportId);
      if (report.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          report.version
        );
      }
      const reviewEvent: CoaReviewEventContract = {
        eventId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73808",
        clientId,
        reportId,
        reportRevision: report.currentRevision,
        decision: cmd.payload.decision,
        reason: cmd.payload.reason,
        actorId: cmd.actorId,
        occurredAt: "2026-10-21T12:45:00.000Z",
        assessedScope: "attributed_lot"
      };
      const events = harness.coaReviewEvents.get(`${clientId}::${reportId}`) ?? [];
      events.push(reviewEvent);
      harness.coaReviewEvents.set(`${clientId}::${reportId}`, events);
      const updated = { ...report, version: report.version + 1 };
      harness.coaReports.set(`${clientId}::${reportId}`, updated);
      return { report: updated, decisionEvent: reviewEvent };
    },

    archiveCoaReport: async (
      clientId: ClientId,
      batchId: BatchId,
      reportId: CoaReportId,
      cmd: CommandEnvelope<ArchiveCoaReportRequest>
    ) => {
      const report = harness.coaReports.get(`${clientId}::${reportId}`);
      if (!report || report.batchId !== batchId) throw new NotFoundError("CoaReport", reportId);
      if (report.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "CoaReport",
          cmd.payload.expectedVersion,
          report.version
        );
      }
      const archived = {
        ...report,
        version: report.version + 1,
        archivedAt: "2026-10-21T12:46:00.000Z"
      };
      harness.coaReports.set(`${clientId}::${reportId}`, archived);
      return archived;
    }
  };

  const claim = {
    createClaim: async (
      clientId: ClientId,
      batchId: BatchId,
      cmd: CommandEnvelope<CreateClaimRequest>
    ) => {
      const claimId = createClaimId("018e69e0-8a6a-72cb-b1b7-ec79a1f73809");
      const batch = harness.batches.get(`${clientId}::${batchId}`);
      if (!batch) throw new NotFoundError("ProductBatch", batchId);

      const claimObj: ProductClaimContract = {
        clientId,
        claimId,
        skuId: batch.skuId,
        batchId,
        currentRevision: 1,
        state: "draft",
        version: 1,
        invalidationCause: null,
        invalidationSourceRef: null,
        createdAt: "2026-10-21T12:50:00.000Z",
        updatedAt: "2026-10-21T12:50:00.000Z",
        archivedAt: null
      };
      harness.claims.set(`${clientId}::${claimId}`, claimObj);

      const rev: ProductClaimRevisionContract = {
        clientId,
        claimId,
        revision: 1,
        batchId,
        canonicalKind: cmd.payload.canonicalKind,
        proofCategory: cmd.payload.proofCategory,
        parameters: cmd.payload.parameters,
        displayWording: cmd.payload.displayWording ?? null,
        policyVersion: "claim_policy_v1",
        assertedBy: cmd.actorId,
        assertedAt: "2026-10-21T12:50:00.000Z",
        supersedesRevision: null
      };
      harness.claimRevisions.set(`${clientId}::${claimId}`, [rev]);

      return { claim: claimObj, revision: rev };
    },

    listClaimsForBatch: async (clientId: ClientId, batchId: BatchId) => {
      const claims = Array.from(harness.claims.values()).filter(
        (c) => c.clientId === clientId && c.batchId === batchId
      );
      return { claims };
    },

    getClaimById: async (clientId: ClientId, batchId: BatchId, claimId: ClaimId) => {
      const claimObj = harness.claims.get(`${clientId}::${claimId}`);
      if (!claimObj || claimObj.batchId !== batchId)
        throw new NotFoundError("ProductClaim", claimId);
      const revs = harness.claimRevisions.get(`${clientId}::${claimId}`) ?? [];
      return {
        claim: claimObj,
        currentRevision: revs[revs.length - 1],
        links: harness.claimLinks.get(`${clientId}::${claimId}`) ?? [],
        events: harness.claimDecisionEvents.get(`${clientId}::${claimId}`) ?? []
      };
    },

    getClaimRevision: async (
      clientId: ClientId,
      _batchId: BatchId,
      claimId: ClaimId,
      revision: number
    ) => {
      const revs = harness.claimRevisions.get(`${clientId}::${claimId}`) ?? [];
      const found = revs.find((r) => r.revision === revision);
      if (!found) throw new NotFoundError("ProductClaimRevision", `${claimId}:${revision}`);
      return found;
    },

    appendClaimRevision: async (
      clientId: ClientId,
      batchId: BatchId,
      claimId: ClaimId,
      cmd: CommandEnvelope<AppendClaimRevisionRequest>
    ) => {
      const claimObj = harness.claims.get(`${clientId}::${claimId}`);
      if (!claimObj || claimObj.batchId !== batchId)
        throw new NotFoundError("ProductClaim", claimId);
      if (claimObj.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          claimObj.version
        );
      }
      const nextRev = claimObj.currentRevision + 1;
      const updatedClaim = { ...claimObj, currentRevision: nextRev, version: claimObj.version + 1 };
      harness.claims.set(`${clientId}::${claimId}`, updatedClaim);
      return { claim: updatedClaim, revision: {} as unknown as ProductClaimRevisionContract };
    },

    linkClaimEvidence: async (
      clientId: ClientId,
      batchId: BatchId,
      claimId: ClaimId,
      cmd: CommandEnvelope<LinkClaimEvidenceRequest>
    ) => {
      const claimObj = harness.claims.get(`${clientId}::${claimId}`);
      if (!claimObj || claimObj.batchId !== batchId)
        throw new NotFoundError("ProductClaim", claimId);
      if (claimObj.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          claimObj.version
        );
      }
      const linksKey = `${clientId}::${claimId}`;
      const existing = harness.claimLinks.get(linksKey) ?? [];
      const newLinks: ClaimEvidenceLinkContract[] = cmd.payload.links.map(
        (l: LinkClaimEvidenceRequest["links"][number], idx: number) => ({
          linkId: `018e69e0-8a6a-72cb-b1b7-ec79a1f739${10 + idx}`,
          clientId,
          claimId,
          claimRevision: cmd.payload.claimRevision,
          batchId,
          evidenceId: l.evidenceId,
          evidenceRevision: l.evidenceRevision,
          sourceObjectId: l.sourceObjectId,
          sourceSha256: l.sourceSha256,
          supportRole: l.supportRole,
          reportId: l.reportId ?? null,
          reportRevision: l.reportRevision ?? null,
          attestation: l.attestation ?? null,
          derivativeAssetId: l.derivativeAssetId ?? null
        })
      );
      existing.push(...newLinks);
      harness.claimLinks.set(linksKey, existing);
      const updated = {
        ...claimObj,
        state: "evidence_linked" as const,
        version: claimObj.version + 1
      };
      harness.claims.set(`${clientId}::${claimId}`, updated);
      return { links: newLinks };
    },

    reviewClaim: async (
      clientId: ClientId,
      batchId: BatchId,
      claimId: ClaimId,
      cmd: CommandEnvelope<ReviewClaimRequest>
    ) => {
      const claimObj = harness.claims.get(`${clientId}::${claimId}`);
      if (!claimObj || claimObj.batchId !== batchId)
        throw new NotFoundError("ProductClaim", claimId);
      if (claimObj.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          claimObj.version
        );
      }
      const decisionEvent: ClaimDecisionEventContract = {
        eventId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73810",
        clientId,
        claimId,
        claimRevision: cmd.payload.claimRevision,
        decision: cmd.payload.decision,
        reason: cmd.payload.reason,
        actorId: cmd.actorId,
        occurredAt: "2026-10-21T13:00:00.000Z",
        policyVersion: "policy-v1"
      };
      const events = harness.claimDecisionEvents.get(`${clientId}::${claimId}`) ?? [];
      events.push(decisionEvent);
      harness.claimDecisionEvents.set(`${clientId}::${claimId}`, events);
      const updated = {
        ...claimObj,
        state:
          cmd.payload.decision === "approve"
            ? ("reviewer_approved" as const)
            : ("rejected" as const),
        version: claimObj.version + 1
      };
      harness.claims.set(`${clientId}::${claimId}`, updated);
      return { claim: updated, decisionEvent };
    },

    invalidateClaim: async (
      clientId: ClientId,
      batchId: BatchId,
      claimId: ClaimId,
      cmd: CommandEnvelope<InvalidateClaimRequest>
    ) => {
      const claimObj = harness.claims.get(`${clientId}::${claimId}`);
      if (!claimObj || claimObj.batchId !== batchId)
        throw new NotFoundError("ProductClaim", claimId);
      if (claimObj.version !== cmd.payload.expectedVersion) {
        throw new StaleRevisionConflictError(
          "ProductClaim",
          cmd.payload.expectedVersion,
          claimObj.version
        );
      }
      const decisionEvent: ClaimDecisionEventContract = {
        eventId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73811",
        clientId,
        claimId,
        claimRevision: cmd.payload.claimRevision,
        decision: "invalidate",
        reason: cmd.payload.reason,
        actorId: cmd.actorId,
        occurredAt: "2026-10-21T13:05:00.000Z",
        policyVersion: "policy-v1",
        invalidationCause: cmd.payload.invalidationCause
      };
      const events = harness.claimDecisionEvents.get(`${clientId}::${claimId}`) ?? [];
      events.push(decisionEvent);
      harness.claimDecisionEvents.set(`${clientId}::${claimId}`, events);
      const updated = {
        ...claimObj,
        state: "invalidated" as const,
        invalidationCause: cmd.payload.invalidationCause,
        version: claimObj.version + 1
      };
      harness.claims.set(`${clientId}::${claimId}`, updated);
      return { claim: updated, decisionEvent };
    }
  };

  const resolveBatchEvidenceDossier = {
    execute: async ({
      clientId,
      batchId
    }: {
      clientId: ClientId;
      batchId: BatchId;
    }): Promise<BatchEvidenceDossier> => {
      const batchKey = `${clientId}::${batchId}`;
      const batch = harness.batches.get(batchKey);
      if (!batch) throw new NotFoundError("ProductBatch", batchId);
      const sku = harness.skus.get(`${clientId}::${batch.skuId}`);
      if (!sku) throw new NotFoundError("ProductSku", batch.skuId);

      const factsHistory = harness.facts.get(batchKey) ?? [];
      const evidenceLinks = harness.batchEvidenceLinks.get(batchKey) ?? [];

      const evidenceProjections = evidenceLinks.map((l) => {
        const asset = harness.evidenceAssets.get(`${clientId}::${l.evidenceId}`)!;
        const revs = harness.evidenceRevisions.get(`${clientId}::${l.evidenceId}`)!;
        const curRev = (revs.find((r) => r.revision === l.evidenceRevision) ??
          revs[revs.length - 1])!;
        const deriv =
          harness.derivatives.get(`${clientId}::${l.evidenceId}::${l.evidenceRevision}`) ?? null;
        const verEvents =
          harness.verificationEvents.get(`${clientId}::${l.evidenceId}::${l.evidenceRevision}`) ??
          [];

        return {
          asset,
          currentRevision: curRev,
          revisions: revs,
          sourceObjects: [
            {
              sourceObjectId: curRev.sourceObjectId,
              originalSha256: "01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b",
              detectedMimeType: "image/jpeg" as const,
              byteLength: 2048,
              uploadedAt: curRev.submittedAt,
              uploaderId: curRev.submittedBy,
              accessClass: "restricted_original" as const,
              retentionClass: "source_evidence_archive" as const,
              retentionPolicyVersion: "policy-v1",
              availability: "available" as const
            }
          ],
          derivatives: deriv ? [deriv] : [],
          verificationEvents: verEvents
        };
      });

      const coaReports = Array.from(harness.coaReports.values())
        .filter((r) => r.clientId === clientId && r.batchId === batchId)
        .map((r) => {
          const revs = harness.coaRevisions.get(`${clientId}::${r.reportId}`) ?? [];
          const curRev = revs[revs.length - 1]!;
          const reviewEvents = harness.coaReviewEvents.get(`${clientId}::${r.reportId}`) ?? [];
          return {
            report: r,
            currentRevision: curRev,
            revisions: revs,
            reviewEvents
          };
        });

      const claims = Array.from(harness.claims.values())
        .filter((c) => c.clientId === clientId && c.batchId === batchId)
        .map((c) => {
          const revs = harness.claimRevisions.get(`${clientId}::${c.claimId}`) ?? [];
          const curRev = revs[revs.length - 1]!;
          const links = harness.claimLinks.get(`${clientId}::${c.claimId}`) ?? [];
          const decisionEvents = harness.claimDecisionEvents.get(`${clientId}::${c.claimId}`) ?? [];
          return {
            claim: c,
            currentRevision: curRev,
            revisions: revs,
            links,
            decisionEvents,
            resolution: {
              claim: c,
              revision: curRev,
              supportEligible: true,
              canRequestReview: false,
              evidenceLinkApproved: true,
              provenanceCategory: "lab_reported" as const,
              displayWordingStatus: "manual_review_approved" as const,
              blockReasons: [],
              links,
              reviewEvents: decisionEvents,
              dependencyFingerprint: "fingerprint-synth-1"
            }
          };
        });

      return {
        schemaVersion: "1.0.0",
        clientId,
        sku,
        batch,
        factsHistory,
        evidenceLinks,
        evidence: evidenceProjections,
        coaReports,
        claims,
        resolvedAt: "2026-10-21T13:10:00.000Z"
      } as BatchEvidenceDossier;
    }
  };

  return {
    dependencies: {} as unknown as ControlApiDependencies,
    useCases: {
      createProductSku,
      getProductSku,
      listProductSkus,
      updateProductSkuMetadata,
      archiveProductSku,
      createProductBatch,
      getProductBatch,
      listProductBatches,
      updateProductBatchMetadata,
      archiveProductBatch,
      appendBatchFacts,
      getBatchFactsHistory,
      evidenceAsset,
      coaReport,
      claim,
      resolveBatchEvidenceDossier
    } as unknown as ControlApiUseCases,
    queries: {}
  };
}

describe("End-to-End Product Evidence Lifecycle & Dossier Integration Test", () => {
  const tenantA = createClientId("018e69e0-8a6a-72cb-b1b7-ec79a1f73901");
  const tenantB = createClientId("018e69e0-8a6a-72cb-b1b7-ec79a1f73902");

  function createTestAppForClient(authenticatedClientId: string, harness: StatefulTestHarness) {
    const container = createStatefulTestContainer(harness);
    return createControlApiApp(container, {
      clientContextResolver: {
        resolve: async () => authenticatedClientId
      },
      reviewerIdentityResolver: {
        resolve: async () => "auditor-charlie"
      }
    });
  }

  it("executes complete synthetic lifecycle: SKU -> lot -> evidence + derivative -> CoA -> claim -> dossier and enforces adversary fences", async () => {
    const harness: StatefulTestHarness = {
      skus: new Map(),
      batches: new Map(),
      facts: new Map(),
      evidenceAssets: new Map(),
      evidenceRevisions: new Map(),
      batchEvidenceLinks: new Map(),
      derivatives: new Map(),
      verificationEvents: new Map(),
      coaReports: new Map(),
      coaRevisions: new Map(),
      coaReviewEvents: new Map(),
      claims: new Map(),
      claimRevisions: new Map(),
      claimLinks: new Map(),
      claimDecisionEvents: new Map(),
      receipts: new Map()
    };

    const appA = createTestAppForClient(tenantA, harness);
    const appB = createTestAppForClient(tenantB, harness);

    // =========================================================================
    // 1. Tenant A creates SKU
    // =========================================================================
    const skuRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/product-skus`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73001",
        canonicalSku: "SKU-ORGANIC-TINCTURE-1000",
        displayName: "Organic CBD Tincture 1000mg"
      }
    });
    expect(skuRes.statusCode).toBe(201);
    const sku = skuRes.json();
    const skuId = sku.skuId;
    expect(skuId).toBeDefined();

    // Idempotent retry of SKU creation
    const skuRetryRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/product-skus`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73001",
        canonicalSku: "SKU-ORGANIC-TINCTURE-1000",
        displayName: "Organic CBD Tincture 1000mg"
      }
    });
    expect(skuRetryRes.statusCode).toBe(201);
    expect(skuRetryRes.json().skuId).toBe(skuId);

    // =========================================================================
    // 2. Tenant A creates lot (Product Batch)
    // =========================================================================
    const batchRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73002",
        skuId,
        lotIdentifier: "LOT-2026-OCT-099",
        displayName: "October 2026 Production Run"
      }
    });
    expect(batchRes.statusCode).toBe(201);
    const batch = batchRes.json().batch;
    const batchId = batch.batchId;
    expect(batchId).toBeDefined();

    // =========================================================================
    // 3. Tenant A appends verified batch facts
    // =========================================================================
    const factsRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/facts`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73003",
        expectedVersion: 1,
        originKind: "own_production",
        producerIdentityAsClaimed: "Highland Organic Farm",
        productionStartDate: "2026-10-01",
        productionEndDate: "2026-10-15"
      }
    });
    expect(factsRes.statusCode).toBe(201);
    expect(factsRes.json().revision).toBe(2);

    // Stale version conflict on facts append
    const staleFactsRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/facts`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73004",
        expectedVersion: 1, // Stale! Current is 2
        originKind: "own_production"
      }
    });
    expect(staleFactsRes.statusCode).toBe(409);
    expect(staleFactsRes.json().error).toBe("STALE_REVISION_CONFLICT");

    // =========================================================================
    // 4. Tenant A registers original evidence asset
    // =========================================================================
    const evidenceRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73005",
        batchId,
        purpose: "macro_hero_photo",
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        assertionText: "Original high-resolution packaging capture",
        declaredMimeType: "image/jpeg",
        registrationIntent: "initial_assertion",
        reusedSourceObjectId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899"
      }
    });
    expect(evidenceRes.statusCode).toBe(201);
    const evidence = evidenceRes.json();
    const evidenceId = evidence.evidenceAsset.evidenceId;
    expect(evidenceId).toBeDefined();

    // Security invariant: internal bucket and storage key are NOT leaked over HTTP
    expect(evidence.sourceObject.storageBucket).toBeUndefined();
    expect(evidence.sourceObject.storageObjectKey).toBeUndefined();
    expect(SafeSourceObjectResponseSchema.safeParse(evidence.sourceObject).success).toBe(true);

    // =========================================================================
    // 5. Tenant A links derivative reference asset
    // =========================================================================
    const refAssetId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73099";
    const derivativeRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/derivative`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73006",
        referenceAssetId: refAssetId,
        derivativeSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        transformDescription: "Centered crop 1024x1024 for render conditioning",
        transformToolVersion: "v1.2.0"
      }
    });
    expect(derivativeRes.statusCode).toBe(200);
    expect(derivativeRes.json().referenceAssetId).toBe(refAssetId);

    // =========================================================================
    // 6. Reviewer records evidence verification event
    // =========================================================================
    const verEventRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/verification-events`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73007",
        outcome: "verified",
        verificationKind: "human_internal_review",
        factScope: "full_document_authenticity",
        method: "Visual barcode match and EXIF validation",
        reason: "Matches laboratory retention sample"
      }
    });
    expect(verEventRes.statusCode).toBe(200);
    expect(verEventRes.json().outcome).toBe("verified");

    // =========================================================================
    // 7. Request short-lived media delivery URL (300s TTL)
    // =========================================================================
    const mediaRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/media`
    });
    expect(mediaRes.statusCode).toBe(200);
    const media = mediaRes.json();
    expect(media.url).toContain("token=valid-300s");
    expect(media.expiresAt).toBeDefined();

    // =========================================================================
    // 8. Tenant A creates Certificate of Analysis (CoA) with typed measurements
    // =========================================================================
    const coaRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/coa-reports`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73008",
        batchId,
        evidenceId,
        evidenceRevision: 1,
        completenessStatus: "complete",
        reportIdentifierAsClaimed: "COA-2026-HIGHLAND-099",
        reportDate: "2026-10-18",
        labNameAsClaimed: "Steep Hill Analytical Labs",
        scopeKind: "attributed_lot",
        measurements: [
          {
            analyte: "Cannabidiol (CBD)",
            resultKind: "quantified",
            resultValue: "25.5000",
            unit: "mg/g",
            basis: "dry_weight",
            context: "tincture_oil",
            quantityKind: "mass_fraction"
          },
          {
            analyte: "Delta-9 THC",
            resultKind: "below_limit",
            resultValue: null,
            resultLimit: "0.0500",
            unit: "percent_w_w",
            basis: "dry_weight",
            context: "tincture_oil",
            quantityKind: "mass_fraction"
          }
        ]
      }
    });
    expect(coaRes.statusCode).toBe(201);
    const coa = coaRes.json().report;
    const reportId = coa.reportId;
    expect(reportId).toBeDefined();

    // =========================================================================
    // 9. Reviewer reviews CoA report
    // =========================================================================
    const coaReviewRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/coa-reports/${reportId}/review`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73009",
        expectedVersion: 1,
        decision: "approved",
        reason: "Lab accreditation and digital signature verified",
        assessedScope: "attributed_lot"
      }
    });
    expect(coaReviewRes.statusCode).toBe(200);

    // =========================================================================
    // 10. Tenant A creates Product Claim
    // =========================================================================
    const claimRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73010",
        batchId,
        canonicalKind: "certificate_panel_measurement",
        proofCategory: "coa_measurement_backed",
        parameters: {
          kind: "certificate_panel_measurement",
          measurements: [
            {
              analyte: "Cannabidiol (CBD)",
              exactDecimalValue: "25.5000",
              unit: "mg/g",
              quantityKind: "mass_fraction",
              basis: "dry_weight",
              context: "tincture_oil",
              requiredScope: "attributed_lot"
            }
          ]
        },
        displayWording: "Third-party tested: contains 25.5 mg/g CBD"
      }
    });
    expect(claimRes.statusCode).toBe(201);
    const claimObj = claimRes.json();
    const claimId = claimObj.claim?.claimId ?? claimObj.claimId;
    expect(claimId).toBeDefined();

    // =========================================================================
    // 11. Tenant A links CoA evidence to claim
    // =========================================================================
    const linkEvidenceRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/evidence-links`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73011",
        expectedVersion: 1,
        claimRevision: 1,
        reason: "Linking accredited lab measurement",
        links: [
          {
            evidenceId,
            evidenceRevision: 1,
            sourceObjectId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73804",
            sourceSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            supportRole: "primary_measurement",
            reportId,
            reportRevision: 1
          }
        ]
      }
    });
    expect(linkEvidenceRes.statusCode).toBe(200);

    // =========================================================================
    // 12. Reviewer reviews Claim
    // =========================================================================
    const claimReviewRes = await appA.inject({
      method: "POST",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/claims/${claimId}/review`,
      payload: {
        actionId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73012",
        expectedVersion: 2, // Version incremented by linkEvidence
        claimRevision: 1,
        decision: "approve",
        reason: "Evidence links corroborated by certified lab report"
      }
    });
    expect(claimReviewRes.statusCode).toBe(200);
    expect(claimReviewRes.json().claim.state).toBe("reviewer_approved");

    // =========================================================================
    // 13. Read Explicit Provenance Dossier Query
    // =========================================================================
    const dossierRes = await appA.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/dossier`
    });
    expect(dossierRes.statusCode).toBe(200);
    const dossier = dossierRes.json();

    // Verify adherence to authoritative contract schema
    const parsedDossier = BatchEvidenceDossierSchema.safeParse(dossier);
    if (!parsedDossier.success) {
      console.log(
        "REMAINING DOSSIER PARSE ERROR:",
        JSON.stringify(parsedDossier.error.issues, null, 2)
      );
    }
    expect(parsedDossier.success).toBe(true);

    expect(dossier.schemaVersion).toBe("1.0.0");
    expect(dossier.clientId).toBe(tenantA);
    expect(dossier.sku.canonicalSku).toBe("SKU-ORGANIC-TINCTURE-1000");
    expect(dossier.batch.lotIdentifier).toBe("LOT-2026-OCT-099");
    expect(dossier.factsHistory).toHaveLength(2);
    expect(dossier.evidence).toHaveLength(1);
    expect(dossier.evidence[0].derivatives[0].referenceAssetId).toBe(refAssetId);
    expect(dossier.evidence[0].verificationEvents).toHaveLength(1);
    expect(dossier.coaReports).toHaveLength(1);
    expect(dossier.coaReports[0].currentRevision.measurements).toHaveLength(2);
    expect(dossier.claims).toHaveLength(1);
    expect(dossier.claims[0].claim.state).toBe("reviewer_approved");
    expect(dossier.claims[0].decisionEvents).toHaveLength(1);

    // =========================================================================
    // 14. Adversary Security Checks: Multi-tenant Isolation
    // =========================================================================

    // Tenant B cannot read Tenant A's SKU
    const bSkuRes = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/product-skus/${skuId}`
    });
    expect(bSkuRes.statusCode).toBe(403);
    expect(bSkuRes.json().error).toBe("FORBIDDEN");

    // Tenant B cannot read Tenant A's batch
    const bBatchRes = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}`
    });
    expect(bBatchRes.statusCode).toBe(403);

    // Tenant B cannot read Tenant A's dossier
    const bDossierRes = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/dossier`
    });
    expect(bDossierRes.statusCode).toBe(403);

    // Tenant B cannot fetch signed media URL for Tenant A's evidence
    const bMediaRes = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantA}/batches/${batchId}/evidence/${evidenceId}/revisions/1/media`
    });
    expect(bMediaRes.statusCode).toBe(403);

    // Tenant B requesting Tenant A's batch under Tenant B's own route gets NOT_FOUND (zero leakage)
    const bCrossBatchRes = await appB.inject({
      method: "GET",
      url: `/api/v1/clients/${tenantB}/batches/${batchId}`
    });
    expect(bCrossBatchRes.statusCode).toBe(404);
    expect(bCrossBatchRes.json().error).toBe("NOT_FOUND");
  });
});
