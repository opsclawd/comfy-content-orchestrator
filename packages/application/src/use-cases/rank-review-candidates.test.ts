import { describe, expect, it, vi } from "vitest";
import type {
  CampaignId,
  CampaignRecord,
  CandidateId,
  ClientRecord,
  SceneId,
  StoryboardCandidate
} from "@cco/domain";
import type {
  RankingModelClientPort,
  RankingModelOutcome,
  RankingModelRequest,
  SceneReviewCandidateGroup,
  SceneReviewDetail
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { RankReviewCandidatesUseCase } from "./rank-review-candidates.js";

function makeCandidate(variantOrdinal: number, specRevision = 2): StoryboardCandidate {
  return {
    id: `cand-${specRevision}-${variantOrdinal}` as CandidateId,
    sceneId: "scene-1" as SceneId,
    specRevision,
    variantOrdinal,
    storageBucket: "review-bucket",
    storageObjectKey: `candidates/cand-${specRevision}-${variantOrdinal}.png`,
    contentHash: `hash-${specRevision}-${variantOrdinal}`,
    generationMetadata: {},
    createdAt: "2026-09-07T00:00:00.000Z"
  };
}

class FakeRankingClient implements RankingModelClientPort {
  readonly calls: RankingModelRequest[] = [];
  constructor(
    readonly providerName: "Google" | "OpenAI",
    private readonly outcome: RankingModelOutcome
  ) {}

  async rankBatch(request: RankingModelRequest): Promise<RankingModelOutcome> {
    this.calls.push(request);
    return this.outcome;
  }
}

describe("RankReviewCandidatesUseCase", () => {
  const sampleClient: ClientRecord = {
    id: "client-1",
    companyName: "Acme Studios",
    brandBibleJson: {},
    defaultAspectRatio: "16:9",
    externalProcessingPolicy: {
      allowCloudVisualQA: true,
      allowedProviders: ["Google", "OpenAI"],
      sensitiveDataMasking: false
    },
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z"
  };

  const sampleCampaign: CampaignRecord = {
    id: "campaign-1" as CampaignId,
    clientId: "client-1",
    title: "Summer Promo",
    targetPlatform: "web",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: "2026-09-07T00:00:00.000Z",
    updatedAt: "2026-09-07T00:00:00.000Z"
  };

  const rev1Candidates: StoryboardCandidate[] = [makeCandidate(1, 1), makeCandidate(2, 1)];
  const rev2Candidates: StoryboardCandidate[] = [
    makeCandidate(1, 2),
    makeCandidate(2, 2),
    makeCandidate(3, 2)
  ];

  const sampleCandidateGroups: SceneReviewCandidateGroup[] = [
    { specRevision: 1, candidates: rev1Candidates },
    { specRevision: 2, candidates: rev2Candidates }
  ];

  const sampleDetail: SceneReviewDetail = {
    sceneId: "scene-1" as SceneId,
    campaignId: "campaign-1" as CampaignId,
    status: "director_review",
    specRevision: 2,
    configuration: {
      prompt: "Golden hour mountain ridge",
      referenceIds: [],
      engineProfileId: "LTX_25_720P_5S_V1",
      durationMs: 5000,
      loraConfigurationId: null
    },
    candidatesByRevision: sampleCandidateGroups,
    allowedActions: ["approve", "reject", "reroll"]
  };

  const resolveImageData = vi.fn(async (c: StoryboardCandidate) => ({
    base64Data: `img-${c.variantOrdinal}`,
    mimeType: "image/png"
  }));

  it("returns candidatesByRevision untouched when candidateRanker is undefined", async () => {
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [sampleClient]
    );
    const useCase = new RankReviewCandidatesUseCase({ uow });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(result).toBe(sampleDetail.candidatesByRevision);
  });

  it("returns candidatesByRevision untouched when campaign is not found in uow", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [], [sampleClient]);
    const primary = new FakeRankingClient("Google", { kind: "success", rankedOrdinals: [3, 1, 2] });
    const fallback = new FakeRankingClient("OpenAI", {
      kind: "permanent_failure",
      httpStatus: 400,
      message: ""
    });
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: { primaryClient: primary, fallbackClient: fallback }
    });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(result).toEqual(sampleDetail.candidatesByRevision);
    expect(primary.calls).toHaveLength(0);
  });

  it("returns candidatesByRevision untouched when client is not found in uow", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [sampleCampaign], []);
    const primary = new FakeRankingClient("Google", { kind: "success", rankedOrdinals: [3, 1, 2] });
    const fallback = new FakeRankingClient("OpenAI", {
      kind: "permanent_failure",
      httpStatus: 400,
      message: ""
    });
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: { primaryClient: primary, fallbackClient: fallback }
    });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(result).toEqual(sampleDetail.candidatesByRevision);
    expect(primary.calls).toHaveLength(0);
  });

  it("returns candidatesByRevision untouched when allowCloudVisualQA is false", async () => {
    const clientWithDisabledPolicy: ClientRecord = {
      ...sampleClient,
      externalProcessingPolicy: {
        allowCloudVisualQA: false,
        allowedProviders: ["Google", "OpenAI"]
      }
    };
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [clientWithDisabledPolicy]
    );
    const primary = new FakeRankingClient("Google", { kind: "success", rankedOrdinals: [3, 1, 2] });
    const fallback = new FakeRankingClient("OpenAI", {
      kind: "permanent_failure",
      httpStatus: 400,
      message: ""
    });
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: { primaryClient: primary, fallbackClient: fallback }
    });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(result).toEqual(sampleDetail.candidatesByRevision);
    expect(primary.calls).toHaveLength(0);
  });

  it("successfully ranks and reorders the current revision's candidate group", async () => {
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [sampleClient]
    );
    const primary = new FakeRankingClient("Google", { kind: "success", rankedOrdinals: [3, 1, 2] });
    const fallback = new FakeRankingClient("OpenAI", {
      kind: "permanent_failure",
      httpStatus: 400,
      message: ""
    });
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: { primaryClient: primary, fallbackClient: fallback }
    });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(primary.calls).toHaveLength(1);

    // Group 1 (historical revision 1) must be untouched
    const group1 = result.find((g) => g.specRevision === 1);
    expect(group1?.candidates.map((c) => c.variantOrdinal)).toEqual([1, 2]);

    // Group 2 (current specRevision 2) must be reordered
    const group2 = result.find((g) => g.specRevision === 2);
    expect(group2?.candidates.map((c) => c.variantOrdinal)).toEqual([3, 1, 2]);
  });

  it("supports direct CandidateRankerPort implementation in candidateRanker dependency", async () => {
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [sampleClient]
    );
    const mockRanker = {
      rank: vi.fn(async (c: readonly StoryboardCandidate[]) => [c[2]!, c[0]!, c[1]!])
    };
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: mockRanker
    });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(mockRanker.rank).toHaveBeenCalledTimes(1);
    const group2 = result.find((g) => g.specRevision === 2);
    expect(group2?.candidates.map((c) => c.variantOrdinal)).toEqual([3, 1, 2]);
  });

  it("handles ranker throwing an error by returning candidatesByRevision untouched", async () => {
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [sampleClient]
    );
    const throwingRanker = {
      rank: vi.fn(async () => {
        throw new Error("Unexpected crash in ranker");
      })
    };
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: throwingRanker
    });

    const result = await useCase.execute(sampleDetail, resolveImageData);
    expect(result).toEqual(sampleDetail.candidatesByRevision);
  });

  it("does not call ranker if current revision has fewer than 2 candidates", async () => {
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [sampleClient]
    );
    const singleCandidateDetail: SceneReviewDetail = {
      ...sampleDetail,
      candidatesByRevision: [{ specRevision: 2, candidates: [makeCandidate(1, 2)] }]
    };
    const mockRanker = {
      rank: vi.fn()
    };
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: mockRanker
    });

    const result = await useCase.execute(singleCandidateDetail, resolveImageData);
    expect(result).toEqual(singleCandidateDetail.candidatesByRevision);
    expect(mockRanker.rank).not.toHaveBeenCalled();
  });

  it("returns candidatesByRevision untouched when sensitiveDataMasking is true", async () => {
    const clientWithMasking: ClientRecord = {
      ...sampleClient,
      externalProcessingPolicy: {
        allowCloudVisualQA: true,
        allowedProviders: ["Google", "OpenAI"],
        sensitiveDataMasking: true
      }
    };
    const uow = new InMemorySceneUnitOfWork(
      undefined,
      undefined,
      undefined,
      [sampleCampaign],
      [clientWithMasking]
    );
    const primary = new FakeRankingClient("Google", { kind: "success", rankedOrdinals: [3, 1, 2] });
    const fallback = new FakeRankingClient("OpenAI", {
      kind: "permanent_failure",
      httpStatus: 400,
      message: ""
    });
    const resolveSpy = vi.fn(resolveImageData);
    const useCase = new RankReviewCandidatesUseCase({
      uow,
      candidateRanker: { primaryClient: primary, fallbackClient: fallback }
    });

    const result = await useCase.execute(sampleDetail, resolveSpy);
    expect(result).toEqual(sampleDetail.candidatesByRevision);
    expect(primary.calls).toHaveLength(0);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
