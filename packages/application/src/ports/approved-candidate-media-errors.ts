import type { ApprovedVisualProductionInput, CandidateId } from "@cco/domain";
import type { PersistentMediaRef } from "@cco/contracts";

export type ApprovedCandidateMediaUnavailableReason =
  "missing" | "unreadable" | "corrupt" | "unsupported_content_type";

export class ApprovedCandidateMediaUnavailableError extends Error {
  override readonly name = "ApprovedCandidateMediaUnavailableError";
  readonly candidateId: CandidateId;
  readonly reason: ApprovedCandidateMediaUnavailableReason;

  constructor(
    candidateId: CandidateId,
    reason: ApprovedCandidateMediaUnavailableReason,
    options?: ErrorOptions
  ) {
    super(
      `Approved candidate media for candidate '${candidateId}' is unavailable: ${reason}`,
      options
    );
    this.candidateId = candidateId;
    this.reason = reason;
  }
}

export class ApprovedCandidateMediaHashMismatchError extends Error {
  override readonly name = "ApprovedCandidateMediaHashMismatchError";
  readonly candidateId: CandidateId;
  readonly expectedSha256: string;
  readonly actualSha256: string;

  constructor(
    candidateId: CandidateId,
    expectedSha256: string,
    actualSha256: string,
    options?: ErrorOptions
  ) {
    super(
      `Approved candidate media hash mismatch for candidate '${candidateId}': expected SHA-256 '${expectedSha256}', got '${actualSha256}'`,
      options
    );
    this.candidateId = candidateId;
    this.expectedSha256 = expectedSha256;
    this.actualSha256 = actualSha256;
  }
}

export interface ResolvedApprovedVisualProductionMedia {
  readonly input: ApprovedVisualProductionInput;
  readonly media: PersistentMediaRef;
}
