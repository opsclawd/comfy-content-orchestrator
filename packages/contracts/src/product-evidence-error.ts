import { z } from "zod";
import {
  PRODUCT_EVIDENCE_ERROR_CODES,
  PRODUCT_VALIDATION_ISSUE_CODES,
  type ProductValidationIssue,
  type ProductValidationIssueCode
} from "@cco/shared";

export const ProductEvidenceErrorCodeSchema = z.enum(PRODUCT_EVIDENCE_ERROR_CODES);

export const ProductValidationIssueCodeSchema = z.enum(PRODUCT_VALIDATION_ISSUE_CODES);

export const ProductValidationIssueSchema = z
  .object({
    code: ProductValidationIssueCodeSchema,
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string()
  })
  .strict();

export const ProductValidationErrorResponseSchema = z
  .object({
    error: z.literal("VALIDATION_ERROR"),
    issues: z.array(ProductValidationIssueSchema)
  })
  .strict();
export type ProductValidationErrorResponse = z.infer<typeof ProductValidationErrorResponseSchema>;

export const ProductBusinessErrorResponseSchema = z
  .object({
    error: ProductEvidenceErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional()
  })
  .strict();
export type ProductBusinessErrorResponse = z.infer<typeof ProductBusinessErrorResponseSchema>;

/**
 * Maps ZodError issues deterministically into typed ProductValidationIssue objects.
 * Prevents clients from needing to parse English validation messages.
 */
export function mapZodErrorToValidationIssues(error: z.ZodError): ProductValidationIssue[] {
  const issues: ProductValidationIssue[] = [];

  for (const issue of error.issues) {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      for (const key of issue.keys) {
        issues.push({
          code: "UNKNOWN_FIELD",
          path: [...issue.path, key],
          message: `Unrecognized field: "${key}" is not permitted in this request.`
        });
      }
      continue;
    }

    const leaf = String(issue.path[issue.path.length - 1] ?? "");

    let code: ProductValidationIssueCode;

    if (leaf.toLowerCase().includes("id") || leaf === "canonicalSku" || leaf === "lotIdentifier") {
      code = "INVALID_IDENTIFIER";
    } else if (leaf.toLowerCase().includes("version") || leaf.toLowerCase().includes("revision")) {
      code = "INVALID_REVISION";
    } else if (
      leaf.toLowerCase().includes("timestamp") ||
      leaf === "createdAt" ||
      leaf === "updatedAt" ||
      leaf === "archivedAt" ||
      leaf === "assertedAt"
    ) {
      code = "INVALID_TIMESTAMP";
    } else if (
      leaf === "productionStartDate" ||
      leaf === "productionEndDate" ||
      leaf.toLowerCase().includes("date")
    ) {
      if (issue.message.toLowerCase().includes("cannot be later")) {
        code = "INVALID_FIELD_COMBINATION";
      } else {
        code = "INVALID_DATE";
      }
    } else if (
      issue.message.toLowerCase().includes("both present") ||
      issue.message.toLowerCase().includes("combination")
    ) {
      code = "INVALID_FIELD_COMBINATION";
    } else {
      code = "INVALID_TEXT";
    }

    issues.push({
      code,
      path: issue.path,
      message: issue.message
    });
  }

  return issues;
}
