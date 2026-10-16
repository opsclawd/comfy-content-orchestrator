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
          artifactMethod: z.string().optional(),
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

export interface AttentionRuntimeSubstrateManifest {
  readonly comfyuiCoreRevision: string;
  readonly customNodeRevision?: string | undefined;
  readonly sourceFileHashes?: Record<string, string> | undefined;
  readonly interpreter?:
    | {
        readonly pythonVersion?: string | undefined;
        readonly pythonExecutableHash?: string | undefined;
        readonly pythonAbi?: string | undefined;
        readonly pythonCompiler?: string | undefined;
      }
    | undefined;
  readonly pytorchBuild?: string | undefined;
  readonly cudaBuild?: string | undefined;
  readonly driverConstraints?: readonly string[] | undefined;
  readonly pythonPackages: readonly {
    readonly name: string;
    readonly version: string;
    readonly artifactHash?: string | undefined;
    readonly artifactMethod?: string | undefined;
    readonly importModule?: string | undefined;
  }[];
  readonly cudaRequirement?: string | undefined;
  readonly computeCapability?: string | undefined;
  readonly instrumentationProtocol?: string | undefined;
  readonly collectorDigest?: string | undefined;
  readonly hookManifestDigest?: string | undefined;
  readonly hooks?:
    | readonly {
        readonly name: string;
        readonly modulePath: string;
        readonly callable: string;
        readonly phase: string;
      }[]
    | undefined;
}

const DOTTED_NUMERIC_REGEX = /^\d+(?:\.\d+)*$/;

export function compareDottedVersions(a: string, b: string): number {
  const parseParts = (v: string): number[] => {
    const trimmed = v.trim();
    if (!DOTTED_NUMERIC_REGEX.test(trimmed)) {
      throw new Error(`Invalid dotted-numeric version format: "${v}".`);
    }
    return trimmed.split(".").map((p) => Number(p));
  };

  const partsA = parseParts(a);
  const partsB = parseParts(b);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const valA = i < partsA.length ? partsA[i]! : 0;
    const valB = i < partsB.length ? partsB[i]! : 0;
    if (valA > valB) return 1;
    if (valA < valB) return -1;
  }
  return 0;
}

export function satisfiesDriverConstraint(
  driverVersion: string,
  constraint: string
): { satisfied: boolean; error?: string } {
  const trimmedConstraint = constraint.trim();
  const match = trimmedConstraint.match(/^([><]=?|==|=)\s*(\S+)$/);
  if (!match) {
    return {
      satisfied: false,
      error: `Malformed or unsupported driver constraint "${constraint}".`
    };
  }
  const op = match[1]!;
  const targetVer = match[2]!;

  if (!DOTTED_NUMERIC_REGEX.test(targetVer)) {
    return {
      satisfied: false,
      error: `Malformed or unsupported driver constraint "${constraint}".`
    };
  }

  const trimmedDriverVer = driverVersion.trim();
  if (!DOTTED_NUMERIC_REGEX.test(trimmedDriverVer)) {
    return {
      satisfied: false,
      error: `Malformed driver version "${driverVersion}".`
    };
  }

  try {
    const cmp = compareDottedVersions(trimmedDriverVer, targetVer);
    switch (op) {
      case ">=":
        return { satisfied: cmp >= 0 };
      case ">":
        return { satisfied: cmp > 0 };
      case "<=":
        return { satisfied: cmp <= 0 };
      case "<":
        return { satisfied: cmp < 0 };
      case "==":
      case "=":
        return { satisfied: cmp === 0 };
      default:
        return { satisfied: false, error: `Unsupported driver constraint operator "${op}".` };
    }
  } catch (err) {
    return { satisfied: false, error: `Invalid version comparison: ${(err as Error).message}` };
  }
}

export function computeAttentionRuntimeLockDigest(
  manifest: AttentionRuntimeSubstrateManifest
): string {
  const {
    comfyuiCoreRevision,
    customNodeRevision,
    sourceFileHashes,
    interpreter,
    pytorchBuild,
    cudaBuild,
    driverConstraints,
    pythonPackages,
    cudaRequirement,
    computeCapability,
    instrumentationProtocol,
    collectorDigest,
    hookManifestDigest,
    hooks
  } = manifest;

  // Validate no duplicate package names
  const packageNames = new Set<string>();
  for (const pkg of pythonPackages) {
    if (packageNames.has(pkg.name)) {
      throw new Error(`Duplicate package identity: "${pkg.name}"`);
    }
    packageNames.add(pkg.name);
  }

  // Canonical sorted packages
  const sortedPackages = [...pythonPackages]
    .map((p) => ({
      name: p.name,
      version: p.version,
      ...(p.artifactHash ? { artifactHash: p.artifactHash } : {}),
      ...(p.artifactMethod ? { artifactMethod: p.artifactMethod } : {})
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Canonical sorted source file hashes
  let sortedSourceFiles: Record<string, string> | undefined;
  if (sourceFileHashes) {
    sortedSourceFiles = Object.keys(sourceFileHashes)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = sourceFileHashes[key]!;
        return acc;
      }, {});
  }

  // Canonical sorted hooks
  let sortedHooks:
    | ReadonlyArray<{ name: string; modulePath: string; callable: string; phase: string }>
    | undefined;
  if (hooks) {
    const hookKeys = new Set<string>();
    for (const h of hooks) {
      const key = `${h.name}:${h.modulePath}:${h.callable}:${h.phase}`;
      if (hookKeys.has(key)) {
        throw new Error(`Duplicate hook identity: "${key}"`);
      }
      hookKeys.add(key);
    }
    sortedHooks = [...hooks].sort((a, b) => a.name.localeCompare(b.name));
  }

  const normalizedComputeCapability = computeCapability
    ? computeCapability.replace(/^sm_(\d+)(\d)$/, "$1.$2")
    : undefined;

  const substrateObject: Record<string, unknown> = {
    comfyuiCoreRevision,
    ...(customNodeRevision ? { customNodeRevision } : {}),
    ...(sortedSourceFiles ? { sourceFileHashes: sortedSourceFiles } : {}),
    ...(interpreter ? { interpreter } : {}),
    ...(pytorchBuild ? { pytorchBuild } : {}),
    ...(cudaBuild ? { cudaBuild } : {}),
    ...(driverConstraints && driverConstraints.length > 0
      ? { driverConstraints: [...driverConstraints].sort() }
      : {}),
    pythonPackages: sortedPackages,
    ...(cudaRequirement ? { cudaRequirement } : {}),
    ...(normalizedComputeCapability ? { computeCapability: normalizedComputeCapability } : {}),
    ...(instrumentationProtocol ? { instrumentationProtocol } : {}),
    ...(collectorDigest ? { collectorDigest } : {}),
    ...(hookManifestDigest ? { hookManifestDigest } : {}),
    ...(sortedHooks ? { hooks: sortedHooks } : {})
  };

  return sha256Hex(canonicalizeJson(substrateObject));
}

// ---------------------------------------------------------------------------
// Capability Handshake Schema (Live Child Verification)
// ---------------------------------------------------------------------------
export const MinimaxH3CapabilityHandshakeSchema = z
  .object({
    status: z.enum(["ok", "failed", "pending"]).optional(),
    failureReason: z.string().optional(),
    protocol: z.string().min(1),
    protocolVersion: z.string().min(1),
    runId: z.string().min(1),
    attemptToken: z.string().min(1),
    pid: z.number().int().positive(),
    nonce: z.string().min(1),
    collectorDigest: sha256HashSchema,
    hookManifestDigest: sha256HashSchema,
    kernelCallableAvailable: z.boolean().optional(),
    installedHooks: z.array(
      z
        .object({
          name: z.string().min(1),
          modulePath: z.string().min(1),
          callable: z.string().min(1),
          phase: z.string().min(1),
          attached: z.boolean(),
          details: z.string().optional()
        })
        .strict()
    ),
    registeredNodes: z.record(
      z.string(),
      z
        .object({
          className: z.string().min(1),
          module: z.string().optional(),
          sourceFile: z.string().optional(),
          moduleHash: sha256HashSchema.optional(),
          revision: z.string().optional()
        })
        .strict()
    ),
    runtimeVersions: z
      .object({
        pythonVersion: z.string().min(1),
        pythonExecutableHash: sha256HashSchema.nullable().optional(),
        pythonAbiTag: z.string().nullable().optional(),
        pythonCompiler: z.string().nullable().optional(),
        pytorchVersion: z.string().optional(),
        cudaBuildVersion: z.string().nullable().optional(),
        cudaRuntimeVersion: z.string().nullable().optional(),
        driverVersion: z.string().nullable().optional()
      })
      .strict()
      .optional(),
    packageIdentities: z
      .array(
        z
          .object({
            name: z.string().min(1),
            version: z.string().min(1),
            artifactHash: sha256HashSchema.optional(),
            artifactMethod: z.string().optional()
          })
          .strict()
      )
      .optional(),
    sourceIdentities: z.record(z.string(), sha256HashSchema).optional()
  })
  .strict();
export type MinimaxH3CapabilityHandshake = z.infer<typeof MinimaxH3CapabilityHandshakeSchema>;

export const MinimaxH3AttentionIdentityEnvelopeSchema = z
  .object({
    identityVersion: z.literal(1),
    substrateDigest: sha256HashSchema,
    interpreter: z
      .object({
        pythonVersion: z.string().min(1),
        pythonExecutableHash: sha256HashSchema.optional(),
        pythonAbi: z.string().optional(),
        pythonCompiler: z.string().optional()
      })
      .strict(),
    toolchain: z
      .object({
        pytorchBuild: z.string().min(1),
        cudaBuildVersion: z.string().nullable(),
        cudaRuntimeVersion: z.string().nullable(),
        driverVersion: z.string().nullable()
      })
      .strict(),
    packageArtifacts: z.array(
      z
        .object({
          name: z.string().min(1),
          version: z.string().min(1),
          artifactHash: sha256HashSchema,
          artifactMethod: z.string().min(1)
        })
        .strict()
    ),
    sourceIdentities: z.record(z.string(), sha256HashSchema),
    registeredNodes: z.record(
      z.string(),
      z
        .object({
          className: z.string().min(1),
          module: z.string().optional(),
          sourceFile: z.string().optional(),
          moduleHash: sha256HashSchema.optional(),
          revision: z.string().optional()
        })
        .strict()
    ),
    handshake: MinimaxH3CapabilityHandshakeSchema
  })
  .strict();
export type MinimaxH3AttentionIdentityEnvelope = z.infer<
  typeof MinimaxH3AttentionIdentityEnvelopeSchema
>;

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

export const STANDARD_MINIMAX_H3_HOOKS = Object.freeze([
  {
    name: "attention_deferred_import_hook",
    modulePath: "builtins",
    callable: "__import__",
    phase: "attention"
  },
  {
    name: "ksampler_sample",
    modulePath: "comfy.samplers",
    callable: "KSampler.sample",
    phase: "sampling"
  },
  {
    name: "load_models_gpu",
    modulePath: "comfy.model_management",
    callable: "load_models_gpu",
    phase: "lazy_gpu_residency_transfer"
  },
  {
    name: "minimax_h3_image_to_video_execute",
    modulePath: "comfy_extras.nodes_minimax_h3",
    callable: "MiniMaxH3ImageToVideo.execute",
    phase: "conditioning"
  },
  {
    name: "prompt_executor_execute",
    modulePath: "execution",
    callable: "PromptExecutor.execute",
    phase: "prompt_execution"
  },
  {
    name: "sampler_custom_advanced_execute",
    modulePath: "comfy_extras.nodes_custom_sampler",
    callable: "SamplerCustomAdvanced.execute",
    phase: "sampling"
  }
] as const);
