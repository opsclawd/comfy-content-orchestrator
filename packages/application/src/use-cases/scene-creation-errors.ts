export class SceneCreationModeMismatchError extends Error {
  override readonly name = "SceneCreationModeMismatchError";

  constructor(message: string) {
    super(message);
  }
}

export class PlanningProviderNotConfiguredError extends Error {
  override readonly name = "PlanningProviderNotConfiguredError";

  constructor(
    message = "Cloud planning is required for this client but no planning provider is configured."
  ) {
    super(message);
  }
}
