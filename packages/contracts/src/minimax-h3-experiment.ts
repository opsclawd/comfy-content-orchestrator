import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod";
import {
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP
} from "./render-profile.js";

export const PINNED_COMFYUI_CORE_REVISION = "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc";

export const PINNED_COMFYUI_SOURCE_HASHES = Object.freeze({
  cliArgsSha256: "139324c0ed7d0f70431a097032fec6fbe34e8b26f42d896e5364704b139defe8",
  mainSha256: "1ae7e09238355bcc2b415662e2baf2becdccb148ec27a46d053fabbd9a6b0e08",
  modelManagementSha256: "ddf5fe6399398d9101850d42604dce20eec0a6b6cba18135ea4ad5d3da3de99e"
});

function sortKeysRecursively(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysRecursively);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const sortedObject: Record<string, unknown> = Object.create(null);
  for (const key of sortedKeys) {
    sortedObject[key] = sortKeysRecursively(record[key]);
  }
  return sortedObject;
}

export function canonicalizeJson(value: unknown): string {
  const sorted = sortKeysRecursively(value);
  return JSON.stringify(sorted);
}

// Uses @noble/hashes (pure JS, isomorphic) rather than node:crypto so this
// module stays safe to bundle into browser code — packages/contracts is
// imported by apps/web client components, and a "node:crypto" import
// cannot be resolved there (see subtitle-cue.ts's hashSubtitleCues for the
// same precedent).
export function sha256Hex(content: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(content)));
}

export function computeDescriptorDigest(descriptor: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(descriptor)) {
    if (key !== "descriptorDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

export function computeComparisonKey(options: {
  route: string;
  frames: number;
  requestedDurationMs?: number | null;
  width: number;
  height: number;
  promptDigest: string;
  seed: number;
  references?: ReadonlyArray<{
    slotIndex: number;
    role: string;
    tag: string;
    order: number;
    sha256: string;
  }>;
  referenceHashes?: readonly string[];
  runnerVariant: string;
  memoryPolicy: string;
  modelDigests?: Record<string, string> | null;
  target?: { hostname: string; gpuUuid: string } | null;
}): string {
  const payload = {
    route: options.route,
    frames: options.frames,
    requestedDurationMs: options.requestedDurationMs ?? null,
    width: options.width,
    height: options.height,
    promptDigest: options.promptDigest,
    seed: options.seed,
    references:
      options.references ??
      (options.referenceHashes
        ? options.referenceHashes.map((h, i) => ({
            slotIndex: i,
            role: "reference",
            tag: `<Picture ${i + 1}>`,
            order: i,
            sha256: h
          }))
        : []),
    runnerVariant: options.runnerVariant,
    memoryPolicy: options.memoryPolicy,
    modelDigests: options.modelDigests ?? null,
    target: options.target ?? null
  };
  return sha256Hex(canonicalizeJson(payload));
}

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

export const MINIMAX_H3_EXPERIMENT_CANDIDATE_FRAMES = [124, 192, 243, 362] as const;
export type MinimaxH3ExperimentCandidateFrames =
  (typeof MINIMAX_H3_EXPERIMENT_CANDIDATE_FRAMES)[number];

export const MinimaxH3ExperimentCandidateFramesSchema = z.union([
  z.literal(124),
  z.literal(192),
  z.literal(243),
  z.literal(362)
]);

export function isGridValidMinimaxH3FrameCount(frames: number): boolean {
  if (!Number.isSafeInteger(frames) || frames <= 0) {
    return false;
  }
  return (frames - MINIMAX_H3_FRAME_GRID_BASE) % MINIMAX_H3_FRAME_GRID_STEP === 0;
}

export function validateMinimaxH3ExperimentFrameCount(
  frames: unknown
): MinimaxH3ExperimentCandidateFrames {
  if (typeof frames !== "number" || !Number.isSafeInteger(frames) || frames <= 0) {
    throw new Error(
      `Candidate frame count must be a safe positive integer, received: ${String(frames)}`
    );
  }
  if (!isGridValidMinimaxH3FrameCount(frames)) {
    throw new Error(
      `Frame count ${frames} violates the MiniMax-H3 grid rule: (frames - ${MINIMAX_H3_FRAME_GRID_BASE}) % ${MINIMAX_H3_FRAME_GRID_STEP} === 0`
    );
  }
  if (
    !MINIMAX_H3_EXPERIMENT_CANDIDATE_FRAMES.includes(frames as MinimaxH3ExperimentCandidateFrames)
  ) {
    throw new Error(
      `Frame count ${frames} is on-grid but out-of-scope for the feasibility experiment. Allowed candidate counts: ${MINIMAX_H3_EXPERIMENT_CANDIDATE_FRAMES.join(", ")}`
    );
  }
  return frames as MinimaxH3ExperimentCandidateFrames;
}

export interface MinimaxH3FrameDurationInfo {
  readonly frames: MinimaxH3ExperimentCandidateFrames;
  readonly k: number;
  readonly rationalDurationSeconds: string;
  readonly approximateDurationSeconds: number;
  readonly configuredDurationMs: number;
}

export function getMinimaxH3FrameDurationInfo(
  frames: MinimaxH3ExperimentCandidateFrames
): MinimaxH3FrameDurationInfo {
  switch (frames) {
    case 124:
      return {
        frames: 124,
        k: 7,
        rationalDurationSeconds: "31/6",
        approximateDurationSeconds: 124 / 24,
        configuredDurationMs: Math.round((124 / MINIMAX_H3_FPS) * 1000) // 5167
      };
    case 192:
      return {
        frames: 192,
        k: 11,
        rationalDurationSeconds: "8",
        approximateDurationSeconds: 8,
        configuredDurationMs: Math.round((192 / MINIMAX_H3_FPS) * 1000) // 8000
      };
    case 243:
      return {
        frames: 243,
        k: 14,
        rationalDurationSeconds: "81/8",
        approximateDurationSeconds: 81 / 8,
        configuredDurationMs: Math.round((243 / MINIMAX_H3_FPS) * 1000) // 10125
      };
    case 362:
      return {
        frames: 362,
        k: 21,
        rationalDurationSeconds: "181/12",
        approximateDurationSeconds: 362 / 24,
        configuredDurationMs: Math.round((362 / MINIMAX_H3_FPS) * 1000) // 15083
      };
  }
}

export const MinimaxH3ExperimentRouteSchema = z.enum(["i2v", "ref2v"]);
export type MinimaxH3ExperimentRoute = z.infer<typeof MinimaxH3ExperimentRouteSchema>;

export const MinimaxH3MemoryPolicySchema = z.enum(["dynamic_vram", "static_lowvram"]);
export type MinimaxH3MemoryPolicy = z.infer<typeof MinimaxH3MemoryPolicySchema>;

export const MinimaxH3RequestedRunnerPolicySchema = z
  .object({
    variantName: z.string().min(1),
    variantReason: z.string().min(1).nullable(),
    memoryPolicy: MinimaxH3MemoryPolicySchema,
    offloadSettings: z
      .object({
        modelOffload: z.boolean()
      })
      .strict()
  })
  .strict();
export type MinimaxH3RequestedRunnerPolicy = z.infer<typeof MinimaxH3RequestedRunnerPolicySchema>;

export const MinimaxH3ConfiguredRunnerPolicySchema = z
  .object({
    argv: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    predictedPolicy: MinimaxH3MemoryPolicySchema,
    pinnedSourceIdentities: z
      .object({
        cliArgsSha256: sha256HashSchema,
        mainSha256: sha256HashSchema,
        modelManagementSha256: sha256HashSchema
      })
      .strict()
  })
  .strict();
export type MinimaxH3ConfiguredRunnerPolicy = z.infer<typeof MinimaxH3ConfiguredRunnerPolicySchema>;

export const MinimaxH3ObservedEffectiveModeSchema = z
  .object({
    status: z.enum(["verified", "unknown"]),
    value: MinimaxH3MemoryPolicySchema.nullable(),
    unknownReason: z.string().min(1).nullable(),
    evidence: z
      .object({
        diagnostics: z.array(z.string()),
        sourceRevision: z.string(),
        sourcePath: z.string(),
        sourceDigest: sha256HashSchema,
        logOffsets: z.array(z.number().int().nonnegative()).optional(),
        timestamps: z.array(z.string()).optional()
      })
      .strict()
      .nullable()
  })
  .strict();
export type MinimaxH3ObservedEffectiveMode = z.infer<typeof MinimaxH3ObservedEffectiveModeSchema>;

export const MinimaxH3ObservedRunnerPolicySchema = z
  .object({
    argv: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    pid: z.number().int().positive().nullable(),
    processStartTimeTicks: z.number().int().nonnegative().nullable(),
    targetGpuUuid: z.string().nullable(),
    effectiveMode: MinimaxH3ObservedEffectiveModeSchema
  })
  .strict();
export type MinimaxH3ObservedRunnerPolicy = z.infer<typeof MinimaxH3ObservedRunnerPolicySchema>;

export const MinimaxH3ReferenceDescriptorSchema = z
  .object({
    slotIndex: z.number().int().min(0).max(8),
    role: z.string().min(1),
    tag: z.string().regex(/^<Picture [1-9]\d*>$/, "Tag must be <Picture 1> through <Picture N>"),
    order: z.number().int().min(0).max(8),
    assetPath: z.string().min(1),
    stagedFilename: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/, "Staged filename must be safe basename without slashes")
      .refine(
        (name) => !name.includes("..") && !name.includes("/") && !name.includes("\\"),
        "Staged filename cannot contain path traversal or slashes"
      ),
    sha256: sha256HashSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    mimeType: z.string().min(1)
  })
  .strict();
export type MinimaxH3ReferenceDescriptor = z.infer<typeof MinimaxH3ReferenceDescriptorSchema>;

export const MinimaxH3TargetSpecificationSchema = z
  .object({
    hostname: z.string().min(1),
    gpuUuid: z.string().regex(/^GPU-[0-9a-fA-F-]+$/, "Must be a valid NVIDIA GPU UUID"),
    comfyUiDir: z.string().min(1),
    pythonPath: z.string().min(1),
    address: z
      .string()
      .regex(
        /^(?:127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}|::1)$/,
        "Target address must be a numeric loopback address (127.x.y.z or ::1)"
      ),
    port: z.number().int().min(1).max(65535)
  })
  .strict();
export type MinimaxH3TargetSpecification = z.infer<typeof MinimaxH3TargetSpecificationSchema>;

// Upper bounds exist so a tampered/malformed descriptor can't encode an
// effectively-unbounded timeout (e.g. Number.MAX_SAFE_INTEGER) that would
// hang the harness indefinitely; each cap is well above its corresponding
// default in DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS below to allow operator
// tuning without permitting unbounded values.
export const MinimaxH3ExperimentTimeoutsSchema = z
  .object({
    startupTimeoutMs: z.number().int().positive().max(600_000),
    submissionTimeoutMs: z.number().int().positive().max(300_000),
    pollIntervalMs: z.number().int().positive().max(60_000),
    totalRenderTimeoutMs: z.number().int().positive().max(3_600_000),
    probeTimeoutMs: z.number().int().positive().max(300_000),
    settlementTimeoutMs: z.number().int().positive().max(120_000),
    shutdownTimeoutMs: z.number().int().positive().max(120_000)
  })
  .strict();
export type MinimaxH3ExperimentTimeouts = z.infer<typeof MinimaxH3ExperimentTimeoutsSchema>;

export const DEFAULT_MINIMAX_H3_EXPERIMENT_TIMEOUTS: MinimaxH3ExperimentTimeouts = Object.freeze({
  startupTimeoutMs: 120_000,
  submissionTimeoutMs: 30_000,
  pollIntervalMs: 1_000,
  totalRenderTimeoutMs: 1_200_000, // 20 minutes max
  probeTimeoutMs: 60_000,
  settlementTimeoutMs: 10_000,
  shutdownTimeoutMs: 15_000
});

export const MinimaxH3ExperimentDescriptorSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("non-production-experiment"),
    runId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Invalid runId format"),
    operatorLabel: z.string().min(1),
    route: MinimaxH3ExperimentRouteSchema,
    configuredFrames: MinimaxH3ExperimentCandidateFramesSchema,
    fps: z.literal(24),
    requestedDurationMs: z.number().int().positive(),
    requestedDurationSupplied: z.boolean(),
    configuredDurationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    prompt: z.string().min(1),
    promptDigest: sha256HashSchema,
    baseProfileKey: z.enum(["MINIMAX_H3_720P_5S_I2V_V1", "MINIMAX_H3_720P_5S_REF2V_V1"]),
    baseProfileVersion: z.literal(1),
    baseProfileFileDigest: sha256HashSchema,
    provenanceManifestDigest: sha256HashSchema,
    provenanceSource: z.enum(["authored_from_spec", "validated_host_export"]),
    baseCanonicalWorkflowDigest: sha256HashSchema,
    derivedWorkflowDigest: sha256HashSchema,
    pinFileIdentities: z
      .object({
        comfyuiCoreRevision: z.string().min(1),
        minimaxH3Revision: z.string().min(1),
        modelDigests: z.record(z.string(), sha256HashSchema)
      })
      .strict(),
    resolvedModelPaths: z.record(
      z.string(),
      z
        .object({
          expectedHash: sha256HashSchema,
          resolvedPath: z.string().min(1),
          sizeBytes: z.number().int().positive()
        })
        .strict()
    ),
    referenceSetId: z.string().min(1),
    references: z.array(MinimaxH3ReferenceDescriptorSchema),
    refImageSize: z.enum(["max", "match"]).optional(),
    requestedRunner: MinimaxH3RequestedRunnerPolicySchema,
    configuredRunner: MinimaxH3ConfiguredRunnerPolicySchema,
    target: MinimaxH3TargetSpecificationSchema,
    collectionIntervalMs: z.number().int().positive().max(60_000),
    timeouts: MinimaxH3ExperimentTimeoutsSchema,
    configDigest: sha256HashSchema,
    descriptorDigest: sha256HashSchema.optional(),
    comparisonKey: z.string().min(1)
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.route === "i2v") {
      if (val.references.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Route 'i2v' requires exactly 1 reference image descriptor",
          path: ["references"]
        });
      }
      if (val.baseProfileKey !== "MINIMAX_H3_720P_5S_I2V_V1") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Route 'i2v' requires baseProfileKey 'MINIMAX_H3_720P_5S_I2V_V1'",
          path: ["baseProfileKey"]
        });
      }
    } else if (val.route === "ref2v") {
      if (val.references.length > 9) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Route 'ref2v' accepts at most 9 reference image descriptors",
          path: ["references"]
        });
      }
      if (val.baseProfileKey !== "MINIMAX_H3_720P_5S_REF2V_V1") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Route 'ref2v' requires baseProfileKey 'MINIMAX_H3_720P_5S_REF2V_V1'",
          path: ["baseProfileKey"]
        });
      }
    }
    if ((val.configuredFrames - 5) % 17 !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `configuredFrames ${val.configuredFrames} is not on the grid (frames - 5) % 17 === 0`,
        path: ["configuredFrames"]
      });
    }
    // width/height admission only happens in prepareExperiment
    // (resolution must be the default or one of the named supported
    // variants). Without this check here too, a hand-crafted or tampered
    // descriptor.json with arbitrary dimensions would still pass schema
    // validation during validateExperiment, bypassing admission entirely.
    const isSupportedDimensionPair =
      (val.width === 1344 && val.height === 768) || // default
      (val.width === 1280 && val.height === 720) || // 720p
      (val.width === 1024 && val.height === 576) || // 576p
      (val.width === 896 && val.height === 512); // 512p
    if (!isSupportedDimensionPair) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `width/height ${val.width}x${val.height} is not the default (1344x768) or a supported named resolution variant (1280x720, 1024x576, 896x512)`,
        path: ["width"]
      });
    }
    const computedPromptDigest = sha256Hex(val.prompt);
    if (val.promptDigest !== computedPromptDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "promptDigest does not match sha256(prompt)",
        path: ["promptDigest"]
      });
    }
    if (val.descriptorDigest !== undefined) {
      const computedDescriptorDigest = computeDescriptorDigest(
        val as unknown as Record<string, unknown>
      );
      if (val.descriptorDigest !== computedDescriptorDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `descriptorDigest does not match recomputed digest: expected ${computedDescriptorDigest}, got ${val.descriptorDigest}`,
          path: ["descriptorDigest"]
        });
      }
    }
  });
export type MinimaxH3ExperimentDescriptor = z.infer<typeof MinimaxH3ExperimentDescriptorSchema>;

export const MinimaxH3ExperimentIntentSchema = z
  .object({
    runId: z.string().min(1),
    clientId: z.string().min(1),
    workflowDigest: sha256HashSchema,
    requestFingerprint: sha256HashSchema,
    timestamp: z.string().datetime()
  })
  .strict();
export type MinimaxH3ExperimentIntent = z.infer<typeof MinimaxH3ExperimentIntentSchema>;

export const MinimaxH3ExperimentReceiptSchema = z
  .object({
    runId: z.string().min(1),
    promptId: z.string().min(1),
    acceptedAt: z.string().datetime()
  })
  .strict();
export type MinimaxH3ExperimentReceipt = z.infer<typeof MinimaxH3ExperimentReceiptSchema>;

export const MinimaxH3ExperimentEventSchema = z
  .object({
    timestamp: z.string(),
    event: z.string().min(1),
    details: z.unknown().optional()
  })
  .strict();
export type MinimaxH3ExperimentEvent = z.infer<typeof MinimaxH3ExperimentEventSchema>;

export const MinimaxH3LifecycleStatusSchema = z.enum([
  "prepared",
  "starting",
  "submission_pending",
  "running",
  "completed",
  "failed",
  "interrupted",
  "submission_unknown"
]);
export type MinimaxH3LifecycleStatus = z.infer<typeof MinimaxH3LifecycleStatusSchema>;

export const MinimaxH3ExecutionStatusSchema = z.enum([
  "not_started",
  "queued",
  "running",
  "completed",
  "failed",
  "unknown"
]);
export type MinimaxH3ExecutionStatus = z.infer<typeof MinimaxH3ExecutionStatusSchema>;

export const MinimaxH3CollectionStatusSchema = z.enum([
  "not_started",
  "complete",
  "partial",
  "failed"
]);
export type MinimaxH3CollectionStatus = z.infer<typeof MinimaxH3CollectionStatusSchema>;

export const MinimaxH3ProbeStatusSchema = z.enum(["not_started", "succeeded", "partial", "failed"]);
export type MinimaxH3ProbeStatus = z.infer<typeof MinimaxH3ProbeStatusSchema>;

export const MinimaxH3OutputConformanceStatusSchema = z.enum([
  "unknown",
  "conformant",
  "nonconformant"
]);
export type MinimaxH3OutputConformanceStatus = z.infer<
  typeof MinimaxH3OutputConformanceStatusSchema
>;

export const MinimaxH3VisualReviewStatusSchema = z.enum(["pending", "reviewed", "unavailable"]);
export type MinimaxH3VisualReviewStatus = z.infer<typeof MinimaxH3VisualReviewStatusSchema>;

export const MinimaxH3OperatorDecisionStatusSchema = z.enum([
  "pending",
  "approve_candidate",
  "no_go",
  "unknown"
]);
export type MinimaxH3OperatorDecisionStatus = z.infer<typeof MinimaxH3OperatorDecisionStatusSchema>;

export const MinimaxH3GpuSampleSchema = z
  .object({
    timestamp: z.string().datetime(),
    deviceUuid: z.string().min(1),
    totalVramMb: z.number().int().nonnegative(),
    usedVramMb: z.number().int().nonnegative(),
    freeVramMb: z.number().int().nonnegative(),
    allocatableVramMb: z.number().int().nonnegative()
  })
  .strict();
export type MinimaxH3GpuSample = z.infer<typeof MinimaxH3GpuSampleSchema>;

export const MinimaxH3HostSampleSchema = z
  .object({
    timestamp: z.string().datetime(),
    totalRamMb: z.number().int().nonnegative(),
    availableRamMb: z.number().int().nonnegative(),
    usedRamMb: z.number().int().nonnegative(),
    processPid: z.number().int().positive(),
    processStartTimeTicks: z.number().int().nonnegative(),
    processRssMb: z.number().int().nonnegative(),
    swapTotalMb: z.number().int().nonnegative(),
    swapUsedMb: z.number().int().nonnegative(),
    swapInPages: z.number().int().nonnegative(),
    swapOutPages: z.number().int().nonnegative()
  })
  .strict();
export type MinimaxH3HostSample = z.infer<typeof MinimaxH3HostSampleSchema>;

export const MinimaxH3TelemetrySampleSchema = z
  .object({
    timestamp: z.string().datetime(),
    phase: z.enum(["before", "during", "after"]),
    gpu: MinimaxH3GpuSampleSchema.nullable(),
    host: MinimaxH3HostSampleSchema.nullable(),
    error: z.string().nullable()
  })
  .strict();
export type MinimaxH3TelemetrySample = z.infer<typeof MinimaxH3TelemetrySampleSchema>;

export const MinimaxH3MeasuredStreamFactsSchema = z
  .object({
    measuredFrames: z.number().int().nonnegative().nullable(),
    countedFramesSource: z.literal("nb_read_frames").nullable(),
    declaredNbFrames: z.number().int().nonnegative().nullable(),
    measuredVideoDurationMs: z.number().int().positive().nullable(),
    measuredContainerDurationMs: z.number().int().positive().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.number().positive().nullable(),
    rFrameRate: z.string().nullable(),
    avgFrameRate: z.string().nullable(),
    videoCodec: z.string().nullable(),
    audioCodec: z.string().nullable(),
    audioChannels: z.number().int().nonnegative().nullable(),
    audioSampleRate: z.number().int().nonnegative().nullable()
  })
  .strict();
export type MinimaxH3MeasuredStreamFacts = z.infer<typeof MinimaxH3MeasuredStreamFactsSchema>;

export const MinimaxH3TerminalEvidenceSchema = z
  .object({
    source: z.enum(["history", "queue", "process"]),
    status: z.enum(["success", "error", "interrupted", "timeout", "unknown"]).optional(),
    runId: z.string().optional(),
    promptId: z.string().nullable().optional(),
    serverAddress: z.string().optional(),
    serverPort: z.number().int().optional(),
    outputFilename: z.string().nullable().optional(),
    subfolder: z.string().nullable().optional(),
    outputType: z.string().nullable().optional(),
    error: z
      .object({
        nodeId: z.string().optional(),
        nodeType: z.string().optional(),
        message: z.string().optional(),
        exceptionType: z.string().optional()
      })
      .strict()
      .nullable()
      .optional(),
    rawDetails: z.unknown().optional()
  })
  .strict();
export type MinimaxH3TerminalEvidence = z.infer<typeof MinimaxH3TerminalEvidenceSchema>;

export const MinimaxH3ProcessRecordSchema = z
  .object({
    pid: z.number().int().positive(),
    startTimeTicks: z.number().int().nonnegative(),
    address: z.string(),
    port: z.number().int().positive(),
    gpuUuid: z.string(),
    commandLine: z.string(),
    startedAt: z.string(),
    effectiveMode: MinimaxH3ObservedEffectiveModeSchema.optional(),
    argv: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    // True only when argv/env/commandLine above were independently read
    // from the live process (e.g. /proc/[pid]/cmdline and /environ).
    // Absent or false means readActualProcessInfo failed or returned
    // nothing, and argv/env/commandLine are the *requested* configuration
    // echoed back — not an observation — so evidence consumers must not
    // treat them as proof of what actually ran.
    actualProcessInfoVerified: z.boolean().optional(),
    // Identity of the GPU lock holder (the launcher process that called
    // acquireGpuLock), distinct from `pid`/`startTimeTicks` above which
    // identify the spawned ComfyUI child. A later, separate `cleanup`
    // invocation needs these to release the correct lock record instead of
    // presenting the child's identity to a lock keyed on the launcher.
    gpuLockToken: z.string().optional(),
    launcherPid: z.number().int().positive().optional(),
    launcherStartTimeTicks: z.number().int().nonnegative().nullable().optional()
  })
  .strict();
export type MinimaxH3ProcessRecord = z.infer<typeof MinimaxH3ProcessRecordSchema>;

export const MinimaxH3ExecutionResultSchema = z
  .object({
    status: MinimaxH3ExecutionStatusSchema,
    promptId: z.string().nullable(),
    terminalEvidence: MinimaxH3TerminalEvidenceSchema.nullable(),
    engineError: z
      .object({
        nodeId: z.string().optional(),
        nodeType: z.string().optional(),
        message: z.string().optional(),
        exceptionType: z.string().optional()
      })
      .strict()
      .nullable(),
    latencyMs: z.number().int().nonnegative().nullable()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "completed") {
      if (!val.promptId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Execution status 'completed' requires a non-null promptId",
          path: ["promptId"]
        });
      }
      if (!val.terminalEvidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Execution status 'completed' requires terminalEvidence confirming engine completion",
          path: ["terminalEvidence"]
        });
      } else {
        if (val.terminalEvidence.source !== "history") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Execution status 'completed' requires terminalEvidence from 'history'",
            path: ["terminalEvidence", "source"]
          });
        }
        if (val.terminalEvidence.status && val.terminalEvidence.status !== "success") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Execution status 'completed' contradicts terminalEvidence status '${val.terminalEvidence.status}'`,
            path: ["terminalEvidence", "status"]
          });
        }
        if (
          val.terminalEvidence.rawDetails &&
          typeof val.terminalEvidence.rawDetails === "object"
        ) {
          const raw = val.terminalEvidence.rawDetails as Record<string, unknown>;
          const entry =
            val.promptId && raw[val.promptId] && typeof raw[val.promptId] === "object"
              ? (raw[val.promptId] as Record<string, unknown>)
              : raw;
          if (entry.status === "failed" || entry.status === "error" || entry.error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Execution status 'completed' contradicts failed terminal evidence",
              path: ["terminalEvidence"]
            });
          }
          if (entry.status && typeof entry.status === "object") {
            const statusObj = entry.status as Record<string, unknown>;
            if (statusObj.status_str === "error" || statusObj.status_str === "interrupted") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Execution status 'completed' contradicts status_str='${statusObj.status_str}' in history`,
                path: ["terminalEvidence"]
              });
            }
            if (Array.isArray(statusObj.messages)) {
              const hasErr = statusObj.messages.some(
                (m) =>
                  Array.isArray(m) &&
                  (m[0] === "execution_error" || m[0] === "execution_interrupted")
              );
              if (hasErr) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Execution status 'completed' contradicts execution error/interruption in history messages",
                  path: ["terminalEvidence"]
                });
              }
            }
          }
        }
      }
      if (val.engineError !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Execution status 'completed' forbids engineError",
          path: ["engineError"]
        });
      }
    } else if (val.status === "not_started") {
      if (
        val.promptId !== null ||
        val.terminalEvidence !== null ||
        val.engineError !== null ||
        val.latencyMs !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Execution status 'not_started' requires null promptId, terminalEvidence, engineError, and latencyMs",
          path: ["status"]
        });
      }
    }
  });
export type MinimaxH3ExecutionResult = z.infer<typeof MinimaxH3ExecutionResultSchema>;

export const MinimaxH3CollectionResultSchema = z
  .object({
    status: MinimaxH3CollectionStatusSchema,
    phaseCoverage: z
      .object({
        before: z.boolean(),
        during: z.boolean(),
        after: z.boolean()
      })
      .strict(),
    sampleCount: z
      .object({
        attempted: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative()
      })
      .strict(),
    metrics: z
      .object({
        gpuPeakUsedVramMb: z.number().int().nonnegative().nullable(),
        gpuAllocatableVramMb: z.number().int().nonnegative().nullable(),
        hostPeakRamUsedMb: z.number().int().nonnegative().nullable(),
        processPeakRssMb: z.number().int().nonnegative().nullable(),
        hostSwapUsedMb: z.number().int().nonnegative().nullable(),
        hostSwapDeltaMb: z.number().int().nullable() // signed delta
      })
      .strict(),
    errors: z.array(
      z
        .object({
          timestamp: z.string().datetime(),
          message: z.string(),
          phase: z.string().optional()
        })
        .strict()
    )
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "complete") {
      if (!val.phaseCoverage.before || !val.phaseCoverage.during || !val.phaseCoverage.after) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' requires before, during, and after phase coverage",
          path: ["phaseCoverage"]
        });
      }
      if (val.sampleCount.failed > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' forbids any failed samples",
          path: ["sampleCount", "failed"]
        });
      }
      if (val.errors.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' forbids collection errors",
          path: ["errors"]
        });
      }
      if (val.sampleCount.attempted === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' requires at least one attempted sample",
          path: ["sampleCount", "attempted"]
        });
      }
      if (val.sampleCount.succeeded !== val.sampleCount.attempted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' requires all attempted samples to succeed",
          path: ["sampleCount", "succeeded"]
        });
      }
      if (
        val.metrics.gpuPeakUsedVramMb === null ||
        val.metrics.hostPeakRamUsedMb === null ||
        val.metrics.processPeakRssMb === null ||
        val.metrics.hostSwapUsedMb === null ||
        val.metrics.hostSwapDeltaMb === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Collection status 'complete' requires non-null GPU, RAM, RSS, swap, and swap delta metrics",
          path: ["metrics"]
        });
      }
    } else if (val.status === "not_started") {
      if (
        val.sampleCount.attempted !== 0 ||
        val.sampleCount.succeeded !== 0 ||
        val.sampleCount.failed !== 0 ||
        val.errors.length > 0 ||
        val.metrics.gpuPeakUsedVramMb !== null ||
        val.metrics.hostPeakRamUsedMb !== null ||
        val.metrics.processPeakRssMb !== null ||
        val.metrics.hostSwapUsedMb !== null ||
        val.metrics.hostSwapDeltaMb !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'not_started' requires zero counts and null metrics",
          path: ["status"]
        });
      }
    }
  });
export type MinimaxH3CollectionResult = z.infer<typeof MinimaxH3CollectionResultSchema>;

export const MinimaxH3ProbeResultSchema = z
  .object({
    status: MinimaxH3ProbeStatusSchema,
    outputFile: z.string().nullable(),
    outputSha256: sha256HashSchema.nullable(),
    outputSizeBytes: z.number().int().positive().nullable(),
    measuredFacts: MinimaxH3MeasuredStreamFactsSchema,
    discrepancyFlags: z.array(z.string()),
    toolIdentity: z
      .object({
        ffprobePath: z.string(),
        version: z.string().optional(),
        argv: z.array(z.string()).optional()
      })
      .strict()
      .nullable(),
    rawStdout: z.string().optional(),
    rawStderr: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    errors: z.array(
      z
        .object({
          message: z.string(),
          stage: z.string().optional()
        })
        .strict()
    )
  })
  .strict();
export type MinimaxH3ProbeResult = z.infer<typeof MinimaxH3ProbeResultSchema>;

export const MinimaxH3OutputConformanceResultSchema = z
  .object({
    status: MinimaxH3OutputConformanceStatusSchema,
    checks: z
      .object({
        frameCountMatches: z.boolean().nullable(),
        geometryMatches: z.boolean().nullable(),
        fpsMatches: z.boolean().nullable(),
        timingWithinTolerance: z.boolean().nullable()
      })
      .strict(),
    reasons: z.array(z.string())
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "conformant") {
      if (
        val.checks.frameCountMatches !== true ||
        val.checks.geometryMatches !== true ||
        val.checks.fpsMatches !== true ||
        val.checks.timingWithinTolerance !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Output conformance 'conformant' requires all check flags to be true",
          path: ["checks"]
        });
      }
    } else if (val.status === "nonconformant") {
      const anyFalse =
        val.checks.frameCountMatches === false ||
        val.checks.geometryMatches === false ||
        val.checks.fpsMatches === false ||
        val.checks.timingWithinTolerance === false;
      if (!anyFalse && val.reasons.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Output conformance 'nonconformant' requires at least one failing check or reason",
          path: ["status"]
        });
      }
    }
  });
export type MinimaxH3OutputConformanceResult = z.infer<
  typeof MinimaxH3OutputConformanceResultSchema
>;

export const MinimaxH3VisualReviewResultSchema = z
  .object({
    status: MinimaxH3VisualReviewStatusSchema,
    outputSha256: sha256HashSchema.nullable().optional(),
    reviewedAt: z.string().datetime().nullable(),
    reviewer: z.string().min(1).nullable(),
    findings: z
      .object({
        continuity: z.enum(["pass", "defect", "fail"]).nullable(),
        identityFidelity: z.enum(["pass", "defect", "fail"]).nullable(),
        visualDegradation: z.enum(["pass", "defect", "fail"]).nullable()
      })
      .strict()
      .nullable(),
    notes: z.string().nullable(),
    unavailableReason: z.string().nullable()
  })
  .strict();
export type MinimaxH3VisualReviewResult = z.infer<typeof MinimaxH3VisualReviewResultSchema>;

export const MinimaxH3OperatorDecisionResultSchema = z
  .object({
    status: MinimaxH3OperatorDecisionStatusSchema,
    operator: z.string().min(1).nullable(),
    decidedAt: z.string().datetime().nullable(),
    comparisonKey: z.string().min(1).nullable(),
    reason: z.string().nullable()
  })
  .strict();
export type MinimaxH3OperatorDecisionResult = z.infer<typeof MinimaxH3OperatorDecisionResultSchema>;

export const MinimaxH3StopRecommendationSchema = z
  .object({
    recommended: z.boolean(),
    reasons: z.array(z.string())
  })
  .strict();
export type MinimaxH3StopRecommendation = z.infer<typeof MinimaxH3StopRecommendationSchema>;

export const MinimaxH3StopPolicySchema = z
  .object({
    policyId: z.string().min(1),
    maxPeakVramMb: z.number().int().positive(),
    maxHostRamMb: z.number().int().positive(),
    maxSwapUsedMb: z.number().int().positive(),
    maxSwapDeltaMb: z.number().int().positive(),
    maxExecutionDurationMs: z.number().int().positive(),
    requireCompleteTelemetry: z.boolean(),
    requireConformantProbe: z.boolean(),
    visualStopConditions: z.array(z.string())
  })
  .strict();
export type MinimaxH3StopPolicy = z.infer<typeof MinimaxH3StopPolicySchema>;

export const DEFAULT_MINIMAX_H3_STOP_POLICY: MinimaxH3StopPolicy = Object.freeze({
  policyId: "rtx-4090-minimax-h3-default-stop-v1",
  maxPeakVramMb: 24_000,
  maxHostRamMb: 32_000,
  maxSwapUsedMb: 4_096,
  maxSwapDeltaMb: 2_048,
  maxExecutionDurationMs: 1_200_000, // 20 minutes
  requireCompleteTelemetry: true,
  requireConformantProbe: true,
  visualStopConditions: [
    "severe_flicker_or_tearing",
    "subject_identity_collapse",
    "extreme_motion_blur_or_distortion"
  ]
});

export const MinimaxH3ExperimentResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Invalid runId format"),
    descriptorDigest: sha256HashSchema,
    configDigest: sha256HashSchema,
    comparisonKey: z.string().min(1),
    lifecycle: MinimaxH3LifecycleStatusSchema,
    observedRunner: MinimaxH3ObservedRunnerPolicySchema,
    // Denormalized from the descriptor (which this schema otherwise
    // only carries a digest of) specifically so an approve_candidate
    // claim can be checked against what was actually requested, not
    // just that *some* effective mode was verified. Optional for
    // backward compatibility with results written before this field
    // existed; new results should always set it.
    requestedMemoryPolicy: MinimaxH3MemoryPolicySchema.optional(),
    policyDigest: sha256HashSchema.optional(),
    baselineRunId: z.string().nullable().optional(),
    baselineResultDigest: sha256HashSchema.nullable().optional(),
    timestamps: z
      .object({
        preparedAt: z.string().datetime(),
        startedAt: z.string().datetime().nullable(),
        submittedAt: z.string().datetime().nullable(),
        terminatedAt: z.string().datetime().nullable()
      })
      .strict(),
    execution: MinimaxH3ExecutionResultSchema,
    collection: MinimaxH3CollectionResultSchema,
    probe: MinimaxH3ProbeResultSchema,
    outputConformance: MinimaxH3OutputConformanceResultSchema,
    visualReview: MinimaxH3VisualReviewResultSchema,
    operatorDecision: MinimaxH3OperatorDecisionResultSchema,
    stopRecommendation: MinimaxH3StopRecommendationSchema
  })
  .strict()
  .superRefine((val, ctx) => {
    // 1. Execution completed requires promptId and terminalEvidence from history
    if (val.execution.status === "completed") {
      if (!val.execution.promptId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Execution status 'completed' requires a non-null promptId",
          path: ["execution", "promptId"]
        });
      }
      if (!val.execution.terminalEvidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Execution status 'completed' requires terminalEvidence confirming engine completion",
          path: ["execution", "terminalEvidence"]
        });
      } else {
        if (val.execution.terminalEvidence.source !== "history") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Execution status 'completed' requires terminalEvidence from 'history' (process or queue evidence is insufficient)",
            path: ["execution", "terminalEvidence", "source"]
          });
        }
        if (
          val.execution.terminalEvidence.rawDetails === undefined ||
          val.execution.terminalEvidence.rawDetails === null
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Execution status 'completed' requires non-null rawDetails in terminalEvidence",
            path: ["execution", "terminalEvidence", "rawDetails"]
          });
        }
        if (
          val.execution.terminalEvidence.status &&
          val.execution.terminalEvidence.status !== "success"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Execution status 'completed' contradicts terminalEvidence status '${val.execution.terminalEvidence.status}'`,
            path: ["execution", "terminalEvidence", "status"]
          });
        }
        if (val.execution.engineError !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Execution status 'completed' forbids engineError",
            path: ["execution", "engineError"]
          });
        }
        if (
          val.execution.terminalEvidence.rawDetails &&
          typeof val.execution.terminalEvidence.rawDetails === "object"
        ) {
          const raw = val.execution.terminalEvidence.rawDetails as Record<string, unknown>;
          const entry =
            val.execution.promptId &&
            raw[val.execution.promptId] &&
            typeof raw[val.execution.promptId] === "object"
              ? (raw[val.execution.promptId] as Record<string, unknown>)
              : raw;
          if (entry.status === "failed" || entry.status === "error" || entry.error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Execution status 'completed' contradicts failed terminal evidence",
              path: ["execution", "terminalEvidence"]
            });
          }
          if (entry.status && typeof entry.status === "object") {
            const statusObj = entry.status as Record<string, unknown>;
            if (statusObj.status_str === "error" || statusObj.status_str === "interrupted") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Execution status 'completed' contradicts status_str='${statusObj.status_str}' in history`,
                path: ["execution", "terminalEvidence"]
              });
            }
            if (Array.isArray(statusObj.messages)) {
              const hasErr = statusObj.messages.some(
                (m) =>
                  Array.isArray(m) &&
                  (m[0] === "execution_error" || m[0] === "execution_interrupted")
              );
              if (hasErr) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message:
                    "Execution status 'completed' contradicts execution error/interruption in history messages",
                  path: ["execution", "terminalEvidence"]
                });
              }
            }
          }
        }
      }
    }

    // 2. Collection complete requires coverage of all 3 phases, non-null required metrics, and 0 errors/failures
    if (val.collection.status === "complete") {
      if (
        !val.collection.phaseCoverage.before ||
        !val.collection.phaseCoverage.during ||
        !val.collection.phaseCoverage.after
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' requires before, during, and after phase coverage",
          path: ["collection", "phaseCoverage"]
        });
      }
      if (val.collection.sampleCount.failed > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' forbids any failed samples",
          path: ["collection", "sampleCount", "failed"]
        });
      }
      if (val.collection.errors.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' forbids collection errors",
          path: ["collection", "errors"]
        });
      }
      if (val.collection.sampleCount.attempted === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' requires at least one attempted sample",
          path: ["collection", "sampleCount", "attempted"]
        });
      }
      if (val.collection.sampleCount.succeeded !== val.collection.sampleCount.attempted) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Collection status 'complete' requires all attempted samples to succeed",
          path: ["collection", "sampleCount", "succeeded"]
        });
      }
      if (
        val.collection.metrics.gpuPeakUsedVramMb === null ||
        val.collection.metrics.hostPeakRamUsedMb === null ||
        val.collection.metrics.processPeakRssMb === null ||
        val.collection.metrics.hostSwapUsedMb === null ||
        val.collection.metrics.hostSwapDeltaMb === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Collection status 'complete' requires non-null GPU, RAM, RSS, swap, and swap delta metrics",
          path: ["collection", "metrics"]
        });
      }
    }

    // 3. Output conformance 'conformant' requires successful probe, valid output hash/file, nb_read_frames, non-null measured facts, and all checks passing
    if (val.outputConformance.status === "conformant") {
      if (val.probe.status !== "succeeded") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Output conformance 'conformant' requires probe status 'succeeded'",
          path: ["probe", "status"]
        });
      }
      if (!val.probe.outputFile || !val.probe.outputSha256) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Output conformance 'conformant' requires probe outputFile and outputSha256",
          path: ["probe", "outputFile"]
        });
      }
      if (val.probe.measuredFacts.countedFramesSource !== "nb_read_frames") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Output conformance 'conformant' requires countedFramesSource to be 'nb_read_frames'",
          path: ["probe", "measuredFacts", "countedFramesSource"]
        });
      }
      if (
        val.probe.measuredFacts.measuredFrames === null ||
        val.probe.measuredFacts.width === null ||
        val.probe.measuredFacts.height === null ||
        val.probe.measuredFacts.fps === null ||
        val.probe.measuredFacts.measuredVideoDurationMs === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Output conformance 'conformant' requires non-null measuredFrames, width, height, fps, and duration facts",
          path: ["probe", "measuredFacts"]
        });
      }
      if (
        val.outputConformance.checks.frameCountMatches !== true ||
        val.outputConformance.checks.geometryMatches !== true ||
        val.outputConformance.checks.fpsMatches !== true ||
        val.outputConformance.checks.timingWithinTolerance !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Output conformance 'conformant' requires all check flags to be true",
          path: ["outputConformance", "checks"]
        });
      }
    }

    // 4. Operator decision 'approve_candidate' requires completed execution, verified matching effective memory mode, complete collection, conformant output, and approved visual review
    if (val.operatorDecision.status === "approve_candidate") {
      if (val.execution.status !== "completed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires execution status 'completed'",
          path: ["execution", "status"]
        });
      }
      if (
        val.observedRunner.effectiveMode.status !== "verified" ||
        !val.observedRunner.effectiveMode.value
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Operator approval requires observedRunner.effectiveMode.status 'verified' and non-null value",
          path: ["observedRunner", "effectiveMode"]
        });
      }
      if (!val.observedRunner.effectiveMode.evidence) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires observedRunner.effectiveMode.evidence",
          path: ["observedRunner", "effectiveMode", "evidence"]
        });
      }
      if (
        val.requestedMemoryPolicy &&
        val.observedRunner.effectiveMode.value &&
        val.requestedMemoryPolicy !== val.observedRunner.effectiveMode.value
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Operator approval requires observedRunner.effectiveMode.value ("${val.observedRunner.effectiveMode.value}") to match requestedMemoryPolicy ("${val.requestedMemoryPolicy}")`,
          path: ["observedRunner", "effectiveMode", "value"]
        });
      }
      if (val.collection.status !== "complete") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires collection status 'complete'",
          path: ["collection", "status"]
        });
      }
      if (val.outputConformance.status !== "conformant") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires outputConformance status 'conformant'",
          path: ["outputConformance", "status"]
        });
      }
      if (val.visualReview.status !== "reviewed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires visualReview status 'reviewed'",
          path: ["visualReview", "status"]
        });
      }
      if (
        val.visualReview.findings?.continuity !== "pass" ||
        val.visualReview.findings?.identityFidelity !== "pass" ||
        val.visualReview.findings?.visualDegradation !== "pass"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires all visual findings to be 'pass'",
          path: ["visualReview", "findings"]
        });
      }
      if (
        !val.operatorDecision.operator ||
        !val.operatorDecision.decidedAt ||
        !val.operatorDecision.reason ||
        val.operatorDecision.reason.trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires operator identity, timestamp, and explicit reason",
          path: ["operatorDecision", "operator"]
        });
      }
      if (val.operatorDecision.comparisonKey !== val.comparisonKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval comparisonKey must match result comparisonKey",
          path: ["operatorDecision", "comparisonKey"]
        });
      }
    } else if (val.operatorDecision.status === "no_go") {
      if (
        !val.operatorDecision.operator ||
        !val.operatorDecision.decidedAt ||
        !val.operatorDecision.reason ||
        val.operatorDecision.reason.trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "No-go decision requires operator identity, timestamp, and explicit reason",
          path: ["operatorDecision", "reason"]
        });
      }
    }

    if (val.visualReview.status === "reviewed") {
      if (
        !val.visualReview.reviewer ||
        !val.visualReview.reviewedAt ||
        !val.visualReview.findings ||
        !val.visualReview.notes
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Visual review 'reviewed' requires reviewer, reviewedAt, findings, and notes",
          path: ["visualReview"]
        });
      }
      if (
        val.visualReview.outputSha256 &&
        val.probe.outputSha256 &&
        val.visualReview.outputSha256 !== val.probe.outputSha256
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Visual review outputSha256 "${val.visualReview.outputSha256}" contradicts probed outputSha256 "${val.probe.outputSha256}"`,
          path: ["visualReview", "outputSha256"]
        });
      }
    } else if (val.visualReview.status === "unavailable") {
      if (
        !val.visualReview.unavailableReason ||
        val.visualReview.unavailableReason.trim().length === 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Visual review 'unavailable' requires unavailableReason",
          path: ["visualReview", "unavailableReason"]
        });
      }
    }
  });

export type MinimaxH3ExperimentResult = z.infer<typeof MinimaxH3ExperimentResultSchema>;

export const MinimaxH3OperatorDecisionSidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    route: MinimaxH3ExperimentRouteSchema,
    configuredFrames: MinimaxH3ExperimentCandidateFramesSchema,
    comparisonKey: z.string().min(1),
    status: MinimaxH3OperatorDecisionStatusSchema,
    operator: z.string().min(1).nullable(),
    decidedAt: z.string().datetime().nullable(),
    reason: z.string().nullable(),
    evidenceBundle: z.record(z.string(), z.string()).optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "approve_candidate") {
      if (!val.operator || !val.decidedAt || !val.reason || val.reason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires operator identity, decidedAt, and reason",
          path: ["reason"]
        });
      }
      if (!val.evidenceBundle || Object.keys(val.evidenceBundle).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Operator approval requires non-empty evidenceBundle with run evidence",
          path: ["evidenceBundle"]
        });
      }
    } else if (val.status === "no_go") {
      if (!val.operator || !val.decidedAt || !val.reason || val.reason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "No-go decision requires operator identity, decidedAt, and reason",
          path: ["reason"]
        });
      }
    }
  });
export type MinimaxH3OperatorDecisionSidecar = z.infer<
  typeof MinimaxH3OperatorDecisionSidecarSchema
>;

export const MinimaxH3VisualReviewSidecarSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    route: MinimaxH3ExperimentRouteSchema,
    configuredFrames: MinimaxH3ExperimentCandidateFramesSchema,
    outputSha256: sha256HashSchema,
    status: MinimaxH3VisualReviewStatusSchema,
    reviewer: z.string().min(1).nullable(),
    reviewedAt: z.string().datetime().nullable(),
    findings: z
      .object({
        continuity: z.enum(["pass", "defect", "fail"]).nullable(),
        identityFidelity: z.enum(["pass", "defect", "fail"]).nullable(),
        visualDegradation: z.enum(["pass", "defect", "fail"]).nullable()
      })
      .strict()
      .nullable(),
    notes: z.string().nullable(),
    unavailableReason: z.string().nullable()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "reviewed") {
      if (!val.reviewer || !val.reviewedAt || !val.findings || !val.notes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Visual review requires reviewer, reviewedAt, findings, and notes",
          path: ["reviewer"]
        });
      }
    } else if (val.status === "unavailable") {
      if (!val.unavailableReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Unavailable visual review requires unavailableReason",
          path: ["unavailableReason"]
        });
      }
    }
  });
export type MinimaxH3VisualReviewSidecar = z.infer<typeof MinimaxH3VisualReviewSidecarSchema>;

export const MinimaxH3MatrixRowSchema = z
  .object({
    schemaVersion: z.literal(1),
    route: MinimaxH3ExperimentRouteSchema,
    configuredFrames: MinimaxH3ExperimentCandidateFramesSchema,
    requestedDurationMs: z.number().int().positive(),
    configuredDurationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    promptDigest: sha256HashSchema,
    referenceSetId: z.string().min(1).nullable(),
    references: z
      .array(
        z
          .object({
            slotIndex: z.number().int().nonnegative(),
            role: z.string(),
            tag: z.string(),
            order: z.number().int().nonnegative(),
            sha256: sha256HashSchema
          })
          .strict()
      )
      .optional(),
    seed: z.number().int().nonnegative(),
    requestedRunnerVariant: z.string().min(1),
    configuredRunnerVariant: z.string().min(1),
    effectiveRunnerMode: z.enum(["dynamic_vram", "static_lowvram", "unknown"]),
    descriptorDigest: sha256HashSchema.nullable(),
    configDigest: sha256HashSchema.nullable(),
    policyDigest: sha256HashSchema.nullable().optional(),
    comparisonKey: z.string().min(1),
    runId: z.string().nullable(),
    baselineRunId: z.string().nullable(),
    attemptStatus: z.enum(["unattempted", "blocked", "attempted"]),
    blockReason: z.string().nullable(),
    executionStatus: MinimaxH3ExecutionStatusSchema.nullable(),
    collectionStatus: MinimaxH3CollectionStatusSchema.nullable(),
    probeStatus: MinimaxH3ProbeStatusSchema.nullable(),
    outputConformanceStatus: MinimaxH3OutputConformanceStatusSchema.nullable(),
    visualReviewStatus: MinimaxH3VisualReviewStatusSchema.nullable(),
    stopRecommendation: z.boolean().nullable(),
    operatorDecision: MinimaxH3OperatorDecisionStatusSchema.nullable(),
    measuredPeakVramMb: z.number().int().nonnegative().nullable(),
    measuredHostRamMb: z.number().int().nonnegative().nullable(),
    measuredSwapDeltaMb: z.number().int().nullable(),
    measuredDurationMs: z.number().int().positive().nullable(),
    measuredFrames: z.number().int().nonnegative().nullable(),
    factSources: z.record(z.string(), z.string()).optional(),
    factReasons: z.record(z.string(), z.string()).optional(),
    operatorReviewDetails: z
      .object({
        reviewer: z.string().nullable().optional(),
        findings: z
          .object({
            continuity: z.enum(["pass", "defect", "fail"]).nullable().optional(),
            identityFidelity: z.enum(["pass", "defect", "fail"]).nullable().optional(),
            visualDegradation: z.enum(["pass", "defect", "fail"]).nullable().optional()
          })
          .strict()
          .nullable()
          .optional(),
        notes: z.string().nullable().optional()
      })
      .strict()
      .optional(),
    operatorDecisionDetails: z
      .object({
        operator: z.string().nullable().optional(),
        decidedAt: z.string().nullable().optional(),
        reason: z.string().nullable().optional()
      })
      .strict()
      .optional(),
    evidenceBundle: z.record(z.string(), z.string()).optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.attemptStatus === "unattempted" || val.attemptStatus === "blocked") {
      if (val.executionStatus !== null && val.executionStatus !== "not_started") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row must have null or not_started executionStatus`,
          path: ["executionStatus"]
        });
      }
      if (val.collectionStatus !== null && val.collectionStatus !== "not_started") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row must have null or not_started collectionStatus`,
          path: ["collectionStatus"]
        });
      }
      if (val.probeStatus !== null && val.probeStatus !== "not_started") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row must have null or not_started probeStatus`,
          path: ["probeStatus"]
        });
      }
      if (val.outputConformanceStatus !== null && val.outputConformanceStatus !== "unknown") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row must have null or unknown outputConformanceStatus`,
          path: ["outputConformanceStatus"]
        });
      }
      if (
        val.visualReviewStatus !== null &&
        val.visualReviewStatus !== "unavailable" &&
        val.visualReviewStatus !== "pending"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row visualReviewStatus must be null, pending, or unavailable (cannot be reviewed)`,
          path: ["visualReviewStatus"]
        });
      }
      if (val.effectiveRunnerMode !== "unknown") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row must have effectiveRunnerMode 'unknown'`,
          path: ["effectiveRunnerMode"]
        });
      }
      if (
        val.measuredPeakVramMb !== null ||
        val.measuredHostRamMb !== null ||
        val.measuredSwapDeltaMb !== null ||
        val.measuredDurationMs !== null ||
        val.measuredFrames !== null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row must have null measured values`,
          path: ["measuredPeakVramMb"]
        });
      }
      if (!val.blockReason || val.blockReason.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus === "blocked" ? "Blocked" : "Unattempted"} matrix row requires a non-empty blockReason`,
          path: ["blockReason"]
        });
      }
      if (val.operatorDecision === "approve_candidate") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${val.attemptStatus} matrix row cannot be approved`,
          path: ["operatorDecision"]
        });
      }
    } else if (val.attemptStatus === "attempted") {
      if (!val.runId || val.runId.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempted matrix row requires a non-empty runId",
          path: ["runId"]
        });
      }
      if (!val.descriptorDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempted matrix row requires a descriptorDigest",
          path: ["descriptorDigest"]
        });
      }
      if (!val.configDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempted matrix row requires a configDigest",
          path: ["configDigest"]
        });
      }
      if (val.executionStatus === null || val.executionStatus === "not_started") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempted matrix row requires executionStatus other than null or not_started",
          path: ["executionStatus"]
        });
      }
      if (val.collectionStatus === null || val.collectionStatus === "not_started") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempted matrix row requires collectionStatus other than null or not_started",
          path: ["collectionStatus"]
        });
      }
      if (val.probeStatus === null || val.probeStatus === "not_started") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempted matrix row requires probeStatus other than null or not_started",
          path: ["probeStatus"]
        });
      }
      if (val.operatorDecision === "approve_candidate") {
        if (val.effectiveRunnerMode === "unknown") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Approved matrix row requires effectiveRunnerMode other than unknown",
            path: ["effectiveRunnerMode"]
          });
        }
        if (
          val.configuredRunnerVariant === "dynamicvram-offload-v1" &&
          val.effectiveRunnerMode !== "dynamic_vram"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Approved matrix row with dynamicvram-offload-v1 requires dynamic_vram effectiveRunnerMode",
            path: ["effectiveRunnerMode"]
          });
        }
        if (
          val.configuredRunnerVariant === "lowvram-fallback-v1" &&
          val.effectiveRunnerMode !== "static_lowvram"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Approved matrix row with lowvram-fallback-v1 requires static_lowvram effectiveRunnerMode",
            path: ["effectiveRunnerMode"]
          });
        }
        if (val.executionStatus !== "completed") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Approved matrix row requires executionStatus 'completed'",
            path: ["executionStatus"]
          });
        }
        if (val.collectionStatus !== "complete") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Approved matrix row requires collectionStatus 'complete'",
            path: ["collectionStatus"]
          });
        }
        if (val.outputConformanceStatus !== "conformant") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Approved matrix row requires outputConformanceStatus 'conformant'",
            path: ["outputConformanceStatus"]
          });
        }
        if (val.visualReviewStatus !== "reviewed") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Approved matrix row requires visualReviewStatus 'reviewed'",
            path: ["visualReviewStatus"]
          });
        }
        if (
          !val.operatorDecisionDetails?.operator ||
          !val.operatorDecisionDetails?.decidedAt ||
          !val.operatorDecisionDetails?.reason ||
          val.operatorDecisionDetails.reason.trim().length === 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Approved matrix row requires operatorDecisionDetails with operator, decidedAt, and reason",
            path: ["operatorDecisionDetails"]
          });
        }
      } else if (val.operatorDecision === "no_go") {
        if (
          !val.operatorDecisionDetails?.operator ||
          !val.operatorDecisionDetails?.decidedAt ||
          !val.operatorDecisionDetails?.reason ||
          val.operatorDecisionDetails.reason.trim().length === 0
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "No-go matrix row requires operatorDecisionDetails with operator, decidedAt, and reason",
            path: ["operatorDecisionDetails"]
          });
        }
      }
    }
  });
export type MinimaxH3MatrixRow = z.infer<typeof MinimaxH3MatrixRowSchema>;

export function createEmptyMinimaxH3MeasurementTemplate(
  descriptor: MinimaxH3ExperimentDescriptor
): MinimaxH3ExperimentResult {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId: descriptor.runId,
    descriptorDigest: descriptor.descriptorDigest ?? computeDescriptorDigest(descriptor),
    configDigest: descriptor.configDigest,
    comparisonKey: descriptor.comparisonKey,
    lifecycle: "prepared",
    observedRunner: {
      argv: [],
      env: {},
      pid: null,
      processStartTimeTicks: null,
      targetGpuUuid: null,
      effectiveMode: {
        status: "unknown",
        value: null,
        unknownReason: "not_started",
        evidence: null
      }
    },
    timestamps: {
      preparedAt: now,
      startedAt: null,
      submittedAt: null,
      terminatedAt: null
    },
    execution: {
      status: "not_started",
      promptId: null,
      terminalEvidence: null,
      engineError: null,
      latencyMs: null
    },
    collection: {
      status: "not_started",
      phaseCoverage: {
        before: false,
        during: false,
        after: false
      },
      sampleCount: {
        attempted: 0,
        succeeded: 0,
        failed: 0
      },
      metrics: {
        gpuPeakUsedVramMb: null,
        gpuAllocatableVramMb: null,
        hostPeakRamUsedMb: null,
        processPeakRssMb: null,
        hostSwapUsedMb: null,
        hostSwapDeltaMb: null
      },
      errors: []
    },
    probe: {
      status: "not_started",
      outputFile: null,
      outputSha256: null,
      outputSizeBytes: null,
      measuredFacts: {
        measuredFrames: null,
        countedFramesSource: null,
        declaredNbFrames: null,
        measuredVideoDurationMs: null,
        measuredContainerDurationMs: null,
        width: null,
        height: null,
        fps: null,
        rFrameRate: null,
        avgFrameRate: null,
        videoCodec: null,
        audioCodec: null,
        audioChannels: null,
        audioSampleRate: null
      },
      discrepancyFlags: [],
      toolIdentity: null,
      errors: []
    },
    outputConformance: {
      status: "unknown",
      checks: {
        frameCountMatches: null,
        geometryMatches: null,
        fpsMatches: null,
        timingWithinTolerance: null
      },
      reasons: []
    },
    visualReview: {
      status: "pending",
      outputSha256: null,
      reviewedAt: null,
      reviewer: null,
      findings: null,
      notes: null,
      unavailableReason: null
    },
    operatorDecision: {
      status: "pending",
      operator: null,
      decidedAt: null,
      comparisonKey: descriptor.comparisonKey,
      reason: null
    },
    stopRecommendation: {
      recommended: false,
      reasons: []
    }
  };
}
