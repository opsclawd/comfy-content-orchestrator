export class SceneNotFoundError extends Error {
  override readonly name = "SceneNotFoundError";
  readonly sceneId: string;

  constructor(sceneId: string) {
    super(`Scene '${sceneId}' was not found.`);
    this.sceneId = sceneId;
  }
}
