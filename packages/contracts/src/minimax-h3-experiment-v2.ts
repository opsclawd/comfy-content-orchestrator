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
  PINNED_COMFYUI_CORE_REVISION,
  PINNED_COMFYUI_SOURCE_HASHES,
  FASTH3_ISOLATED_CORE_REVISION,
  type MinimaxH3ExperimentDescriptor,
  type MinimaxH3ExperimentResult
} from "./minimax-h3-experiment.js";
import { sha256HashSchema } from "./persistent-media.js";
import {
  MinimaxH3CompatibilityStateSchema,
  MinimaxH3SourceEvidenceRefSchema,
  MinimaxH3AttentionRequestSchema,
  MinimaxH3AttentionObservationSchema,
  MinimaxH3AttentionEventMetadataSchema,
  MinimaxH3AttentionTopologySchema,
  computeAttentionTopologyDigest,
  type MinimaxH3AttentionPatchNode,
  type MinimaxH3AttentionTopology,
  type MinimaxH3AttentionCatalogEntry,
  type MinimaxH3AttentionObservation
} from "./minimax-h3-attention.js";

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

export const PINNED_H3_LORAS = Object.freeze({
  fl2vaTurbo8: {
    filename: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    sha256: "2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e",
    sizeBytes: 1956193000
  },
  ref2vaTurbo4: {
    filename: "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
    sha256: "5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c",
    sizeBytes: 1956193000
  }
});

export const PINNED_FASTH3_CHECKPOINT = Object.freeze({
  filename: "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors",
  sha256: "0922785978dc9bfe1adf27d8b291b0ca763f9f165f882e6cb297c72fbb6deda8",
  sizeBytes: 22128378696
});

// ---------------------------------------------------------------------------
// Step Reduction & Distillation Sampling Recipes
// ---------------------------------------------------------------------------
export const MINIMAX_H3_SAMPLING_RECIPE_NAMES = [
  "canonical-base-20",
  "fl2va-base-20",
  "fl2va-turbo-8",
  "ref2va-turbo-4",
  "fasth3-i2v-8"
] as const;

export const MinimaxH3SamplingRecipeNameSchema = z.enum(MINIMAX_H3_SAMPLING_RECIPE_NAMES);
export type MinimaxH3SamplingRecipeName = z.infer<typeof MinimaxH3SamplingRecipeNameSchema>;

export const MinimaxH3SamplingRecipeSchema = z
  .object({
    name: MinimaxH3SamplingRecipeNameSchema,
    recipeVersion: z.literal(1),
    recipeDigest: sha256HashSchema,
    taskFamily: z.enum(["i2v", "ref2v", "t2v"]),
    compatibleRoute: z.enum(["i2v", "ref2v"]),
    diffusionModel: z
      .object({
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        sizeBytes: z.number().int().positive(),
        quantization: z.string().min(1),
        repository: z.string().min(1),
        revision: z.string().min(1)
      })
      .strict(),
    lora: z
      .object({
        filename: z.string().min(1),
        sha256: sha256HashSchema,
        sizeBytes: z.number().int().positive(),
        strengthModel: z.number(),
        repository: z.string().min(1),
        revision: z.string().min(1)
      })
      .strict()
      .nullable()
      .optional(),
    expectedSteps: z.number().int().positive(),
    sampler: z.string().min(1),
    scheduler: z.string().min(1),
    denoise: z.number().min(0).max(1),
    sigmaShift: z
      .object({
        enabled: z.boolean(),
        videoShift: z.number(),
        audioShift: z.number()
      })
      .strict()
      .nullable()
      .optional(),
    conditioningMode: z.enum(["frame_anchored", "reference_directed"]),
    attentionTopology: MinimaxH3AttentionTopologySchema.optional(),
    requiredRuntimeRevision: z.string().min(1),
    licensing: z
      .object({
        status: z.enum(["approved", "restricted", "review_required", "unverified"]),
        licenseSourceRef: z.string().min(1),
        notes: z.string().optional()
      })
      .strict(),
    sourceReferences: z.array(MinimaxH3SourceEvidenceRefSchema)
  })
  .strict()
  .superRefine((val, ctx) => {
    let canonicalRecipe: MinimaxH3SamplingRecipe;
    try {
      validateRecipeRouteCompatibility(val.name, val.compatibleRoute);
      canonicalRecipe = getSamplingRecipe(val.name, val.compatibleRoute);
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: (err as Error).message,
        path: []
      });
      return;
    }

    const recomputedDigest = computeSamplingRecipeDigest(val);
    if (val.recipeDigest !== recomputedDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe recipeDigest mismatch: expected ${recomputedDigest}, got ${val.recipeDigest}`,
        path: ["recipeDigest"]
      });
    }
    if (val.recipeDigest !== canonicalRecipe.recipeDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe recipeDigest mismatch with authoritative catalog for "${val.name}": expected ${canonicalRecipe.recipeDigest}, got ${val.recipeDigest}`,
        path: ["recipeDigest"]
      });
    }
    if (val.recipeVersion !== canonicalRecipe.recipeVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe recipeVersion mismatch for "${val.name}": expected ${canonicalRecipe.recipeVersion}, got ${val.recipeVersion}`,
        path: ["recipeVersion"]
      });
    }
    if (val.taskFamily !== canonicalRecipe.taskFamily) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe taskFamily mismatch for "${val.name}": expected ${canonicalRecipe.taskFamily}, got ${val.taskFamily}`,
        path: ["taskFamily"]
      });
    }
    if (val.compatibleRoute !== canonicalRecipe.compatibleRoute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sampling recipe "${val.name}" is incompatible with route "${val.compatibleRoute}"`,
        path: ["compatibleRoute"]
      });
    }
    if (
      val.diffusionModel.filename !== canonicalRecipe.diffusionModel.filename ||
      val.diffusionModel.sha256 !== canonicalRecipe.diffusionModel.sha256 ||
      val.diffusionModel.sizeBytes !== canonicalRecipe.diffusionModel.sizeBytes ||
      val.diffusionModel.quantization !== canonicalRecipe.diffusionModel.quantization ||
      val.diffusionModel.repository !== canonicalRecipe.diffusionModel.repository ||
      val.diffusionModel.revision !== canonicalRecipe.diffusionModel.revision
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe diffusionModel mismatch for "${val.name}"`,
        path: ["diffusionModel"]
      });
    }
    if (canonicalRecipe.lora) {
      if (
        !val.lora ||
        val.lora.filename !== canonicalRecipe.lora.filename ||
        val.lora.sha256 !== canonicalRecipe.lora.sha256 ||
        val.lora.sizeBytes !== canonicalRecipe.lora.sizeBytes ||
        val.lora.strengthModel !== canonicalRecipe.lora.strengthModel ||
        val.lora.repository !== canonicalRecipe.lora.repository ||
        val.lora.revision !== canonicalRecipe.lora.revision
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe lora mismatch for "${val.name}"`,
          path: ["lora"]
        });
      }
    } else if (val.lora) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe lora must be null for "${val.name}"`,
        path: ["lora"]
      });
    }
    if (val.expectedSteps !== canonicalRecipe.expectedSteps) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe expectedSteps mismatch for "${val.name}": expected ${canonicalRecipe.expectedSteps}, got ${val.expectedSteps}`,
        path: ["expectedSteps"]
      });
    }
    if (
      val.sampler !== canonicalRecipe.sampler ||
      val.scheduler !== canonicalRecipe.scheduler ||
      val.denoise !== canonicalRecipe.denoise
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe sampler/scheduler/denoise mismatch for "${val.name}"`,
        path: ["sampler"]
      });
    }
    if (canonicalRecipe.sigmaShift) {
      if (
        !val.sigmaShift ||
        val.sigmaShift.enabled !== canonicalRecipe.sigmaShift.enabled ||
        val.sigmaShift.videoShift !== canonicalRecipe.sigmaShift.videoShift ||
        val.sigmaShift.audioShift !== canonicalRecipe.sigmaShift.audioShift
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe sigmaShift mismatch for "${val.name}"`,
          path: ["sigmaShift"]
        });
      }
    } else if (val.sigmaShift) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe sigmaShift must be null or omitted for "${val.name}"`,
        path: ["sigmaShift"]
      });
    }
    if (val.conditioningMode !== canonicalRecipe.conditioningMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe conditioningMode mismatch for "${val.name}": expected ${canonicalRecipe.conditioningMode}, got ${val.conditioningMode}`,
        path: ["conditioningMode"]
      });
    }
    if (val.requiredRuntimeRevision !== canonicalRecipe.requiredRuntimeRevision) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe requiredRuntimeRevision mismatch for "${val.name}": expected ${canonicalRecipe.requiredRuntimeRevision}, got ${val.requiredRuntimeRevision}`,
        path: ["requiredRuntimeRevision"]
      });
    }
    if (
      val.licensing.status !== canonicalRecipe.licensing.status ||
      val.licensing.licenseSourceRef !== canonicalRecipe.licensing.licenseSourceRef
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe licensing mismatch for "${val.name}"`,
        path: ["licensing"]
      });
    }
    if (canonicalRecipe.attentionTopology) {
      if (
        !val.attentionTopology ||
        val.attentionTopology.backend !== canonicalRecipe.attentionTopology.backend ||
        val.attentionTopology.patchCount !== canonicalRecipe.attentionTopology.patchCount ||
        val.attentionTopology.topologyDigest !== canonicalRecipe.attentionTopology.topologyDigest
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe attentionTopology mismatch for "${val.name}"`,
          path: ["attentionTopology"]
        });
      }
    } else if (val.attentionTopology) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `samplingRecipe attentionTopology must be null or omitted for "${val.name}"`,
        path: ["attentionTopology"]
      });
    }
  });
export type MinimaxH3SamplingRecipe = z.infer<typeof MinimaxH3SamplingRecipeSchema>;

export function computeSamplingRecipeDigest(
  recipe: Omit<MinimaxH3SamplingRecipe, "recipeDigest"> | MinimaxH3SamplingRecipe
): string {
  const rest = { ...(recipe as Record<string, unknown>) };
  delete rest.recipeDigest;
  return sha256Hex(canonicalizeJson(rest));
}

export { FASTH3_ISOLATED_CORE_REVISION };

export const FASTH3_COMFYUI_SOURCE_HASHES = Object.freeze({
  "comfy/model_management.py": "ef3f3af0657c1b022ad69b25928fa52dd429db9aed9cb688e89c7fbe68ab50cd",
  "main.py": "8fc2cafc8e19e6e4b9134a2f6eba70b0e93d9d341dde01a40534dca89ca11727",
  "comfy/cli_args.py": "13cafedf0b724c3b04918a18a06507b86287fb66af8147d49b343d67c5c85c0a",
  "comfy_extras/nodes_sparse_attention.py":
    "f205faa57e3d348ead3f60e59caed24c31ebf2976d8d50e9eaaa2e55b36ef067",
  "comfy_extras/nodes_minimax_h3.py":
    "62ec72d4f3b879640dbd41b959a6c1112a82b77478509323094f49dae17fffdb",
  "comfy_extras/nodes_model_advanced.py":
    "59bcf2c72de0f931383b74c9be5b6fc2ced06a315277d34631ae5ac9ac90fa91"
});

export const PINNED_COMFYUI_NODES_PY_SHA256 =
  "38f918673c5300bc2d355e02f1131a7b1f97548337e7623754dafaea412008e8";

export const PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256 =
  "62ec72d4f3b879640dbd41b959a6c1112a82b77478509323094f49dae17fffdb";

export function buildFastH3AttentionTopology(): MinimaxH3AttentionTopology {
  const patches: MinimaxH3AttentionPatchNode[] = [
    {
      nodeId: "302",
      classType: "ModelAttentionBackend",
      inputs: {
        attention: "comfy kitchen attention"
      }
    },
    {
      nodeId: "303",
      classType: "BlockSparseAttention",
      inputs: {
        selection: "vsa",
        "selection.keep_percent": 10,
        start_percent: 0.2,
        end_percent: 1.0,
        dense_blocks: "",
        min_tokens: 12288,
        extra_tokens: 256,
        sink_conditioning: "exact_kv_and_rows",
        verbose: false
      }
    }
  ];

  return {
    backend: "comfy kitchen attention",
    patchCount: patches.length,
    patches,
    topologyDigest: computeAttentionTopologyDigest(patches)
  };
}

function createRecipe(
  recipeData: Omit<MinimaxH3SamplingRecipe, "recipeDigest">
): MinimaxH3SamplingRecipe {
  return {
    ...recipeData,
    recipeDigest: computeSamplingRecipeDigest(recipeData)
  };
}

function createCanonicalBase20(route: "i2v" | "ref2v" = "ref2v"): MinimaxH3SamplingRecipe {
  return createRecipe({
    name: "canonical-base-20",
    recipeVersion: 1,
    taskFamily: route,
    compatibleRoute: route,
    diffusionModel: {
      filename: PINNED_H3_CHECKPOINTS.ref2va.filename,
      sha256: PINNED_H3_CHECKPOINTS.ref2va.sha256,
      sizeBytes: 20970379616,
      quantization: "int8_convrot",
      repository: "Comfy-Org/MiniMax-H3",
      revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1"
    },
    lora: null,
    expectedSteps: 20,
    sampler: "res_multistep",
    scheduler: "simple",
    denoise: 1.0,
    sigmaShift: null,
    conditioningMode: route === "i2v" ? "frame_anchored" : "reference_directed",
    requiredRuntimeRevision: PINNED_COMFYUI_CORE_REVISION,
    licensing: {
      status: "approved",
      licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3/blob/main/LICENSE",
      notes: "Canonical baseline checkpoint"
    },
    sourceReferences: [
      {
        url: "https://github.com/Comfy-Org/docs/blob/71f2c354cc6ea0ad43ca17989f5797ae0863ddc7/tutorials/video/minimax/minimax-h3.mdx",
        assertion: "Official MiniMax-H3 tutorial baseline sampling configuration"
      }
    ]
  });
}

const FL2VA_BASE_20_RECIPE = createRecipe({
  name: "fl2va-base-20",
  recipeVersion: 1,
  taskFamily: "i2v",
  compatibleRoute: "i2v",
  diffusionModel: {
    filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
    sha256: PINNED_H3_CHECKPOINTS.fl2va.sha256,
    sizeBytes: 20970379616,
    quantization: "int8_convrot",
    repository: "Comfy-Org/MiniMax-H3",
    revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1"
  },
  lora: null,
  expectedSteps: 20,
  sampler: "res_multistep",
  scheduler: "simple",
  denoise: 1.0,
  sigmaShift: null,
  conditioningMode: "frame_anchored",
  requiredRuntimeRevision: PINNED_COMFYUI_CORE_REVISION,
  licensing: {
    status: "approved",
    licenseSourceRef: "https://huggingface.co/Comfy-Org/MiniMax-H3/blob/main/LICENSE",
    notes: "Official FL2VA I2V baseline checkpoint"
  },
  sourceReferences: [
    {
      url: "https://github.com/Comfy-Org/workflow_templates/blob/3e89967349dd95fa68ce3b36966f41d642af8ea7/templates/video_minimax_h3_i2v.json",
      assertion: "Official FL2VA I2V workflow template"
    }
  ]
});

const FL2VA_TURBO_8_RECIPE = createRecipe({
  name: "fl2va-turbo-8",
  recipeVersion: 1,
  taskFamily: "i2v",
  compatibleRoute: "i2v",
  diffusionModel: {
    filename: PINNED_H3_CHECKPOINTS.fl2va.filename,
    sha256: PINNED_H3_CHECKPOINTS.fl2va.sha256,
    sizeBytes: 20970379616,
    quantization: "int8_convrot",
    repository: "Comfy-Org/MiniMax-H3",
    revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1"
  },
  lora: {
    filename: PINNED_H3_LORAS.fl2vaTurbo8.filename,
    sha256: PINNED_H3_LORAS.fl2vaTurbo8.sha256,
    sizeBytes: PINNED_H3_LORAS.fl2vaTurbo8.sizeBytes,
    strengthModel: 1.0,
    repository: "lightx2v/Minimax-h3-Turbo",
    revision: "3ec17a324ced54151364f24f8b5fb6bf7e26414f"
  },
  expectedSteps: 8,
  sampler: "res_multistep",
  scheduler: "simple",
  denoise: 1.0,
  sigmaShift: null,
  conditioningMode: "frame_anchored",
  requiredRuntimeRevision: PINNED_COMFYUI_CORE_REVISION,
  licensing: {
    status: "review_required",
    licenseSourceRef: "https://huggingface.co/lightx2v/Minimax-h3-Turbo",
    notes: "FL2VA 8-step Turbo LoRA by LightX2V"
  },
  sourceReferences: [
    {
      url: "https://github.com/Comfy-Org/docs/blob/71f2c354cc6ea0ad43ca17989f5797ae0863ddc7/tutorials/video/minimax/minimax-h3.mdx",
      assertion: "Official documentation for FL2VA 8-step Turbo LoRA"
    }
  ]
});

const REF2VA_TURBO_4_RECIPE = createRecipe({
  name: "ref2va-turbo-4",
  recipeVersion: 1,
  taskFamily: "ref2v",
  compatibleRoute: "ref2v",
  diffusionModel: {
    filename: PINNED_H3_CHECKPOINTS.ref2va.filename,
    sha256: PINNED_H3_CHECKPOINTS.ref2va.sha256,
    sizeBytes: 20970379616,
    quantization: "int8_convrot",
    repository: "Comfy-Org/MiniMax-H3",
    revision: "7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1"
  },
  lora: {
    filename: PINNED_H3_LORAS.ref2vaTurbo4.filename,
    sha256: PINNED_H3_LORAS.ref2vaTurbo4.sha256,
    sizeBytes: PINNED_H3_LORAS.ref2vaTurbo4.sizeBytes,
    strengthModel: 1.0,
    repository: "lightx2v/Minimax-h3-Turbo",
    revision: "3ec17a324ced54151364f24f8b5fb6bf7e26414f"
  },
  expectedSteps: 4,
  sampler: "res_multistep",
  scheduler: "simple",
  denoise: 1.0,
  sigmaShift: null,
  conditioningMode: "reference_directed",
  requiredRuntimeRevision: PINNED_COMFYUI_CORE_REVISION,
  licensing: {
    status: "review_required",
    licenseSourceRef: "https://huggingface.co/lightx2v/Minimax-h3-Turbo",
    notes: "Ref2VA 4-step Turbo LoRA by LightX2V"
  },
  sourceReferences: [
    {
      url: "https://github.com/Comfy-Org/docs/blob/71f2c354cc6ea0ad43ca17989f5797ae0863ddc7/tutorials/video/minimax/minimax-h3.mdx",
      assertion: "Official documentation for Ref2VA 4-step Turbo LoRA"
    }
  ]
});

const FASTH3_I2V_8_RECIPE = createRecipe({
  name: "fasth3-i2v-8",
  recipeVersion: 1,
  taskFamily: "i2v",
  compatibleRoute: "i2v",
  diffusionModel: {
    filename: PINNED_FASTH3_CHECKPOINT.filename,
    sha256: PINNED_FASTH3_CHECKPOINT.sha256,
    sizeBytes: PINNED_FASTH3_CHECKPOINT.sizeBytes,
    quantization: "int8_convrot",
    repository: "FastVideo/FastVideo-FastH3-Comfy",
    revision: "ec1e3aa374a91c57b0b94a1623b7e657c0498cf2"
  },
  lora: null,
  expectedSteps: 8,
  sampler: "res_multistep",
  scheduler: "simple",
  denoise: 1.0,
  sigmaShift: {
    enabled: true,
    videoShift: 10.0,
    audioShift: 3.0
  },
  conditioningMode: "frame_anchored",
  attentionTopology: buildFastH3AttentionTopology(),
  requiredRuntimeRevision: FASTH3_ISOLATED_CORE_REVISION,
  licensing: {
    status: "restricted",
    licenseSourceRef: "https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy",
    notes: "FastVideo FastH3 distilled checkpoint. Restricted to I2V / frame-anchored."
  },
  sourceReferences: [
    {
      url: "https://github.com/Comfy-Org/docs/blob/71f2c354cc6ea0ad43ca17989f5797ae0863ddc7/tutorials/video/minimax/minimax-h3-fastvideo.mdx",
      assertion: "FastH3 ComfyUI tutorial"
    },
    {
      url: "https://github.com/Comfy-Org/workflow_templates/blob/3e89967349dd95fa68ce3b36966f41d642af8ea7/templates/video_fastvideo_fasth3_i2v.json",
      assertion: "Official FastH3 I2V workflow template"
    }
  ]
});

export function validateRecipeRouteCompatibility(
  recipeName: MinimaxH3SamplingRecipeName,
  route: "i2v" | "ref2v"
): void {
  if (recipeName === "fasth3-i2v-8" && route !== "i2v") {
    throw new Error(
      "FastH3 8-step is strictly restricted to I2V / frame-anchored route; Ref2V is rejected"
    );
  }
  if (recipeName === "ref2va-turbo-4" && route !== "ref2v") {
    throw new Error("Ref2VA Turbo 4-step LoRA is strictly restricted to Ref2V route");
  }
  if (recipeName === "fl2va-turbo-8" && route !== "i2v") {
    throw new Error("FL2VA Turbo 8-step LoRA is strictly restricted to I2V route");
  }
  if (recipeName === "fl2va-base-20" && route !== "i2v") {
    throw new Error("FL2VA Base 20-step recipe is strictly restricted to I2V route");
  }
}

export function getSamplingRecipe(
  name: MinimaxH3SamplingRecipeName,
  route?: "i2v" | "ref2v"
): MinimaxH3SamplingRecipe {
  if (route) {
    validateRecipeRouteCompatibility(name, route);
  }

  switch (name) {
    case "canonical-base-20":
      return createCanonicalBase20(route ?? "ref2v");
    case "fl2va-base-20":
      return FL2VA_BASE_20_RECIPE;
    case "fl2va-turbo-8":
      return FL2VA_TURBO_8_RECIPE;
    case "ref2va-turbo-4":
      return REF2VA_TURBO_4_RECIPE;
    case "fasth3-i2v-8":
      return FASTH3_I2V_8_RECIPE;
    default: {
      const exhaustiveCheck: never = name;
      throw new Error(`Unknown sampling recipe: ${exhaustiveCheck}`);
    }
  }
}

export function listSamplingRecipes(): readonly MinimaxH3SamplingRecipe[] {
  return [
    createCanonicalBase20("ref2v"),
    FL2VA_BASE_20_RECIPE,
    FL2VA_TURBO_8_RECIPE,
    REF2VA_TURBO_4_RECIPE,
    FASTH3_I2V_8_RECIPE
  ];
}

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
    metadata: MinimaxH3AttentionEventMetadataSchema.optional()
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

export const FactorChangeSigmaShiftSchema = z
  .object({
    path: z.literal("sampling.sigmaShift"),
    before: z
      .object({
        enabled: z.boolean(),
        videoShift: z.number(),
        audioShift: z.number()
      })
      .strict(),
    after: z
      .object({
        enabled: z.boolean(),
        videoShift: z.number(),
        audioShift: z.number()
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
  FactorChangeSigmaShiftSchema,
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
          artifactHash: sha256HashSchema.optional(),
          importModule: z.string().optional()
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

export function buildRequiredRuntimeManifestFromAttentionCatalog(
  entry: MinimaxH3AttentionCatalogEntry,
  route: "i2v" | "ref2v",
  options?: {
    collectorDigest?: string;
    hookManifestDigest?: string;
    sourceFileHashes?: Record<string, string>;
    hooks?: ReadonlyArray<{
      name: string;
      modulePath: string;
      callable: string;
      phase: MinimaxH3PhaseType;
    }>;
  }
): MinimaxH3RequiredRuntimeManifest {
  const defaultHooks: ReadonlyArray<{
    name: string;
    modulePath: string;
    callable: string;
    phase: MinimaxH3PhaseType;
  }> = [
    {
      name: "minimax-h3-instrumentation-v2",
      modulePath: "comfy/model_management.py",
      callable: "sample",
      phase: "sampling_step"
    }
  ];
  const hooks = options?.hooks ?? defaultHooks;
  const genuineHookManifestDigest =
    options?.hookManifestDigest ?? sha256Hex(canonicalizeJson(hooks));
  const genuineCollectorDigest =
    options?.collectorDigest ?? "0000000000000000000000000000000000000000000000000000000000000000";

  const sourceFileHashes =
    options?.sourceFileHashes ??
    (entry.comfyuiCoreRevision === FASTH3_ISOLATED_CORE_REVISION
      ? { ...FASTH3_COMFYUI_SOURCE_HASHES }
      : {
          "comfy/model_management.py": PINNED_COMFYUI_SOURCE_HASHES.modelManagementSha256,
          "main.py": PINNED_COMFYUI_SOURCE_HASHES.mainSha256,
          "comfy/cli_args.py": PINNED_COMFYUI_SOURCE_HASHES.cliArgsSha256
        });

  return {
    coreRevision: entry.comfyuiCoreRevision,
    sourceFileHashes,
    requiredNodes: [
      {
        name: route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo"
      },
      ...entry.requiredNodes.map((n) => ({
        name: n.name,
        ...(n.revision ? { revision: n.revision } : {})
      }))
    ],
    pythonPackages:
      entry.pythonPackages.length > 0
        ? entry.pythonPackages.map((p) => ({
            name: p.name,
            version: p.version,
            ...(p.importModule ? { importModule: p.importModule } : {}),
            ...(p.artifactHash ? { artifactHash: p.artifactHash } : {})
          }))
        : [{ name: "torch", version: "2.5.1+cu124" }],
    pytorchBuild: "2.5.1+cu124",
    cudaBuild: "12.4",
    driverConstraints: [">=550.00.00"],
    attentionKernel: entry.kernel,
    instrumentationProtocol: "v2-jsonl",
    collectorDigest: genuineCollectorDigest,
    hookManifestDigest: genuineHookManifestDigest,
    hooks: [...hooks]
  };
}

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
        nodesMinimaxH3Sha256: sha256HashSchema.optional(),
        nodesPySha256: sha256HashSchema.optional()
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
    observedSampling: z
      .object({
        status: z.enum(["verified", "unknown", "conflict"]),
        completedSteps: z.number().int().nonnegative().nullable(),
        expectedSteps: z.number().int().positive(),
        samplerName: z.string().nullable().optional(),
        schedulerName: z.string().nullable().optional(),
        unknownReason: z.string().nullable().optional()
      })
      .strict()
      .optional(),
    observedConditioning: z
      .object({
        status: z.enum(["verified", "unknown", "conflict"]),
        nodeClass: z.string().nullable(),
        taskMode: z.string().nullable(),
        referenceCount: z.number().int().nonnegative().nullable().optional(),
        unknownReason: z.string().nullable().optional()
      })
      .strict()
      .optional(),
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
    checkpointOverride: z.enum(["ref2va", "fl2va"]).nullable().optional(),
    attentionRequest: MinimaxH3AttentionRequestSchema.optional(),
    samplingRecipe: MinimaxH3SamplingRecipeSchema.optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.samplingRecipe) {
      let canonicalRecipe: MinimaxH3SamplingRecipe;
      try {
        validateRecipeRouteCompatibility(val.samplingRecipe.name, val.route);
        canonicalRecipe = getSamplingRecipe(val.samplingRecipe.name, val.route);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: (err as Error).message,
          path: ["samplingRecipe"]
        });
        return;
      }

      const recomputedDigest = computeSamplingRecipeDigest(val.samplingRecipe);
      if (val.samplingRecipe.recipeDigest !== recomputedDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe recipeDigest mismatch: expected ${recomputedDigest}, got ${val.samplingRecipe.recipeDigest}`,
          path: ["samplingRecipe", "recipeDigest"]
        });
      }
      if (val.samplingRecipe.recipeDigest !== canonicalRecipe.recipeDigest) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe recipeDigest mismatch with authoritative catalog for "${val.samplingRecipe.name}": expected ${canonicalRecipe.recipeDigest}, got ${val.samplingRecipe.recipeDigest}`,
          path: ["samplingRecipe", "recipeDigest"]
        });
      }
      if (val.samplingRecipe.recipeVersion !== canonicalRecipe.recipeVersion) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe recipeVersion mismatch for "${val.samplingRecipe.name}": expected ${canonicalRecipe.recipeVersion}, got ${val.samplingRecipe.recipeVersion}`,
          path: ["samplingRecipe", "recipeVersion"]
        });
      }
      if (val.samplingRecipe.taskFamily !== canonicalRecipe.taskFamily) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe taskFamily mismatch for "${val.samplingRecipe.name}": expected ${canonicalRecipe.taskFamily}, got ${val.samplingRecipe.taskFamily}`,
          path: ["samplingRecipe", "taskFamily"]
        });
      }
      if (val.samplingRecipe.compatibleRoute !== canonicalRecipe.compatibleRoute) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Sampling recipe "${val.samplingRecipe.name}" is incompatible with route "${val.route}" (compatibleRoute: "${val.samplingRecipe.compatibleRoute}")`,
          path: ["samplingRecipe", "compatibleRoute"]
        });
      }
      if (
        val.samplingRecipe.diffusionModel.filename !== canonicalRecipe.diffusionModel.filename ||
        val.samplingRecipe.diffusionModel.sha256 !== canonicalRecipe.diffusionModel.sha256 ||
        val.samplingRecipe.diffusionModel.sizeBytes !== canonicalRecipe.diffusionModel.sizeBytes ||
        val.samplingRecipe.diffusionModel.quantization !==
          canonicalRecipe.diffusionModel.quantization ||
        val.samplingRecipe.diffusionModel.repository !==
          canonicalRecipe.diffusionModel.repository ||
        val.samplingRecipe.diffusionModel.revision !== canonicalRecipe.diffusionModel.revision
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe diffusionModel mismatch for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "diffusionModel"]
        });
      }
      if (canonicalRecipe.lora) {
        if (
          !val.samplingRecipe.lora ||
          val.samplingRecipe.lora.filename !== canonicalRecipe.lora.filename ||
          val.samplingRecipe.lora.sha256 !== canonicalRecipe.lora.sha256 ||
          val.samplingRecipe.lora.sizeBytes !== canonicalRecipe.lora.sizeBytes ||
          val.samplingRecipe.lora.strengthModel !== canonicalRecipe.lora.strengthModel ||
          val.samplingRecipe.lora.repository !== canonicalRecipe.lora.repository ||
          val.samplingRecipe.lora.revision !== canonicalRecipe.lora.revision
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `samplingRecipe lora mismatch for "${val.samplingRecipe.name}"`,
            path: ["samplingRecipe", "lora"]
          });
        }
      } else if (val.samplingRecipe.lora) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe lora must be null for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "lora"]
        });
      }
      if (val.samplingRecipe.expectedSteps !== canonicalRecipe.expectedSteps) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe expectedSteps mismatch for "${val.samplingRecipe.name}": expected ${canonicalRecipe.expectedSteps}, got ${val.samplingRecipe.expectedSteps}`,
          path: ["samplingRecipe", "expectedSteps"]
        });
      }
      if (
        val.samplingRecipe.sampler !== canonicalRecipe.sampler ||
        val.samplingRecipe.scheduler !== canonicalRecipe.scheduler ||
        val.samplingRecipe.denoise !== canonicalRecipe.denoise
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe sampler/scheduler/denoise mismatch for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "sampler"]
        });
      }
      if (canonicalRecipe.sigmaShift) {
        if (
          !val.samplingRecipe.sigmaShift ||
          val.samplingRecipe.sigmaShift.enabled !== canonicalRecipe.sigmaShift.enabled ||
          val.samplingRecipe.sigmaShift.videoShift !== canonicalRecipe.sigmaShift.videoShift ||
          val.samplingRecipe.sigmaShift.audioShift !== canonicalRecipe.sigmaShift.audioShift
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `samplingRecipe sigmaShift mismatch for "${val.samplingRecipe.name}"`,
            path: ["samplingRecipe", "sigmaShift"]
          });
        }
      } else if (val.samplingRecipe.sigmaShift) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe sigmaShift must be null for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "sigmaShift"]
        });
      }
      if (val.samplingRecipe.conditioningMode !== canonicalRecipe.conditioningMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe conditioningMode mismatch for "${val.samplingRecipe.name}": expected ${canonicalRecipe.conditioningMode}, got ${val.samplingRecipe.conditioningMode}`,
          path: ["samplingRecipe", "conditioningMode"]
        });
      }
      if (canonicalRecipe.attentionTopology) {
        if (
          !val.samplingRecipe.attentionTopology ||
          val.samplingRecipe.attentionTopology.backend !==
            canonicalRecipe.attentionTopology.backend ||
          val.samplingRecipe.attentionTopology.topologyDigest !==
            canonicalRecipe.attentionTopology.topologyDigest ||
          val.samplingRecipe.attentionTopology.patchCount !==
            canonicalRecipe.attentionTopology.patchCount
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `samplingRecipe attentionTopology mismatch for "${val.samplingRecipe.name}"`,
            path: ["samplingRecipe", "attentionTopology"]
          });
        }
      } else if (val.samplingRecipe.attentionTopology) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe attentionTopology must be null/undefined for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "attentionTopology"]
        });
      }
      if (
        val.samplingRecipe.licensing.status !== canonicalRecipe.licensing.status ||
        val.samplingRecipe.licensing.licenseSourceRef !== canonicalRecipe.licensing.licenseSourceRef
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe licensing mismatch for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "licensing"]
        });
      }
      if (val.samplingRecipe.sourceReferences.length !== canonicalRecipe.sourceReferences.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe sourceReferences length mismatch for "${val.samplingRecipe.name}"`,
          path: ["samplingRecipe", "sourceReferences"]
        });
      } else {
        for (let i = 0; i < canonicalRecipe.sourceReferences.length; i++) {
          if (
            val.samplingRecipe.sourceReferences[i]?.url !==
              canonicalRecipe.sourceReferences[i]?.url ||
            val.samplingRecipe.sourceReferences[i]?.assertion !==
              canonicalRecipe.sourceReferences[i]?.assertion
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `samplingRecipe sourceReferences[${i}] mismatch for "${val.samplingRecipe.name}"`,
              path: ["samplingRecipe", "sourceReferences", String(i)]
            });
          }
        }
      }
      if (val.samplingRecipe.requiredRuntimeRevision !== canonicalRecipe.requiredRuntimeRevision) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `samplingRecipe requiredRuntimeRevision mismatch for "${val.samplingRecipe.name}": expected ${canonicalRecipe.requiredRuntimeRevision}, got ${val.samplingRecipe.requiredRuntimeRevision}`,
          path: ["samplingRecipe", "requiredRuntimeRevision"]
        });
      }
      if (val.samplingRecipe.name === "fasth3-i2v-8" && val.route !== "i2v") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "FastH3 8-step is strictly restricted to I2V / frame-anchored route; Ref2V is rejected",
          path: ["samplingRecipe", "compatibleRoute"]
        });
      }
      if (val.samplingRecipe.name === "ref2va-turbo-4" && val.route !== "ref2v") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ref2VA Turbo 4-step LoRA is strictly restricted to Ref2V route",
          path: ["samplingRecipe", "compatibleRoute"]
        });
      }
      if (val.samplingRecipe.name === "fl2va-turbo-8" && val.route !== "i2v") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "FL2VA Turbo 8-step LoRA is strictly restricted to I2V route",
          path: ["samplingRecipe", "compatibleRoute"]
        });
      }
      if (
        val.stepOverride !== undefined &&
        val.stepOverride !== null &&
        val.stepOverride !== canonicalRecipe.expectedSteps
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `stepOverride (${val.stepOverride}) conflicts with sampling recipe expectedSteps (${canonicalRecipe.expectedSteps})`,
          path: ["stepOverride"]
        });
      }
      if (val.checkpointOverride) {
        const isFl2vaRecipe =
          canonicalRecipe.diffusionModel.filename.includes("fl2va") ||
          canonicalRecipe.name.startsWith("fl2va");
        const isRef2vaRecipe =
          canonicalRecipe.diffusionModel.filename.includes("ref2va") ||
          canonicalRecipe.name.startsWith("ref2va");
        if (
          (isFl2vaRecipe && val.checkpointOverride !== "fl2va") ||
          (isRef2vaRecipe && val.checkpointOverride !== "ref2va")
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `checkpointOverride (${val.checkpointOverride}) conflicts with sampling recipe diffusion model (${canonicalRecipe.diffusionModel.filename})`,
            path: ["checkpointOverride"]
          });
        }
      }

      // Validate descriptor model/runtime/sampler provenance against that canonical recipe
      if (val.provenance) {
        if (
          val.provenance.actualCheckpointHash &&
          val.provenance.actualCheckpointHash !== canonicalRecipe.diffusionModel.sha256
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Descriptor provenance.actualCheckpointHash (${val.provenance.actualCheckpointHash}) does not match canonical recipe checkpoint (${canonicalRecipe.diffusionModel.sha256})`,
            path: ["provenance", "actualCheckpointHash"]
          });
        }
        if (val.provenance.loadedModelHashes) {
          const diffHash =
            val.provenance.loadedModelHashes["diffusion"] ??
            val.provenance.loadedModelHashes[
              `diffusion_models/${canonicalRecipe.diffusionModel.filename}`
            ];
          if (diffHash && diffHash !== canonicalRecipe.diffusionModel.sha256) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Descriptor loadedModelHashes.diffusion does not match canonical recipe checkpoint`,
              path: ["provenance", "loadedModelHashes"]
            });
          }
          if (canonicalRecipe.lora) {
            const loraHash =
              val.provenance.loadedModelHashes["lora"] ??
              val.provenance.loadedModelHashes[`loras/${canonicalRecipe.lora.filename}`];
            if (loraHash !== canonicalRecipe.lora.sha256) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Descriptor loadedModelHashes.lora does not match canonical recipe LoRA`,
                path: ["provenance", "loadedModelHashes"]
              });
            }
          } else if (
            val.provenance.loadedModelHashes["lora"] ||
            Object.keys(val.provenance.loadedModelHashes).some((k) => k.startsWith("loras/"))
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Descriptor loadedModelHashes.lora must not be present for non-LoRA recipe`,
              path: ["provenance", "loadedModelHashes"]
            });
          }
        }
        if (
          val.provenance.comfyuiCoreRevision &&
          val.provenance.comfyuiCoreRevision !== canonicalRecipe.requiredRuntimeRevision
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Descriptor provenance.comfyuiCoreRevision (${val.provenance.comfyuiCoreRevision}) does not match recipe runtime (${canonicalRecipe.requiredRuntimeRevision})`,
            path: ["provenance", "comfyuiCoreRevision"]
          });
        }
        if (val.provenance.samplerSettings) {
          if (
            val.provenance.samplerSettings.steps !== canonicalRecipe.expectedSteps ||
            val.provenance.samplerSettings.sampler !== canonicalRecipe.sampler ||
            val.provenance.samplerSettings.scheduler !== canonicalRecipe.scheduler
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Descriptor provenance.samplerSettings (${val.provenance.samplerSettings.sampler}/${val.provenance.samplerSettings.scheduler}/${val.provenance.samplerSettings.steps}) does not match canonical recipe (${canonicalRecipe.sampler}/${canonicalRecipe.scheduler}/${canonicalRecipe.expectedSteps})`,
              path: ["provenance", "samplerSettings"]
            });
          }
        }
      }

      // Validate pinFileIdentities.modelDigests
      if (val.pinFileIdentities?.modelDigests) {
        const pinDiffHash =
          val.pinFileIdentities.modelDigests["diffusion"] ??
          val.pinFileIdentities.modelDigests[
            `diffusion_models/${canonicalRecipe.diffusionModel.filename}`
          ];
        if (pinDiffHash && pinDiffHash !== canonicalRecipe.diffusionModel.sha256) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Descriptor pinFileIdentities.modelDigests does not match canonical recipe checkpoint (${canonicalRecipe.diffusionModel.sha256})`,
            path: ["pinFileIdentities", "modelDigests"]
          });
        }
        if (canonicalRecipe.lora) {
          const pinLoraHash =
            val.pinFileIdentities.modelDigests["lora"] ??
            val.pinFileIdentities.modelDigests[`loras/${canonicalRecipe.lora.filename}`];
          if (pinLoraHash !== canonicalRecipe.lora.sha256) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Descriptor pinFileIdentities.modelDigests.lora does not match canonical recipe LoRA (${canonicalRecipe.lora.sha256})`,
              path: ["pinFileIdentities", "modelDigests"]
            });
          }
        }
      }

      // Validate resolvedModelPaths
      if (val.resolvedModelPaths) {
        const resDiff =
          val.resolvedModelPaths["diffusion"] ??
          val.resolvedModelPaths[`diffusion_models/${canonicalRecipe.diffusionModel.filename}`];
        if (resDiff && resDiff.expectedHash !== canonicalRecipe.diffusionModel.sha256) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Descriptor resolvedModelPaths.diffusion expectedHash does not match canonical recipe checkpoint (${canonicalRecipe.diffusionModel.sha256})`,
            path: ["resolvedModelPaths"]
          });
        }
        if (canonicalRecipe.lora) {
          const resLora =
            val.resolvedModelPaths["lora"] ??
            val.resolvedModelPaths[`loras/${canonicalRecipe.lora.filename}`];
          if (!resLora || resLora.expectedHash !== canonicalRecipe.lora.sha256) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Descriptor resolvedModelPaths.lora expectedHash does not match canonical recipe LoRA (${canonicalRecipe.lora.sha256})`,
              path: ["resolvedModelPaths"]
            });
          }
        }
      }

      // Validate requiredRuntime
      if (!val.requiredRuntime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Sampling recipe "${val.samplingRecipe.name}" requires requiredRuntime to be specified`,
          path: ["requiredRuntime"]
        });
      } else {
        if (val.requiredRuntime.coreRevision !== canonicalRecipe.requiredRuntimeRevision) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Descriptor requiredRuntime.coreRevision (${val.requiredRuntime.coreRevision}) does not match recipe runtime (${canonicalRecipe.requiredRuntimeRevision})`,
            path: ["requiredRuntime", "coreRevision"]
          });
        }
        if (val.samplingRecipe.name === "fasth3-i2v-8") {
          if (val.requiredRuntime.attentionKernel !== "block_sparse_triton") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `FastH3 recipe requires attentionKernel "block_sparse_triton", got "${val.requiredRuntime.attentionKernel}"`,
              path: ["requiredRuntime", "attentionKernel"]
            });
          }
          for (const [filePath, expectedHash] of Object.entries(FASTH3_COMFYUI_SOURCE_HASHES)) {
            const actualHash = val.requiredRuntime.sourceFileHashes[filePath];
            if (actualHash !== expectedHash) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `FastH3 recipe requires sourceFileHashes["${filePath}"] to match "${expectedHash}", got "${actualHash ?? "missing"}"`,
                path: ["requiredRuntime", "sourceFileHashes", filePath]
              });
            }
          }
          const requiredNodeNames = [
            "BlockSparseAttention",
            "ModelAttentionBackend",
            "MiniMaxH3ImageToVideo",
            "MiniMaxH3SigmaShift"
          ];
          for (const nodeName of requiredNodeNames) {
            const hasNode = val.requiredRuntime.requiredNodes.some((n) => n.name === nodeName);
            if (!hasNode) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `FastH3 recipe requires node "${nodeName}" in requiredRuntime.requiredNodes`,
                path: ["requiredRuntime", "requiredNodes"]
              });
            }
          }
          const hasKitchen = val.requiredRuntime.pythonPackages.some(
            (p) => p.name === "comfy-kitchen" && p.version === "0.2.34"
          );
          if (!hasKitchen) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `FastH3 recipe requires pythonPackage "comfy-kitchen" version "0.2.34"`,
              path: ["requiredRuntime", "pythonPackages"]
            });
          }
          const hasTorch = val.requiredRuntime.pythonPackages.some(
            (p) => p.name === "torch" && p.version === val.requiredRuntime.pytorchBuild
          );
          if (!hasTorch || !val.requiredRuntime.pytorchBuild) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `FastH3 recipe requires pythonPackage "torch" matching requiredRuntime.pytorchBuild`,
              path: ["requiredRuntime", "pythonPackages"]
            });
          }
        }
        if (canonicalRecipe.lora) {
          const hasLoraLoader = val.requiredRuntime.requiredNodes.some(
            (n) => n.name === "LoraLoaderModelOnly"
          );
          if (!hasLoraLoader) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Turbo recipe requires "LoraLoaderModelOnly" in requiredRuntime.requiredNodes`,
              path: ["requiredRuntime", "requiredNodes"]
            });
          }
          const expectedConditionerNode =
            val.route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo";
          const hasConditioner = val.requiredRuntime.requiredNodes.some(
            (n) => n.name === expectedConditionerNode
          );
          if (!hasConditioner) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Turbo recipe requires conditioner node "${expectedConditionerNode}" in requiredRuntime.requiredNodes`,
              path: ["requiredRuntime", "requiredNodes"]
            });
          }
          if (
            !val.requiredRuntime.sourceFileHashes["nodes.py"] ||
            val.requiredRuntime.sourceFileHashes["nodes.py"] !== PINNED_COMFYUI_NODES_PY_SHA256
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Turbo recipe requires nodes.py hash to match PINNED_COMFYUI_NODES_PY_SHA256`,
              path: ["requiredRuntime", "sourceFileHashes", "nodes.py"]
            });
          }
          if (
            !val.requiredRuntime.sourceFileHashes["comfy_extras/nodes_minimax_h3.py"] ||
            val.requiredRuntime.sourceFileHashes["comfy_extras/nodes_minimax_h3.py"] !==
              PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Turbo recipe requires comfy_extras/nodes_minimax_h3.py hash to match PINNED_COMFYUI_NODES_MINIMAX_H3_PY_SHA256`,
              path: ["requiredRuntime", "sourceFileHashes", "comfy_extras/nodes_minimax_h3.py"]
            });
          }
        }
      }
    }
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

    if (val.attentionRequest) {
      if (
        val.provenance.requestedAttentionBackend !== "default" &&
        val.attentionRequest.expectedBackend !== val.provenance.requestedAttentionBackend
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `attentionRequest expectedBackend '${val.attentionRequest.expectedBackend}' must match requestedAttentionBackend '${val.provenance.requestedAttentionBackend}'`,
          path: ["attentionRequest", "expectedBackend"]
        });
      }
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
    instrumentationReport: MinimaxH3InstrumentationReportSchema,
    attentionObservation: MinimaxH3AttentionObservationSchema.optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.attentionObservation) {
      if (val.attentionObservation.status === "verified") {
        if (
          !val.attentionObservation.actualBackend ||
          !val.attentionObservation.dispatchImplementation
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "attentionObservation with status 'verified' requires non-null actualBackend and dispatchImplementation",
            path: ["attentionObservation"]
          });
        }
        if (val.attentionObservation.missingKernelFailure) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "attentionObservation with status 'verified' cannot have missingKernelFailure",
            path: ["attentionObservation", "missingKernelFailure"]
          });
        }
      }
    }

    if (val.attentionObservation && val.observedProvenance.observedAttentionBackend) {
      const eff = val.observedProvenance.observedAttentionBackend.effectiveBackend;
      const act = val.attentionObservation.actualBackend;
      if (val.attentionObservation.status === "verified" && eff && act && eff !== act) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `observedProvenance effectiveBackend '${eff}' does not match attentionObservation actualBackend '${act}'`,
          path: ["attentionObservation", "actualBackend"]
        });
      }
      const effImpl = val.observedProvenance.observedAttentionBackend.dispatchImplementation;
      const actImpl = val.attentionObservation.dispatchImplementation;
      if (
        val.attentionObservation.status === "verified" &&
        effImpl &&
        actImpl &&
        effImpl !== actImpl
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `observedProvenance dispatchImplementation '${effImpl}' does not match attentionObservation dispatchImplementation '${actImpl}'`,
          path: ["attentionObservation", "dispatchImplementation"]
        });
      }
    }
  });
export type MinimaxH3ExperimentResultV2 = z.infer<typeof MinimaxH3ExperimentResultV2Schema>;

/**
 * Derives an attention verification view for an experiment descriptor and result.
 * For historical artifacts lacking modern attentionRequest / attentionObservation fields,
 * returns an observation with status: "unknown" instead of rejecting the artifact.
 */
export function getDerivedAttentionVerificationView(
  _descriptor?:
    | {
        provenance?: { requestedAttentionBackend?: string | null | undefined } | null | undefined;
        attentionRequest?: { expectedBackend?: string } | null | undefined;
      }
    | null
    | undefined,
  result?:
    | {
        observedProvenance?:
          | {
              observedAttentionBackend?:
                | {
                    effectiveBackend?: string | null | undefined;
                    dispatchImplementation?: string | null | undefined;
                  }
                | null
                | undefined;
            }
          | null
          | undefined;
        attentionObservation?: MinimaxH3AttentionObservation | null | undefined;
      }
    | null
    | undefined
): MinimaxH3AttentionObservation {
  if (result?.attentionObservation) {
    return result.attentionObservation;
  }
  const observedBackend =
    result?.observedProvenance?.observedAttentionBackend?.effectiveBackend ?? null;
  const dispatchImplementation =
    result?.observedProvenance?.observedAttentionBackend?.dispatchImplementation ?? null;

  return {
    status: "unknown",
    actualBackend: observedBackend,
    dispatchImplementation,
    acceleratedCallCount: 0,
    denseCallCount: 0,
    plannedDenseCallCount: 0,
    fallbackEvents: [],
    stepRecords: [],
    failureReason: null,
    missingKernelFailure: null,
    dtypeLayoutDiagnostics: null,
    measurementCoverage: {
      samplingCallsRecorded: 0,
      attentionCallsRecorded: 0,
      complete: false
    },
    timings: {
      deviceElapsedMs: null,
      kernelElapsedMs: null,
      timingUnavailableReason: "Historical artifact without attention observation"
    }
  };
}

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
  auxiliaryModels?: ReadonlyArray<{
    name: string;
    hash: string;
    strength: number;
    role: string;
    order: number;
  }>;
  sigmaShift?: {
    enabled: boolean;
    videoShift: number;
    audioShift: number;
  };
  attentionTopologyDigest?: string;
  runtimeManifestDigest?: string;
  coreRevision?: string;
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
      : options.memoryPolicy,
    auxiliaryModels: declaredSet.has("models.auxiliary")
      ? "<DECLARED_FACTOR_VARIATION>"
      : (options.auxiliaryModels ?? []).map((m) => ({
          name: m.name,
          hash: m.hash,
          strength: m.strength,
          role: m.role,
          order: m.order
        })),
    sigmaShift: declaredSet.has("sampling.sigmaShift")
      ? "<DECLARED_FACTOR_VARIATION>"
      : (options.sigmaShift ?? { enabled: false, videoShift: 12, audioShift: 3 }),
    attentionTopology: declaredSet.has("attention.configuration")
      ? "<DECLARED_FACTOR_VARIATION>"
      : (options.attentionTopologyDigest ?? "default"),
    runtimeManifest: declaredSet.has("runtime.manifest")
      ? "<DECLARED_FACTOR_VARIATION>"
      : (options.runtimeManifestDigest ?? "default"),
    coreRevision: declaredSet.has("runtime.manifest")
      ? "<DECLARED_FACTOR_VARIATION>"
      : (options.coreRevision ?? "default")
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
      observedSampling: {
        status: "unknown",
        completedSteps: null,
        expectedSteps: descriptor.samplingRecipe?.expectedSteps ?? descriptor.stepOverride ?? 20,
        samplerName: null,
        schedulerName: null,
        unknownReason: "not_started"
      },
      observedConditioning: {
        status: "unknown",
        nodeClass: null,
        taskMode: null,
        referenceCount: null,
        unknownReason: "not_started"
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
    },
    ...(descriptor.attentionRequest
      ? {
          attentionObservation: {
            status: "unknown" as const,
            actualBackend: null,
            dispatchImplementation: null,
            acceleratedCallCount: 0,
            denseCallCount: 0,
            plannedDenseCallCount: 0,
            fallbackEvents: [],
            failureReason: null,
            missingKernelFailure: null,
            dtypeLayoutDiagnostics: null,
            measurementCoverage: {
              samplingCallsRecorded: 0,
              attentionCallsRecorded: 0,
              complete: false
            },
            timings: {
              deviceElapsedMs: null,
              kernelElapsedMs: null,
              timingUnavailableReason:
                "Run has not executed; template initialized with empty measurements"
            }
          }
        }
      : {})
  };
}
