import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createCommandEnvelopeSchema } from "./product-evidence-command.js";

describe("Product Evidence Command Envelope Schema", () => {
  const payloadSchema = z
    .object({
      foo: z.string()
    })
    .strict();

  const envelopeSchema = createCommandEnvelopeSchema(payloadSchema);

  it("accepts valid command envelope with UTC ISO timestamp", () => {
    const valid = {
      actionId: "018f0000-0000-7000-8000-000000000001",
      clientId: "018f0000-0000-7000-8000-000000000002",
      actorId: "compliance-reviewer-01",
      timestamp: "2026-10-19T17:14:00.000Z",
      payload: { foo: "bar" }
    };

    const parsed = envelopeSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects non-UTC timestamps or local offsets", () => {
    const withOffset = {
      actionId: "018f0000-0000-7000-8000-000000000001",
      clientId: "018f0000-0000-7000-8000-000000000002",
      actorId: "compliance-reviewer-01",
      timestamp: "2026-10-19T17:14:00+02:00",
      payload: { foo: "bar" }
    };

    expect(envelopeSchema.safeParse(withOffset).success).toBe(false);
  });

  it("rejects unknown keys at envelope root or payload", () => {
    const withExtra = {
      actionId: "018f0000-0000-7000-8000-000000000001",
      clientId: "018f0000-0000-7000-8000-000000000002",
      actorId: "compliance-reviewer-01",
      timestamp: "2026-10-19T17:14:00.000Z",
      extraKey: "dangerous",
      payload: { foo: "bar" }
    };

    expect(envelopeSchema.safeParse(withExtra).success).toBe(false);
  });
});
