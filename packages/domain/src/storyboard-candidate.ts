import type { CandidateId, SceneId } from "./scene.js";

export type { CandidateId };

export interface StoryboardCandidate {
  readonly id: CandidateId;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly variantOrdinal: number;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHash: string;
  readonly generationMetadata: Record<string, unknown>;
  readonly createdAt: string;
}
