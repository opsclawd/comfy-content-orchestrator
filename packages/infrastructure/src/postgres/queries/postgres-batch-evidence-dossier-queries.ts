import type { Pool } from "pg";
import type { BatchId, ClientId, EvidenceDerivative, EvidenceVerificationEvent } from "@cco/domain";
import { NotFoundError } from "@cco/domain";
import type {
  BatchEvidenceDossier,
  ProductClaimRevisionContract,
  ClaimEvidenceLinkContract,
  ClaimDecisionEventContract,
  DossierClaimItem,
  DossierCoaReportItem,
  DossierEvidenceItem,
  SafeSourceObjectResponse
} from "@cco/contracts";
import type { BatchEvidenceDossierQueries } from "@cco/application";
import {
  serializeBatchFactsRevision,
  serializeProductBatch,
  serializeProductSku
} from "@cco/application";
import { PostgresProductEvidenceRepository } from "../repositories/postgres-product-evidence-repository.js";
import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
import { PostgresCoaReportRepository } from "../repositories/postgres-coa-report-repository.js";
import { PostgresProductClaimRepository } from "../repositories/postgres-product-claim-repository.js";

export interface PostgresBatchEvidenceDossierQueriesOptions {
  readonly statementTimeoutMs?: number;
}

export const MAX_DOSSIER_ITEMS = 500;
export const MAX_DOSSIER_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

export class PostgresBatchEvidenceDossierQueries implements BatchEvidenceDossierQueries {
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly pool: Pool,
    options?: PostgresBatchEvidenceDossierQueriesOptions
  ) {
    const timeout = options?.statementTimeoutMs ?? 10000;
    if (
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout <= 0 ||
      timeout > 300000
    ) {
      throw new Error(`statementTimeoutMs must be a positive integer <= 300000, got ${timeout}`);
    }
    this.statementTimeoutMs = timeout;
  }

  async resolveDossier(clientId: ClientId, batchId: BatchId): Promise<BatchEvidenceDossier> {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;");
        await client.query("SELECT set_config('statement_timeout', $1, true);", [
          String(this.statementTimeoutMs)
        ]);

        const productEvidence = new PostgresProductEvidenceRepository(client, {
          externalTransaction: true
        });
        const evidenceAsset = new PostgresEvidenceAssetRepository(client, {
          externalTransaction: true
        });
        const coaReports = new PostgresCoaReportRepository(client, {
          externalTransaction: true
        });
        const productClaims = new PostgresProductClaimRepository(client, {
          externalTransaction: true
        });

        // 1. Batch & SKU
        const batchDomain = await productEvidence.getBatchById(clientId, batchId);
        if (!batchDomain) {
          throw new NotFoundError("ProductBatch", batchId);
        }
        const skuDomain = await productEvidence.getSkuById(clientId, batchDomain.skuId);
        if (!skuDomain) {
          throw new NotFoundError("ProductSku", batchDomain.skuId);
        }

        const sku = serializeProductSku(skuDomain);
        const batch = serializeProductBatch(batchDomain);

        // 2. Facts History
        const factsHistoryDomain = await productEvidence.getBatchHistory(clientId, batchId);
        const factsHistory = factsHistoryDomain.map(serializeBatchFactsRevision);

        // 3. Batch Evidence Links
        const rawEvidenceLinks = await evidenceAsset.listBatchEvidence(clientId, batchId);
        const evidenceLinks = rawEvidenceLinks.map((l) => ({
          clientId: l.clientId,
          batchId: l.batchId,
          evidenceId: l.evidenceId,
          evidenceRevision: l.evidenceRevision,
          purpose: l.purpose,
          assertedBy: l.assertedBy,
          assertedAt: l.assertedAt
        }));

        // 4. Evidence Items
        const distinctEvidenceIds = Array.from(
          new Set(rawEvidenceLinks.map((l) => l.evidenceId))
        ).sort();
        const evidenceItems: DossierEvidenceItem[] = [];

        for (const evidenceId of distinctEvidenceIds) {
          const asset = await evidenceAsset.getEvidenceById(clientId, evidenceId);
          if (!asset) {
            throw new NotFoundError("EvidenceAsset", evidenceId);
          }

          const history = await evidenceAsset.getEvidenceHistory(clientId, evidenceId);
          const linkedRevsForBatch = new Set(
            rawEvidenceLinks
              .filter((l) => l.evidenceId === evidenceId)
              .map((l) => l.evidenceRevision)
          );

          const filteredRevisions = history.filter((rev) => linkedRevsForBatch.has(rev.revision));
          if (
            filteredRevisions.length === 0 ||
            filteredRevisions.length !== linkedRevsForBatch.size
          ) {
            throw new NotFoundError("BatchEvidenceLink", evidenceId);
          }
          const currentRev =
            filteredRevisions.find((rev) => rev.revision === asset.currentRevision) ?? null;

          const sourceObjects: SafeSourceObjectResponse[] = [];
          const derivatives: EvidenceDerivative[] = [];
          const verificationEvents: EvidenceVerificationEvent[] = [];

          for (const rev of filteredRevisions) {
            const so = await evidenceAsset.getSourceObjectById(clientId, rev.sourceObjectId);
            if (!so) {
              throw new NotFoundError("SourceObject", rev.sourceObjectId);
            }
            if (!sourceObjects.some((s) => s.sourceObjectId === so.sourceObjectId)) {
              sourceObjects.push({
                sourceObjectId: so.sourceObjectId,
                originalSha256: so.originalSha256,
                detectedMimeType: so.detectedMimeType,
                byteLength: so.byteLength,
                uploadedAt: so.uploadedAt,
                uploaderId: so.uploaderId,
                accessClass: "restricted_original",
                retentionClass: "source_evidence_archive",
                retentionPolicyVersion: so.retentionPolicyVersion,
                availability: so.availability
              });
            }

            const deriv = await evidenceAsset.getDerivative(clientId, evidenceId, rev.revision);
            if (deriv) {
              derivatives.push(deriv);
            }

            const vEvents = await evidenceAsset.listVerificationEvents(
              clientId,
              evidenceId,
              rev.revision
            );
            for (const ve of vEvents) {
              if (!verificationEvents.some((v) => v.eventId === ve.eventId)) {
                verificationEvents.push(ve);
              }
            }
          }

          evidenceItems.push({
            asset: {
              clientId: asset.clientId,
              evidenceId: asset.evidenceId,
              currentRevision: asset.currentRevision,
              version: asset.version,
              createdAt: asset.createdAt,
              archivedAt: asset.archivedAt
            },
            currentRevision: currentRev
              ? {
                  clientId: currentRev.clientId,
                  evidenceId: currentRev.evidenceId,
                  revision: currentRev.revision,
                  sourceObjectId: currentRev.sourceObjectId,
                  sourceClass: currentRev.sourceClass,
                  acquisitionMethod: currentRev.acquisitionMethod,
                  submittedBy: currentRev.submittedBy,
                  submittedAt: currentRev.submittedAt,
                  assertionText: currentRev.assertionText,
                  reportedCaptureDate: currentRev.reportedCaptureDate,
                  reportedCaptureTimestamp: currentRev.reportedCaptureTimestamp,
                  reportedCapturePrecision: currentRev.reportedCapturePrecision,
                  captureContext: currentRev.captureContext,
                  rightsStatus: currentRev.rightsStatus,
                  consentStatus: currentRev.consentStatus,
                  rightsAttribution: currentRev.rightsAttribution,
                  rightsDocumentLocator: currentRev.rightsDocumentLocator,
                  supersedesRevision: currentRev.supersedesRevision
                }
              : null,
            revisions: filteredRevisions.map((rev) => ({
              clientId: rev.clientId,
              evidenceId: rev.evidenceId,
              revision: rev.revision,
              sourceObjectId: rev.sourceObjectId,
              sourceClass: rev.sourceClass,
              acquisitionMethod: rev.acquisitionMethod,
              submittedBy: rev.submittedBy,
              submittedAt: rev.submittedAt,
              assertionText: rev.assertionText,
              reportedCaptureDate: rev.reportedCaptureDate,
              reportedCaptureTimestamp: rev.reportedCaptureTimestamp,
              reportedCapturePrecision: rev.reportedCapturePrecision,
              captureContext: rev.captureContext,
              rightsStatus: rev.rightsStatus,
              consentStatus: rev.consentStatus,
              rightsAttribution: rev.rightsAttribution,
              rightsDocumentLocator: rev.rightsDocumentLocator,
              supersedesRevision: rev.supersedesRevision
            })),
            sourceObjects,
            derivatives,
            verificationEvents
          });
        }

        // 5. CoA Reports
        const rawCoaReports = await coaReports.listReportsForBatch(clientId, batchId);
        const coaReportItems: DossierCoaReportItem[] = [];

        for (const rep of rawCoaReports) {
          const historyDetails = await coaReports.getReportHistory(clientId, rep.reportId);
          const currentDetail = historyDetails.find(
            (d) => d.revision.revision === rep.currentRevision
          );

          if (!currentDetail) {
            throw new NotFoundError("CoaReportRevision", `${rep.reportId}@${rep.currentRevision}`);
          }

          const reviewEventsRes = await client.query<{
            event_id: string;
            client_id: string;
            report_id: string;
            report_revision: number;
            decision: string;
            actor_id: string;
            occurred_at: Date;
            reason: string;
            assessed_scope: string;
          }>(
            `SELECT * FROM coa_report_review_events WHERE client_id = $1 AND report_id = $2 ORDER BY occurred_at ASC`,
            [clientId, rep.reportId]
          );

          const reviewEvents = reviewEventsRes.rows.map((r) => ({
            eventId: r.event_id,
            clientId: r.client_id,
            reportId: r.report_id,
            reportRevision: r.report_revision,
            decision: r.decision as "approved" | "rejected",
            actorId: r.actor_id,
            occurredAt: r.occurred_at.toISOString(),
            reason: r.reason,
            assessedScope: r.assessed_scope as "sample_only" | "attributed_lot"
          }));

          const formatRevision = (detail: (typeof historyDetails)[number]) => ({
            clientId: detail.revision.clientId,
            reportId: detail.revision.reportId,
            revision: detail.revision.revision,
            batchId: detail.revision.batchId,
            evidenceId: detail.revision.evidenceId,
            evidenceRevision: detail.revision.evidenceRevision,
            completenessStatus: detail.revision.completenessStatus,
            reportIdentifierAsClaimed: detail.revision.reportIdentifierAsClaimed,
            reportDate: detail.revision.reportDate,
            labNameAsClaimed: detail.revision.labNameAsClaimed,
            sampleIdentifierAsClaimed: detail.revision.sampleIdentifierAsClaimed,
            scopeKind: detail.revision.scopeKind,
            scopeDescription: detail.revision.scopeDescription,
            sampleDate: detail.revision.sampleDate,
            samplingMethodDescription: detail.revision.samplingMethodDescription,
            sampleToBatchAssociationAttestation:
              detail.revision.sampleToBatchAssociationAttestation,
            sampleToBatchAssociationConfirmed: detail.revision.sampleToBatchAssociationConfirmed,
            verifiedLabIdentityEventId: detail.revision.verifiedLabIdentityEventId,
            assertedBy: detail.revision.assertedBy,
            assertedAt: detail.revision.assertedAt,
            supersedesRevision: detail.revision.supersedesRevision,
            measurements: detail.measurements.map((m) => ({
              measurementId: m.measurementId,
              clientId: m.clientId,
              reportId: m.reportId,
              reportRevision: m.reportRevision,
              batchId: m.batchId,
              evidenceId: m.evidenceId,
              evidenceRevision: m.evidenceRevision,
              analyte: m.analyte,
              resultKind: m.resultKind,
              resultValue: m.resultValue,
              resultLimit: m.resultLimit,
              resultQualifier: m.resultQualifier,
              unit: m.unit,
              basis: m.basis,
              context: m.context,
              quantityKind: m.quantityKind,
              methodAsReported: m.methodAsReported,
              uncertaintyAbsolute: m.uncertaintyAbsolute,
              detectionLimit: m.detectionLimit,
              quantificationLimit: m.quantificationLimit,
              analyticalQualifierCode: m.analyticalQualifierCode,
              analyticalQualifierExplanation: m.analyticalQualifierExplanation
            }))
          });

          coaReportItems.push({
            report: {
              clientId: rep.clientId,
              reportId: rep.reportId,
              batchId: rep.batchId,
              evidenceId: rep.evidenceId,
              currentRevision: rep.currentRevision,
              version: rep.version,
              createdAt: rep.createdAt,
              archivedAt: rep.archivedAt
            },
            currentRevision: formatRevision(currentDetail),
            revisions: historyDetails.map(formatRevision),
            reviewEvents
          });
        }

        // 6. Claims
        const rawClaims = await productClaims.listClaimsForBatch(clientId, batchId);
        const claimItems: DossierClaimItem[] = [];

        for (const claim of rawClaims) {
          const claimHistory = await productClaims.getClaimHistory(clientId, claim.claimId);
          if (!claimHistory) {
            throw new NotFoundError("ProductClaim", claim.claimId);
          }

          const currentRevDetail = claimHistory.revisions.find(
            (r) => r.revision.revision === claim.currentRevision
          );

          if (!currentRevDetail) {
            throw new NotFoundError(
              "ProductClaimRevision",
              `${claim.claimId}@${claim.currentRevision}`
            );
          }

          const resolution = await productClaims.resolveClaim(
            clientId,
            claim.claimId,
            claim.currentRevision
          );

          const allLinks = claimHistory.revisions.flatMap((r) => r.links);
          const allDecisionEvents = claimHistory.events;

          claimItems.push({
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
            currentRevision: currentRevDetail.revision as unknown as ProductClaimRevisionContract,
            revisions: claimHistory.revisions.map(
              (r) => r.revision as unknown as ProductClaimRevisionContract
            ),
            links: allLinks as unknown as ClaimEvidenceLinkContract[],
            decisionEvents: allDecisionEvents as unknown as ClaimDecisionEventContract[],
            resolution
          });
        }

        let totalItems = factsHistory.length + evidenceLinks.length;
        for (const item of evidenceItems) {
          totalItems += 1;
          totalItems += item.revisions.length;
          totalItems += item.sourceObjects.length;
          totalItems += item.derivatives.length;
          totalItems += item.verificationEvents.length;
        }
        for (const rep of coaReportItems) {
          totalItems += 1;
          totalItems += rep.revisions.length;
          for (const rev of rep.revisions) {
            totalItems += rev.measurements.length;
          }
          totalItems += rep.reviewEvents.length;
        }
        for (const clm of claimItems) {
          totalItems += 1;
          totalItems += clm.revisions.length;
          totalItems += clm.links.length;
          totalItems += clm.decisionEvents.length;
        }

        if (totalItems > MAX_DOSSIER_ITEMS) {
          throw new Error(
            `Dossier item count ${totalItems} exceeds maximum allowed limit of ${MAX_DOSSIER_ITEMS}`
          );
        }

        const dossier: BatchEvidenceDossier = {
          schemaVersion: "1.0.0",
          clientId,
          sku,
          batch,
          factsHistory,
          evidenceLinks,
          evidence: evidenceItems,
          coaReports: coaReportItems,
          claims: claimItems,
          resolvedAt: new Date().toISOString()
        };

        const serialized = JSON.stringify(dossier);
        if (serialized.length > MAX_DOSSIER_PAYLOAD_BYTES) {
          throw new Error(
            `Dossier payload size ${serialized.length} bytes exceeds maximum allowed limit of ${MAX_DOSSIER_PAYLOAD_BYTES} bytes`
          );
        }

        await client.query("COMMIT;");
        return dossier;
      } catch (err) {
        await client.query("ROLLBACK;").catch(() => {});
        const pgErr = err as { code?: string };
        if ((pgErr?.code === "40001" || pgErr?.code === "40P01") && attempt < maxRetries) {
          continue;
        }
        throw err;
      } finally {
        client.release();
      }
    }

    throw new Error("Failed to resolve batch evidence dossier after retries.");
  }
}
