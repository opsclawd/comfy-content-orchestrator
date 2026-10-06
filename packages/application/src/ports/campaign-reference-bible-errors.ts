export class CampaignReferenceBibleRoleConflictError extends Error {
  override readonly name = "CampaignReferenceBibleRoleConflictError";
  readonly referenceAssetId: string;
  readonly conflictingRoles: readonly string[];

  constructor(referenceAssetId: string, conflictingRoles: readonly string[]) {
    super(
      `Reference asset "${referenceAssetId}" is bound with conflicting roles [${conflictingRoles.join(
        ", "
      )}] across campaign scenes.`
    );
    this.referenceAssetId = referenceAssetId;
    this.conflictingRoles = conflictingRoles;
  }
}

export class StaleBibleEntryConflictError extends Error {
  override readonly name = "StaleBibleEntryConflictError";
  readonly campaignId: string;
  readonly referenceAssetId: string;
  readonly expectedUpdatedAt?: string | undefined;
  readonly actualUpdatedAt?: string | undefined;

  constructor(
    campaignId: string,
    referenceAssetId: string,
    expectedUpdatedAt?: string,
    actualUpdatedAt?: string
  ) {
    super(
      `Stale campaign reference bible entry conflict for campaign "${campaignId}" and asset "${referenceAssetId}". Expected updated_at "${expectedUpdatedAt}", got "${actualUpdatedAt}".`
    );
    this.campaignId = campaignId;
    this.referenceAssetId = referenceAssetId;
    this.expectedUpdatedAt = expectedUpdatedAt;
    this.actualUpdatedAt = actualUpdatedAt;
  }
}

export class StaleBibleBindingMismatchError extends Error {
  override readonly name = "StaleBibleBindingMismatchError";
  readonly sceneId: string;
  readonly referenceAssetId: string;

  constructor(sceneId: string, referenceAssetId: string, reason?: string) {
    super(
      `Stale bible binding mismatch for scene "${sceneId}" and asset "${referenceAssetId}"${
        reason ? `: ${reason}` : ""
      }.`
    );
    this.sceneId = sceneId;
    this.referenceAssetId = referenceAssetId;
  }
}
