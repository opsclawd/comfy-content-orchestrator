import type { AssemblySpec } from "@cco/contracts";
import type { CampaignId } from "@cco/domain";

export type DeliveryAssemblyStatus = "not-started" | "assembling" | "completed" | "failed";

export interface CanonicalDeliveryAssemblyRecord {
  readonly campaignExists: boolean;
  readonly status: DeliveryAssemblyStatus;
  readonly runId?: string | undefined;
  readonly assemblyJobId?: string | undefined;
  readonly assemblySpec?: AssemblySpec | undefined;
  readonly errorTrace?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt?: string | undefined;
}

export interface CampaignDeliveryReelQueries {
  findCanonicalDeliveryAssembly(
    campaignId: CampaignId
  ): Promise<CanonicalDeliveryAssemblyRecord | undefined>;
}
