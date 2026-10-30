import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MinimaxH3PhaseAccountingEventSchema } from "@cco/contracts";

const COLLECTOR_SCRIPT_PATH = fileURLToPath(new URL("./minimax-h3-collector.py", import.meta.url));

describe("MiniMax-H3 Python Collector & Attention Hook", () => {
  let testDir: string;
  let comfyDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "collector-test-"));
    comfyDir = join(testDir, "mock_comfy");
    await mkdir(join(comfyDir, "comfy", "ldm", "modules"), { recursive: true });
    await mkdir(join(comfyDir, "comfy", "samplers"), { recursive: true });
    await mkdir(join(comfyDir, "comfy_extras"), { recursive: true });
    await mkdir(join(comfyDir, "veda_comfy"), { recursive: true });

    writeFileSync(join(comfyDir, "comfy", "__init__.py"), "");
    writeFileSync(join(comfyDir, "comfy", "ldm", "__init__.py"), "");
    writeFileSync(join(comfyDir, "comfy", "ldm", "modules", "__init__.py"), "");
    writeFileSync(join(comfyDir, "comfy_extras", "__init__.py"), "");
    writeFileSync(join(comfyDir, "veda_comfy", "__init__.py"), "");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function createMockComfyModules(
    options: {
      includeSage?: boolean;
      throwInSage?: boolean;
      throwInOptimized?: boolean;
      customVedaSource?: string;
      omitCustomSampler?: boolean;
      corruptCustomSampler?: boolean;
      omitConditioning?: boolean;
      corruptConditioning?: boolean;
      omitKSampler?: boolean;
      corruptKSampler?: boolean;
      omitModelManagement?: boolean;
      corruptModelManagement?: boolean;
      omitExecution?: boolean;
      corruptExecution?: boolean;
    } = {}
  ) {
    const attentionPy = `
def sdp(q, k, v, *args, **kwargs):
    return "sdp_result"

def attention_pytorch(q, k, v, *args, **kwargs):
    import comfy.ops as ops
    return ops.scaled_dot_product_attention(q, k, v, *args, **kwargs)

def optimized_attention(q, k, v, *args, **kwargs):
    ${options.throwInOptimized ? 'raise RuntimeError("Optimized attention execution error")' : 'return "optimized_result"'}
${
  options.includeSage
    ? `
def sageattn(q, k, v, *args, **kwargs):
    ${options.throwInSage ? 'raise RuntimeError("CUDA kernel fault in sageattn")' : 'return "sage_result"'}
`
    : ""
}
`;
    writeFileSync(join(comfyDir, "comfy", "ldm", "modules", "attention.py"), attentionPy);

    const opsPy = `
def scaled_dot_product_attention(q, k, v, *args, **kwargs):
    return "scaled_dot_product_attention_result"
`;
    writeFileSync(join(comfyDir, "comfy", "ops.py"), opsPy);

    if (!options.omitModelManagement) {
      const mmPy = options.corruptModelManagement
        ? `load_models_gpu = "not_callable"`
        : `
def load_models_gpu(models, *args, **kwargs):
    return models
`;
      writeFileSync(join(comfyDir, "comfy", "model_management.py"), mmPy);
    }

    if (!options.omitExecution) {
      const execPy = options.corruptExecution
        ? `class PromptExecutor:\n    execute = "not_callable"\n`
        : `
class PromptExecutor:
    def execute(self, *args, **kwargs):
        return "executor_result"
`;
      writeFileSync(join(comfyDir, "execution.py"), execPy);
    }

    if (!options.omitKSampler) {
      const ksamplerPy = options.corruptKSampler
        ? `class KSampler:\n    sample = "not_callable"\n`
        : `
class KSampler:
    def sample(self, *args, **kwargs):
        cb = kwargs.get("callback")
        if cb:
            cb(0, None, None, 1)
        return "ksampler_result"
`;
      writeFileSync(join(comfyDir, "comfy", "samplers", "__init__.py"), ksamplerPy);
    }

    if (!options.omitCustomSampler) {
      const customSamplerPy = options.corruptCustomSampler
        ? `class SamplerCustomAdvanced:\n    execute = "not_callable"\n`
        : `
class SamplerCustomAdvanced:
    @classmethod
    def execute(cls, noise, guider, sampler, sigmas, latent_image, *args, **kwargs):
        if hasattr(guider, "sample"):
            return (guider.sample(noise, latent_image, sampler, sigmas),)
        return (noise,)
    sample = execute
`;
      writeFileSync(join(comfyDir, "comfy_extras", "nodes_custom_sampler.py"), customSamplerPy);
    }

    if (!options.omitConditioning) {
      const conditioningPy = options.corruptConditioning
        ? `class MiniMaxH3ImageToVideo:\n    execute = "not_callable"\nclass MiniMaxH3ReferenceToVideo:\n    execute = "not_callable"\n`
        : `
class MiniMaxH3ImageToVideo:
    @classmethod
    def execute(cls, clip, vae, prompt, width, height, length, first_frame=None, last_frame=None, audio_vae=None):
        return ({"positive": prompt, "first_frame": first_frame, "last_frame": last_frame},)

class MiniMaxH3ReferenceToVideo:
    @classmethod
    def execute(cls, clip, vae, prompt, width, height, length, ref_image_size, ref_images=None, audio_vae=None):
        return ({"positive": prompt, "ref_images": ref_images},)
`;
      writeFileSync(join(comfyDir, "comfy_extras", "nodes_minimax_h3.py"), conditioningPy);
    }

    const vedaPy =
      options.customVedaSource !== undefined
        ? options.customVedaSource
        : `
class VedaPatch:
    def __init__(self, full_attention_layers=None, full_attention_steps=None):
        self.full_attention_layers = full_attention_layers or []
        self.full_attention_steps = full_attention_steps or []

    def _dense_reason(self, q, options):
        layer = None
        step = None
        if isinstance(options, dict):
            for k in ("block_index", "layer", "transformer_index"):
                if k in options and options[k] is not None:
                    layer = options[k]
                    break
            for k in ("step", "sub_step", "step_index"):
                if k in options and options[k] is not None:
                    step = options[k]
                    break
            if "transformer_options" in options and isinstance(options["transformer_options"], dict):
                to = options["transformer_options"]
                if layer is None:
                    for k in ("block_index", "layer", "transformer_index"):
                        if k in to and to[k] is not None:
                            layer = to[k]
                            break
                if step is None:
                    for k in ("step", "sub_step", "step_index"):
                        if k in to and to[k] is not None:
                            step = to[k]
                            break
        if layer is not None and layer in self.full_attention_layers:
            return "full-attention layer"
        if step is not None and step in self.full_attention_steps:
            return "full-attention step"
        return None

    def _block_reason(self, options):
        layer = None
        if isinstance(options, dict):
            for k in ("block_index", "layer", "transformer_index"):
                if k in options and options[k] is not None:
                    layer = options[k]
                    break
            if layer is None and "block" in options and options["block"] is not None:
                b = options["block"]
                if isinstance(b, (list, tuple)) and len(b) > 1 and isinstance(b[1], int):
                    layer = b[1]
                else:
                    layer = b
        if layer is not None and layer in self.full_attention_layers:
            return "full-attention layer"
        return None

    def make_override(self, previous):
        def override(*args, **kwargs):
            if args and callable(args[0]):
                func = args[0]
                q = args[1] if len(args) > 1 else None
                k = args[2] if len(args) > 2 else None
                v = args[3] if len(args) > 3 else None
            else:
                func = previous
                q = args[0] if len(args) > 0 else None
                k = args[1] if len(args) > 1 else None
                v = args[2] if len(args) > 2 else None

            options = kwargs.get("extra_options") or kwargs.get("transformer_options")
            if not options and len(args) > 4 and isinstance(args[4], dict):
                options = args[4]
            if not options and len(args) > 3 and isinstance(args[3], dict):
                options = args[3]
            options = options or {}

            dense_reason = self._dense_reason(q, options)
            block_reason = self._block_reason(options)
            if dense_reason or block_reason:
                chunks = options.get("head_chunks", 1)
                res = None
                for _ in range(chunks):
                    if callable(func):
                        res = func(q, k, v, **kwargs)
                    else:
                        res = previous(q, k, v, **kwargs)
                return res
            return "veda_sparse_result"
        return override

    def _routed_forward(self, func, q, k, v, **kwargs):
        options = kwargs.get("extra_options") or kwargs.get("transformer_options") or {}
        dense_reason = self._dense_reason(q, options)
        block_reason = self._block_reason(options)
        if dense_reason or block_reason:
            if callable(func):
                return func(q, k, v, **kwargs)
        return "veda_routed_sparse_result"
`;
    if (vedaPy) {
      writeFileSync(join(comfyDir, "veda_comfy", "comfy_patch.py"), vedaPy);
    }
  }

  interface CollectorTestEvent {
    protocolVersion: string;
    sequence: number;
    runId: string;
    attemptToken: string;
    spanId?: string;
    parentSpanId?: string;
    phase: string;
    type: string;
    boundarySource?: string;
    outcome?: string;
    error?: { message: string; exceptionType?: string };
    metadata?: {
      handshake?: string;
      taskMode?: string;
      referenceCount?: number;
      stepRecords?: Array<{
        stepIndex: number;
        layerIndex?: number;
      }>;
      attentionSummary?: {
        acceleratedCallCount: number;
        denseCallCount: number;
        plannedDenseCallCount: number;
        fallbackEvents: Array<{
          requestedBackend: string;
          fallbackBackend: string;
          reason: string;
        }>;
        actualBackend: string;
        dispatchImplementation: string;
        missingKernelFailure: string | null;
        status: string;
        failureReason: string | null;
      };
      teacacheEvent?: string;
      teacacheSession?: string;
      summary?: { mode?: string; forwardCalls?: number; cacheHits?: number; totalSteps?: number };
    };
  }

  // Stage the pinned adapter into <testDir>/custom_nodes (testDir is the
  // target ComfyUI root: the bootstrap entrypoint lives there). Resolution is
  // strictly scoped to this directory.
  function stageTeaCacheAdapter(): string {
    const dest = join(testDir, "custom_nodes", "cco-minimax-h3-teacache");
    mkdirSync(join(dest, "locks"), { recursive: true });
    const src = resolve("experiments/minimax-h3-teacache");
    for (const f of ["__init__.py", "nodes.py", "teacache.py"]) {
      copyFileSync(join(src, f), join(dest, f));
    }
    copyFileSync(
      join(src, "locks/requirements-teacache-cu124.txt"),
      join(dest, "locks/requirements-teacache-cu124.txt")
    );
    return dest;
  }

  function runCollectorWithScript(
    scriptContent: string,
    env: Record<string, string> = {}
  ): {
    status: number | null;
    stdout: string;
    stderr: string;
    events: CollectorTestEvent[];
  } {
    const entrypointPath = join(testDir, "entrypoint.py");
    const eventLogPath = join(testDir, "phase-events.jsonl");

    writeFileSync(entrypointPath, scriptContent);

    const runEnv = {
      ...process.env,
      PYTHONPATH: `${comfyDir}:${process.env.PYTHONPATH || ""}`,
      CCO_EXPERIMENT_RUN_DIR: testDir,
      CCO_EXPERIMENT_RUN_ID: "test-run-123",
      CCO_EXPERIMENT_ATTEMPT_TOKEN: "attempt-token-abc",
      CCO_EXPERIMENT_EVENT_LOG: eventLogPath,
      ...env
    };

    const res = spawnSync(
      "python3",
      [COLLECTOR_SCRIPT_PATH, "--bootstrap-entrypoint", entrypointPath],
      {
        env: runEnv,
        encoding: "utf-8"
      }
    );
    if (res.status !== 0) {
      console.log("DEBUG RES:", res.status, res.stderr, res.stdout);
    }

    let events: CollectorTestEvent[] = [];
    if (existsSync(eventLogPath)) {
      const content = readFileSync(eventLogPath, "utf-8");
      if (content.trim()) {
        events = content
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as CollectorTestEvent);
      }
    }

    return {
      status: res.status,
      stdout: res.stdout,
      stderr: res.stderr,
      events
    };
  }

  it("fails immediately during startup when SageAttention kernel is missing under requested sage regime", async () => {
    // Missing sage module functions
    createMockComfyModules({ includeSage: false });

    const script = `
print("SHOULD_NOT_EXECUTE")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_EXECUTE");

    // Check diagnostic event has recorded failure
    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.missingKernelFailure).toContain(
      "SageAttention kernel not found or not registered"
    );
  });

  it("records fallback and terminates unconditionally when accelerated kernel throws exception regardless of allowPlannedDense", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: true });

    const script = `
import comfy.ldm.modules.attention as attn
try:
    attn.sageattn(None, None, None)
except Exception:
    print("SHOULD_NOT_BE_CATCHABLE")
print("SHOULD_NOT_PROCEED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_BE_CATCHABLE");
    expect(result.stdout).not.toContain("SHOULD_NOT_PROCEED");
    expect(result.stderr).toContain("Terminal attention experiment failure");
    expect(result.stderr).toContain("CUDA kernel fault in sageattn");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents.length).toBeGreaterThan(0);
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.requestedBackend).toBe(
      "sage"
    );
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.fallbackBackend).toBe(
      "torch_sdpa"
    );
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.reason).toContain(
      "CUDA kernel fault in sageattn"
    );
  });

  it("fails closed on unexpected dense attention calls when allowPlannedDense=false", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
# Execute an unexpected dense attention call
attn.sdp(None, None, None)
print("SHOULD_HAVE_BEEN_BLOCKED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "false"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_HAVE_BEEN_BLOCKED");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.failureReason).toContain(
      "allowPlannedDense=false"
    );
  });

  it("fails closed on unplanned dense call even when allowPlannedDense=true", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
# Execute an unplanned dense attention call
attn.sdp(None, None, None)
print("SHOULD_HAVE_BEEN_BLOCKED_UNPLANNED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_HAVE_BEEN_BLOCKED_UNPLANNED");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.failureReason).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("admits dense attention call when recorded through planned exclusion hook under allowPlannedDense=true", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"block_index": 2, "step": 3})
assert res == "sdp_result"
print("PLANNED_DENSE_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PLANNED_DENSE_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(0);
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(1);

    // Validate that all emitted events parse under MinimaxH3PhaseAccountingEventSchema
    expect(result.events.length).toBeGreaterThan(0);
    for (const evt of result.events) {
      expect(() => MinimaxH3PhaseAccountingEventSchema.parse(evt)).not.toThrow();
    }

    const stepRecords = (
      diagnostic?.metadata as unknown as {
        stepRecords?: Array<{ callType: string; metadata?: Record<string, unknown> }>;
      }
    )?.stepRecords;
    expect(stepRecords).toBeDefined();
    expect(stepRecords?.length).toBe(1);
    expect(stepRecords?.[0]?.callType).toBe("planned_dense");
    expect(stepRecords?.[0]?.metadata?.patchClass).toBe("VedaPatch");
    expect(stepRecords?.[0]?.metadata?.decisionMethod).toBe("_dense_reason");
    expect(stepRecords?.[0]?.metadata?.reason).toBe("full-attention layer");
  });

  it("admits dense attention call through _routed_forward under allowPlannedDense=true", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
res = patch._routed_forward(attn.sdp, None, None, None, extra_options={"block_index": 2, "step": 1})
assert res == "sdp_result"
print("ROUTED_FORWARD_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ROUTED_FORWARD_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(0);
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(1);
  });

  it("admits dense attention call when make_override's returned override decides via _dense_reason and then delegates dispatch through _routed_forward (nested scope must not clobber the outer decision)", async () => {
    createMockComfyModules({
      includeSage: true,
      throwInSage: false,
      customVedaSource: `
class VedaPatch:
    def __init__(self, full_attention_layers=None):
        self.full_attention_layers = full_attention_layers or []

    def _dense_reason(self, q, options):
        layer = options.get("block_index") if isinstance(options, dict) else None
        if layer is not None and layer in self.full_attention_layers:
            return "full-attention layer"
        return None

    def _block_reason(self, options):
        return None

    def make_override(self, previous):
        # Mirrors the pinned upstream shape where override makes the planned
        # exclusion decision itself via _dense_reason, then hands the actual
        # dispatch off to _routed_forward WITHOUT re-deciding there.
        def override(func, q, k, v, **kwargs):
            self._dense_reason(q, kwargs.get("extra_options", {}))
            return self._routed_forward(func, q, k, v, **kwargs)
        return override

    def _routed_forward(self, func, q, k, v, **kwargs):
        # Does not re-decide; just dispatches assuming the caller already decided.
        return func(q, k, v, **kwargs)
`
    });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"block_index": 2, "step": 1})
assert res == "sdp_result"
print("NESTED_DELEGATION_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NESTED_DELEGATION_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(0);
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(1);
  });

  it("admits dense attention call when make_override's returned override delegates its decision call into _routed_forward and dispatches itself afterward (reverse nesting direction must not clobber the inner decision on exit)", async () => {
    createMockComfyModules({
      includeSage: true,
      throwInSage: false,
      customVedaSource: `
class VedaPatch:
    def __init__(self, full_attention_layers=None):
        self.full_attention_layers = full_attention_layers or []

    def _dense_reason(self, q, options):
        layer = options.get("block_index") if isinstance(options, dict) else None
        if layer is not None and layer in self.full_attention_layers:
            return "full-attention layer"
        return None

    def _block_reason(self, options):
        return None

    def _routed_forward(self, func, q, k, v, **kwargs):
        # Decision happens here, but dispatch does NOT: the caller
        # (override) dispatches the actual dense call itself afterward.
        self._dense_reason(q, kwargs.get("extra_options", {}))
        return None

    def make_override(self, previous):
        # Reverse nesting: override calls _routed_forward (which makes the
        # decision internally via _dense_reason), then dispatches the dense
        # call itself AFTER _routed_forward returns.
        def override(func, q, k, v, **kwargs):
            self._routed_forward(func, q, k, v, **kwargs)
            return func(q, k, v, **kwargs)
        return override
`
    });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"block_index": 2, "step": 1})
assert res == "sdp_result"
print("REVERSE_NESTED_DELEGATION_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("REVERSE_NESTED_DELEGATION_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(0);
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(1);
  });

  it("fails closed when planned exclusion hook executes under allowPlannedDense=false", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
op = patch.make_override(attn.sdp)
op(attn.sdp, None, None, None, extra_options={"block_index": 2})
print("SHOULD_NOT_REACH_HERE")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "false"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE");
    expect(result.stderr).toContain(
      "Planned dense attention call executed under zero-dense policy regime"
    );

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.failureReason).toContain(
      "allowPlannedDense=false"
    );
  });

  it("fails closed when VedaPatch returns unsupported exclusion reason under allowPlannedDense=true", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch()
patch._dense_reason = lambda q, options: "layer outside the predictor"
op = patch.make_override(attn.sdp)
op(attn.sdp, None, None, None, extra_options={"block_index": 2})
print("SHOULD_NOT_REACH_HERE_UNSUPPORTED_REASON")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_UNSUPPORTED_REASON");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
  });

  it("admits dense attention call when recorded through _block_reason hook under allowPlannedDense=true", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[3])
# _dense_reason returns None for step, _block_reason returns "full-attention layer" for block 3
patch._dense_reason = lambda q, options: None
patch._block_reason = lambda options: "full-attention layer"

op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"block_index": 3, "step": 0})
assert res == "sdp_result"
print("BLOCK_REASON_PLANNED_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("BLOCK_REASON_PLANNED_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(0);
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(1);

    const stepRecords = (
      diagnostic?.metadata as unknown as {
        stepRecords?: Array<{ callType: string; metadata?: Record<string, unknown> }>;
      }
    )?.stepRecords;
    expect(stepRecords?.[0]?.metadata?.decisionMethod).toBe("_block_reason");
    expect(stepRecords?.[0]?.metadata?.reason).toBe("full-attention layer");
  });

  it("admits dense attention call when _dense_reason returns valid reason and subsequent _block_reason returns None", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch()
# _dense_reason returns valid reason, _block_reason returns None
# Pinned upstream make_override calls _dense_reason then _block_reason; None must NOT clear the planned exclusion
patch._dense_reason = lambda q, options: "full-attention step"
patch._block_reason = lambda options: None

op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"step": 2})
assert res == "sdp_result"
print("DENSE_THEN_NONE_BLOCK_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DENSE_THEN_NONE_BLOCK_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(0);
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(1);
    const stepRecords = (
      diagnostic?.metadata as unknown as {
        stepRecords?: Array<{ callType: string; metadata?: Record<string, unknown> }>;
      }
    )?.stepRecords;
    expect(stepRecords?.[0]?.metadata?.decisionMethod).toBe("_dense_reason");
    expect(stepRecords?.[0]?.metadata?.reason).toBe("full-attention step");
  });

  it("fails closed when _block_reason returns unsupported exclusion reason under allowPlannedDense=true", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch()
patch._dense_reason = lambda q, options: None
patch._block_reason = lambda options: "block outside the predictor"

op = patch.make_override(attn.sdp)
op(attn.sdp, None, None, None, extra_options={"block_index": 2})
print("SHOULD_NOT_REACH_HERE_UNSUPPORTED_BLOCK_REASON")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_UNSUPPORTED_BLOCK_REASON");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
  });

  it("fails closed on unplanned dense call following a real planned decision", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
op = patch.make_override(attn.sdp)
# 1. Planned call passes
res = op(attn.sdp, None, None, None, extra_options={"block_index": 2})
assert res == "sdp_result"

# 2. Subsequent dense call without planned exclusion decision fails closed
attn.sdp(None, None, None)
print("SHOULD_NOT_REACH_HERE_AFTER_UNPLANNED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_AFTER_UNPLANNED");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("cleans up context token on exception inside override", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_steps=[1])
def throwing_override(func, q, k, v, **kwargs):
    patch._dense_reason(None, {"step": 1})
    raise RuntimeError("Aborted inside override")

patch.make_override = lambda prev: throwing_override
op = patch.make_override(attn.sdp)
try:
    op(attn.sdp, None, None, None)
except RuntimeError:
    pass

# After exception, context is clean (None); direct dense call is detected as unplanned
attn.sdp(None, None, None)
print("UNREACHABLE_AFTER_EXCEPTION_UNPLANNED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("UNREACHABLE_AFTER_EXCEPTION_UNPLANNED");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("maintains context isolation across concurrent execution contexts", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import contextvars
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[1])
orig_override = patch.make_override(attn.sdp)
def isolated_override(func, q, k, v, **kwargs):
    reason = patch._dense_reason(q, kwargs.get("extra_options", {}))
    if reason:
        ctx = contextvars.Context()
        def isolated_task():
            attn.sdp(None, None, None)
        ctx.run(isolated_task)
        return orig_override(func, q, k, v, **kwargs)
    return "veda_result"

patch.make_override = lambda prev: isolated_override
op = patch.make_override(attn.sdp)
op(attn.sdp, None, None, None, extra_options={"block_index": 1})
print("SHOULD_NOT_REACH_HERE_ISOLATION")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    // The isolated context should have seen None for planned exclusion and failed closed
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_ISOLATION");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("records multiple legitimate head-chunk dense dispatches for one explicit exclusion and rejects subsequent unplanned call", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[2])
op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"block_index": 2, "step": 3, "head_chunks": 2})
assert res == "sdp_result"

# Subsequent call outside planned override must fail closed
attn.sdp(None, None, None)
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.plannedDenseCallCount).toBe(2);
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(1);
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
  });

  it("strictly isolates planned exclusion across concurrent threads", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import threading
import time
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

barrier = threading.Barrier(2)

patch = VedaPatch(full_attention_layers=[1])
orig_override = patch.make_override(attn.sdp)
def thread_override(func, q, k, v, **kwargs):
    reason = patch._dense_reason(q, kwargs.get("extra_options", {}))
    barrier.wait()
    time.sleep(0.2)
    return orig_override(func, q, k, v, **kwargs)

patch.make_override = lambda prev: thread_override
op = patch.make_override(attn.sdp)

def worker_thread():
    op(attn.sdp, None, None, None, extra_options={"block_index": 1})

t = threading.Thread(target=worker_thread)
t.start()

barrier.wait()
# Main thread calls dense sdp while worker_thread holds planned exclusion in its thread
# Because ContextVar is thread-local, main thread sees None and must trigger failure
attn.sdp(None, None, None)
t.join()
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("fails closed when override executes without calling an actual exclusion decision method (unobserved decision)", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[1])
def unobserved_override(func, q, k, v, **kwargs):
    # Override executes SDPA directly WITHOUT calling patch._dense_reason
    return func(q, k, v, **kwargs)

patch.make_override = lambda prev: unobserved_override
op = patch.make_override(attn.sdp)
op(attn.sdp, None, None, None, extra_options={"block_index": 1})
print("SHOULD_NOT_REACH_HERE_UNOBSERVED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_UNOBSERVED");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("fails closed when _dense_reason is called directly outside override scope", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[1])
# Directly call _dense_reason outside make_override/override
reason = patch._dense_reason(None, {"block_index": 1})
assert reason == "full-attention layer"

# Now execute SDPA outside override; direct call must NOT have opened planned scope
attn.sdp(None, None, None)
print("SHOULD_NOT_REACH_HERE_DIRECT_CALL")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_DIRECT_CALL");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("extracts layer 0 and step 0 correctly without treating 0 as falsy", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[0], full_attention_steps=[0])
op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"block_index": 0, "step": 0})
assert res == "sdp_result"
print("LAYER_ZERO_STEP_ZERO_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LAYER_ZERO_STEP_ZERO_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    const stepRecords = (
      diagnostic?.metadata as unknown as {
        stepRecords?: Array<{ callType: string; metadata?: Record<string, unknown> }>;
      }
    )?.stepRecords;
    expect(stepRecords).toBeDefined();
    expect(stepRecords?.[0]?.metadata?.layer).toBe(0);
    expect(stepRecords?.[0]?.metadata?.step).toBe(0);
  });

  it("fails closed when VedaPatch lacks decision methods (missing hook) under allowPlannedDense=true", async () => {
    createMockComfyModules({
      includeSage: true,
      throwInSage: false,
      customVedaSource: `
class VedaPatch:
    def make_override(self, previous):
        def override(*args, **kwargs):
            return previous(*args, **kwargs)
        return override
`
    });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch()
op = patch.make_override(attn.sdp)
op(attn.sdp, None, None, None, {})
print("SHOULD_NOT_REACH_HERE_NO_DECISION_METHOD")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_NO_DECISION_METHOD");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("extracts layer and step when passed via extra_options keyword argument", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[99], full_attention_steps=[7])
op = patch.make_override(attn.sdp)
res = op(attn.sdp, None, None, None, extra_options={"layer": 3, "step_index": 7})
assert res == "sdp_result"
print("EXTRA_OPTIONS_KWARG_SUCCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("EXTRA_OPTIONS_KWARG_SUCCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    const stepRecords = (
      diagnostic?.metadata as unknown as {
        stepRecords?: Array<{ callType: string; metadata?: Record<string, unknown> }>;
      }
    )?.stepRecords;
    expect(stepRecords).toBeDefined();
    expect(stepRecords?.[0]?.metadata?.reason).toBe("full-attention step");
    expect(stepRecords?.[0]?.metadata?.layer).toBe(3);
    expect(stepRecords?.[0]?.metadata?.step).toBe(7);
  });

  it("fails closed on unverified local VedaPatch class defined in __main__", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn

# Locally defined VedaPatch in __main__ (not from veda_comfy/comfy_patch.py)
class VedaPatch:
    def _dense_reason(self, q, options):
        return "full-attention layer"
    def _block_reason(self, options):
        return None
    def make_override(self, previous):
        def override(*args, **kwargs):
            self._dense_reason(None, {})
            return previous(*args, **kwargs)
        return override

patch = VedaPatch()
op = patch.make_override(attn.sdp)
op(None, None, None, {})
print("SHOULD_NOT_REACH_HERE_UNVERIFIED_SOURCE")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_UNVERIFIED_SOURCE");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("enforces same-context instance ownership across multiple VedaPatch instances", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch_A = VedaPatch(full_attention_layers=[])
patch_B = VedaPatch(full_attention_layers=[1])

def cross_instance_override(func, q, k, v, **kwargs):
    # Call patch_B's decision method inside patch_A's override
    reason = patch_B._dense_reason(q, {"block_index": 1})
    assert reason == "full-attention layer"
    # Dispatch dense attention under patch_A's override scope
    return attn.sdp(q, k, v)

patch_A.make_override = lambda prev: cross_instance_override
op_A = patch_A.make_override(attn.sdp)
op_A(attn.sdp, None, None, None, extra_options={"block_index": 1})
print("SHOULD_NOT_REACH_HERE_CROSS_INSTANCE")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_CROSS_INSTANCE");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("fails closed on locally defined VedaPatch spoofing __module__ with non-veda source file", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn

# Locally defined VedaPatch in __main__ that spoofs __module__
class VedaPatch:
    __module__ = "veda_comfy.comfy_patch"
    def _dense_reason(self, q, options):
        return "full-attention layer"
    def _block_reason(self, options):
        return None
    def make_override(self, previous):
        def override(*args, **kwargs):
            self._dense_reason(None, {})
            return previous(*args, **kwargs)
        return override
    def _routed_forward(self, func, q, k, v, **kwargs):
        self._dense_reason(q, {})
        return func(q, k, v)

patch = VedaPatch()
op = patch.make_override(attn.sdp)
op(None, None, None, {})
print("SHOULD_NOT_REACH_HERE_SPOOFED_MODULE")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_SPOOFED_MODULE");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("fails closed when _routed_forward encounters unsupported exclusion reason such as layer outside the predictor", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
from veda_comfy.comfy_patch import VedaPatch

patch = VedaPatch(full_attention_layers=[])
# Return an unverified / unsupported reason that indicates missing predictor coverage
patch._dense_reason = lambda q, opt: "layer outside the predictor"
patch._routed_forward(attn.sdp, None, None, None, extra_options={"block_index": 2})
print("SHOULD_NOT_REACH_HERE_UNSUPPORTED_REASON_ROUTED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_REACH_HERE_UNSUPPORTED_REASON_ROUTED");
    expect(result.stderr).toContain(
      "Unexpected dense attention call executed during accelerated regime"
    );
  });

  it("hooks optimized_attention and records fallback when exception is raised under dense regime", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false, throwInOptimized: true });

    const script = `
import comfy.ldm.modules.attention as attn

try:
    attn.optimized_attention(None, None, None)
except RuntimeError:
    print("OPTIMIZED_ATTENTION_CAUGHT_EXCEPTION")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "dense",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.stdout).toContain("OPTIMIZED_ATTENTION_CAUGHT_EXCEPTION");
    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("fallback");
    const fallbacks = diagnostic?.metadata?.attentionSummary?.fallbackEvents;
    expect(fallbacks?.length).toBeGreaterThan(0);
    expect(fallbacks?.[0]?.requestedBackend).toBe("accelerated");
    expect(fallbacks?.[0]?.fallbackBackend).toBe("torch_sdpa");
    expect(fallbacks?.[0]?.reason).toContain("Optimized attention execution error");
  });

  it("terminates unconditionally on accelerated optimized_attention fallback regardless of allowPlannedDense", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false, throwInOptimized: true });

    const script = `
import comfy.ldm.modules.attention as attn

try:
    attn.optimized_attention(None, None, None)
except RuntimeError:
    pass
print("SHOULD_NOT_EXECUTE_AFTER_ACCELERATED_FALLBACK")
`;

    const resultFalse = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "false"
    });

    expect(resultFalse.status).not.toBe(0);
    expect(resultFalse.stdout).not.toContain("SHOULD_NOT_EXECUTE_AFTER_ACCELERATED_FALLBACK");
    expect(resultFalse.stderr).toContain("Terminal attention experiment failure");

    const resultTrue = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(resultTrue.status).not.toBe(0);
    expect(resultTrue.stdout).not.toContain("SHOULD_NOT_EXECUTE_AFTER_ACCELERATED_FALLBACK");
    expect(resultTrue.stderr).toContain("Terminal attention experiment failure");
  });

  it("prevents double-counting in nested dense dispatch using re-entrancy guard", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    // attention_pytorch calls comfy.ops.scaled_dot_product_attention internally
    const script = `
import comfy.ldm.modules.attention as attn
# Execute 3 calls through attention_pytorch
for _ in range(3):
    res = attn.attention_pytorch(None, None, None)
    assert res == "scaled_dot_product_attention_result"
print("DISPATCH_COMPLETE")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "torch_sdpa",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DISPATCH_COMPLETE");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    // Exactly 3 calls should be counted, not 6
    expect(diagnostic?.metadata?.attentionSummary?.denseCallCount).toBe(3);
    expect(diagnostic?.metadata?.attentionSummary?.actualBackend).toBe("torch_sdpa");
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("verified");
  });

  it("verifies accelerated call counting and v2-jsonl handshake emission on successful run", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false });

    const script = `
import comfy.ldm.modules.attention as attn
for _ in range(5):
    res = attn.sageattn(None, None, None)
    assert res == "sage_result"
print("SAGE_RUN_OK")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SAGE_RUN_OK");

    // Check handshake point event
    const handshakeEvent = result.events.find(
      (e) => e.type === "point_event" && e.metadata?.handshake === "v2-jsonl"
    );
    expect(handshakeEvent).toBeDefined();
    expect(handshakeEvent?.protocolVersion).toBe("v2-jsonl");
    expect(handshakeEvent?.runId).toBe("test-run-123");
    expect(handshakeEvent?.attemptToken).toBe("attempt-token-abc");

    // Check diagnostic attention summary
    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.acceleratedCallCount).toBe(5);
    expect(diagnostic?.metadata?.attentionSummary?.actualBackend).toBe("sage");
    expect(diagnostic?.metadata?.attentionSummary?.dispatchImplementation).toBe(
      "sageattention.sageattn"
    );
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("verified");
  });

  it("permanently records fallback even when caller swallows the exception under dense regime", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: false, throwInOptimized: true });

    // Under dense regime, fallback is nonfatal so caller can catch and proceed
    const script = `
import comfy.ldm.modules.attention as attn
try:
    attn.optimized_attention(None, None, None)
except Exception:
    pass
print("SWALLOWED_EXCEPTION_PROCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "dense",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.stdout).toContain("SWALLOWED_EXCEPTION_PROCEEDED");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("fallback");
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents.length).toBeGreaterThan(0);
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.requestedBackend).toBe(
      "accelerated"
    );
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.fallbackBackend).toBe(
      "torch_sdpa"
    );
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.reason).toContain(
      "Optimized attention execution error"
    );
  });

  it("prevents swallowing kernel exception under accelerated regime by terminating immediately", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: true });

    const script = `
import comfy.ldm.modules.attention as attn
try:
    attn.sageattn(None, None, None)
except Exception:
    print("SWALLOWED_ACCELERATED_EXCEPTION")
print("PROCEEDED_AFTER_SWALLOWED_ACCELERATED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SWALLOWED_ACCELERATED_EXCEPTION");
    expect(result.stdout).not.toContain("PROCEEDED_AFTER_SWALLOWED_ACCELERATED");
    expect(result.stderr).toContain("Terminal attention experiment failure");
  });

  it("fails startup when sol_attn kernel is missing under requested sol_attn regime", async () => {
    createMockComfyModules({ includeSage: false });

    const script = `print("SHOULD_NOT_RUN")`;
    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sol_attn",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_RUN");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.missingKernelFailure).toContain("sol_attn");
  });

  it("fails startup when veda kernel is missing under requested veda regime", async () => {
    createMockComfyModules({ includeSage: false });

    const script = `print("SHOULD_NOT_RUN")`;
    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "veda",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("SHOULD_NOT_RUN");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("failed");
    expect(diagnostic?.metadata?.attentionSummary?.missingKernelFailure).toContain("veda");
  });

  describe("SamplerCustomAdvanced & Conditioning Hooks", () => {
    function setupSamplerAndConditioningMocks() {
      createMockComfyModules({ includeSage: false });

      const customSamplerPy = `
class SamplerCustomAdvanced:
    @classmethod
    def execute(cls, noise, guider, sampler, sigmas, latent_image, *args, **kwargs):
        if hasattr(guider, "sample"):
            guider_res = guider.sample(noise, latent_image, sampler, sigmas)
            return (guider_res,)
        return (noise,)

    sample = execute
`;
      writeFileSync(join(comfyDir, "comfy_extras", "nodes_custom_sampler.py"), customSamplerPy);

      const minimaxNodesPy = `
class ComfyNode:
    FUNCTION = "EXECUTE_NORMALIZED"
    @classmethod
    def EXECUTE_NORMALIZED(cls, *args, **kwargs):
        # Base ComfyNode dispatches to cls.execute when FUNCTION == "EXECUTE_NORMALIZED"
        return cls.execute(*args, **kwargs)

class MiniMaxH3ImageToVideo(ComfyNode):
    @classmethod
    def execute(cls, clip, vae, prompt, width, height, length, first_frame=None, last_frame=None, audio_vae=None):
        if prompt == "RAISE_EXCEPTION":
            raise ValueError("Simulated I2V conditioning failure")
        return ({"positive": prompt, "first_frame": first_frame, "last_frame": last_frame},)

class MiniMaxH3ReferenceToVideo(ComfyNode):
    @classmethod
    def execute(cls, clip, vae, prompt, width, height, length, ref_image_size, ref_images=None, audio_vae=None):
        if prompt == "RAISE_EXCEPTION":
            raise ValueError("Simulated Ref2V conditioning failure")
        return ({"positive": prompt, "ref_images": ref_images},)
`;
      writeFileSync(join(comfyDir, "comfy_extras", "nodes_minimax_h3.py"), minimaxNodesPy);

      const sparseNodesPy = `
class BlockSparseAttention:
    FUNCTION = "apply_sparse_attention"
    @classmethod
    def apply_sparse_attention(cls, model, *args, **kwargs):
        return (model,)
`;
      writeFileSync(join(comfyDir, "comfy_extras", "nodes_sparse_attention.py"), sparseNodesPy);
    }

    it("hooks SamplerCustomAdvanced preserving @classmethod, chains callbacks preserving return value, and restores guider.sample in finally", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class MockGuider:
    def __init__(self, steps=4):
        self.steps = steps
        self.seen_cb_returns = []

    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        for i in range(self.steps):
            if cb:
                ret = cb(i, f"x0_{i}", f"x_{i}", self.steps)
                self.seen_cb_returns.append(ret)
        return {"output_samples": "ok"}

# Verify SamplerCustomAdvanced is a classmethod
guider = MockGuider(steps=4)
orig_sample_func = guider.sample

def caller_callback(step, x0, x, total_s):
    return f"preview_val_{step}"

latent_in = {"samples": "initial", "callback": caller_callback}

# Test calling via classmethod directly
node_cls = custom_sampler.SamplerCustomAdvanced
out = node_cls.execute("noise_tensor", guider, "res_multistep", [1.0, 0.5, 0.0], latent_in)

# 1. Check returned output
assert out == ({"output_samples": "ok"},), f"Unexpected out: {out}"

# 2. Check callback return values were preserved
assert guider.seen_cb_returns == ["preview_val_0", "preview_val_1", "preview_val_2", "preview_val_3"], f"CB returns: {guider.seen_cb_returns}"

# 3. Check guider.sample was restored to the original function
assert guider.sample == orig_sample_func, "guider.sample was not restored in finally!"

print("SAMPLER_CLASSMETHOD_AND_CALLBACK_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SAMPLER_CLASSMETHOD_AND_CALLBACK_OK");

      // Verify events: exactly 4 sampling_step spans emitted, no invented step spans on entry/exit
      const stepStartEvents = result.events.filter(
        (e) => e.phase === "sampling_step" && e.type === "span_start"
      );
      const stepEndEvents = result.events.filter(
        (e) => e.phase === "sampling_step" && e.type === "span_end"
      );
      expect(stepStartEvents.length).toBe(4);
      expect(stepEndEvents.length).toBe(4);

      const stepIndices = stepStartEvents.map(
        (e) => (e as unknown as { stepIndex: number }).stepIndex
      );
      expect(stepIndices).toEqual([0, 1, 2, 3]);

      // Verify sampling span exists
      const samplingStart = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_start"
      );
      const samplingEnd = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingStart).toBeDefined();
      expect(samplingEnd?.outcome).toBe("success");
    });

    it("drives a real TeaCache session through the SamplerCustomAdvanced hook end-to-end (issue #467)", async () => {
      setupSamplerAndConditioningMocks();
      const teaCacheDir = stageTeaCacheAdapter();

      const script = `
import sys
sys.path.insert(0, ${JSON.stringify(teaCacheDir)})
import teacache  # pre-import the adapter staged inside the target custom_nodes (the only place resolution looks)

import comfy_extras.nodes_custom_sampler as custom_sampler

class MockModelPatcher:
    def __init__(self):
        self.model_options = {
            "teacache_config": {
                "rel_l1_thresh": 0.15,
                "start_step": 2,
                "end_step": -2,
                "total_steps": 20,
                "model_id": "mock-model-1"
            }
        }

class MockGuider:
    def __init__(self, steps=20):
        self.steps = steps
        self.model_patcher = MockModelPatcher()

    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        for i in range(self.steps):
            if cb:
                cb(i, f"x0_{i}", f"x_{i}", self.steps)
        return {"output_samples": "ok"}

guider = MockGuider(steps=20)
sigmas_list = [float(20 - i) for i in range(21)]  # 21 strictly descending sigmas, 20.0 down to 0.0
latent_in = {"samples": "initial"}

out = custom_sampler.SamplerCustomAdvanced.execute("noise_tensor", guider, "res_multistep", sigmas_list, latent_in)
assert out == ({"output_samples": "ok"},), f"Unexpected out: {out}"
print("TEACACHE_SAMPLER_HOOK_OK")
`;

      const result = runCollectorWithScript(script);
      if (result.status !== 0) {
        console.error("STDOUT:", result.stdout, "STDERR:", result.stderr);
      }
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("TEACACHE_SAMPLER_HOOK_OK");

      // The real regression this guards against: every collector.emit() call
      // along the TeaCache session_init/end path requires a positional
      // span_id, and previously several call sites omitted it -- crashing
      // every real candidate/matched-control run with TypeError before any
      // of this telemetry was ever written. This mock guider drives the
      // session lifecycle (advance_step via the sampling callback) but does
      // not simulate an actual model_function_wrapper forward call, so
      // forwardCalls/cacheHits are legitimately 0 here -- the point of this
      // test is that the full session_init -> 20 steps -> session_end
      // lifecycle completes and every emitted event carries a real spanId.
      const initEvents = result.events.filter((e) => e.metadata?.teacacheEvent === "session_init");
      expect(initEvents.length).toBe(1);
      expect(initEvents[0]?.spanId).toBeTruthy();

      const endEvents = result.events.filter((e) => e.metadata?.teacacheSession === "end");
      expect(endEvents.length).toBe(1);
      expect(endEvents[0]?.spanId).toBeTruthy();
      expect(
        (endEvents[0]?.metadata?.summary as { forwardCalls?: number } | undefined)?.forwardCalls
      ).toBe(0);

      for (const e of result.events) {
        expect(e.spanId).toBeTruthy();
      }
    });

    it("restores diffusion_model.forward and the sampling-step buffer when TeaCache session setup itself raises (issue #467)", async () => {
      setupSamplerAndConditioningMocks();
      const teaCacheDir = stageTeaCacheAdapter();

      // A rejected unallowlisted threshold makes TeaCacheSession's
      // constructor raise -- this happens inside the single setup/execute
      // try block, after diffusion_model.forward and the sampling-step
      // buffer were already mutated. Previously, only the narrower
      // set_active_session/advance_step region unwound on failure; a raise
      // from session construction itself (or from anything else in this
      // region) skipped that unwind entirely and left diffusion_model.forward
      // monkey-patched and the buffer token unreset for whatever runs next
      // in this process.
      const script = `
import sys
sys.path.insert(0, ${JSON.stringify(teaCacheDir)})
import teacache

import comfy_extras.nodes_custom_sampler as custom_sampler

class MockDiffusionModel:
    def __init__(self):
        self.forward = self._orig_forward
    def _orig_forward(self, *a, **kw):
        return "real_forward_output"

class MockBaseModel:
    def __init__(self):
        self.diffusion_model = MockDiffusionModel()

class MockModelPatcher:
    def __init__(self):
        self.model = MockBaseModel()
        self.model_options = {
            "teacache_config": {
                "rel_l1_thresh": 0.33,  # not in SUPPORTED_THRESHOLDS -- raises in TeaCacheSession.__init__
                "start_step": 2,
                "end_step": -2,
                "total_steps": 20,
                "model_id": "mock-model-setup-fail"
            }
        }

class MockGuider:
    def __init__(self):
        self.model_patcher = MockModelPatcher()
    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        raise AssertionError("sample() must never be reached -- setup should fail first")

guider = MockGuider()
diffusion_model_ref = guider.model_patcher.model.diffusion_model
orig_forward_ref = diffusion_model_ref._orig_forward

try:
    custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
    assert False, "Expected setup failure to propagate"
except ValueError as e:
    assert "rel_l1_thresh" in str(e), f"Unexpected error: {e}"

# The real regression: diffusion_model.forward must be restored to the
# original bound method, not left pointing at the now-orphaned hook.
assert diffusion_model_ref.forward == orig_forward_ref, "diffusion_model.forward was not restored after setup failure!"
assert diffusion_model_ref.forward("x") == "real_forward_output"

print("SETUP_FAILURE_CLEANUP_OK")
`;

      const result = runCollectorWithScript(script);
      if (result.status !== 0) {
        console.error("STDOUT:", result.stdout, "STDERR:", result.stderr);
      }
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("SETUP_FAILURE_CLEANUP_OK");

      const samplingEnd = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingEnd?.outcome).toBe("failed");
      expect(samplingEnd?.error?.message).toContain("rel_l1_thresh");

      // No session_init/session_end was ever emitted for this failed-setup
      // attempt, and no live TeaCacheSession should remain registered
      // (proving the ownership registry itself didn't leak either).
      const initEvents = result.events.filter((e) => e.metadata?.teacacheEvent === "session_init");
      expect(initEvents.length).toBe(0);
    });

    it("restores guider.sample even when SamplerCustomAdvanced execution raises an exception", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class FaultyGuider:
    def sample(self, *args, **kwargs):
        raise ValueError("Simulated sampling failure")

guider = FaultyGuider()
orig_sample = guider.sample

try:
    custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
except ValueError:
    pass

assert guider.sample == orig_sample, "guider.sample was not restored after exception!"
print("GUIDER_RESTORED_ON_EXCEPTION")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("GUIDER_RESTORED_ON_EXCEPTION");

      const samplingEnd = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingEnd?.outcome).toBe("failed");
      expect(samplingEnd?.error?.message).toContain("Simulated sampling failure");
    });

    it("hooks MiniMaxH3 conditioning nodes as @classmethod emitting signature-faithful taskMode and referenceCount metadata without recursion under EXECUTE_NORMALIZED", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_minimax_h3 as nodes_minimax_h3
import comfy_extras.nodes_sparse_attention as sparse_attn

# 1. MiniMaxH3ImageToVideo with first_frame only (1 anchor)
res_i2v_1 = nodes_minimax_h3.MiniMaxH3ImageToVideo.execute(
    clip="clip", vae="vae", prompt="First frame only", width=1344, height=768, length=124,
    first_frame="frame0"
)
assert res_i2v_1 == ({"positive": "First frame only", "first_frame": "frame0", "last_frame": None},)

# 2. MiniMaxH3ImageToVideo with first_frame and last_frame (2 anchors) via EXECUTE_NORMALIZED (verifies no recursion)
res_i2v_2 = nodes_minimax_h3.MiniMaxH3ImageToVideo.EXECUTE_NORMALIZED(
    clip="clip", vae="vae", prompt="First and last frame", width=1344, height=768, length=124,
    first_frame="frame0", last_frame="frame_tail"
)
assert res_i2v_2 == ({"positive": "First and last frame", "first_frame": "frame0", "last_frame": "frame_tail"},)

# 3. MiniMaxH3ImageToVideo with no anchors (0 anchors)
res_i2v_0 = nodes_minimax_h3.MiniMaxH3ImageToVideo.execute(
    clip="clip", vae="vae", prompt="No anchors", width=1344, height=768, length=124,
    first_frame=None, last_frame=None
)

# 4. MiniMaxH3ImageToVideo positional call
res_i2v_pos = nodes_minimax_h3.MiniMaxH3ImageToVideo.execute(
    "clip", "vae", "Positional I2V", 1344, 768, 124, "frame_pos"
)

# 5. MiniMaxH3ReferenceToVideo with 1 reference
res_ref2v_1 = nodes_minimax_h3.MiniMaxH3ReferenceToVideo.execute(
    clip="clip", vae="vae", prompt="1 reference", width=1344, height=768, length=124, ref_image_size="max",
    ref_images={"ref_image_0": "img0"}
)
assert res_ref2v_1 == ({"positive": "1 reference", "ref_images": {"ref_image_0": "img0"}},)

# 6. MiniMaxH3ReferenceToVideo with 9 references via EXECUTE_NORMALIZED (verifies no recursion)
nine_refs = {f"ref_image_{i}": f"img{i}" for i in range(9)}
res_ref2v_9 = nodes_minimax_h3.MiniMaxH3ReferenceToVideo.EXECUTE_NORMALIZED(
    clip="clip", vae="vae", prompt="9 references", width=1344, height=768, length=124, ref_image_size="max",
    ref_images=nine_refs
)

# 7. MiniMaxH3ReferenceToVideo with 0 references (empty dict)
res_ref2v_0 = nodes_minimax_h3.MiniMaxH3ReferenceToVideo.execute(
    clip="clip", vae="vae", prompt="0 references", width=1344, height=768, length=124, ref_image_size="max",
    ref_images={}
)

# 8. MiniMaxH3ReferenceToVideo with dict containing null values (counts non-null values only)
res_ref2v_nulls = nodes_minimax_h3.MiniMaxH3ReferenceToVideo.execute(
    clip="clip", vae="vae", prompt="Dict with null values", width=1344, height=768, length=124, ref_image_size="max",
    ref_images={"ref_image_0": None, "ref_image_1": "img1", "ref_image_2": None}
)

# 9. MiniMaxH3ReferenceToVideo positional call with 3 references
res_ref2v_pos = nodes_minimax_h3.MiniMaxH3ReferenceToVideo.execute(
    "clip", "vae", "Positional Ref2V", 1344, 768, 124, "max",
    {"ref_image_0": "img0", "ref_image_1": "img1", "ref_image_2": "img2"}
)

# 10. BlockSparseAttention VSA dispatch
sparse_attn.BlockSparseAttention.apply_sparse_attention("model_mock")

print("CONDITIONING_HOOKS_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("CONDITIONING_HOOKS_OK");

      const conditioningSpans = result.events.filter(
        (e) => e.phase === "conditioning" && e.type === "span_start"
      );
      expect(conditioningSpans.length).toBe(9);

      // Verify I2V spans
      expect(conditioningSpans[0]?.metadata?.taskMode).toBe("i2v");
      expect(conditioningSpans[0]?.metadata?.referenceCount).toBe(1);

      expect(conditioningSpans[1]?.metadata?.taskMode).toBe("i2v");
      expect(conditioningSpans[1]?.metadata?.referenceCount).toBe(2);

      expect(conditioningSpans[2]?.metadata?.taskMode).toBe("i2v");
      expect(conditioningSpans[2]?.metadata?.referenceCount).toBe(0);

      expect(conditioningSpans[3]?.metadata?.taskMode).toBe("i2v");
      expect(conditioningSpans[3]?.metadata?.referenceCount).toBe(1);

      // Verify Ref2V spans
      expect(conditioningSpans[4]?.metadata?.taskMode).toBe("ref2v");
      expect(conditioningSpans[4]?.metadata?.referenceCount).toBe(1);

      expect(conditioningSpans[5]?.metadata?.taskMode).toBe("ref2v");
      expect(conditioningSpans[5]?.metadata?.referenceCount).toBe(9);

      expect(conditioningSpans[6]?.metadata?.taskMode).toBe("ref2v");
      expect(conditioningSpans[6]?.metadata?.referenceCount).toBe(0);

      expect(conditioningSpans[7]?.metadata?.taskMode).toBe("ref2v");
      expect(conditioningSpans[7]?.metadata?.referenceCount).toBe(1); // 1 non-null out of 3

      expect(conditioningSpans[8]?.metadata?.taskMode).toBe("ref2v");
      expect(conditioningSpans[8]?.metadata?.referenceCount).toBe(3);
    });

    it("propagates exceptions and emits failed outcome for conditioning span when execute raises", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_minimax_h3 as nodes_minimax_h3

try:
    nodes_minimax_h3.MiniMaxH3ImageToVideo.execute(
        clip="clip", vae="vae", prompt="RAISE_EXCEPTION", width=1344, height=768, length=124
    )
except ValueError as e:
    print(f"CAUGHT_I2V_EXCEPTION: {e}")

try:
    nodes_minimax_h3.MiniMaxH3ReferenceToVideo.execute(
        clip="clip", vae="vae", prompt="RAISE_EXCEPTION", width=1344, height=768, length=124, ref_image_size="max"
    )
except ValueError as e:
    print(f"CAUGHT_REF2V_EXCEPTION: {e}")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("CAUGHT_I2V_EXCEPTION: Simulated I2V conditioning failure");
      expect(result.stdout).toContain(
        "CAUGHT_REF2V_EXCEPTION: Simulated Ref2V conditioning failure"
      );

      const failedConditioningSpans = result.events.filter(
        (e) => e.phase === "conditioning" && e.type === "span_end" && e.outcome === "failed"
      );
      expect(failedConditioningSpans.length).toBe(2);
      expect(failedConditioningSpans[0]?.error?.message).toContain(
        "Simulated I2V conditioning failure"
      );
      expect(failedConditioningSpans[1]?.error?.message).toContain(
        "Simulated Ref2V conditioning failure"
      );
    });

    it("emits 0 step spans when sampler returns without calling callback (no callbacks)", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class SilentGuider:
    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        # Never invokes callback
        return {"output_samples": "silent_ok"}

guider = SilentGuider()
custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
print("NO_CALLBACK_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("NO_CALLBACK_OK");

      const stepSpans = result.events.filter((e) => e.phase === "sampling_step");
      expect(stepSpans.length).toBe(0);

      const samplingEnd = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingEnd?.outcome).toBe("success");
    });

    it("emits 0 step spans when sampler runs with 0 steps", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class ZeroStepGuider:
    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        # 0 steps loop
        for i in range(0):
            if cb:
                cb(i, "x0", "x", 0)
        return {"output_samples": "zero_steps_ok"}

guider = ZeroStepGuider()
custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
print("ZERO_STEPS_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ZERO_STEPS_OK");

      const stepSpans = result.events.filter((e) => e.phase === "sampling_step");
      expect(stepSpans.length).toBe(0);

      const samplingEnd = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingEnd?.outcome).toBe("success");
    });

    it("emits step spans for executed steps and marks sampling failed on exception during step 2", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class FailingGuider:
    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        for i in range(4):
            if i == 2:
                raise RuntimeError("Abort at step 2")
            if cb:
                cb(i, f"x0_{i}", f"x_{i}", 4)
        return {"output_samples": "unreachable"}

guider = FailingGuider()
try:
    custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
except RuntimeError as e:
    print(f"CAUGHT_STEP_EXCEPTION: {e}")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("CAUGHT_STEP_EXCEPTION: Abort at step 2");

      const stepStarts = result.events.filter(
        (e) => e.phase === "sampling_step" && e.type === "span_start"
      );
      const stepEnds = result.events.filter(
        (e) => e.phase === "sampling_step" && e.type === "span_end"
      );
      // Exactly steps 0 and 1 were emitted before abort at step 2
      expect(stepStarts.length).toBe(2);
      expect(stepEnds.length).toBe(2);
      const indices = stepStarts.map((e) => (e as unknown as { stepIndex: number }).stepIndex);
      expect(indices).toEqual([0, 1]);

      const samplingEnd = result.events.find(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingEnd?.outcome).toBe("failed");
      expect(samplingEnd?.error?.message).toContain("Abort at step 2");
    });

    it("deduplicates callback invocations with identical step index", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class DuplicateCallbackGuider:
    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        # Call step 0 multiple times, step 1 multiple times
        if cb:
            cb(0, "x0_0", "x_0", 2)
            cb(0, "x0_0_dup", "x_0_dup", 2)
            cb(1, "x0_1", "x_1", 2)
            cb(1, "x0_1_dup", "x_1_dup", 2)
        return {"output_samples": "dedup_ok"}

guider = DuplicateCallbackGuider()
custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
print("DUPLICATE_CALLBACK_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("DUPLICATE_CALLBACK_OK");

      const stepStarts = result.events.filter(
        (e) => e.phase === "sampling_step" && e.type === "span_start"
      );
      expect(stepStarts.length).toBe(2);
      const indices = stepStarts.map((e) => (e as unknown as { stepIndex: number }).stepIndex);
      expect(indices).toEqual([0, 1]);
    });

    it("maintains independent state across repeated sampler invocations", async () => {
      setupSamplerAndConditioningMocks();

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler

class MultiRunGuider:
    def __init__(self, steps):
        self.steps = steps

    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        for i in range(self.steps):
            if cb:
                cb(i, f"x0_{i}", f"x_{i}", self.steps)
        return {"output_samples": f"run_{self.steps}"}

# First run: 2 steps
guider1 = MultiRunGuider(2)
custom_sampler.SamplerCustomAdvanced.execute("noise", guider1, "sampler", [], {})

# Second run: 3 steps
guider2 = MultiRunGuider(3)
custom_sampler.SamplerCustomAdvanced.execute("noise", guider2, "sampler", [], {})

print("REPEATED_INVOCATIONS_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("REPEATED_INVOCATIONS_OK");

      const samplingEnds = result.events.filter(
        (e) => e.phase === "sampling" && e.type === "span_end"
      );
      expect(samplingEnds.length).toBe(2);
      expect(samplingEnds.every((e) => e.outcome === "success")).toBe(true);

      const stepStarts = result.events.filter(
        (e) => e.phase === "sampling_step" && e.type === "span_start"
      );
      // Run 1 had 2 steps, Run 2 had 3 steps -> total 5 steps
      expect(stepStarts.length).toBe(5);
      const indices = stepStarts.map((e) => (e as unknown as { stepIndex: number }).stepIndex);
      expect(indices).toEqual([0, 1, 0, 1, 2]);
    });

    it("does not misattribute calls buffered after a duplicate step-completion callback to the next step (F-a4b12b34)", async () => {
      setupSamplerAndConditioningMocks();

      // Exercises the running collector module's internals directly via
      // sys.modules["__main__"] (the collector script itself, since it is always run
      // as the top-level script by the bootstrap harness). Reproduces the reviewer's
      // exact probe: call/callback(0), call/callback(0) [duplicate], call/callback(1).
      const script = `
import sys
collector_mod = sys.modules["__main__"]

buf = collector_mod.StepIntervalBuffer()
token = collector_mod._SAMPLING_STEP_CALL_BUFFER.set(buf)
try:
    # Step 0: one accelerated call, then the step completes.
    collector_mod._ATTENTION_TRACKER.record_accelerated("sage", "sageattention.sageattn", step_index=0)
    collector_mod.flush_step_buffer(0)

    # Duplicate completion callback for step 0 (e.g. a retried/duplicate sampler
    # callback invocation). A call recorded after the first flush but before this
    # duplicate completion must NOT silently bleed into step 1's flush below.
    collector_mod._ATTENTION_TRACKER.record_accelerated("sage", "sageattention.sageattn", step_index=0)
    collector_mod.flush_step_buffer(0)

    # Step 1: one genuine accelerated call, then the step completes.
    collector_mod._ATTENTION_TRACKER.record_accelerated("sage", "sageattention.sageattn", step_index=1)
    collector_mod.flush_step_buffer(1)
finally:
    collector_mod._SAMPLING_STEP_CALL_BUFFER.reset(token)

step_records = collector_mod._ATTENTION_TRACKER.step_records
step_indices = [r["stepIndex"] for r in step_records]
unflushed = collector_mod._ATTENTION_TRACKER.unflushed_calls_count
print(f"STEP_INDICES={step_indices}")
print(f"UNFLUSHED={unflushed}")
print("DUPLICATE_STEP_PROBE_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("DUPLICATE_STEP_PROBE_OK");
      // Exactly one record for step 0 and one for step 1 -- the duplicate-completion
      // call must not have been attributed to step 1.
      expect(result.stdout).toContain("STEP_INDICES=[0, 1]");
      // The duplicate-completion call is retained as evidence of a genuine conflict
      // (unflushed), not silently discarded or misattributed.
      expect(result.stdout).toContain("UNFLUSHED=1");
    });

    it("fails closed and blocks the run when SamplerCustomAdvanced is missing", async () => {
      createMockComfyModules({ omitCustomSampler: true });

      const script = `
print("SHOULD_NOT_EXECUTE")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("SHOULD_NOT_EXECUTE");

      const startupEnd = result.events.find(
        (e) => e.phase === "environment_startup" && e.type === "span_end"
      );
      expect(startupEnd?.outcome).toBe("failed");
      expect(startupEnd?.error?.message).toContain("SamplerCustomAdvanced");
    });

    it("fails closed and blocks the run when SamplerCustomAdvanced execute is malformed", async () => {
      createMockComfyModules({ corruptCustomSampler: true });

      const script = `
print("SHOULD_NOT_EXECUTE")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("SHOULD_NOT_EXECUTE");

      const startupEnd = result.events.find(
        (e) => e.phase === "environment_startup" && e.type === "span_end"
      );
      expect(startupEnd?.outcome).toBe("failed");
      expect(startupEnd?.error?.message).toContain("SamplerCustomAdvanced");
    });

    it("fails closed when requested sparse kernel export has invalid parameter shape", async () => {
      createMockComfyModules();

      await mkdir(join(comfyDir, "comfy_kitchen"), { recursive: true });
      writeFileSync(
        join(comfyDir, "comfy_kitchen", "__init__.py"),
        `def sol_attn(q):\n    return "invalid_shape"\n`
      );

      const script = `
print("SHOULD_NOT_REACH_PAYLOAD")
`;

      const result = runCollectorWithScript(script, {
        CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sol_attn"
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("SHOULD_NOT_REACH_PAYLOAD");

      const startupEnd = result.events.find(
        (e) => e.phase === "environment_startup" && e.type === "span_end"
      );
      expect(startupEnd?.outcome).toBe("failed");
    });

    it("threads step and layer indices from sampling loop and callback to stepRecords", async () => {
      createMockComfyModules({ includeSage: true });

      const script = `
import comfy_extras.nodes_custom_sampler as custom_sampler
import comfy.ldm.modules.attention as comfy_attn

class SteppingGuider:
    def sample(self, noise, latent_image, sampler, sigmas, callback=None):
        cb = callback
        if cb is None and isinstance(latent_image, dict):
            cb = latent_image.get("callback")
        for step_idx in range(3):
            comfy_attn.sageattn("q", "k", "v", extra_options={"layer": 5, "step": step_idx})
            if cb:
                cb(step_idx, f"x0_{step_idx}", f"x_{step_idx}", 3)
        return {"samples": "ok"}

guider = SteppingGuider()
custom_sampler.SamplerCustomAdvanced.execute("noise", guider, "sampler", [], {})
print("STEP_THREADING_OK")
`;

      const result = runCollectorWithScript(script);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("STEP_THREADING_OK");

      const teardownSummary = result.events.find(
        (e) => e.phase === "teardown" && e.type === "point_event" && e.metadata?.stepRecords
      );
      expect(teardownSummary).toBeDefined();
      const stepRecords = (
        teardownSummary?.metadata as {
          stepRecords: Array<{ stepIndex: number; layerIndex?: number }>;
        }
      ).stepRecords;
      expect(stepRecords.length).toBe(3);
      expect(stepRecords.map((r) => r.stepIndex)).toEqual([0, 1, 2]);
      expect(stepRecords.every((r) => r.layerIndex === 5)).toBe(true);
    });
  });
});
