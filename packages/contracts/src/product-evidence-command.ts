import { z } from "zod";
import { isValidIsoUtcTimestamp } from "@cco/shared";

/**
 * Zod schema factory for trusted internal/adapter command envelope (ADR 0009 §8.3).
 * Captures authoritative actionId, client scope, actor identity, and server timestamp.
 */
export function createCommandEnvelopeSchema<T extends z.ZodTypeAny>(payloadSchema: T) {
  return z
    .object({
      actionId: z.string().uuid(),
      clientId: z.string().uuid(),
      actorId: z.string().min(1).max(128),
      timestamp: z.string().refine(isValidIsoUtcTimestamp, {
        message: "timestamp must be a valid UTC ISO 8601 string ending in Z"
      }),
      payload: payloadSchema
    })
    .strict();
}

export type CommandEnvelopeContract<T> = {
  readonly actionId: string;
  readonly clientId: string;
  readonly actorId: string;
  readonly timestamp: string;
  readonly payload: T;
};
