export class SceneNotInProductionRunError extends Error {
  override readonly name = "SceneNotInProductionRunError";
  readonly sceneId: string;

  constructor(sceneId: string) {
    super(`Scene '${sceneId}' has no associated campaign production run.`);
    this.sceneId = sceneId;
  }
}
