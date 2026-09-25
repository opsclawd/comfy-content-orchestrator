import { REFERENCE_ROLES, type ReferenceAsset, type ReferenceRole } from "./reference-asset.js";

export class CrossClientReferenceBindingError extends Error {
  override readonly name = "CrossClientReferenceBindingError";

  constructor(
    public readonly campaignClientId: string,
    public readonly assetId: string,
    public readonly assetClientId: string
  ) {
    super(
      `Cross-client reference binding rejected: Asset "${assetId}" owned by client "${assetClientId}" cannot be bound to campaign owned by client "${campaignClientId}".`
    );
  }
}

export class ArchivedReferenceBindingError extends Error {
  override readonly name = "ArchivedReferenceBindingError";

  constructor(public readonly assetId: string) {
    super(
      `Archived reference binding rejected: Asset "${assetId}" is archived and cannot be newly bound to a scene.`
    );
  }
}

export class ReferenceAssetNotFoundError extends Error {
  override readonly name = "ReferenceAssetNotFoundError";

  constructor(public readonly assetId: string) {
    super(`Reference asset "${assetId}" was not found.`);
  }
}

export class InvalidReferenceRoleError extends Error {
  override readonly name = "InvalidReferenceRoleError";

  constructor(public readonly role: string) {
    super(`Invalid reference role: "${role}". Must be one of: ${REFERENCE_ROLES.join(", ")}.`);
  }
}

export class InvalidReferenceWeightError extends Error {
  override readonly name = "InvalidReferenceWeightError";

  constructor(public readonly weight: number) {
    super(`Invalid reference weight: ${weight}. Must be a number between 0.0 and 1.0.`);
  }
}

export function isReferenceRole(role: string): role is ReferenceRole {
  return (REFERENCE_ROLES as readonly string[]).includes(role);
}

export function assertValidReferenceRole(role: string): asserts role is ReferenceRole {
  if (!isReferenceRole(role)) {
    throw new InvalidReferenceRoleError(role);
  }
}

export function assertValidReferenceWeight(weight: number | null | undefined): void {
  if (weight !== null && weight !== undefined) {
    if (typeof weight !== "number" || Number.isNaN(weight) || weight < 0 || weight > 1) {
      throw new InvalidReferenceWeightError(weight);
    }
  }
}

export function assertReferenceAssetSelectable(
  asset: ReferenceAsset,
  campaignClientId: string
): void {
  if (asset.clientId !== campaignClientId) {
    throw new CrossClientReferenceBindingError(campaignClientId, asset.id, asset.clientId);
  }
  if (asset.archivedAt != null) {
    throw new ArchivedReferenceBindingError(asset.id);
  }
}
