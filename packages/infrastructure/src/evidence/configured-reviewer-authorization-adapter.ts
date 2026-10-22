import { AccessDeniedError, type ClientId } from "@cco/domain";
import type { ReviewerAuthorizationPort } from "@cco/application";

export interface ClientReviewerGrants {
  readonly coaReviewers?: readonly string[];
  readonly claimReviewers?: readonly string[];
  readonly evidenceVerifiers?: readonly string[];
}

export type ReviewerAuthorizationGrants = Readonly<Record<string, ClientReviewerGrants>>;

export class ConfiguredReviewerAuthorizationAdapter implements ReviewerAuthorizationPort {
  constructor(private readonly grants: ReviewerAuthorizationGrants = {}) {}

  async assertCanReviewCoaReport(clientId: ClientId, actorId: string): Promise<void> {
    const clientGrants = this.grants[clientId];
    if (!clientGrants?.coaReviewers || !clientGrants.coaReviewers.includes(actorId)) {
      throw new AccessDeniedError(
        `Reviewer authorization denied: actor "${actorId}" is not authorized to review CoA reports for client "${clientId}".`
      );
    }
  }

  async assertCanReviewClaim(clientId: ClientId, actorId: string): Promise<void> {
    const clientGrants = this.grants[clientId];
    if (!clientGrants?.claimReviewers || !clientGrants.claimReviewers.includes(actorId)) {
      throw new AccessDeniedError(
        `Reviewer authorization denied: actor "${actorId}" is not authorized to review product claims for client "${clientId}".`
      );
    }
  }

  async assertCanVerifyEvidence(clientId: ClientId, actorId: string): Promise<void> {
    const clientGrants = this.grants[clientId];
    if (!clientGrants?.evidenceVerifiers || !clientGrants.evidenceVerifiers.includes(actorId)) {
      throw new AccessDeniedError(
        `Reviewer authorization denied: actor "${actorId}" is not authorized to verify evidence for client "${clientId}".`
      );
    }
  }
}
