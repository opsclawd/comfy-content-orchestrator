import type { MinimaxH3SamplingRecipe } from "@cco/contracts";
import {
  validateRecipeRouteCompatibility,
  getSamplingRecipe
} from "./minimax-h3-step-reduction-catalog.js";
import type { ComfyNode } from "./minimax-h3-attention-topology.js";

export interface ApplySamplingRecipeOptions {
  baseWorkflow: Record<string, unknown>;
  recipe: MinimaxH3SamplingRecipe;
  route: "i2v" | "ref2v";
}

export interface RecipeTopologyValidationResult {
  valid: boolean;
  errors: string[];
}

export function applySamplingRecipeToGraph(
  options: ApplySamplingRecipeOptions
): Record<string, unknown> {
  const { baseWorkflow, recipe: suppliedRecipe, route } = options;

  // Validate route compatibility (throws if route is incompatible)
  validateRecipeRouteCompatibility(suppliedRecipe.name, route);
  const recipe = getSamplingRecipe(suppliedRecipe.name, route);
  if (suppliedRecipe.recipeDigest !== recipe.recipeDigest) {
    throw new Error(
      `Supplied recipe digest (${suppliedRecipe.recipeDigest}) does not match authoritative catalog recipe (${recipe.recipeDigest}) for "${suppliedRecipe.name}"`
    );
  }
  if (suppliedRecipe.recipeVersion !== recipe.recipeVersion) {
    throw new Error(
      `Supplied recipe recipeVersion does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }
  if (suppliedRecipe.compatibleRoute !== recipe.compatibleRoute) {
    throw new Error(
      `Supplied recipe compatibleRoute does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }
  if (
    suppliedRecipe.diffusionModel.filename !== recipe.diffusionModel.filename ||
    suppliedRecipe.diffusionModel.sha256 !== recipe.diffusionModel.sha256
  ) {
    throw new Error(
      `Supplied recipe diffusion model does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }
  if (suppliedRecipe.expectedSteps !== recipe.expectedSteps) {
    throw new Error(
      `Supplied recipe expectedSteps does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }
  if (
    suppliedRecipe.sampler !== recipe.sampler ||
    suppliedRecipe.scheduler !== recipe.scheduler ||
    suppliedRecipe.denoise !== recipe.denoise
  ) {
    throw new Error(
      `Supplied recipe sampler/scheduler/denoise does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }
  if (recipe.lora) {
    if (
      !suppliedRecipe.lora ||
      suppliedRecipe.lora.filename !== recipe.lora.filename ||
      suppliedRecipe.lora.sha256 !== recipe.lora.sha256 ||
      suppliedRecipe.lora.strengthModel !== recipe.lora.strengthModel
    ) {
      throw new Error(
        `Supplied recipe LoRA does not match authoritative catalog for "${suppliedRecipe.name}"`
      );
    }
  } else if (suppliedRecipe.lora) {
    throw new Error(`Supplied recipe LoRA must be null for "${suppliedRecipe.name}"`);
  }
  if (recipe.sigmaShift) {
    if (
      !suppliedRecipe.sigmaShift ||
      suppliedRecipe.sigmaShift.enabled !== recipe.sigmaShift.enabled ||
      suppliedRecipe.sigmaShift.videoShift !== recipe.sigmaShift.videoShift ||
      suppliedRecipe.sigmaShift.audioShift !== recipe.sigmaShift.audioShift
    ) {
      throw new Error(
        `Supplied recipe sigmaShift does not match authoritative catalog for "${suppliedRecipe.name}"`
      );
    }
  } else if (suppliedRecipe.sigmaShift) {
    throw new Error(`Supplied recipe sigmaShift must be null for "${suppliedRecipe.name}"`);
  }
  if (suppliedRecipe.conditioningMode !== recipe.conditioningMode) {
    throw new Error(
      `Supplied recipe conditioningMode does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }
  if (suppliedRecipe.requiredRuntimeRevision !== recipe.requiredRuntimeRevision) {
    throw new Error(
      `Supplied recipe requiredRuntimeRevision does not match authoritative catalog for "${suppliedRecipe.name}"`
    );
  }

  const derivedGraph = JSON.parse(JSON.stringify(baseWorkflow)) as Record<string, ComfyNode>;

  // 1. UNETLoader (node 6)
  const unetNodeId = "6";
  if (!derivedGraph[unetNodeId]) {
    throw new Error(`Base graph is missing required UNETLoader node (id: "${unetNodeId}")`);
  }
  if (!derivedGraph[unetNodeId].inputs) {
    derivedGraph[unetNodeId].inputs = {};
  }
  derivedGraph[unetNodeId].inputs.unet_name = recipe.diffusionModel.filename;

  // 2. BasicScheduler (node 9)
  const schedulerNodeId = "9";
  if (!derivedGraph[schedulerNodeId]) {
    throw new Error(
      `Base graph is missing required BasicScheduler node (id: "${schedulerNodeId}")`
    );
  }
  if (!derivedGraph[schedulerNodeId].inputs) {
    derivedGraph[schedulerNodeId].inputs = {};
  }
  derivedGraph[schedulerNodeId].inputs.steps = recipe.expectedSteps;
  derivedGraph[schedulerNodeId].inputs.scheduler = recipe.scheduler;
  derivedGraph[schedulerNodeId].inputs.denoise = recipe.denoise;

  // 3. Guider (node 16)
  const guiderNodeId = "16";
  if (!derivedGraph[guiderNodeId]) {
    throw new Error(`Base graph is missing required BasicGuider node (id: "${guiderNodeId}")`);
  }
  if (!derivedGraph[guiderNodeId].inputs) {
    derivedGraph[guiderNodeId].inputs = {};
  }

  // 4. Model Chain Adaptation
  if (recipe.lora) {
    // Turbo LoRA model chain:
    // UNET (6) -> LoraLoaderModelOnly (301) -> Scheduler (9) & Guider (16)
    const loraNodeId = "301";
    derivedGraph[loraNodeId] = {
      inputs: {
        model: [unetNodeId, 0],
        lora_name: recipe.lora.filename,
        strength_model: recipe.lora.strengthModel
      },
      class_type: "LoraLoaderModelOnly",
      _meta: {
        title: "Lora Loader (Model Only)"
      }
    };

    derivedGraph[schedulerNodeId].inputs.model = [loraNodeId, 0];
    derivedGraph[guiderNodeId].inputs.model = [loraNodeId, 0];

    // Clean up any other patch nodes
    delete derivedGraph["302"];
    delete derivedGraph["303"];
  } else if (recipe.name === "fasth3-i2v-8") {
    // FastH3 VSA model chain:
    // UNET (6) -> MiniMaxH3SigmaShift (301) -> ModelAttentionBackend (302) -> BlockSparseAttention (303) -> Scheduler (9) & Guider (16)
    const sigmaNodeId = "301";
    derivedGraph[sigmaNodeId] = {
      inputs: {
        model: [unetNodeId, 0],
        shift_video: recipe.sigmaShift?.videoShift ?? 10.0,
        shift_audio: recipe.sigmaShift?.audioShift ?? 3.0
      },
      class_type: "MiniMaxH3SigmaShift",
      _meta: {
        title: "MiniMax-H3 Sigma Shift"
      }
    };

    const attnBackendNodeId = "302";
    derivedGraph[attnBackendNodeId] = {
      inputs: {
        model: [sigmaNodeId, 0],
        attention: "comfy kitchen attention"
      },
      class_type: "ModelAttentionBackend",
      _meta: {
        title: "Model Attention Backend"
      }
    };

    const vsaNodeId = "303";
    derivedGraph[vsaNodeId] = {
      inputs: {
        model: [attnBackendNodeId, 0],
        selection: "vsa",
        "selection.keep_percent": 10,
        start_percent: 0.2,
        end_percent: 1.0,
        dense_blocks: "",
        min_tokens: 12288,
        extra_tokens: 256,
        sink_conditioning: "exact_kv_and_rows",
        verbose: false
      },
      class_type: "BlockSparseAttention",
      _meta: {
        title: "Block Sparse Attention"
      }
    };

    derivedGraph[schedulerNodeId].inputs.model = [vsaNodeId, 0];
    derivedGraph[guiderNodeId].inputs.model = [vsaNodeId, 0];
  } else {
    // Baseline model chain (canonical-base-20 and fl2va-base-20):
    // Direct UNET (6) -> Scheduler (9) & Guider (16)
    derivedGraph[schedulerNodeId].inputs.model = [unetNodeId, 0];
    derivedGraph[guiderNodeId].inputs.model = [unetNodeId, 0];

    delete derivedGraph["301"];
    delete derivedGraph["302"];
    delete derivedGraph["303"];
  }

  return derivedGraph;
}

export function validateSamplingRecipeTopology(
  graph: Record<string, unknown>,
  recipe: MinimaxH3SamplingRecipe,
  route: "i2v" | "ref2v"
): RecipeTopologyValidationResult {
  const errors: string[] = [];
  const typedGraph = graph as Record<string, ComfyNode>;

  // 1. Validate route compatibility and catalog match
  let canonicalRecipe: MinimaxH3SamplingRecipe;
  try {
    validateRecipeRouteCompatibility(recipe.name, route);
    canonicalRecipe = getSamplingRecipe(recipe.name, route);
  } catch (err) {
    errors.push((err as Error).message);
    return { valid: false, errors };
  }

  if (recipe.recipeDigest !== canonicalRecipe.recipeDigest) {
    errors.push(
      `Recipe digest mismatch with authoritative catalog for "${recipe.name}": expected ${canonicalRecipe.recipeDigest}, got ${recipe.recipeDigest}`
    );
  }
  if (recipe.recipeVersion !== canonicalRecipe.recipeVersion) {
    errors.push(
      `Recipe version mismatch for "${recipe.name}": expected ${canonicalRecipe.recipeVersion}, got ${recipe.recipeVersion}`
    );
  }
  if (recipe.compatibleRoute !== canonicalRecipe.compatibleRoute) {
    errors.push(
      `Recipe compatibleRoute mismatch for "${recipe.name}": expected ${canonicalRecipe.compatibleRoute}, got ${recipe.compatibleRoute}`
    );
  }
  if (
    recipe.diffusionModel.filename !== canonicalRecipe.diffusionModel.filename ||
    recipe.diffusionModel.sha256 !== canonicalRecipe.diffusionModel.sha256
  ) {
    errors.push(
      `Recipe diffusion model mismatch for "${recipe.name}": expected ${canonicalRecipe.diffusionModel.filename}, got ${recipe.diffusionModel.filename}`
    );
  }
  if (recipe.expectedSteps !== canonicalRecipe.expectedSteps) {
    errors.push(
      `Recipe expectedSteps mismatch for "${recipe.name}": expected ${canonicalRecipe.expectedSteps}, got ${recipe.expectedSteps}`
    );
  }
  if (
    recipe.sampler !== canonicalRecipe.sampler ||
    recipe.scheduler !== canonicalRecipe.scheduler ||
    recipe.denoise !== canonicalRecipe.denoise
  ) {
    errors.push(`Recipe sampling parameters mismatch for "${recipe.name}"`);
  }
  if (canonicalRecipe.lora) {
    if (
      !recipe.lora ||
      recipe.lora.filename !== canonicalRecipe.lora.filename ||
      recipe.lora.sha256 !== canonicalRecipe.lora.sha256 ||
      recipe.lora.strengthModel !== canonicalRecipe.lora.strengthModel
    ) {
      errors.push(`Recipe LoRA specification mismatch for "${recipe.name}"`);
    }
  } else if (recipe.lora) {
    errors.push(`Recipe LoRA must be null for "${recipe.name}"`);
  }
  if (canonicalRecipe.sigmaShift) {
    if (
      !recipe.sigmaShift ||
      recipe.sigmaShift.enabled !== canonicalRecipe.sigmaShift.enabled ||
      recipe.sigmaShift.videoShift !== canonicalRecipe.sigmaShift.videoShift ||
      recipe.sigmaShift.audioShift !== canonicalRecipe.sigmaShift.audioShift
    ) {
      errors.push(`Recipe sigmaShift mismatch for "${recipe.name}"`);
    }
  } else if (recipe.sigmaShift) {
    errors.push(`Recipe sigmaShift must be null for "${recipe.name}"`);
  }
  if (recipe.conditioningMode !== canonicalRecipe.conditioningMode) {
    errors.push(
      `Recipe conditioningMode mismatch for "${recipe.name}": expected ${canonicalRecipe.conditioningMode}, got ${recipe.conditioningMode}`
    );
  }
  if (recipe.requiredRuntimeRevision !== canonicalRecipe.requiredRuntimeRevision) {
    errors.push(
      `Recipe requiredRuntimeRevision mismatch for "${recipe.name}": expected ${canonicalRecipe.requiredRuntimeRevision}, got ${recipe.requiredRuntimeRevision}`
    );
  }

  // 2. Validate UNETLoader (node 6)
  const unetNode = typedGraph["6"];
  if (!unetNode) {
    errors.push("Missing UNETLoader node (id: 6)");
  } else {
    if (unetNode.class_type !== "UNETLoader") {
      errors.push(
        `Node 6 class_type mismatch: expected "UNETLoader", got "${unetNode.class_type}"`
      );
    }
    if (unetNode.inputs?.unet_name !== recipe.diffusionModel.filename) {
      errors.push(
        `Node 6 checkpoint mismatch: expected "${recipe.diffusionModel.filename}", got "${unetNode.inputs?.unet_name}"`
      );
    }
  }

  // 3. Validate BasicScheduler (node 9)
  const schedulerNode = typedGraph["9"];
  if (!schedulerNode) {
    errors.push("Missing BasicScheduler node (id: 9)");
  } else {
    if (schedulerNode.class_type !== "BasicScheduler") {
      errors.push(
        `Node 9 class_type mismatch: expected "BasicScheduler", got "${schedulerNode.class_type}"`
      );
    }
    if (schedulerNode.inputs?.steps !== recipe.expectedSteps) {
      errors.push(
        `Node 9 steps mismatch: expected ${recipe.expectedSteps}, got ${schedulerNode.inputs?.steps}`
      );
    }
    if (schedulerNode.inputs?.scheduler !== recipe.scheduler) {
      errors.push(
        `Node 9 scheduler mismatch: expected "${recipe.scheduler}", got "${schedulerNode.inputs?.scheduler}"`
      );
    }
    if (schedulerNode.inputs?.denoise !== recipe.denoise) {
      errors.push(
        `Node 9 denoise mismatch: expected ${recipe.denoise}, got ${schedulerNode.inputs?.denoise}`
      );
    }
  }

  // 4. Validate BasicGuider (node 16)
  const guiderNode = typedGraph["16"];
  if (!guiderNode) {
    errors.push("Missing BasicGuider node (id: 16)");
  } else if (guiderNode.class_type !== "BasicGuider") {
    errors.push(
      `Node 16 class_type mismatch: expected "BasicGuider", got "${guiderNode.class_type}"`
    );
  }

  // 5. Validate SamplerCustomAdvanced (node 14)
  const samplerNode = typedGraph["14"];
  if (!samplerNode) {
    errors.push("Missing SamplerCustomAdvanced node (id: 14)");
  } else {
    if (samplerNode.class_type !== "SamplerCustomAdvanced") {
      errors.push(
        `Node 14 class_type mismatch: expected "SamplerCustomAdvanced", got "${samplerNode.class_type}"`
      );
    }
    const sigmasConn = samplerNode.inputs?.sigmas as [string, number] | undefined;
    if (!sigmasConn || sigmasConn[0] !== "9") {
      errors.push(
        `Node 14 sigmas input must connect to BasicScheduler (node 9), got ${JSON.stringify(sigmasConn)}`
      );
    }
    const guiderConn = samplerNode.inputs?.guider as [string, number] | undefined;
    if (!guiderConn || guiderConn[0] !== "16") {
      errors.push(
        `Node 14 guider input must connect to BasicGuider (node 16), got ${JSON.stringify(guiderConn)}`
      );
    }
  }

  // 6. Validate Conditioning node (104 for i2v, 105 for ref2v)
  const expectedCondNodeId = route === "i2v" ? "104" : "105";
  const expectedCondClass = route === "i2v" ? "MiniMaxH3ImageToVideo" : "MiniMaxH3ReferenceToVideo";
  const condNode = typedGraph[expectedCondNodeId];
  if (!condNode) {
    errors.push(`Missing conditioning node (id: ${expectedCondNodeId})`);
  } else if (condNode.class_type !== expectedCondClass) {
    errors.push(
      `Conditioning node ${expectedCondNodeId} class_type mismatch: expected "${expectedCondClass}", got "${condNode.class_type}"`
    );
  }

  if (guiderNode) {
    const condConn = guiderNode.inputs?.conditioning as [string, number] | undefined;
    if (!condConn || condConn[0] !== expectedCondNodeId) {
      errors.push(
        `BasicGuider (node 16) conditioning input must connect to node ${expectedCondNodeId}, got ${JSON.stringify(condConn)}`
      );
    }
  }

  // 7. Validate Model Chain Topology
  if (recipe.lora) {
    const loraNode = typedGraph["301"];
    if (!loraNode) {
      errors.push("Missing LoraLoaderModelOnly node (id: 301) for LoRA recipe");
    } else {
      if (loraNode.class_type !== "LoraLoaderModelOnly") {
        errors.push(
          `Node 301 class_type mismatch: expected "LoraLoaderModelOnly", got "${loraNode.class_type}"`
        );
      }
      if (loraNode.inputs?.lora_name !== recipe.lora.filename) {
        errors.push(
          `Node 301 lora_name mismatch: expected "${recipe.lora.filename}", got "${loraNode.inputs?.lora_name}"`
        );
      }
      if (loraNode.inputs?.strength_model !== recipe.lora.strengthModel) {
        errors.push(
          `Node 301 strength_model mismatch: expected ${recipe.lora.strengthModel}, got ${loraNode.inputs?.strength_model}`
        );
      }
      const modelIn = loraNode.inputs?.model as [string, number] | undefined;
      if (!modelIn || modelIn[0] !== "6") {
        errors.push(
          `Node 301 model input must connect to UNETLoader (node 6), got ${JSON.stringify(modelIn)}`
        );
      }
    }

    if (schedulerNode) {
      const schedModelIn = schedulerNode.inputs?.model as [string, number] | undefined;
      if (!schedModelIn || schedModelIn[0] !== "301") {
        errors.push(
          `BasicScheduler (node 9) model input must connect to LoRA loader (node 301), got ${JSON.stringify(schedModelIn)}`
        );
      }
    }
    if (guiderNode) {
      const guiderModelIn = guiderNode.inputs?.model as [string, number] | undefined;
      if (!guiderModelIn || guiderModelIn[0] !== "301") {
        errors.push(
          `BasicGuider (node 16) model input must connect to LoRA loader (node 301), got ${JSON.stringify(guiderModelIn)}`
        );
      }
    }
    if (typedGraph["302"]) {
      errors.push("Unexpected node 302 in LoRA recipe graph");
    }
    if (typedGraph["303"]) {
      errors.push("Unexpected node 303 in LoRA recipe graph");
    }
  } else if (recipe.name === "fasth3-i2v-8") {
    // SigmaShift (301)
    const sigmaNode = typedGraph["301"];
    if (!sigmaNode) {
      errors.push("Missing MiniMaxH3SigmaShift node (id: 301) for FastH3 recipe");
    } else {
      if (sigmaNode.class_type !== "MiniMaxH3SigmaShift") {
        errors.push(
          `Node 301 class_type mismatch: expected "MiniMaxH3SigmaShift", got "${sigmaNode.class_type}"`
        );
      }
      const sigmaModelIn = sigmaNode.inputs?.model as [string, number] | undefined;
      if (!sigmaModelIn || sigmaModelIn[0] !== "6") {
        errors.push(
          `Node 301 model input must connect to UNETLoader (node 6), got ${JSON.stringify(sigmaModelIn)}`
        );
      }
      if (sigmaNode.inputs?.shift_video !== (recipe.sigmaShift?.videoShift ?? 10.0)) {
        errors.push(
          `Node 301 shift_video mismatch: expected ${recipe.sigmaShift?.videoShift ?? 10.0}, got ${sigmaNode.inputs?.shift_video}`
        );
      }
      if (sigmaNode.inputs?.shift_audio !== (recipe.sigmaShift?.audioShift ?? 3.0)) {
        errors.push(
          `Node 301 shift_audio mismatch: expected ${recipe.sigmaShift?.audioShift ?? 3.0}, got ${sigmaNode.inputs?.shift_audio}`
        );
      }
    }

    // ModelAttentionBackend (302)
    const attnBackendNode = typedGraph["302"];
    if (!attnBackendNode) {
      errors.push("Missing ModelAttentionBackend node (id: 302) for FastH3 recipe");
    } else {
      if (attnBackendNode.class_type !== "ModelAttentionBackend") {
        errors.push(
          `Node 302 class_type mismatch: expected "ModelAttentionBackend", got "${attnBackendNode.class_type}"`
        );
      }
      const attnModelIn = attnBackendNode.inputs?.model as [string, number] | undefined;
      if (!attnModelIn || attnModelIn[0] !== "301") {
        errors.push(
          `Node 302 model input must connect to MiniMaxH3SigmaShift (node 301), got ${JSON.stringify(attnModelIn)}`
        );
      }
      if (attnBackendNode.inputs?.attention !== "comfy kitchen attention") {
        errors.push(
          `Node 302 attention mismatch: expected "comfy kitchen attention", got "${attnBackendNode.inputs?.attention}"`
        );
      }
    }

    // BlockSparseAttention (303)
    const vsaNode = typedGraph["303"];
    if (!vsaNode) {
      errors.push("Missing BlockSparseAttention node (id: 303) for FastH3 recipe");
    } else {
      if (vsaNode.class_type !== "BlockSparseAttention") {
        errors.push(
          `Node 303 class_type mismatch: expected "BlockSparseAttention", got "${vsaNode.class_type}"`
        );
      }
      const vsaModelIn = vsaNode.inputs?.model as [string, number] | undefined;
      if (!vsaModelIn || vsaModelIn[0] !== "302") {
        errors.push(
          `Node 303 model input must connect to ModelAttentionBackend (node 302), got ${JSON.stringify(vsaModelIn)}`
        );
      }
      if (vsaNode.inputs?.selection !== "vsa") {
        errors.push(
          `Node 303 selection mismatch: expected "vsa", got "${vsaNode.inputs?.selection}"`
        );
      }
    }

    // Downstream connections to VSA
    if (schedulerNode) {
      const schedModelIn = schedulerNode.inputs?.model as [string, number] | undefined;
      if (!schedModelIn || schedModelIn[0] !== "303") {
        errors.push(
          `BasicScheduler (node 9) model input must connect to BlockSparseAttention (node 303), got ${JSON.stringify(schedModelIn)}`
        );
      }
    }
    if (guiderNode) {
      const guiderModelIn = guiderNode.inputs?.model as [string, number] | undefined;
      if (!guiderModelIn || guiderModelIn[0] !== "303") {
        errors.push(
          `BasicGuider (node 16) model input must connect to BlockSparseAttention (node 303), got ${JSON.stringify(guiderModelIn)}`
        );
      }
    }
  } else {
    // Baseline: direct connections to node 6
    if (schedulerNode) {
      const schedModelIn = schedulerNode.inputs?.model as [string, number] | undefined;
      if (!schedModelIn || schedModelIn[0] !== "6") {
        errors.push(
          `BasicScheduler (node 9) model input must connect directly to UNETLoader (node 6), got ${JSON.stringify(schedModelIn)}`
        );
      }
    }
    if (guiderNode) {
      const guiderModelIn = guiderNode.inputs?.model as [string, number] | undefined;
      if (!guiderModelIn || guiderModelIn[0] !== "6") {
        errors.push(
          `BasicGuider (node 16) model input must connect directly to UNETLoader (node 6), got ${JSON.stringify(guiderModelIn)}`
        );
      }
    }
    if (typedGraph["301"]) {
      errors.push("Unexpected node 301 in baseline recipe graph");
    }
    if (typedGraph["302"]) {
      errors.push("Unexpected node 302 in baseline recipe graph");
    }
    if (typedGraph["303"]) {
      errors.push("Unexpected node 303 in baseline recipe graph");
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
