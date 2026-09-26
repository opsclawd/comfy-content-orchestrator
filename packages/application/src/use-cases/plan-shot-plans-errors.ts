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
  override readonly name = "ShotPlanValidationError";

  constructor(message: string) {
    super(message);
  }
}
