import type { CampaignId } from "./identifiers.js";

declare const ReferenceGroupIdBrand: unique symbol;
export type ReferenceGroupId = string & { readonly [ReferenceGroupIdBrand]: true };

export interface ReferenceGroup {
  readonly id: ReferenceGroupId;
  readonly clientId: string;
  readonly campaignId?: CampaignId | string | null | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly createdAt: string;
  readonly archivedAt?: string | null | undefined;
}
