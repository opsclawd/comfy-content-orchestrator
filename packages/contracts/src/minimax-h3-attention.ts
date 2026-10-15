import { z } from "zod";
import {
  canonicalizeJson,
  sha256Hex,
  PINNED_COMFYUI_CORE_REVISION,
  FASTH3_ISOLATED_CORE_REVISION
} from "./minimax-h3-experiment.js";
import { sha256HashSchema } from "./persistent-media.js";

// ---------------------------------------------------------------------------
// Attention Variant Names and Backends
// ---------------------------------------------------------------------------
export const MINIMAX_H3_ATTENTION_VARIANTS = ["dense", "sage", "native-sol-attn", "veda"] as const;

export const MinimaxH3AttentionVariantNameSchema = z.enum(MINIMAX_H3_ATTENTION_VARIANTS);
export type MinimaxH3AttentionVariantName = z.infer<typeof MinimaxH3AttentionVariantNameSchema>;

export const MinimaxH3AttentionBackendNameSchema = z.enum([
  "torch_sdpa",
  "sage",
  "sol_attn",
  "veda",
  "unknown"
]);
export type MinimaxH3AttentionBackendName = z.infer<typeof MinimaxH3AttentionBackendNameSchema>;

// ---------------------------------------------------------------------------
// Audited Attention Kernel Descriptors & Resolution
// ---------------------------------------------------------------------------
export interface AuditedKernelDescriptor {
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly backend: MinimaxH3AttentionBackendName;
  readonly supportedCoreRevisions: readonly string[];
  readonly pythonImportModule?: string;
  readonly description: string;
}

export const AUDITED_ATTENTION_KERNELS: readonly AuditedKernelDescriptor[] = Object.freeze([
  {
    canonicalName: "torch_sdpa",
    aliases: [
      "torch_sdpa",
      "torch.nn.functional.scaled_dot_product_attention",
      "sdpa",
      "pytorch_sdpa",
      "default"
    ],
    backend: "torch_sdpa" as const,
    supportedCoreRevisions: [
      PINNED_COMFYUI_CORE_REVISION,
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
      FASTH3_ISOLATED_CORE_REVISION
    ],
    pythonImportModule: "torch",
    description: "Standard PyTorch scaled dot-product attention (dense baseline)"
  },
  {
    canonicalName: "sage",
    aliases: ["sage", "sageattention", "sageattention.sageattn", "sageattn"],
    backend: "sage" as const,
    supportedCoreRevisions: [
      PINNED_COMFYUI_CORE_REVISION,
      "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
    ],
    pythonImportModule: "sageattention",
    description: "SageAttention 8-bit / quantized accelerated attention kernel"
  },
  {
    canonicalName: "sol_attn",
    aliases: ["sol_attn", "comfy_kitchen.sol_attn", "kitchen_sol_attn", "native-sol-attn"],
    backend: "sol_attn" as const,
    supportedCoreRevisions: ["94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"],
    pythonImportModule: "comfy_kitchen",
    description: "Comfy Kitchen native fast attention kernel"
  },
  {
    canonicalName: "veda",
    aliases: [
      "veda",
      "veda_sparse_attention",
      "veda_sparse_attention.triton_kernel",
      "veda_sparse"
    ],
    backend: "veda" as const,
    supportedCoreRevisions: ["94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"],
    pythonImportModule: "veda_sparse_attention",
    description: "Veda Sparse Attention Triton kernel"
  },
  {
    canonicalName: "block_sparse_triton",
    aliases: ["block_sparse_triton", "comfy kitchen attention", "block_sparse"],
    backend: "sol_attn" as const,
    supportedCoreRevisions: [FASTH3_ISOLATED_CORE_REVISION],
    pythonImportModule: "torch",
    description: "Block sparse Triton attention kernel for FastH3"
  }
]);

export function resolveAuditedKernel(kernelName: string): AuditedKernelDescriptor | null {
  const normalized = kernelName.trim().toLowerCase();
  for (const descriptor of AUDITED_ATTENTION_KERNELS) {
    if (
      descriptor.canonicalName.toLowerCase() === normalized ||
      descriptor.aliases.some((a) => a.toLowerCase() === normalized)
    ) {
      return descriptor;
    }
  }
  return null;
}

export function isKernelSupportedOnRevision(kernelName: string, coreRevision: string): boolean {
  const descriptor = resolveAuditedKernel(kernelName);
  if (!descriptor) {
    return false;
  }
  return descriptor.supportedCoreRevisions.includes(coreRevision);
}

// Compatibility states
export const MinimaxH3CompatibilityStateSchema = z.enum([
  "supported",
  "requires_isolated_upgrade",
  "unsupported",
  "unverified"
]);
export type MinimaxH3CompatibilityState = z.infer<typeof MinimaxH3CompatibilityStateSchema>;

export const MinimaxH3SourceEvidenceRefSchema = z
  .object({
    url: z.string().min(1),
    revision: z.string().optional(),
    digest: sha256HashSchema.optional(),
    assertion: z.string().min(1)
  })
  .strict();
export type MinimaxH3SourceEvidenceRef = z.infer<typeof MinimaxH3SourceEvidenceRefSchema>;

// ---------------------------------------------------------------------------
// Topology & Patch Node Schema
// ---------------------------------------------------------------------------
export const MinimaxH3AttentionPatchNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    classType: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()),
    outputs: z.record(z.string(), z.unknown()).optional()
  })
  .strict();
export type MinimaxH3AttentionPatchNode = z.infer<typeof MinimaxH3AttentionPatchNodeSchema>;

export const MinimaxH3AttentionTopologySchema = z
  .object({
    backend: z.string().min(1),
    patchCount: z.number().int().nonnegative(),
    patches: z.array(MinimaxH3AttentionPatchNodeSchema),
    topologyDigest: sha256HashSchema
  })
  .strict();
export type MinimaxH3AttentionTopology = z.infer<typeof MinimaxH3AttentionTopologySchema>;

export function computeAttentionTopologyDigest(
  patches: readonly MinimaxH3AttentionPatchNode[]
): string {
  const sorted = [...patches].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  return sha256Hex(canonicalizeJson(sorted));
}

// ---------------------------------------------------------------------------
// Catalog Entry Schema
// ---------------------------------------------------------------------------
export const MinimaxH3DenseRegionPolicySchema = z
  .object({
    allowPlannedDense: z.boolean(),
    minTokensThreshold: z.number().int().positive().optional(),
    description: z.string().min(1)
  })
  .strict();
export type MinimaxH3DenseRegionPolicy = z.infer<typeof MinimaxH3DenseRegionPolicySchema>;

export const MinimaxH3AttentionCatalogEntrySchema = z
  .object({
    variantName: MinimaxH3AttentionVariantNameSchema,
    route: z.enum(["i2v", "ref2v"]),
    compatibilityState: MinimaxH3CompatibilityStateSchema,
    scope: z.string().min(1),
    comfyuiCoreRevision: z.string().min(1),
    customNode: z
      .object({
        name: z.string().min(1),
        repository: z.string().min(1),
        revision: z.string().min(1),
        entrypoint: z.string().optional()
      })
      .strict()
      .optional(),
    runnable: z.boolean(),
    backend: z.string().min(1),
    kernel: z.string().min(1),
    requiredNodes: z.array(
      z
        .object({
          name: z.string().min(1),
          classType: z.string().min(1),
          revision: z.string().optional()
        })
        .strict()
    ),
    pythonPackages: z.array(
      z
        .object({
          name: z.string().min(1),
          version: z.string().min(1),
          artifactHash: sha256HashSchema.optional(),
          importModule: z.string().optional()
        })
        .strict()
    ),
    cudaRequirement: z.string().min(1),
    computeCapability: z.string().min(1),
    supportedDtypes: z.array(z.string().min(1)),
    checkpointCompatibility: z
      .object({
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        taskMode: z.string().min(1)
      })
      .strict(),
    predictor: z
      .object({
        repository: z.string().optional(),
        revision: z.string().optional(),
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        taskMode: z.string().optional(),
        reviewStatus: z.enum(["passed", "pending", "flagged"]).optional()
      })
      .strict()
      .optional(),
    licensing: z
      .object({
        status: z.enum(["approved", "restricted", "review_required", "unverified"]),
        licenseSourceRef: z.string().min(1),
        securityReviewStatus: z.enum(["passed", "pending", "flagged"])
      })
      .strict(),
    denseRegionPolicy: MinimaxH3DenseRegionPolicySchema,
    isolationInstructions: z
      .object({
        venvSetup: z.string().min(1),
        installRecipe: z.string().min(1),
        teardownRecipe: z.string().min(1)
      })
      .strict(),
    blockers: z.array(z.string().min(1)),
    evidence: z.array(MinimaxH3SourceEvidenceRefSchema),
    catalogDigest: sha256HashSchema
  })
  .strict()
  .superRefine((val, ctx) => {
    // Fail-closed governance gate: If blockers mention pending/unverified review, securityReviewStatus cannot be "passed"
    const hasPendingReviewBlocker = val.blockers.some((b) => /pending|unverified|review/i.test(b));
    if (hasPendingReviewBlocker && val.licensing.securityReviewStatus === "passed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Cannot claim securityReviewStatus 'passed' while blockers indicate pending review",
        path: ["licensing", "securityReviewStatus"]
      });
    }
    // Runnable entry must be fully evidenced, approved, locked, and have zero blockers
    if (val.runnable) {
      if (val.licensing.securityReviewStatus !== "passed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Catalog entry cannot be runnable while security review is not passed",
          path: ["runnable"]
        });
      }
      if (val.licensing.status !== "approved") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Catalog entry cannot be runnable while licensing status is not approved",
          path: ["runnable"]
        });
      }
      if (val.blockers.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Catalog entry cannot be runnable while blockers exist: ${val.blockers.join("; ")}`,
          path: ["runnable"]
        });
      }
      if (val.compatibilityState === "unverified" || val.compatibilityState === "unsupported") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Catalog entry cannot be runnable with compatibility state '${val.compatibilityState}'`,
          path: ["runnable"]
        });
      }
      const missingPackageHash = val.pythonPackages.find((p) => !p.artifactHash);
      if (missingPackageHash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Catalog entry cannot be runnable while pythonPackage '${missingPackageHash.name}' lacks artifactHash`,
          path: ["runnable"]
        });
      }
      if (val.predictor && val.predictor.reviewStatus !== "passed") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Catalog entry cannot be runnable while predictor review status is not passed",
          path: ["runnable"]
        });
      }
    }
  });
export type MinimaxH3AttentionCatalogEntry = z.infer<typeof MinimaxH3AttentionCatalogEntrySchema>;

export function computeAttentionCatalogDigest(
  entry: Omit<MinimaxH3AttentionCatalogEntry, "catalogDigest"> | MinimaxH3AttentionCatalogEntry
): string {
  const copy = { ...entry } as Record<string, unknown>;
  delete copy.catalogDigest;
  return sha256Hex(canonicalizeJson(copy));
}

export function computeAttentionRuntimeLockDigest(manifest: {
  comfyuiCoreRevision: string;
  customNodeRevision?: string | undefined;
  pythonPackages: readonly {
    name: string;
    version: string;
    artifactHash?: string | undefined;
    importModule?: string | undefined;
  }[];
  cudaRequirement?: string | undefined;
  computeCapability?: string | undefined;
}): string {
  const {
    comfyuiCoreRevision,
    customNodeRevision,
    pythonPackages,
    cudaRequirement,
    computeCapability
  } = manifest;
  return sha256Hex(
    canonicalizeJson({
      comfyuiCoreRevision,
      ...(customNodeRevision ? { customNodeRevision } : {}),
      pythonPackages: [...pythonPackages].sort((a, b) => a.name.localeCompare(b.name)),
      ...(cudaRequirement ? { cudaRequirement } : {}),
      ...(computeCapability ? { computeCapability } : {})
    })
  );
}

export function computeAttentionConfigDigest(params: {
  workflowDigest: string;
  argv: readonly string[];
  attentionVariant: MinimaxH3AttentionVariantName;
}): string {
  return sha256Hex(
    canonicalizeJson({
      workflowDigest: params.workflowDigest,
      argv: params.argv,
      attentionVariant: params.attentionVariant
    })
  );
}

// ---------------------------------------------------------------------------
// Attention Request Schema (Additive to Descriptor V2)
// ---------------------------------------------------------------------------
export const MinimaxH3AttentionRequestSchema = z
  .object({
    attentionVariant: MinimaxH3AttentionVariantNameSchema,
    catalogDigest: sha256HashSchema,
    expectedBackend: z.string().min(1),
    expectedKernel: z.string().min(1),
    topologyDigest: sha256HashSchema,
    patches: z.array(MinimaxH3AttentionPatchNodeSchema),
    runtimeLockDigest: sha256HashSchema,
    candidateOnly: z.boolean().optional(),
    predictorIdentity: z
      .object({
        filename: z.string().min(1),
        sha256: sha256HashSchema
      })
      .strict()
      .optional(),
    denseRegionPolicy: MinimaxH3DenseRegionPolicySchema
  })
  .strict();
export type MinimaxH3AttentionRequest = z.infer<typeof MinimaxH3AttentionRequestSchema>;

// ---------------------------------------------------------------------------
// Fallback & Observation Schemas (Additive to Result V2)
// ---------------------------------------------------------------------------
export const MinimaxH3AttentionFallbackEventSchema = z
  .object({
    stepIndex: z.number().int().nonnegative(),
    layerIndex: z.number().int().nonnegative().nullable(),
    requestedBackend: z.string().min(1),
    fallbackBackend: z.string().min(1),
    reason: z.string().min(1),
    monotonicMs: z.number().nonnegative()
  })
  .strict();
export type MinimaxH3AttentionFallbackEvent = z.infer<typeof MinimaxH3AttentionFallbackEventSchema>;

export const MinimaxH3AttentionExclusionMetadataSchema = z
  .object({
    patchClass: z.string().optional(),
    hook: z.string().optional(),
    decisionMethod: z.string().optional(),
    reason: z.string().optional(),
    layer: z.union([z.number(), z.string()]).nullable().optional(),
    step: z.union([z.number(), z.string()]).nullable().optional()
  })
  .passthrough();
export type MinimaxH3AttentionExclusionMetadata = z.infer<
  typeof MinimaxH3AttentionExclusionMetadataSchema
>;

export const MinimaxH3AttentionStepRecordSchema = z
  .object({
    stepIndex: z.number().int().nonnegative(),
    layerIndex: z.number().int().nonnegative().nullable().optional(),
    backend: z.string().min(1),
    implementation: z.string().min(1),
    callType: z.enum(["accelerated", "dense", "planned_dense", "fallback"]),
    monotonicMs: z.number().nonnegative().optional(),
    metadata: MinimaxH3AttentionExclusionMetadataSchema.optional()
  })
  .strict();
export type MinimaxH3AttentionStepRecord = z.infer<typeof MinimaxH3AttentionStepRecordSchema>;

export const MinimaxH3AttentionObservationSchema = z
  .object({
    status: z.enum(["verified", "unknown", "fallback", "failed"]),
    actualBackend: z.string().min(1).nullable(),
    dispatchImplementation: z.string().min(1).nullable(),
    acceleratedCallCount: z.number().int().nonnegative(),
    denseCallCount: z.number().int().nonnegative(),
    plannedDenseCallCount: z.number().int().nonnegative(),
    fallbackEvents: z.array(MinimaxH3AttentionFallbackEventSchema),
    stepRecords: z.array(MinimaxH3AttentionStepRecordSchema).optional(),
    failureReason: z.string().min(1).nullable(),
    missingKernelFailure: z.string().min(1).nullable(),
    dtypeLayoutDiagnostics: z.record(z.string(), z.unknown()).nullable().optional(),
    measurementCoverage: z
      .object({
        samplingCallsRecorded: z.number().int().nonnegative(),
        attentionCallsRecorded: z.number().int().nonnegative(),
        complete: z.boolean()
      })
      .strict(),
    timings: z
      .object({
        deviceElapsedMs: z.number().nonnegative().nullable(),
        kernelElapsedMs: z.number().nonnegative().nullable(),
        timingUnavailableReason: z.string().min(1).nullable().optional()
      })
      .strict()
  })
  .strict();
export type MinimaxH3AttentionObservation = z.infer<typeof MinimaxH3AttentionObservationSchema>;

// ---------------------------------------------------------------------------
// Typed Attention Payload Metadata (Additive to Instrumentation Events)
// ---------------------------------------------------------------------------
export const MinimaxH3AttentionSummaryMetadataSchema = z
  .object({
    status: z.enum(["verified", "unknown", "fallback", "failed"]).optional(),
    actualBackend: z.string().nullable().optional(),
    dispatchImplementation: z.string().nullable().optional(),
    acceleratedCallCount: z.number().int().nonnegative().optional(),
    denseCallCount: z.number().int().nonnegative().optional(),
    plannedDenseCallCount: z.number().int().nonnegative().optional(),
    fallbackEvents: z.array(MinimaxH3AttentionFallbackEventSchema).optional(),
    failureReason: z.string().nullable().optional(),
    missingKernelFailure: z.string().nullable().optional(),
    dtypeLayoutDiagnostics: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .strict();
export type MinimaxH3AttentionSummaryMetadata = z.infer<
  typeof MinimaxH3AttentionSummaryMetadataSchema
>;

export const MinimaxH3AttentionEventMetadataSchema = z
  .object({
    attentionEvent: z
      .enum(["fallback", "missing_kernel", "call", "step_summary", "step_record"])
      .optional(),
    attentionSummary: MinimaxH3AttentionSummaryMetadataSchema.optional(),
    attentionStepRecord: MinimaxH3AttentionStepRecordSchema.optional(),
    stepRecords: z.array(MinimaxH3AttentionStepRecordSchema).optional(),
    attentionCall: z
      .enum(["accelerated", "dense", "planned_dense", "sage", "sol_attn", "veda", "torch_sdpa"])
      .optional(),
    requestedBackend: z.string().optional(),
    fallbackBackend: z.string().optional(),
    reason: z.string().optional(),
    stepIndex: z.number().int().nonnegative().optional(),
    layerIndex: z.number().int().nonnegative().nullable().optional(),
    backend: z.string().optional(),
    implementation: z.string().optional(),
    handshake: z.string().optional(),
    protocol: z.string().optional(),
    protocolVersion: z.string().optional(),
    pythonVersion: z.string().optional(),
    pid: z.number().int().optional(),
    collectorDigest: z.string().optional(),
    hookManifestDigest: z.string().optional(),
    nodeId: z.string().optional(),
    classType: z.string().optional(),
    startMs: z.number().optional(),
    phase: z.string().optional(),
    parentSpanId: z.string().nullable().optional()
  })
  .passthrough();
export type MinimaxH3AttentionEventMetadata = z.infer<typeof MinimaxH3AttentionEventMetadataSchema>;
