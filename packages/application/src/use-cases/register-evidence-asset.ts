import crypto from "node:crypto";
import {
  BUCKETS,
  generateUuidV7,
  isValidDateOnly,
  isValidIsoUtcTimestamp,
  isValidPositiveInt,
  isValidUuid,
  isValidUuidV7,
  normalizeAssertionText,
  sortKeysDeep,
  type BatchEvidencePurpose,
  type ConsentStatus,
  type EvidenceAcquisitionMethod,
  type EvidenceRegistrationIntent,
  type EvidenceSourceClass,
  type IsoTimestampString,
  type LegalRightsStatus,
  type ReportedCapturePrecision
} from "@cco/shared";
import {
  AccessDeniedError,
  createActionId,
  createSourceObjectId,
  IdempotencyConflictError,
  NotFoundError,
  ProductValidationError,
  QuotaExceededError,
  ReportDisputedError,
  SourceIntegrityMismatchError,
  StaleRevisionConflictError,
  type BatchId,
  type ClientId,
  type EvidenceId,
  type EvidenceRevision,
  type Sha256Hex,
  type SourceObject,
  type SourceObjectId
} from "@cco/domain";
import {
  ObjectAlreadyExistsError,
  StorageIntegrityViolationError,
  type EvidenceAssetRepositoryPort,
  type EvidenceLockCoordinatorPort,
  type EvidenceStoragePolicyConfig,
  type ObjectStoragePort,
  type OriginalsInspectionPort,
  type RegisterEvidenceCommandPayload,
  type RegisterEvidenceResult,
  type UnitOfWork
} from "../ports/index.js";
import type { RegisterEvidenceAssetResponse } from "@cco/contracts";

const REQUIRED_SOURCE_CLASSES: readonly EvidenceSourceClass[] = [
  "photo",
  "video",
  "raw",
  "document",
  "coa",
  "process_record"
];

const VALIDATED_PRODUCTION_CEILINGS: Record<EvidenceSourceClass, number> = {
  photo: 10 * 1024 * 1024,
  document: 25 * 1024 * 1024,
  coa: 25 * 1024 * 1024,
  process_record: 25 * 1024 * 1024,
  raw: 64 * 1024 * 1024,
  video: 0
};

const VALID_MIMES_FOR_SOURCE_CLASS: Record<EvidenceSourceClass, readonly string[]> = {
  photo: ["image/jpeg", "image/png", "image/webp"],
  document: ["application/pdf"],
  coa: ["application/pdf"],
  process_record: ["application/pdf"],
  raw: ["image/x-adobe-dng"],
  video: []
};

export function computeCanonicalPayloadSha256(commandName: string, payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const copy = { ...(payload as Record<string, unknown>) };
    if (commandName === "registerEvidence") {
      delete copy.sourceObjectId;
    }
    const sorted = sortKeysDeep(copy);
    return crypto.createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex");
  }
  const sorted = sortKeysDeep(payload);
  const json = JSON.stringify(sorted);
  return crypto.createHash("sha256").update(json, "utf8").digest("hex");
}

export interface RegisterEvidenceAssetInput {
  readonly clientId: ClientId;
  readonly batchId: BatchId;
  readonly body?: Buffer | Uint8Array | undefined;
  readonly declaredMimeType?: string | undefined;
  readonly reusedSourceObjectId?: string | undefined;
  readonly purpose: BatchEvidencePurpose;
  readonly sourceClass: EvidenceSourceClass;
  readonly acquisitionMethod: EvidenceAcquisitionMethod;
  readonly assertionText: string;
  readonly reportedCaptureDate?: string | null | undefined;
  readonly reportedCaptureTimestamp?: string | null | undefined;
  readonly reportedCapturePrecision?: ReportedCapturePrecision | null | undefined;
  readonly captureContext?: string | null | undefined;
  readonly rightsStatus?: LegalRightsStatus | undefined;
  readonly consentStatus?: ConsentStatus | undefined;
  readonly rightsAttribution?: string | null | undefined;
  readonly rightsDocumentLocator?: string | null | undefined;
  readonly registrationIntent: EvidenceRegistrationIntent;
  readonly targetEvidenceId?: EvidenceId | undefined;
  readonly expectedEvidenceVersion?: number | undefined;
  readonly derivative?:
    | {
        readonly referenceAssetId: string;
        readonly derivativeSha256: Sha256Hex;
        readonly transformDescription: string;
        readonly transformToolVersion?: string | null | undefined;
      }
    | undefined;
  readonly actorId: string;
  readonly actionId?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface RegisterEvidenceAssetDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly objectStorage: ObjectStoragePort;
  readonly originalsInspector: OriginalsInspectionPort;
  readonly lockCoordinator: EvidenceLockCoordinatorPort;
  readonly evidenceAssetRepository?: EvidenceAssetRepositoryPort | undefined;
  readonly storagePolicy?: EvidenceStoragePolicyConfig | undefined;
  readonly logger?:
    | {
        error(message: string, ...args: unknown[]): void;
        warn?(message: string, ...args: unknown[]): void;
        info?(message: string, ...args: unknown[]): void;
      }
    | undefined;
}

export class RegisterEvidenceAssetUseCase {
  constructor(private readonly dependencies: RegisterEvidenceAssetDependencies) {}

  /**
   * Looks up the committed SourceObject for a content hash and quarantines
   * it in a separately committed unit of work. Used by every collision/
   * readback integrity-failure branch that may be verifying bytes already
   * persisted under this hash via dedup, so the quarantine audit trail is
   * consistent regardless of which verification step detected the failure.
   * Best-effort: a failure to quarantine is logged, not thrown, since the
   * caller is already about to throw the original integrity error.
   */
  private async quarantineExistingSourceByHash(
    clientId: ClientId,
    originalSha256: Sha256Hex,
    reason: string
  ): Promise<void> {
    const { unitOfWork, logger } = this.dependencies;
    await unitOfWork
      .execute(async (qCtx) => {
        const existingSrc = await qCtx.evidenceAsset?.getSourceObjectByHash(
          clientId,
          originalSha256
        );
        if (existingSrc) {
          await qCtx.evidenceAsset?.quarantineSourceObject(
            clientId,
            existingSrc.sourceObjectId,
            reason
          );
        }
      })
      .catch((err) => {
        logger?.warn?.("Failed to quarantine corrupted source object on collision:", err);
      });
  }

  async execute(input: RegisterEvidenceAssetInput): Promise<RegisterEvidenceAssetResponse> {
    const { unitOfWork, objectStorage, originalsInspector, lockCoordinator, logger } =
      this.dependencies;

    // 1. Explicit policy configuration required
    const policy = this.dependencies.storagePolicy;
    if (!policy) {
      throw new AccessDeniedError(
        "Evidence storage policy configuration is required but was not provided. Archival ingest defaults to denied.",
        "POLICY_CONFIGURATION_MISSING"
      );
    }

    const runtimeEnv = process.env.NODE_ENV ?? "development";
    if (runtimeEnv === "production" && policy.environment !== "production") {
      throw new AccessDeniedError(
        "Non-production evidence storage policy cannot be used in a production runtime environment.",
        "ENVIRONMENT_POLICY_MISMATCH"
      );
    }

    if (policy.environment === "production") {
      if (
        !policy.isProductionApproved ||
        !policy.reviewedProductionApprovalIdentity ||
        policy.reviewedProductionApprovalIdentity.trim().length === 0
      ) {
        throw new AccessDeniedError(
          "Production evidence archival policy has not been signed off with an explicit reviewed policy identity. Refusing assumed production-ready archival.",
          "PRODUCTION_POLICY_NOT_APPROVED"
        );
      }
    }

    if (
      policy.maxClientStorageBytes <= 0 ||
      !Number.isFinite(policy.maxClientStorageBytes) ||
      policy.maxConcurrentUploads <= 0 ||
      !Number.isInteger(policy.maxConcurrentUploads) ||
      !policy.policyId ||
      policy.policyId.trim().length === 0
    ) {
      throw new AccessDeniedError(
        "Evidence storage policy specifies invalid quota, capacity, or policy identity limits.",
        "INVALID_POLICY_LIMITS"
      );
    }

    if (!policy.limitsPerSourceClass) {
      throw new AccessDeniedError(
        "Evidence storage policy does not define per-source-class limits.",
        "INVALID_POLICY_LIMITS"
      );
    }

    for (const sc of REQUIRED_SOURCE_CLASSES) {
      const limit = policy.limitsPerSourceClass[sc];
      if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
        throw new AccessDeniedError(
          `Evidence storage policy specifies invalid limit for source class "${sc}".`,
          "INVALID_POLICY_LIMITS"
        );
      }
      if (policy.environment === "production") {
        const ceiling = VALIDATED_PRODUCTION_CEILINGS[sc];
        if (limit > ceiling) {
          throw new AccessDeniedError(
            `Production limit for source class "${sc}" (${limit} bytes) exceeds validated ceiling of ${ceiling} bytes.`,
            "INVALID_POLICY_LIMITS"
          );
        }
      }
    }

    // 2. Format & input sanity checks
    if (!isValidUuid(input.clientId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["clientId"],
          message: "clientId must be a valid UUID string."
        }
      ]);
    }
    if (!isValidUuid(input.batchId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["batchId"],
          message: "batchId must be a valid UUID string."
        }
      ]);
    }
    if (input.targetEvidenceId && !isValidUuid(input.targetEvidenceId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["targetEvidenceId"],
          message: "targetEvidenceId must be a valid UUID string."
        }
      ]);
    }
    if (
      input.expectedEvidenceVersion !== undefined &&
      !isValidPositiveInt(input.expectedEvidenceVersion)
    ) {
      throw new ProductValidationError([
        {
          code: "INVALID_REVISION",
          path: ["expectedEvidenceVersion"],
          message: "expectedEvidenceVersion must be a positive integer."
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
    if (input.reusedSourceObjectId && !isValidUuid(input.reusedSourceObjectId)) {
      throw new ProductValidationError([
        {
          code: "INVALID_IDENTIFIER",
          path: ["reusedSourceObjectId"],
          message: "reusedSourceObjectId must be a valid UUID string."
        }
      ]);
    }
    if (input.reusedSourceObjectId && input.body) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["reusedSourceObjectId"],
          message: "Cannot specify both body and reusedSourceObjectId."
        }
      ]);
    }

    const maxClassBytes = policy.limitsPerSourceClass[input.sourceClass];
    if (maxClassBytes === undefined || !Number.isFinite(maxClassBytes) || maxClassBytes <= 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["sourceClass"],
          message: `Source class "${input.sourceClass}" is unsupported or has a 0-byte limit.`
        }
      ]);
    }

    const normalizedAssertion = normalizeAssertionText(input.assertionText);

    if (input.reportedCaptureDate && !isValidDateOnly(input.reportedCaptureDate)) {
      throw new ProductValidationError([
        {
          code: "INVALID_DATE",
          path: ["reportedCaptureDate"],
          message: "reportedCaptureDate must be a valid Gregorian date (YYYY-MM-DD)."
        }
      ]);
    }

    if (input.reportedCaptureTimestamp) {
      if (!isValidIsoUtcTimestamp(input.reportedCaptureTimestamp)) {
        throw new ProductValidationError([
          {
            code: "INVALID_TIMESTAMP",
            path: ["reportedCaptureTimestamp"],
            message: "reportedCaptureTimestamp must be a valid ISO 8601 UTC timestamp."
          }
        ]);
      }
      if (input.reportedCaptureDate) {
        const tsDate = input.reportedCaptureTimestamp.slice(0, 10);
        if (tsDate !== input.reportedCaptureDate) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["reportedCaptureDate"],
              message:
                "reportedCaptureDate does not match the UTC date part of reportedCaptureTimestamp."
            }
          ]);
        }
      }
    }

    const actionId = input.actionId ?? generateUuidV7();
    const timestamp = input.timestamp ?? new Date().toISOString();

    let targetCurrentRevision: EvidenceRevision | undefined;
    let targetSourceObject: SourceObject | undefined;

    if (input.registrationIntent === "supersede") {
      if (!input.targetEvidenceId) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["targetEvidenceId"],
            message: "targetEvidenceId is required when registrationIntent is 'supersede'."
          }
        ]);
      }
      if (input.expectedEvidenceVersion === undefined) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["expectedEvidenceVersion"],
            message: "expectedEvidenceVersion is required when registrationIntent is 'supersede'."
          }
        ]);
      }
    }

    // 3. Resolve source object properties / inspect bytes
    let originalSha256: Sha256Hex;
    let detectedMimeType: string;
    let byteLength: number;
    let storageBucket: string;
    let storageObjectKey: string;
    let reusedSourceObjectId: SourceObjectId | undefined;
    let existingSourceObject: SourceObject | undefined;
    let exactBytes: Buffer | undefined;

    if (input.reusedSourceObjectId) {
      const sourceObject = await unitOfWork.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
        }
        return await ctx.evidenceAsset.getSourceObjectById(
          input.clientId,
          createSourceObjectId(input.reusedSourceObjectId!)
        );
      });
      if (!sourceObject) {
        throw new NotFoundError("SourceObject", input.reusedSourceObjectId);
      }
      existingSourceObject = sourceObject;
      originalSha256 = sourceObject.originalSha256;
      detectedMimeType = sourceObject.detectedMimeType;
      byteLength = Number(sourceObject.byteLength);
      storageBucket = sourceObject.storageBucket;
      storageObjectKey = sourceObject.storageObjectKey;
      reusedSourceObjectId = sourceObject.sourceObjectId;

      if (input.declaredMimeType && input.declaredMimeType !== detectedMimeType) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["declaredMimeType"],
            message: `declaredMimeType "${input.declaredMimeType}" does not match reused source object MIME type "${detectedMimeType}".`
          }
        ]);
      }

      if (byteLength > maxClassBytes) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["sourceClass"],
            message: `Source file size (${byteLength} bytes) exceeds maximum limit of ${maxClassBytes} bytes for source class "${input.sourceClass}".`
          }
        ]);
      }

      const validMimes = VALID_MIMES_FOR_SOURCE_CLASS[input.sourceClass] ?? [];
      if (!validMimes.includes(detectedMimeType)) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["sourceClass"],
            message: `Source object MIME type "${detectedMimeType}" is not permitted for source class "${input.sourceClass}".`
          }
        ]);
      }
    } else {
      if (!input.body) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["body"],
            message: "Source evidence body or reusedSourceObjectId is required."
          }
        ]);
      }
      exactBytes = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
      if (exactBytes.length === 0) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["body"],
            message: "Source evidence body cannot be empty."
          }
        ]);
      }
      if (!input.declaredMimeType) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["declaredMimeType"],
            message: "declaredMimeType is required when uploading source evidence."
          }
        ]);
      }

      if (exactBytes.length > maxClassBytes) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["body"],
            message: `File size (${exactBytes.length} bytes) exceeds maximum limit of ${maxClassBytes} bytes for source class "${input.sourceClass}".`
          }
        ]);
      }

      const inspection = await originalsInspector.inspectAndValidate(
        exactBytes,
        input.declaredMimeType,
        input.sourceClass
      );
      originalSha256 = crypto.createHash("sha256").update(exactBytes).digest("hex") as Sha256Hex;
      detectedMimeType = inspection.detectedMimeType;
      byteLength = exactBytes.length;
      storageBucket = BUCKETS.EVIDENCE;
      storageObjectKey = `clients/${input.clientId}/evidence/originals/${originalSha256}`;
    }

    const commandPayload: RegisterEvidenceCommandPayload = {
      batchId: input.batchId,
      purpose: input.purpose,
      sourceClass: input.sourceClass,
      acquisitionMethod: input.acquisitionMethod,
      assertionText: normalizedAssertion,
      reportedCaptureDate: input.reportedCaptureDate ?? null,
      reportedCaptureTimestamp: input.reportedCaptureTimestamp ?? null,
      reportedCapturePrecision: input.reportedCapturePrecision ?? null,
      captureContext: input.captureContext ?? null,
      rightsStatus: input.rightsStatus ?? "unknown",
      consentStatus: input.consentStatus ?? "unknown",
      rightsAttribution: input.rightsAttribution ?? null,
      rightsDocumentLocator: input.rightsDocumentLocator ?? null,
      registrationIntent: input.registrationIntent,
      originalSha256,
      detectedMimeType,
      byteLength,
      storageBucket,
      storageObjectKey,
      retentionPolicyVersion: policy.policyId,
      expectedEvidenceVersion: input.expectedEvidenceVersion,
      targetEvidenceId: input.targetEvidenceId,
      reusedSourceObjectId,
      derivative: input.derivative
        ? {
            referenceAssetId: input.derivative.referenceAssetId,
            derivativeSha256: input.derivative.derivativeSha256,
            transformDescription: input.derivative.transformDescription,
            transformToolVersion: input.derivative.transformToolVersion ?? null
          }
        : undefined
    };

    return await lockCoordinator.withLockSession(input.clientId, async (session) => {
      // 4. Check for existing receipt before any storage I/O or mutable-state preconditions
      await session.acquireCommandLock(actionId);

      const receipt = await unitOfWork.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
        }
        return await ctx.evidenceAsset.getCommandReceipt(input.clientId, createActionId(actionId));
      });

      if (receipt) {
        const expectedPayloadHash = computeCanonicalPayloadSha256(
          "registerEvidence",
          commandPayload
        );
        if (
          receipt.commandName === "registerEvidence" &&
          receipt.actorId === input.actorId &&
          receipt.payloadSha256 === expectedPayloadHash
        ) {
          return receipt.responseBody as RegisterEvidenceAssetResponse;
        }
        throw new IdempotencyConflictError(actionId);
      }

      // No receipt - now enforce mutable-state preconditions under source lock
      await session.acquireSourceLock(originalSha256);

      if (input.registrationIntent === "supersede" && input.targetEvidenceId) {
        const targetData = await unitOfWork.execute(async (ctx) => {
          if (!ctx.evidenceAsset) {
            throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
          }
          const asset = await ctx.evidenceAsset.getEvidenceById(
            input.clientId,
            input.targetEvidenceId!
          );
          if (!asset) {
            return undefined;
          }
          if (asset.archivedAt !== null) {
            throw new AccessDeniedError("Target evidence asset is archived.", "EVIDENCE_ARCHIVED");
          }
          if (asset.version !== input.expectedEvidenceVersion) {
            throw new StaleRevisionConflictError(
              "EvidenceAsset",
              input.expectedEvidenceVersion!,
              asset.version
            );
          }
          const rev = await ctx.evidenceAsset.getEvidenceRevision(
            input.clientId,
            input.targetEvidenceId!,
            asset.currentRevision
          );
          if (!rev) {
            throw new NotFoundError(
              "EvidenceRevision",
              `${input.targetEvidenceId}:${asset.currentRevision}`
            );
          }
          const src = await ctx.evidenceAsset.getSourceObjectById(
            input.clientId,
            rev.sourceObjectId
          );
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
            input.targetEvidenceId!,
            asset.currentRevision
          );
          if (!eligibility.isEligible) {
            throw new ReportDisputedError(
              `Target evidence asset ${input.targetEvidenceId} has an active dispute or rejection and cannot be superseded.`
            );
          }
          return { rev, src };
        });

        if (targetData) {
          targetCurrentRevision = targetData.rev;
          targetSourceObject = targetData.src;
        }
      }

      // Re-verify target source object storage bytes if superseding
      if (targetSourceObject && targetCurrentRevision) {
        const targetByteLen = Number(targetSourceObject.byteLength);
        let targetBlob;
        try {
          targetBlob = await objectStorage.getObject(
            {
              bucket: targetSourceObject.storageBucket,
              key: targetSourceObject.storageObjectKey
            },
            { maxBytes: targetByteLen + 1 }
          );
        } catch (err) {
          // getObject throws StorageIntegrityViolationError (rather than
          // returning a result to inspect) when it has *proven* the persisted
          // bytes are corrupt (oversized content or a storage-side checksum
          // mismatch) — that is an integrity failure just like a
          // locally-recomputed hash mismatch and must still be quarantined, not
          // left to propagate with no audit trail. Any OTHER thrown error
          // (network transport, timeout, auth, cancellation) says nothing about
          // byte integrity and must propagate unchanged — quarantining a
          // healthy source over a transient failure would be a durable,
          // one-way availability regression.
          if (!(err instanceof StorageIntegrityViolationError)) {
            throw err;
          }
          const message = err.message;
          await unitOfWork
            .execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                input.clientId,
                targetSourceObject!.sourceObjectId,
                `Storage read failed on supersede check: ${message}`
              );
            })
            .catch((qErr) => {
              logger?.warn?.(
                `Failed to quarantine target source object ${targetSourceObject!.sourceObjectId} after storage read failure:`,
                qErr
              );
            });
          throw new SourceIntegrityMismatchError(
            `Storage read for target source object ${targetSourceObject.sourceObjectId} failed: ${message}`
          );
        }
        if (!targetBlob || !targetBlob.body) {
          await unitOfWork
            .execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                input.clientId,
                targetSourceObject!.sourceObjectId,
                "Storage blob missing on supersede check"
              );
            })
            .catch((err) => {
              logger?.warn?.(
                `Failed to quarantine missing target source object ${targetSourceObject!.sourceObjectId}:`,
                err
              );
            });
          throw new NotFoundError("SourceObjectBlob", targetSourceObject.storageObjectKey);
        }

        const targetBytes = Buffer.isBuffer(targetBlob.body)
          ? targetBlob.body
          : Buffer.from(targetBlob.body);
        const targetSha = crypto.createHash("sha256").update(targetBytes).digest("hex");
        const targetContentType = targetBlob.contentType?.toLowerCase();

        let targetInspectionError: Error | undefined;
        try {
          await originalsInspector.inspectAndValidate(
            targetBytes,
            targetSourceObject.detectedMimeType,
            targetCurrentRevision.sourceClass
          );
        } catch (err) {
          targetInspectionError = err instanceof Error ? err : new Error(String(err));
        }

        if (
          targetSha !== targetSourceObject.originalSha256 ||
          targetBytes.length !== targetByteLen ||
          (targetContentType && targetContentType !== targetSourceObject.detectedMimeType) ||
          targetInspectionError
        ) {
          await unitOfWork
            .execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                input.clientId,
                targetSourceObject!.sourceObjectId,
                "Storage byte integrity mismatch on supersede check"
              );
            })
            .catch((err) => {
              logger?.warn?.(
                `Failed to quarantine corrupted target source object ${targetSourceObject!.sourceObjectId}:`,
                err
              );
            });
          throw new SourceIntegrityMismatchError(
            `Target source object ${targetSourceObject.sourceObjectId} failed storage integrity check: expected hash ${targetSourceObject.originalSha256}, got ${targetSha}; expected length ${targetByteLen}, got ${targetBytes.length}; expected contentType ${targetSourceObject.detectedMimeType}, got ${targetContentType}${targetInspectionError ? `; inspection error: ${targetInspectionError.message}` : ""}`
          );
        }
      }

      // 5. If reusedSourceObjectId, re-verify storage bytes and register
      if (reusedSourceObjectId) {
        if (existingSourceObject!.availability !== "available") {
          throw new AccessDeniedError(
            `Source object ${existingSourceObject!.sourceObjectId} is unavailable (${existingSourceObject!.availability}).`,
            "SOURCE_UNAVAILABLE"
          );
        }

        let stored;
        try {
          stored = await objectStorage.getObject(
            {
              bucket: storageBucket,
              key: storageObjectKey
            },
            { maxBytes: byteLength + 1 }
          );
        } catch (err) {
          // getObject throws StorageIntegrityViolationError (rather than
          // returning a result to inspect) when it has *proven* the persisted
          // bytes are corrupt (oversized content or a storage-side checksum
          // mismatch) — that is an integrity failure just like a
          // locally-recomputed hash mismatch and must still be quarantined, not
          // left to propagate with no audit trail. Any OTHER thrown error
          // (network transport, timeout, auth, cancellation) says nothing about
          // byte integrity and must propagate unchanged — quarantining a
          // healthy source over a transient failure would be a durable,
          // one-way availability regression.
          if (!(err instanceof StorageIntegrityViolationError)) {
            throw err;
          }
          const message = err.message;
          await unitOfWork
            .execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                input.clientId,
                reusedSourceObjectId!,
                `Storage read failed: ${message}`
              );
            })
            .catch((qErr) => {
              logger?.warn?.(
                `Failed to quarantine source object ${reusedSourceObjectId} after storage read failure:`,
                qErr
              );
            });
          throw new SourceIntegrityMismatchError(
            `Storage read for source object ${reusedSourceObjectId} failed: ${message}`
          );
        }
        if (!stored || !stored.body) {
          await unitOfWork
            .execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                input.clientId,
                reusedSourceObjectId!,
                "Storage blob missing"
              );
            })
            .catch((err) => {
              logger?.warn?.(
                `Failed to quarantine missing source object ${reusedSourceObjectId}:`,
                err
              );
            });
          throw new NotFoundError("SourceObjectBlob", storageObjectKey);
        }

        const storedBytes = Buffer.isBuffer(stored.body) ? stored.body : Buffer.from(stored.body);
        const storedSha = crypto.createHash("sha256").update(storedBytes).digest("hex");
        const storedContentType = stored.contentType?.toLowerCase();

        let inspectionError: Error | undefined;
        try {
          await originalsInspector.inspectAndValidate(
            storedBytes,
            detectedMimeType,
            input.sourceClass
          );
        } catch (err) {
          inspectionError = err instanceof Error ? err : new Error(String(err));
        }

        if (
          storedSha !== originalSha256 ||
          storedBytes.length !== byteLength ||
          (storedContentType && storedContentType !== detectedMimeType) ||
          inspectionError
        ) {
          await unitOfWork
            .execute(async (qCtx) => {
              await qCtx.evidenceAsset?.quarantineSourceObject(
                input.clientId,
                reusedSourceObjectId!,
                "Storage byte integrity mismatch"
              );
            })
            .catch((err) => {
              logger?.warn?.(
                `Failed to quarantine corrupted source object ${reusedSourceObjectId}:`,
                err
              );
            });
          throw new SourceIntegrityMismatchError(
            `Source object ${reusedSourceObjectId} failed storage integrity check: expected hash ${originalSha256}, got ${storedSha}; expected length ${byteLength}, got ${storedBytes.length}; expected contentType ${detectedMimeType}, got ${storedContentType}${inspectionError ? `; inspection error: ${inspectionError.message}` : ""}`
          );
        }

        return (await unitOfWork.execute(async (ctx) => {
          return await ctx.evidenceAsset!.registerEvidence({
            clientId: input.clientId,
            actionId: createActionId(actionId),
            actorId: input.actorId,
            timestamp: timestamp as IsoTimestampString,
            payload: commandPayload
          });
        })) as RegisterEvidenceAssetResponse;
      }

      // 6. New upload path: reserve quota under quota lock in single transaction
      let reservationId: string | null = null;
      const reservationTtlSeconds = 300;

      reservationId = await unitOfWork.execute(async (ctx) => {
        if (!ctx.evidenceAsset) {
          throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
        }
        const usage = await ctx.evidenceAsset.getClientStorageUsage(input.clientId);
        if (
          usage.totalStoredBytes + usage.activeReservedBytes + exactBytes!.length >
          policy.maxClientStorageBytes
        ) {
          throw new QuotaExceededError(
            `Client storage quota exceeded: total stored ${usage.totalStoredBytes} bytes plus reserved ${usage.activeReservedBytes} bytes and payload ${exactBytes!.length} bytes exceeds maximum limit of ${policy.maxClientStorageBytes} bytes.`,
            { clientId: input.clientId }
          );
        }
        if (usage.concurrentInflightCount >= policy.maxConcurrentUploads) {
          throw new QuotaExceededError(
            `Client concurrent inflight upload limit reached: ${usage.concurrentInflightCount} >= ${policy.maxConcurrentUploads}.`,
            { clientId: input.clientId }
          );
        }
        return await ctx.evidenceAsset.createIngestReservation(
          input.clientId,
          originalSha256,
          exactBytes!.length,
          reservationTtlSeconds
        );
      });

      let s3PutSucceeded = false;
      // True once a conditional-write collision is detected: bytes under this
      // content-addressed hash were already persisted by a prior upload, so a
      // SourceObject row may already be committed for it (hash dedup; see
      // getSourceObjectByHash below). The readback verification further down
      // runs for BOTH this dedup case and a genuinely fresh PUT we just
      // performed ourselves (no prior committed row), so it needs this flag
      // to know whether an integrity failure there has an existing source to
      // quarantine.
      let isDedupCollision = false;

      try {
        // Staged conditional storage write
        try {
          await objectStorage.putObject({
            bucket: storageBucket,
            key: storageObjectKey,
            body: exactBytes!,
            contentType: detectedMimeType,
            checksumSha256: originalSha256,
            ifNoneMatch: "*"
          });
          s3PutSucceeded = true;
        } catch (error) {
          if (error instanceof ObjectAlreadyExistsError) {
            s3PutSucceeded = true; // Storage object already exists
            isDedupCollision = true;
            // A collision at this storage key means content-addressed storage
            // already has bytes under this hash — i.e. a SourceObject may
            // already be committed for it via hash dedup (see
            // getSourceObjectByHash below), not only a fresh pre-persistence
            // object. getObject() throws StorageIntegrityViolationError
            // (rather than returning a result to inspect) when it has
            // *proven* those existing bytes are corrupt; that must still be
            // quarantined via the same existing-source-by-hash lookup used
            // for a detected hash mismatch below, not left to propagate to
            // the outer reservation-only catch with no audit trail. Any
            // OTHER thrown error (network transport, timeout, auth,
            // cancellation) says nothing about byte integrity and must
            // propagate unchanged.
            let existingObject: Awaited<ReturnType<typeof objectStorage.getObject>>;
            try {
              existingObject = await objectStorage.getObject(
                {
                  bucket: storageBucket,
                  key: storageObjectKey
                },
                { maxBytes: exactBytes!.length + 1 }
              );
            } catch (getErr) {
              if (!(getErr instanceof StorageIntegrityViolationError)) {
                throw getErr;
              }
              const integrityMessage = getErr.message;
              await this.quarantineExistingSourceByHash(
                input.clientId,
                originalSha256,
                `Storage collision read failed: ${integrityMessage}`
              );
              throw new SourceIntegrityMismatchError(
                `Existing storage object at ${storageObjectKey} failed storage-side integrity check: ${integrityMessage}`,
                { expected: originalSha256 }
              );
            }
            if (!existingObject || !existingObject.body) {
              // Proven-missing (not thrown) result from the collision GET: the
              // storage object this hash's committed SourceObject depends on
              // is gone. Quarantine it the same as a thrown integrity
              // violation above, matching the existing missing-blob handling
              // for an explicitly reused source object.
              if (isDedupCollision) {
                await this.quarantineExistingSourceByHash(
                  input.clientId,
                  originalSha256,
                  "Storage collision read returned no object (blob missing)"
                );
              }
              throw new NotFoundError("SourceObjectBlob", storageObjectKey);
            }
            const existingBytes = Buffer.isBuffer(existingObject.body)
              ? existingObject.body
              : Buffer.from(existingObject.body);
            const existingSha256 = crypto.createHash("sha256").update(existingBytes).digest("hex");
            if (existingSha256 !== originalSha256) {
              await this.quarantineExistingSourceByHash(
                input.clientId,
                originalSha256,
                "Storage collision byte integrity mismatch"
              );
              throw new SourceIntegrityMismatchError(
                `Existing storage object at ${storageObjectKey} has mismatched checksum.`,
                { expected: originalSha256, actual: existingSha256 }
              );
            }
          } else {
            throw error;
          }
        }

        // Readback byte verification. This runs for BOTH a fresh PUT we just
        // performed ourselves (no prior committed SourceObject under this
        // hash) and the dedup-collision case above (isDedupCollision), where
        // an existing SourceObject may already be committed. An integrity
        // failure detected here — whether getObject() throwing
        // StorageIntegrityViolationError, or the explicit hash/length/
        // content-type mismatch check below — must be quarantined in the
        // dedup case for the same reason as the collision checks above; in
        // the fresh-PUT case there is nothing yet to quarantine.
        let readback: Awaited<ReturnType<typeof objectStorage.getObject>>;
        try {
          readback = await objectStorage.getObject(
            {
              bucket: storageBucket,
              key: storageObjectKey
            },
            { maxBytes: exactBytes!.length + 1 }
          );
        } catch (getErr) {
          if (!isDedupCollision || !(getErr instanceof StorageIntegrityViolationError)) {
            throw getErr;
          }
          const integrityMessage = getErr.message;
          await this.quarantineExistingSourceByHash(
            input.clientId,
            originalSha256,
            `Storage readback failed: ${integrityMessage}`
          );
          throw new SourceIntegrityMismatchError(
            `Existing storage object at ${storageObjectKey} failed storage-side integrity check on readback: ${integrityMessage}`,
            { expected: originalSha256 }
          );
        }
        if (!readback || !readback.body) {
          // As above: a proven-missing (not thrown) readback result means an
          // already-committed source's blob is gone when reached via the
          // dedup path, and must be quarantined the same way; the fresh-PUT
          // case has no prior committed row to quarantine.
          if (isDedupCollision) {
            await this.quarantineExistingSourceByHash(
              input.clientId,
              originalSha256,
              "Storage readback returned no object (blob missing)"
            );
          }
          throw new NotFoundError("SourceObjectBlob", storageObjectKey);
        }
        const readbackBytes = Buffer.isBuffer(readback.body)
          ? readback.body
          : Buffer.from(readback.body);
        const readbackSha = crypto.createHash("sha256").update(readbackBytes).digest("hex");
        const readbackContentType = readback.contentType?.toLowerCase();
        if (
          readbackSha !== originalSha256 ||
          readbackBytes.length !== exactBytes!.length ||
          (readbackContentType && readbackContentType !== detectedMimeType)
        ) {
          if (isDedupCollision) {
            await this.quarantineExistingSourceByHash(
              input.clientId,
              originalSha256,
              "Storage readback byte integrity mismatch"
            );
          }
          throw new SourceIntegrityMismatchError(
            `Storage object readback at ${storageObjectKey} failed integrity check: expected hash ${originalSha256}, got ${readbackSha}; expected length ${exactBytes!.length}, got ${readbackBytes.length}; expected contentType ${detectedMimeType}, got ${readbackContentType}`,
            { expected: originalSha256, actual: readbackSha }
          );
        }

        // Atomic DB persistence
        const result = (await unitOfWork.execute(async (ctx) => {
          if (!ctx.evidenceAsset) {
            throw new Error("UnitOfWorkContext does not contain evidenceAsset repository.");
          }

          return await ctx.evidenceAsset.registerEvidence({
            clientId: input.clientId,
            actionId: createActionId(actionId),
            actorId: input.actorId,
            timestamp: timestamp as IsoTimestampString,
            payload: commandPayload
          });
        })) as RegisterEvidenceResult;

        // Check if source was newly created vs deduplicated
        if (reservationId) {
          const status = result.isNewSourceObject ? "committed" : "released";
          await unitOfWork
            .execute(async (ctx) => {
              await ctx.evidenceAsset?.completeIngestReservation(reservationId!, status);
            })
            .catch((err) => {
              logger?.warn?.(`Failed to mark ingest reservation as ${status}:`, err);
            });
          reservationId = null;
        }

        return result;
      } catch (error) {
        if (reservationId) {
          const status = s3PutSucceeded ? "abandoned" : "released";
          await unitOfWork
            .execute(async (ctx) => {
              await ctx.evidenceAsset?.completeIngestReservation(reservationId!, status);
            })
            .catch((err) => {
              logger?.warn?.(`Failed to complete ingest reservation as ${status}:`, err);
            });
        }
        throw error;
      }
    });
  }
}
