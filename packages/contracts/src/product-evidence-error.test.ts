import { describe, expect, it } from "vitest";
import {
  mapZodErrorToValidationIssues,
  ProductBusinessErrorResponseSchema,
  ProductValidationErrorResponseSchema
} from "./product-evidence-error.js";
import { CreateSkuRequestSchema } from "./product-sku.js";

describe("Product Evidence Error Contracts", () => {
  it("maps unrecognized keys to UNKNOWN_FIELD issues", () => {
    const raw = {
      actionId: "018f0000-0000-7000-8000-000000000001",
      canonicalSku: "SKU-01",
      displayName: "Name",
      maliciousField: "injectedValue"
    };

    const result = CreateSkuRequestSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = mapZodErrorToValidationIssues(result.error);
      expect(issues.some((i) => i.code === "UNKNOWN_FIELD")).toBe(true);
      expect(issues.find((i) => i.code === "UNKNOWN_FIELD")?.path).toContain("maliciousField");
    }
  });

  it("maps identifier and text errors to stable codes", () => {
    const raw = {
      actionId: "bad-uuid",
      canonicalSku: "!!illegal!!",
      displayName: ""
    };

    const result = CreateSkuRequestSchema.safeParse(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = mapZodErrorToValidationIssues(result.error);
      expect(issues.some((i) => i.code === "INVALID_IDENTIFIER")).toBe(true);
    }
  });

  it("validates ProductValidationErrorResponseSchema", () => {
    const validError = {
      error: "VALIDATION_ERROR",
      issues: [
        {
          code: "INVALID_IDENTIFIER",
          path: ["skuId"],
          message: "skuId must be a valid UUID"
        }
      ]
    };
    expect(ProductValidationErrorResponseSchema.safeParse(validError).success).toBe(true);
  });

  it("validates ProductBusinessErrorResponseSchema", () => {
    const conflict = {
      error: "STALE_REVISION_CONFLICT",
      message: "Version mismatch on ProductSku",
      details: { expectedVersion: 1, actualVersion: 2 }
    };
    expect(ProductBusinessErrorResponseSchema.safeParse(conflict).success).toBe(true);
  });
});
