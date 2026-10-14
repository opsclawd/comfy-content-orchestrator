import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveAttentionGraph,
  validateAttentionTopology
} from "./minimax-h3-attention-topology.js";

function loadCanonicalTemplate(route: "i2v" | "ref2v"): Record<string, unknown> {
  const fileName =
    route === "i2v"
      ? "templates/minimax_h3_720p_i2v_124f_api.json"
      : "templates/minimax_h3_720p_ref2v_124f_api.json";
  const content = readFileSync(resolve(process.cwd(), fileName), "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

describe("MiniMax-H3 Attention Topology", () => {
  describe("deriveAttentionGraph", () => {
    it("derives dense graph with 0 patches and direct model wiring from canonical template", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      expect(patches).toHaveLength(0);
      expect(topology.patchCount).toBe(0);
      expect(topology.backend).toBe("torch_sdpa");

      const guider = graph["16"] as { inputs: { model: unknown } };
      expect(guider.inputs.model).toEqual(["6", 0]);

      const scheduler = graph["9"] as { inputs: { model: unknown } };
      expect(scheduler.inputs.model).toEqual(["6", 0]);
    });

    it("derives sage graph with 0 patches and direct model wiring from canonical template", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "sage",
        route: "ref2v"
      });

      expect(patches).toHaveLength(0);
      expect(topology.patchCount).toBe(0);
      expect(topology.backend).toBe("sage");

      const guider = graph["16"] as { inputs: { model: unknown } };
      expect(guider.inputs.model).toEqual(["6", 0]);
    });

    it("derives native-sol-attn graph with ModelSparseAttention node 301 from canonical template", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "native-sol-attn",
        route: "i2v"
      });

      expect(patches).toHaveLength(1);
      expect(patches[0]!.nodeId).toBe("301");
      expect(patches[0]!.classType).toBe("ModelSparseAttention");
      expect(topology.backend).toBe("sol_attn");

      // Node 301 must exist and receive UNETLoader 6
      const patchNode = graph["301"] as { class_type: string; inputs: { model: unknown } };
      expect(patchNode.class_type).toBe("ModelSparseAttention");
      expect(patchNode.inputs.model).toEqual(["6", 0]);

      // BasicGuider 16 must connect to patch node 301
      const guider = graph["16"] as { inputs: { model: unknown } };
      expect(guider.inputs.model).toEqual(["301", 0]);

      // Scheduler 9 must still connect to UNETLoader 6
      const scheduler = graph["9"] as { inputs: { model: unknown } };
      expect(scheduler.inputs.model).toEqual(["6", 0]);
    });

    it("derives veda graph with VedaSparseAttention node 301 from canonical template", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "veda",
        route: "ref2v"
      });

      expect(patches).toHaveLength(1);
      expect(patches[0]!.nodeId).toBe("301");
      expect(patches[0]!.classType).toBe("VedaSparseAttention");
      expect(topology.backend).toBe("veda");

      const patchNode = graph["301"] as { class_type: string; inputs: { model: unknown } };
      expect(patchNode.class_type).toBe("VedaSparseAttention");
      expect(patchNode.inputs.model).toEqual(["6", 0]);

      const guider = graph["16"] as { inputs: { model: unknown } };
      expect(guider.inputs.model).toEqual(["301", 0]);
    });
  });

  describe("validateAttentionTopology", () => {
    it("validates dense graph on canonical i2v template with first_frame binding", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: []
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("validates sage graph on canonical ref2v template with 9 reference bindings", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "sage",
        route: "ref2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "sage",
        route: "ref2v",
        argv: ["--use-sage-attention", "--port", "8199"]
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("rejects an empty graph missing mandatory pipeline nodes", () => {
      const res = validateAttentionTopology(
        {},
        {
          expectedVariant: "dense",
          route: "i2v",
          argv: []
        }
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Required pipeline node"))).toBe(true);
    });

    it("rejects i2v graph if first_frame is missing or miswired", () => {
      const base = loadCanonicalTemplate("i2v");
      const node104 = base["104"] as { inputs: Record<string, unknown> };
      delete node104.inputs.first_frame;

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        argv: []
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("input 'first_frame' to connect to LoadImage"))
      ).toBe(true);
    });

    it("rejects ref2v graph if flattened ref_images inputs are missing", () => {
      const base = loadCanonicalTemplate("ref2v");
      const node105 = base["105"] as { inputs: Record<string, unknown> };
      for (let i = 0; i < 9; i++) {
        delete node105.inputs[`ref_images.ref_image_${i}`];
      }

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "ref2v",
        argv: []
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("requires at least 1 flattened 'ref_images.ref_image_N'"))
      ).toBe(true);
    });

    it("rejects sage graph if --use-sage-attention is missing from argv", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "sage",
        route: "ref2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "sage",
        route: "ref2v",
        argv: ["--port", "8199"]
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("requires --use-sage-attention");
    });

    it("rejects dense graph if --use-sage-attention is present in argv", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: ["--use-sage-attention"]
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("forbids --use-sage-attention");
    });

    it("rejects conflicting attention flags in argv", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: ["--use-split-cross-attention"]
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Conflicting attention argv flag"))).toBe(true);
    });

    it("rejects conflicting attention environment variables", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: [],
        env: { COMFYUI_ATTENTION_BACKEND: "sage" }
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Conflicting COMFYUI_ATTENTION_BACKEND"))).toBe(
        true
      );
    });

    it("rejects unknown attention argv flags", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: ["--use-custom-attention-kernel"]
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("Unknown or conflicting attention argv flag detected"))
      ).toBe(true);
    });

    it("rejects unknown attention environment variables", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: [],
        env: { CUSTOM_ATTENTION_BACKEND: "fast" }
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("Unknown or conflicting attention environment variable"))
      ).toBe(true);
    });

    it("rejects unrecognized attention patch node classes in graph", () => {
      const base = loadCanonicalTemplate("i2v");
      base["301"] = {
        class_type: "CustomAttentionPatch",
        inputs: { model: ["6", 0] }
      };

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        argv: []
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) =>
          e.includes('Unrecognized attention patch node class "CustomAttentionPatch"')
        )
      ).toBe(true);
    });

    it("rejects ref2v graph if flattened ref_images inputs have gaps", () => {
      const base = loadCanonicalTemplate("ref2v");
      const node105 = base["105"] as { inputs: Record<string, unknown> };
      // Delete ref_image_1 to create a gap between 0 and 2
      delete node105.inputs["ref_images.ref_image_1"];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "ref2v",
        argv: []
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) =>
          e.includes("flattened reference slots must be contiguous without gaps")
        )
      ).toBe(true);
    });

    it("rejects ref2v graph if reference node is not LoadImage", () => {
      const base = loadCanonicalTemplate("ref2v");
      (base["201"] as { class_type: string }).class_type = "WrongNodeType";

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "ref2v",
        argv: []
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("reference node 201 must be class_type 'LoadImage'"))
      ).toBe(true);
    });

    it("rejects stacking ModelSparseAttention and VedaSparseAttention", () => {
      const base = loadCanonicalTemplate("i2v");
      base["301"] = {
        class_type: "ModelSparseAttention",
        inputs: { model: ["6", 0], sparse_type: "sol-attn" }
      };
      base["302"] = {
        class_type: "VedaSparseAttention",
        inputs: { model: ["301", 0], predictor: "foo.safetensors" }
      };
      (base["16"] as { inputs: { model: unknown } }).inputs.model = ["302", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "native-sol-attn",
        route: "i2v"
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("must not be stacked"))).toBe(true);
    });

    it("rejects combining --use-sage-attention with sparse patch node", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "native-sol-attn",
        route: "i2v"
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "native-sol-attn",
        route: "i2v",
        argv: ["--use-sage-attention"]
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) =>
          e.includes("SageAttention flag (--use-sage-attention) cannot be combined with sparse")
        )
      ).toBe(true);
    });

    it("rejects disconnected or bypassed patch node", () => {
      const base = loadCanonicalTemplate("i2v");
      base["301"] = {
        class_type: "ModelSparseAttention",
        inputs: { model: ["6", 0], sparse_type: "sol-attn" }
      };
      // Node 16 remains connected to UNETLoader 6 instead of patch node 301
      (base["16"] as { inputs: { model: unknown } }).inputs.model = ["6", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "native-sol-attn",
        route: "i2v"
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("detected disconnected/bypassed patch"))).toBe(true);
    });

    it("detects cycle in model chain", () => {
      const base = loadCanonicalTemplate("i2v");
      base["301"] = {
        class_type: "ModelSparseAttention",
        inputs: { model: ["302", 0] }
      };
      base["302"] = {
        class_type: "ModelSparseAttention",
        inputs: { model: ["301", 0] }
      };
      (base["16"] as { inputs: { model: unknown } }).inputs.model = ["301", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "native-sol-attn",
        route: "i2v"
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Cycle detected"))).toBe(true);
    });
  });

  describe("conditioning, geometry, fps, seed, and frame count preservation", () => {
    const variants = ["dense", "sage", "native-sol-attn", "veda"] as const;

    for (const variant of variants) {
      it(`preserves I2V conditioning input (node 104 first_frame), 24fps, 124 frames, geometry, and seed for ${variant}`, () => {
        const base = loadCanonicalTemplate("i2v");
        const { graph } = deriveAttentionGraph({
          graph: base,
          attentionVariant: variant,
          route: "i2v"
        });

        // Node 104 MiniMaxH3ImageToVideo conditioning
        const node104 = graph["104"] as {
          class_type: string;
          inputs: {
            first_frame: unknown;
            width: number;
            height: number;
            length: number;
          };
        };
        expect(node104.class_type).toBe("MiniMaxH3ImageToVideo");
        expect(node104.inputs.first_frame).toEqual(["20", 0]);
        expect(node104.inputs.width).toBe(1344);
        expect(node104.inputs.height).toBe(768);
        expect(node104.inputs.length).toBe(124);

        // LoadImage node 20
        const node20 = graph["20"] as { class_type: string };
        expect(node20.class_type).toBe("LoadImage");

        // CreateVideo node 91: 24 fps
        const node91 = graph["91"] as { inputs: { fps: number } };
        expect(node91.inputs.fps).toBe(24);

        // RandomNoise node 15: seed 42
        const node15 = graph["15"] as { inputs: { noise_seed: number } };
        expect(node15.inputs.noise_seed).toBe(42);
      });

      it(`preserves Ref2V conditioning inputs (node 105 all 9 ref images), 24fps, 124 frames, geometry, and seed for ${variant}`, () => {
        const base = loadCanonicalTemplate("ref2v");
        const { graph } = deriveAttentionGraph({
          graph: base,
          attentionVariant: variant,
          route: "ref2v"
        });

        // Node 105 MiniMaxH3ReferenceToVideo conditioning
        const node105 = graph["105"] as {
          class_type: string;
          inputs: Record<string, unknown> & {
            width: number;
            height: number;
            length: number;
          };
        };
        expect(node105.class_type).toBe("MiniMaxH3ReferenceToVideo");
        expect(node105.inputs.width).toBe(1344);
        expect(node105.inputs.height).toBe(768);
        expect(node105.inputs.length).toBe(124);

        // All 9 reference inputs
        for (let i = 0; i < 9; i++) {
          const expectedTarget = [`${201 + i}`, 0];
          expect(node105.inputs[`ref_images.ref_image_${i}`]).toEqual(expectedTarget);
          const refLoader = graph[`${201 + i}`] as { class_type: string };
          expect(refLoader.class_type).toBe("LoadImage");
        }

        // CreateVideo node 91: 24 fps
        const node91 = graph["91"] as { inputs: { fps: number } };
        expect(node91.inputs.fps).toBe(24);

        // RandomNoise node 15: seed 42
        const node15 = graph["15"] as { inputs: { noise_seed: number } };
        expect(node15.inputs.noise_seed).toBe(42);
      });
    }
  });
});
