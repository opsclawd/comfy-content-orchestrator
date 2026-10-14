import {
  computeAttentionCatalogDigest,
  type MinimaxH3AttentionCatalogEntry,
  type MinimaxH3AttentionVariantName
} from "@cco/contracts";

export const RAW_MINIMAX_H3_ATTENTION_CATALOG: readonly Omit<
  MinimaxH3AttentionCatalogEntry,
  "catalogDigest"
>[] = [
  // 1. Dense Control - I2V (Pinned Production Core)
  {
    variantName: "dense",
    route: "i2v",
    compatibilityState: "unverified",
    scope: "baseline-dense-attention-i2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/pytorch/pytorch/blob/v2.5.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description: "Control regime: all attention layers and steps execute dense SDPA."
    },
    isolationInstructions: {
      venvSetup: "Standard pinned production venv with PyTorch 2.5.1+cu124.",
      installRecipe: "No additional packages required.",
      teardownRecipe: "Preserve standard pinned environment."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/modules/attention.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion:
          "Default attention path dispatches to attention_pytorch (torch.nn.functional.scaled_dot_product_attention)."
      }
    ]
  },

  // 2. Dense Control - Ref2V (Pinned Production Core)
  {
    variantName: "dense",
    route: "ref2v",
    compatibilityState: "unverified",
    scope: "baseline-dense-attention-ref2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/pytorch/pytorch/blob/v2.5.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description: "Control regime: all attention layers and steps execute dense SDPA."
    },
    isolationInstructions: {
      venvSetup: "Standard pinned production venv with PyTorch 2.5.1+cu124.",
      installRecipe: "No additional packages required.",
      teardownRecipe: "Preserve standard pinned environment."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/modules/attention.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion:
          "Default attention path dispatches to attention_pytorch (torch.nn.functional.scaled_dot_product_attention)."
      }
    ]
  },

  // 3. Dense Control - I2V (Upgraded Isolated Experimental Core)
  {
    variantName: "dense",
    route: "i2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "upgraded-dense-attention-control-i2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/pytorch/pytorch/blob/v2.5.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description:
        "Upgraded control regime: all attention layers and steps execute dense SDPA on upgraded core."
    },
    isolationInstructions: {
      venvSetup:
        "Clone ComfyUI at 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf in .ai-checkouts/comfyui-upgraded with PyTorch 2.5.1+cu124.",
      installRecipe: "No additional packages required.",
      teardownRecipe: "Remove .ai-checkouts/comfyui-upgraded and isolated venv."
    },
    blockers: [
      "Target experimental upgrade checkout not yet provisioned",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf/comfy/ldm/modules/attention.py",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 4. Dense Control - Ref2V (Upgraded Isolated Experimental Core)
  {
    variantName: "dense",
    route: "ref2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "upgraded-dense-attention-control-ref2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/pytorch/pytorch/blob/v2.5.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description:
        "Upgraded control regime: all attention layers and steps execute dense SDPA on upgraded core."
    },
    isolationInstructions: {
      venvSetup:
        "Clone ComfyUI at 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf in .ai-checkouts/comfyui-upgraded with PyTorch 2.5.1+cu124.",
      installRecipe: "No additional packages required.",
      teardownRecipe: "Remove .ai-checkouts/comfyui-upgraded and isolated venv."
    },
    blockers: [
      "Target experimental upgrade checkout not yet provisioned",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf/comfy/ldm/modules/attention.py",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 5. SageAttention - I2V
  {
    variantName: "sage",
    route: "i2v",
    compatibilityState: "unverified",
    scope: "sageattention-flag-isolated-venv-i2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    runnable: false,
    backend: "sage",
    kernel: "sageattention.sageattn",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "sageattention",
        version: "2.1.1",
        importModule: "sageattention"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/thu-ml/SageAttention/blob/v2.1.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: false,
      description:
        "Accelerated regime: all compatible attention layers must execute SageAttention; any fallback to PyTorch SDPA is an experiment failure."
    },
    isolationInstructions: {
      venvSetup: "Create isolated venv from pinned base: python3 -m venv .ai-venvs/minimax-h3-sage",
      installRecipe:
        "pip install sageattention==2.1.1 --extra-index-url https://download.pytorch.org/whl/cu124",
      teardownRecipe:
        "Deactivate and remove .ai-venvs/minimax-h3-sage directory; production venv is untouched."
    },
    blockers: [
      "sageattention Python package not verified in isolated venv",
      "Exact tensor dtype eligibility on INT8 ConvRot model unverified on SM89/RTX 4090",
      "Hardware dispatch pending operator execution",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/cli_args.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "ComfyUI CLI exposes --use-sage-attention flag."
      },
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/modules/attention.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion:
          "attention_sage dispatches to sageattention when available; falls back to dense if absent."
      }
    ]
  },

  // 6. SageAttention - Ref2V
  {
    variantName: "sage",
    route: "ref2v",
    compatibilityState: "unverified",
    scope: "sageattention-flag-isolated-venv-ref2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    runnable: false,
    backend: "sage",
    kernel: "sageattention.sageattn",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "sageattention",
        version: "2.1.1",
        importModule: "sageattention"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/thu-ml/SageAttention/blob/v2.1.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: false,
      description:
        "Accelerated regime: all compatible attention layers must execute SageAttention; any fallback to PyTorch SDPA is an experiment failure."
    },
    isolationInstructions: {
      venvSetup: "Create isolated venv from pinned base: python3 -m venv .ai-venvs/minimax-h3-sage",
      installRecipe:
        "pip install sageattention==2.1.1 --extra-index-url https://download.pytorch.org/whl/cu124",
      teardownRecipe:
        "Deactivate and remove .ai-venvs/minimax-h3-sage directory; production venv is untouched."
    },
    blockers: [
      "sageattention Python package not verified in isolated venv",
      "Exact tensor dtype eligibility on INT8 ConvRot model unverified on SM89/RTX 4090",
      "Hardware dispatch pending operator execution",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/cli_args.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "ComfyUI CLI exposes --use-sage-attention flag."
      },
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/modules/attention.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion:
          "attention_sage dispatches to sageattention when available; falls back to dense if absent."
      }
    ]
  },

  // 7. Native sol-attn - I2V
  {
    variantName: "native-sol-attn",
    route: "i2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "native-sparse-sol-attn-upgrade-i2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    runnable: false,
    backend: "sol_attn",
    kernel: "comfy_kitchen.sol_attn",
    requiredNodes: [
      {
        name: "ModelSparseAttention",
        classType: "ModelSparseAttention",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
      }
    ],
    pythonPackages: [
      {
        name: "comfy-kitchen",
        version: "0.2.31",
        importModule: "comfy_kitchen"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/Comfy-Org/comfy-kitchen/blob/v0.2.31/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      minTokensThreshold: 1024,
      description:
        "Native sparse attention executes sol-attn on layers above 1024 tokens; short sequences execute dense attention by design."
    },
    isolationInstructions: {
      venvSetup:
        "Clone ComfyUI at experimental revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf into .ai-checkouts/comfyui-sol-attn",
      installRecipe: "pip install comfy-kitchen==0.2.31",
      teardownRecipe:
        "Remove .ai-checkouts/comfyui-sol-attn and isolated venv; production checkout remains pinned at 55b6a9b1."
    },
    blockers: [
      "ComfyUI core upgrade required (ModelSparseAttention node not present in pinned core 55b6a9b1)",
      "comfy-kitchen sol-attn kernel requires CUDA SM89 compilation verification",
      "Isolated experimental checkout required",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/docs/blob/main/tutorials/video/minimax/minimax-h3.mdx",
        assertion: "Model Sparse Attention requires sol-attn kernel from comfy-kitchen and CUDA."
      },
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/nodes_model_advanced.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "Pinned ComfyUI core does not contain ModelSparseAttention node."
      }
    ]
  },

  // 8. Native sol-attn - Ref2V
  {
    variantName: "native-sol-attn",
    route: "ref2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "native-sparse-sol-attn-upgrade-ref2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    runnable: false,
    backend: "sol_attn",
    kernel: "comfy_kitchen.sol_attn",
    requiredNodes: [
      {
        name: "ModelSparseAttention",
        classType: "ModelSparseAttention",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
      }
    ],
    pythonPackages: [
      {
        name: "comfy-kitchen",
        version: "0.2.31",
        importModule: "comfy_kitchen"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/Comfy-Org/comfy-kitchen/blob/v0.2.31/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      minTokensThreshold: 1024,
      description:
        "Native sparse attention executes sol-attn on layers above 1024 tokens; short sequences execute dense attention by design."
    },
    isolationInstructions: {
      venvSetup:
        "Clone ComfyUI at experimental revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf into .ai-checkouts/comfyui-sol-attn",
      installRecipe: "pip install comfy-kitchen==0.2.31",
      teardownRecipe:
        "Remove .ai-checkouts/comfyui-sol-attn and isolated venv; production checkout remains pinned at 55b6a9b1."
    },
    blockers: [
      "ComfyUI core upgrade required (ModelSparseAttention node not present in pinned core 55b6a9b1)",
      "comfy-kitchen sol-attn kernel requires CUDA SM89 compilation verification",
      "Isolated experimental checkout required",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/docs/blob/main/tutorials/video/minimax/minimax-h3.mdx",
        assertion: "Model Sparse Attention requires sol-attn kernel from comfy-kitchen and CUDA."
      },
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/nodes_model_advanced.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "Pinned ComfyUI core does not contain ModelSparseAttention node."
      }
    ]
  },

  // 9. Veda - I2V
  {
    variantName: "veda",
    route: "i2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "veda-sparse-attention-i2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    customNode: {
      name: "Veda-on-ComfyUI",
      repository: "https://github.com/veda-sparse/Veda-on-ComfyUI",
      revision: "67e4eb5541b648555563144401ebaba832bd73ec"
    },
    runnable: false,
    backend: "veda",
    kernel: "veda_sparse_attention.triton_kernel",
    requiredNodes: [
      {
        name: "VedaSparseAttention",
        classType: "VedaSparseAttention",
        revision: "67e4eb5541b648555563144401ebaba832bd73ec"
      }
    ],
    pythonPackages: [
      {
        name: "triton",
        version: "3.0.0",
        importModule: "triton"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    predictor: {
      repository: "https://github.com/veda-sparse/Veda-on-ComfyUI",
      revision: "67e4eb5541b648555563144401ebaba832bd73ec",
      filename: "minimax_h3_i2v_veda_predictor.safetensors",
      sha256: "c4f830382348db497db21966db98d89cb2169ca004313f8aa54a11f2a4ad85b1",
      taskMode: "i2v_tracking",
      reviewStatus: "pending"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/veda-sparse/Veda-on-ComfyUI/blob/67e4eb5541b648555563144401ebaba832bd73ec/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: false,
      description:
        "Veda sparse attention masks attention tokens via predictor; does not combine with native sparse attention."
    },
    isolationInstructions: {
      venvSetup:
        "Clone Veda into custom_nodes/ of an isolated ComfyUI checkout (revision >= 0.38.0, e.g. 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf).",
      installRecipe:
        "pip install triton==3.0.0; download verified predictor weights into models/predictors/",
      teardownRecipe: "Remove isolated checkout; release all GPU locks."
    },
    blockers: [
      "ComfyUI core upgrade required (>=0.38.0)",
      "Veda custom node installation required (commit 67e4eb5541b648555563144401ebaba832bd73ec)",
      "Triton 3.0.0 required",
      "Task/predictor alignment with Ref2VA checkpoint unverified for I2V route",
      "SM89/RTX 4090 GPU kernel suitability unverified",
      "Predictor license and security review pending",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/veda-sparse/Veda-on-ComfyUI/blob/67e4eb5541b648555563144401ebaba832bd73ec/pyproject.toml",
        revision: "67e4eb5541b648555563144401ebaba832bd73ec",
        assertion: "Veda declares ComfyUI >= 0.38.0, Triton >= 3.0."
      }
    ]
  },

  // 10. Veda - Ref2V
  {
    variantName: "veda",
    route: "ref2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "veda-sparse-attention-ref2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    customNode: {
      name: "Veda-on-ComfyUI",
      repository: "https://github.com/veda-sparse/Veda-on-ComfyUI",
      revision: "67e4eb5541b648555563144401ebaba832bd73ec"
    },
    runnable: false,
    backend: "veda",
    kernel: "veda_sparse_attention.triton_kernel",
    requiredNodes: [
      {
        name: "VedaSparseAttention",
        classType: "VedaSparseAttention",
        revision: "67e4eb5541b648555563144401ebaba832bd73ec"
      }
    ],
    pythonPackages: [
      {
        name: "triton",
        version: "3.0.0",
        importModule: "triton"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    predictor: {
      repository: "https://github.com/veda-sparse/Veda-on-ComfyUI",
      revision: "67e4eb5541b648555563144401ebaba832bd73ec",
      filename: "minimax_h3_ref2v_veda_predictor.safetensors",
      sha256: "d7a16b9f298cb28db7800049281a4bca99283f47e304bfa92305a462cb380931",
      taskMode: "ref2v_reference_tracking",
      reviewStatus: "pending"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/veda-sparse/Veda-on-ComfyUI/blob/67e4eb5541b648555563144401ebaba832bd73ec/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: false,
      description:
        "Veda sparse attention masks attention tokens via predictor; does not combine with native sparse attention."
    },
    isolationInstructions: {
      venvSetup:
        "Clone Veda into custom_nodes/ of an isolated ComfyUI checkout (revision >= 0.38.0, e.g. 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf).",
      installRecipe:
        "pip install triton==3.0.0; download verified predictor weights into models/predictors/",
      teardownRecipe: "Remove isolated checkout; release all GPU locks."
    },
    blockers: [
      "ComfyUI core upgrade required (>=0.38.0)",
      "Veda custom node installation required (commit 67e4eb5541b648555563144401ebaba832bd73ec)",
      "Triton 3.0.0 required",
      "SM89/RTX 4090 GPU kernel suitability unverified",
      "Predictor license and security review pending",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/veda-sparse/Veda-on-ComfyUI/blob/67e4eb5541b648555563144401ebaba832bd73ec/pyproject.toml",
        revision: "67e4eb5541b648555563144401ebaba832bd73ec",
        assertion: "Veda declares ComfyUI >= 0.38.0, Triton >= 3.0."
      }
    ]
  },

  // 11. Matched Dense Control for SageAttention - I2V
  {
    variantName: "dense",
    route: "i2v",
    compatibilityState: "unverified",
    scope: "sage-matched-dense-attention-i2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "sageattention",
        version: "2.1.1",
        importModule: "sageattention"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/thu-ml/SageAttention/blob/v2.1.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description: "Matched dense control in SageAttention isolated venv; executes dense SDPA."
    },
    isolationInstructions: {
      venvSetup: "Create isolated venv from pinned base: python3 -m venv .ai-venvs/minimax-h3-sage",
      installRecipe:
        "pip install sageattention==2.1.1 --extra-index-url https://download.pytorch.org/whl/cu124",
      teardownRecipe:
        "Deactivate and remove .ai-venvs/minimax-h3-sage directory; production venv is untouched."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/modules/attention.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 12. Matched Dense Control for SageAttention - Ref2V
  {
    variantName: "dense",
    route: "ref2v",
    compatibilityState: "unverified",
    scope: "sage-matched-dense-attention-ref2v",
    comfyuiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "sageattention",
        version: "2.1.1",
        importModule: "sageattention"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/thu-ml/SageAttention/blob/v2.1.1/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description: "Matched dense control in SageAttention isolated venv; executes dense SDPA."
    },
    isolationInstructions: {
      venvSetup: "Create isolated venv from pinned base: python3 -m venv .ai-venvs/minimax-h3-sage",
      installRecipe:
        "pip install sageattention==2.1.1 --extra-index-url https://download.pytorch.org/whl/cu124",
      teardownRecipe:
        "Deactivate and remove .ai-venvs/minimax-h3-sage directory; production venv is untouched."
    },
    blockers: [
      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/modules/attention.py",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 13. Matched Dense Control for native sol-attn - I2V
  {
    variantName: "dense",
    route: "i2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "sol-attn-matched-dense-attention-i2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "comfy-kitchen",
        version: "0.2.31",
        importModule: "comfy_kitchen"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/Comfy-Org/comfy-kitchen/blob/v0.2.31/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description:
        "Matched dense control in sol-attn isolated checkout; executes dense SDPA on upgraded core."
    },
    isolationInstructions: {
      venvSetup:
        "Clone ComfyUI at experimental revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf into .ai-checkouts/comfyui-sol-attn",
      installRecipe: "pip install comfy-kitchen==0.2.31",
      teardownRecipe:
        "Remove .ai-checkouts/comfyui-sol-attn and isolated venv; production checkout remains pinned at 55b6a9b1."
    },
    blockers: [
      "Target experimental upgrade checkout not yet provisioned",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf/comfy/ldm/modules/attention.py",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 14. Matched Dense Control for native sol-attn - Ref2V
  {
    variantName: "dense",
    route: "ref2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "sol-attn-matched-dense-attention-ref2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "comfy-kitchen",
        version: "0.2.31",
        importModule: "comfy_kitchen"
      },
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef: "https://github.com/Comfy-Org/comfy-kitchen/blob/v0.2.31/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description:
        "Matched dense control in sol-attn isolated checkout; executes dense SDPA on upgraded core."
    },
    isolationInstructions: {
      venvSetup:
        "Clone ComfyUI at experimental revision 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf into .ai-checkouts/comfyui-sol-attn",
      installRecipe: "pip install comfy-kitchen==0.2.31",
      teardownRecipe:
        "Remove .ai-checkouts/comfyui-sol-attn and isolated venv; production checkout remains pinned at 55b6a9b1."
    },
    blockers: [
      "Target experimental upgrade checkout not yet provisioned",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf/comfy/ldm/modules/attention.py",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 15. Matched Dense Control for Veda - I2V
  {
    variantName: "dense",
    route: "i2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "veda-matched-dense-attention-i2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    customNode: {
      name: "Veda-on-ComfyUI",
      repository: "https://github.com/veda-sparse/Veda-on-ComfyUI",
      revision: "67e4eb5541b648555563144401ebaba832bd73ec"
    },
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      },
      {
        name: "triton",
        version: "3.0.0",
        importModule: "triton"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/veda-sparse/Veda-on-ComfyUI/blob/67e4eb5541b648555563144401ebaba832bd73ec/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description:
        "Matched dense control in Veda isolated checkout with Veda-on-ComfyUI and Triton 3.0.0; executes dense SDPA."
    },
    isolationInstructions: {
      venvSetup:
        "Clone Veda into custom_nodes/ of an isolated ComfyUI checkout (revision >= 0.38.0, e.g. 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf).",
      installRecipe: "pip install triton==3.0.0",
      teardownRecipe: "Remove isolated checkout; release all GPU locks."
    },
    blockers: [
      "Target experimental upgrade checkout and Veda custom node not yet provisioned",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf/comfy/ldm/modules/attention.py",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  },

  // 16. Matched Dense Control for Veda - Ref2V
  {
    variantName: "dense",
    route: "ref2v",
    compatibilityState: "requires_isolated_upgrade",
    scope: "veda-matched-dense-attention-ref2v",
    comfyuiCoreRevision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
    customNode: {
      name: "Veda-on-ComfyUI",
      repository: "https://github.com/veda-sparse/Veda-on-ComfyUI",
      revision: "67e4eb5541b648555563144401ebaba832bd73ec"
    },
    runnable: false,
    backend: "torch_sdpa",
    kernel: "torch.nn.functional.scaled_dot_product_attention",
    requiredNodes: [],
    pythonPackages: [
      {
        name: "torch",
        version: "2.5.1+cu124",
        importModule: "torch"
      },
      {
        name: "triton",
        version: "3.0.0",
        importModule: "triton"
      }
    ],
    cudaRequirement: ">=12.4",
    computeCapability: "sm_89",
    supportedDtypes: ["float16", "bfloat16"],
    checkpointCompatibility: {
      filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
      sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      taskMode: "ref2va_pruned_int8"
    },
    licensing: {
      status: "review_required",
      licenseSourceRef:
        "https://github.com/veda-sparse/Veda-on-ComfyUI/blob/67e4eb5541b648555563144401ebaba832bd73ec/LICENSE",
      securityReviewStatus: "pending"
    },
    denseRegionPolicy: {
      allowPlannedDense: true,
      description:
        "Matched dense control in Veda isolated checkout with Veda-on-ComfyUI and Triton 3.0.0; executes dense SDPA."
    },
    isolationInstructions: {
      venvSetup:
        "Clone Veda into custom_nodes/ of an isolated ComfyUI checkout (revision >= 0.38.0, e.g. 94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf).",
      installRecipe: "pip install triton==3.0.0",
      teardownRecipe: "Remove isolated checkout; release all GPU locks."
    },
    blockers: [
      "Target experimental upgrade checkout and Veda custom node not yet provisioned",
      "Security review pending"
    ],
    evidence: [
      {
        url: "https://github.com/Comfy-Org/ComfyUI/blob/94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf/comfy/ldm/modules/attention.py",
        revision: "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf",
        assertion: "Default attention path dispatches to attention_pytorch."
      }
    ]
  }
];

export const MINIMAX_H3_ATTENTION_CATALOG: readonly MinimaxH3AttentionCatalogEntry[] =
  RAW_MINIMAX_H3_ATTENTION_CATALOG.map((raw) => ({
    ...raw,
    catalogDigest: computeAttentionCatalogDigest(raw)
  }));

export interface GetAttentionCatalogEntryOptions {
  coreRevision?: string | undefined;
  scope?: string | undefined;
  catalogDigest?: string | undefined;
  matchedVariant?: MinimaxH3AttentionVariantName | undefined;
}

export function getAttentionCatalogEntry(
  variantName: MinimaxH3AttentionVariantName,
  route: "i2v" | "ref2v",
  optionsOrCoreRevision?: string | GetAttentionCatalogEntryOptions
): MinimaxH3AttentionCatalogEntry {
  const options: GetAttentionCatalogEntryOptions =
    typeof optionsOrCoreRevision === "string"
      ? { coreRevision: optionsOrCoreRevision }
      : (optionsOrCoreRevision ?? {});

  // 1. Match by catalogDigest if specified
  if (options.catalogDigest) {
    const digestMatch = MINIMAX_H3_ATTENTION_CATALOG.find(
      (e) => e.catalogDigest === options.catalogDigest
    );
    if (digestMatch) {
      return digestMatch;
    }
  }

  // 2. Match by scope if specified
  if (options.scope) {
    const scopeMatch = MINIMAX_H3_ATTENTION_CATALOG.find(
      (e) => e.variantName === variantName && e.route === route && e.scope === options.scope
    );
    if (scopeMatch) {
      return scopeMatch;
    }
  }

  // 3. Match by matchedVariant (e.g. for matched dense controls)
  if (options.matchedVariant) {
    if (variantName === "dense") {
      let targetScope: string | undefined;
      if (options.matchedVariant === "sage") {
        targetScope = `sage-matched-dense-attention-${route}`;
      } else if (options.matchedVariant === "native-sol-attn") {
        targetScope = `sol-attn-matched-dense-attention-${route}`;
      } else if (options.matchedVariant === "veda") {
        targetScope = `veda-matched-dense-attention-${route}`;
      } else if (options.matchedVariant === "dense") {
        targetScope =
          options.coreRevision === "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf"
            ? `upgraded-dense-attention-control-${route}`
            : `baseline-dense-attention-${route}`;
      }
      if (targetScope) {
        const matched = MINIMAX_H3_ATTENTION_CATALOG.find((e) => e.scope === targetScope);
        if (matched) return matched;
      }
    }
  }

  // 4. Match by coreRevision if specified
  if (options.coreRevision) {
    const candidates = MINIMAX_H3_ATTENTION_CATALOG.filter(
      (e) =>
        e.variantName === variantName &&
        e.route === route &&
        e.comfyuiCoreRevision === options.coreRevision
    );
    if (candidates.length === 1) {
      return candidates[0]!;
    }
    if (candidates.length > 1) {
      if (variantName === "dense") {
        if (options.coreRevision === "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc") {
          const baseline = candidates.find((e) => e.scope === `baseline-dense-attention-${route}`);
          if (baseline) return baseline;
        } else if (options.coreRevision === "94cfeb3a5d8985efaa7ea9f5e5dfad4184ec99bf") {
          const upgraded = candidates.find(
            (e) => e.scope === `upgraded-dense-attention-control-${route}`
          );
          if (upgraded) return upgraded;
        }
      }
      return candidates[0]!;
    }
  }

  // 5. Default match by variant and route
  const matches = MINIMAX_H3_ATTENTION_CATALOG.filter(
    (e) => e.variantName === variantName && e.route === route
  );
  if (matches.length > 0) {
    if (variantName === "dense") {
      const baseline = matches.find((e) => e.scope === `baseline-dense-attention-${route}`);
      if (baseline) return baseline;
    }
    return matches[0]!;
  }

  throw new Error(
    `No attention catalog entry found for variant "${variantName}" on route "${route}"${
      options.coreRevision ? ` with coreRevision "${options.coreRevision}"` : ""
    }${options.scope ? ` with scope "${options.scope}"` : ""}${
      options.catalogDigest ? ` with catalogDigest "${options.catalogDigest}"` : ""
    }.`
  );
}

export function listAttentionCatalogEntries(filter?: {
  variantName?: MinimaxH3AttentionVariantName;
  route?: "i2v" | "ref2v";
  coreRevision?: string;
}): readonly MinimaxH3AttentionCatalogEntry[] {
  let list = MINIMAX_H3_ATTENTION_CATALOG;
  if (filter?.variantName) {
    list = list.filter((e) => e.variantName === filter.variantName);
  }
  if (filter?.route) {
    list = list.filter((e) => e.route === filter.route);
  }
  if (filter?.coreRevision) {
    list = list.filter((e) => e.comfyuiCoreRevision === filter.coreRevision);
  }
  return list;
}
