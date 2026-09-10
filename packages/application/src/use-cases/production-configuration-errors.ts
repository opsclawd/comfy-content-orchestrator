export class UnrepresentableProductionConfigurationError extends Error {
  override readonly name = "UnrepresentableProductionConfigurationError";
  readonly sceneId: string;
  readonly unrepresentableFields: readonly string[];

  constructor(sceneId: string, unrepresentableFields: readonly string[], message?: string) {
    super(
      message ??
        `Scene '${sceneId}' configuration contains fields unrepresentable by the production profile: ${unrepresentableFields.join(", ")}`
    );
    this.sceneId = sceneId;
    this.unrepresentableFields = Object.freeze([...unrepresentableFields]);
  }
}

export class ConditionedProductionProfileUnavailableError extends Error {
  override readonly name = "ConditionedProductionProfileUnavailableError";
  readonly sceneId: string;
  readonly profileKey: string;

  constructor(sceneId: string, profileKey: string, message?: string) {
    super(
      message ??
        `Scene '${sceneId}' requires conditioned production profile '${profileKey}', but its injection topology is unavailable`
    );
    this.sceneId = sceneId;
    this.profileKey = profileKey;
  }
}
