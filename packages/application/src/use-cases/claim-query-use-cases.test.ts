import { describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClaimId,
  createClientId,
  createEvidenceId,
  createSha256Hex,
  createSkuId,
  createSourceObjectId,
  CrossBatchSourceError,
  NotFoundError,
  type BatchEvidenceLink
} from "@cco/domain";
import type {
  EvidenceAssetRepositoryPort,
  ProductClaimRepositoryPort,
  ProductEvidenceRepositoryPort,
  UnitOfWork,
  UnitOfWorkContext
} from "../ports/index.js";
import { ClaimUseCases } from "./claim-query-use-cases.js";
import type { CreateClaimUseCase } from "./create-claim.js";
import type { AppendClaimRevisionUseCase } from "./append-claim-revision.js";
import type { LinkClaimEvidenceUseCase } from "./link-claim-evidence.js";
import type { ReviewClaimUseCase } from "./review-claim.js";
import type { InvalidateClaimUseCase } from "./invalidate-claim.js";
import type { ResolveClaimUseCase } from "./resolve-claim.js";

describe("ClaimUseCases", () => {
  const clientId = createClientId("11111111-1111-4111-8111-111111111111");
  const batchId = createBatchId("22222222-2222-4222-8222-222222222222");
  const otherBatchId = createBatchId("33333333-3333-4333-8333-333333333333");
  const claimId = createClaimId("44444444-4444-4444-8444-444444444444");
  const otherClaimId = createClaimId("55555555-5555-4555-8555-555555555555");
  const validEvidenceId = createEvidenceId("66666666-6666-4666-8666-666666666666");

  const mockBatch = {
    clientId,
    batchId,
    skuId: createSkuId("77777777-7777-4777-8777-777777777777"),
    lotIdentifier: "LOT-001",
    displayName: "Lot 001",
    version: 1,
    currentFactsRevision: 1,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockClaimInBatch = {
    clientId,
    claimId,
    skuId: createSkuId("77777777-7777-4777-8777-777777777777"),
    batchId,
    currentRevision: 1,
    state: "draft" as const,
    version: 1,
    invalidationCause: null,
    invalidationSourceRef: null,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockClaimInOtherBatch = {
    clientId,
    claimId: otherClaimId,
    skuId: createSkuId("77777777-7777-4777-8777-777777777777"),
    batchId: otherBatchId,
    currentRevision: 1,
    state: "draft" as const,
    version: 1,
    invalidationCause: null,
    invalidationSourceRef: null,
    createdAt: "2026-10-21T12:00:00.000Z",
    updatedAt: "2026-10-21T12:00:00.000Z",
    archivedAt: null
  };

  const mockRevDetail = {
    revision: {
      clientId,
      claimId,
      revision: 1,
      batchId,
      canonicalKind: "unsupported_manual" as const,
      proofCategory: "human_attested_unverified" as const,
      parameters: {
        kind: "unsupported_manual" as const,
        proposedText: "Some text",
        categoryOrReason: "manual"
      },
      displayWording: null,
      policyVersion: "claim_policy_v1",
      assertedBy: "user-1",
      assertedAt: "2026-10-21T12:00:00.000Z",
      supersedesRevision: null
    },
    links: [],
    decisionEvents: []
  };

  const createDeps = () => {
    const productEvidenceRepo: Partial<ProductEvidenceRepositoryPort> = {
      getBatchById: vi.fn(async (_cId, bId) => (bId === batchId ? mockBatch : null))
    };

    const claimRepo: Partial<ProductClaimRepositoryPort> = {
      getClaimById: vi.fn(async (_cId, cClaimId) => {
        if (cClaimId === claimId) return mockClaimInBatch;
        if (cClaimId === otherClaimId) return mockClaimInOtherBatch;
        return null;
      }),
      getClaimRevision: vi.fn(async (_cId, cClaimId, rev) =>
        cClaimId === claimId && rev === 1 ? mockRevDetail : null
      ),
      listClaimsForBatch: vi.fn(async () => [mockClaimInBatch])
    };

    const evidenceAssetRepo: Partial<EvidenceAssetRepositoryPort> = {
      getBatchEvidenceLink: vi.fn(async (_cId, bId, eId, _rev) =>
        bId === batchId && eId === validEvidenceId ? ({} as unknown as BatchEvidenceLink) : null
      )
    };

    const uow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          productEvidence: productEvidenceRepo as ProductEvidenceRepositoryPort,
          productClaims: claimRepo as ProductClaimRepositoryPort,
          evidenceAsset: evidenceAssetRepo as EvidenceAssetRepositoryPort
        } as unknown as UnitOfWorkContext)
      )
    };

    const createClaimUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<CreateClaimUseCase["execute"]>)
    } as unknown as CreateClaimUseCase;
    const appendClaimRevisionUseCase = {
      execute: vi.fn(
        async () => ({}) as unknown as ReturnType<AppendClaimRevisionUseCase["execute"]>
      )
    } as unknown as AppendClaimRevisionUseCase;
    const linkClaimEvidenceUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<LinkClaimEvidenceUseCase["execute"]>)
    } as unknown as LinkClaimEvidenceUseCase;
    const reviewClaimUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<ReviewClaimUseCase["execute"]>)
    } as unknown as ReviewClaimUseCase;
    const invalidateClaimUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<InvalidateClaimUseCase["execute"]>)
    } as unknown as InvalidateClaimUseCase;
    const resolveClaimUseCase = {
      execute: vi.fn(async () => ({}) as unknown as ReturnType<ResolveClaimUseCase["execute"]>)
    } as unknown as ResolveClaimUseCase;

    const reviewerAuth = {
      assertCanReviewCoaReport: vi.fn(),
      assertCanReviewClaim: vi.fn(async (_c, actorId) => {
        if (actorId === "unauthorized") {
          throw new AccessDeniedError("Unauthorized claim reviewer");
        }
      }),
      assertCanVerifyEvidence: vi.fn()
    };

    return {
      uow,
      createClaimUseCase,
      appendClaimRevisionUseCase,
      linkClaimEvidenceUseCase,
      reviewClaimUseCase,
      invalidateClaimUseCase,
      resolveClaimUseCase,
      reviewerAuth
    };
  };

  it("throws NotFoundError when route batch does not exist", async () => {
    const deps = createDeps();
    const useCases = new ClaimUseCases(
      deps.uow,
      deps.createClaimUseCase,
      deps.appendClaimRevisionUseCase,
      deps.linkClaimEvidenceUseCase,
      deps.reviewClaimUseCase,
      deps.invalidateClaimUseCase,
      deps.resolveClaimUseCase,
      deps.reviewerAuth
    );

    await expect(useCases.getClaimById(clientId, otherBatchId, claimId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws NotFoundError when claim belongs to another batch (prevent cross-lot disclosure)", async () => {
    const deps = createDeps();
    const useCases = new ClaimUseCases(
      deps.uow,
      deps.createClaimUseCase,
      deps.appendClaimRevisionUseCase,
      deps.linkClaimEvidenceUseCase,
      deps.reviewClaimUseCase,
      deps.invalidateClaimUseCase,
      deps.resolveClaimUseCase,
      deps.reviewerAuth
    );

    // otherClaimId exists for this client, but in otherBatchId!
    await expect(useCases.getClaimById(clientId, batchId, otherClaimId)).rejects.toThrow(
      NotFoundError
    );
  });

  it("throws CrossBatchSourceError when linking evidence from another batch", async () => {
    const deps = createDeps();
    const useCases = new ClaimUseCases(
      deps.uow,
      deps.createClaimUseCase,
      deps.appendClaimRevisionUseCase,
      deps.linkClaimEvidenceUseCase,
      deps.reviewClaimUseCase,
      deps.invalidateClaimUseCase,
      deps.resolveClaimUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.linkClaimEvidence(clientId, batchId, claimId, {
        actionId: createActionId("018f6f00-0000-7000-8000-000000000001"),
        clientId,
        actorId: "actor-1",
        timestamp: "2026-10-21T12:00:00.000Z",
        payload: {
          claimId,
          expectedVersion: 1,
          claimRevision: 1,
          reason: "link",
          links: [
            {
              evidenceId: createEvidenceId("018f6f00-0000-7000-8000-000000000099"),
              evidenceRevision: 1,
              sourceObjectId: createSourceObjectId("018f6f00-0000-7000-8000-000000000098"),
              sourceSha256: createSha256Hex(
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
              ),
              supportRole: "corroborating_record"
            }
          ]
        }
      })
    ).rejects.toThrow(CrossBatchSourceError);
  });

  it("throws AccessDeniedError when reviewer is not authorized to review claim", async () => {
    const deps = createDeps();
    const useCases = new ClaimUseCases(
      deps.uow,
      deps.createClaimUseCase,
      deps.appendClaimRevisionUseCase,
      deps.linkClaimEvidenceUseCase,
      deps.reviewClaimUseCase,
      deps.invalidateClaimUseCase,
      deps.resolveClaimUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.reviewClaim(clientId, batchId, claimId, {
        actionId: createActionId("018f6f00-0000-7000-8000-000000000002"),
        clientId,
        actorId: "unauthorized",
        timestamp: "2026-10-21T12:00:00.000Z",
        payload: {
          claimId,
          expectedVersion: 1,
          claimRevision: 1,
          decision: "approve",
          reason: "Looks good"
        }
      })
    ).rejects.toThrow(AccessDeniedError);
  });

  it("throws AccessDeniedError when actor is not authorized to invalidate claim", async () => {
    const deps = createDeps();
    const useCases = new ClaimUseCases(
      deps.uow,
      deps.createClaimUseCase,
      deps.appendClaimRevisionUseCase,
      deps.linkClaimEvidenceUseCase,
      deps.reviewClaimUseCase,
      deps.invalidateClaimUseCase,
      deps.resolveClaimUseCase,
      deps.reviewerAuth
    );

    await expect(
      useCases.invalidateClaim(clientId, batchId, claimId, {
        actionId: createActionId("018f6f00-0000-7000-8000-000000000003"),
        clientId,
        actorId: "unauthorized",
        timestamp: "2026-10-21T12:00:00.000Z",
        payload: {
          claimId,
          actionId: "018f6f00-0000-7000-8000-000000000003",
          expectedVersion: 1,
          claimRevision: 1,
          invalidationCause: "source_superseded",
          reason: "Invalidate reason"
        }
      })
    ).rejects.toThrow(AccessDeniedError);
  });
});
