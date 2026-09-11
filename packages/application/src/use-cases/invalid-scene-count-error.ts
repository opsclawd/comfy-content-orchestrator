export class InvalidSceneCountError extends Error {
  override readonly name = "InvalidSceneCountError";
  readonly sceneCountOverride: number;

  constructor(sceneCountOverride: number) {
    super(
      `Invalid sceneCountOverride '${sceneCountOverride}'. Must be an integer between 1 and 60.`
    );
    this.sceneCountOverride = sceneCountOverride;
  }
}
