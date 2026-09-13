import type {
  CampaignDeliveryReelQueries,
  CanonicalDeliveryAssemblyRecord,
  DeliveryAssemblyStatus
} from "@cco/application";
import { AssemblySpecSchema, type AssemblySpec } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";
import type { Pool, PoolClient } from "pg";

interface CampaignRow {
  campaign_id: string;
  status: string;
  updated_at: Date | string;
}

interface DeliveryAssemblyJobRow {
  job_id: string;
  campaign_id: string;
  assembly_spec: unknown;
  job_status: string;
  error_trace: string | null;
  job_created_at: Date | string;
  job_updated_at: Date | string;
  run_id: string | null;
  run_status: string | null;
}

interface CampaignProductionRunRow {
  run_id: string;
  run_status: string;
  assembly_job_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PostgresCampaignDeliveryReelQueries implements CampaignDeliveryReelQueries {
  constructor(private readonly client: Pool | PoolClient) {}

  async findCanonicalDeliveryAssembly(
    campaignId: CampaignId
  ): Promise<CanonicalDeliveryAssemblyRecord | undefined> {
    // 1. Verify campaign exists
    const campaignResult = await this.client.query<CampaignRow>(
      `SELECT campaign_id, status, updated_at FROM campaigns WHERE campaign_id = $1`,
      [campaignId]
    );
    const campaignRow = campaignResult.rows[0];
    if (!campaignRow) {
      return undefined;
    }

    // 2. Query completed delivery assembly jobs (Priority 1)
    const completedJobsResult = await this.client.query<DeliveryAssemblyJobRow>(
      `
      SELECT
        j.job_id,
        j.campaign_id,
        j.assembly_spec,
        j.status AS job_status,
        j.error_trace,
        j.created_at AS job_created_at,
        j.updated_at AS job_updated_at,
        r.run_id,
        r.status AS run_status
      FROM delivery_assembly_jobs j
      LEFT JOIN campaign_production_runs r ON r.assembly_job_id = j.job_id
      WHERE j.campaign_id = $1 AND j.status = 'completed'
      ORDER BY j.created_at DESC
      LIMIT 1
      `,
      [campaignId]
    );
    if (completedJobsResult.rows.length > 0) {
      return this.mapJobRow(completedJobsResult.rows[0]!, "completed");
    }

    // 3. Query active assembly jobs (Priority 2)
    const activeJobsResult = await this.client.query<DeliveryAssemblyJobRow>(
      `
      SELECT
        j.job_id,
        j.campaign_id,
        j.assembly_spec,
        j.status AS job_status,
        j.error_trace,
        j.created_at AS job_created_at,
        j.updated_at AS job_updated_at,
        r.run_id,
        r.status AS run_status
      FROM delivery_assembly_jobs j
      LEFT JOIN campaign_production_runs r ON r.assembly_job_id = j.job_id
      WHERE j.campaign_id = $1 AND j.status IN ('queued', 'leased', 'rendering')
      ORDER BY j.created_at DESC
      LIMIT 1
      `,
      [campaignId]
    );
    if (activeJobsResult.rows.length > 0) {
      return this.mapJobRow(activeJobsResult.rows[0]!, "assembling");
    }

    // 3b. Query active assembling production runs (Priority 2b)
    const assemblingRunsResult = await this.client.query<CampaignProductionRunRow>(
      `
      SELECT
        run_id,
        status AS run_status,
        assembly_job_id,
        created_at,
        updated_at
      FROM campaign_production_runs
      WHERE campaign_id = $1 AND status = 'assembling'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [campaignId]
    );
    if (assemblingRunsResult.rows.length > 0) {
      return this.mapRunRow(assemblingRunsResult.rows[0]!, "assembling");
    }

    // 4. Query failed assembly jobs (Priority 3)
    const failedJobsResult = await this.client.query<DeliveryAssemblyJobRow>(
      `
      SELECT
        j.job_id,
        j.campaign_id,
        j.assembly_spec,
        j.status AS job_status,
        j.error_trace,
        j.created_at AS job_created_at,
        j.updated_at AS job_updated_at,
        r.run_id,
        r.status AS run_status
      FROM delivery_assembly_jobs j
      LEFT JOIN campaign_production_runs r ON r.assembly_job_id = j.job_id
      WHERE j.campaign_id = $1 AND j.status = 'failed'
      ORDER BY j.created_at DESC
      LIMIT 1
      `,
      [campaignId]
    );
    if (failedJobsResult.rows.length > 0) {
      return this.mapJobRow(failedJobsResult.rows[0]!, "failed");
    }

    // 4b. Query failed production runs (Priority 3b)
    const failedRunsResult = await this.client.query<CampaignProductionRunRow>(
      `
      SELECT
        run_id,
        status AS run_status,
        assembly_job_id,
        created_at,
        updated_at
      FROM campaign_production_runs
      WHERE campaign_id = $1 AND status = 'failed'
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [campaignId]
    );
    if (failedRunsResult.rows.length > 0) {
      return this.mapRunRow(failedRunsResult.rows[0]!, "failed");
    }

    // 5. Not started (Priority 4)
    return {
      campaignExists: true,
      status: "not-started",
      updatedAt: campaignRow.updated_at ? new Date(campaignRow.updated_at).toISOString() : undefined
    };
  }

  private mapJobRow(
    row: DeliveryAssemblyJobRow,
    status: DeliveryAssemblyStatus
  ): CanonicalDeliveryAssemblyRecord {
    let assemblySpec: AssemblySpec | undefined;
    if (row.assembly_spec) {
      let rawSpec: unknown = row.assembly_spec;
      if (typeof rawSpec === "string") {
        try {
          rawSpec = JSON.parse(rawSpec);
        } catch {
          rawSpec = undefined;
        }
      }
      if (rawSpec) {
        const parsed = AssemblySpecSchema.safeParse(rawSpec);
        if (parsed.success) {
          assemblySpec = parsed.data;
        }
      }
    }

    return {
      campaignExists: true,
      status,
      ...(row.run_id ? { runId: row.run_id } : {}),
      assemblyJobId: row.job_id,
      ...(assemblySpec ? { assemblySpec } : {}),
      ...(row.error_trace ? { errorTrace: row.error_trace } : {}),
      ...(row.job_created_at ? { createdAt: new Date(row.job_created_at).toISOString() } : {}),
      ...(row.job_updated_at ? { updatedAt: new Date(row.job_updated_at).toISOString() } : {})
    };
  }

  private mapRunRow(
    row: CampaignProductionRunRow,
    status: DeliveryAssemblyStatus
  ): CanonicalDeliveryAssemblyRecord {
    return {
      campaignExists: true,
      status,
      runId: row.run_id,
      ...(row.assembly_job_id ? { assemblyJobId: row.assembly_job_id } : {}),
      ...(row.created_at ? { createdAt: new Date(row.created_at).toISOString() } : {}),
      ...(row.updated_at ? { updatedAt: new Date(row.updated_at).toISOString() } : {})
    };
  }
}
