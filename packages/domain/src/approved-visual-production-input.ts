import type { CandidateId, SceneId, SceneSnapshot } from "./scene.js";
import type { StoryboardCandidate } from "./storyboard-candidate.js";

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export interface ApprovedVisualProductionInput {
  readonly candidateId: CandidateId;
  readonly sceneId: SceneId;
  readonly specRevision: number;
  readonly contentHashSha256: string;
}

export abstract class ApprovedVisualProductionInputInvariantError extends Error {
  abstract readonly code: string;
}

export class InvalidApprovedVisualProductionInputError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "InvalidApprovedVisualProductionInputError";
  readonly code = "invalid_approved_visual_production_input";
  readonly candidateId: CandidateId;
  readonly reason: string;
  readonly contentHash?: string | undefined;

  constructor(candidateId: CandidateId, reason: string, contentHash?: string) {
    super(`Candidate '${candidateId}' cannot create approved visual production input: ${reason}`);
    this.candidateId = candidateId;
    this.reason = reason;
    this.contentHash = contentHash;
  }
}

export class MissingCandidateSelectionError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "MissingCandidateSelectionError";
  readonly code = "missing_candidate_selection";
  readonly sceneId: SceneId;
  readonly selectedCandidateId?: CandidateId | undefined;
  readonly selectedCandidateRevision?: number | undefined;

  constructor(
    sceneId: SceneId,
    selectedCandidateId?: CandidateId | undefined,
    selectedCandidateRevision?: number | undefined,
    message?: string
  ) {
    super(
      message ??
        `Scene '${sceneId}' is missing an approved candidate selection (selectedCandidateId=${selectedCandidateId ?? "undefined"}, selectedCandidateRevision=${selectedCandidateRevision ?? "undefined"}).`
    );
    this.sceneId = sceneId;
    this.selectedCandidateId = selectedCandidateId;
    this.selectedCandidateRevision = selectedCandidateRevision;
  }
}

export class CandidateIdentityMismatchError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "CandidateIdentityMismatchError";
  readonly code = "candidate_identity_mismatch";
  readonly candidateId: CandidateId;
  readonly expectedCandidateId?: CandidateId | string | undefined;
  readonly sceneId?: SceneId | undefined;
  readonly source?: "scene" | "job" | undefined;

  constructor(
    candidateId: CandidateId,
    expectedCandidateId?: CandidateId | string | undefined,
    sceneId?: SceneId | undefined,
    source?: "scene" | "job" | undefined,
    message?: string
  ) {
    const sourceDetail = source ? ` (source: ${source})` : "";
    super(
      message ??
        `Candidate identity mismatch: candidate '${candidateId}' does not match expected candidate '${expectedCandidateId ?? "undefined"}' for scene '${sceneId ?? "unknown"}'${sourceDetail}.`
    );
    this.candidateId = candidateId;
    this.expectedCandidateId = expectedCandidateId;
    this.sceneId = sceneId;
    this.source = source;
  }
}

export class CandidateSceneMismatchError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "CandidateSceneMismatchError";
  readonly code = "candidate_scene_mismatch";
  readonly candidateId: CandidateId;
  readonly sceneId: SceneId;
  readonly mismatchedSceneId?: SceneId | string | undefined;
  readonly candidateSceneId?: SceneId | string | undefined;
  readonly jobSceneId?: SceneId | string | undefined;
  readonly source: "candidate" | "job";

  constructor(
    candidateId: CandidateId,
    sceneId: SceneId,
    mismatchedSceneId?: SceneId | string | undefined,
    source: "candidate" | "job" = "candidate",
    message?: string
  ) {
    const sourceDetail = ` (source: ${source})`;
    super(
      message ??
        `Candidate scene mismatch: candidate '${candidateId}' bound to scene '${mismatchedSceneId ?? "undefined"}' does not match scene '${sceneId}'${sourceDetail}.`
    );
    this.candidateId = candidateId;
    this.sceneId = sceneId;
    this.mismatchedSceneId = mismatchedSceneId;
    this.source = source;
    if (source === "candidate") {
      this.candidateSceneId = mismatchedSceneId;
    } else {
      this.jobSceneId = mismatchedSceneId;
    }
  }
}

export class StaleCandidateRevisionError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "StaleCandidateRevisionError";
  readonly code = "stale_candidate_revision";
  readonly candidateId: CandidateId;
  readonly sceneId: SceneId;
  readonly candidateRevision: number;
  readonly sceneRevision: number;

  constructor(
    candidateId: CandidateId,
    sceneId: SceneId,
    candidateRevision: number,
    sceneRevision: number,
    message?: string
  ) {
    super(
      message ??
        `Candidate '${candidateId}' revision ${candidateRevision} is stale; current scene '${sceneId}' revision is ${sceneRevision}.`
    );
    this.candidateId = candidateId;
    this.sceneId = sceneId;
    this.candidateRevision = candidateRevision;
    this.sceneRevision = sceneRevision;
  }
}

export class SelectedCandidateRevisionMismatchError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "SelectedCandidateRevisionMismatchError";
  readonly code = "selected_candidate_revision_mismatch";
  readonly candidateId: CandidateId;
  readonly sceneId: SceneId;
  readonly candidateRevision: number;
  readonly selectedCandidateRevision: number;

  constructor(
    candidateId: CandidateId,
    sceneId: SceneId,
    candidateRevision: number,
    selectedCandidateRevision: number,
    message?: string
  ) {
    super(
      message ??
        `Scene '${sceneId}' selected candidate revision ${selectedCandidateRevision} does not match candidate '${candidateId}' revision ${candidateRevision}.`
    );
    this.candidateId = candidateId;
    this.sceneId = sceneId;
    this.candidateRevision = candidateRevision;
    this.selectedCandidateRevision = selectedCandidateRevision;
  }
}

export class ApprovalRevisionMismatchError extends ApprovedVisualProductionInputInvariantError {
  override readonly name = "ApprovalRevisionMismatchError";
  readonly code = "approval_revision_mismatch";
  readonly candidateId: CandidateId;
  readonly sceneId: SceneId;
  readonly candidateRevision: number;
  readonly approvalRevision?: number | undefined;

  constructor(
    candidateId: CandidateId,
    sceneId: SceneId,
    candidateRevision: number,
    approvalRevision?: number | undefined,
    message?: string
  ) {
    super(
      message ??
        (approvalRevision === undefined
          ? `Scene '${sceneId}' has no approval record for candidate '${candidateId}' revision ${candidateRevision}.`
          : `Scene '${sceneId}' approval revision ${approvalRevision} does not match candidate '${candidateId}' revision ${candidateRevision}.`)
    );
    this.candidateId = candidateId;
    this.sceneId = sceneId;
    this.candidateRevision = candidateRevision;
    this.approvalRevision = approvalRevision;
  }
}

export function createApprovedVisualProductionInput(
  candidate: StoryboardCandidate
): ApprovedVisualProductionInput {
  if (!SHA256_HEX_PATTERN.test(candidate.contentHash)) {
    throw new InvalidApprovedVisualProductionInputError(
      candidate.id,
      `Candidate contentHash '${candidate.contentHash}' is not a valid lowercase 64-character hexadecimal SHA-256 hash.`,
      candidate.contentHash
    );
  }

  return Object.freeze({
    candidateId: candidate.id,
    sceneId: candidate.sceneId,
    specRevision: candidate.specRevision,
    contentHashSha256: candidate.contentHash
  });
}

export function verifyApprovedVisualProductionInput(params: {
  readonly candidate: StoryboardCandidate;
  readonly scene: SceneSnapshot;
  readonly job?:
    | {
        readonly approvedCandidateId?: CandidateId | string | undefined;
        readonly sceneId?: SceneId | string | undefined;
      }
    | undefined;
}): ApprovedVisualProductionInput {
  const { candidate, scene, job } = params;

  // 1. Missing candidate selection
  if (scene.selectedCandidateId === undefined || scene.selectedCandidateRevision === undefined) {
    throw new MissingCandidateSelectionError(
      scene.id,
      scene.selectedCandidateId,
      scene.selectedCandidateRevision
    );
  }

  // 2. Scene selected candidate ID mismatch
  if (scene.selectedCandidateId !== candidate.id) {
    throw new CandidateIdentityMismatchError(
      candidate.id,
      scene.selectedCandidateId,
      scene.id,
      "scene"
    );
  }

  // 3. Job approved candidate ID mismatch (if job supplied)
  if (job !== undefined && job.approvedCandidateId !== candidate.id) {
    throw new CandidateIdentityMismatchError(
      candidate.id,
      job.approvedCandidateId,
      scene.id,
      "job"
    );
  }

  // 4. Candidate scene mismatch
  if (candidate.sceneId !== scene.id) {
    throw new CandidateSceneMismatchError(candidate.id, scene.id, candidate.sceneId, "candidate");
  }

  // 5. Job scene mismatch (if job supplied and job.sceneId present)
  if (job !== undefined && job.sceneId !== undefined && job.sceneId !== scene.id) {
    throw new CandidateSceneMismatchError(candidate.id, scene.id, job.sceneId, "job");
  }

  // 6. Stale candidate revision
  if (candidate.specRevision !== scene.specRevision) {
    throw new StaleCandidateRevisionError(
      candidate.id,
      scene.id,
      candidate.specRevision,
      scene.specRevision
    );
  }

  // 7. Selected candidate revision mismatch
  if (scene.selectedCandidateRevision !== candidate.specRevision) {
    throw new SelectedCandidateRevisionMismatchError(
      candidate.id,
      scene.id,
      candidate.specRevision,
      scene.selectedCandidateRevision
    );
  }

  // 8. Approval revision mismatch
  if (scene.approval === undefined || scene.approval.revision !== candidate.specRevision) {
    throw new ApprovalRevisionMismatchError(
      candidate.id,
      scene.id,
      candidate.specRevision,
      scene.approval?.revision
    );
  }

  // 9. Validated identity mapping
  return createApprovedVisualProductionInput(candidate);
}
