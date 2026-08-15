import type { ReviewEventStore } from "./review-event-store.js";
import type { SceneRepository } from "./scene-repository.js";

export interface UnitOfWorkContext {
  readonly scenes: SceneRepository;
  readonly reviewEvents: ReviewEventStore;
}

export interface UnitOfWork {
  execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult>;
}
