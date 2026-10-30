import {
  computeTeaCacheTopologyDigest,
  TEACACHE_NODE_KEY,
  TEACACHE_PATCH_NODE_ID,
  MinimaxH3TeaCachePatchNodeInputsSchema,
  type MinimaxH3TeaCacheConfig,
  type MinimaxH3TeaCacheMode,
  type MinimaxH3TeaCachePatchNode
} from "@cco/contracts";
import type { ComfyNode } from "./minimax-h3-attention-topology.js";

export interface DeriveTeaCacheGraphOptions {
  baseWorkflow: Record<string, unknown>;
  route: "i2v" | "ref2v";
  config: MinimaxH3TeaCacheConfig;
}

export interface DerivedTeaCacheResult {
  graph: Record<string, unknown>;
  patchNode: MinimaxH3TeaCachePatchNode | null;
  topologyDigest: string;
}

export function deriveTeaCacheGraph(options: DeriveTeaCacheGraphOptions): DerivedTeaCacheResult {
  const { baseWorkflow, config } = options;

  const derived = JSON.parse(JSON.stringify(baseWorkflow)) as Record<string, ComfyNode>;

  const unetNodeId = "6";
  const schedulerNodeId = "9";
  const guiderNodeId = "16";
  const patchNodeId = TEACACHE_PATCH_NODE_ID;

  if (!derived[unetNodeId]) {
    throw new Error(`Base graph is missing required UNETLoader node (id: "${unetNodeId}")`);
  }
  if (!derived[schedulerNodeId]) {
    throw new Error(
      `Base graph is missing required BasicScheduler node (id: "${schedulerNodeId}")`
    );
  }
  if (!derived[guiderNodeId]) {
    throw new Error(`Base graph is missing required BasicGuider node (id: "${guiderNodeId}")`);
  }

  if (config.mode === "raw-l1-v1") {
    // Collision check: patchNodeId must not collide with base workflow unless it was already a TeaCache patch
    if (derived[patchNodeId] && derived[patchNodeId].class_type !== TEACACHE_NODE_KEY) {
      throw new Error(
        `Node ID collision: node "${patchNodeId}" already exists in graph with class "${derived[patchNodeId].class_type}".`
      );
    }

    const patchNode: MinimaxH3TeaCachePatchNode = {
      nodeId: patchNodeId,
      classType: TEACACHE_NODE_KEY,
      inputs: {
        model: [unetNodeId, 0],
        rel_l1_thresh: config.relL1Thresh,
        start_step: config.startStep,
        end_step: config.endStep,
        total_steps: 20
      }
    };

    derived[patchNodeId] = {
      inputs: {
        model: [unetNodeId, 0],
        rel_l1_thresh: config.relL1Thresh,
        start_step: config.startStep,
        end_step: config.endStep,
        total_steps: 20
      },
      class_type: TEACACHE_NODE_KEY,
      _meta: {
        title: "MiniMax-H3 TeaCache (Experimental)"
      }
    };

    if (!derived[schedulerNodeId].inputs) {
      derived[schedulerNodeId].inputs = {};
    }
    derived[schedulerNodeId].inputs.model = [patchNodeId, 0];

    if (!derived[guiderNodeId].inputs) {
      derived[guiderNodeId].inputs = {};
    }
    derived[guiderNodeId].inputs.model = [patchNodeId, 0];

    // Remove any incompatible patch nodes
    delete derived["301"];
    delete derived["302"];
    delete derived["303"];

    const topologyDigest = computeTeaCacheTopologyDigest(patchNode);
    return { graph: derived, patchNode, topologyDigest };
  } else {
    // Cache off / matched control: direct UNETLoader wiring
    if (!derived[schedulerNodeId].inputs) {
      derived[schedulerNodeId].inputs = {};
    }
    derived[schedulerNodeId].inputs.model = [unetNodeId, 0];

    if (!derived[guiderNodeId].inputs) {
      derived[guiderNodeId].inputs = {};
    }
    derived[guiderNodeId].inputs.model = [unetNodeId, 0];

    delete derived[patchNodeId];
    delete derived["301"];
    delete derived["302"];
    delete derived["303"];

    const topologyDigest = computeTeaCacheTopologyDigest(null);
    return { graph: derived, patchNode: null, topologyDigest };
  }
}

export interface ValidateTeaCacheTopologyOptions {
  expectedMode: MinimaxH3TeaCacheMode;
  route: "i2v" | "ref2v";
  expectedConfig?: MinimaxH3TeaCacheConfig | null | undefined;
}

export function validateTeaCacheTopology(
  rawGraph: Record<string, unknown>,
  options: ValidateTeaCacheTopologyOptions
): {
  valid: boolean;
  errors: string[];
  topologyDigest: string;
} {
  const graph = rawGraph as Record<string, ComfyNode>;
  const { expectedMode, route, expectedConfig } = options;
  const errors: string[] = [];

  const unetLoaderId = "6";
  const schedulerNodeId = "9";
  const samplerNodeId = "14";
  const guiderNodeId = "16";
  const patchNodeId = TEACACHE_PATCH_NODE_ID;
  const i2vConditioningNodeId = "104";
  const ref2vConditioningNodeId = "105";

  if (Object.keys(graph).length === 0) {
    errors.push("Workflow graph is empty (contains 0 nodes).");
  }

  // Scan ALL nodes for unauthorized optimizers, patches, LoRAs, or duplicate samplers
  const FORBIDDEN_CLASS_TYPES = new Set([
    "LoraLoader",
    "LoraLoaderModelOnly",
    "ModelAttentionBackend",
    "BlockSparseAttention",
    "ModelSparseAttention",
    "VedaSparseAttention",
    "MiniMaxH3SigmaShift"
  ]);

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node?.class_type ?? "";
    if (
      FORBIDDEN_CLASS_TYPES.has(classType) ||
      classType.includes("Lora") ||
      classType.includes("LoRA")
    ) {
      errors.push(
        `Unauthorized optimization/LoRA node "${nodeId}" (${classType}) detected in graph. TeaCache must be strictly isolated.`
      );
    }
    if (classType.includes("TeaCache") || classType === TEACACHE_NODE_KEY) {
      if (expectedMode === "off") {
        errors.push(
          `TeaCache patch node "${nodeId}" (${classType}) must not be present when TeaCache is disabled (mode: 'off').`
        );
      } else if (nodeId !== patchNodeId) {
        errors.push(
          `Unauthorized duplicate or misplaced TeaCache node "${nodeId}" (${classType}) detected. Only node "${patchNodeId}" is authorized.`
        );
      }
    }
    if (classType.includes("SparseAttention") || classType.includes("AttentionBackend")) {
      errors.push(
        `Unauthorized attention optimization node "${nodeId}" (${classType}) detected. TeaCache requires dense attention.`
      );
    }
    if (
      classType === "SamplerCustomAdvanced" ||
      classType === "KSampler" ||
      classType === "KSamplerAdvanced"
    ) {
      if (nodeId !== samplerNodeId) {
        errors.push(
          `Unauthorized duplicate or misplaced sampler node "${nodeId}" (${classType}) detected. Only node "${samplerNodeId}" is authorized.`
        );
      }
    }
  }

  const requiredNodeIds = [unetLoaderId, schedulerNodeId, samplerNodeId, guiderNodeId];
  for (const id of requiredNodeIds) {
    if (!graph[id]) {
      errors.push(`Required pipeline node ${id} is missing from workflow graph.`);
    } else if (!graph[id]?.inputs || Object.keys(graph[id]?.inputs ?? {}).length === 0) {
      errors.push(`Required pipeline node ${id} has missing or empty inputs.`);
    }
  }

  // UNETLoader invariant: checkpoint filename
  if (graph[unetLoaderId]) {
    const unetName = graph[unetLoaderId]?.inputs?.unet_name;
    const expectedUnetName = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
    if (unetName !== expectedUnetName) {
      errors.push(
        `UNETLoader (node ${unetLoaderId}) input 'unet_name' must be "${expectedUnetName}", got "${unetName}".`
      );
    }
  }

  // BasicScheduler invariants: steps === 20, scheduler === "simple", denoise === 1
  if (graph[schedulerNodeId]) {
    const schedInputs = graph[schedulerNodeId]?.inputs;
    if (schedInputs?.steps !== 20) {
      errors.push(
        `BasicScheduler (node ${schedulerNodeId}) input 'steps' must be 20, got ${schedInputs?.steps}.`
      );
    }
    if (schedInputs?.scheduler !== "simple") {
      errors.push(
        `BasicScheduler (node ${schedulerNodeId}) input 'scheduler' must be "simple", got "${schedInputs?.scheduler}".`
      );
    }
    if (schedInputs?.denoise !== 1) {
      errors.push(
        `BasicScheduler (node ${schedulerNodeId}) input 'denoise' must be 1, got ${schedInputs?.denoise}.`
      );
    }
  }

  // BasicGuider invariant: conditioning input connection
  if (graph[guiderNodeId]) {
    const expectedCondNodeId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
    const condConn = graph[guiderNodeId]?.inputs?.conditioning;
    if (!Array.isArray(condConn) || condConn[0] !== expectedCondNodeId || condConn[1] !== 0) {
      errors.push(
        `BasicGuider (node ${guiderNodeId}) input 'conditioning' must connect to node ${expectedCondNodeId} slot 0, got ${JSON.stringify(condConn)}.`
      );
    }
  }

  if (route === "i2v") {
    if (!graph[i2vConditioningNodeId]) {
      errors.push(
        `Route 'i2v' requires MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) to be present in graph.`
      );
    }
    if (!graph["20"]) {
      errors.push(
        `Route 'i2v' requires LoadImage (node 20) for first_frame to be present in graph.`
      );
    } else if (graph[i2vConditioningNodeId]) {
      const imgConn = graph[i2vConditioningNodeId]?.inputs?.first_frame;
      if (!Array.isArray(imgConn) || imgConn[0] !== "20" || imgConn[1] !== 0) {
        errors.push(
          `MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) input 'first_frame' must connect to LoadImage (node 20) slot 0, got ${JSON.stringify(imgConn)}.`
        );
      }
    }
  } else {
    if (!graph[ref2vConditioningNodeId]) {
      errors.push(
        `Route 'ref2v' requires MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}) to be present in graph.`
      );
    } else {
      const node105 = graph[ref2vConditioningNodeId];
      if (node105?.inputs) {
        for (const [key, val] of Object.entries(node105.inputs)) {
          if (key.startsWith("ref_images.") && Array.isArray(val) && typeof val[0] === "string") {
            const refNodeId = val[0];
            const refNode = graph[refNodeId];
            if (!refNode) {
              errors.push(
                `MiniMaxH3ReferenceToVideo input '${key}' connects to missing node "${refNodeId}".`
              );
            } else if (refNode.class_type !== "LoadImage") {
              errors.push(
                `MiniMaxH3ReferenceToVideo input '${key}' must connect to LoadImage, got "${refNode.class_type}" on node "${refNodeId}".`
              );
            }
          }
        }
      }
    }
  }

  // Sampler Custom Advanced checks
  if (graph[samplerNodeId]) {
    const guiderConn = graph[samplerNodeId]?.inputs?.guider;
    if (!Array.isArray(guiderConn) || guiderConn[0] !== guiderNodeId || guiderConn[1] !== 0) {
      errors.push(
        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'guider' must connect to BasicGuider (node ${guiderNodeId}) slot 0.`
      );
    }
    const sigmasConn = graph[samplerNodeId]?.inputs?.sigmas;
    if (!Array.isArray(sigmasConn) || sigmasConn[0] !== schedulerNodeId || sigmasConn[1] !== 0) {
      errors.push(
        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'sigmas' must connect to BasicScheduler (node ${schedulerNodeId}) slot 0.`
      );
    }
    const expectedCondId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
    const latentConn = graph[samplerNodeId]?.inputs?.latent_image;
    if (!Array.isArray(latentConn) || latentConn[0] !== expectedCondId || latentConn[1] !== 1) {
      errors.push(
        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'latent_image' must connect to node ${expectedCondId} slot 1.`
      );
    }
  }

  if (expectedMode === "raw-l1-v1") {
    const patch = graph[patchNodeId];
    if (!patch) {
      errors.push(`TeaCache patch node (node ${patchNodeId}) is missing from graph.`);
    } else {
      if (patch.class_type !== TEACACHE_NODE_KEY) {
        errors.push(
          `TeaCache patch node ${patchNodeId} class_type must be "${TEACACHE_NODE_KEY}", got "${patch.class_type}".`
        );
      }
      const modelConn = patch.inputs?.model;
      if (!Array.isArray(modelConn) || modelConn[0] !== unetLoaderId || modelConn[1] !== 0) {
        errors.push(
          `TeaCache patch node ${patchNodeId} input 'model' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got ${JSON.stringify(modelConn)}.`
        );
      }
      if (patch.inputs) {
        const schemaRes = MinimaxH3TeaCachePatchNodeInputsSchema.safeParse(patch.inputs);
        if (!schemaRes.success) {
          errors.push(
            `TeaCache patch node ${patchNodeId} inputs failed schema validation: ${schemaRes.error.message}`
          );
        }
      } else {
        errors.push(`TeaCache patch node ${patchNodeId} has missing or empty inputs.`);
      }
      if (expectedConfig) {
        if (patch.inputs?.rel_l1_thresh !== expectedConfig.relL1Thresh) {
          errors.push(
            `TeaCache patch node rel_l1_thresh mismatch: expected ${expectedConfig.relL1Thresh}, got ${patch.inputs?.rel_l1_thresh}.`
          );
        }
        if (patch.inputs?.start_step !== expectedConfig.startStep) {
          errors.push(
            `TeaCache patch node start_step mismatch: expected ${expectedConfig.startStep}, got ${patch.inputs?.start_step}.`
          );
        }
        if (patch.inputs?.end_step !== expectedConfig.endStep) {
          errors.push(
            `TeaCache patch node end_step mismatch: expected ${expectedConfig.endStep}, got ${patch.inputs?.end_step}.`
          );
        }
        if (patch.inputs?.total_steps !== 20) {
          errors.push(
            `TeaCache patch node total_steps mismatch: expected 20, got ${patch.inputs?.total_steps}.`
          );
        }
      }
    }

    // BasicGuider and BasicScheduler must both connect to patchNodeId slot 0
    if (graph[guiderNodeId]) {
      const guiderModel = graph[guiderNodeId]?.inputs?.model;
      if (!Array.isArray(guiderModel) || guiderModel[0] !== patchNodeId || guiderModel[1] !== 0) {
        errors.push(
          `BasicGuider (node ${guiderNodeId}) input 'model' must connect to TeaCache (node ${patchNodeId}) slot 0, got ${JSON.stringify(guiderModel)}.`
        );
      }
    }
    if (graph[schedulerNodeId]) {
      const schedModel = graph[schedulerNodeId]?.inputs?.model;
      if (!Array.isArray(schedModel) || schedModel[0] !== patchNodeId || schedModel[1] !== 0) {
        errors.push(
          `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect to TeaCache (node ${patchNodeId}) slot 0, got ${JSON.stringify(schedModel)}.`
        );
      }
    }

    // Reject extraneous patch nodes
    for (const badId of ["301", "302", "303"]) {
      if (graph[badId]) {
        errors.push(
          `Extraneous optimization patch node ${badId} (${graph[badId].class_type}) detected. TeaCache must be strictly isolated.`
        );
      }
    }
  } else {
    // Mode off: direct connections to node 6
    for (const badId of ["301", "302", "303", patchNodeId]) {
      if (graph[badId]) {
        errors.push(
          `Extraneous optimization patch node ${badId} (${graph[badId].class_type}) detected. Mode 'off' must not contain optimization nodes.`
        );
      }
    }
    if (graph[guiderNodeId]) {
      const guiderModel = graph[guiderNodeId]?.inputs?.model;
      if (!Array.isArray(guiderModel) || guiderModel[0] !== unetLoaderId || guiderModel[1] !== 0) {
        errors.push(
          `BasicGuider (node ${guiderNodeId}) input 'model' must connect directly to UNETLoader (node ${unetLoaderId}) slot 0 when caching is off, got ${JSON.stringify(guiderModel)}.`
        );
      }
    }
    if (graph[schedulerNodeId]) {
      const schedModel = graph[schedulerNodeId]?.inputs?.model;
      if (!Array.isArray(schedModel) || schedModel[0] !== unetLoaderId || schedModel[1] !== 0) {
        errors.push(
          `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect directly to UNETLoader (node ${unetLoaderId}) slot 0 when caching is off, got ${JSON.stringify(schedModel)}.`
        );
      }
    }
  }

  // Model-chain cycle check and path validation
  function checkModelChain(startNodeId: string, visited: Set<string>): boolean {
    if (visited.has(startNodeId)) return false; // cycle
    visited.add(startNodeId);
    if (startNodeId === unetLoaderId) return true;
    const node = graph[startNodeId];
    if (!node || !node.inputs) return false;
    const modelConn = node.inputs.model;
    if (!Array.isArray(modelConn) || typeof modelConn[0] !== "string") return false;
    return checkModelChain(modelConn[0], new Set(visited));
  }
  if (graph[guiderNodeId] && !checkModelChain(guiderNodeId, new Set())) {
    errors.push(
      `BasicGuider (node ${guiderNodeId}) model chain contains a cycle or does not terminate at UNETLoader.`
    );
  }
  if (graph[schedulerNodeId] && !checkModelChain(schedulerNodeId, new Set())) {
    errors.push(
      `BasicScheduler (node ${schedulerNodeId}) model chain contains a cycle or does not terminate at UNETLoader.`
    );
  }

  let patchNode: MinimaxH3TeaCachePatchNode | null = null;
  const patch = graph[patchNodeId];
  if (expectedMode === "raw-l1-v1" && patch) {
    if (patch.class_type === TEACACHE_NODE_KEY && patch.inputs) {
      const parsedInputs = MinimaxH3TeaCachePatchNodeInputsSchema.safeParse(patch.inputs);
      if (parsedInputs.success) {
        patchNode = {
          nodeId: patchNodeId,
          classType: TEACACHE_NODE_KEY,
          inputs: parsedInputs.data
        };
      } else {
        errors.push(
          `TeaCache patch node ${patchNodeId} inputs failed schema validation: ${parsedInputs.error.message}`
        );
      }
    }
  }
  const topologyDigest = computeTeaCacheTopologyDigest(patchNode);

  return {
    valid: errors.length === 0,
    errors,
    topologyDigest
  };
}
