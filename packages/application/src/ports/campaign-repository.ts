import type { CampaignShellRecord, CampaignStatus } from "@cco/domain";

export interface CampaignShellPersistenceRecord extends CampaignShellRecord {
  readonly requestHashSha256: string;
  readonly storyboardCompletionHashSha256?: string | undefined;
}

export interface CampaignShellRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<CampaignShellPersistenceRecord | undefined>;
  saveWithRequestHash(campaign: CampaignShellRecord, requestHashSha256: string): Promise<void>;
  recordStoryboardCompletion?(campaignId: string, completionHashSha256: string): Promise<void>;
}

export function isCampaignShellRepository(repo: unknown): repo is CampaignShellRepository {
  return (
    typeof repo === "object" &&
    repo !== null &&
    typeof (repo as CampaignShellRepository).findByIdempotencyKey === "function" &&
    typeof (repo as CampaignShellRepository).saveWithRequestHash === "function"
  );
}

export interface CampaignRepository<TCampaign> extends Partial<CampaignShellRepository> {
  findById(campaignId: string): Promise<TCampaign | undefined>;
  findByIdForUpdate(campaignId: string): Promise<TCampaign | undefined>;
  save(campaign: TCampaign): Promise<void>;
  recordStoryboardCompletion?(campaignId: string, completionHashSha256: string): Promise<void>;
  /**
   * Atomically projects a lifecycle status only when the campaign is still in
   * one of the expected prior states. Implemented as one guarded UPDATE.
   */
  transitionStatusIf(
    campaignId: string,
    expectedStatus: CampaignStatus | readonly CampaignStatus[],
    nextStatus: CampaignStatus,
    options?: { readonly approvedScenes?: number }
  ): Promise<boolean>;
}
