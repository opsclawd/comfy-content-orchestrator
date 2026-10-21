import crypto from "node:crypto";
import {
  generateUuidV7,
  isValidPositiveInt,
  isValidSha256Hex,
  isValidUuid,
  isValidUuidV7,
  type IsoTimestampString
} from "@cco/shared";
import {
  AccessDeniedError,
  createActionId,
  NotFoundError,
  ProductValidationError,
  ReportDisputedError,
  SourceIntegrityMismatchError,
  SourceSupersededError,
  type ClientId,
  type EvidenceDerivative,
  type EvidenceId,
  type Sha256Hex
} from "@cco/domain";
import {
  StorageIntegrityViolationError,
  type EvidenceLockCoordinatorPort,
  type EvidenceLockSession,
  type ObjectStoragePort,
  type OriginalsInspectionPort,
  type UnitOfWork
} from "../ports/index.js";

export interface LinkExistingDerivativeInput {
  readonly clientId: ClientId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly referenceAssetId: string;
  readonly derivativeSha256: Sha256Hex;
  readonly transformDescription: string;
  readonly transformToolVersion?: string | null | undefined;
  readonly actorId: string;
  readonly actionId?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface LinkExistingDerivativeDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly objectStorage: ObjectStoragePort;
  readonly lockCoordinator?: EvidenceLockCoordinatorPort | undefined;
  readonly originalsInspector?: OriginalsInspectionPort | undefined;
  readonly logger?:
    | {
        warn?(message: string, ...args: unknown[]): void;
        error?(message: string, ...args: unknown[]): void;
      }
    | undefined;
}

export class LinkExistingDerivativeUseCase {
  constructor(private readonly dependencies: LinkExistingDerivativeDependencies) {}

  async execute(input: LinkExistingDerivativeInput): Promise<EvidenceDerivative> {
    if (!isValidUuid(input.clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(input.evidenceId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["evidenceId"],
          message: "evidenceId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidPositiveInt(input.evidenceRevision)) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["evidenceRevision"],
          message: "evidenceRevision must be a positive integer."
        }
      ]);
    }
    if (!isValidUuid(input.referenceAssetId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["referenceAssetId"],
          message: "referenceAssetId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidSha256Hex(input.derivativeSha256)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["derivativeSha256"],
          message: "derivativeSha256 must be a 64-character lowercase hex string."
        }
      ]);
    }
    if (!input.transformDescription || input.transformDescription.trim().length === 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_TEXT",
          path: ["transformDescription"],
          message: "transformDescription cannot be empty."
        }
      ]);
    }
    if (input.actionId !== undefined && !isValidUuidV7(input.actionId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["actionId"],
          message: "actionId must be a valid UUIDv7 string."
        }
      ]);
    }

    const actionId = input.actionId ?? generateUuidV7();
    const timestamp = input.timestamp ?? new Date().toISOString();

    const runInSession = async (session?: EvidenceLockSession): Promise<EvidenceDerivative> => {
      if (session) {
        await session.acquireCommandLock(actionId);
      }

      // 1. Check receipt first
      const receipt = await this.dependencies.unitOfWork.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
        }
        return await ctx.evidenceAsset.getCommandReceipt(input.clientId, createActionId(actionId));
      });

      if (receipt) {
        return await this.dependencies.unitOfWork.execute(async (ctx) => {
          return await ctx.evidenceAsset!.linkDerivative({
            clientId: input.clientId,
            actionId: createActionId(actionId),
            actorId: input.actorId,
            timestamp: timestamp as IsoTimestampString,
            payload: {
              evidenceId: input.evidenceId,
              evidenceRevision: input.evidenceRevision,
              referenceAssetId: input.referenceAssetId,
              derivativeSha256: input.derivativeSha256,
              transformDescription: input.transformDescription.trim(),
              transformToolVersion: input.transformToolVersion ?? null
            }
          });
        });
      }

      // 2. Fetch asset, revision & sourceObject and verify active status
      const { revision, sourceObject } = await this.dependencies.unitOfWork.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
        }
        const asset = await ctx.evidenceAsset.getEvidenceById(input.clientId, input.evidenceId);
        if (!asset) {
          throw new NotFoundError("EvidenceAsset", input.evidenceId);
        }
        if (asset.archivedAt !== null) {
          throw new AccessDeniedError("Target evidence asset is archived.", "EVIDENCE_ARCHIVED");
        }
        if (input.evidenceRevision !== asset.currentRevision) {
          throw new SourceSupersededError(
            `Evidence revision ${input.evidenceRevision} has been superseded by revision ${asset.currentRevision}. Derivatives can only be linked to the current revision.`,
            {
              evidenceId: input.evidenceId,
              currentRevision: asset.currentRevision,
              attemptedRevision: input.evidenceRevision
            }
          );
        }
        const rev = await ctx.evidenceAsset.getEvidenceRevision(
          input.clientId,
          input.evidenceId,
          input.evidenceRevision
        );
        if (!rev) {
          throw new NotFoundError(
            "EvidenceRevision",
            `${input.evidenceId}:${input.evidenceRevision}`
          );
        }
        const src = await ctx.evidenceAsset.getSourceObjectById(input.clientId, rev.sourceObjectId);
        if (!src) {
          throw new NotFoundError("SourceObject", rev.sourceObjectId);
        }
        if (src.availability !== "available") {
          throw new AccessDeniedError(
            `Source object ${src.sourceObjectId} is unavailable (${src.availability}).`,
            "SOURCE_UNAVAILABLE"
          );
        }
        const eligibility = await ctx.evidenceAsset.getEvidenceEligibility(
          input.clientId,
          input.evidenceId,
          input.evidenceRevision
        );
        if (!eligibility.isEligible) {
          throw new ReportDisputedError(
            `Evidence revision ${input.evidenceId}:${input.evidenceRevision} has an active dispute or rejection and cannot be linked to derivatives.`
          );
        }
        return { revision: rev, sourceObject: src };
      });

      if (session) {
        await session.acquireSourceLock(sourceObject.originalSha256);
      }

      // 3. Re-verify persisted source bytes from objectStorage
      const byteLen = Number(sourceObject.byteLength);
      let blob;
      try {
        blob = await this.dependencies.objectStorage.getObject(
          {
            bucket: sourceObject.storageBucket,
            key: sourceObject.storageObjectKey
          },
          { maxBytes: byteLen + 1 }
        );
      } catch (err) {
        // getObject throws StorageIntegrityViolationError (rather than returning
        // a result to inspect) when it has *proven* the persisted bytes are
        // corrupt (oversized content or a storage-side checksum mismatch) — that
        // is an integrity failure just like a locally-recomputed hash mismatch
        // and must still be quarantined, not left to propagate with no audit
        // trail. Any OTHER thrown error (network transport, timeout, auth,
        // cancellation) says nothing about byte integrity and must propagate
        // unchanged — quarantining a healthy source over a transient failure
        // would be a durable, one-way availability regression.
        if (!(err instanceof StorageIntegrityViolationError)) {
          throw err;
        }
        const message = err.message;
        await this.dependencies.unitOfWork
          .execute(async (qCtx) => {
            await qCtx.evidenceAsset?.quarantineSourceObject(
              input.clientId,
              sourceObject.sourceObjectId,
              `Storage read failed: ${message}`
            );
          })
          .catch((qErr) => {
            this.dependencies.logger?.warn?.(
              `Failed to quarantine source object ${sourceObject.sourceObjectId} after storage read failure:`,
              qErr
            );
          });
        throw new SourceIntegrityMismatchError(
          `Storage read for source object ${sourceObject.sourceObjectId} failed: ${message}`
        );
      }
      if (!blob || !blob.body) {
        await this.dependencies.unitOfWork
          .execute(async (qCtx) => {
            await qCtx.evidenceAsset?.quarantineSourceObject(
              input.clientId,
              sourceObject.sourceObjectId,
              "Storage blob missing"
            );
          })
          .catch((err) => {
            this.dependencies.logger?.warn?.(
              `Failed to quarantine missing source object ${sourceObject.sourceObjectId}:`,
              err
            );
          });
        throw new NotFoundError("SourceObjectBlob", sourceObject.storageObjectKey);
      }

      const bodyBytes = Buffer.isBuffer(blob.body) ? blob.body : Buffer.from(blob.body);
      const hash = crypto.createHash("sha256").update(bodyBytes).digest("hex");
      const storedContentType = blob.contentType?.toLowerCase();

      let inspectionError: Error | undefined;
      if (this.dependencies.originalsInspector) {
        try {
          await this.dependencies.originalsInspector.inspectAndValidate(
            bodyBytes,
            sourceObject.detectedMimeType,
            revision.sourceClass
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
        await this.dependencies.unitOfWork
          .execute(async (qCtx) => {
            await qCtx.evidenceAsset?.quarantineSourceObject(
              input.clientId,
              sourceObject.sourceObjectId,
              "Storage byte integrity mismatch"
            );
          })
          .catch((err) => {
            this.dependencies.logger?.warn?.(
              `Failed to quarantine corrupted source object ${sourceObject.sourceObjectId}:`,
              err
            );
          });
        throw new SourceIntegrityMismatchError(
          `Persisted source bytes for ${sourceObject.sourceObjectId} failed integrity check: expected hash ${sourceObject.originalSha256}, got ${hash}; expected length ${byteLen}, got ${bodyBytes.length}; expected contentType ${sourceObject.detectedMimeType}, got ${storedContentType}${inspectionError ? `; inspection error: ${inspectionError.message}` : ""}`
        );
      }

      // 4. Link derivative in publishing transaction
      return await this.dependencies.unitOfWork.execute(async (ctx) => {
        return await ctx.evidenceAsset!.linkDerivative({
          clientId: input.clientId,
          actionId: createActionId(actionId),
          actorId: input.actorId,
          timestamp: timestamp as IsoTimestampString,
          payload: {
            evidenceId: input.evidenceId,
            evidenceRevision: input.evidenceRevision,
            referenceAssetId: input.referenceAssetId,
            derivativeSha256: input.derivativeSha256,
            transformDescription: input.transformDescription.trim(),
            transformToolVersion: input.transformToolVersion ?? null
          }
        });
      });
    };

    if (this.dependencies.lockCoordinator) {
      return await this.dependencies.lockCoordinator.withLockSession(input.clientId, runInSession);
    }
    return await runInSession();
  }
}
