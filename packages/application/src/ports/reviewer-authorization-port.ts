import { AccessDeniedError, type ClientId } from "@cco/domain";

export interface ReviewerAuthorizationPort {
  assertCanReviewCoaReport(clientId: ClientId, actorId: string): Promise<void>;
}

export class DenyAllReviewerAuthorizationAdapter implements ReviewerAuthorizationPort {
  async assertCanReviewCoaReport(_clientId: ClientId, actorId: string): Promise<void> {
    throw new AccessDeniedError(
      `Reviewer authorization unavailable: actor "${actorId}" is not authorized to review CoA reports.`
    );
  }
}

export class AllowAllReviewerAuthorizationAdapter implements ReviewerAuthorizationPort {
  async assertCanReviewCoaReport(_clientId: ClientId, _actorId: string): Promise<void> {
    // Permissive adapter for testing only
  }
}
