import { describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  createActionId,
  createBatchId,
  createClaimId,
  createClientId,
  createCoaMeasurementId,
  createCoaReportId,
  createEvidenceId,
  createSha256Hex,
  createSkuId,
  createSourceObjectId,
  normalizeClaimParameters,
  ProductValidationError,
  type ActionId,
  type ClaimDecisionEvent,
  type ClaimId,
  type ProductClaim,
  type ProductClaimRevision
} from "@cco/domain";
import type {
  AppendClaimRevisionRequest,
  CreateClaimRequest,
  LinkClaimEvidenceRequest,
  ResolveClaimResponse,
  ReviewClaimRequest
} from "@cco/contracts";
import {
  AllowAllReviewerAuthorizationAdapter,
  DenyAllReviewerAuthorizationAdapter,
  type CommandEnvelope,
  type ProductClaimCreationResult,
  type ProductClaimLinkResult,
  type ProductClaimRepositoryPort,
  type ProductClaimReviewResult,
  type ProductClaimRevisionResult,
  type ReviewerAuthorizationPort,
  type ReviewEventStore,
  type SceneRepository,
  type StoryboardCandidateRepository,
  type UnitOfWork,
  type UnitOfWorkContext
} from "../ports/index.js";
import {
  CreateClaimUseCase,
  AppendClaimRevisionUseCase,
  LinkClaimEvidenceUseCase,
  ReviewClaimUseCase,
  ResolveClaimUseCase
} from "./index.js";

describe("Product Claim Application Use Cases", () => {
  const clientId = createClientId("018f6f00-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f6f00-0000-7000-8000-000000000002");
  const claimId = createClaimId("018f6f00-0000-7000-8000-000000000003");
  const evidenceId = createEvidenceId("018f6f00-0000-7000-8000-000000000004");
  const sourceObjectId = createSourceObjectId("018f6f00-0000-7000-8000-000000000005");
  const reportId = createCoaReportId("018f6f00-0000-7000-8000-000000000006");
  const measurementId = createCoaMeasurementId("018f6f00-0000-7000-8000-000000000007");
  const sha256 = createSha256Hex(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );

  function createMockUow(mockClaimRepo?: Partial<ProductClaimRepositoryPort>): UnitOfWork {
    return {
      execute: async <TResult>(
        work: (ctx: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> => {
        const ctx: UnitOfWorkContext = {
          scenes: {} as unknown as SceneRepository,
          reviewEvents: {} as unknown as ReviewEventStore,
          candidates: {} as unknown as StoryboardCandidateRepository,
          productClaims: mockClaimRepo as ProductClaimRepositoryPort
        };
        return work(ctx);
      }
    };
  }

  const validCreatePayload: CreateClaimRequest = {
    batchId,
    canonicalKind: "certificate_panel_measurement",
    proofCategory: "coa_measurement_backed",
    parameters: {
      kind: "certificate_panel_measurement",
      panelName: "Cannabinoids",
      measurements: [
        {
          analyte: "THCA",
          exactDecimalValue: "24.5000",
          unit: "percent_w_w",
          basis: "dry_weight",
          context: "flower",
          quantityKind: "mass_fraction",
          requiredScope: "sample_only"
        }
      ]
    },
    displayWording: "Laboratory verified 24.5% THCA"
  };

  const validCreateCmd: CommandEnvelope<CreateClaimRequest> = {
    actionId: createActionId("018f6f00-0000-7000-8000-000000000010"),
    clientId,
    actorId: "compliance-user-1",
    timestamp: "2026-10-18T12:00:00.000Z",
    payload: validCreatePayload
  };

  describe("CreateClaimUseCase", () => {
    it("successfully validates envelope, parses payload, and delegates to repository", async () => {
      const mockResult: ProductClaimCreationResult = {
        claim: {
          claimId,
          clientId,
          skuId: createSkuId("018f6f00-0000-7000-8000-000000000099"),
          batchId,
          currentRevision: 1,
          state: "draft",
          version: 1,
          invalidationCause: null,
          invalidationSourceRef: null,
          createdAt: "2026-10-18T12:00:00.000Z",
          updatedAt: "2026-10-18T12:00:00.000Z",
          archivedAt: null
        },
        revision: {
          clientId,
          claimId,
          revision: 1,
          batchId,
          canonicalKind: "certificate_panel_measurement",
          proofCategory: "coa_measurement_backed",
          parameters: normalizeClaimParameters(validCreatePayload.parameters),
          displayWording: validCreatePayload.displayWording!,
          policyVersion: "claim_policy_v1",
          assertedBy: "compliance-user-1",
          assertedAt: "2026-10-18T12:00:00.000Z",
          supersedesRevision: null
        }
      };

      const mockRepo: Partial<ProductClaimRepositoryPort> = {
        createClaim: vi.fn(async () => mockResult)
      };

      const uow = createMockUow(mockRepo);
      const useCase = new CreateClaimUseCase(uow);

      const result = await useCase.execute(validCreateCmd);

      expect(result).toEqual(mockResult);
      expect(mockRepo.createClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: validCreateCmd.actionId,
          clientId: validCreateCmd.clientId,
          actorId: validCreateCmd.actorId
        })
      );
    });

    it("rejects command envelope with invalid actionId", async () => {
      const uow = createMockUow({});
      const useCase = new CreateClaimUseCase(uow);

      await expect(
        useCase.execute({
          ...validCreateCmd,
          actionId: "not-a-uuid" as ActionId
        })
      ).rejects.toThrow(ProductValidationError);
    });

    it("rejects payload with invalid parameters schema", async () => {
      const uow = createMockUow({});
      const useCase = new CreateClaimUseCase(uow);

      await expect(
        useCase.execute({
          ...validCreateCmd,
          payload: {
            ...validCreatePayload,
            parameters: {
              kind: "factual_lot_identifier",
              lotIdentifier: "" // Invalid empty lotIdentifier
            } as unknown as CreateClaimRequest["parameters"]
          }
        })
      ).rejects.toThrow(ProductValidationError);
    });

    it("throws error when productClaims port is not provided in context", async () => {
      const uow = createMockUow(undefined);
      const useCase = new CreateClaimUseCase(uow);

      await expect(useCase.execute(validCreateCmd)).rejects.toThrow(
        "UnitOfWorkContext.productClaims is not configured"
      );
    });
  });

  describe("AppendClaimRevisionUseCase", () => {
    const validAppendPayload: AppendClaimRevisionRequest & { readonly claimId: ClaimId } = {
      claimId,
      expectedVersion: 1,
      canonicalKind: "certificate_panel_measurement",
      proofCategory: "coa_measurement_backed",
      parameters: validCreatePayload.parameters,
      displayWording: "Updated display wording"
    };

    const validAppendCmd: CommandEnvelope<typeof validAppendPayload> = {
      actionId: createActionId("018f6f00-0000-7000-8000-000000000011"),
      clientId,
      actorId: "compliance-user-1",
      timestamp: "2026-10-18T13:00:00.000Z",
      payload: validAppendPayload
    };

    it("successfully delegates to repository", async () => {
      const mockResult: ProductClaimRevisionResult = {
        claim: {} as unknown as ProductClaim,
        revision: {} as unknown as ProductClaimRevision
      };

      const mockRepo: Partial<ProductClaimRepositoryPort> = {
        appendClaimRevision: vi.fn(async () => mockResult)
      };

      const uow = createMockUow(mockRepo);
      const useCase = new AppendClaimRevisionUseCase(uow);

      const result = await useCase.execute(validAppendCmd);

      expect(result).toEqual(mockResult);
      expect(mockRepo.appendClaimRevision).toHaveBeenCalled();
    });

    it("rejects non-positive expectedVersion", async () => {
      const uow = createMockUow({});
      const useCase = new AppendClaimRevisionUseCase(uow);

      await expect(
        useCase.execute({
          ...validAppendCmd,
          payload: {
            ...validAppendPayload,
            expectedVersion: 0
          }
        })
      ).rejects.toThrow(ProductValidationError);
    });
  });

  describe("LinkClaimEvidenceUseCase", () => {
    const validLinkPayload: LinkClaimEvidenceRequest & { readonly claimId: ClaimId } = {
      claimId,
      expectedVersion: 1,
      claimRevision: 1,
      reason: "Linking lab CoA certificate",
      links: [
        {
          evidenceId,
          evidenceRevision: 1,
          sourceObjectId,
          sourceSha256: sha256,
          supportRole: "primary_measurement",
          reportId,
          reportRevision: 1,
          measurementId
        }
      ]
    };

    const validLinkCmd: CommandEnvelope<typeof validLinkPayload> = {
      actionId: createActionId("018f6f00-0000-7000-8000-000000000012"),
      clientId,
      actorId: "compliance-user-1",
      timestamp: "2026-10-18T14:00:00.000Z",
      payload: validLinkPayload
    };

    it("successfully links evidence and updates claim", async () => {
      const mockResult: ProductClaimLinkResult = {
        claim: {} as unknown as ProductClaim,
        links: [],
        decisionEvent: {} as unknown as ClaimDecisionEvent
      };

      const mockRepo: Partial<ProductClaimRepositoryPort> = {
        linkClaimEvidence: vi.fn(async () => mockResult)
      };

      const uow = createMockUow(mockRepo);
      const useCase = new LinkClaimEvidenceUseCase(uow);

      const result = await useCase.execute(validLinkCmd);

      expect(result).toEqual(mockResult);
      expect(mockRepo.linkClaimEvidence).toHaveBeenCalled();
    });

    it("rejects empty links array", async () => {
      const uow = createMockUow({});
      const useCase = new LinkClaimEvidenceUseCase(uow);

      await expect(
        useCase.execute({
          ...validLinkCmd,
          payload: {
            ...validLinkPayload,
            links: []
          }
        })
      ).rejects.toThrow(ProductValidationError);
    });
  });

  describe("ReviewClaimUseCase", () => {
    const validReviewPayload: ReviewClaimRequest & { readonly claimId: ClaimId } = {
      claimId,
      expectedVersion: 2,
      claimRevision: 1,
      decision: "approve",
      reason: "Verified laboratory certificate matches declared lot."
    };

    const validReviewCmd: CommandEnvelope<typeof validReviewPayload> = {
      actionId: createActionId("018f6f00-0000-7000-8000-000000000013"),
      clientId,
      actorId: "authorized-reviewer",
      timestamp: "2026-10-18T15:00:00.000Z",
      payload: validReviewPayload
    };

    it("rejects review with DenyAllReviewerAuthorizationAdapter by default", async () => {
      const uow = createMockUow({});
      const useCase = new ReviewClaimUseCase(uow, new DenyAllReviewerAuthorizationAdapter());

      await expect(useCase.execute(validReviewCmd)).rejects.toThrow(AccessDeniedError);
    });

    it("allows review with AllowAllReviewerAuthorizationAdapter", async () => {
      const mockResult: ProductClaimReviewResult = {
        claim: {} as unknown as ProductClaim,
        decisionEvent: {} as unknown as ClaimDecisionEvent
      };

      const mockRepo: Partial<ProductClaimRepositoryPort> = {
        reviewClaim: vi.fn(async () => mockResult)
      };

      const uow = createMockUow(mockRepo);
      const useCase = new ReviewClaimUseCase(uow, new AllowAllReviewerAuthorizationAdapter());

      const result = await useCase.execute(validReviewCmd);

      expect(result).toEqual(mockResult);
      expect(mockRepo.reviewClaim).toHaveBeenCalled();
    });

    it("delegates to custom ReviewerAuthorizationPort", async () => {
      const mockAuth: ReviewerAuthorizationPort = {
        assertCanReviewCoaReport: vi.fn(async () => {}),
        assertCanReviewClaim: vi.fn(async () => {
          throw new AccessDeniedError("User lacks claim review permission");
        }),
        assertCanVerifyEvidence: vi.fn(async () => {})
      };

      const uow = createMockUow({});
      const useCase = new ReviewClaimUseCase(uow, mockAuth);

      await expect(useCase.execute(validReviewCmd)).rejects.toThrow(AccessDeniedError);
      expect(mockAuth.assertCanReviewClaim).toHaveBeenCalledWith(clientId, "authorized-reviewer");
    });

    it("rejects invalid review decision", async () => {
      const uow = createMockUow({});
      const useCase = new ReviewClaimUseCase(uow, new AllowAllReviewerAuthorizationAdapter());

      await expect(
        useCase.execute({
          ...validReviewCmd,
          payload: {
            ...validReviewPayload,
            decision: "unknown_decision" as unknown as ReviewClaimRequest["decision"]
          }
        })
      ).rejects.toThrow(ProductValidationError);
    });
  });

  describe("ResolveClaimUseCase", () => {
    it("successfully delegates to repository resolveClaim", async () => {
      const mockResult: ResolveClaimResponse = {
        claim: {} as unknown as ProductClaim,
        revision: {} as unknown as ProductClaimRevision,
        supportEligible: true,
        canRequestReview: true,
        evidenceLinkApproved: true,
        provenanceCategory: "lab_reported",
        displayWordingStatus: "manual_review_approved",
        blockReasons: [],
        links: [],
        reviewEvents: [],
        dependencyFingerprint: "fingerprint-123"
      };

      const mockRepo: Partial<ProductClaimRepositoryPort> = {
        resolveClaim: vi.fn(async () => mockResult)
      };

      const uow = createMockUow(mockRepo);
      const useCase = new ResolveClaimUseCase(uow);

      const result = await useCase.execute({
        clientId,
        claimId,
        revision: 1
      });

      expect(result).toEqual(mockResult);
      expect(mockRepo.resolveClaim).toHaveBeenCalledWith(clientId, claimId, 1);
    });

    it("throws error when productClaims is not configured in uow", async () => {
      const uow = createMockUow(undefined);
      const useCase = new ResolveClaimUseCase(uow);

      await expect(
        useCase.execute({
          clientId,
          claimId
        })
      ).rejects.toThrow("UnitOfWorkContext.productClaims is not configured");
    });
  });
});
