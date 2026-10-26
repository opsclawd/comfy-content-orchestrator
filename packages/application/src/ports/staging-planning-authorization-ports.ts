import type {
  H3CandidateAuthorizationGrant,
  StagingCandidateProfileSelection
} from "@cco/contracts";

export interface StagingPlanningAuthorizationSource {
  listAuthorizedCandidates(
    principal?: string
  ): Promise<readonly StagingCandidateProfileSelection[]>;
  resolveCandidateGrant(
    authorizationId: string,
    targetId: string,
    candidateProfileKey?: string
  ): Promise<H3CandidateAuthorizationGrant | undefined>;
}
