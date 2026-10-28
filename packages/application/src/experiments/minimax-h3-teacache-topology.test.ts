import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveTeaCacheGraph, validateTeaCacheTopology } from "./minimax-h3-teacache-topology.js";
import {
  TEACACHE_NODE_KEY,
  TEACACHE_PATCH_NODE_ID,
  type MinimaxH3TeaCacheConfig
} from "@cco/contracts";

function loadCanonicalTemplate(route: "i2v" | "ref2v"): Record<string, unknown> {
  const fileName =
    route === "i2v"
      ? "templates/minimax_h3_720p_i2v_124f_api.json"
      : "templates/minimax_h3_720p_ref2v_124f_api.json";
  const content = readFileSync(resolve(process.cwd(), fileName), "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

describe("MiniMax-H3 TeaCache Topology", () => {
  const candidateConfig: MinimaxH3TeaCacheConfig = {
    mode: "raw-l1-v1",
    relL1Thresh: 0.15,
    startStep: 2,
    endStep: -2,
    totalSteps: 20,
    normalizedStartStep: 2,
    normalizedEndStep: 18
  };

  const offConfig: MinimaxH3TeaCacheConfig = {
    mode: "off",
    relL1Thresh: 0.15,
    startStep: 2,
    endStep: -2,
    totalSteps: 20,
    normalizedStartStep: 2,
    normalizedEndStep: 18
  };

  it("derives and validates isolated TeaCache graph on i2v route", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph, patchNode, topologyDigest } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    expect(patchNode).not.toBeNull();
    expect(topologyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(patchNode?.nodeId).toBe(TEACACHE_PATCH_NODE_ID);
    expect(patchNode?.classType).toBe(TEACACHE_NODE_KEY);
    expect(patchNode?.inputs.model).toEqual(["6", 0]);
    expect(patchNode?.inputs.rel_l1_thresh).toBe(0.15);
    expect(patchNode?.inputs.start_step).toBe(2);
    expect(patchNode?.inputs.end_step).toBe(-2);
    expect(patchNode?.inputs.total_steps).toBe(20);

    const guider = graph["16"] as { inputs?: { model?: unknown } };
    const scheduler = graph["9"] as { inputs?: { model?: unknown } };
    expect(guider.inputs?.model).toEqual([TEACACHE_PATCH_NODE_ID, 0]);
    expect(scheduler.inputs?.model).toEqual([TEACACHE_PATCH_NODE_ID, 0]);

    const validation = validateTeaCacheTopology(graph, {
      expectedMode: "raw-l1-v1",
      route: "i2v",
      expectedConfig: candidateConfig
    });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("derives and validates isolated TeaCache graph on ref2v route", () => {
    const baseGraph = loadCanonicalTemplate("ref2v");
    const { graph, patchNode } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "ref2v",
      config: candidateConfig
    });

    expect(patchNode).not.toBeNull();
    const validation = validateTeaCacheTopology(graph, {
      expectedMode: "raw-l1-v1",
      route: "ref2v",
      expectedConfig: candidateConfig
    });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("derives clean unpatched graph when mode is 'off'", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph, patchNode } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: offConfig
    });

    expect(patchNode).toBeNull();
    expect(graph[TEACACHE_PATCH_NODE_ID]).toBeUndefined();

    const guider = graph["16"] as { inputs?: { model?: unknown } };
    const scheduler = graph["9"] as { inputs?: { model?: unknown } };
    expect(guider.inputs?.model).toEqual(["6", 0]);
    expect(scheduler.inputs?.model).toEqual(["6", 0]);

    const validation = validateTeaCacheTopology(graph, {
      expectedMode: "off",
      route: "i2v",
      expectedConfig: offConfig
    });
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("rejects graph when TeaCache patch node is miswired or missing", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    // Tamper: disconnect guider back to node 6
    const tampered = JSON.parse(JSON.stringify(graph));
    tampered["16"].inputs.model = ["6", 0];

    const val1 = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v",
      expectedConfig: candidateConfig
    });
    expect(val1.valid).toBe(false);
    expect(val1.errors.some((e) => e.includes("BasicGuider"))).toBe(true);

    // Tamper: delete patch node
    const deleted = JSON.parse(JSON.stringify(graph));
    delete deleted[TEACACHE_PATCH_NODE_ID];

    const val2 = validateTeaCacheTopology(deleted, {
      expectedMode: "raw-l1-v1",
      route: "i2v",
      expectedConfig: candidateConfig
    });
    expect(val2.valid).toBe(false);
    expect(val2.errors.some((e) => e.includes("missing from graph"))).toBe(true);
  });

  it("rejects graph when extraneous optimization patches are present", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    // Tamper: add a sparse attention patch node 301
    const tampered = JSON.parse(JSON.stringify(graph));
    tampered["301"] = {
      class_type: "ModelSparseAttention",
      inputs: { model: ["6", 0] }
    };

    const val = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v",
      expectedConfig: candidateConfig
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("Extraneous optimization patch node"))).toBe(true);
  });

  it("rejects graph when mode is 'off' but patch node is present", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    const val = validateTeaCacheTopology(graph, {
      expectedMode: "off",
      route: "i2v",
      expectedConfig: offConfig
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("must not be present"))).toBe(true);
  });

  it("rejects graph with unauthorized LoRA loader or optimizer patches", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    const tampered = JSON.parse(JSON.stringify(graph));
    tampered["505"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["401", 0], lora_name: "test.safetensors" }
    };

    const val = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v"
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("Unauthorized optimization/LoRA node"))).toBe(true);
  });

  it("rejects graph when scheduler steps/scheduler/denoise are altered", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    const tampered = JSON.parse(JSON.stringify(graph));
    tampered["9"].inputs.steps = 10;
    tampered["9"].inputs.scheduler = "karras";
    tampered["9"].inputs.denoise = 0.8;

    const val = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v"
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("input 'steps' must be 20"))).toBe(true);
    expect(val.errors.some((e) => e.includes("input 'scheduler' must be \"simple\""))).toBe(true);
    expect(val.errors.some((e) => e.includes("input 'denoise' must be 1"))).toBe(true);
  });

  it("rejects graph when UNETLoader has non-canonical checkpoint", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    const tampered = JSON.parse(JSON.stringify(graph));
    tampered["6"].inputs.unet_name = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";

    const val = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v"
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("input 'unet_name' must be"))).toBe(true);
  });

  it("rejects graph when patch node inputs fail schema validation even without expectedConfig", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    const tampered = JSON.parse(JSON.stringify(graph));
    // Set invalid threshold (not in allowlist)
    tampered["401"].inputs.rel_l1_thresh = 0.99;

    const val = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v"
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("inputs failed schema validation"))).toBe(true);
  });

  it("rejects graph when model chain contains a cycle", () => {
    const baseGraph = loadCanonicalTemplate("i2v");
    const { graph } = deriveTeaCacheGraph({
      baseWorkflow: baseGraph,
      route: "i2v",
      config: candidateConfig
    });

    const tampered = JSON.parse(JSON.stringify(graph));
    // Create cycle 401 -> 16 -> 401
    tampered["401"].inputs.model = ["16", 0];

    const val = validateTeaCacheTopology(tampered, {
      expectedMode: "raw-l1-v1",
      route: "i2v"
    });
    expect(val.valid).toBe(false);
    expect(val.errors.some((e) => e.includes("contains a cycle"))).toBe(true);
  });
});
