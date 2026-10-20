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
export type ActionId = Brand<string, "ActionId">;

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

export function createActionId(val: string): ActionId {
  return validateAndBrandUuid(val, "ActionId", "actionId");
}
