import { z } from "zod";
import { ExecutionRealmSchema, EvidenceOriginSchema } from "./execution-realm.js";
import { AssemblySpecSchema } from "./assembly-spec.js";
import { sha256HashSchema } from "./persistent-media.js";
import { AssemblyManifestSchema } from "./assembly-manifest.js";

export const OperatorAcceptanceRunStatusSchema = z.enum([
  "dispatched",
  "acceptance_review",
  "assembling",
  "completed",
  "failed",
  "cancelled"
]);
export type OperatorAcceptanceRunStatus = z.infer<typeof OperatorAcceptanceRunStatusSchema>;

export const OperatorAcceptanceRunSchema = z
  .object({
    acceptanceRunId: z.string().uuid(),
    campaignId: z.string().uuid(),
    status: OperatorAcceptanceRunStatusSchema,
    realm: ExecutionRealmSchema,
    evidenceOrigin: EvidenceOriginSchema,
    planId: z.string().uuid(),
    expectedTotalDurationMs: z.number().int().positive(),
    assemblyJobId: z.string().optional(),
    createdBy: z.string().trim().min(1),
    actionReceiptId: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();
export type OperatorAcceptanceRun = z.infer<typeof OperatorAcceptanceRunSchema>;

export const AcceptanceRunSceneSchema = z
  .object({
    acceptanceRunId: z.string().uuid(),
    sceneId: z.string().uuid(),
    allocationId: z.string().uuid(),
    specRevision: z.number().int().positive(),
    sequenceIndex: z.number().int().positive(),
    profileKey: z.string().trim().min(1),
    frames: z.number().int().positive(),
    fps: z.number().positive(),
    expectedDurationMs: z.number().int().positive(),
    currentAttemptId: z.string().uuid().optional(),
    currentAttemptOrdinal: z.number().int().positive().default(1),
    acceptedAttemptId: z.string().uuid().optional(),
    acceptedStagingJobId: z.string().optional(),
    acceptedAttemptOrdinal: z.number().int().positive().optional(),
    candidateSpecificationDigest: sha256HashSchema.optional(),
    planId: z.string().uuid().optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasAttempt = val.acceptedAttemptId !== undefined;
    const hasOrdinal = val.acceptedAttemptOrdinal !== undefined;
    if (hasAttempt !== hasOrdinal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "acceptedAttemptId and acceptedAttemptOrdinal must be provided together"
      });
    }
    if (hasAttempt && val.acceptedStagingJobId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "acceptedStagingJobId is required when scene is accepted"
      });
    }
  });
export type AcceptanceRunScene = z.infer<typeof AcceptanceRunSceneSchema>;

export const AcceptanceAssemblyJobStatusSchema = z.enum([
  "queued",
  "leased",
  "rendering",
  "completed",
  "failed"
]);
export type AcceptanceAssemblyJobStatus = z.infer<typeof AcceptanceAssemblyJobStatusSchema>;

export const AcceptanceAssemblyJobSchema = z
  .object({
    jobId: z.string().uuid(),
    acceptanceRunId: z.string().uuid(),
    campaignId: z.string().uuid(),
    status: AcceptanceAssemblyJobStatusSchema,
    realm: ExecutionRealmSchema,
    evidenceOrigin: EvidenceOriginSchema,
    assemblySpec: AssemblySpecSchema,
    leaseToken: z.string().uuid().optional(),
    leaseExpiresAt: z.string().datetime().optional(),
    workerId: z.string().optional(),
    outputManifestId: z.string().uuid().optional(),
    failureReason: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "leased" || val.status === "rendering") {
      if (!val.leaseToken || !val.leaseExpiresAt || !val.workerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `status '${val.status}' requires leaseToken, leaseExpiresAt, and workerId`
        });
      }
    }
    if (val.status === "completed" && !val.outputManifestId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status 'completed' requires outputManifestId"
      });
    }
    if (val.status === "failed" && !val.failureReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status 'failed' requires failureReason"
      });
    }
  });
export type AcceptanceAssemblyJob = z.infer<typeof AcceptanceAssemblyJobSchema>;

export const AcceptanceAssemblyManifestSchema = z
  .object({
    manifestId: z.string().uuid(),
    jobId: z.string().uuid(),
    acceptanceRunId: z.string().uuid(),
    campaignId: z.string().uuid(),
    realm: ExecutionRealmSchema,
    evidenceOrigin: EvidenceOriginSchema,
    planId: z.string().uuid(),
    acceptedAttemptIds: z.array(z.string().uuid()),
    manifest: AssemblyManifestSchema,
    storageBucket: z.string().min(1),
    storageKey: z.string().min(1),
    storageSha256: sha256HashSchema,
    manifestStorageBucket: z.string().min(1),
    manifestStorageKey: z.string().min(1),
    manifestStorageSha256: sha256HashSchema,
    createdAt: z.string().datetime()
  })
  .strict();
export type AcceptanceAssemblyManifest = z.infer<typeof AcceptanceAssemblyManifestSchema>;

export const OperatorAcceptanceActionScopeSchema = z.enum([
  "begin",
  "accept_scene",
  "rerender_scene",
  "assemble",
  "complete"
]);
export type OperatorAcceptanceActionScope = z.infer<typeof OperatorAcceptanceActionScopeSchema>;

export const OperatorAcceptanceActionReceiptSchema = z
  .object({
    actionId: z.string().trim().min(1),
    scope: OperatorAcceptanceActionScopeSchema,
    runOrCampaignId: z.string().uuid(),
    realm: ExecutionRealmSchema,
    requestHash: sha256HashSchema,
    response: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime()
  })
  .strict();
export type OperatorAcceptanceActionReceipt = z.infer<typeof OperatorAcceptanceActionReceiptSchema>;

export const AcceptanceRunReelStemLineageEntrySchema = z
  .object({
    sceneId: z.string().uuid(),
    attemptId: z.string().uuid(),
    storageKey: z.string(),
    sha256: sha256HashSchema
  })
  .strict();
export type AcceptanceRunReelStemLineageEntry = z.infer<
  typeof AcceptanceRunReelStemLineageEntrySchema
>;

export const AcceptanceRunReelReadModelSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("pending"),
      acceptanceRunId: z.string().uuid(),
      campaignId: z.string().uuid(),
      realm: ExecutionRealmSchema,
      evidenceOrigin: EvidenceOriginSchema,
      updatedAt: z.string().datetime(),
      message: z.string().optional()
    })
    .strict(),
  z
    .object({
      status: z.literal("assembling"),
      acceptanceRunId: z.string().uuid(),
      campaignId: z.string().uuid(),
      realm: ExecutionRealmSchema,
      evidenceOrigin: EvidenceOriginSchema,
      updatedAt: z.string().datetime(),
      assemblyJobId: z.string().uuid(),
      message: z.string().optional()
    })
    .strict(),
  z
    .object({
      status: z.literal("completed"),
      acceptanceRunId: z.string().uuid(),
      campaignId: z.string().uuid(),
      realm: ExecutionRealmSchema,
      evidenceOrigin: EvidenceOriginSchema,
      updatedAt: z.string().datetime(),
      assemblyJobId: z.string().uuid(),
      manifestId: z.string().uuid(),
      manifest: AssemblyManifestSchema,
      storageBucket: z.string().min(1),
      storageKey: z.string().min(1),
      storageSha256: sha256HashSchema,
      manifestStorageBucket: z.string().min(1),
      manifestStorageKey: z.string().min(1),
      manifestStorageSha256: sha256HashSchema,
      bytes: z.number().int().positive().optional(),
      url: z.string().url(),
      downloadUrl: z.string().url().optional(),
      durationMs: z.number().int().positive(),
      frameCount: z.number().int().positive(),
      fps: z.number().positive(),
      resolution: z
        .object({
          width: z.number().int().positive(),
          height: z.number().int().positive()
        })
        .strict(),
      stemLineage: z.array(AcceptanceRunReelStemLineageEntrySchema).optional(),
      completedAt: z.string().datetime()
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      acceptanceRunId: z.string().uuid(),
      campaignId: z.string().uuid(),
      realm: ExecutionRealmSchema,
      evidenceOrigin: EvidenceOriginSchema,
      updatedAt: z.string().datetime(),
      assemblyJobId: z.string().uuid().optional(),
      failureReason: z.string()
    })
    .strict(),
  z
    .object({
      status: z.literal("unavailable"),
      acceptanceRunId: z.string().uuid(),
      campaignId: z.string().uuid(),
      realm: ExecutionRealmSchema,
      evidenceOrigin: EvidenceOriginSchema,
      updatedAt: z.string().datetime(),
      reason: z.string()
    })
    .strict()
]);
export type AcceptanceRunReelReadModel = z.infer<typeof AcceptanceRunReelReadModelSchema>;

export const BeginOperatorAcceptanceRunRequestSchema = z
  .object({
    campaignId: z.string().uuid(),
    actionId: z.string().trim().min(1),
    requestedBy: z.string().trim().min(1)
  })
  .strict();
export type BeginOperatorAcceptanceRunRequest = z.infer<
  typeof BeginOperatorAcceptanceRunRequestSchema
>;

export const BeginOperatorAcceptanceRunResponseSchema = z
  .object({
    acceptanceRunId: z.string().uuid(),
    campaignId: z.string().uuid(),
    status: OperatorAcceptanceRunStatusSchema,
    sceneCount: z.number().int().positive(),
    dispatchedJobIds: z.array(z.string())
  })
  .strict();
export type BeginOperatorAcceptanceRunResponse = z.infer<
  typeof BeginOperatorAcceptanceRunResponseSchema
>;

export const AcceptAcceptanceSceneRequestSchema = z
  .object({
    actionId: z.string().trim().min(1),
    expectedAttemptOrdinal: z.number().int().positive(),
    acceptedBy: z.string().trim().min(1)
  })
  .strict();
export type AcceptAcceptanceSceneRequest = z.infer<typeof AcceptAcceptanceSceneRequestSchema>;

export const RerenderAcceptanceSceneRequestSchema = z
  .object({
    actionId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    requestedBy: z.string().trim().min(1)
  })
  .strict();
export type RerenderAcceptanceSceneRequest = z.infer<typeof RerenderAcceptanceSceneRequestSchema>;

export const AssembleOperatorAcceptanceRunRequestSchema = z
  .object({
    actionId: z.string().trim().min(1),
    requestedBy: z.string().trim().min(1)
  })
  .strict();
export type AssembleOperatorAcceptanceRunRequest = z.infer<
  typeof AssembleOperatorAcceptanceRunRequestSchema
>;

export const AssembleOperatorAcceptanceRunResponseSchema = z
  .object({
    acceptanceRunId: z.string().uuid(),
    assemblyJobId: z.string().uuid(),
    status: z.literal("assembling")
  })
  .strict();
export type AssembleOperatorAcceptanceRunResponse = z.infer<
  typeof AssembleOperatorAcceptanceRunResponseSchema
>;

export class OperatorAcceptanceRunNotFoundError extends Error {
  override readonly name = "OperatorAcceptanceRunNotFoundError";
  readonly acceptanceRunId: string;
  readonly httpStatusCode = 404;

  constructor(acceptanceRunId: string, message?: string) {
    super(message ?? `Operator acceptance run '${acceptanceRunId}' was not found`);
    this.acceptanceRunId = acceptanceRunId;
  }
}

export class OperatorAcceptanceSceneNotFoundError extends Error {
  override readonly name = "OperatorAcceptanceSceneNotFoundError";
  readonly acceptanceRunId: string;
  readonly sceneId: string;
  readonly httpStatusCode = 404;

  constructor(acceptanceRunId: string, sceneId: string, message?: string) {
    super(message ?? `Scene '${sceneId}' was not found in acceptance run '${acceptanceRunId}'`);
    this.acceptanceRunId = acceptanceRunId;
    this.sceneId = sceneId;
  }
}

export class OperatorAcceptanceOrdinalMismatchError extends Error {
  override readonly name = "OperatorAcceptanceOrdinalMismatchError";
  readonly expectedOrdinal: number;
  readonly actualOrdinal: number;
  readonly httpStatusCode = 409;

  constructor(expectedOrdinal: number, actualOrdinal: number, message?: string) {
    super(
      message ??
        `Expected attempt ordinal ${expectedOrdinal}, but current attempt ordinal is ${actualOrdinal}`
    );
    this.expectedOrdinal = expectedOrdinal;
    this.actualOrdinal = actualOrdinal;
  }
}

export class OperatorAcceptanceInvalidStatusError extends Error {
  override readonly name = "OperatorAcceptanceInvalidStatusError";
  readonly status: string;
  readonly httpStatusCode = 422;

  constructor(status: string, message?: string) {
    super(message ?? `Cannot perform operation in acceptance run status '${status}'`);
    this.status = status;
  }
}

export class OperatorAcceptanceSceneNotAcceptedError extends Error {
  override readonly name = "OperatorAcceptanceSceneNotAcceptedError";
  readonly sceneId: string;
  readonly httpStatusCode = 422;

  constructor(sceneId: string, message?: string) {
    super(message ?? `Scene '${sceneId}' has not been accepted`);
    this.sceneId = sceneId;
  }
}

export class OperatorAcceptanceIdempotencyConflictError extends Error {
  override readonly name = "OperatorAcceptanceIdempotencyConflictError";
  readonly actionId: string;
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly httpStatusCode = 409;

  constructor(actionId: string, message?: string) {
    super(
      message ??
        `Operator acceptance action '${actionId}' conflict: cannot replay action with different parameters`
    );
    this.actionId = actionId;
  }
}
