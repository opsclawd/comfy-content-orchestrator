import type { ReviewEvent } from "@cco/contracts";
import type { CandidateId, Scene, SceneId, StoryboardCandidate } from "@cco/domain";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";

export class InMemorySceneUnitOfWork implements UnitOfWork {
  private readonly _seededScenes: Map<SceneId, Scene>;
  private readonly _seededCandidates: Map<CandidateId, StoryboardCandidate>;
  private readonly _savedScenes: Scene[] = [];
  private readonly _reviewEvents: ReviewEvent[] = [];

  constructor(
    seededScenes?: Iterable<Scene> | ReadonlyMap<SceneId, Scene> | Record<string, Scene>,
    seededCandidates?:
      | Iterable<StoryboardCandidate>
      | ReadonlyMap<CandidateId, StoryboardCandidate>
      | Record<string, StoryboardCandidate>
  ) {
    this._seededScenes = new Map<SceneId, Scene>();
    if (seededScenes !== undefined && seededScenes !== null) {
      if (seededScenes instanceof Map) {
        for (const [id, scene] of seededScenes.entries()) {
          this._seededScenes.set(id, scene);
        }
      } else if (Symbol.iterator in seededScenes) {
        for (const item of seededScenes) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededScenes.set(item[0] as SceneId, item[1] as Scene);
          } else {
            const scene = item as Scene;
            this._seededScenes.set(scene.id, scene);
          }
        }
      } else if (typeof seededScenes === "object") {
        for (const [id, scene] of Object.entries(seededScenes)) {
          this._seededScenes.set(id as SceneId, scene as Scene);
        }
      }
    }

    this._seededCandidates = new Map<CandidateId, StoryboardCandidate>();
    if (seededCandidates !== undefined && seededCandidates !== null) {
      if (seededCandidates instanceof Map) {
        for (const [id, candidate] of seededCandidates.entries()) {
          this._seededCandidates.set(id, candidate);
        }
      } else if (Symbol.iterator in seededCandidates) {
        for (const item of seededCandidates) {
          if (Array.isArray(item) && item.length === 2 && typeof item[0] === "string") {
            this._seededCandidates.set(item[0] as CandidateId, item[1] as StoryboardCandidate);
          } else {
            const candidate = item as StoryboardCandidate;
            this._seededCandidates.set(candidate.id, candidate);
          }
        }
      } else if (typeof seededCandidates === "object") {
        for (const [id, candidate] of Object.entries(seededCandidates)) {
          this._seededCandidates.set(id as CandidateId, candidate as StoryboardCandidate);
        }
      }
    }
  }

  get savedScenes(): readonly Scene[] {
    return this._savedScenes;
  }

  get reviewEvents(): readonly ReviewEvent[] {
    return this._reviewEvents;
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    const stagedScenes: Scene[] = [];
    const stagedReviewEvents: ReviewEvent[] = [];

    const scopedScenes: SceneRepository = {
      findById: async (sceneId: SceneId): Promise<Scene | undefined> => {
        return this._seededScenes.get(sceneId);
      },
      save: async (scene: Scene): Promise<void> => {
        stagedScenes.push(scene);
      }
    };

    const scopedCandidates: StoryboardCandidateRepository = {
      findById: async (candidateId: CandidateId): Promise<StoryboardCandidate | undefined> => {
        return this._seededCandidates.get(candidateId);
      }
    };

    const scopedReviewEvents: ReviewEventStore = {
      append: async (event: ReviewEvent): Promise<void> => {
        stagedReviewEvents.push(event);
      }
    };

    const context: UnitOfWorkContext = {
      scenes: scopedScenes,
      reviewEvents: scopedReviewEvents,
      candidates: scopedCandidates
    };

    const result = await work(context);

    this._savedScenes.push(...stagedScenes);
    this._reviewEvents.push(...stagedReviewEvents);
    for (const scene of stagedScenes) {
      this._seededScenes.set(scene.id, scene);
    }

    return result;
  }
}
