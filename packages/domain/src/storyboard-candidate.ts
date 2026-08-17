import type { SceneId } from "./scene.js";

declare const CandidateIdBrand: unique symbol;
export type CandidateId = string & { readonly [CandidateIdBrand]: true };

export interface StoryboardCandidate {
  readonly id: CandidateId;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly variantOrdinal: number;
  readonly locator: string;
  readonly contentHash: string;
  readonly generationMetadata: Record<string, unknown>;
  readonly createdAt: string;
}
