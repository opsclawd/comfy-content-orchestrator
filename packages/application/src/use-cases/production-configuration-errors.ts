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
