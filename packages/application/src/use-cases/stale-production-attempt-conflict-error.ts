export class StaleProductionAttemptConflictError extends Error {
  override readonly name = "StaleProductionAttemptConflictError";
  readonly sceneId: string;
  readonly expectedProductionJobId: string;
  readonly actualProductionJobId: string | undefined;

  constructor(
    sceneId: string,
    expectedProductionJobId: string,
    actualProductionJobId: string | undefined
  ) {
    super(
      `Stale production attempt for scene '${sceneId}': expected job '${expectedProductionJobId}', but current production attempt is '${actualProductionJobId ?? "none"}'.`
    );
    this.sceneId = sceneId;
    this.expectedProductionJobId = expectedProductionJobId;
    this.actualProductionJobId = actualProductionJobId;
  }
}
