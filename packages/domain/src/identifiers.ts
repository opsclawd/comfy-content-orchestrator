import type { Brand } from "@cco/shared";
import { isValidUuid, normalizeUuid } from "@cco/shared";
import { ProductValidationError } from "./product-evidence-errors.js";

declare const SceneIdBrand: unique symbol;
export type SceneId = string & { readonly [SceneIdBrand]: true };

declare const CampaignIdBrand: unique symbol;
export type CampaignId = string & { readonly [CampaignIdBrand]: true };

declare const ShotPlanIdBrand: unique symbol;
export type ShotPlanId = string & { readonly [ShotPlanIdBrand]: true };

// ============================================================================
// Verified Product & Evidence Authority Brands (ADR 0009)
// ============================================================================

export type ClientId = Brand<string, "ClientId">;
export type SkuId = Brand<string, "SkuId">;
export type BatchId = Brand<string, "BatchId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type SourceObjectId = Brand<string, "SourceObjectId">;
export type DerivativeId = Brand<string, "DerivativeId">;
export type VerificationEventId = Brand<string, "VerificationEventId">;
export type ActionId = Brand<string, "ActionId">;
export type CoaReportId = Brand<string, "CoaReportId">;
export type CoaMeasurementId = Brand<string, "CoaMeasurementId">;
export type CoaReviewEventId = Brand<string, "CoaReviewEventId">;
export type ClaimId = Brand<string, "ClaimId">;
export type ClaimLinkId = Brand<string, "ClaimLinkId">;
export type ClaimDecisionEventId = Brand<string, "ClaimDecisionEventId">;

/** Lowercase 64-hex SHA-256 digest string */
export type Sha256Hex = string & { readonly __sha256: true };

function validateAndBrandUuid<B extends string>(
  val: unknown,
  _brandName: B,
  fieldName: string
): Brand<string, B> {
  if (typeof val !== "string" || !isValidUuid(val)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_IDENTIFIER",
          path: [fieldName],
          message: `${fieldName} must be a valid UUID string (v4 or v7).`
        }
      ],
      `Invalid ${fieldName}: "${String(val)}" is not a valid UUID.`
    );
  }
  return normalizeUuid(val, fieldName) as Brand<string, B>;
}

export function createClientId(val: string): ClientId {
  return validateAndBrandUuid(val, "ClientId", "clientId");
}

export function createSkuId(val: string): SkuId {
  return validateAndBrandUuid(val, "SkuId", "skuId");
}

export function createBatchId(val: string): BatchId {
  return validateAndBrandUuid(val, "BatchId", "batchId");
}

export function createEvidenceId(val: string): EvidenceId {
  return validateAndBrandUuid(val, "EvidenceId", "evidenceId");
}

export function createSourceObjectId(val: string): SourceObjectId {
  return validateAndBrandUuid(val, "SourceObjectId", "sourceObjectId");
}

export function createDerivativeId(val: string): DerivativeId {
  return validateAndBrandUuid(val, "DerivativeId", "derivativeId");
}

export function createVerificationEventId(val: string): VerificationEventId {
  return validateAndBrandUuid(val, "VerificationEventId", "verificationEventId");
}

export function createActionId(val: string): ActionId {
  return validateAndBrandUuid(val, "ActionId", "actionId");
}

export function createCoaReportId(val: string): CoaReportId {
  return validateAndBrandUuid(val, "CoaReportId", "reportId");
}

export function createCoaMeasurementId(val: string): CoaMeasurementId {
  return validateAndBrandUuid(val, "CoaMeasurementId", "measurementId");
}

export function createCoaReviewEventId(val: string): CoaReviewEventId {
  return validateAndBrandUuid(val, "CoaReviewEventId", "eventId");
}

export function createClaimId(val: string): ClaimId {
  return validateAndBrandUuid(val, "ClaimId", "claimId");
}

export function createClaimLinkId(val: string): ClaimLinkId {
  return validateAndBrandUuid(val, "ClaimLinkId", "linkId");
}

export function createClaimDecisionEventId(val: string): ClaimDecisionEventId {
  return validateAndBrandUuid(val, "ClaimDecisionEventId", "eventId");
}

export function createSha256Hex(val: string): Sha256Hex {
  if (typeof val !== "string" || !/^[0-9a-f]{64}$/.test(val)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_TEXT",
          path: ["sha256"],
          message: "sha256 must be a lowercase 64-hex SHA-256 digest string."
        }
      ],
      `Invalid sha256: "${String(val)}" is not a valid 64-character lowercase hex digest.`
    );
  }
  return val as Sha256Hex;
}
