import { describe, expect, it } from "vitest";
import {
  createActionId,
  createBatchId,
  createClientId,
  createEvidenceId,
  createSkuId
} from "./identifiers.js";
import { ProductValidationError } from "./product-evidence-errors.js";

describe("Product and Evidence Authority Brands", () => {
  const validV7 = "018f0000-0000-7000-8000-000000000001";
  const validV4 = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

  it("creates validated branded identifiers from valid UUIDs", () => {
    const clientId = createClientId(validV7);
    const skuId = createSkuId(validV7);
    const batchId = createBatchId(validV4);
    const evidenceId = createEvidenceId(validV7);
    const actionId = createActionId(validV4);

    expect(clientId).toBe(validV7);
    expect(skuId).toBe(validV7);
    expect(batchId).toBe(validV4);
    expect(evidenceId).toBe(validV7);
    expect(actionId).toBe(validV4);
  });

  it("normalizes uppercase hex to lowercase", () => {
    const upper = "018F0000-0000-7000-8000-000000000001";
    const clientId = createClientId(upper);
    expect(clientId).toBe(validV7);
  });

  it("rejects IDs with surrounding whitespace without silent trimming", () => {
    const padded = ` ${validV7} `;
    expect(() => createClientId(padded)).toThrow(ProductValidationError);
    expect(() => createSkuId(padded)).toThrow(ProductValidationError);
    expect(() => createBatchId(padded)).toThrow(ProductValidationError);
    expect(() => createEvidenceId(padded)).toThrow(ProductValidationError);
    expect(() => createActionId(padded)).toThrow(ProductValidationError);
  });

  it("rejects invalid UUID strings", () => {
    expect(() => createClientId("not-a-uuid")).toThrow(ProductValidationError);
    expect(() => createSkuId("")).toThrow(ProductValidationError);
  });
});
