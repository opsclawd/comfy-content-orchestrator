import type { CampaignId, StoryboardCandidate } from "@cco/domain";
import type {
  CandidateRankerPort,
  CandidateRankingContext,
  RankingModelClientPort,
  ResolvedCandidateImage,
  SceneReviewCandidateGroup,
  SceneReviewDetail,
  UnitOfWork
} from "../ports/index.js";
import {
  CandidateRankingOrchestrator,
  decodeVisualQaAuthorizationPolicy,
  type VisualQaAuthorizationPolicy
} from "./candidate-ranking-orchestrator.js";

export interface RankReviewCandidatesDeps {
  readonly uow: UnitOfWork;
  readonly candidateRanker?:
    | {
        readonly primaryClient: RankingModelClientPort;
        readonly fallbackClient: RankingModelClientPort;
        readonly overallTimeoutMs?: number;
      }
    | CandidateRankerPort<StoryboardCandidate, CandidateRankingContext>
    | undefined;
}

export class RankReviewCandidatesUseCase {
  constructor(private readonly deps: RankReviewCandidatesDeps) {}

  async execute(
    detail: SceneReviewDetail,
    resolveImageData: (
      c: StoryboardCandidate,
      signal?: AbortSignal
    ) => Promise<ResolvedCandidateImage | undefined>
  ): Promise<readonly SceneReviewCandidateGroup[]> {
    if (!this.deps.candidateRanker) {
      return detail.candidatesByRevision;
    }

    try {
      const targetGroup = detail.candidatesByRevision.find(
        (group) => group.specRevision === detail.specRevision
      );
      if (!targetGroup || targetGroup.candidates.length < 2) {
        return detail.candidatesByRevision;
      }

      const policy = await this.resolveClientPolicy(detail.campaignId);
      if (!policy || !policy.allowCloudVisualQA || policy.sensitiveDataMasking) {
        return detail.candidatesByRevision;
      }

      const ranker: CandidateRankerPort<StoryboardCandidate, CandidateRankingContext> =
        "rank" in this.deps.candidateRanker
          ? this.deps.candidateRanker
          : new CandidateRankingOrchestrator({
              primaryClient: this.deps.candidateRanker.primaryClient,
              fallbackClient: this.deps.candidateRanker.fallbackClient,
              policy,
              ...(this.deps.candidateRanker.overallTimeoutMs !== undefined
                ? { overallTimeoutMs: this.deps.candidateRanker.overallTimeoutMs }
                : {})
            });

      const rankedCandidates = await ranker.rank(targetGroup.candidates, {
        sceneId: detail.sceneId,
        shotDescription: detail.configuration.prompt,
        resolveImageData
      });

      return detail.candidatesByRevision.map((group) => {
        if (group.specRevision === detail.specRevision) {
          return {
            specRevision: group.specRevision,
            candidates: rankedCandidates
          };
        }
        return group;
      });
    } catch {
      // Defense in depth: ranking failure must never block or error review read
      return detail.candidatesByRevision;
    }
  }

  private async resolveClientPolicy(
    campaignId: CampaignId
  ): Promise<VisualQaAuthorizationPolicy | undefined> {
    try {
      return await this.deps.uow.execute(async (ctx) => {
        if (!ctx.campaigns || !ctx.clients) {
          return undefined;
        }
        const campaign = await ctx.campaigns.findById(campaignId);
        if (!campaign) {
          return undefined;
        }
        const client = await ctx.clients.findById(campaign.clientId);
        if (!client) {
          return undefined;
        }
        return decodeVisualQaAuthorizationPolicy(client.externalProcessingPolicy);
      });
    } catch {
      return undefined;
    }
  }
}
