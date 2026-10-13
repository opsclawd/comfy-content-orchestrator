import { z } from "zod";
import {
  canonicalizeJson,
  sha256Hex,
  computeDescriptorDigest,
  MinimaxH3ExperimentRouteSchema,
  MinimaxH3MemoryPolicySchema,
  MinimaxH3RequestedRunnerPolicySchema,
  MinimaxH3ConfiguredRunnerPolicySchema,
  MinimaxH3ObservedRunnerPolicySchema,
  MinimaxH3ReferenceDescriptorSchema,
  MinimaxH3TargetSpecificationSchema,
  MinimaxH3ExperimentTimeoutsSchema,
  MinimaxH3ExperimentCandidateFramesSchema,
  MinimaxH3LifecycleStatusSchema,
  MinimaxH3ExecutionResultSchema,
  MinimaxH3CollectionResultSchema,
  MinimaxH3ProbeResultSchema,
  MinimaxH3OutputConformanceResultSchema,
  MinimaxH3VisualReviewResultSchema,
  MinimaxH3OperatorDecisionResultSchema,
  MinimaxH3StopRecommendationSchema,
  MinimaxH3ExperimentDescriptorSchema,
  MinimaxH3ExperimentResultSchema,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ExperimentResult
} from "./minimax-h3-experiment.js";
import { sha256HashSchema } from "./persistent-media.js";

export const MinimaxH3ExperimentDescriptorV1Schema = MinimaxH3ExperimentDescriptorSchema;
export type MinimaxH3ExperimentDescriptorV1 = MinimaxH3ExperimentDescriptor;
export const MinimaxH3ExperimentResultV1Schema = MinimaxH3ExperimentResultSchema;
export type MinimaxH3ExperimentResultV1 = MinimaxH3ExperimentResult;

export const MinimaxH3AnyExperimentDescriptorSchema = z.union([
  MinimaxH3ExperimentDescriptorSchema,
  z.lazy(() => MinimaxH3ExperimentDescriptorV2Schema)
]);
export type MinimaxH3AnyExperimentDescriptor =
  MinimaxH3ExperimentDescriptor | MinimaxH3ExperimentDescriptorV2;

export const MinimaxH3AnyExperimentResultSchema = z.union([
  MinimaxH3ExperimentResultSchema,
  z.lazy(() => MinimaxH3ExperimentResultV2Schema)
]);
export type MinimaxH3AnyExperimentResult = MinimaxH3ExperimentResult | MinimaxH3ExperimentResultV2;

// ---------------------------------------------------------------------------
// Pinned Checkpoint Constants (for I2V and Ref2V)
// ---------------------------------------------------------------------------
export const PINNED_H3_CHECKPOINTS = Object.freeze({
  ref2va: {
    filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
  },
  fl2va: {
    filename: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    sha256: "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a"
  }
});

// ---------------------------------------------------------------------------
// Phase Accounting Taxonomy (KTD1, KTD2, KTD3)
// ---------------------------------------------------------------------------
export const MINIMAX_H3_PHASE_TYPES = [
  "environment_startup",
  "model_loading",
  "lazy_gpu_residency_transfer",
  "conditioning",
  "text_encode",
  "vae_reference_encode",
  "sampling",
  "sampling_step",
  "vae_decode_video",
  "vae_decode_audio",
  "mux_and_save",
  "output_probe",
  "teardown",
  "whole_attempt_wall"
] as const;

export const MinimaxH3PhaseTypeSchema = z.enum(MINIMAX_H3_PHASE_TYPES);
export type MinimaxH3PhaseType = z.infer<typeof MinimaxH3PhaseTypeSchema>;

export const MinimaxH3PhaseStatusSchema = z.enum(["measured", "unknown", "not_applicable"]);
export type MinimaxH3PhaseStatus = z.infer<typeof MinimaxH3PhaseStatusSchema>;

export const MinimaxH3ClockDomainSchema = z.enum(["mono_child", "mono_parent", "none"]);
export type MinimaxH3ClockDomain = z.infer<typeof MinimaxH3ClockDomainSchema>;

export const MinimaxH3BoundarySourceSchema = z.enum([
  "child_bootstrap",
  "parent_orchestration",
  "diagnostic",
  "derived"
]);
export type MinimaxH3BoundarySource = z.infer<typeof MinimaxH3BoundarySourceSchema>;

// Raw Child/Parent Instrumentation Event (JSONL schema)
export const MinimaxH3InstrumentationEventSchema = z
  .object({
    protocolVersion: z.literal("v2-jsonl"),
    sequence: z.number().int().nonnegative(),
    runId: z.string().min(1),
    attemptToken: z.string().min(1),
    promptId: z.string().nullable().optional(),
    spanId: z.string().min(1),
    parentSpanId: z.string().nullable().optional(),
    phase: MinimaxH3PhaseTypeSchema,
    type: z.enum(["span_start", "span_end", "point_event"]),
    boundarySource: MinimaxH3BoundarySourceSchema,
    clockDomain: MinimaxH3ClockDomainSchema,
    monotonicMs: z.number().nonnegative(),
    nodeId: z.string().optional(),
    classType: z.string().optional(),
    stepIndex: z.number().int().nonnegative().optional(),
    outcome: z.enum(["success", "failed", "interrupted"]).optional(),
    error: z
      .object({
        message: z.string(),
        exceptionType: z.string().optional()
      })
      .strict()
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();
export type MinimaxH3InstrumentationEvent = z.infer<typeof MinimaxH3InstrumentationEventSchema>;
export const MinimaxH3PhaseAccountingEventSchema = MinimaxH3InstrumentationEventSchema;
export type MinimaxH3PhaseAccountingEvent = MinimaxH3InstrumentationEvent;

// Individual Step Record
export const MinimaxH3StepRecordSchema = z
  .object({
    stepIndex: z.number().int().nonnegative(),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
    durationMs: z.number().nonnegative(),
    status: z.enum(["measured", "unknown"]),
    unknownReason: z.string().nullable().optional()
  })
  .strict();
export type MinimaxH3StepRecord = z.infer<typeof MinimaxH3StepRecordSchema>;

// Measured Phase Record
export const MinimaxH3PhaseRecordSchema = z
  .object({
    phase: MinimaxH3PhaseTypeSchema,
    status: MinimaxH3PhaseStatusSchema,
    durationMs: z.number().nonnegative().nullable(),
    startMs: z.number().nonnegative().nullable(),
    endMs: z.number().nonnegative().nullable(),
    boundarySource: MinimaxH3BoundarySourceSchema,
    clockDomain: MinimaxH3ClockDomainSchema,
    unknownReason: z.string().nullable(),
    stepCount: z.number().int().nonnegative().optional(),
    steps: z.array(MinimaxH3StepRecordSchema).optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === "measured") {
      if (val.durationMs === null || val.startMs === null || val.endMs === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Phase '${val.phase}' status 'measured' requires non-null durationMs, startMs, and endMs`,
          path: ["durationMs"]
        });
      } else if (val.endMs < val.startMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Phase '${val.phase}' endMs (${val.endMs}) cannot be less than startMs (${val.startMs})`,
          path: ["endMs"]
        });
      }
    } else {
      if (val.durationMs !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Phase '${val.phase}' status '${val.status}' requires null durationMs`,
          path: ["durationMs"]
        });
      }
      if (!val.unknownReason && val.status === "unknown") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Phase '${val.phase}' status 'unknown' requires an unknownReason`,
          path: ["unknownReason"]
        });
      }
    }
  });
export type MinimaxH3PhaseRecord = z.infer<typeof MinimaxH3PhaseRecordSchema>;

// Phase Accounting Summary Result
export const MinimaxH3PhaseAccountingResultSchema = z
  .object({
    status: z.enum(["complete", "partial", "missing"]),
    phases: z.record(MinimaxH3PhaseTypeSchema, MinimaxH3PhaseRecordSchema),
    wholeAttemptWallMs: z.number().nonnegative(),
    samplingWallTimeMs: z.number().nonnegative().nullable(),
    deviceElapsedMs: z.number().nonnegative().nullable(),
    gpuKernelTimeMs: z.number().nonnegative().nullable(),
    profilerMode: z.enum(["none", "pytorch_profiler", "nvtx", "unknown"]),
    coverageGaps: z.array(
      z
        .object({
          startMs: z.number().nonnegative(),
          endMs: z.number().nonnegative(),
          durationMs: z.number().nonnegative(),
          reason: z.string()
        })
        .strict()
    ),
    intervalInconsistencies: z.array(z.string())
  })
  .strict();
export type MinimaxH3PhaseAccountingResult = z.infer<typeof MinimaxH3PhaseAccountingResultSchema>;

// ---------------------------------------------------------------------------
// Conditioning Bindings & Factor Change Discriminated Unions (KTD5a - Witness F1)
// ---------------------------------------------------------------------------
export const MinimaxH3ConditioningBindingSchema = z
  .object({
    role: z.string().min(1),
    slotIndex: z.number().int().min(0).max(8),
    kind: z.enum(["first_frame", "last_frame", "reference"]),
    assetPath: z.string().min(1),
    sha256: sha256HashSchema,
    targetNodeId: z.string().min(1),
    targetInputName: z.string().min(1)
  })
  .strict();
export type MinimaxH3ConditioningBinding = z.infer<typeof MinimaxH3ConditioningBindingSchema>;

export const MinimaxH3PromptConditioningSchema = z
  .object({
    positivePrompt: z
      .object({
        text: z.string().min(1),
        digest: sha256HashSchema
      })
      .strict(),
    negativePrompt: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("not_supported"),
          text: z.null(),
          digest: z.null()
        })
        .strict(),
      z
        .object({
          status: z.literal("supported"),
          text: z.string().min(1),
          digest: sha256HashSchema
        })
        .strict()
    ]),
    bindings: z.array(MinimaxH3ConditioningBindingSchema)
  })
  .strict();
export type MinimaxH3PromptConditioning = z.infer<typeof MinimaxH3PromptConditioningSchema>;

// FactorChange discriminated union by exact semantic path
export const FactorChangePositivePromptSchema = z
  .object({
    path: z.literal("conditioning.positivePrompt"),
    before: z
      .object({
        text: z.string().min(1),
        digest: sha256HashSchema
      })
      .strict(),
    after: z
      .object({
        text: z.string().min(1),
        digest: sha256HashSchema
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeNegativePromptSchema = z
  .object({
    path: z.literal("conditioning.negativePrompt"),
    before: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("not_supported"),
          text: z.null(),
          digest: z.null()
        })
        .strict(),
      z
        .object({
          status: z.literal("supported"),
          text: z.string().min(1),
          digest: sha256HashSchema
        })
        .strict()
    ]),
    after: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("not_supported"),
          text: z.null(),
          digest: z.null()
        })
        .strict(),
      z
        .object({
          status: z.literal("supported"),
          text: z.string().min(1),
          digest: sha256HashSchema
        })
        .strict()
    ]),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeBindingsSchema = z
  .object({
    path: z.literal("conditioning.bindings"),
    before: z.array(MinimaxH3ConditioningBindingSchema),
    after: z.array(MinimaxH3ConditioningBindingSchema),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeDiffusionModelSchema = z
  .object({
    path: z.literal("models.diffusion"),
    before: z
      .object({
        repository: z.string().min(1),
        revision: z.string().min(1),
        filename: z.string().min(1),
        fileHash: sha256HashSchema,
        taskMode: z.string().min(1),
        licenseSourceRef: z.string().min(1)
      })
      .strict(),
    after: z
      .object({
        repository: z.string().min(1),
        revision: z.string().min(1),
        filename: z.string().min(1),
        fileHash: sha256HashSchema,
        taskMode: z.string().min(1),
        licenseSourceRef: z.string().min(1)
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeAuxiliaryModelSchema = z
  .object({
    path: z.literal("models.auxiliary"),
    before: z.array(
      z
        .object({
          name: z.string().min(1),
          hash: sha256HashSchema,
          strength: z.number(),
          role: z.string().min(1),
          order: z.number().int().nonnegative()
        })
        .strict()
    ),
    after: z.array(
      z
        .object({
          name: z.string().min(1),
          hash: sha256HashSchema,
          strength: z.number(),
          role: z.string().min(1),
          order: z.number().int().nonnegative()
        })
        .strict()
    ),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeSamplingSettingsSchema = z
  .object({
    path: z.literal("sampling.settings"),
    before: z
      .object({
        sampler: z.string().min(1),
        scheduler: z.string().min(1),
        steps: z.number().int().positive()
      })
      .strict(),
    after: z
      .object({
        sampler: z.string().min(1),
        scheduler: z.string().min(1),
        steps: z.number().int().positive()
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeAttentionConfigSchema = z
  .object({
    path: z.literal("attention.configuration"),
    before: z
      .object({
        backend: z.string().min(1),
        topologyDigest: sha256HashSchema,
        patches: z.array(z.string())
      })
      .strict(),
    after: z
      .object({
        backend: z.string().min(1),
        topologyDigest: sha256HashSchema,
        patches: z.array(z.string())
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeMemoryOffloadSchema = z
  .object({
    path: z.literal("memory.offload"),
    before: z
      .object({
        requestedPolicy: MinimaxH3MemoryPolicySchema,
        modelOffload: z.boolean()
      })
      .strict(),
    after: z
      .object({
        requestedPolicy: MinimaxH3MemoryPolicySchema,
        modelOffload: z.boolean()
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeDecodeConfigSchema = z
  .object({
    path: z.literal("decode.configuration"),
    before: z
      .object({
        videoStrategy: z.string().min(1),
        audioStrategy: z.string().min(1),
        topologyDigest: sha256HashSchema
      })
      .strict(),
    after: z
      .object({
        videoStrategy: z.string().min(1),
        audioStrategy: z.string().min(1),
        topologyDigest: sha256HashSchema
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const FactorChangeRuntimeManifestSchema = z
  .object({
    path: z.literal("runtime.manifest"),
    before: z
      .object({
        runtimeManifestDigest: sha256HashSchema,
        hookManifestDigest: sha256HashSchema
      })
      .strict(),
    after: z
      .object({
        runtimeManifestDigest: sha256HashSchema,
        hookManifestDigest: sha256HashSchema
      })
      .strict(),
    rationale: z.string().min(1)
  })
  .strict();

export const MinimaxH3FactorChangeSchema = z.discriminatedUnion("path", [
  FactorChangePositivePromptSchema,
  FactorChangeNegativePromptSchema,
  FactorChangeBindingsSchema,
  FactorChangeDiffusionModelSchema,
  FactorChangeAuxiliaryModelSchema,
  FactorChangeSamplingSettingsSchema,
  FactorChangeAttentionConfigSchema,
  FactorChangeMemoryOffloadSchema,
  FactorChangeDecodeConfigSchema,
  FactorChangeRuntimeManifestSchema
]);
export type MinimaxH3FactorChange = z.infer<typeof MinimaxH3FactorChangeSchema>;

export const MinimaxH3ExperimentVariantSchema = z
  .object({
    variantName: z.string().min(1),
    variantReason: z.string().min(1).nullable(),
    purpose: z.enum(["performance", "prompt_conditioning", "controlled_multifactor"]),
    changedFactors: z.array(MinimaxH3FactorChangeSchema),
    baselineRunId: z.string().nullable().optional(),
    baselineDescriptorDigest: sha256HashSchema.nullable().optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    // Validate purpose restrictions (KTD5a)
    if (val.purpose === "performance") {
      const hasPromptChanges = val.changedFactors.some(
        (f) =>
          f.path === "conditioning.positivePrompt" ||
          f.path === "conditioning.negativePrompt" ||
          f.path === "conditioning.bindings"
      );
      if (hasPromptChanges) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Purpose 'performance' forbids conditioning or prompt factor changes; prompts and bindings must remain identical",
          path: ["changedFactors"]
        });
      }
    } else if (val.purpose === "prompt_conditioning") {
      const hasNonPromptChanges = val.changedFactors.some(
        (f) =>
          f.path !== "conditioning.positivePrompt" &&
          f.path !== "conditioning.negativePrompt" &&
          f.path !== "conditioning.bindings"
      );
      if (hasNonPromptChanges) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Purpose 'prompt_conditioning' admits only prompt or conditioning factor changes",
          path: ["changedFactors"]
        });
      }
      if (val.changedFactors.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Purpose 'prompt_conditioning' requires exactly 1 declared factor change for single-variable study",
          path: ["changedFactors"]
        });
      }
    }
  });
export type MinimaxH3ExperimentVariant = z.infer<typeof MinimaxH3ExperimentVariantSchema>;

// ---------------------------------------------------------------------------
// Compatibility & Isolated-Runtime Manifests (KTD6 - Witness F2)
// ---------------------------------------------------------------------------
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

export const MinimaxH3CompatibilityAssessmentSchema = z
  .object({
    state: MinimaxH3CompatibilityStateSchema,
    relativeToRuntimeManifestDigest: sha256HashSchema,
    scope: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1),
    sources: z.array(MinimaxH3SourceEvidenceRefSchema).min(1)
  })
  .strict();
export type MinimaxH3CompatibilityAssessment = z.infer<
  typeof MinimaxH3CompatibilityAssessmentSchema
>;

export const MinimaxH3RequiredRuntimeManifestSchema = z
  .object({
    coreRevision: z.string().min(1),
    sourceFileHashes: z.record(z.string(), sha256HashSchema),
    requiredNodes: z.array(
      z
        .object({
          name: z.string().min(1),
          revision: z.string().optional(),
          moduleHash: sha256HashSchema.optional()
        })
        .strict()
    ),
    pythonPackages: z.array(
      z
        .object({
          name: z.string().min(1),
          version: z.string().min(1),
          artifactHash: sha256HashSchema.optional()
        })
        .strict()
    ),
    pytorchBuild: z.string().min(1),
    cudaBuild: z.string().min(1),
    driverConstraints: z.array(z.string().min(1)),
    attentionKernel: z.string().min(1),
    instrumentationProtocol: z.string().min(1),
    collectorDigest: sha256HashSchema,
    hookManifestDigest: sha256HashSchema,
    hooks: z.array(
      z
        .object({
          name: z.string().min(1),
          modulePath: z.string().min(1),
          callable: z.string().min(1),
          phase: MinimaxH3PhaseTypeSchema
        })
        .strict()
    )
  })
  .strict()
  .superRefine((val, ctx) => {
    // Package names must be unique
    const seen = new Set<string>();
    for (const pkg of val.pythonPackages) {
      if (seen.has(pkg.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate package name '${pkg.name}' in requiredRuntime.pythonPackages`,
          path: ["pythonPackages"]
        });
      }
      seen.add(pkg.name);
    }
  });
export type MinimaxH3RequiredRuntimeManifest = z.infer<
  typeof MinimaxH3RequiredRuntimeManifestSchema
>;

// ---------------------------------------------------------------------------
// Provenance: Requested vs Observed
// ---------------------------------------------------------------------------
export const MinimaxH3DescriptorProvenanceSchema = z
  .object({
    canonicalTemplateHash: sha256HashSchema,
    derivedWorkflowDigest: sha256HashSchema,
    actualCheckpointHash: sha256HashSchema,
    loadedModelHashes: z.record(z.string(), sha256HashSchema),
    comfyuiCoreRevision: z.string().min(1),
    sourceIdentities: z
      .object({
        cliArgsSha256: sha256HashSchema,
        mainSha256: sha256HashSchema,
        modelManagementSha256: sha256HashSchema,
        nodesMinimaxH3Sha256: sha256HashSchema.optional()
      })
      .strict(),
    customNodeInventory: z
      .object({
        status: z.enum(["verified_empty", "inventory", "unknown"]),
        nodes: z.array(
          z
            .object({
              name: z.string().min(1),
              revision: z.string().optional(),
              moduleHash: sha256HashSchema.optional()
            })
            .strict()
        )
      })
      .strict(),
    runtimeVersions: z
      .object({
        pythonVersion: z.string().min(1),
        pytorchVersion: z.string().min(1),
        cudaBuildVersion: z.string().min(1),
        cudaRuntimeVersion: z.string().min(1),
        driverVersion: z.string().min(1)
      })
      .strict(),
    requestedAttentionBackend: z.string().min(1),
    requestedMemoryPolicy: MinimaxH3MemoryPolicySchema,
    samplerSettings: z
      .object({
        sampler: z.string().min(1),
        scheduler: z.string().min(1),
        steps: z.number().int().positive()
      })
      .strict(),
    sourceAssetDigests: z.array(
      z
        .object({
          role: z.string().min(1),
          slotIndex: z.number().int().nonnegative(),
          sha256: sha256HashSchema
        })
        .strict()
    ),
    promptDigest: sha256HashSchema,
    instrumentationProtocol: z.string().min(1),
    collectorDigest: sha256HashSchema,
    hookManifestDigest: sha256HashSchema
  })
  .strict();
export type MinimaxH3DescriptorProvenance = z.infer<typeof MinimaxH3DescriptorProvenanceSchema>;

export const MinimaxH3ObservedProvenanceSchema = z
  .object({
    actualCheckpointHash: z
      .object({
        status: z.enum(["verified", "unknown", "conflict"]),
        value: sha256HashSchema.nullable(),
        expected: sha256HashSchema,
        unknownReason: z.string().nullable().optional()
      })
      .strict(),
    loadedModelHashes: z.record(
      z.string(),
      z
        .object({
          status: z.enum(["verified", "unknown", "conflict"]),
          value: sha256HashSchema.nullable(),
          expected: sha256HashSchema,
          resolvedPath: z.string().min(1)
        })
        .strict()
    ),
    comfyuiCoreRevision: z
      .object({
        status: z.enum(["verified", "unknown", "conflict"]),
        value: z.string().nullable(),
        expected: z.string().min(1)
      })
      .strict(),
    sourceIdentities: z
      .object({
        status: z.enum(["verified", "unknown", "conflict"]),
        values: z.record(z.string(), sha256HashSchema).nullable()
      })
      .strict(),
    customNodeInventory: z
      .object({
        status: z.enum(["verified_empty", "inventory", "unknown"]),
        nodes: z.array(
          z
            .object({
              name: z.string().min(1),
              revision: z.string().optional(),
              moduleHash: sha256HashSchema.optional()
            })
            .strict()
        )
      })
      .strict(),
    runtimeVersions: z
      .object({
        status: z.enum(["verified", "unknown"]),
        pythonVersion: z.string().nullable(),
        pytorchVersion: z.string().nullable(),
        cudaBuildVersion: z.string().nullable(),
        cudaRuntimeVersion: z.string().nullable(),
        driverVersion: z.string().nullable()
      })
      .strict(),
    observedAttentionBackend: z
      .object({
        status: z.enum(["verified", "unknown", "fallback"]),
        effectiveBackend: z.string().nullable(),
        dispatchImplementation: z.string().nullable(),
        unknownReason: z.string().nullable().optional()
      })
      .strict(),
    bootstrapHandshake: z
      .object({
        status: z.enum(["verified", "missing", "unsupported"]),
        protocol: z.string().nullable(),
        collectorDigest: sha256HashSchema.nullable(),
        hookManifestDigest: sha256HashSchema.nullable()
      })
      .strict(),
    conflicts: z.array(z.string())
  })
  .strict();
export type MinimaxH3ObservedProvenance = z.infer<typeof MinimaxH3ObservedProvenanceSchema>;

export const MinimaxH3InstrumentationReportSchema = z
  .object({
    completeness: z.enum(["complete", "partial", "missing"]),
    eventCount: z.number().int().nonnegative(),
    spansRecorded: z.number().int().nonnegative(),
    missingExpectedPhases: z.array(MinimaxH3PhaseTypeSchema),
    clockGapsDetected: z.boolean(),
    tamperingDetected: z.boolean(),
    reasons: z.array(z.string())
  })
  .strict();
export type MinimaxH3InstrumentationReport = z.infer<typeof MinimaxH3InstrumentationReportSchema>;

// ---------------------------------------------------------------------------
// V2 Descriptor Schema (Strict v2 schema, KTD1)
// ---------------------------------------------------------------------------
export const MinimaxH3ExperimentDescriptorV2Schema = z
  .object({
    schemaVersion: z.literal(2),
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
    comparisonKey: z.string().min(1),

    // V2 additive fields
    experimentVariant: MinimaxH3ExperimentVariantSchema,
    provenance: MinimaxH3DescriptorProvenanceSchema,
    compatibility: MinimaxH3CompatibilityAssessmentSchema,
    requiredRuntime: MinimaxH3RequiredRuntimeManifestSchema,
    conditioning: MinimaxH3PromptConditioningSchema,
    stepOverride: z.number().int().positive().max(100).nullable().optional(),
    checkpointOverride: z.enum(["ref2va", "fl2va"]).nullable().optional()
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
    const isSupportedDimensionPair =
      (val.width === 1344 && val.height === 768) ||
      (val.width === 1280 && val.height === 720) ||
      (val.width === 768 && val.height === 1344) ||
      (val.width === 720 && val.height === 1280);
    if (!isSupportedDimensionPair) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Geometry ${val.width}x${val.height} is not supported for H3 experiments`,
        path: ["width"]
      });
    }
  });
export type MinimaxH3ExperimentDescriptorV2 = z.infer<typeof MinimaxH3ExperimentDescriptorV2Schema>;

// ---------------------------------------------------------------------------
// V2 Result Schema (Strict v2 schema, KTD1)
// ---------------------------------------------------------------------------
export const MinimaxH3ExperimentResultV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    runId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Invalid runId format"),
    descriptorDigest: sha256HashSchema,
    configDigest: sha256HashSchema,
    comparisonKey: z.string().min(1),
    lifecycle: MinimaxH3LifecycleStatusSchema,
    observedRunner: MinimaxH3ObservedRunnerPolicySchema,
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
    stopRecommendation: MinimaxH3StopRecommendationSchema,

    // V2 additive result fields
    experimentVariant: MinimaxH3ExperimentVariantSchema,
    observedProvenance: MinimaxH3ObservedProvenanceSchema,
    compatibility: MinimaxH3CompatibilityAssessmentSchema,
    phaseAccounting: MinimaxH3PhaseAccountingResultSchema,
    instrumentationReport: MinimaxH3InstrumentationReportSchema
  })
  .strict();
export type MinimaxH3ExperimentResultV2 = z.infer<typeof MinimaxH3ExperimentResultV2Schema>;

// ---------------------------------------------------------------------------
// Controlled Comparison Specification & Report (KTD5, KTD5a - Witness F1)
// ---------------------------------------------------------------------------
export const MinimaxH3ComparisonPurposeSchema = z.enum([
  "performance",
  "prompt_conditioning",
  "controlled_multifactor"
]);
export type MinimaxH3ComparisonPurpose = z.infer<typeof MinimaxH3ComparisonPurposeSchema>;

export const MinimaxH3ComparisonSpecificationSchema = z
  .object({
    schemaVersion: z.literal(2),
    purpose: MinimaxH3ComparisonPurposeSchema,
    baselineRunId: z.string().min(1),
    baselineDescriptorDigest: sha256HashSchema,
    baselineResultDigest: sha256HashSchema,
    variantRunId: z.string().min(1),
    variantDescriptorDigest: sha256HashSchema,
    variantResultDigest: sha256HashSchema,
    declaredFactorChanges: z.array(MinimaxH3FactorChangeSchema)
  })
  .strict();
export type MinimaxH3ComparisonSpecification = z.infer<
  typeof MinimaxH3ComparisonSpecificationSchema
>;

export const MinimaxH3StructuralAdmissionResultSchema = z
  .object({
    eligible: z.boolean(),
    reasons: z.array(z.string()),
    invariantProjectionKey: z.string().min(1).nullable()
  })
  .strict();
export type MinimaxH3StructuralAdmissionResult = z.infer<
  typeof MinimaxH3StructuralAdmissionResultSchema
>;

export const MinimaxH3MetricEligibilitySchema = z
  .object({
    wallTimeEligible: z.boolean(),
    samplingWallEligible: z.boolean(),
    kernelTimeEligible: z.boolean(),
    reasons: z.array(z.string())
  })
  .strict();
export type MinimaxH3MetricEligibility = z.infer<typeof MinimaxH3MetricEligibilitySchema>;

export const MinimaxH3ComparisonMetricsSchema = z
  .object({
    baselineWallTimeMs: z.number().nonnegative().nullable(),
    variantWallTimeMs: z.number().nonnegative().nullable(),
    wallTimeRatio: z.number().positive().nullable(),
    baselineSamplingWallTimeMs: z.number().nonnegative().nullable(),
    variantSamplingWallTimeMs: z.number().nonnegative().nullable(),
    samplingWallTimeRatio: z.number().positive().nullable(),
    baselineGpuKernelTimeMs: z.number().nonnegative().nullable(),
    variantGpuKernelTimeMs: z.number().nonnegative().nullable(),
    gpuKernelTimeRatio: z.number().positive().nullable()
  })
  .strict();
export type MinimaxH3ComparisonMetrics = z.infer<typeof MinimaxH3ComparisonMetricsSchema>;

export const MinimaxH3ComparisonReportSchema = z
  .object({
    schemaVersion: z.literal(2),
    purpose: MinimaxH3ComparisonPurposeSchema,
    baselineRunId: z.string().min(1),
    variantRunId: z.string().min(1),
    baselineDescriptorDigest: sha256HashSchema,
    variantDescriptorDigest: sha256HashSchema,
    structuralAdmission: MinimaxH3StructuralAdmissionResultSchema,
    metricEligibility: MinimaxH3MetricEligibilitySchema,
    normalizedOperationalDifferences: z.array(
      z
        .object({
          field: z.string().min(1),
          baselineValue: z.string(),
          variantValue: z.string()
        })
        .strict()
    ),
    factorDifferences: z.array(MinimaxH3FactorChangeSchema),
    metrics: MinimaxH3ComparisonMetricsSchema.nullable(),
    mediaConformance: z
      .object({
        baselineConformant: z.boolean(),
        variantConformant: z.boolean()
      })
      .strict(),
    operatorEvaluation: z
      .object({
        reviewed: z.boolean(),
        notes: z.string().nullable().optional()
      })
      .strict()
  })
  .strict();
export type MinimaxH3ComparisonReport = z.infer<typeof MinimaxH3ComparisonReportSchema>;

// ---------------------------------------------------------------------------
// Helper: Compute Invariant Comparison Key for Pair Admission (KTD5, KTD5a)
// Replaces declared factor values with typed placeholders to prove invariant controls
// ---------------------------------------------------------------------------
export function computeInvariantProjectionKey(options: {
  route: string;
  frames: number;
  width: number;
  height: number;
  fps: number;
  seed: number;
  baseProfileKey: string;
  declaredPaths: readonly string[];
  positivePromptText: string;
  references: ReadonlyArray<{
    slotIndex: number;
    role: string;
    sha256: string;
  }>;
  diffusionModelFileHash: string;
  samplerSettings: { sampler: string; scheduler: string; steps: number };
  memoryPolicy: string;
}): string {
  const declaredSet = new Set(options.declaredPaths);
  const payload = {
    route: options.route,
    frames: options.frames,
    width: options.width,
    height: options.height,
    fps: options.fps,
    seed: options.seed,
    baseProfileKey: options.baseProfileKey,
    positivePrompt: declaredSet.has("conditioning.positivePrompt")
      ? "<DECLARED_FACTOR_VARIATION>"
      : options.positivePromptText,
    references: declaredSet.has("conditioning.bindings")
      ? "<DECLARED_FACTOR_VARIATION>"
      : options.references.map((r) => ({
          slotIndex: r.slotIndex,
          role: r.role,
          sha256: r.sha256
        })),
    diffusionModel: declaredSet.has("models.diffusion")
      ? "<DECLARED_FACTOR_VARIATION>"
      : options.diffusionModelFileHash,
    samplingSettings: declaredSet.has("sampling.settings")
      ? "<DECLARED_FACTOR_VARIATION>"
      : options.samplerSettings,
    memoryPolicy: declaredSet.has("memory.offload")
      ? "<DECLARED_FACTOR_VARIATION>"
      : options.memoryPolicy
  };
  return sha256Hex(canonicalizeJson(payload));
}

// ---------------------------------------------------------------------------
// Create Empty V2 Measurement Template (KTD1)
// ---------------------------------------------------------------------------
export function createEmptyMinimaxH3MeasurementTemplateV2(
  descriptor: MinimaxH3ExperimentDescriptorV2
): MinimaxH3ExperimentResultV2 {
  const now = new Date().toISOString();
  const phases: Record<string, MinimaxH3PhaseRecord> = {};
  for (const phase of MINIMAX_H3_PHASE_TYPES) {
    phases[phase] = {
      phase,
      status: "unknown",
      durationMs: null,
      startMs: null,
      endMs: null,
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      unknownReason: "not_started"
    };
  }

  return {
    schemaVersion: 2,
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
    },
    experimentVariant: descriptor.experimentVariant,
    observedProvenance: {
      actualCheckpointHash: {
        status: "unknown",
        value: null,
        expected: descriptor.provenance.actualCheckpointHash,
        unknownReason: "not_started"
      },
      loadedModelHashes: {},
      comfyuiCoreRevision: {
        status: "unknown",
        value: null,
        expected: descriptor.provenance.comfyuiCoreRevision
      },
      sourceIdentities: {
        status: "unknown",
        values: null
      },
      customNodeInventory: {
        status: "unknown",
        nodes: []
      },
      runtimeVersions: {
        status: "unknown",
        pythonVersion: null,
        pytorchVersion: null,
        cudaBuildVersion: null,
        cudaRuntimeVersion: null,
        driverVersion: null
      },
      observedAttentionBackend: {
        status: "unknown",
        effectiveBackend: null,
        dispatchImplementation: null,
        unknownReason: "not_started"
      },
      bootstrapHandshake: {
        status: "missing",
        protocol: null,
        collectorDigest: null,
        hookManifestDigest: null
      },
      conflicts: []
    },
    compatibility: descriptor.compatibility,
    phaseAccounting: {
      status: "missing",
      phases: phases as Record<MinimaxH3PhaseType, MinimaxH3PhaseRecord>,
      wholeAttemptWallMs: 0,
      samplingWallTimeMs: null,
      deviceElapsedMs: null,
      gpuKernelTimeMs: null,
      profilerMode: "none",
      coverageGaps: [],
      intervalInconsistencies: []
    },
    instrumentationReport: {
      completeness: "missing",
      eventCount: 0,
      spansRecorded: 0,
      missingExpectedPhases: [...MINIMAX_H3_PHASE_TYPES],
      clockGapsDetected: false,
      tamperingDetected: false,
      reasons: ["Run has not executed; template initialized with empty measurements"]
    }
  };
}
