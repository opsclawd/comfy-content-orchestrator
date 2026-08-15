import type { ReviewEvent } from "@cco/contracts";

export interface ReviewEventStore {
  append(event: ReviewEvent): Promise<void>;
}
