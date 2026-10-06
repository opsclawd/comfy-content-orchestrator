export type CampaignReferenceBibleRole = "subject_identity" | "location";

export interface CampaignReferenceBibleEntry {
  readonly campaignId: string;
  readonly referenceAssetId: string;
  readonly role: CampaignReferenceBibleRole;
  readonly description: string;
  readonly biblePromptTag: string;
  readonly sourceContentHashSha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CampaignReferenceBibleEntryInput {
  readonly referenceAssetId: string;
  readonly role: CampaignReferenceBibleRole;
  readonly description: string;
  readonly biblePromptTag: string;
  readonly sourceContentHashSha256: string;
}

export interface CampaignReferenceBibleChange {
  readonly changeId: string;
  readonly campaignId: string;
  readonly referenceAssetId: string;
  readonly oldRole: CampaignReferenceBibleRole | null;
  readonly newRole: CampaignReferenceBibleRole | null;
  readonly oldDescription: string | null;
  readonly newDescription: string | null;
  readonly oldBiblePromptTag: string | null;
  readonly newBiblePromptTag: string | null;
  readonly oldSourceContentHashSha256: string | null;
  readonly newSourceContentHashSha256: string | null;
  readonly changedAt: string;
  readonly changeReason: string;
  readonly sourceSceneId: string;
  readonly sourceSpecRevision: number;
  readonly sourceBindingId: string;
  readonly actorKind: string;
  readonly actorId: string | null;
}

export interface InitializeCampaignReferenceBibleSnapshotInput {
  readonly campaignId: string;
  readonly entries: readonly CampaignReferenceBibleEntryInput[];
}

export interface InitializeCampaignReferenceBibleSnapshotResult {
  readonly entries: readonly CampaignReferenceBibleEntry[];
  readonly created: boolean;
}

export interface UpdateCampaignReferenceBibleEntryWithAuditInput {
  readonly campaignId: string;
  readonly referenceAssetId: string;
  readonly expectedUpdatedAt?: string | undefined;
  readonly next?:
    | {
        readonly role: CampaignReferenceBibleRole;
        readonly description: string;
        readonly biblePromptTag: string;
        readonly sourceContentHashSha256: string;
      }
    | null
    | undefined;
  readonly change: {
    readonly changeReason: string;
    readonly sourceSceneId: string;
    readonly sourceSpecRevision: number;
    readonly sourceBindingId: string;
    readonly actorKind: string;
    readonly actorId?: string | null | undefined;
    readonly oldRole?: CampaignReferenceBibleRole | null | undefined;
    readonly oldDescription?: string | null | undefined;
    readonly oldBiblePromptTag?: string | null | undefined;
    readonly oldSourceContentHashSha256?: string | null | undefined;
  };
}

export interface CampaignReferenceBibleRepository {
  findByCampaignId(campaignId: string): Promise<readonly CampaignReferenceBibleEntry[]>;
  findByCampaignAndAsset(
    campaignId: string,
    referenceAssetId: string
  ): Promise<CampaignReferenceBibleEntry | null>;
  initializeSnapshot(
    input: InitializeCampaignReferenceBibleSnapshotInput
  ): Promise<InitializeCampaignReferenceBibleSnapshotResult>;
  updateEntryWithAudit(
    input: UpdateCampaignReferenceBibleEntryWithAuditInput
  ): Promise<CampaignReferenceBibleEntry>;
  listChanges(
    campaignId: string,
    referenceAssetId?: string
  ): Promise<readonly CampaignReferenceBibleChange[]>;
}
