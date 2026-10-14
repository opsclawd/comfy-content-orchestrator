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
});
