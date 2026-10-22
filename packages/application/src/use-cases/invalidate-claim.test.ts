import { describe, expect, it, vi } from "vitest";
import { generateUuidV7 } from "@cco/shared";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClaimId,
  createClientId,
  createSkuId,
  ProductValidationError,
  type ClaimDecisionEvent,
  type ClaimDecisionEventId,
  type ProductClaim
} from "@cco/domain";
import type { InvalidateClaimRequest } from "@cco/contracts";
import type { ProductClaimRepositoryPort, UnitOfWork, UnitOfWorkContext } from "../ports/index.js";
import { InvalidateClaimUseCase } from "./invalidate-claim.js";

describe("InvalidateClaimUseCase", () => {
  const clientId = createClientId("11111111-1111-4111-8111-111111111111");
  const claimId = createClaimId("22222222-2222-4222-8222-222222222222");
  const actionId = generateUuidV7();
  const now = "2026-10-21T12:00:00.000Z";

  const mockClaim: ProductClaim = {
    clientId,
    claimId,
    skuId: createSkuId("44444444-4444-4444-8444-444444444444"),
    batchId: createBatchId("55555555-5555-4555-8555-555555555555"),
    currentRevision: 1,
    state: "invalidated",
    version: 2,
    invalidationCause: "source_superseded",
    invalidationSourceRef: "ref-1",
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  };

  const mockDecisionEvent: ClaimDecisionEvent = {
    eventId: "66666666-6666-4666-8666-666666666666" as ClaimDecisionEventId,
    clientId,
    claimId,
    claimRevision: 1,
    decision: "invalidate",
    actorId: "legal-reviewer-1",
    occurredAt: now,
    reason: "Superseded",
    policyVersion: "claim_policy_v1",
    invalidationCause: "source_superseded"
  };

  const createDeps = (authorized = true) => {
    const claimRepo: Partial<ProductClaimRepositoryPort> = {
      invalidateClaim: vi.fn(async () => ({
        claim: mockClaim,
        decisionEvent: mockDecisionEvent
      }))
    };

    const uow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          productClaims: claimRepo as ProductClaimRepositoryPort
        } as unknown as UnitOfWorkContext)
      )
    };

    const reviewerAuth = {
      assertCanReviewCoaReport: vi.fn(),
      assertCanReviewClaim: vi.fn(async () => {
        if (!authorized) {
          throw new AccessDeniedError("Unauthorized claim reviewer");
        }
      }),
      assertCanVerifyEvidence: vi.fn()
    };

    return { uow, claimRepo, reviewerAuth };
  };

  it("successfully executes claim invalidation when reviewer is authorized", async () => {
    const { uow, claimRepo, reviewerAuth } = createDeps(true);
    const useCase = new InvalidateClaimUseCase(uow, reviewerAuth);

    const result = await useCase.execute({
      actionId: createActionId(actionId),
      clientId,
      actorId: "legal-reviewer-1",
      timestamp: now,
      payload: {
        claimId,
        actionId,
        expectedVersion: 1,
        claimRevision: 1,
        invalidationCause: "source_superseded",
        reason: "Source evidence superseded"
      }
    });

    expect(result.claim.state).toBe("invalidated");
    expect(reviewerAuth.assertCanReviewClaim).toHaveBeenCalledWith(clientId, "legal-reviewer-1");
    expect(claimRepo.invalidateClaim).toHaveBeenCalled();
  });

  it("throws AccessDeniedError when reviewer is not authorized", async () => {
    const { uow, reviewerAuth } = createDeps(false);
    const useCase = new InvalidateClaimUseCase(uow, reviewerAuth);

    await expect(
      useCase.execute({
        actionId: createActionId(actionId),
        clientId,
        actorId: "unauthorized-actor",
        timestamp: now,
        payload: {
          claimId,
          actionId,
          expectedVersion: 1,
          claimRevision: 1,
          invalidationCause: "source_superseded",
          reason: "Source evidence superseded"
        }
      })
    ).rejects.toThrow(AccessDeniedError);
  });

  it("throws ProductValidationError when payload fails validation", async () => {
    const { uow, reviewerAuth } = createDeps(true);
    const useCase = new InvalidateClaimUseCase(uow, reviewerAuth);

    await expect(
      useCase.execute({
        actionId: createActionId(actionId),
        clientId,
        actorId: "legal-reviewer-1",
        timestamp: now,
        payload: {
          claimId,
          actionId,
          expectedVersion: 1,
          claimRevision: 1,
          invalidationCause:
            "not_a_valid_cause" as unknown as InvalidateClaimRequest["invalidationCause"],
          reason: "reason"
        }
      })
    ).rejects.toThrow(ProductValidationError);
  });
});
