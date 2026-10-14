import {
  computeAttentionTopologyDigest,
  type MinimaxH3AttentionPatchNode,
  type MinimaxH3AttentionTopology,
  type MinimaxH3AttentionVariantName
} from "@cco/contracts";

export interface ComfyNode {
  inputs?: Record<string, unknown>;
  class_type?: string;
  _meta?: { title?: string };
  [key: string]: unknown;
}

export interface DeriveAttentionGraphOptions {
  graph: Record<string, unknown>;
  attentionVariant: MinimaxH3AttentionVariantName;
  route: "i2v" | "ref2v";
}

export interface DerivedAttentionResult {
  graph: Record<string, unknown>;
  patches: MinimaxH3AttentionPatchNode[];
  topology: MinimaxH3AttentionTopology;
}

export function deriveAttentionGraph(options: DeriveAttentionGraphOptions): DerivedAttentionResult {
  const { graph, attentionVariant, route } = options;
  const derived = JSON.parse(JSON.stringify(graph)) as Record<string, ComfyNode>;

  const unetLoaderId = "6";
  const guiderNodeId = "16";

  if (attentionVariant === "dense" || attentionVariant === "sage") {
    // Zero patch nodes, untouched model connection
    const patches: MinimaxH3AttentionPatchNode[] = [];
    const backend = attentionVariant === "sage" ? "sage" : "torch_sdpa";
    const topology: MinimaxH3AttentionTopology = {
      backend,
      patchCount: 0,
      patches,
      topologyDigest: computeAttentionTopologyDigest(patches)
    };
    return { graph: derived, patches, topology };
  }

  if (attentionVariant === "native-sol-attn") {
    const patchNodeId = "301";
    const patchNode: ComfyNode = {
      inputs: {
        model: [unetLoaderId, 0],
        sparse_type: "sol-attn"
      },
      class_type: "ModelSparseAttention",
      _meta: {
        title: "Model Sparse Attention (sol-attn)"
      }
    };
    derived[patchNodeId] = patchNode;

    // Rewire BasicGuider (node 16) to receive model from the patch node
    if (derived[guiderNodeId]?.inputs) {
      derived[guiderNodeId].inputs.model = [patchNodeId, 0];
    }

    const patches: MinimaxH3AttentionPatchNode[] = [
      {
        nodeId: patchNodeId,
        classType: "ModelSparseAttention",
        inputs: {
          model: [unetLoaderId, 0],
          sparse_type: "sol-attn"
        }
      }
    ];

    const topology: MinimaxH3AttentionTopology = {
      backend: "sol_attn",
      patchCount: 1,
      patches,
      topologyDigest: computeAttentionTopologyDigest(patches)
    };

    return { graph: derived, patches, topology };
  }

  if (attentionVariant === "veda") {
    const patchNodeId = "301";
    const predictorName =
      route === "ref2v"
        ? "minimax_h3_ref2v_veda_predictor.safetensors"
        : "minimax_h3_i2v_veda_predictor.safetensors";

    // Input names/types/defaults below match the pinned Veda upstream node's
    // own define_schema() exactly (veda_comfy/nodes.py @
    // 67e4eb5541b648555563144401ebaba832bd73ec, lines 137-189). There is no
    // `sparse_ratio` field in that schema; it was a fabricated placeholder.
    // Values here use only settings the node's own tooltips document as
    // always valid, not the private DEFAULT_BUDGET constant we don't have
    // audited source access to:
    //   - generated_sparsity: "trained" (defers to whatever the predictor
    //     declares, per its documented behavior)
    //   - reference_sparsity: "0%" (explicitly documented as "keeps full
    //     attention to and from" first/last/guide/reference frames — the
    //     most conservative, always-valid setting)
    //   - full_attention_layers / full_attention_steps: "" (documented
    //     default; empty means "all sparse")
    //   - verbose: false (documented default)
    const vedaInputs = {
      model: [unetLoaderId, 0] as [string, number],
      predictor: predictorName,
      generated_sparsity: "trained",
      reference_sparsity: "0%",
      full_attention_layers: "",
      full_attention_steps: "",
      verbose: false
    };

    const patchNode: ComfyNode = {
      inputs: vedaInputs,
      class_type: "VedaSparseAttention",
      _meta: {
        title: "Veda Sparse Attention"
      }
    };
    derived[patchNodeId] = patchNode;

    // Rewire BasicGuider (node 16) to receive model from the patch node
    if (derived[guiderNodeId]?.inputs) {
      derived[guiderNodeId].inputs.model = [patchNodeId, 0];
    }

    const patches: MinimaxH3AttentionPatchNode[] = [
      {
        nodeId: patchNodeId,
        classType: "VedaSparseAttention",
        inputs: vedaInputs
      }
    ];

    const topology: MinimaxH3AttentionTopology = {
      backend: "veda",
      patchCount: 1,
      patches,
      topologyDigest: computeAttentionTopologyDigest(patches)
    };

    return { graph: derived, patches, topology };
  }

  throw new Error(`Unsupported attention variant: "${attentionVariant}".`);
}

export function validateAttentionTopology(
  rawGraph: Record<string, unknown>,
  options: {
    expectedVariant: MinimaxH3AttentionVariantName;
    route: "i2v" | "ref2v";
    argv?: readonly string[];
    env?: Record<string, string>;
  }
): {
  valid: boolean;
  errors: string[];
  topology: MinimaxH3AttentionTopology;
} {
  const graph = rawGraph as Record<string, ComfyNode>;
  const { expectedVariant, route, argv = [], env = {} } = options;
  const errors: string[] = [];

  const unetLoaderId = "6";
  const schedulerNodeId = "9";
  const samplerNodeId = "14";
  const guiderNodeId = "16";
  const i2vConditioningNodeId = "104";
  const ref2vConditioningNodeId = "105";

  // 1. Mandatory core node presence check (reject empty/severely broken graphs)
  if (Object.keys(graph).length === 0) {
    errors.push("Workflow graph is empty (contains 0 nodes).");
  }

  const requiredNodeIds = [unetLoaderId, schedulerNodeId, samplerNodeId, guiderNodeId];
  for (const id of requiredNodeIds) {
    if (!graph[id]) {
      errors.push(`Required pipeline node ${id} is missing from the workflow graph.`);
    } else if (!graph[id]?.inputs || Object.keys(graph[id]?.inputs ?? {}).length === 0) {
      errors.push(`Required pipeline node ${id} has missing or empty inputs.`);
    }
  }

  if (route === "i2v") {
    if (!graph[i2vConditioningNodeId]) {
      errors.push(
        `Route 'i2v' requires MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) to be present in graph.`
      );
    } else if (!graph[i2vConditioningNodeId]?.inputs) {
      errors.push(`MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) has missing inputs.`);
    }
    if (!graph["20"]) {
      errors.push(
        `Route 'i2v' requires LoadImage (node 20) for first_frame to be present in graph.`
      );
    }
  } else {
    if (!graph[ref2vConditioningNodeId]) {
      errors.push(
        `Route 'ref2v' requires MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}) to be present in graph.`
      );
    } else if (!graph[ref2vConditioningNodeId]?.inputs) {
      errors.push(
        `MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}) has missing inputs.`
      );
    }
  }

  // 2. Scheduler and Sampler wiring integrity
  if (graph[schedulerNodeId]) {
    const schedModel = graph[schedulerNodeId]?.inputs?.model;
    if (!Array.isArray(schedModel) || schedModel[0] !== unetLoaderId || schedModel[1] !== 0) {
      errors.push(
        `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got: ${JSON.stringify(schedModel)}.`
      );
    }
  }

  if (graph[samplerNodeId]) {
    const guiderConn = graph[samplerNodeId]?.inputs?.guider;
    if (!Array.isArray(guiderConn) || guiderConn[0] !== guiderNodeId || guiderConn[1] !== 0) {
      errors.push(
        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'guider' must connect to BasicGuider (node ${guiderNodeId}) slot 0, got: ${JSON.stringify(guiderConn)}.`
      );
    }
    const sigmasConn = graph[samplerNodeId]?.inputs?.sigmas;
    if (!Array.isArray(sigmasConn) || sigmasConn[0] !== schedulerNodeId || sigmasConn[1] !== 0) {
      errors.push(
        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'sigmas' must connect to BasicScheduler (node ${schedulerNodeId}) slot 0, got: ${JSON.stringify(sigmasConn)}.`
      );
    }
    const expectedCondId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
    const latentConn = graph[samplerNodeId]?.inputs?.latent_image;
    if (!Array.isArray(latentConn) || latentConn[0] !== expectedCondId || latentConn[1] !== 1) {
      errors.push(
        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'latent_image' must connect to node ${expectedCondId} slot 1, got: ${JSON.stringify(latentConn)}.`
      );
    }
  }

  // 3. Inventory all sparse attention patch nodes in the graph
  const sparseNodes: Array<{ id: string; node: ComfyNode; classType: string }> = [];
  const knownSparseClasses = new Set([
    "ModelSparseAttention",
    "ModelSparseAttentionAV",
    "VedaSparseAttention"
  ]);

  for (const [id, node] of Object.entries(graph)) {
    if (node.class_type) {
      if (knownSparseClasses.has(node.class_type)) {
        sparseNodes.push({ id, node, classType: node.class_type });
      } else if (
        /attention|attn/i.test(node.class_type) &&
        !node.class_type.startsWith("MiniMax")
      ) {
        errors.push(
          `Unrecognized attention patch node class "${node.class_type}" (node ${id}) found in workflow graph.`
        );
      }
    }
  }

  // Check mutual exclusivity: Veda + Native Sol-Attn must NEVER be stacked
  const hasNative = sparseNodes.some(
    (n) => n.classType === "ModelSparseAttention" || n.classType === "ModelSparseAttentionAV"
  );
  const hasVeda = sparseNodes.some((n) => n.classType === "VedaSparseAttention");
  if (hasNative && hasVeda) {
    errors.push(
      "Incompatible sparse patches stacked: Native ModelSparseAttention and VedaSparseAttention must not be stacked in the same graph."
    );
  }

  // At most ONE sparse patch node permitted in any graph
  if (sparseNodes.length > 1) {
    errors.push(
      `Multiple sparse attention patch nodes found in graph (found ${sparseNodes.length}). At most 1 sparse patch is permitted.`
    );
  }

  // Sage flag + sparse patch node combination forbidden
  const hasSageArg = argv.includes("--use-sage-attention");
  if (hasSageArg && sparseNodes.length > 0) {
    errors.push(
      "SageAttention flag (--use-sage-attention) cannot be combined with sparse attention patch nodes in the same graph."
    );
  }

  // Check conflicting argv or env attention overrides
  const CONFLICTING_ATTN_FLAGS = [
    "--use-split-cross-attention",
    "--use-quad-cross-attention",
    "--use-pytorch-cross-attention",
    "--disable-fast-video",
    "--use-flash-attention",
    "--use-flash-attn"
  ];
  for (const flag of CONFLICTING_ATTN_FLAGS) {
    if (argv.includes(flag)) {
      errors.push(`Conflicting attention argv flag detected: "${flag}".`);
    }
  }

  // Reject ANY other unknown attention flag in argv
  for (const arg of argv) {
    if (
      /^--(use|disable|enable)-.*(attn|attention)/i.test(arg) &&
      arg !== "--use-sage-attention" &&
      !CONFLICTING_ATTN_FLAGS.includes(arg)
    ) {
      errors.push(`Unknown or conflicting attention argv flag detected: "${arg}".`);
    }
  }

  // Environment variables
  const recognizedEnvVars = new Set([
    "COMFYUI_ATTENTION_BACKEND",
    "TORCH_ATTENTION_BACKEND",
    "PYTORCH_ATTENTION_BACKEND"
  ]);
  for (const [envKey, envVal] of Object.entries(env)) {
    if (/attention|attn/i.test(envKey)) {
      if (recognizedEnvVars.has(envKey)) {
        if (envVal !== expectedVariant) {
          errors.push(`Conflicting ${envKey} environment variable: "${envVal}".`);
        }
      } else {
        errors.push(
          `Unknown or conflicting attention environment variable detected: "${envKey}=${envVal}".`
        );
      }
    }
  }

  // 4. Validate against expected variant
  const patches: MinimaxH3AttentionPatchNode[] = [];

  if (expectedVariant === "dense") {
    if (sparseNodes.length > 0) {
      errors.push(
        `Variant "dense" requires 0 attention patch nodes, found ${sparseNodes.length} (${sparseNodes.map((s) => s.classType).join(", ")}).`
      );
    }
    if (hasSageArg) {
      errors.push('Variant "dense" forbids --use-sage-attention flag.');
    }
    if (graph[guiderNodeId]) {
      const guiderModelConn = graph[guiderNodeId]?.inputs?.model;
      if (
        !Array.isArray(guiderModelConn) ||
        guiderModelConn[0] !== unetLoaderId ||
        guiderModelConn[1] !== 0
      ) {
        errors.push(
          `Variant "dense" requires BasicGuider (node ${guiderNodeId}) to connect directly to UNETLoader (node ${unetLoaderId}), got: ${JSON.stringify(guiderModelConn)}.`
        );
      }
    }
  } else if (expectedVariant === "sage") {
    if (sparseNodes.length > 0) {
      errors.push(
        `Variant "sage" requires 0 graph patch nodes (enabled via CLI flag), found ${sparseNodes.length}.`
      );
    }
    if (!hasSageArg) {
      errors.push('Variant "sage" requires --use-sage-attention in runner argv.');
    }
    if (graph[guiderNodeId]) {
      const guiderModelConn = graph[guiderNodeId]?.inputs?.model;
      if (
        !Array.isArray(guiderModelConn) ||
        guiderModelConn[0] !== unetLoaderId ||
        guiderModelConn[1] !== 0
      ) {
        errors.push(
          `Variant "sage" requires BasicGuider (node ${guiderNodeId}) to connect directly to UNETLoader (node ${unetLoaderId}), got: ${JSON.stringify(guiderModelConn)}.`
        );
      }
    }
  } else if (expectedVariant === "native-sol-attn") {
    if (hasSageArg) {
      errors.push('Variant "native-sol-attn" forbids --use-sage-attention flag.');
    }
    if (sparseNodes.length !== 1 || sparseNodes[0]!.classType !== "ModelSparseAttention") {
      errors.push(
        `Variant "native-sol-attn" requires exactly 1 ModelSparseAttention node, found ${sparseNodes.length}.`
      );
    } else {
      const p = sparseNodes[0]!;
      const patchModelInput = p.node.inputs?.model;
      if (
        !Array.isArray(patchModelInput) ||
        patchModelInput[0] !== unetLoaderId ||
        patchModelInput[1] !== 0
      ) {
        errors.push(
          `ModelSparseAttention (node ${p.id}) input 'model' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got: ${JSON.stringify(patchModelInput)}.`
        );
      }

      const guiderModelConn = graph[guiderNodeId]?.inputs?.model;
      if (
        !Array.isArray(guiderModelConn) ||
        guiderModelConn[0] !== p.id ||
        guiderModelConn[1] !== 0
      ) {
        errors.push(
          `BasicGuider (node ${guiderNodeId}) input 'model' must connect to ModelSparseAttention (node ${p.id}) slot 0 (detected disconnected/bypassed patch), got: ${JSON.stringify(guiderModelConn)}.`
        );
      }

      if (p.node.inputs?.sparse_type !== "sol-attn") {
        errors.push(
          `ModelSparseAttention (node ${p.id}) input 'sparse_type' must be 'sol-attn', got: ${JSON.stringify(p.node.inputs?.sparse_type)}.`
        );
      }

      patches.push({
        nodeId: p.id,
        classType: p.classType,
        inputs: (p.node.inputs as Record<string, unknown>) ?? {}
      });
    }
  } else if (expectedVariant === "veda") {
    if (hasSageArg) {
      errors.push('Variant "veda" forbids --use-sage-attention flag.');
    }
    if (sparseNodes.length !== 1 || sparseNodes[0]!.classType !== "VedaSparseAttention") {
      errors.push(
        `Variant "veda" requires exactly 1 VedaSparseAttention node, found ${sparseNodes.length}.`
      );
    } else {
      const p = sparseNodes[0]!;
      const patchModelInput = p.node.inputs?.model;
      if (
        !Array.isArray(patchModelInput) ||
        patchModelInput[0] !== unetLoaderId ||
        patchModelInput[1] !== 0
      ) {
        errors.push(
          `VedaSparseAttention (node ${p.id}) input 'model' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got: ${JSON.stringify(patchModelInput)}.`
        );
      }

      const guiderModelConn = graph[guiderNodeId]?.inputs?.model;
      if (
        !Array.isArray(guiderModelConn) ||
        guiderModelConn[0] !== p.id ||
        guiderModelConn[1] !== 0
      ) {
        errors.push(
          `BasicGuider (node ${guiderNodeId}) input 'model' must connect to VedaSparseAttention (node ${p.id}) slot 0 (detected disconnected/bypassed patch), got: ${JSON.stringify(guiderModelConn)}.`
        );
      }

      if (!p.node.inputs?.predictor) {
        errors.push(`VedaSparseAttention (node ${p.id}) is missing required input 'predictor'.`);
      }
      // Required-input names match the pinned Veda upstream node's own
      // define_schema() (veda_comfy/nodes.py @
      // 67e4eb5541b648555563144401ebaba832bd73ec, lines 137-189): there is
      // no `sparse_ratio` field in that schema.
      for (const requiredInput of [
        "generated_sparsity",
        "reference_sparsity",
        "full_attention_layers",
        "full_attention_steps",
        "verbose"
      ] as const) {
        if (p.node.inputs?.[requiredInput] === undefined) {
          errors.push(
            `VedaSparseAttention (node ${p.id}) is missing required input '${requiredInput}'.`
          );
        }
      }

      patches.push({
        nodeId: p.id,
        classType: p.classType,
        inputs: (p.node.inputs as Record<string, unknown>) ?? {}
      });
    }
  }

  // 5. Conditioning wiring preservation check
  if (graph[guiderNodeId]) {
    const guiderConditioning = graph[guiderNodeId]?.inputs?.conditioning;
    if (route === "i2v") {
      if (
        !Array.isArray(guiderConditioning) ||
        guiderConditioning[0] !== i2vConditioningNodeId ||
        guiderConditioning[1] !== 0
      ) {
        errors.push(
          `Route 'i2v' requires BasicGuider (node ${guiderNodeId}) conditioning from MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}), got: ${JSON.stringify(guiderConditioning)}.`
        );
      }
    } else {
      if (
        !Array.isArray(guiderConditioning) ||
        guiderConditioning[0] !== ref2vConditioningNodeId ||
        guiderConditioning[1] !== 0
      ) {
        errors.push(
          `Route 'ref2v' requires BasicGuider (node ${guiderNodeId}) conditioning from MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}), got: ${JSON.stringify(guiderConditioning)}.`
        );
      }
    }
  }

  // 6. Route-specific asset input preservation
  if (route === "i2v") {
    if (graph[i2vConditioningNodeId]) {
      const firstFrameConn = graph[i2vConditioningNodeId]?.inputs?.first_frame;
      if (!Array.isArray(firstFrameConn) || firstFrameConn[0] !== "20" || firstFrameConn[1] !== 0) {
        errors.push(
          `Route 'i2v' requires MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) input 'first_frame' to connect to LoadImage (node 20) slot 0, got: ${JSON.stringify(firstFrameConn)}.`
        );
      }
      if (graph["20"]) {
        const node20 = graph["20"];
        if (node20.class_type !== "LoadImage") {
          errors.push(
            `Route 'i2v' first_frame node 20 must be class_type 'LoadImage', got '${node20.class_type}'.`
          );
        }
        if (!node20.inputs?.image) {
          errors.push("Route 'i2v' first_frame node 20 is missing required 'image' input.");
        }
      }
      const lastFrameConn = graph[i2vConditioningNodeId]?.inputs?.last_frame;
      if (lastFrameConn !== undefined && lastFrameConn !== null) {
        if (
          !Array.isArray(lastFrameConn) ||
          typeof lastFrameConn[0] !== "string" ||
          lastFrameConn[1] !== 0
        ) {
          errors.push(
            `Route 'i2v' MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) input 'last_frame' must connect to valid node slot 0, got: ${JSON.stringify(lastFrameConn)}.`
          );
        }
      }
    }
  } else if (route === "ref2v") {
    if (graph[ref2vConditioningNodeId]) {
      const inputs = graph[ref2vConditioningNodeId]?.inputs ?? {};
      const refKeys = Object.keys(inputs).filter((k) => /^ref_images\.ref_image_\d+$/.test(k));
      if (refKeys.length === 0) {
        errors.push(
          `Route 'ref2v' requires at least 1 flattened 'ref_images.ref_image_N' input on MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}).`
        );
      } else {
        const slotIndices = refKeys
          .map((k) => parseInt(k.replace("ref_images.ref_image_", ""), 10))
          .sort((a, b) => a - b);

        if (slotIndices[0] !== 0) {
          errors.push(
            `Route 'ref2v' reference slots must start at index 0 (found starting index ${slotIndices[0]}).`
          );
        }

        for (let i = 0; i < slotIndices.length; i++) {
          if (slotIndices[i] !== i) {
            errors.push(
              `Route 'ref2v' flattened reference slots must be contiguous without gaps (expected index ${i}, got ${slotIndices[i]}).`
            );
            break;
          }
          if (slotIndices[i]! > 8) {
            errors.push(
              `Route 'ref2v' allows at most 9 reference images (slot indices 0-8), found index ${slotIndices[i]}.`
            );
          }
        }

        for (const key of refKeys) {
          const slotIdx = parseInt(key.replace("ref_images.ref_image_", ""), 10);
          const expectedNodeId = String(201 + slotIdx);
          const conn = inputs[key];
          if (!Array.isArray(conn) || conn[0] !== expectedNodeId || conn[1] !== 0) {
            errors.push(
              `Route 'ref2v' input '${key}' must connect to LoadImage (node ${expectedNodeId}) slot 0, got: ${JSON.stringify(conn)}.`
            );
          }
          const refNode = graph[expectedNodeId];
          if (!refNode) {
            errors.push(
              `Route 'ref2v' requires LoadImage (node ${expectedNodeId}) to be present in graph for input '${key}'.`
            );
          } else {
            if (refNode.class_type !== "LoadImage") {
              errors.push(
                `Route 'ref2v' reference node ${expectedNodeId} must be class_type 'LoadImage', got '${refNode.class_type}'.`
              );
            }
            if (!refNode.inputs?.image) {
              errors.push(
                `Route 'ref2v' reference node ${expectedNodeId} is missing required 'image' input.`
              );
            }
          }
        }
      }
    }
  }

  // 7. Cycle detection in model chain
  const visited = new Set<string>();
  let curr: string | undefined = guiderNodeId;
  while (curr && graph[curr]?.inputs?.model) {
    if (visited.has(curr)) {
      errors.push(`Cycle detected in model graph starting at node "${curr}".`);
      break;
    }
    visited.add(curr);
    const m: unknown = graph[curr]!.inputs!.model;
    if (Array.isArray(m) && typeof m[0] === "string") {
      curr = m[0];
    } else {
      break;
    }
  }

  const backendName =
    expectedVariant === "sage"
      ? "sage"
      : expectedVariant === "native-sol-attn"
        ? "sol_attn"
        : expectedVariant === "veda"
          ? "veda"
          : "torch_sdpa";

  const topology: MinimaxH3AttentionTopology = {
    backend: backendName,
    patchCount: patches.length,
    patches,
    topologyDigest: computeAttentionTopologyDigest(patches)
  };

  return {
    valid: errors.length === 0,
    errors,
    topology
  };
}
