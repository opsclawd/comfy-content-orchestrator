import { describe, expect, it } from "vitest";
import {
  AcceptedAttemptIdentityMismatchError,
  AcceptedAttemptOrdinalMismatchError,
  AcceptedAttemptRecordMissingError,
  AcceptedAttemptRevisionMismatchError,
  AcceptedAttemptSceneOrRunMismatchError,
  AcceptedProductionAttemptInvariantError,
  AssemblyDurationMismatchError,
  MissingAcceptedProductionManifestError
} from "./accepted-production-attempt-invariant.js";

describe("Accepted production attempt invariant errors", () => {
  it("AcceptedAttemptRecordMissingError carries context and inherits base", () => {
    const error = new AcceptedAttemptRecordMissingError("run-1", "scene-1", "job-1");
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AcceptedAttemptRecordMissingError");
    expect(error.code).toBe("accepted_attempt_record_missing");
    expect(error.runId).toBe("run-1");
    expect(error.sceneId).toBe("scene-1");
    expect(error.acceptedProductionJobId).toBe("job-1");
    expect(error.message).toContain("job-1");
  });

  it("AcceptedAttemptIdentityMismatchError carries context and expected/actual ids", () => {
    const error = new AcceptedAttemptIdentityMismatchError(
      "run-1",
      "scene-1",
      "attempt-1",
      "attempt-2"
    );
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error.name).toBe("AcceptedAttemptIdentityMismatchError");
    expect(error.code).toBe("accepted_attempt_identity_mismatch");
    expect(error.expectedAttemptId).toBe("attempt-1");
    expect(error.actualAttemptId).toBe("attempt-2");
  });

  it("AcceptedAttemptSceneOrRunMismatchError carries attempt scene and run id", () => {
    const error = new AcceptedAttemptSceneOrRunMismatchError("run-1", "scene-1", {
      sceneId: "scene-2",
      runId: "run-2"
    });
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error.name).toBe("AcceptedAttemptSceneOrRunMismatchError");
    expect(error.code).toBe("accepted_attempt_scene_or_run_mismatch");
    expect(error.runId).toBe("run-1");
    expect(error.sceneId).toBe("scene-1");
    expect(error.attemptSceneId).toBe("scene-2");
    expect(error.attemptRunId).toBe("run-2");
  });

  it("AcceptedAttemptRevisionMismatchError carries revisions", () => {
    const error = new AcceptedAttemptRevisionMismatchError("run-1", "scene-1", 1, 2);
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error.name).toBe("AcceptedAttemptRevisionMismatchError");
    expect(error.code).toBe("accepted_attempt_revision_mismatch");
    expect(error.expectedSpecRevision).toBe(1);
    expect(error.actualSpecRevision).toBe(2);
  });

  it("AcceptedAttemptOrdinalMismatchError carries ordinals", () => {
    const error = new AcceptedAttemptOrdinalMismatchError("run-1", "scene-1", 1, 2);
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error.name).toBe("AcceptedAttemptOrdinalMismatchError");
    expect(error.code).toBe("accepted_attempt_ordinal_mismatch");
    expect(error.expectedOrdinal).toBe(1);
    expect(error.actualOrdinal).toBe(2);
  });

  it("MissingAcceptedProductionManifestError carries job and scene info", () => {
    const error = new MissingAcceptedProductionManifestError("run-1", "scene-1", "job-1");
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error.name).toBe("MissingAcceptedProductionManifestError");
    expect(error.code).toBe("missing_accepted_production_manifest");
    expect(error.acceptedProductionJobId).toBe("job-1");
  });

  it("AssemblyDurationMismatchError carries duration details", () => {
    const error = new AssemblyDurationMismatchError("run-1", 5000, 4000);
    expect(error).toBeInstanceOf(AcceptedProductionAttemptInvariantError);
    expect(error.name).toBe("AssemblyDurationMismatchError");
    expect(error.code).toBe("assembly_duration_mismatch");
    expect(error.expectedTotalDurationMs).toBe(5000);
    expect(error.computedSumMs).toBe(4000);
  });
});
