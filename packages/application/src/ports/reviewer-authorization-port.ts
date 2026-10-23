import { AccessDeniedError, type ClientId } from "@cco/domain";

export interface ReviewerAuthorizationPort {
  assertCanReviewCoaReport(clientId: ClientId, actorId: string): Promise<void>;
  assertCanReviewClaim(clientId: ClientId, actorId: string): Promise<void>;
  assertCanVerifyEvidence(clientId: ClientId, actorId: string): Promise<void>;
}

export class DenyAllReviewerAuthorizationAdapter implements ReviewerAuthorizationPort {
  async assertCanReviewCoaReport(_clientId: ClientId, actorId: string): Promise<void> {
    throw new AccessDeniedError(
      `Reviewer authorization unavailable: actor "${actorId}" is not authorized to review CoA reports.`
    );
  }

  async assertCanReviewClaim(_clientId: ClientId, actorId: string): Promise<void> {
    throw new AccessDeniedError(
      `Reviewer authorization unavailable: actor "${actorId}" is not authorized to review product claims.`
    );
  }

  async assertCanVerifyEvidence(_clientId: ClientId, actorId: string): Promise<void> {
    throw new AccessDeniedError(
      `Reviewer authorization unavailable: actor "${actorId}" is not authorized to verify evidence.`
    );
  }
}

export class AllowAllReviewerAuthorizationAdapter implements ReviewerAuthorizationPort {
  async assertCanReviewCoaReport(_clientId: ClientId, _actorId: string): Promise<void> {
    // Permissive adapter for testing only
  }

  async assertCanReviewClaim(_clientId: ClientId, _actorId: string): Promise<void> {
    // Permissive adapter for testing only
  }

  async assertCanVerifyEvidence(_clientId: ClientId, _actorId: string): Promise<void> {
    // Permissive adapter for testing only
  }
}
