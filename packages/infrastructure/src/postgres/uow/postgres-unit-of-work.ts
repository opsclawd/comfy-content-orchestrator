import type { UnitOfWork, UnitOfWorkContext } from "@cco/application";
import type { Pool } from "pg";
import { PostgresCampaignProductionRunRepository } from "../repositories/postgres-campaign-production-run-repository.js";
import { PostgresCampaignRepository } from "../repositories/postgres-campaign-repository.js";
import { PostgresClientRepository } from "../repositories/postgres-client-repository.js";
import { PostgresDeliveryAssemblyJobQueue } from "../repositories/postgres-delivery-assembly-job-queue.js";
import { PostgresGenerationManifestRepository } from "../repositories/postgres-generation-manifest-repository.js";
import { PostgresTransactionalJobEnqueuer } from "../repositories/postgres-job-queue.js";
import { PostgresReferenceAssetRepository } from "../repositories/postgres-reference-asset-repository.js";
import { PostgresReferenceGroupRepository } from "../repositories/postgres-reference-group-repository.js";
import { PostgresCampaignReferenceBibleRepository } from "../repositories/postgres-campaign-reference-bible-repository.js";
import { PostgresReviewEventStore } from "../repositories/postgres-review-event-store.js";
import { PostgresSceneRepository } from "../repositories/postgres-scene-repository.js";
import { PostgresShotPlanRepository } from "../repositories/postgres-shot-plan-repository.js";
import { PostgresStoryboardCandidateRepository } from "../repositories/postgres-storyboard-candidate-repository.js";
import {
  isProductRegistryDatabaseError,
  PostgresProductEvidenceRepository,
  translateDatabaseError
} from "../repositories/postgres-product-evidence-repository.js";
import { PostgresEvidenceAssetRepository } from "../../evidence/postgres-evidence-asset-repository.js";
import { PostgresCoaReportRepository } from "../repositories/postgres-coa-report-repository.js";
import { PostgresProductClaimRepository } from "../repositories/postgres-product-claim-repository.js";
import { PostgresCampaignDurationPlanRepository } from "../repositories/postgres-campaign-duration-plan-repository.js";
import { PostgresOperatorAcceptanceRunRepository } from "../repositories/postgres-operator-acceptance-run-repository.js";
import { PostgresAcceptanceAssemblyJobQueue } from "../repositories/postgres-acceptance-assembly-job-queue.js";
import { PostgresAcceptanceAssemblyManifestRepository } from "../repositories/postgres-acceptance-assembly-manifest-repository.js";
import { PostgresDeploymentEnablementStateRepository } from "../repositories/postgres-deployment-enablement-state-repository.js";

export class PostgresUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const context: UnitOfWorkContext = {
        scenes: new PostgresSceneRepository(client, { forUpdate: true }),
        reviewEvents: new PostgresReviewEventStore(client),
        candidates: new PostgresStoryboardCandidateRepository(client),
        shotPlans: new PostgresShotPlanRepository(client, {
          externalTransaction: true,
          useSavepoint: true
        }),
        campaigns: new PostgresCampaignRepository(client),
        clients: new PostgresClientRepository(client),
        jobs: new PostgresTransactionalJobEnqueuer(client),
        campaignProductionRuns: new PostgresCampaignProductionRunRepository(client),
        assemblyJobs: new PostgresDeliveryAssemblyJobQueue(client),
        generationManifests: new PostgresGenerationManifestRepository(client),
        referenceAssets: new PostgresReferenceAssetRepository(client),
        referenceGroups: new PostgresReferenceGroupRepository(client),
        campaignReferenceBible: new PostgresCampaignReferenceBibleRepository(client),
        productEvidence: new PostgresProductEvidenceRepository(client, {
          externalTransaction: true
        }),
        evidenceAsset: new PostgresEvidenceAssetRepository(client, {
          externalTransaction: true
        }),
        coaReports: new PostgresCoaReportRepository(client, {
          externalTransaction: true
        }),
        productClaims: new PostgresProductClaimRepository(client, {
          externalTransaction: true
        }),
        durationPlans: new PostgresCampaignDurationPlanRepository(client),
        operatorAcceptanceRuns: new PostgresOperatorAcceptanceRunRepository(client),
        acceptanceAssemblyJobs: new PostgresAcceptanceAssemblyJobQueue(client),
        acceptanceAssemblyManifests: new PostgresAcceptanceAssemblyManifestRepository(client),
        deploymentEnablement: new PostgresDeploymentEnablementStateRepository(client)
      };

      const result = await work(context);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (isProductRegistryDatabaseError(error)) {
        translateDatabaseError(error);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
