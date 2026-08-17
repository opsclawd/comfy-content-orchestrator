import type { ReviewAction, SceneStatus } from "@cco/contracts";
import type {
  CampaignId,
  CandidateId,
  SceneConfiguration,
  SceneId,
  StoryboardCandidate
} from "@cco/domain";

export interface SceneReviewCandidateGroup {
  readonly specRevision: number;
  readonly candidates: readonly StoryboardCandidate[];
}

export interface SceneReviewDetail {
  readonly sceneId: SceneId;
  readonly campaignId: CampaignId;
  readonly status: SceneStatus;
  readonly specRevision: number;
  readonly configuration: SceneConfiguration;
  readonly selectedCandidateId?: CandidateId;
  readonly selectedCandidateRevision?: number;
  readonly approval?: {
    readonly revision: number;
    readonly approvedBy: string;
    readonly approvedAt: string;
  };
  readonly candidatesByRevision: readonly SceneReviewCandidateGroup[];
  readonly allowedActions: readonly ReviewAction[];
}

export interface SceneReviewQueries {
  getSceneReviewDetail(sceneId: SceneId): Promise<SceneReviewDetail | undefined>;
}
