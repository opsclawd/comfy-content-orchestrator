import type {
  CurrentProductionAttempt,
  CurrentProductionAttemptQueries,
  GenerationManifestRepository,
  GetCurrentProductionAttemptInput
} from "@cco/application";
import type { PersistentMediaRef, ProductionAttemptTechnicalState } from "@cco/contracts";
import type { SceneId } from "@cco/domain";
import type { Pool, PoolClient } from "pg";
import { PostgresGenerationManifestRepository } from "../repositories/postgres-generation-manifest-repository.js";

interface CurrentProductionAttemptRow {
  run_id: string;
  scene_id: string;
  spec_revision: number;
  production_job_id: string | null;
  job_status: string | null;
  retry_count: number | null;
  scene_status: string;
}

export class PostgresCurrentProductionAttemptQueries implements CurrentProductionAttemptQueries {
  private readonly client: Pool | PoolClient;
  private readonly generationManifests: GenerationManifestRepository;

  constructor(client: Pool | PoolClient, generationManifests?: GenerationManifestRepository) {
    this.client = client;
    this.generationManifests =
      generationManifests ?? new PostgresGenerationManifestRepository(client);
  }

  async getCurrentProductionAttempt(
    input: GetCurrentProductionAttemptInput
  ): Promise<CurrentProductionAttempt | undefined> {
    const query = `
      SELECT
        rs.run_id,
        rs.scene_id,
        rs.spec_revision,
        rs.production_job_id,
        rj.status AS job_status,
        rj.retry_count,
        s.status AS scene_status
      FROM campaign_production_run_scenes rs
      JOIN campaign_production_runs r ON r.run_id = rs.run_id
      JOIN storyboard_scenes s ON s.scene_id = rs.scene_id
      LEFT JOIN render_jobs rj ON rj.job_id = rs.production_job_id
      WHERE rs.run_id = $1
        AND rs.scene_id = $2
        AND r.campaign_id = $3
        AND s.campaign_id = $3
    `;

    const result = await this.client.query<CurrentProductionAttemptRow>(query, [
      input.runId,
      input.sceneId,
      input.campaignId
    ]);

    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const productionJobId = row.production_job_id ?? undefined;
    const retryCount = Number(row.retry_count ?? 0);
    const specRevision = Number(row.spec_revision);
    const isQa = row.scene_status === "qa";

    if (!productionJobId || !row.job_status) {
      return {
        runId: row.run_id,
        sceneId: row.scene_id as SceneId,
        specRevision,
        attemptOrdinal: 1,
        ...(productionJobId ? { productionJobId } : {}),
        technicalState: "queued",
        reviewReady: false,
        availability: "unavailable"
      };
    }

    const technicalState = row.job_status as ProductionAttemptTechnicalState;
    if (technicalState !== "completed") {
      return {
        runId: row.run_id,
        sceneId: row.scene_id as SceneId,
        specRevision,
        attemptOrdinal: retryCount + 1,
        productionJobId,
        technicalState,
        reviewReady: false,
        availability: "unavailable"
      };
    }

    let source:
      | {
          readonly generationManifestId: string;
          readonly media: PersistentMediaRef;
          readonly renderAttempt?: number;
        }
      | undefined;

    try {
      source = await this.generationManifests.findVideoStemSourceByJobId?.(productionJobId);
    } catch {
      return {
        runId: row.run_id,
        sceneId: row.scene_id as SceneId,
        specRevision,
        attemptOrdinal: retryCount + 1,
        productionJobId,
        technicalState: "completed",
        reviewReady: false,
        availability: "inconsistent"
      };
    }

    if (!source) {
      return {
        runId: row.run_id,
        sceneId: row.scene_id as SceneId,
        specRevision,
        attemptOrdinal: retryCount + 1,
        productionJobId,
        technicalState: "completed",
        reviewReady: false,
        availability: "missing_manifest"
      };
    }

    const attemptOrdinal =
      typeof source.renderAttempt === "number" ? source.renderAttempt : retryCount + 1;

    return {
      runId: row.run_id,
      sceneId: row.scene_id as SceneId,
      specRevision,
      attemptOrdinal,
      productionJobId,
      technicalState: "completed",
      reviewReady: isQa,
      availability: "available",
      media: {
        generationManifestId: source.generationManifestId,
        ref: source.media
      }
    };
  }
}
