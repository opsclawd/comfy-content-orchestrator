import type { ReviewEvent } from "@cco/contracts";

export interface ReviewEventStore {
  append(event: ReviewEvent): Promise<void>;
  findById(eventId: string): Promise<ReviewEvent | undefined>;
}
