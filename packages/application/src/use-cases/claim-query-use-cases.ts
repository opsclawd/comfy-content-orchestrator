import crypto from "node:crypto";
import {
  CrossBatchSourceError,
  NotFoundError,
  SourceIntegrityMismatchError,
  type BatchId,
  type ClaimId,
  type ClientId,
  type EvidenceId,
  type ProductClaim,
  type ProductClaimRevision
} from "@cco/domain";
import type {
  AppendClaimRevisionRequest,
  CreateClaimRequest,
  InvalidateClaimRequest,
  LinkClaimEvidenceRequest,
  ProductClaimDetailResponse,
  ProductClaimListResponse,
  ProductClaimReviewResponse,
  ResolveClaimResponse,
  ReviewClaimRequest
} from "@cco/contracts";
import type {
  CommandEnvelope,
  ObjectStoragePort,
  OriginalsInspectionPort,
  ProductClaimLinkResult,
  ReviewerAuthorizationPort,
  UnitOfWork
} from "../ports/index.js";
import {
  DenyAllReviewerAuthorizationAdapter,
  StorageIntegrityViolationError
} from "../ports/index.js";
import type { CreateClaimUseCase } from "./create-claim.js";
import type { AppendClaimRevisionUseCase } from "./append-claim-revision.js";
import type { LinkClaimEvidenceUseCase } from "./link-claim-evidence.js";
import type { ReviewClaimUseCase } from "./review-claim.js";
import type { InvalidateClaimUseCase } from "./invalidate-claim.js";
import type { ResolveClaimUseCase } from "./resolve-claim.js";

export class ClaimUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly createClaimUseCase: CreateClaimUseCase,
    private readonly appendClaimRevisionUseCase: AppendClaimRevisionUseCase,
    private readonly linkClaimEvidenceUseCase: LinkClaimEvidenceUseCase,
    private readonly reviewClaimUseCase: ReviewClaimUseCase,
    private readonly invalidateClaimUseCase: InvalidateClaimUseCase,
    private readonly resolveClaimUseCase: ResolveClaimUseCase,
    private readonly reviewerAuth: ReviewerAuthorizationPort = new DenyAllReviewerAuthorizationAdapter(),
    private readonly objectStorage?: ObjectStoragePort | undefined,
    private readonly originalsInspector?: OriginalsInspectionPort | undefined
  ) {}

  private async assertBatchExists(clientId: ClientId, batchId: BatchId): Promise<void> {
    const batch = await this.uow.execute(async (ctx) => {
      if (!ctx.productEvidence) {
        throw new Error("UnitOfWorkContext.productEvidence is not configured.");
      }
      return ctx.productEvidence.getBatchById(clientId, batchId);
    });
    if (!batch) {
      throw new NotFoundError("ProductBatch", batchId);
    }
  }

  async createClaim(
    clientId: ClientId,
    batchId: BatchId,
    cmd: CommandEnvelope<CreateClaimRequest>
  ): Promise<{ readonly claim: ProductClaim; readonly revision: ProductClaimRevision }> {
    await this.assertBatchExists(clientId, batchId);

    if (cmd.payload.batchId !== batchId) {
      throw new CrossBatchSourceError(
        `Command batchId "${cmd.payload.batchId}" does not match route batchId "${batchId}".`
      );
    }

    return this.createClaimUseCase.execute(cmd);
  }

  async appendClaimRevision(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId,
    cmd: CommandEnvelope<AppendClaimRevisionRequest & { readonly claimId: ClaimId }>
  ): Promise<{ readonly claim: ProductClaim; readonly revision: ProductClaimRevision }> {
    await this.assertBatchExists(clientId, batchId);

    const claim = await this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      return ctx.productClaims.getClaimById(clientId, claimId);
    });
    if (!claim || claim.batchId !== batchId) {
      throw new NotFoundError("ProductClaim", claimId);
    }

    return this.appendClaimRevisionUseCase.execute(cmd);
  }

  async linkClaimEvidence(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId,
    cmd: CommandEnvelope<LinkClaimEvidenceRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimLinkResult> {
    await this.assertBatchExists(clientId, batchId);

    const claim = await this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      return ctx.productClaims.getClaimById(clientId, claimId);
    });
    if (!claim || claim.batchId !== batchId) {
      throw new NotFoundError("ProductClaim", claimId);
    }

    // Verify all source links belong to this batch
    await this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      for (const link of cmd.payload.links) {
        const batchLink = await ctx.evidenceAsset.getBatchEvidenceLink(
          clientId,
          batchId,
          link.evidenceId as EvidenceId,
          link.evidenceRevision
        );
        if (!batchLink) {
          throw new CrossBatchSourceError(
            `Evidence ${link.evidenceId}:${link.evidenceRevision} is not linked to batch "${batchId}".`
          );
        }
      }
    });

    return this.linkClaimEvidenceUseCase.execute(cmd);
  }

  async reviewClaim(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId,
    cmd: CommandEnvelope<ReviewClaimRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimReviewResponse> {
    await this.assertBatchExists(clientId, batchId);

    const claim = await this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      return ctx.productClaims.getClaimById(clientId, claimId);
    });
    if (!claim || claim.batchId !== batchId) {
      throw new NotFoundError("ProductClaim", claimId);
    }

    await this.reviewerAuth.assertCanReviewClaim(clientId, cmd.actorId);

    const isReplay = await this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) return false;
      const receipt = await ctx.productClaims.getCommandReceipt(clientId, cmd.actionId);
      return receipt !== null;
    });

    if (!isReplay && this.objectStorage && cmd.payload.decision === "approve") {
      const claimDetail = await this.uow.execute(async (ctx) => {
        if (!ctx.productClaims) return null;
        return ctx.productClaims.getClaimRevision(clientId, claimId, cmd.payload.claimRevision);
      });
      if (claimDetail && claimDetail.links.length > 0) {
        for (const link of claimDetail.links) {
          const { rev, sourceObject } = await this.uow.execute(async (ctx) => {
            if (!ctx.evidenceAsset) {
              throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
            }
            const r = await ctx.evidenceAsset.getEvidenceRevision(
              clientId,
              link.evidenceId,
              link.evidenceRevision
            );
            if (!r) {
              throw new NotFoundError(
                "EvidenceRevision",
                `${link.evidenceId}:${link.evidenceRevision}`
              );
            }
            const s = await ctx.evidenceAsset.getSourceObjectById(clientId, r.sourceObjectId);
            if (!s) {
              throw new NotFoundError("SourceObject", r.sourceObjectId);
            }
            return { rev: r, sourceObject: s };
          });

          const byteLen = Number(sourceObject.byteLength);
          let blob;
          try {
            blob = await this.objectStorage.getObject(
              { bucket: sourceObject.storageBucket, key: sourceObject.storageObjectKey },
              { maxBytes: byteLen + 1 }
            );
          } catch (err) {
            if (err instanceof StorageIntegrityViolationError) {
              await this.uow.execute(async (qCtx) => {
                await qCtx.evidenceAsset?.quarantineSourceObject(
                  clientId,
                  sourceObject.sourceObjectId,
                  `Storage read failed: ${err.message}`
                );
              });
              throw new SourceIntegrityMismatchError(
                `Storage read for source object ${sourceObject.sourceObjectId} failed: ${err.message}`
              );
            }
            throw err;
          }

          if (!blob || !blob.body) {
            await this.uow.execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                clientId,
                sourceObject.sourceObjectId,
                "Storage blob missing"
              );
            });
            throw new NotFoundError("SourceObject", sourceObject.sourceObjectId);
          }

          const bodyBytes = Buffer.isBuffer(blob.body) ? blob.body : Buffer.from(blob.body);
          const hash = crypto.createHash("sha256").update(bodyBytes).digest("hex");
          const storedContentType = blob.contentType?.toLowerCase();

          let inspectionError: Error | undefined;
          if (this.originalsInspector) {
            try {
              await this.originalsInspector.inspectAndValidate(
                bodyBytes,
                sourceObject.detectedMimeType,
                rev.sourceClass
              );
            } catch (err) {
              inspectionError = err instanceof Error ? err : new Error(String(err));
            }
          }

          if (
            hash !== sourceObject.originalSha256 ||
            bodyBytes.length !== byteLen ||
            (storedContentType && storedContentType !== sourceObject.detectedMimeType) ||
            inspectionError
          ) {
            await this.uow.execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                clientId,
                sourceObject.sourceObjectId,
                "Storage byte integrity mismatch"
              );
            });
            throw new SourceIntegrityMismatchError(
              `Persisted source bytes for ${sourceObject.sourceObjectId} failed integrity check: expected hash ${sourceObject.originalSha256}, got ${hash}; expected length ${byteLen}, got ${bodyBytes.length}${inspectionError ? `; inspection error: ${inspectionError.message}` : ""}`
            );
          }
        }
      }
    }

    const result = await this.reviewClaimUseCase.execute(cmd);
    return {
      claim: result.claim,
      decisionEvent: result.decisionEvent
    };
  }

  async invalidateClaim(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId,
    cmd: CommandEnvelope<InvalidateClaimRequest & { readonly claimId: ClaimId }>
  ): Promise<ProductClaimReviewResponse> {
    await this.assertBatchExists(clientId, batchId);

    const claim = await this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      return ctx.productClaims.getClaimById(clientId, claimId);
    });
    if (!claim || claim.batchId !== batchId) {
      throw new NotFoundError("ProductClaim", claimId);
    }

    await this.reviewerAuth.assertCanReviewClaim(clientId, cmd.actorId);

    const result = await this.invalidateClaimUseCase.execute(cmd);
    return {
      claim: result.claim,
      decisionEvent: result.decisionEvent
    };
  }

  async getClaimById(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId
  ): Promise<ProductClaimDetailResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      const claim = await ctx.productClaims.getClaimById(clientId, claimId);
      if (!claim || claim.batchId !== batchId) {
        throw new NotFoundError("ProductClaim", claimId);
      }

      const revDetail = await ctx.productClaims.getClaimRevision(
        clientId,
        claimId,
        claim.currentRevision
      );
      if (!revDetail) {
        throw new NotFoundError("ProductClaimRevision", `${claimId}:${claim.currentRevision}`);
      }

      return {
        claim,
        currentRevision: revDetail.revision,
        links: [...revDetail.links],
        events: [...revDetail.decisionEvents]
      };
    });
  }

  async getClaimRevision(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId,
    revision: number
  ): Promise<ProductClaimRevision> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      const claim = await ctx.productClaims.getClaimById(clientId, claimId);
      if (!claim || claim.batchId !== batchId) {
        throw new NotFoundError("ProductClaim", claimId);
      }

      const revDetail = await ctx.productClaims.getClaimRevision(clientId, claimId, revision);
      if (!revDetail) {
        throw new NotFoundError("ProductClaimRevision", `${claimId}:${revision}`);
      }

      return revDetail.revision;
    });
  }

  async listClaimsForBatch(
    clientId: ClientId,
    batchId: BatchId
  ): Promise<ProductClaimListResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      const claims = await ctx.productClaims.listClaimsForBatch(clientId, batchId);
      return { claims: [...claims] };
    });
  }

  async resolveClaim(
    clientId: ClientId,
    batchId: BatchId,
    claimId: ClaimId,
    revision?: number | undefined
  ): Promise<ResolveClaimResponse> {
    await this.assertBatchExists(clientId, batchId);

    const claim = await this.uow.execute(async (ctx) => {
      if (!ctx.productClaims) {
        throw new Error("UnitOfWorkContext.productClaims is not configured.");
      }
      return ctx.productClaims.getClaimById(clientId, claimId);
    });
    if (!claim || claim.batchId !== batchId) {
      throw new NotFoundError("ProductClaim", claimId);
    }

    return this.resolveClaimUseCase.execute({
      clientId,
      claimId,
      ...(revision !== undefined ? { revision } : {})
    });
  }
}
