import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

    writeFileSync(join(comfyDir, "comfy", "__init__.py"), "");
    writeFileSync(join(comfyDir, "comfy", "ldm", "__init__.py"), "");
    writeFileSync(join(comfyDir, "comfy", "ldm", "modules", "__init__.py"), "");
    writeFileSync(join(comfyDir, "comfy_extras", "__init__.py"), "");
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  function createMockComfyModules(options: { includeSage?: boolean; throwInSage?: boolean }) {
    const attentionPy = `
def sdp(q, k, v, *args, **kwargs):
    return "sdp_result"

def attention_pytorch(q, k, v, *args, **kwargs):
    import comfy.ops as ops
    return ops.scaled_dot_product_attention(q, k, v, *args, **kwargs)

def optimized_attention(q, k, v, *args, **kwargs):
    return "optimized_result"
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
  }

  interface CollectorTestEvent {
    protocolVersion: string;
    sequence: number;
    runId: string;
    attemptToken: string;
    phase: string;
    type: string;
    boundarySource?: string;
    outcome?: string;
    error?: { message: string; exceptionType?: string };
    metadata?: {
      handshake?: string;
      taskMode?: string;
      referenceCount?: number;
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
    };
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

  it("records fallback and re-raises when accelerated kernel throws exception", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: true });

    const script = `
import comfy.ldm.modules.attention as attn
try:
    attn.sageattn(None, None, None)
except RuntimeError as e:
    print(f"CAUGHT_KERNEL_EXCEPTION: {e}")
    raise
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
      CCO_EXPERIMENT_ALLOW_PLANNED_DENSE: "true"
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("CAUGHT_KERNEL_EXCEPTION: CUDA kernel fault in sageattn");

    const diagnostic = result.events.find((e) => e.boundarySource === "diagnostic");
    expect(diagnostic?.phase).toBe("teardown");
    expect(diagnostic?.boundarySource).toBe("diagnostic");
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.metadata?.attentionSummary?.status).toBe("fallback");
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

  it("permanently records fallback even when caller swallows the kernel exception", async () => {
    createMockComfyModules({ includeSage: true, throwInSage: true });

    // The script calls sageattn, catches the exception, and swallows it without re-raising
    const script = `
import comfy.ldm.modules.attention as attn
try:
    attn.sageattn(None, None, None)
except Exception:
    pass
print("SWALLOWED_EXCEPTION_PROCEEDED")
`;

    const result = runCollectorWithScript(script, {
      CCO_EXPERIMENT_EXPECTED_ATTENTION_BACKEND: "sage",
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
      "sage"
    );
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.fallbackBackend).toBe(
      "torch_sdpa"
    );
    expect(diagnostic?.metadata?.attentionSummary?.fallbackEvents[0]?.reason).toContain(
      "CUDA kernel fault in sageattn"
    );
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
  });
});
