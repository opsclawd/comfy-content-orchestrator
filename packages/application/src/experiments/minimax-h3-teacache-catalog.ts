import {
  computeTeaCacheCatalogDigest,
  TEACACHE_UPSTREAM_COMMIT,
  type MinimaxH3TeaCacheCatalogEntry,
  type MinimaxH3TeaCacheMode
} from "@cco/contracts";

export const RAW_MINIMAX_H3_TEACACHE_CATALOG: readonly Omit<
  MinimaxH3TeaCacheCatalogEntry,
  "catalogDigest"
>[] = [
  // 1. Candidate - I2V
  {
    variantName: "teacache-raw-l1",
    route: "i2v",
    compatibilityState: "unverified",
    scope: "teacache-raw-l1-i2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNode: {
      name: "CCOMiniMaxH3TeaCache",
      repository: "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
      revision: TEACACHE_UPSTREAM_COMMIT,
      entrypoint: "nodes.py"
    },
    runnable: false,
    supportedThresholds: [0.05, 0.1, 0.15],
    defaultThreshold: 0.15,
    stepWindow: {
      minStartStep: 2,
      maxEndStep: 18,
      defaultStartStep: 2,
      defaultEndStep: 18,
      requiredTotalSteps: 20
    },
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
      securityReviewStatus: "pending"
    },
    isolationInstructions: {
      venvSetup: "Standard pinned production venv with PyTorch 2.5.1+cu124.",
      installRecipe:
        "Stage CCOMiniMaxH3TeaCache experimental custom node; no extra wheel packages.",
      teardownRecipe: "Remove staged custom node and restore clean environment."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending",
      "Candidate timestep caching approximation requires live RTX 4090 visual and continuity review (#445)"
    ],
    evidence: [
      {
        url: "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py",
        revision: TEACACHE_UPSTREAM_COMMIT,
        digest: "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
        assertion:
          "Upstream MiniMaxH3TeaCache node registers MODEL patch wrapping set_model_unet_function_wrapper."
      },
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "Pinned ComfyUI core provides ModelPatcher.set_model_unet_function_wrapper."
      }
    ]
  },
  // 2. Matched Control - I2V
  {
    variantName: "matched-control",
    route: "i2v",
    compatibilityState: "unverified",
    scope: "teacache-matched-control-i2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNode: {
      name: "CCOMiniMaxH3TeaCache",
      repository: "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
      revision: TEACACHE_UPSTREAM_COMMIT,
      entrypoint: "nodes.py"
    },
    runnable: false,
    supportedThresholds: [],
    defaultThreshold: 0,
    stepWindow: {
      minStartStep: 0,
      maxEndStep: 0,
      defaultStartStep: 0,
      defaultEndStep: 0,
      requiredTotalSteps: 20
    },
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
      securityReviewStatus: "pending"
    },
    isolationInstructions: {
      venvSetup: "Standard pinned production venv with PyTorch 2.5.1+cu124.",
      installRecipe: "Identical substrate to candidate without TeaCache patch.",
      teardownRecipe: "Preserve clean environment."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion:
          "Baseline matched control runs dense 20-step sampling on identical substrate with caching disabled."
      }
    ]
  },
  // 3. Candidate - Ref2V
  {
    variantName: "teacache-raw-l1",
    route: "ref2v",
    compatibilityState: "unverified",
    scope: "teacache-raw-l1-ref2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNode: {
      name: "CCOMiniMaxH3TeaCache",
      repository: "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
      revision: TEACACHE_UPSTREAM_COMMIT,
      entrypoint: "nodes.py"
    },
    runnable: false,
    supportedThresholds: [0.05, 0.1, 0.15],
    defaultThreshold: 0.15,
    stepWindow: {
      minStartStep: 2,
      maxEndStep: 18,
      defaultStartStep: 2,
      defaultEndStep: 18,
      requiredTotalSteps: 20
    },
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
      securityReviewStatus: "pending"
    },
    isolationInstructions: {
      venvSetup: "Standard pinned production venv with PyTorch 2.5.1+cu124.",
      installRecipe:
        "Stage CCOMiniMaxH3TeaCache experimental custom node; no extra wheel packages.",
      teardownRecipe: "Remove staged custom node and restore clean environment."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending",
      "Candidate timestep caching approximation requires live RTX 4090 visual and continuity review (#445)"
    ],
    evidence: [
      {
        url: "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py",
        revision: TEACACHE_UPSTREAM_COMMIT,
        digest: "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
        assertion:
          "Upstream MiniMaxH3TeaCache node registers MODEL patch wrapping set_model_unet_function_wrapper."
      },
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "Pinned ComfyUI core provides ModelPatcher.set_model_unet_function_wrapper."
      }
    ]
  },
  // 4. Matched Control - Ref2V
  {
    variantName: "matched-control",
    route: "ref2v",
    compatibilityState: "unverified",
    scope: "teacache-matched-control-ref2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNode: {
      name: "CCOMiniMaxH3TeaCache",
      repository: "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
      revision: TEACACHE_UPSTREAM_COMMIT,
      entrypoint: "nodes.py"
    },
    runnable: false,
    supportedThresholds: [],
    defaultThreshold: 0,
    stepWindow: {
      minStartStep: 0,
      maxEndStep: 0,
      defaultStartStep: 0,
      defaultEndStep: 0,
      requiredTotalSteps: 20
    },
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
      securityReviewStatus: "pending"
    },
    isolationInstructions: {
      venvSetup: "Standard pinned production venv with PyTorch 2.5.1+cu124.",
      installRecipe: "Identical substrate to candidate without TeaCache patch.",
      teardownRecipe: "Preserve clean environment."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion:
          "Baseline matched control runs dense 20-step sampling on identical substrate with caching disabled."
      }
    ]
  }
];

export const MINIMAX_H3_TEACACHE_CATALOG: readonly MinimaxH3TeaCacheCatalogEntry[] = Object.freeze(
  RAW_MINIMAX_H3_TEACACHE_CATALOG.map((raw) =>
    Object.freeze({
      ...raw,
      catalogDigest: computeTeaCacheCatalogDigest(raw)
    })
  )
);

export function listTeaCacheCatalogEntries(options?: {
  route?: "i2v" | "ref2v";
  variantName?: string;
}): readonly MinimaxH3TeaCacheCatalogEntry[] {
  let entries = [...MINIMAX_H3_TEACACHE_CATALOG];
  if (options?.route) {
    entries = entries.filter((e) => e.route === options.route);
  }
  if (options?.variantName) {
    entries = entries.filter((e) => e.variantName === options.variantName);
  }
  return entries;
}

export function getTeaCacheCatalogEntry(
  variantName: "teacache-raw-l1" | "matched-control" | "off",
  route: "i2v" | "ref2v"
): MinimaxH3TeaCacheCatalogEntry {
  const normName = variantName === "off" ? "matched-control" : variantName;
  const match = MINIMAX_H3_TEACACHE_CATALOG.find(
    (e) => e.variantName === normName && e.route === route
  );
  if (!match) {
    throw new Error(
      `No TeaCache catalog entry found for variant "${variantName}" and route "${route}".`
    );
  }
  return match;
}

/** Selects the catalog variant for a TeaCache request mode ("off" is the matched control). */
export function teaCacheCatalogVariantForMode(
  mode: MinimaxH3TeaCacheMode
): "matched-control" | "teacache-raw-l1" {
  switch (mode) {
    case "off":
      return "matched-control";
    case "raw-l1-v1":
      return "teacache-raw-l1";
    default: {
      const unreachable: never = mode;
      throw new Error(`Unsupported TeaCache mode: ${String(unreachable)}`);
    }
  }
}
