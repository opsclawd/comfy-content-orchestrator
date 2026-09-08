import type { SceneId, StoryboardCandidate } from "@cco/domain";
import type { ResolvedCandidateImage } from "./ranking-model-client-port.js";

export interface CandidateRankingContext {
  readonly sceneId: SceneId;
  readonly shotDescription: string;
  readonly aspectRatio?: string;
  readonly resolveImageData: (
    candidate: StoryboardCandidate,
    signal?: AbortSignal
  ) => Promise<ResolvedCandidateImage | undefined>;
}
