import type { AssemblySpec } from "@cco/contracts";
import type { CampaignId, DeliveryAssemblyJob, JobId, LeaseToken } from "@cco/domain";

export interface EnqueueDeliveryAssemblyJobInput {
  readonly campaignId: CampaignId | string;
  readonly assemblySpec: AssemblySpec;
  readonly maxRetries?: number | undefined;
}

export interface ClaimDeliveryAssemblyJobInput {
  readonly workerId: string;
  readonly leaseDurationMs: number;
}

export type DeliveryAssemblyJobMutationResult =
  | { readonly outcome: "applied"; readonly job: DeliveryAssemblyJob<AssemblySpec> }
  | { readonly outcome: "deferred"; readonly job: DeliveryAssemblyJob<AssemblySpec> }
  | { readonly outcome: "already_applied"; readonly job: DeliveryAssemblyJob<AssemblySpec> }
  | { readonly outcome: "superseded" }
  | { readonly outcome: "not_found" };

export interface DeliveryAssemblyJobQueuePort {
  enqueue(input: EnqueueDeliveryAssemblyJobInput): Promise<DeliveryAssemblyJob<AssemblySpec>>;
  claim(
    input: ClaimDeliveryAssemblyJobInput
  ): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined>;
  start(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    leaseDurationMs: number
  ): Promise<DeliveryAssemblyJobMutationResult>;
  complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<DeliveryAssemblyJobMutationResult>;
  getJob(jobId: JobId | string): Promise<DeliveryAssemblyJob<AssemblySpec> | undefined>;
}
