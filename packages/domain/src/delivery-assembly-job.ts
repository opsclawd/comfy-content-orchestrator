import type { CampaignId } from "./scene.js";
import type { JobId, JobStatus, LeaseToken } from "./render-job.js";

export interface DeliveryAssemblyJob<TSpec = Readonly<Record<string, unknown>>> {
  readonly jobId: JobId;
  readonly campaignId: CampaignId;
  readonly assemblySpec: TSpec;
  readonly status: JobStatus;
  readonly workerId: string | null;
  readonly leaseToken: LeaseToken | null;
  readonly leaseExpiresAt: Date | null;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly errorTrace: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
