import type {
  CampaignReviewSummary,
  ReviewAction,
  SceneStatus,
  ShotPlanReviewItem
} from "@cco/contracts";
import type {
  CampaignId,
  CandidateId,
  ReferenceRole,
  SceneConfiguration,
  SceneId,
  ShotPlanId,
  StoryboardCandidate
} from "@cco/domain";

export interface InternalSceneReferenceBindingWithStorage {
  readonly referenceAssetId: string;
  readonly sceneId: string;
  readonly specRevision: number;
  readonly role: ReferenceRole;
  readonly libraryRole?: ReferenceRole | null | undefined;
  readonly bindingOrder: number;
  readonly weight?: number | null | undefined;
  readonly hints?: Record<string, unknown> | null | undefined;
  readonly displayName?: string | undefined;
  readonly description?: string | null | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly mimeType?: string | undefined;
  readonly contentHashSha256?: string | undefined;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
}

export interface SceneReviewCandidateGroup {
  readonly specRevision: number;
  readonly candidates: readonly StoryboardCandidate[];
}

export interface SceneReviewDetail {
  readonly sceneId: SceneId;
  readonly campaignId: CampaignId;
  readonly clientId?: string;
  readonly status: SceneStatus;
  readonly specRevision: number;
  readonly configuration: SceneConfiguration;
  readonly selectedCandidateId?: CandidateId;
  readonly selectedCandidateRevision?: number;
  readonly selectedShotPlanId?: ShotPlanId;
  readonly selectedShotPlanRevision?: number;
  readonly approvedShotPlanId?: ShotPlanId;
  readonly approval?: {
    readonly revision: number;
    readonly approvedBy: string;
    readonly approvedAt: string;
  };
  readonly failureReason?: string | undefined;
  readonly candidatesByRevision: readonly SceneReviewCandidateGroup[];
  readonly shotPlans?: readonly ShotPlanReviewItem[];
  readonly referenceBindingsWithStorage?: readonly InternalSceneReferenceBindingWithStorage[];
  readonly allowedActions: readonly ReviewAction[];
}

export interface SceneReviewQueries {
  getSceneReviewDetail(sceneId: SceneId): Promise<SceneReviewDetail | undefined>;
  getCampaignReviewSummary(campaignId: CampaignId): Promise<CampaignReviewSummary | undefined>;
}
