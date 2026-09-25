import type { CampaignId, ReferenceGroup, ReferenceGroupId } from "@cco/domain";

export interface ReferenceGroupRepositoryOptions {
  readonly includeArchived?: boolean | undefined;
  readonly campaignId?: CampaignId | string | undefined;
}

export interface ReferenceGroupRepository {
  readonly findById: (groupId: ReferenceGroupId) => Promise<ReferenceGroup | undefined>;
  readonly findByClientId: (
    clientId: string,
    options?: ReferenceGroupRepositoryOptions
  ) => Promise<readonly ReferenceGroup[]>;
  readonly save: (group: ReferenceGroup) => Promise<ReferenceGroup>;
  readonly archive: (clientId: string, groupId: ReferenceGroupId) => Promise<boolean>;
}
