export class StaleRevisionConflictError extends Error {
  override readonly name = "StaleRevisionConflictError";
  readonly sceneId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(sceneId: string, expectedRevision: number, actualRevision: number) {
    super(
      `Stale revision conflict for scene '${sceneId}': expected spec revision ${expectedRevision}, but current revision is ${actualRevision}.`
    );
    this.sceneId = sceneId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
