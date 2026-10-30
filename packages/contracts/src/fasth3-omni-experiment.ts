import { z } from "zod";
import { sha256HashSchema } from "./persistent-media.js";
import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";

// ---------------------------------------------------------------------------
// Pinned Upstream Revisions and Published Metadata Hashes (Verified 2026-10-29)
// ---------------------------------------------------------------------------

export const FASTH3_OMNI_BF16_REPO = "FastVideo/FastVideo-FastH3-Omni-8-Step-V1";
export const FASTH3_OMNI_BF16_REVISION = "53e0d26a1691aa473b6262d8196a8feb2c297df0";

export const FASTH3_OMNI_COMFY_REPO = "FastVideo/FastH3-Omni-Comfy";
export const FASTH3_OMNI_COMFY_REVISION = "82eff2a6eee6c962846879f4bab52610a4df24d3";

export const FASTH3_OMNI_FASTVIDEO_SOURCE_COMMIT = "7203b4976eefcd70a52728ca1281797ce96734eb";
export const FASTH3_OMNI_BASE_MINIMAX_REVISION = "42ed227ee7df40d41602854ae760620d6eb651fe";

export const FASTH3_OMNI_COMFY_INT8_CHECKPOINT = Object.freeze({
  filename: "fasth3_omniref_8step_pruned_int8_convrot.safetensors",
  sha256: "851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80",
  sizeBytes: 22213723064,
  quantization: "int8_convrot",
  repository: FASTH3_OMNI_COMFY_REPO,
  revision: FASTH3_OMNI_COMFY_REVISION
});

export const FASTH3_OMNI_LOCAL_SUPPORTED_FRAMES = Object.freeze([124, 243, 362] as const);
export type FastH3OmniLocalSupportedFrame = (typeof FASTH3_OMNI_LOCAL_SUPPORTED_FRAMES)[number];

export const FASTH3_OMNI_FPS = 24;

export const REACTOR_HOSTED_DISCRETE_DURATIONS = Object.freeze([
  5.875, 8.0, 10.125, 12.25, 14.375
] as const);
export type ReactorHostedDiscreteDuration = (typeof REACTOR_HOSTED_DISCRETE_DURATIONS)[number];

// ---------------------------------------------------------------------------
// Canonical JSON & Hashing Utilities
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Audit & Claim Schemas
// ---------------------------------------------------------------------------

export const FastH3OmniVerificationStatusSchema = z.enum([
  "verified",
  "unverified",
  "unsupported",
  "not_released",
  "review_required"
]);
export type FastH3OmniVerificationStatus = z.infer<typeof FastH3OmniVerificationStatusSchema>;

export const FastH3OmniVerificationMethodSchema = z.enum([
  "remote_metadata_lfs",
  "source_code_inspection",
  "local_file_digest",
  "hardware_probe",
  "legal_audit",
  "unverified"
]);
export type FastH3OmniVerificationMethod = z.infer<typeof FastH3OmniVerificationMethodSchema>;

export const FastH3OmniAuditClaimSchema = z
  .object({
    claimId: z.string().min(1),
    claimText: z.string().min(1),
    status: FastH3OmniVerificationStatusSchema,
    basis: z.string().min(1),
    sourceUrl: z.string().url(),
    retrievedAt: z.string().datetime(),
    revision: z.string().nullable().optional(),
    /** SHA-256 of a stored copy of the retrieved evidence. Never a substituted or padded value. */
    evidenceDigest: sha256HashSchema.nullable().optional(),
    /** Digest published by the upstream host (e.g. Hugging Face LFS) for a file. Not a local verification. */
    upstreamLfsSha256: sha256HashSchema.nullable().optional(),
    verificationMethod: FastH3OmniVerificationMethodSchema
  })
  .superRefine((claim, ctx) => {
    if (claim.status === "verified" && !claim.evidenceDigest && !claim.upstreamLfsSha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Claim "${claim.claimId}" is marked verified but carries neither an evidence digest nor an upstream-published digest; mark it unverified`
      });
    }
  });
export type FastH3OmniAuditClaim = z.infer<typeof FastH3OmniAuditClaimSchema>;

export const FastH3OmniAuditSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  auditDigest: sha256HashSchema,
  retrievedAt: z.string().datetime(),
  upstreamReleaseStatus: z.enum(["released", "not_released", "partially_released"]),
  claims: z.array(FastH3OmniAuditClaimSchema).min(1),
  rejectedCandidates: z.array(
    z.object({
      name: z.string().min(1),
      reason: z.string().min(1)
    })
  )
});
export type FastH3OmniAuditSnapshot = z.infer<typeof FastH3OmniAuditSnapshotSchema>;

// ---------------------------------------------------------------------------
// Capability & Compatibility Schemas
// ---------------------------------------------------------------------------

export const FastH3OmniRouteSchema = z.enum(["ref2va", "ref2v", "i2v", "t2v"]);
export type FastH3OmniRoute = z.infer<typeof FastH3OmniRouteSchema>;

export const FastH3OmniRuntimeLaneSchema = z.enum([
  "isolated_fastvideo_sm89",
  "pinned_comfyui",
  "isolated_comfyui",
  "hosted_reactor"
]);
export type FastH3OmniRuntimeLane = z.infer<typeof FastH3OmniRuntimeLaneSchema>;

export const FastH3OmniCapabilitySchema = z.object({
  capabilityDigest: sha256HashSchema,
  lane: FastH3OmniRuntimeLaneSchema,
  route: FastH3OmniRouteSchema,
  supportedFrames: z.array(z.number().int().positive()).min(1),
  supportedFps: z.number().int().positive(),
  supportedResolutions: z
    .array(
      z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive()
      })
    )
    .min(1),
  minReferenceImages: z.number().int().min(1),
  maxReferenceImages: z.number().int().min(1),
  supportsKeyframes: z.boolean(),
  supportsAudio: z.boolean(),
  supportsContinuation: z.boolean(),
  requiredKernel: z.string().min(1),
  precision: z.string().min(1),
  layerStreamingBlocks: z.number().int().positive().nullable().optional()
});
export type FastH3OmniCapability = z.infer<typeof FastH3OmniCapabilitySchema>;

// ---------------------------------------------------------------------------
// Campaign Reference Inputs & Binding Manifest Schemas
// ---------------------------------------------------------------------------

export const FastH3OmniSemanticPurposeSchema = z.enum([
  "subject_identity",
  "wardrobe",
  "product",
  "location",
  "style",
  "composition"
]);
export type FastH3OmniSemanticPurpose = z.infer<typeof FastH3OmniSemanticPurposeSchema>;

export const FastH3OmniReferenceInputSchema = z.object({
  assetId: z.string().uuid(),
  contentHashSha256: sha256HashSchema,
  mimeType: z.enum(["image/png", "image/jpeg"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  semanticPurposes: z.array(FastH3OmniSemanticPurposeSchema).min(1),
  localPath: z.string().min(1).optional()
});
export type FastH3OmniReferenceInput = z.infer<typeof FastH3OmniReferenceInputSchema>;

export const FastH3OmniAudioReferenceInputSchema = z.object({
  assetId: z.string().uuid(),
  contentHashSha256: sha256HashSchema,
  mimeType: z.enum(["audio/wav", "audio/mpeg", "audio/flac"]),
  role: z.enum(["voice", "music", "ambient", "sfx"]),
  localPath: z.string().min(1).optional()
});
export type FastH3OmniAudioReferenceInput = z.infer<typeof FastH3OmniAudioReferenceInputSchema>;

export const FastH3OmniCampaignExportManifestSchema = z.object({
  campaignId: z.string().uuid(),
  sceneId: z.string().uuid(),
  specRevision: z.number().int().positive(),
  referenceSetId: z.string().uuid(),
  exportDigest: sha256HashSchema,
  createdAt: z.string().datetime(),
  orderedReferences: z.array(FastH3OmniReferenceInputSchema).min(1),
  optionalFirstFrame: FastH3OmniReferenceInputSchema.nullable().optional(),
  optionalLastFrame: FastH3OmniReferenceInputSchema.nullable().optional(),
  optionalAudioReferences: z.array(FastH3OmniAudioReferenceInputSchema).optional()
});
export type FastH3OmniCampaignExportManifest = z.infer<
  typeof FastH3OmniCampaignExportManifestSchema
>;

export const FastH3OmniSlotBindingSchema = z.object({
  slotIndex: z.number().int().min(0),
  tag: z.string().regex(/^<Picture \d+>$/),
  assetId: z.string().uuid(),
  contentHashSha256: sha256HashSchema,
  semanticPurposes: z.array(FastH3OmniSemanticPurposeSchema).min(1),
  boundOrder: z.number().int().min(0)
});
export type FastH3OmniSlotBinding = z.infer<typeof FastH3OmniSlotBindingSchema>;

export const FastH3OmniBindingManifestSchema = z.object({
  schemaVersion: z.literal(1),
  bindingDigest: sha256HashSchema,
  campaignId: z.string().uuid(),
  sceneId: z.string().uuid(),
  specRevision: z.number().int().positive(),
  referenceSetId: z.string().uuid(),
  orderedBindings: z.array(FastH3OmniSlotBindingSchema).min(1),
  sourcePrompt: z.string().min(1),
  renderedPrompt: z.string().min(1),
  promptDigest: sha256HashSchema,
  keyframes: z
    .object({
      firstFrame: FastH3OmniReferenceInputSchema.nullable().optional(),
      lastFrame: FastH3OmniReferenceInputSchema.nullable().optional()
    })
    .optional(),
  audioReferences: z.array(FastH3OmniAudioReferenceInputSchema).optional()
});
export type FastH3OmniBindingManifest = z.infer<typeof FastH3OmniBindingManifestSchema>;

// ---------------------------------------------------------------------------
// Model & Runtime Identity Schemas
// ---------------------------------------------------------------------------

export const FastH3OmniModelIdentitySchema = z.object({
  modelFamily: z.literal("FastH3-Omni"),
  repository: z.string().min(1),
  revision: z.string().min(1),
  /** FastVideo export shards; null until every shard/index is audited with size + SHA-256. */
  diffusionShards: z
    .array(
      z.object({
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        sizeBytes: z.number().int().positive()
      })
    )
    .nullable(),
  diffusionShardIndexSha256: sha256HashSchema.nullable(),
  quantization: z.string().min(1).nullable(),
  /** Null revision means unpinned/unaudited and blocks offline_validated. */
  textEncoder: z.object({
    repository: z.string().min(1).nullable(),
    revision: z.string().min(1).nullable(),
    precision: z.string().min(1).nullable()
  }),
  visionTower: z.object({
    repository: z.string().min(1).nullable(),
    revision: z.string().min(1).nullable(),
    precision: z.string().min(1).nullable()
  }),
  videoVae: z.object({
    repository: z.string().min(1).nullable(),
    revision: z.string().min(1).nullable()
  }),
  audioVae: z.object({
    repository: z.string().min(1).nullable(),
    revision: z.string().min(1).nullable()
  }),
  scheduler: z.object({
    name: z.string().min(1),
    steps: z.literal(8),
    guidance: z.number(),
    videoShift: z.number(),
    audioShift: z.number()
  }),
  /** Derived table: needs its own hash plus the generation command identity. */
  adalnTable: z
    .object({
      filename: z.string().min(1),
      sha256: sha256HashSchema,
      generationCommandDigest: sha256HashSchema
    })
    .nullable(),
  /** Hash of the locked dependency set (lockfile or package artifact fingerprints). */
  dependencyLockSha256: sha256HashSchema.nullable()
});
export type FastH3OmniModelIdentity = z.infer<typeof FastH3OmniModelIdentitySchema>;

export const FastH3OmniRuntimeIdentitySchema = z.object({
  runtimeLane: FastH3OmniRuntimeLaneSchema,
  pythonVersion: z.string().min(1).nullable(),
  pytorchVersion: z.string().min(1).nullable(),
  cudaVersion: z.string().min(1).nullable(),
  computeCapability: z.string().min(1),
  attentionKernel: z.string().min(1).nullable(),
  layerwiseStreaming: z.boolean(),
  residentBlocks: z.number().int().positive().nullable().optional(),
  vsaEmulator: z.boolean().optional()
});
export type FastH3OmniRuntimeIdentity = z.infer<typeof FastH3OmniRuntimeIdentitySchema>;

// ---------------------------------------------------------------------------
// Preparation Spec & Execution Readiness Schemas
// ---------------------------------------------------------------------------

export const FastH3OmniReadinessStatusSchema = z.enum([
  "offline_validated",
  "blocked_unverified_runtime",
  "blocked_license_review",
  "blocked_pending_upstream_release",
  "blocked_unsupported_inputs"
]);
export type FastH3OmniReadinessStatus = z.infer<typeof FastH3OmniReadinessStatusSchema>;

export const FastH3OmniCommandSpecSchema = z.object({
  argv: z.array(z.string()).min(1),
  environment: z.record(z.string(), z.string()),
  configFilePath: z.string().min(1),
  commandDigest: sha256HashSchema
});
export type FastH3OmniCommandSpec = z.infer<typeof FastH3OmniCommandSpecSchema>;

/** Operator-supplied numeric limits. Null means not supplied, which denies execution. */
export const FastH3OmniTimeoutsSchema = z.object({
  startupTimeoutMs: z.number().int().positive().nullable(),
  renderTimeoutMs: z.number().int().positive().nullable(),
  probeTimeoutMs: z.number().int().positive().nullable(),
  shutdownTimeoutMs: z.number().int().positive().nullable(),
  maxVramMb: z.number().int().positive().nullable().default(null),
  maxHostRamMb: z.number().int().positive().nullable().default(null),
  maxSwapMb: z.number().int().min(0).nullable().default(null)
});
export type FastH3OmniTimeouts = z.infer<typeof FastH3OmniTimeoutsSchema>;

export const FastH3OmniUpstreamRecipeSchema = z.object({
  sourceUrl: z.string().url(),
  sourceCommit: z.string().min(1),
  /** SHA-256 of the unmodified upstream recipe file. */
  sourceSha256: sha256HashSchema,
  /** Verbatim copy of the upstream recipe (or the recorded derivation of it). */
  configText: z.string().min(1),
  derivation: z.string().min(1),
  argv: z.array(z.string()).min(1),
  environment: z.record(z.string(), z.string())
});
export type FastH3OmniUpstreamRecipe = z.infer<typeof FastH3OmniUpstreamRecipeSchema>;

export const FastH3OmniPreparationSpecSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  descriptorDigest: sha256HashSchema,
  readinessStatus: FastH3OmniReadinessStatusSchema,
  isExecutable: z.boolean(),
  executionBlockers: z.array(z.string()),
  auditSnapshot: FastH3OmniAuditSnapshotSchema,
  capability: FastH3OmniCapabilitySchema,
  modelIdentity: FastH3OmniModelIdentitySchema,
  runtimeIdentity: FastH3OmniRuntimeIdentitySchema,
  bindingManifest: FastH3OmniBindingManifestSchema,
  renderParams: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frames: z.number().int().positive(),
    fps: z.number().int().positive(),
    seed: z.number().int().min(0)
  }),
  upstreamRecipe: FastH3OmniUpstreamRecipeSchema.nullable().optional(),
  commandSpec: FastH3OmniCommandSpecSchema.nullable().optional(),
  timeouts: FastH3OmniTimeoutsSchema,
  privacyPolicy: z.object({
    allowRemoteAssetUpload: z.literal(false),
    containmentRoot: z.string().min(1)
  })
});
export type FastH3OmniPreparationSpec = z.infer<typeof FastH3OmniPreparationSpecSchema>;

// ---------------------------------------------------------------------------
// Blank Report & Evaluation Schemas (Governance Exit-Gate Compliant)
// ---------------------------------------------------------------------------

export const FastH3OmniDispositionSchema = z.enum(["PENDING", "GO", "CONDITIONAL", "NO-GO"]);
export type FastH3OmniDisposition = z.infer<typeof FastH3OmniDispositionSchema>;

export const FastH3OmniExecutionMetricsSchema = z.object({
  totalWallTimeMs: z.number().nullable(),
  coldStartMs: z.number().nullable(),
  warmLoadMs: z.number().nullable(),
  conditioningEncodeMs: z.number().nullable(),
  samplingWallTimeMs: z.number().nullable(),
  decodeMs: z.number().nullable(),
  peakVramMb: z.number().nullable(),
  peakHostRamMb: z.number().nullable(),
  peakSwapMb: z.number().nullable(),
  observedSteps: z.number().nullable(),
  observedKernels: z.array(z.string()).nullable(),
  oomEncountered: z.boolean().nullable()
});
export type FastH3OmniExecutionMetrics = z.infer<typeof FastH3OmniExecutionMetricsSchema>;

export const FastH3OmniOutputProbeSchema = z.object({
  fileSha256: sha256HashSchema.nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  frameCount: z.number().nullable(),
  fps: z.number().nullable(),
  durationSeconds: z.number().nullable(),
  hasVideoStream: z.boolean().nullable(),
  hasAudioStream: z.boolean().nullable(),
  audioSyncStatus: z.string().nullable()
});
export type FastH3OmniOutputProbe = z.infer<typeof FastH3OmniOutputProbeSchema>;

export const FastH3OmniAestheticEvaluationSchema = z.object({
  referenceFidelityScore: z.number().nullable(),
  faceHandsIntegrity: z.number().nullable(),
  wardrobeProductAdherence: z.number().nullable(),
  temporalCoherence: z.number().nullable(),
  cameraMotionStability: z.number().nullable(),
  audioVisualSync: z.number().nullable(),
  reviewerNotes: z.string().nullable()
});
export type FastH3OmniAestheticEvaluation = z.infer<typeof FastH3OmniAestheticEvaluationSchema>;

export const FastH3OmniReportSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  descriptorDigest: sha256HashSchema,
  reportGeneratedAt: z.string().datetime(),
  evaluationStatus: FastH3OmniDispositionSchema,
  speedSignOff: FastH3OmniDispositionSchema,
  aestheticSignOff: FastH3OmniDispositionSchema,
  licenseSignOff: FastH3OmniDispositionSchema,
  operatorIdentity: z.string().nullable(),
  operatorDisposition: FastH3OmniDispositionSchema,
  metrics: FastH3OmniExecutionMetricsSchema,
  probe: FastH3OmniOutputProbeSchema,
  aesthetic: FastH3OmniAestheticEvaluationSchema,
  blockers: z.array(z.string())
});
export type FastH3OmniReport = z.infer<typeof FastH3OmniReportSchema>;

// ---------------------------------------------------------------------------
// Digest Computing Functions
// ---------------------------------------------------------------------------

export function computeFastH3OmniDescriptorDigest(descriptor: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(descriptor)) {
    if (key !== "descriptorDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

export function computeFastH3OmniBindingDigest(manifest: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(manifest)) {
    if (key !== "bindingDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

export function computeFastH3OmniAuditDigest(snapshot: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(snapshot)) {
    if (key !== "auditDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

export function computeFastH3OmniCapabilityDigest(cap: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(cap)) {
    if (key !== "capabilityDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

export function computeFastH3OmniCommandDigest(cmd: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(cmd)) {
    if (key !== "commandDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

export function computeFastH3OmniCampaignExportDigest(manifest: Record<string, unknown>): string {
  const rest: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(manifest)) {
    if (key !== "exportDigest") {
      rest[key] = val;
    }
  }
  return sha256Hex(canonicalizeJson(rest));
}

// ---------------------------------------------------------------------------
// Baseline Factory Functions (Deterministic Templates)
// ---------------------------------------------------------------------------

export function createFastVideoSm89Capability(): FastH3OmniCapability {
  const base = {
    lane: "isolated_fastvideo_sm89" as const,
    route: "ref2va" as const,
    supportedFrames: [124, 243, 362],
    supportedFps: 24,
    supportedResolutions: [{ width: 832, height: 480 }],
    minReferenceImages: 1,
    maxReferenceImages: 9,
    supportsKeyframes: false,
    supportsAudio: false,
    supportsContinuation: false,
    requiredKernel: "sm89_fp8_stream",
    precision: "fp8_layerwise",
    layerStreamingBlocks: 16
  };
  return {
    ...base,
    capabilityDigest: computeFastH3OmniCapabilityDigest(base)
  };
}

/**
 * Identity of the FastVideo export as currently audited. The export shards, encoder revisions,
 * VAEs, AdaLN table and dependency lock have NOT been audited, so they are null and every
 * compile against this identity is blocked. The Comfy INT8 checkpoint is a different artifact
 * and is intentionally not substituted here.
 */
export function createDefaultFastH3OmniModelIdentity(): FastH3OmniModelIdentity {
  return {
    modelFamily: "FastH3-Omni",
    repository: FASTH3_OMNI_BF16_REPO,
    revision: FASTH3_OMNI_BF16_REVISION,
    diffusionShards: null,
    diffusionShardIndexSha256: null,
    quantization: null,
    textEncoder: { repository: null, revision: null, precision: null },
    visionTower: { repository: null, revision: null, precision: null },
    videoVae: { repository: null, revision: null },
    audioVae: { repository: null, revision: null },
    scheduler: {
      name: "unverified",
      steps: 8,
      guidance: 1.0,
      videoShift: 12.0,
      audioShift: 3.0
    },
    adalnTable: null,
    dependencyLockSha256: null
  };
}

export function createDefaultFastH3OmniRuntimeIdentity(): FastH3OmniRuntimeIdentity {
  return {
    runtimeLane: "isolated_fastvideo_sm89",
    pythonVersion: null,
    pytorchVersion: null,
    cudaVersion: null,
    computeCapability: "8.9",
    attentionKernel: null,
    layerwiseStreaming: true,
    residentBlocks: null,
    vsaEmulator: undefined
  };
}

/** Lists every identity component that is not audit-sourced. Empty means the identity is complete. */
export function listFastH3OmniIdentityGaps(
  model: FastH3OmniModelIdentity,
  runtime: FastH3OmniRuntimeIdentity
): string[] {
  const gaps: string[] = [];
  if (!model.diffusionShards || model.diffusionShards.length === 0) {
    gaps.push("FastVideo export transformer shards (filename, size, SHA-256) not audited");
  }
  if (!model.diffusionShardIndexSha256) gaps.push("FastVideo export shard index hash not audited");
  if (!model.quantization) gaps.push("FastVideo export quantization/format not audited");
  for (const [name, part] of [
    ["text encoder", model.textEncoder],
    ["vision tower", model.visionTower]
  ] as const) {
    if (!part.repository || !part.revision || !part.precision) {
      gaps.push(`${name} repository, immutable revision and precision not audited`);
    }
  }
  for (const [name, part] of [
    ["video VAE", model.videoVae],
    ["audio VAE", model.audioVae]
  ] as const) {
    if (!part.repository || !part.revision) {
      gaps.push(`${name} repository and immutable revision not audited`);
    }
  }
  if (!model.adalnTable) gaps.push("AdaLN table hash and generation command identity not audited");
  if (!model.dependencyLockSha256) gaps.push("Runtime dependency lock fingerprint not audited");
  if (!runtime.pythonVersion) gaps.push("Python version not audited");
  if (!runtime.pytorchVersion) gaps.push("PyTorch build not audited");
  if (!runtime.cudaVersion) gaps.push("CUDA version not audited");
  if (!runtime.attentionKernel) gaps.push("Attention kernel configuration not audited");
  if (!runtime.residentBlocks) gaps.push("Layer-streaming resident block count not audited");
  return gaps;
}

export function createBlankFastH3OmniReport(
  runId: string,
  descriptorDigest: string
): FastH3OmniReport {
  return {
    schemaVersion: 1,
    runId,
    descriptorDigest,
    reportGeneratedAt: new Date().toISOString(),
    evaluationStatus: "PENDING",
    speedSignOff: "PENDING",
    aestheticSignOff: "PENDING",
    licenseSignOff: "PENDING",
    operatorIdentity: null,
    operatorDisposition: "PENDING",
    metrics: {
      totalWallTimeMs: null,
      coldStartMs: null,
      warmLoadMs: null,
      conditioningEncodeMs: null,
      samplingWallTimeMs: null,
      decodeMs: null,
      peakVramMb: null,
      peakHostRamMb: null,
      peakSwapMb: null,
      observedSteps: null,
      observedKernels: null,
      oomEncountered: null
    },
    probe: {
      fileSha256: null,
      width: null,
      height: null,
      frameCount: null,
      fps: null,
      durationSeconds: null,
      hasVideoStream: null,
      hasAudioStream: null,
      audioSyncStatus: null
    },
    aesthetic: {
      referenceFidelityScore: null,
      faceHandsIntegrity: null,
      wardrobeProductAdherence: null,
      temporalCoherence: null,
      cameraMotionStability: null,
      audioVisualSync: null,
      reviewerNotes: null
    },
    blockers: [
      "Physical RTX 4090 execution not performed in offline Phase A",
      "Operator sign-off and visual review pending"
    ]
  };
}

export function createDefaultFastH3OmniAuditSnapshot(): FastH3OmniAuditSnapshot {
  const claims: FastH3OmniAuditClaim[] = [
    {
      claimId: "omni-bf16-card-release",
      claimText:
        "Official FastH3-Omni 8-Step V1 BF16 weights card published on Hugging Face with reference conditioning and 8 transformer evaluation steps.",
      status: "unverified",
      basis:
        "Observed during planning at the immutable revision; a copy of the README was not captured, so no evidence digest exists yet.",
      sourceUrl:
        "https://huggingface.co/FastVideo/FastVideo-FastH3-Omni-8-Step-V1/blob/53e0d26a1691aa473b6262d8196a8feb2c297df0/README.md",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: FASTH3_OMNI_BF16_REVISION,
      evidenceDigest: null,
      verificationMethod: "unverified"
    },
    {
      claimId: "omni-comfy-int8-release",
      claimText:
        "Official FastH3-Omni Comfy pruned INT8 checkpoint published with published LFS SHA-256 and size ~22.2GB.",
      status: "verified",
      basis:
        "diffusion_models/fasth3_omniref_8step_pruned_int8_convrot.safetensors declared in FastH3-Omni-Comfy repository.",
      sourceUrl:
        "https://huggingface.co/FastVideo/FastH3-Omni-Comfy/blob/82eff2a6eee6c962846879f4bab52610a4df24d3/README.md",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: FASTH3_OMNI_COMFY_REVISION,
      evidenceDigest: null,
      upstreamLfsSha256: FASTH3_OMNI_COMFY_INT8_CHECKPOINT.sha256,
      verificationMethod: "remote_metadata_lfs"
    },
    {
      claimId: "fastvideo-sm89-rtx4090-recipe",
      claimText:
        "FastVideo source repository contains basic_fasth3_omniref_rtx4090.yaml recipe configured for 832x480 124 frames with layerwise FP8 streaming (16 blocks) and BF16 VSA emulator.",
      status: "unverified",
      basis:
        "Observed at commit 7203b4976eefcd70a52728ca1281797ce96734eb during planning; the recipe file was not captured or hashed, so it cannot yet be copied into a compiled specification.",
      sourceUrl:
        "https://github.com/hao-ai-lab/FastVideo/blob/7203b4976eefcd70a52728ca1281797ce96734eb/examples/inference/basic/basic_fasth3_omniref_rtx4090.yaml",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: FASTH3_OMNI_FASTVIDEO_SOURCE_COMMIT,
      evidenceDigest: null,
      verificationMethod: "unverified"
    },
    {
      claimId: "reactor-hosted-api-discrete-durations",
      claimText:
        "Reactor hosted API advertises discrete durations 5.875, 8, 10.125, 12.25, 14.375s and up to 3/9 reference images; hosted only, private assets prohibited from upload.",
      status: "unverified",
      basis:
        "Stated in the issue snapshot of 2026-10-19 and the design; mutable hosted documentation, not captured as a dated copy.",
      sourceUrl: "https://docs.reactor.inc/model-api-reference/fast-h3-omni/schema",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: null,
      evidenceDigest: null,
      verificationMethod: "unverified"
    },
    {
      claimId: "base-minimax-community-license",
      claimText:
        "Base MiniMax-H3 community license excludes EU/UK/KR/US territories, imposes $20M revenue conditions, and restricts output redistribution; commercial approval is review_required.",
      status: "review_required",
      basis:
        "MiniMaxAI/MiniMax-H3 LICENSE file inspected at commit 42ed227ee7df40d41602854ae760620d6eb651fe.",
      sourceUrl:
        "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: FASTH3_OMNI_BASE_MINIMAX_REVISION,
      evidenceDigest: null,
      verificationMethod: "legal_audit"
    },
    {
      claimId: "nvfp4-blackwell-requirement",
      claimText:
        "Accelerated NVFP4 text encoding requires NVIDIA Blackwell hardware per the Comfy card and is not usable on RTX 4090 (SM89).",
      status: "unsupported",
      basis:
        "FastH3-Omni-Comfy README explicitly warns that NVFP4 text encoding requires Blackwell hardware.",
      sourceUrl:
        "https://huggingface.co/FastVideo/FastH3-Omni-Comfy/blob/82eff2a6eee6c962846879f4bab52610a4df24d3/README.md",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: FASTH3_OMNI_COMFY_REVISION,
      evidenceDigest: null,
      verificationMethod: "unverified"
    },
    ...[
      [
        "fastvideo-export-artifacts",
        "FastVideo FP8/dense export shards, shard index, runtime config, tokenizer/processor, encoder, VAEs and AdaLN table (names, sizes, SHA-256) are not enumerated."
      ],
      [
        "runtime-dependency-closure",
        "Python, PyTorch/CUDA build, driver, kernel and dependency lock for the SM89 lane are not resolved; the pinned ComfyUI environment is not evidence for them."
      ],
      [
        "fastvideo-launch-command",
        "The upstream launch command and recipe schema for the Ref2VA lane are not captured, so no argv or config is compiled."
      ]
    ].map(([claimId, claimText]) => ({
      claimId: claimId as string,
      claimText: claimText as string,
      status: "unverified" as const,
      basis: "Not audited. Recorded as unknown; unknown denies the corresponding operation.",
      sourceUrl:
        "https://github.com/hao-ai-lab/FastVideo/tree/7203b4976eefcd70a52728ca1281797ce96734eb",
      retrievedAt: "2026-10-29T10:00:00Z",
      revision: FASTH3_OMNI_FASTVIDEO_SOURCE_COMMIT,
      evidenceDigest: null,
      verificationMethod: "unverified" as const
    }))
  ];

  const rejectedCandidates = [
    {
      name: "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors",
      reason:
        "FastH3 V2 checkpoint is strictly frame-anchored I2V only; lacks multi-reference conditioning architecture."
    },
    {
      name: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      reason:
        "FL2VA checkpoint is I2V first/last frame only; cannot accept general reference conditioning."
    },
    {
      name: "experimental_omniref_pdd",
      reason:
        "Pre-release experimental PDD checkpoints lack official release lineage and stability guarantees."
    }
  ];

  const base = {
    schemaVersion: 1 as const,
    retrievedAt: "2026-10-29T10:00:00Z",
    upstreamReleaseStatus: "released" as const,
    claims,
    rejectedCandidates
  };

  return {
    ...base,
    auditDigest: computeFastH3OmniAuditDigest(base)
  };
}
