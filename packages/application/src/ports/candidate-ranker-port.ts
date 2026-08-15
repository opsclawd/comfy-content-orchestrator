export interface CandidateRankerPort<TCandidate, TContext> {
  rank(candidates: readonly TCandidate[], context: TContext): Promise<readonly TCandidate[]>;
}
