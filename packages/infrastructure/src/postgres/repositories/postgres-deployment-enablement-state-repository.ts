import type { DeploymentEnablementStatePort } from "@cco/application";
import type { Pool, PoolClient } from "pg";

interface StateRow {
  deployment_id: string;
  generation: number;
  digest: string;
  updated_at: Date | string;
}

export class PostgresDeploymentEnablementStateRepository implements DeploymentEnablementStatePort {
  constructor(private readonly client: Pool | PoolClient) {}

  async getCurrentState(
    deploymentId: string
  ): Promise<{ generation: number; digest: string } | undefined> {
    const query = `
      SELECT generation, digest FROM deployment_enablement_state
      WHERE deployment_id = $1;
    `;
    const res = await this.client.query<StateRow>(query, [deploymentId]);
    if (res.rows.length === 0) return undefined;
    return {
      generation: res.rows[0]!.generation,
      digest: res.rows[0]!.digest
    };
  }

  async recordAcceptedState(
    deploymentId: string,
    generation: number,
    digest: string
  ): Promise<void> {
    const query = `
      INSERT INTO deployment_enablement_state (deployment_id, generation, digest, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (deployment_id) DO UPDATE SET
        generation = EXCLUDED.generation,
        digest = EXCLUDED.digest,
        updated_at = NOW();
    `;
    await this.client.query(query, [deploymentId, generation, digest]);
  }
}
