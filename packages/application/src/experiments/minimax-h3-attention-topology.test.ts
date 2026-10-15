import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseAttentionEvidence,
  resolveAttentionEvidence,
  validatePatchNodeAgainstFixture,
  UNAVAILABLE_UPSTREAM_CORE_REVISION,
  type MinimaxH3AttentionEvidence,
  type MinimaxH3SparseApiEvidence
} from "./minimax-h3-attention-evidence.js";
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

function loadFixture(name: string): Record<string, unknown> {
  const filePath = resolve(process.cwd(), "experiments/minimax-h3-attention/fixtures", name);
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

const pinnedCoreEvidence = parseAttentionEvidence(loadFixture("pinned-core-attention-api.json"));
const realNativeSolAttnEvidence = parseAttentionEvidence(loadFixture("native-sol-attn-api.json"));
const realVedaEvidence = parseAttentionEvidence(loadFixture("veda-sparse-attention-api.json"));

const syntheticResolvedNativeSolAttnEvidence: MinimaxH3SparseApiEvidence = parseAttentionEvidence({
  ...loadFixture("native-sol-attn-api.json"),
  status: "schema_verified",
  candidateCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
  targetCoreStatus: "confirmed_available",
  httpStatus: undefined,
  returnedMessage: undefined
}) as MinimaxH3SparseApiEvidence;

const syntheticResolvedVedaEvidence: MinimaxH3SparseApiEvidence = parseAttentionEvidence({
  ...loadFixture("veda-sparse-attention-api.json"),
  status: "schema_verified",
  targetCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
  targetCoreStatus: "confirmed_available"
}) as MinimaxH3SparseApiEvidence;

function getTestEvidence(variant: string): MinimaxH3AttentionEvidence {
  if (variant === "dense" || variant === "sage") return pinnedCoreEvidence;
  if (variant === "native-sol-attn") return syntheticResolvedNativeSolAttnEvidence;
  if (variant === "veda") return syntheticResolvedVedaEvidence;
  throw new Error(`Unknown variant ${variant}`);
}

describe("MiniMax-H3 Attention Topology", () => {
  describe("deriveAttentionGraph", () => {
    it("derives dense graph with 0 patches and direct model wiring from canonical template", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
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
        route: "ref2v",
        evidence: pinnedCoreEvidence
      });

      expect(patches).toHaveLength(0);
      expect(topology.patchCount).toBe(0);
      expect(topology.backend).toBe("sage");

      const guider = graph["16"] as { inputs: { model: unknown } };
      expect(guider.inputs.model).toEqual(["6", 0]);
    });

    it("fails closed when deriving native-sol-attn graph with real unresolved fixture", () => {
      const base = loadCanonicalTemplate("i2v");
      expect(() =>
        deriveAttentionGraph({
          graph: base,
          attentionVariant: "native-sol-attn",
          route: "i2v",
          evidence: realNativeSolAttnEvidence
        })
      ).toThrow(/unresolved upstream.*HTTP 422/);
    });

    it("derives native-sol-attn graph with ModelSparseAttention node 301 when evidence is resolved", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "native-sol-attn",
        route: "i2v",
        evidence: syntheticResolvedNativeSolAttnEvidence
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

    it("fails closed when deriving veda graph with real unresolved target core fixture", () => {
      const base = loadCanonicalTemplate("ref2v");
      expect(() =>
        deriveAttentionGraph({
          graph: base,
          attentionVariant: "veda",
          route: "ref2v",
          evidence: realVedaEvidence
        })
      ).toThrow(/unresolved upstream.*HTTP 422/);
    });

    it("derives veda graph with VedaSparseAttention node 301 when evidence is resolved", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph, patches, topology } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "veda",
        route: "ref2v",
        evidence: syntheticResolvedVedaEvidence
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

    it("fails when deriving graph without evidence", () => {
      const base = loadCanonicalTemplate("i2v");
      expect(() =>
        deriveAttentionGraph({
          graph: base,
          attentionVariant: "dense",
          route: "i2v"
        })
      ).toThrow(/requires authoritative API evidence/);
    });
  });

  describe("validateAttentionTopology", () => {
    it("validates dense graph on canonical i2v template with first_frame binding", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: [],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("validates sage graph on canonical ref2v template with 9 reference bindings", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "sage",
        route: "ref2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "sage",
        route: "ref2v",
        argv: ["--use-sage-attention", "--port", "8199"],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("rejects native-sol-attn topology with real unresolved fixture", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "native-sol-attn",
        route: "i2v",
        evidence: syntheticResolvedNativeSolAttnEvidence
      });
      const res = validateAttentionTopology(graph, {
        expectedVariant: "native-sol-attn",
        route: "i2v",
        evidence: realNativeSolAttnEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("unresolved upstream"))).toBe(true);
    });

    it("rejects veda topology with real unresolved target core fixture", () => {
      const base = loadCanonicalTemplate("ref2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "veda",
        route: "ref2v",
        evidence: syntheticResolvedVedaEvidence
      });
      const res = validateAttentionTopology(graph, {
        expectedVariant: "veda",
        route: "ref2v",
        evidence: realVedaEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("unresolved upstream"))).toBe(true);
    });

    it("rejects topology validation when evidence is omitted", () => {
      const base = loadCanonicalTemplate("i2v");
      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v"
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("requires authoritative API evidence");
    });

    it("rejects an empty graph missing mandatory pipeline nodes", () => {
      const res = validateAttentionTopology(
        {},
        {
          expectedVariant: "dense",
          route: "i2v",
          argv: [],
          evidence: pinnedCoreEvidence
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
        argv: [],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("input 'first_frame' to connect to LoadImage"))
      ).toBe(true);
    });

    it("rejects i2v graph if first_frame node 20 is completely missing from graph", () => {
      const base = loadCanonicalTemplate("i2v");
      delete base["20"];
      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        argv: [],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("first_frame node 20 is missing from the workflow graph"))
      ).toBe(true);
    });

    it("validates i2v graph with valid optional last_frame node", () => {
      const base = loadCanonicalTemplate("i2v");
      base["21"] = {
        class_type: "LoadImage",
        inputs: { image: "last_frame.png" }
      };
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["21", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("rejects i2v graph if last_frame node is missing from graph", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["999", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("last_frame node 999 is missing"))).toBe(true);
    });

    it("rejects i2v graph if last_frame node has wrong class_type", () => {
      const base = loadCanonicalTemplate("i2v");
      base["21"] = {
        class_type: "SaveImage",
        inputs: { image: "last_frame.png" }
      };
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["21", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("last_frame node 21 must be class_type 'LoadImage'"))
      ).toBe(true);
    });

    it("rejects i2v graph if last_frame node is missing image input", () => {
      const base = loadCanonicalTemplate("i2v");
      base["21"] = {
        class_type: "LoadImage",
        inputs: {}
      };
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["21", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("last_frame node 21 is missing required 'image' input"))
      ).toBe(true);
    });

    it("rejects i2v graph if last_frame link is malformed", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["20", 1];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("must connect to valid LoadImage node slot 0"))
      ).toBe(true);
    });

    it("validates i2v graph when last_frame is null", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = null;

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("validates i2v graph when last_frame references first_frame node 20 slot 0", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["20", 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("rejects i2v graph if last_frame is not a link array (e.g. a string literal)", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = "20";

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("must connect to valid LoadImage node slot 0"))
      ).toBe(true);
    });

    it("rejects i2v graph if last_frame has non-string node id", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = [20, 0];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("must connect to valid LoadImage node slot 0"))
      ).toBe(true);
    });

    it("rejects i2v graph if last_frame array length is not 2", () => {
      const base = loadCanonicalTemplate("i2v");
      (base["104"] as { inputs: Record<string, unknown> }).inputs.last_frame = ["20"];

      const res = validateAttentionTopology(base, {
        expectedVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("must connect to valid LoadImage node slot 0"))
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
        argv: [],
        evidence: pinnedCoreEvidence
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
        route: "ref2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "sage",
        route: "ref2v",
        argv: ["--port", "8199"],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("requires --use-sage-attention");
    });

    it("rejects dense graph if --use-sage-attention is present in argv", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: ["--use-sage-attention"],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("forbids --use-sage-attention");
    });

    it("rejects conflicting attention flags in argv", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: ["--use-split-cross-attention"],
        evidence: pinnedCoreEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Conflicting attention argv flag"))).toBe(true);
    });

    it("rejects conflicting attention environment variables", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "dense",
        route: "i2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: [],
        env: { COMFYUI_ATTENTION_BACKEND: "sage" },
        evidence: pinnedCoreEvidence
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
        route: "i2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: ["--use-custom-attention-kernel"],
        evidence: pinnedCoreEvidence
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
        route: "i2v",
        evidence: pinnedCoreEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "dense",
        route: "i2v",
        argv: [],
        env: { CUSTOM_ATTENTION_BACKEND: "fast" },
        evidence: pinnedCoreEvidence
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
        argv: [],
        evidence: pinnedCoreEvidence
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
        argv: [],
        evidence: pinnedCoreEvidence
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
        argv: [],
        evidence: pinnedCoreEvidence
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
        route: "i2v",
        evidence: syntheticResolvedNativeSolAttnEvidence
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("must not be stacked"))).toBe(true);
    });

    it("rejects combining --use-sage-attention with sparse patch node", () => {
      const base = loadCanonicalTemplate("i2v");
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "native-sol-attn",
        route: "i2v",
        evidence: syntheticResolvedNativeSolAttnEvidence
      });

      const res = validateAttentionTopology(graph, {
        expectedVariant: "native-sol-attn",
        route: "i2v",
        argv: ["--use-sage-attention"],
        evidence: syntheticResolvedNativeSolAttnEvidence
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
        route: "i2v",
        evidence: syntheticResolvedNativeSolAttnEvidence
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
        route: "i2v",
        evidence: syntheticResolvedNativeSolAttnEvidence
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
          route: "i2v",
          evidence: getTestEvidence(variant)
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
          route: "ref2v",
          evidence: getTestEvidence(variant)
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

  describe("resolveAttentionEvidence negative tests", () => {
    it("rejects unknown or missing schema status", () => {
      const evidence = {
        ...syntheticResolvedVedaEvidence,
        status: "candidate_unresolved"
      };
      const res = resolveAttentionEvidence({
        variant: "veda",
        evidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res.valid).toBe(false);
      expect(res.isResolved).toBe(false);
      expect(res.errors.some((e) => e.includes("schema status is not positively confirmed"))).toBe(
        true
      );
    });

    it("rejects missing or unconfirmed core status", () => {
      const evidence = {
        ...syntheticResolvedVedaEvidence,
        targetCoreStatus: "candidate_unresolved"
      };
      const res = resolveAttentionEvidence({
        variant: "veda",
        evidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res.valid).toBe(false);
      expect(
        res.errors.some((e) => e.includes("target core status is not positively confirmed"))
      ).toBe(true);
    });

    it("rejects core revision mismatch", () => {
      const res = resolveAttentionEvidence({
        variant: "veda",
        evidence: syntheticResolvedVedaEvidence,
        coreRevision: "66b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Core revision mismatch"))).toBe(true);
    });

    it("rejects custom node repository mismatch", () => {
      const res = resolveAttentionEvidence({
        variant: "veda",
        evidence: syntheticResolvedVedaEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNode: {
          repository: "other-org/other-repo",
          revision: "67e4eb5541b648555563144401ebaba832bd73ec"
        }
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Custom node repository mismatch"))).toBe(true);
    });

    it("rejects custom node revision mismatch", () => {
      const res = resolveAttentionEvidence({
        variant: "veda",
        evidence: syntheticResolvedVedaEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNode: {
          repository: "veda-sparse/Veda-on-ComfyUI",
          revision: "1111111111111111111111111111111111111111"
        }
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("Custom node revision mismatch"))).toBe(true);
    });

    it("rejects unavailable upstream core revision", () => {
      const res = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: realNativeSolAttnEvidence,
        coreRevision: UNAVAILABLE_UPSTREAM_CORE_REVISION
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("HTTP 422"))).toBe(true);
    });

    it("rejects native-sol-attn if evidence repository does not match ComfyUI upstream", () => {
      const evidence = {
        ...syntheticResolvedNativeSolAttnEvidence,
        repository: "https://github.com/fake-org/ComfyUI"
      };
      const res = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("repository mismatch"))).toBe(true);
    });

    it("rejects veda if evidence repository or revision is missing", () => {
      const noRepo = {
        ...syntheticResolvedVedaEvidence,
        repository: undefined
      };
      const res1 = resolveAttentionEvidence({
        variant: "veda",
        evidence: noRepo,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes("missing required repository field"))).toBe(true);

      const noRev = {
        ...syntheticResolvedVedaEvidence,
        revision: undefined
      };
      const res2 = resolveAttentionEvidence({
        variant: "veda",
        evidence: noRev,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes("missing required revision field"))).toBe(true);
    });

    it("rejects native-sol-attn with invented unknown status and mismatched core revision (probe F-b8139912)", () => {
      const probe = {
        kind: "sparse",
        status: "invented_unknown_status",
        candidateCoreRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        classType: "ModelSparseAttention",
        inputSignature: { required: { model: ["MODEL"], sparse_type: ["STRING"] } },
        returnTypes: ["MODEL"],
        repository: "https://github.com/Comfy-Org/ComfyUI"
      };
      const res = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: probe,
        coreRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      });
      expect(res.valid).toBe(false);
      expect(res.isResolved).toBe(false);
      expect(res.errors.some((e) => e.includes("Invalid sparse API evidence status"))).toBe(true);
    });

    it("rejects native-sol-attn with candidate_unresolved, unconfirmed core status, and mismatched core revision", () => {
      const probe = {
        kind: "sparse",
        status: "candidate_unresolved",
        candidateCoreRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        classType: "ModelSparseAttention",
        inputSignature: { required: { model: ["MODEL"], sparse_type: ["STRING"] } },
        returnTypes: ["MODEL"],
        repository: "https://github.com/Comfy-Org/ComfyUI"
      };
      const res = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: probe,
        coreRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      });
      expect(res.valid).toBe(false);
      expect(res.isResolved).toBe(false);
      expect(res.errors.some((e) => e.includes("schema status is not positively confirmed"))).toBe(
        true
      );
      expect(res.errors.some((e) => e.includes("core status is not positively confirmed"))).toBe(
        true
      );
      expect(res.errors.some((e) => e.includes("Core revision mismatch"))).toBe(true);
    });

    it("rejects native-sol-attn with schema_verified status but unconfirmed core status and mismatched core revision", () => {
      const probe = {
        kind: "sparse",
        status: "schema_verified",
        candidateCoreRevision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        classType: "ModelSparseAttention",
        inputSignature: { required: { model: ["MODEL"], sparse_type: ["STRING"] } },
        returnTypes: ["MODEL"],
        repository: "https://github.com/Comfy-Org/ComfyUI"
      };
      const res = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: probe,
        coreRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      });
      expect(res.valid).toBe(false);
      expect(res.isResolved).toBe(false);
      expect(res.errors.some((e) => e.includes("core status is not positively confirmed"))).toBe(
        true
      );
      expect(res.errors.some((e) => e.includes("Core revision mismatch"))).toBe(true);
    });

    it("rejects dense when customNode is provided", () => {
      const res = resolveAttentionEvidence({
        variant: "dense",
        evidence: pinnedCoreEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNode: { repository: "some-repo", revision: "some-rev" }
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("does not support a custom node definition"))).toBe(
        true
      );
    });

    it("rejects sage when customNode is provided", () => {
      const res = resolveAttentionEvidence({
        variant: "sage",
        evidence: pinnedCoreEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNode: { repository: "some-repo", revision: "some-rev" }
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("does not support a custom node definition"))).toBe(
        true
      );
    });

    it("rejects when evidence kind does not match requested variant", () => {
      // Sparse evidence passed to dense variant
      const res1 = resolveAttentionEvidence({
        variant: "dense",
        evidence: syntheticResolvedNativeSolAttnEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes("requires core API evidence"))).toBe(true);

      // Core evidence passed to native-sol-attn variant
      const res2 = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: pinnedCoreEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes("requires sparse API evidence"))).toBe(true);

      // Core evidence passed to veda variant
      const res3 = resolveAttentionEvidence({
        variant: "veda",
        evidence: pinnedCoreEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res3.valid).toBe(false);
      expect(res3.errors.some((e) => e.includes("requires sparse API evidence"))).toBe(true);
    });

    it("rejects sparse evidence when classType mismatches expected candidate node", () => {
      // VedaSparseAttention passed for native-sol-attn
      const res1 = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: syntheticResolvedVedaEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes('requires classType "ModelSparseAttention"'))).toBe(
        true
      );

      // ModelSparseAttention passed for veda
      const res2 = resolveAttentionEvidence({
        variant: "veda",
        evidence: syntheticResolvedNativeSolAttnEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes('requires classType "VedaSparseAttention"'))).toBe(
        true
      );
    });

    it("rejects sparse evidence when returnTypes does not include MODEL", () => {
      const probeNative = {
        ...syntheticResolvedNativeSolAttnEvidence,
        returnTypes: ["IMAGE"]
      };
      const res1 = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: probeNative,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes('returnTypes must include "MODEL"'))).toBe(true);

      const probeVeda = {
        ...syntheticResolvedVedaEvidence,
        returnTypes: ["IMAGE"]
      };
      const res2 = resolveAttentionEvidence({
        variant: "veda",
        evidence: probeVeda,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes('returnTypes must include "MODEL"'))).toBe(true);
    });

    it("rejects sparse evidence missing mandatory schema inputs", () => {
      // native-sol-attn missing sparse_type
      const noSparseType = {
        ...syntheticResolvedNativeSolAttnEvidence,
        inputSignature: { required: { model: ["MODEL"] } }
      };
      const res1 = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: noSparseType,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res1.valid).toBe(false);
      expect(res1.errors.some((e) => e.includes('missing required input "sparse_type"'))).toBe(
        true
      );

      // veda missing predictor
      const noPredictor = {
        ...syntheticResolvedVedaEvidence,
        inputSignature: {
          required: {
            model: ["MODEL"],
            generated_sparsity: ["STRING"],
            reference_sparsity: ["STRING"],
            full_attention_layers: ["STRING"],
            full_attention_steps: ["STRING"],
            verbose: ["BOOLEAN"]
          }
        }
      };
      const res2 = resolveAttentionEvidence({
        variant: "veda",
        evidence: noPredictor,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      });
      expect(res2.valid).toBe(false);
      expect(res2.errors.some((e) => e.includes('missing required input "predictor"'))).toBe(true);
    });

    it("rejects native-sol-attn when customNode is provided", () => {
      const res = resolveAttentionEvidence({
        variant: "native-sol-attn",
        evidence: syntheticResolvedNativeSolAttnEvidence,
        coreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNode: { repository: "some-repo", revision: "some-rev" }
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("does not support a custom node definition"))).toBe(
        true
      );
    });
  });

  describe("validatePatchNodeAgainstFixture", () => {
    const vedaFixture = syntheticResolvedVedaEvidence as MinimaxH3SparseApiEvidence;

    it("rejects unsupported schema type spec", () => {
      const fixtureWithUnsupportedSpec = {
        ...vedaFixture,
        inputSignature: {
          required: {
            model: ["MODEL"],
            custom_thing: ["UNSUPPORTED_TYPE_XYZ"]
          }
        }
      };
      const node = {
        class_type: "VedaSparseAttention",
        inputs: {
          model: ["6", 0],
          custom_thing: "hello"
        }
      };
      const res = validatePatchNodeAgainstFixture(
        node,
        fixtureWithUnsupportedSpec as MinimaxH3SparseApiEvidence,
        "6"
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("unsupported schema type spec"))).toBe(true);
    });

    it("validates conformant Veda patch node", () => {
      const validNode = {
        class_type: "VedaSparseAttention",
        inputs: {
          model: ["6", 0],
          predictor: "minimax_h3_i2v_sparse_predictor.safetensors",
          generated_sparsity: "trained",
          reference_sparsity: "0%",
          full_attention_layers: "",
          full_attention_steps: "",
          verbose: false
        }
      };
      const res = validatePatchNodeAgainstFixture(validNode, vedaFixture, "6");
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("rejects missing required input (predictor)", () => {
      const invalidNode = {
        class_type: "VedaSparseAttention",
        inputs: {
          model: ["6", 0],
          generated_sparsity: "trained",
          reference_sparsity: "0%",
          full_attention_layers: "",
          full_attention_steps: "",
          verbose: false
        }
      };
      const res = validatePatchNodeAgainstFixture(invalidNode, vedaFixture, "6");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("missing required input 'predictor'"))).toBe(true);
    });

    it("rejects wrong scalar type (verbose as integer instead of boolean)", () => {
      const invalidNode = {
        class_type: "VedaSparseAttention",
        inputs: {
          model: ["6", 0],
          predictor: "minimax_h3_i2v_sparse_predictor.safetensors",
          generated_sparsity: "trained",
          reference_sparsity: "0%",
          full_attention_layers: "",
          full_attention_steps: "",
          verbose: 1
        }
      };
      const res = validatePatchNodeAgainstFixture(invalidNode, vedaFixture, "6");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("must be a boolean"))).toBe(true);
    });

    it("rejects invalid enum/combo choice", () => {
      const comboFixture: MinimaxH3SparseApiEvidence = {
        ...syntheticResolvedNativeSolAttnEvidence,
        inputSignature: {
          required: {
            model: ["MODEL"],
            sparse_type: [["sol-attn", "block-sparse"]]
          }
        }
      };
      const invalidNode = {
        class_type: "ModelSparseAttention",
        inputs: {
          model: ["6", 0],
          sparse_type: "invalid_choice"
        }
      };
      const res = validatePatchNodeAgainstFixture(invalidNode, comboFixture, "6");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("not in allowed COMBO choices"))).toBe(true);
    });

    it("rejects unaudited placeholder string in inputs", () => {
      const invalidNode = {
        class_type: "VedaSparseAttention",
        inputs: {
          model: ["6", 0],
          predictor: ["200", 0],
          generated_sparsity: "not independently audited",
          reference_sparsity: 0,
          full_attention_layers: "0",
          full_attention_steps: "0",
          verbose: false
        }
      };
      const res = validatePatchNodeAgainstFixture(invalidNode, vedaFixture, "6");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("uses invalid placeholder"))).toBe(true);
    });

    it("rejects model input not connecting to UNETLoader slot 0", () => {
      const invalidNode = {
        class_type: "VedaSparseAttention",
        inputs: {
          model: ["6", 1],
          predictor: ["200", 0],
          generated_sparsity: 0,
          reference_sparsity: 0,
          full_attention_layers: "0",
          full_attention_steps: "0",
          verbose: false
        }
      };
      const res = validatePatchNodeAgainstFixture(invalidNode, vedaFixture, "6");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("must connect to UNETLoader (node 6) slot 0"))).toBe(
        true
      );
    });

    it("validates COMBO input without options requires string scalar", () => {
      const bareComboFixture: MinimaxH3SparseApiEvidence = {
        ...syntheticResolvedNativeSolAttnEvidence,
        inputSignature: {
          required: {
            model: ["MODEL"],
            mode: ["COMBO"]
          }
        }
      };
      const invalidNode = {
        class_type: "ModelSparseAttention",
        inputs: {
          model: ["6", 0],
          mode: 123
        }
      };
      const res = validatePatchNodeAgainstFixture(invalidNode, bareComboFixture, "6");
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("must be a string"))).toBe(true);

      const validNode = {
        class_type: "ModelSparseAttention",
        inputs: {
          model: ["6", 0],
          mode: "any_string"
        }
      };
      const validRes = validatePatchNodeAgainstFixture(validNode, bareComboFixture, "6");
      expect(validRes.valid).toBe(true);
    });
  });

  describe("parseAttentionEvidence negative and malformed tests", () => {
    it("rejects non-object raw input", () => {
      expect(() => parseAttentionEvidence(null)).toThrow(/must be a non-null object/);
      expect(() => parseAttentionEvidence("string")).toThrow(/must be a non-null object/);
    });

    it("rejects sparse evidence with missing or empty status", () => {
      const raw = {
        classType: "VedaSparseAttention",
        inputSignature: { required: {} },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(raw)).toThrow(/missing required string field 'status'/);
    });

    it("rejects unrecognized schema status", () => {
      const raw = {
        classType: "VedaSparseAttention",
        status: "invented_unknown_status",
        inputSignature: { required: {} },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(raw)).toThrow(
        /Invalid sparse API evidence status: "invented_unknown_status"/
      );
    });

    it("rejects unrecognized targetCoreStatus", () => {
      const raw = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        targetCoreStatus: "speculative_maybe",
        inputSignature: { required: {} },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(raw)).toThrow(
        /Invalid targetCoreStatus: "speculative_maybe"/
      );
    });

    it("rejects unrecognized coreStatus", () => {
      const raw = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        coreStatus: "speculative_status",
        inputSignature: { required: {} },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(raw)).toThrow(/Invalid coreStatus: "speculative_status"/);
    });

    it("rejects sparse evidence with empty returnTypes or non-string returnTypes", () => {
      const rawEmpty = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: { required: {} },
        returnTypes: []
      };
      expect(() => parseAttentionEvidence(rawEmpty)).toThrow(/non-empty array of strings/);

      const rawNonString = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: { required: {} },
        returnTypes: [123]
      };
      expect(() => parseAttentionEvidence(rawNonString)).toThrow(/non-empty array of strings/);
    });

    it("rejects malformed inputSignature sections and specs", () => {
      const rawNonObj = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: { required: "not an object" },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(rawNonObj)).toThrow(
        /Invalid inputSignature\.required: must be an object/
      );

      const rawArray = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: { required: [] },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(rawArray)).toThrow(
        /Invalid inputSignature\.required: must be an object/
      );

      const rawNonArraySpec = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: { required: { model: "MODEL" } },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(rawNonArraySpec)).toThrow(
        /Invalid inputSignature\.required\.model: entry must be a non-empty spec array/
      );

      const rawEmptySpecArray = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: { required: { model: [] } },
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(rawEmptySpecArray)).toThrow(
        /Invalid inputSignature\.required\.model: entry must be a non-empty spec array/
      );

      const rawEmptySections = {
        classType: "VedaSparseAttention",
        status: "schema_verified",
        inputSignature: {},
        returnTypes: ["MODEL"]
      };
      expect(() => parseAttentionEvidence(rawEmptySections)).toThrow(
        /Invalid inputSignature: must declare 'required' or 'optional' section/
      );
    });
  });

  describe("synthetic parsed Veda fixture negative and returnTypes slot checks", () => {
    it("fails derivation and validation when Veda fixture requires extra input unknown to recipe", () => {
      const base = loadCanonicalTemplate("i2v");
      const fixtureWithExtraRequired: MinimaxH3SparseApiEvidence = {
        ...syntheticResolvedVedaEvidence,
        inputSignature: {
          ...syntheticResolvedVedaEvidence.inputSignature,
          required: {
            ...syntheticResolvedVedaEvidence.inputSignature?.required,
            extra_param: ["FLOAT"]
          }
        }
      };

      // Derivation fails closed because recipe cannot satisfy fixture schema
      expect(() =>
        deriveAttentionGraph({
          graph: base,
          attentionVariant: "veda",
          route: "i2v",
          evidence: fixtureWithExtraRequired
        })
      ).toThrow(/missing required input 'extra_param'/);

      // Validate topology also rejects if extra_param is missing on patch node
      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "veda",
        route: "i2v",
        evidence: syntheticResolvedVedaEvidence
      });
      const topoRes = validateAttentionTopology(graph, {
        expectedVariant: "veda",
        route: "i2v",
        evidence: fixtureWithExtraRequired
      });
      expect(topoRes.valid).toBe(false);
      expect(topoRes.errors.some((e) => e.includes("missing required input 'extra_param'"))).toBe(
        true
      );
    });

    it("fails derivation when Veda fixture declares wrong scalar type (verbose: INT)", () => {
      const base = loadCanonicalTemplate("i2v");
      const fixtureWithWrongType: MinimaxH3SparseApiEvidence = {
        ...syntheticResolvedVedaEvidence,
        inputSignature: {
          ...syntheticResolvedVedaEvidence.inputSignature,
          optional: {
            ...syntheticResolvedVedaEvidence.inputSignature?.optional,
            verbose: ["INT", { default: 0 }]
          }
        }
      };

      // Derivation fails because recipe supplies boolean false but fixture requires INT (number/integer)
      expect(() =>
        deriveAttentionGraph({
          graph: base,
          attentionVariant: "veda",
          route: "i2v",
          evidence: fixtureWithWrongType
        })
      ).toThrow(/input 'verbose' must be an integer/);
    });

    it("handles non-zero MODEL returnTypes slot (slot 1) in derivation and enforces it in validation", () => {
      const base = loadCanonicalTemplate("i2v");
      const fixtureSlot1: MinimaxH3SparseApiEvidence = {
        ...syntheticResolvedVedaEvidence,
        returnTypes: ["IMAGE", "MODEL"]
      };

      const { graph } = deriveAttentionGraph({
        graph: base,
        attentionVariant: "veda",
        route: "i2v",
        evidence: fixtureSlot1
      });

      // BasicGuider (node 16) must be wired to slot 1
      const guider = graph["16"] as { inputs: { model: unknown } };
      expect(guider.inputs.model).toEqual(["301", 1]);

      // Validation passes when wired to slot 1
      const valSlot1 = validateAttentionTopology(graph, {
        expectedVariant: "veda",
        route: "i2v",
        evidence: fixtureSlot1
      });
      expect(valSlot1.valid).toBe(true);

      // Validation fails if slot 0 was connected instead of slot 1
      const tamperedGraph = JSON.parse(JSON.stringify(graph));
      tamperedGraph["16"].inputs.model = ["301", 0];
      const valTampered = validateAttentionTopology(tamperedGraph, {
        expectedVariant: "veda",
        route: "i2v",
        evidence: fixtureSlot1
      });
      expect(valTampered.valid).toBe(false);
      expect(valTampered.errors.some((e) => e.includes("slot 1 (MODEL output index)"))).toBe(true);
    });
  });
});
