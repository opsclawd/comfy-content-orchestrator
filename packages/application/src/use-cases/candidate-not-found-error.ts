export class CandidateNotFoundError extends Error {
  override readonly name = "CandidateNotFoundError";
  readonly candidateId: string;

  constructor(candidateId: string) {
    super(`Candidate '${candidateId}' was not found.`);
    this.candidateId = candidateId;
  }
}
