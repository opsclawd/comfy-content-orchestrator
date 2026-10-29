import { z } from "zod";
import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";
import { sha256HashSchema } from "./persistent-media.js";
import { MinimaxH3SourceEvidenceRefSchema } from "./minimax-h3-attention.js";

// ---------------------------------------------------------------------------
// Constants & Pinned Identities
// ---------------------------------------------------------------------------
export const TEACACHE_UPSTREAM_COMMIT = "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f";
export const TEACACHE_UPSTREAM_REPO = "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache";
export const TEACACHE_ADAPTER_VERSION = "0.1.0-cco-experimental";
export const TEACACHE_NODE_CLASS = "CCOMiniMaxH3TeaCacheNode";
export const TEACACHE_NODE_KEY = "CCOMiniMaxH3TeaCache";
export const TEACACHE_PATCH_NODE_ID = "401";

export const TEACACHE_SUPPORTED_THRESHOLDS = Object.freeze([0.05, 0.1, 0.15]);
export const TEACACHE_DEFAULT_THRESHOLD = 0.15;
export const TEACACHE_DEFAULT_START_STEP = 2;
export const TEACACHE_DEFAULT_END_STEP = -2;
export const TEACACHE_TOTAL_STEPS = 20;

export const TEACACHE_SOURCE_FILE_HASHES = Object.freeze({
  "nodes.py": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
  "teacache.py": "97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f",
  LICENSE: "ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67",
  "pyproject.toml": "e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be",
  "__init__.py": "8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416"
});

export const TEACACHE_LOCAL_ADAPTER_FILE_HASHES = Object.freeze({
  "__init__.py": "3b14b0a4da6f0fa366d8da492ea85ce74f2a63f18336ac63970d9d2bfe128c94",
  "nodes.py": "ea16ae7ced6ab1ddfe7ba729a0a0c7047827f1e5601c6fd5c8363b837dd17d2c",
  // Updated for issue #467 follow-up-review fixes: mandatory sigmas/timestep
  // validation, same-model session-ownership guard keyed to the owning
  // session_id (not a bare model_id set, which let a rejected session's
  // cleanup() evict a different, legitimately-active session's lock), and
  // a conditioning-manifest fingerprint that snapshots all of `c` --
  // including transformer_options EXCEPT its .sigmas field specifically
  // (standard ComfyUI per-step scheduler progress plumbing at the pinned
  // core revision, not conditioning identity), which is instead validated
  // against this session's own pinned sigma schedule rather than merely
  // ignored -- by immutable, decoupled value; verifies actual tensor
  // CONTENT via .equal() and otherwise ALWAYS fails closed; rejects
  // unsupported/unverifiable payload types outright (see teacache.py's
  // _snapshot_for_fingerprint/_fingerprints_equal); and passes uuid.UUID
  // values through as stable, value-equality-comparable leaves, since the
  // pinned core's comfy/sampler_helpers.py assigns one uuid.uuid4() per
  // conditioning entry once per sampling run (not regenerated per step)
  // and carries that same value into transformer_options.uuids on every
  // step -- a prior version had no UUID handling at all and rejected it
  // as an "unsupported conditioning value type" on the very first step.
  // Also snapshots comfy/ldm/minimax/model.py's PackedLayout (the packed-
  // AV minimax_payload.layout object on both canonical H3 routes)
  // by its signature/segments/seq_len plus its derived position tensors,
  // since it is a plain object (no .shape/.dtype, no __eq__) and
  // previously fell through to the same "unsupported type" rejection on
  // every real forward call.
  "teacache.py": "d2aec13bfacdcbeae7bebca828f7721aad9370d90605aea66016df7b3ffea9bb"
});

export const TEACACHE_LOCAL_ADAPTER_DIGEST = sha256Hex(
  canonicalizeJson(TEACACHE_LOCAL_ADAPTER_FILE_HASHES)
);

export function computeLocalTeaCacheAdapterDigest(fileHashes: Record<string, string>): string {
  return sha256Hex(canonicalizeJson(fileHashes));
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const MinimaxH3TeaCacheModeSchema = z.enum(["off", "raw-l1-v1"]);
export type MinimaxH3TeaCacheMode = z.infer<typeof MinimaxH3TeaCacheModeSchema>;

export const MinimaxH3TeaCachePatchNodeInputsSchema = z
  .object({
    model: z.tuple([z.string().min(1), z.number().int().nonnegative()]),
    rel_l1_thresh: z
      .number()
      .refine(
        (v) =>
          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
        {
          message: `rel_l1_thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
        }
      ),
    start_step: z.number().int().min(0),
    end_step: z.number().int(),
    total_steps: z.number().int().positive()
  })
  .strict();
export type MinimaxH3TeaCachePatchNodeInputs = z.infer<
  typeof MinimaxH3TeaCachePatchNodeInputsSchema
>;

export const MinimaxH3TeaCachePatchNodeSchema = z
  .object({
    nodeId: z.string().min(1),
    classType: z.literal(TEACACHE_NODE_KEY),
    inputs: MinimaxH3TeaCachePatchNodeInputsSchema
  })
  .strict();
export type MinimaxH3TeaCachePatchNode = z.infer<typeof MinimaxH3TeaCachePatchNodeSchema>;

export const MinimaxH3TeaCacheConfigSchema = z
  .object({
    mode: MinimaxH3TeaCacheModeSchema,
    relL1Thresh: z
      .number()
      .refine(
        (v) =>
          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
        {
          message: `relL1Thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
        }
      ),
    startStep: z.number().int().min(0),
    endStep: z.number().int(),
    totalSteps: z.literal(20),
    normalizedStartStep: z.number().int().min(2),
    normalizedEndStep: z.number().int().max(18)
  })
  .strict();
export type MinimaxH3TeaCacheConfig = z.infer<typeof MinimaxH3TeaCacheConfigSchema>;

export const MinimaxH3TeaCacheRequestSchema = z
  .object({
    mode: MinimaxH3TeaCacheModeSchema,
    relL1Thresh: z
      .number()
      .refine(
        (v) =>
          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
        {
          message: `relL1Thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
        }
      ),
    startStep: z.number().int().min(0),
    endStep: z.number().int(),
    totalSteps: z.literal(20),
    normalizedStartStep: z.number().int().min(2),
    normalizedEndStep: z.number().int().max(18),
    upstreamCommit: z.string().min(1),
    adapterVersion: z.string().min(1),
    adapterDigest: sha256HashSchema,
    catalogDigest: sha256HashSchema,
    topologyDigest: sha256HashSchema,
    patchNode: MinimaxH3TeaCachePatchNodeSchema.nullable()
  })
  .strict();
export type MinimaxH3TeaCacheRequest = z.infer<typeof MinimaxH3TeaCacheRequestSchema>;

export const MinimaxH3TeaCacheObservationCoverageSchema = z
  .object({
    samplingCallsRecorded: z.number().int().nonnegative(),
    modelForwardsRecorded: z.number().int().nonnegative().nullable(),
    complete: z.boolean()
  })
  .strict();
export type MinimaxH3TeaCacheObservationCoverage = z.infer<
  typeof MinimaxH3TeaCacheObservationCoverageSchema
>;

export const MinimaxH3TeaCacheObservationTimingsSchema = z
  .object({
    samplingWallMs: z.number().nonnegative().nullable(),
    modelForwardElapsedMs: z.number().nonnegative().nullable(),
    decisionOverheadMs: z.number().nonnegative().nullable(),
    timingUnavailableReason: z.string().min(1).nullable().optional()
  })
  .strict();
export type MinimaxH3TeaCacheObservationTimings = z.infer<
  typeof MinimaxH3TeaCacheObservationTimingsSchema
>;

export const MinimaxH3TeaCacheObservationSchema = z
  .object({
    status: z.enum(["verified", "no_op", "failed", "unknown"]),
    mode: MinimaxH3TeaCacheModeSchema,
    requestedConfig: MinimaxH3TeaCacheConfigSchema.nullable(),
    effectiveConfig: MinimaxH3TeaCacheConfigSchema.nullable(),
    totalSteps: z.number().int().nonnegative(),
    forwardCallsRecorded: z.number().int().nonnegative().nullable(),
    cacheHitsRecorded: z.number().int().nonnegative().nullable(),
    unattributedCallsRecorded: z.number().int().nonnegative().optional(),
    nestedForwardsOnHits: z.number().int().nonnegative().nullable().optional(),
    coverage: MinimaxH3TeaCacheObservationCoverageSchema,
    timings: MinimaxH3TeaCacheObservationTimingsSchema,
    failureReason: z.string().min(1).nullable().optional(),
    sessionId: z.string().min(1).nullable().optional(),
    sessionAttempts: z.number().int().nonnegative().optional()
  })
  .strict();
export type MinimaxH3TeaCacheObservation = z.infer<typeof MinimaxH3TeaCacheObservationSchema>;

export const FactorChangeCachingConfigSummarySchema = z
  .object({
    mode: MinimaxH3TeaCacheModeSchema,
    relL1Thresh: z.number().nullable().optional(),
    startStep: z.number().int().nullable().optional(),
    endStep: z.number().int().nullable().optional(),
    totalSteps: z.number().int().nullable().optional(),
    topologyDigest: sha256HashSchema.nullable().optional(),
    adapterVersion: z.string().nullable().optional()
  })
  .strict();
export type FactorChangeCachingConfigSummary = z.infer<
  typeof FactorChangeCachingConfigSummarySchema
>;

export const MinimaxH3TeaCacheVariantNameSchema = z.enum([
  "teacache-raw-l1",
  "matched-control",
  "off"
]);
export type MinimaxH3TeaCacheVariantName = z.infer<typeof MinimaxH3TeaCacheVariantNameSchema>;

export const MinimaxH3TeaCacheCatalogEntrySchema = z
  .object({
    variantName: MinimaxH3TeaCacheVariantNameSchema,
    route: z.enum(["i2v", "ref2v"]),
    compatibilityState: z.enum(["supported", "unverified", "unsupported"]),
    scope: z.string().min(1),
    comfyuiCoreRevision: z.string().min(1),
    customNode: z
      .object({
        name: z.string().min(1),
        repository: z.string().min(1),
        revision: z.string().min(1),
        entrypoint: z.string().optional()
      })
      .strict(),
    runnable: z.boolean(),
    supportedThresholds: z.array(z.number()),
    defaultThreshold: z.number(),
    stepWindow: z
      .object({
        minStartStep: z.number().int(),
        maxEndStep: z.number().int(),
        defaultStartStep: z.number().int(),
        defaultEndStep: z.number().int(),
        requiredTotalSteps: z.literal(20)
      })
      .strict(),
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
    checkpointCompatibility: z
      .object({
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        taskMode: z.string().min(1)
      })
      .strict(),
    licensing: z
      .object({
        status: z.enum(["approved", "restricted", "review_required", "unverified"]),
        licenseSourceRef: z.string().min(1),
        securityReviewStatus: z.enum(["passed", "pending", "flagged"])
      })
      .strict(),
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
  .strict();
export type MinimaxH3TeaCacheCatalogEntry = z.infer<typeof MinimaxH3TeaCacheCatalogEntrySchema>;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------
export function normalizeTeaCacheWindow(params: {
  startStep: number;
  endStep: number;
  totalSteps: number;
}): {
  startStep: number;
  endStep: number;
  totalSteps: 20;
  normalizedStartStep: number;
  normalizedEndStep: number;
} {
  const { startStep, endStep, totalSteps } = params;
  if (totalSteps !== TEACACHE_TOTAL_STEPS) {
    throw new Error(
      `TeaCache currently requires total_steps to be exactly ${TEACACHE_TOTAL_STEPS}, got ${totalSteps}.`
    );
  }

  if (!Number.isInteger(startStep) || !Number.isInteger(endStep)) {
    throw new Error(
      `TeaCache step window boundaries must be integers, got start=${startStep}, end=${endStep}.`
    );
  }

  const effectiveEnd = endStep < 0 ? totalSteps + endStep : endStep;

  if (startStep < 2) {
    throw new Error(
      `TeaCache startStep must be >= 2 to preserve early denoising steps, got ${startStep}.`
    );
  }

  if (effectiveEnd > 18) {
    throw new Error(
      `TeaCache effective endStep must be <= 18 to preserve final denoising steps, got ${effectiveEnd} (from end_step ${endStep}).`
    );
  }

  if (startStep >= effectiveEnd) {
    throw new Error(
      `TeaCache window [start_step, effective_end) is empty or inverted: [${startStep}, ${effectiveEnd}).`
    );
  }

  return {
    startStep,
    endStep,
    totalSteps: 20,
    normalizedStartStep: startStep,
    normalizedEndStep: effectiveEnd
  };
}

export function validateTeaCacheParameters(params: {
  relL1Thresh: number;
  startStep: number;
  endStep: number;
  totalSteps: number;
}): {
  relL1Thresh: number;
  startStep: number;
  endStep: number;
  totalSteps: 20;
  normalizedStartStep: number;
  normalizedEndStep: number;
} {
  const { relL1Thresh } = params;
  if (typeof relL1Thresh !== "number" || !Number.isFinite(relL1Thresh)) {
    throw new Error(`TeaCache rel_l1_thresh must be a finite number, got ${relL1Thresh}.`);
  }

  if (!(TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(relL1Thresh)) {
    throw new Error(
      `TeaCache rel_l1_thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}], got ${relL1Thresh}.`
    );
  }

  const window = normalizeTeaCacheWindow({
    startStep: params.startStep,
    endStep: params.endStep,
    totalSteps: params.totalSteps
  });

  return {
    relL1Thresh,
    ...window
  };
}

export function computeTeaCacheTopologyDigest(
  patch: MinimaxH3TeaCachePatchNode | null | undefined
): string {
  if (!patch) {
    return sha256Hex(canonicalizeJson(null));
  }
  return sha256Hex(canonicalizeJson(patch));
}

export function computeTeaCacheConfigDigest(params: {
  workflowDigest: string;
  argv: readonly string[];
  teacacheConfig: MinimaxH3TeaCacheConfig | null | undefined;
}): string {
  return sha256Hex(
    canonicalizeJson({
      workflowDigest: params.workflowDigest,
      argv: params.argv,
      teacacheConfig: params.teacacheConfig ?? null
    })
  );
}

export function computeTeaCacheCatalogDigest(
  entry: Omit<MinimaxH3TeaCacheCatalogEntry, "catalogDigest"> | MinimaxH3TeaCacheCatalogEntry
): string {
  const copy = { ...entry } as Record<string, unknown>;
  delete copy.catalogDigest;
  return sha256Hex(canonicalizeJson(copy));
}

export function createEmptyTeaCacheObservation(
  request?: MinimaxH3TeaCacheRequest | null
): MinimaxH3TeaCacheObservation {
  const mode = request?.mode ?? "off";
  const requestedConfig: MinimaxH3TeaCacheConfig | null =
    request && request.mode !== "off"
      ? {
          mode: request.mode,
          relL1Thresh: request.relL1Thresh,
          startStep: request.startStep,
          endStep: request.endStep,
          totalSteps: 20,
          normalizedStartStep: request.normalizedStartStep,
          normalizedEndStep: request.normalizedEndStep
        }
      : null;

  return {
    status: "unknown",
    mode,
    requestedConfig,
    effectiveConfig: null,
    totalSteps: request?.totalSteps ?? 20,
    forwardCallsRecorded: null,
    cacheHitsRecorded: null,
    nestedForwardsOnHits: null,
    coverage: {
      samplingCallsRecorded: 0,
      modelForwardsRecorded: null,
      complete: false
    },
    timings: {
      samplingWallMs: null,
      modelForwardElapsedMs: null,
      decisionOverheadMs: null,
      timingUnavailableReason: "Prior to execution"
    },
    failureReason: null
  };
}
