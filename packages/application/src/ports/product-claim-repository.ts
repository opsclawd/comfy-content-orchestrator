import type {
  BatchId,
  ClaimDecisionEvent,
  ClaimEvidenceLink,
  ClaimId,
  ClientId,
  ProductClaim,
  ProductClaimRevision
} from "@cco/domain";
import type {
  AppendClaimRevisionRequest,
  CreateClaimRequest,
  InvalidateClaimRequest,
  LinkClaimEvidenceRequest,
  ResolveClaimResponse,
  ReviewClaimRequest
} from "@cco/contracts";
import type { CommandEnvelope } from "./product-evidence-repository.js";

export interface ProductClaimCreationResult {
  readonly claim: ProductClaim;
  readonly revision: ProductClaimRevision;
}

export interface ProductClaimRevisionResult {
  readonly claim: ProductClaim;
  readonly revision: ProductClaimRevision;
}

export interface ProductClaimLinkResult {
  readonly claim: ProductClaim;
  readonly links: readonly ClaimEvidenceLink[];
  readonly decisionEvent: ClaimDecisionEvent;
}

export interface ProductClaimReviewResult {
  readonly claim: ProductClaim;
  readonly decisionEvent: ClaimDecisionEvent;
}

export interface ProductClaimRevisionDetail {
  readonly revision: ProductClaimRevision;
  readonly links: readonly ClaimEvidenceLink[];
  readonly decisionEvents: readonly ClaimDecisionEvent[];
}

export interface ProductClaimHistory {
  readonly claim: ProductClaim;
  readonly revisions: readonly ProductClaimRevisionDetail[];
  readonly events: readonly ClaimDecisionEvent[];
}

export interface ProductClaimRepositoryPort {
  createClaim(cmd: CommandEnvelope<CreateClaimRequest>): Promise<ProductClaimCreationResult>;

  appendClaimRevision(
    cmd: CommandEnvelope<AppendClaimRevisionRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimRevisionResult>;

  linkClaimEvidence(
    cmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimLinkResult>;

  reviewClaim(
    cmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimReviewResult>;

  invalidateClaim(
    cmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimReviewResult>;

  getClaimById(clientId: ClientId, claimId: ClaimId): Promise<ProductClaim | null>;

  getClaimRevision(
    clientId: ClientId,
    claimId: ClaimId,
    revision: number
  ): Promise<ProductClaimRevisionDetail | null>;

  getClaimHistory(clientId: ClientId, claimId: ClaimId): Promise<ProductClaimHistory | null>;

  listClaimsForBatch(clientId: ClientId, batchId: BatchId): Promise<readonly ProductClaim[]>;

  resolveClaim(
    clientId: ClientId,
    claimId: ClaimId,
    revision?: number | undefined
  ): Promise<ResolveClaimResponse>;

  getCommandReceipt(
    clientId: ClientId,
    actionId: string
  ): Promise<{
    readonly clientId: ClientId;
    readonly actionId: string;
    readonly commandName: string;
    readonly payloadSha256: string;
    readonly actorId: string;
    readonly responseBody: unknown;
    readonly committedAt: string;
  } | null>;
}
