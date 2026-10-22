import crypto from "node:crypto";
import {
  AccessDeniedError,
  createActionId,
  NotFoundError,
  ProductValidationError,
  SourceIntegrityMismatchError,
  type BatchId,
  type ClientId,
  type EvidenceDerivative,
  type EvidenceId,
  type EvidenceRevision,
  type EvidenceVerificationEvent,
  type ReferenceAssetId
} from "@cco/domain";
import { BUCKETS } from "@cco/shared";
import type {
  EvidenceAssetListResponse,
  EvidenceAssetSummaryResponse,
  EvidenceMediaDeliveryResponse,
  RegisterEvidenceAssetResponse
} from "@cco/contracts";
import type {
  ObjectStoragePort,
  OriginalsInspectionPort,
  ReviewMediaDeliveryPort,
  ReviewerAuthorizationPort,
  UnitOfWork
} from "../ports/index.js";
import {
  DenyAllReviewerAuthorizationAdapter,
  StorageIntegrityViolationError
} from "../ports/index.js";
import type {
  RegisterEvidenceAssetUseCase,
  RegisterEvidenceAssetInput
} from "./register-evidence-asset.js";
import type {
  LinkExistingDerivativeUseCase,
  LinkExistingDerivativeInput
} from "./link-existing-derivative.js";
import type {
  RecordEvidenceVerificationEventUseCase,
  RecordEvidenceVerificationEventInput
} from "./record-evidence-verification-event.js";

export class EvidenceAssetUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly registerUseCase: RegisterEvidenceAssetUseCase,
    private readonly linkDerivativeUseCase: LinkExistingDerivativeUseCase,
    private readonly recordVerificationUseCase: RecordEvidenceVerificationEventUseCase,
    private readonly reviewerAuth: ReviewerAuthorizationPort = new DenyAllReviewerAuthorizationAdapter(),
    private readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined,
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

  async registerEvidenceAsset(
    clientId: ClientId,
    batchId: BatchId,
    input: RegisterEvidenceAssetInput
  ): Promise<RegisterEvidenceAssetResponse> {
    await this.assertBatchExists(clientId, batchId);

    if (input.registrationIntent === "supersede") {
      if (!input.targetEvidenceId || input.expectedEvidenceVersion === undefined) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["targetEvidenceId"],
            message:
              "targetEvidenceId and expectedEvidenceVersion required when intent is supersede"
          }
        ]);
      }
      await this.uow.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
        }
        if (input.actionId) {
          const receipt = await ctx.evidenceAsset.getCommandReceipt(
            clientId,
            createActionId(input.actionId)
          );
          if (receipt) {
            const resp = receipt.responseBody as RegisterEvidenceAssetResponse;
            if (resp?.batchEvidenceLink?.batchId === batchId) {
              return;
            }
            throw new NotFoundError("BatchEvidenceLink", `${input.targetEvidenceId}`);
          }
        }
        const asset = await ctx.evidenceAsset.getEvidenceById(clientId, input.targetEvidenceId!);
        if (!asset) {
          throw new NotFoundError("EvidenceAsset", input.targetEvidenceId!);
        }
        const link = await ctx.evidenceAsset.getBatchEvidenceLink(
          clientId,
          batchId,
          input.targetEvidenceId!,
          asset.currentRevision
        );
        if (!link) {
          throw new NotFoundError(
            "BatchEvidenceLink",
            `${input.targetEvidenceId}:${asset.currentRevision}`
          );
        }
      });
    }

    return this.registerUseCase.execute(input);
  }

  async linkDerivative(
    clientId: ClientId,
    batchId: BatchId,
    input: LinkExistingDerivativeInput
  ): Promise<EvidenceDerivative> {
    await this.assertBatchExists(clientId, batchId);

    const link = await this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      return ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        input.evidenceId,
        input.evidenceRevision
      );
    });
    if (!link) {
      throw new NotFoundError("BatchEvidenceLink", `${input.evidenceId}:${input.evidenceRevision}`);
    }

    const refAssets = await this.uow.execute(async (ctx) => {
      if (!ctx.referenceAssets) {
        throw new Error("UnitOfWorkContext.referenceAssets is not configured.");
      }
      return ctx.referenceAssets.findByIds(clientId, [input.referenceAssetId as ReferenceAssetId]);
    });
    if (!refAssets || refAssets.length === 0) {
      throw new NotFoundError("ReferenceAsset", input.referenceAssetId);
    }

    return this.linkDerivativeUseCase.execute(input);
  }

  async recordVerificationEvent(
    clientId: ClientId,
    batchId: BatchId,
    input: RecordEvidenceVerificationEventInput
  ): Promise<EvidenceVerificationEvent> {
    await this.assertBatchExists(clientId, batchId);

    const link = await this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      return ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        input.evidenceId,
        input.evidenceRevision
      );
    });
    if (!link) {
      throw new NotFoundError("BatchEvidenceLink", `${input.evidenceId}:${input.evidenceRevision}`);
    }

    await this.reviewerAuth.assertCanVerifyEvidence(clientId, input.actorId);

    const isReplay = input.actionId
      ? await this.uow.execute(async (ctx) => {
          if (!ctx.evidenceAsset) return false;
          const receipt = await ctx.evidenceAsset.getCommandReceipt(
            clientId,
            createActionId(input.actionId!)
          );
          return receipt !== null;
        })
      : false;

    if (!isReplay && this.objectStorage) {
      const { rev, sourceObject } = await this.uow.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
        }
        const r = await ctx.evidenceAsset.getEvidenceRevision(
          clientId,
          input.evidenceId,
          input.evidenceRevision
        );
        if (!r) {
          throw new NotFoundError(
            "EvidenceRevision",
            `${input.evidenceId}:${input.evidenceRevision}`
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

    return this.recordVerificationUseCase.execute(input);
  }

  async listBatchEvidence(
    clientId: ClientId,
    batchId: BatchId
  ): Promise<EvidenceAssetListResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      const links = await ctx.evidenceAsset.listBatchEvidence(clientId, batchId);

      const revisionMap = new Map<string, number[]>();
      for (const link of links) {
        const existing = revisionMap.get(link.evidenceId) ?? [];
        existing.push(link.evidenceRevision);
        revisionMap.set(link.evidenceId, existing);
      }

      const summaries: EvidenceAssetSummaryResponse[] = [];
      for (const [evidenceId, linkedRevisions] of revisionMap.entries()) {
        const asset = await ctx.evidenceAsset.getEvidenceById(clientId, evidenceId as EvidenceId);
        if (asset) {
          summaries.push({
            evidenceId: asset.evidenceId,
            currentRevision: asset.currentRevision,
            version: asset.version,
            createdAt: asset.createdAt,
            archivedAt: asset.archivedAt,
            linkedRevisions: linkedRevisions.sort((a, b) => a - b)
          });
        }
      }

      return { evidence: summaries };
    });
  }

  async getEvidenceAssetHead(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId
  ): Promise<EvidenceAssetSummaryResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      const links = await ctx.evidenceAsset.listBatchEvidence(clientId, batchId);
      const matchingLinks = links.filter((l) => l.evidenceId === evidenceId);
      if (matchingLinks.length === 0) {
        throw new NotFoundError("EvidenceAsset", evidenceId);
      }

      const asset = await ctx.evidenceAsset.getEvidenceById(clientId, evidenceId);
      if (!asset) {
        throw new NotFoundError("EvidenceAsset", evidenceId);
      }

      return {
        evidenceId: asset.evidenceId,
        currentRevision: asset.currentRevision,
        version: asset.version,
        createdAt: asset.createdAt,
        archivedAt: asset.archivedAt,
        linkedRevisions: matchingLinks.map((l) => l.evidenceRevision).sort((a, b) => a - b)
      };
    });
  }

  async getEvidenceRevision(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceRevision> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      const link = await ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      if (!link) {
        throw new NotFoundError("EvidenceRevision", `${evidenceId}:${revision}`);
      }

      const rev = await ctx.evidenceAsset.getEvidenceRevision(clientId, evidenceId, revision);
      if (!rev) {
        throw new NotFoundError("EvidenceRevision", `${evidenceId}:${revision}`);
      }

      return rev;
    });
  }

  async getDerivative(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceDerivative> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      const link = await ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      if (!link) {
        throw new NotFoundError("EvidenceDerivative", `${evidenceId}:${revision}`);
      }

      const derivative = await ctx.evidenceAsset.getDerivative(clientId, evidenceId, revision);
      if (!derivative) {
        throw new NotFoundError("EvidenceDerivative", `${evidenceId}:${revision}`);
      }

      return derivative;
    });
  }

  async listVerificationEvents(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<{ events: readonly EvidenceVerificationEvent[] }> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      const link = await ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      if (!link) {
        throw new NotFoundError("EvidenceVerificationEvent", `${evidenceId}:${revision}`);
      }

      const events = await ctx.evidenceAsset.listVerificationEvents(clientId, evidenceId, revision);
      return { events };
    });
  }

  async deliverMedia(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceMediaDeliveryResponse> {
    await this.assertBatchExists(clientId, batchId);

    return this.uow.execute(async (ctx) => {
      if (!ctx.evidenceAsset) {
        throw new Error("UnitOfWorkContext.evidenceAsset is not configured.");
      }
      const link = await ctx.evidenceAsset.getBatchEvidenceLink(
        clientId,
        batchId,
        evidenceId,
        revision
      );
      if (!link) {
        throw new NotFoundError("BatchEvidenceLink", `${evidenceId}:${revision}`);
      }

      const rev = await ctx.evidenceAsset.getEvidenceRevision(clientId, evidenceId, revision);
      if (!rev) {
        throw new NotFoundError("EvidenceRevision", `${evidenceId}:${revision}`);
      }

      const sourceObj = await ctx.evidenceAsset.getSourceObjectById(clientId, rev.sourceObjectId);
      if (!sourceObj) {
        throw new NotFoundError("SourceObject", rev.sourceObjectId);
      }

      if (sourceObj.availability !== "available") {
        throw new AccessDeniedError(
          "Original media is not available for delivery.",
          "SOURCE_UNAVAILABLE"
        );
      }

      const expectedPrefix = `clients/${clientId}/evidence/originals/`;
      if (
        sourceObj.storageBucket !== BUCKETS.EVIDENCE ||
        !sourceObj.storageObjectKey.startsWith(expectedPrefix)
      ) {
        throw new AccessDeniedError("Source object namespace is invalid.", "ACCESS_DENIED");
      }

      if (this.objectStorage) {
        if (this.objectStorage.headObject) {
          const head = await this.objectStorage.headObject({
            bucket: sourceObj.storageBucket,
            key: sourceObj.storageObjectKey
          });
          if (!head) {
            throw new NotFoundError("SourceObject", sourceObj.sourceObjectId);
          }
        } else {
          const stored = await this.objectStorage.getObject({
            bucket: sourceObj.storageBucket,
            key: sourceObj.storageObjectKey
          });
          if (!stored) {
            throw new NotFoundError("SourceObject", sourceObj.sourceObjectId);
          }
        }
      }

      if (!this.mediaDelivery) {
        throw new Error("ReviewMediaDeliveryPort is not configured.");
      }

      const url = await this.mediaDelivery.generatePresignedReadUrl(
        {
          bucket: sourceObj.storageBucket,
          key: sourceObj.storageObjectKey,
          contentHash: sourceObj.originalSha256
        },
        300
      );

      const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();

      return {
        clientId,
        batchId,
        evidenceId,
        evidenceRevision: revision,
        sourceObjectId: sourceObj.sourceObjectId,
        originalSha256: sourceObj.originalSha256,
        detectedMimeType: sourceObj.detectedMimeType,
        byteLength: sourceObj.byteLength,
        url,
        expiresAt
      };
    });
  }
}
