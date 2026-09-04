import type { UnitOfWork, UnitOfWorkContext } from "@cco/application";
import type { Pool } from "pg";
import { PostgresCampaignRepository } from "../repositories/postgres-campaign-repository.js";
import { PostgresClientRepository } from "../repositories/postgres-client-repository.js";
import { PostgresTransactionalJobEnqueuer } from "../repositories/postgres-job-queue.js";
import { PostgresReviewEventStore } from "../repositories/postgres-review-event-store.js";
import { PostgresSceneRepository } from "../repositories/postgres-scene-repository.js";
import { PostgresStoryboardCandidateRepository } from "../repositories/postgres-storyboard-candidate-repository.js";

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
        campaigns: new PostgresCampaignRepository(client),
        clients: new PostgresClientRepository(client),
        jobs: new PostgresTransactionalJobEnqueuer(client)
      };

      const result = await work(context);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
