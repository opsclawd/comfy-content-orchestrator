export class ShotPlanNotFoundError extends Error {
  override readonly name = "ShotPlanNotFoundError";
  readonly shotPlanId: string;

  constructor(shotPlanId: string) {
    super(`ShotPlan '${shotPlanId}' was not found.`);
    this.shotPlanId = shotPlanId;
  }
}

export class InvalidShotPlanVariantCountError extends Error {
  override readonly name = "InvalidShotPlanVariantCountError";
  readonly count: number;

  constructor(count: number, message?: string) {
    super(message ?? `ShotPlan variant count must be between 1 and 5, received ${count}.`);
    this.count = count;
  }
}

export class ShotPlanValidationError extends Error {
  override readonly name: string = "ShotPlanValidationError";

  constructor(message: string) {
    super(message);
  }
}

export class SourceShotPlanNotFoundError extends Error {
  override readonly name = "SourceShotPlanNotFoundError";
  readonly sourceShotPlanId: string;

  constructor(sourceShotPlanId: string) {
    super(`Source ShotPlan '${sourceShotPlanId}' was not found.`);
    this.sourceShotPlanId = sourceShotPlanId;
  }
}

export class CrossSceneSourceShotPlanError extends Error {
  override readonly name = "CrossSceneSourceShotPlanError";
  readonly sourceShotPlanId: string;
  readonly sourceSceneId: string;
  readonly targetSceneId: string;

  constructor(sourceShotPlanId: string, sourceSceneId: string, targetSceneId: string) {
    super(
      `Source ShotPlan '${sourceShotPlanId}' belongs to scene '${sourceSceneId}', not target scene '${targetSceneId}'.`
    );
    this.sourceShotPlanId = sourceShotPlanId;
    this.sourceSceneId = sourceSceneId;
    this.targetSceneId = targetSceneId;
  }
}

export class StaleSourceShotPlanRevisionError extends Error {
  override readonly name = "StaleSourceShotPlanRevisionError";
  readonly sourceShotPlanId: string;
  readonly sourceRevision: number;
  readonly currentRevision: number;

  constructor(sourceShotPlanId: string, sourceRevision: number, currentRevision: number) {
    super(
      `Source ShotPlan '${sourceShotPlanId}' revision ${sourceRevision} does not match current scene revision ${currentRevision}.`
    );
    this.sourceShotPlanId = sourceShotPlanId;
    this.sourceRevision = sourceRevision;
    this.currentRevision = currentRevision;
  }
}

export class SupersededSourceShotPlanError extends Error {
  override readonly name = "SupersededSourceShotPlanError";
  readonly sourceShotPlanId: string;
  readonly status: string;

  constructor(sourceShotPlanId: string, status: string) {
    super(
      `Source ShotPlan '${sourceShotPlanId}' is superseded (status: '${status}') and cannot be varied.`
    );
    this.sourceShotPlanId = sourceShotPlanId;
    this.status = status;
  }
}

export class InvalidSceneStateForVariationError extends Error {
  override readonly name = "InvalidSceneStateForVariationError";
  readonly sceneId: string;
  readonly status: string;

  constructor(sceneId: string, status: string) {
    super(
      `Scene '${sceneId}' is in state '${status}', which does not permit creating ShotPlan variations.`
    );
    this.sceneId = sceneId;
    this.status = status;
  }
}

export class ShotPlanVariationIdempotencyConflictError extends Error {
  override readonly name = "ShotPlanVariationIdempotencyConflictError";
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      `A conflicting ShotPlan variation request already exists for idempotency key '${idempotencyKey}'.`
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class ReferenceAssetDescriptionGenerationError extends Error {
  override readonly name = "ReferenceAssetDescriptionGenerationError";
  readonly assetId: string;
  readonly referenceAssetId: string;

  constructor(assetId: string, message: string, options?: ErrorOptions) {
    super(`Failed to generate description for reference asset '${assetId}': ${message}`, options);
    this.assetId = assetId;
    this.referenceAssetId = assetId;
  }
}

export class InvalidPersistentSubjectIdError extends ShotPlanValidationError {
  override readonly name = "InvalidPersistentSubjectIdError";
  readonly code = "INVALID_PERSISTENT_SUBJECT_ID";
  readonly persistentId: string;
  readonly reason: string;

  constructor(persistentId: string, reason: string) {
    super(`Invalid persistent subject ID "${persistentId}": ${reason}`);
    this.persistentId = persistentId;
    this.reason = reason;
  }
}

export {
  CampaignReferenceBibleRoleConflictError,
  StaleBibleEntryConflictError,
  StaleBibleBindingMismatchError
} from "../ports/campaign-reference-bible-errors.js";
