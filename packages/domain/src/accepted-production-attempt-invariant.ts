export abstract class AcceptedProductionAttemptInvariantError extends Error {
  abstract readonly code: string;
}

export class AcceptedAttemptRecordMissingError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "AcceptedAttemptRecordMissingError";
  readonly code = "accepted_attempt_record_missing";
  readonly runId: string;
  readonly sceneId: string;
  readonly acceptedProductionJobId: string;

  constructor(runId: string, sceneId: string, acceptedProductionJobId: string, message?: string) {
    super(
      message ??
        `Production attempt record missing for accepted job '${acceptedProductionJobId}' on scene '${sceneId}' in run '${runId}'.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.acceptedProductionJobId = acceptedProductionJobId;
  }
}

export class AcceptedAttemptIdentityMismatchError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "AcceptedAttemptIdentityMismatchError";
  readonly code = "accepted_attempt_identity_mismatch";
  readonly runId: string;
  readonly sceneId: string;
  readonly expectedAttemptId: string;
  readonly actualAttemptId: string;

  constructor(
    runId: string,
    sceneId: string,
    expectedAttemptId: string,
    actualAttemptId: string,
    message?: string
  ) {
    super(
      message ??
        `Accepted attempt identity mismatch: expected attempt '${expectedAttemptId}' but resolved attempt '${actualAttemptId}' for scene '${sceneId}' in run '${runId}'.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.expectedAttemptId = expectedAttemptId;
    this.actualAttemptId = actualAttemptId;
  }
}

export class AcceptedAttemptSceneOrRunMismatchError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "AcceptedAttemptSceneOrRunMismatchError";
  readonly code = "accepted_attempt_scene_or_run_mismatch";
  readonly runId: string;
  readonly sceneId: string;
  readonly attemptSceneId: string;
  readonly attemptRunId?: string | undefined;

  constructor(
    runId: string,
    sceneId: string,
    attempt: { readonly sceneId: string; readonly runId?: string | undefined },
    message?: string
  ) {
    super(
      message ??
        `Accepted attempt cross-scene or cross-run mismatch: expected scene '${sceneId}' in run '${runId}', but attempt belongs to scene '${attempt.sceneId}' in run '${attempt.runId ?? "undefined"}'.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.attemptSceneId = attempt.sceneId;
    this.attemptRunId = attempt.runId;
  }
}

export class AcceptedAttemptRevisionMismatchError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "AcceptedAttemptRevisionMismatchError";
  readonly code = "accepted_attempt_revision_mismatch";
  readonly runId: string;
  readonly sceneId: string;
  readonly expectedSpecRevision: number;
  readonly actualSpecRevision: number;

  constructor(
    runId: string,
    sceneId: string,
    expectedSpecRevision: number,
    actualSpecRevision: number,
    message?: string
  ) {
    super(
      message ??
        `Accepted attempt revision mismatch: scene '${sceneId}' expected revision ${expectedSpecRevision}, but attempt has revision ${actualSpecRevision} in run '${runId}'.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.expectedSpecRevision = expectedSpecRevision;
    this.actualSpecRevision = actualSpecRevision;
  }
}

export class AcceptedAttemptOrdinalMismatchError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "AcceptedAttemptOrdinalMismatchError";
  readonly code = "accepted_attempt_ordinal_mismatch";
  readonly runId: string;
  readonly sceneId: string;
  readonly expectedOrdinal: number;
  readonly actualOrdinal: number;

  constructor(
    runId: string,
    sceneId: string,
    expectedOrdinal: number,
    actualOrdinal: number,
    message?: string
  ) {
    super(
      message ??
        `Accepted attempt ordinal mismatch: scene '${sceneId}' in run '${runId}' expected ordinal ${expectedOrdinal}, but attempt has ordinal ${actualOrdinal}.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.expectedOrdinal = expectedOrdinal;
    this.actualOrdinal = actualOrdinal;
  }
}

export class MissingAcceptedProductionManifestError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "MissingAcceptedProductionManifestError";
  readonly code = "missing_accepted_production_manifest";
  readonly runId: string;
  readonly sceneId: string;
  readonly acceptedProductionJobId: string;

  constructor(runId: string, sceneId: string, acceptedProductionJobId: string, message?: string) {
    super(
      message ??
        `Generation manifest missing for accepted production job '${acceptedProductionJobId}' on scene '${sceneId}' in run '${runId}'.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.acceptedProductionJobId = acceptedProductionJobId;
  }
}

export class AssemblyDurationMismatchError extends AcceptedProductionAttemptInvariantError {
  override readonly name = "AssemblyDurationMismatchError";
  readonly code = "assembly_duration_mismatch";
  readonly runId: string;
  readonly expectedTotalDurationMs: number;
  readonly computedSumMs: number;

  constructor(
    runId: string,
    expectedTotalDurationMs: number,
    computedSumMs: number,
    message?: string
  ) {
    super(
      message ??
        `Assembly duration mismatch for run '${runId}': declared total duration is ${expectedTotalDurationMs}ms, but computed sum of scene durations is ${computedSumMs}ms.`
    );
    this.runId = runId;
    this.expectedTotalDurationMs = expectedTotalDurationMs;
    this.computedSumMs = computedSumMs;
  }
}
