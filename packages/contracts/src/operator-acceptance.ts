import { z } from "zod";
import { ExecutionRealmSchema, EvidenceOriginSchema } from "./execution-realm.js";
import { AssemblySpecSchema } from "./assembly-spec.js";

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
    acceptedAttemptOrdinal: z.number().int().positive().optional()
  })
  .strict();
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
  .strict();
export type AcceptanceAssemblyJob = z.infer<typeof AcceptanceAssemblyJobSchema>;

export const AcceptanceAssemblyManifestSchema = z
  .object({
    manifestId: z.string().uuid(),
    jobId: z.string().uuid(),
    acceptanceRunId: z.string().uuid(),
    campaignId: z.string().uuid(),
    manifest: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime()
  })
  .strict();
export type AcceptanceAssemblyManifest = z.infer<typeof AcceptanceAssemblyManifestSchema>;

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
