import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueRenderInput } from "@cco/application";
import { ComfyUiRenderEngineAdapter } from "./render-engine-adapter.js";
import { ComfyUiRenderEngineError } from "./comfyui-error.js";
import { FakeComfyUiTransport, FakeComfyUiWebSocket } from "./test-support/fake-comfyui.js";

describe("ComfyUiRenderEngineAdapter", () => {
  const sampleInput: QueueRenderInput = {
    renderJobId: "job-123",
    sceneId: "scene-456",
    renderProfileKey: "flux-dev-default",
    workflow: {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42, steps: 20 }
      }
    }
  };

  const fixedNow = new Date("2026-08-15T06:01:00.000Z");

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the WebSocket status message before submitting the prompt", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    const queuePromise = adapter.queueRender(sampleInput);

    expect(transport.createdWebSockets).toHaveLength(1);
    const ws = transport.createdWebSockets[0]!;

    // Socket open event alone must not trigger POST /prompt
    ws.open();
    expect(transport.fakeFetch.calls).toHaveLength(0);

    // Unrelated message must not trigger POST /prompt
    ws.message({ type: "crystools.monitor", data: { cpu: 12 } });
    expect(transport.fakeFetch.calls).toHaveLength(0);

    // First status message triggers POST /prompt exactly once
    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-123" });
    ws.message({ type: "status", data: { status: { exec_info: { queue_remaining: 0 } } } });

    const receipt = await queuePromise;
    expect(receipt).toEqual({
      executionId: "prompt-123",
      acceptedAt: fixedNow.toISOString()
    });

    expect(transport.fakeFetch.calls).toHaveLength(1);
    expect(transport.fakeFetch.calls[0]!.url).toBe("http://127.0.0.1:8188/prompt");
  });

  it("uses one stable client ID for the socket and prompt submission", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-stable-uuid-999",
      now: () => fixedNow
    });

    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-999" });

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;

    expect(ws.url).toBe("ws://127.0.0.1:8188/ws?clientId=client-stable-uuid-999");

    ws.message({ type: "status", data: {} });
    await queuePromise;

    expect(transport.fakeFetch.calls).toHaveLength(1);
    const postCall = transport.fakeFetch.calls[0]!;
    const parsedBody = JSON.parse(postCall.init?.body as string);
    expect(parsedBody).toEqual({
      prompt: sampleInput.workflow,
      client_id: "client-stable-uuid-999"
    });
  });

  it("buffers target events that arrive before POST /prompt resolves", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    let resolveFetch!: (res: Response) => void;
    transport.fakeFetch.setDefaultResponseHandler((url) => {
      if (String(url).includes("/prompt")) {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }
      return new Response(JSON.stringify({ error: "unhandled" }), { status: 500 });
    });

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;

    // Send readiness status
    ws.message({ type: "status", data: {} });

    // Fast completion received while POST /prompt is in flight
    ws.message({ type: "executing", data: { prompt_id: "prompt-fast-1", node: "3" } });
    ws.message({ type: "executing", data: { prompt_id: "prompt-fast-1", node: null } });

    // Set up history response for when completion is handled
    transport.fakeFetch.queueJsonResponse({
      "prompt-fast-1": {
        outputs: {
          "9": {
            images: [{ filename: "fast_output.png", subfolder: "renders" }]
          }
        },
        status: { completed: true, status_str: "success" }
      }
    });

    // Now POST /prompt resolves with prompt_id
    resolveFetch(
      new Response(JSON.stringify({ prompt_id: "prompt-fast-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const receipt = await queuePromise;
    expect(receipt.executionId).toBe("prompt-fast-1");

    // The buffered terminal executing event triggers history verification
    const result = await adapter.getRenderResult(receipt.executionId);
    expect(result).toEqual({
      executionId: "prompt-fast-1",
      status: "succeeded",
      outputObjectKeys: ["renders/fast_output.png"],
      completedAt: fixedNow.toISOString()
    });
  });

  it("ignores progress and terminal events for another prompt", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-target" });

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;
    ws.message({ type: "status", data: {} });
    const receipt = await queuePromise;

    // Send events for another prompt and non-terminal progress for target
    ws.message({ type: "progress", data: { prompt_id: "prompt-target", value: 1, max: 10 } });
    ws.message({
      type: "execution_error",
      data: { prompt_id: "prompt-other", node_id: "1", node_type: "KSampler" }
    });
    ws.message({ type: "execution_interrupted", data: { prompt_id: "prompt-other" } });
    ws.message({ type: "executing", data: { prompt_id: "prompt-other", node: null } });

    // Target is still open/active and has not settled
    expect(ws.readyState).toBe(FakeComfyUiWebSocket.CONNECTING);

    // Now send target completion
    transport.fakeFetch.queueJsonResponse({
      "prompt-target": {
        outputs: {
          "9": {
            images: [{ filename: "target.png" }]
          }
        },
        status: { completed: true, status_str: "success" }
      }
    });

    ws.message({ type: "executing", data: { prompt_id: "prompt-target", node: null } });

    const result = await adapter.getRenderResult(receipt.executionId);
    expect(result?.status).toBe("succeeded");
    expect(result?.outputObjectKeys).toEqual(["target.png"]);
  });

  it("verifies successful history before resolving and preserves image and video subfolders", async () => {
    const completionTime = new Date("2026-08-15T06:05:00.000Z");
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => completionTime
    });

    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-multi-output" });

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;
    ws.message({ type: "status", data: {} });
    const receipt = await queuePromise;

    transport.fakeFetch.queueJsonResponse({
      "prompt-multi-output": {
        outputs: {
          "9": {
            images: [
              { filename: "frame_01.png", subfolder: "renders/flux" },
              { filename: "", subfolder: "empty_ignored" },
              { filename: "frame_02.png", subfolder: "/renders/flux/" }
            ]
          },
          "10": {
            videos: [
              { filename: "clip.mp4", subfolder: "video/ltx" },
              { filename: "clip_root.mp4" }
            ]
          },
          "11": {
            images: [{ filename: "preview.jpg", subfolder: "" }]
          }
        },
        status: { completed: true, status_str: "success" }
      }
    });

    ws.message({ type: "executing", data: { prompt_id: "prompt-multi-output", node: null } });

    const result = await adapter.getRenderResult(receipt.executionId);
    expect(result).toEqual({
      executionId: "prompt-multi-output",
      status: "succeeded",
      outputObjectKeys: [
        "renders/flux/frame_01.png",
        "renders/flux/frame_02.png",
        "video/ltx/clip.mp4",
        "clip_root.mp4",
        "preview.jpg"
      ],
      completedAt: completionTime.toISOString()
    });
  });

  it("rejects target execution_error with NODE_EXECUTION_FAILED and bounded node context", async () => {
    // Test Case 1: getRenderResult attached BEFORE terminal event settles
    {
      const transport = new FakeComfyUiTransport();
      const adapter = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport,
        createClientId: () => "client-1",
        now: () => fixedNow
      });

      transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-err-1" });
      const receipt = await (async () => {
        const p = adapter.queueRender(sampleInput);
        transport.createdWebSockets[0]!.message({ type: "status", data: {} });
        return p;
      })();

      const ws = transport.createdWebSockets[0]!;
      const resultPromise = adapter.getRenderResult(receipt.executionId);

      ws.message({
        type: "execution_error",
        data: {
          prompt_id: "prompt-err-1",
          node_id: "4",
          node_type: "KSampler",
          exception_message: "CUDA out of memory: secret internal details",
          exception_type: "RuntimeError",
          traceback: ["line 1", "line 2"]
        }
      });

      try {
        await resultPromise;
        expect.unreachable("Should have rejected");
      } catch (err) {
        expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
        const comfyErr = err as ComfyUiRenderEngineError;
        expect(comfyErr.code).toBe("NODE_EXECUTION_FAILED");
        expect(comfyErr.context.promptId).toBe("prompt-err-1");
        expect(comfyErr.context.nodeId).toBe("4");
        expect(comfyErr.context.nodeType).toBe("KSampler");
        expect(comfyErr.message).not.toContain("CUDA out of memory");
        expect(comfyErr.message).not.toContain("secret internal details");
      }
    }

    // Test Case 2: getRenderResult called AFTER terminal event has already settled
    {
      const transport = new FakeComfyUiTransport();
      const adapter = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport,
        createClientId: () => "client-2",
        now: () => fixedNow
      });

      transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-err-2" });
      const receipt = await (async () => {
        const p = adapter.queueRender(sampleInput);
        transport.createdWebSockets[0]!.message({ type: "status", data: {} });
        return p;
      })();

      const ws = transport.createdWebSockets[0]!;
      ws.message({
        type: "execution_error",
        data: {
          prompt_id: "prompt-err-2",
          node_id: "7",
          node_type: "VAEDecode"
        }
      });

      // Retrieved post-settlement
      try {
        await adapter.getRenderResult(receipt.executionId);
        expect.unreachable("Should have rejected");
      } catch (err) {
        expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
        const comfyErr = err as ComfyUiRenderEngineError;
        expect(comfyErr.code).toBe("NODE_EXECUTION_FAILED");
        expect(comfyErr.context.nodeId).toBe("7");
        expect(comfyErr.context.nodeType).toBe("VAEDecode");
      }
    }
  });

  it("rejects target execution_interrupted with EXECUTION_INTERRUPTED", async () => {
    // Test Case 1: in-flight awaiting
    {
      const transport = new FakeComfyUiTransport();
      const adapter = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport,
        createClientId: () => "client-1",
        now: () => fixedNow
      });

      transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-int-1" });
      const receipt = await (async () => {
        const p = adapter.queueRender(sampleInput);
        transport.createdWebSockets[0]!.message({ type: "status", data: {} });
        return p;
      })();

      const ws = transport.createdWebSockets[0]!;
      const resultPromise = adapter.getRenderResult(receipt.executionId);

      ws.message({
        type: "execution_interrupted",
        data: {
          prompt_id: "prompt-int-1",
          node_id: "3",
          node_type: "KSampler"
        }
      });

      try {
        await resultPromise;
        expect.unreachable("Should have rejected");
      } catch (err) {
        expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
        const comfyErr = err as ComfyUiRenderEngineError;
        expect(comfyErr.code).toBe("EXECUTION_INTERRUPTED");
        expect(comfyErr.context.promptId).toBe("prompt-int-1");
        expect(comfyErr.context.nodeId).toBe("3");
        expect(comfyErr.context.nodeType).toBe("KSampler");
      }
    }

    // Test Case 2: post-settlement retrieval
    {
      const transport = new FakeComfyUiTransport();
      const adapter = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport,
        createClientId: () => "client-2",
        now: () => fixedNow
      });

      transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-int-2" });
      const receipt = await (async () => {
        const p = adapter.queueRender(sampleInput);
        transport.createdWebSockets[0]!.message({ type: "status", data: {} });
        return p;
      })();

      const ws = transport.createdWebSockets[0]!;
      ws.message({
        type: "execution_interrupted",
        data: {
          prompt_id: "prompt-int-2",
          node_id: "5",
          node_type: "CheckpointLoaderSimple"
        }
      });

      try {
        await adapter.getRenderResult(receipt.executionId);
        expect.unreachable("Should have rejected");
      } catch (err) {
        expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
        const comfyErr = err as ComfyUiRenderEngineError;
        expect(comfyErr.code).toBe("EXECUTION_INTERRUPTED");
        expect(comfyErr.context.nodeId).toBe("5");
      }
    }
  });

  it("rejects and closes resources when the wall-clock timeout expires", async () => {
    vi.useFakeTimers();

    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      timeoutMs: 10_000,
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-timeout" });

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;
    ws.message({ type: "status", data: {} });
    const receipt = await queuePromise;

    const resultPromise = adapter.getRenderResult(receipt.executionId);

    // Advance past timeout
    vi.advanceTimersByTime(10_001);

    expect(ws.readyState).toBe(FakeComfyUiWebSocket.CLOSED);
    expect(ws.getListenerCount("open")).toBe(0);
    expect(ws.getListenerCount("message")).toBe(0);
    expect(ws.getListenerCount("error")).toBe(0);
    expect(ws.getListenerCount("close")).toBe(0);

    try {
      await resultPromise;
      expect.unreachable("Should have timed out");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("RENDER_TIMEOUT");
      expect(comfyErr.context.timeoutMs).toBe(10_000);
      expect(comfyErr.context.promptId).toBe("prompt-timeout");
    }
  });

  it("rejects a socket failure before readiness as WEBSOCKET_CONNECTION_FAILED without submitting", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;

    ws.error(new Error("Connection refused"));

    try {
      await queuePromise;
      expect.unreachable("Should have rejected queueRender");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("WEBSOCKET_CONNECTION_FAILED");
    }

    expect(transport.fakeFetch.calls).toHaveLength(0);
    expect(ws.readyState).toBe(FakeComfyUiWebSocket.CLOSED);
    expect(ws.getListenerCount("message")).toBe(0);
  });

  it("closes resources and rejects when prompt submission fails", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    transport.fakeFetch.queueJsonResponse(
      { error: "Workflow invalid" },
      { status: 400, statusText: "Bad Request" }
    );

    const queuePromise = adapter.queueRender(sampleInput);
    const ws = transport.createdWebSockets[0]!;

    ws.message({ type: "status", data: {} });

    try {
      await queuePromise;
      expect.unreachable("Should have rejected queueRender");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("QUEUE_SUBMISSION_FAILED");
      expect(comfyErr.context.statusCode).toBe(400);
    }

    expect(ws.readyState).toBe(FakeComfyUiWebSocket.CLOSED);
    expect(ws.getListenerCount("message")).toBe(0);
  });

  it("rejects missing and non-success final history with distinct codes", async () => {
    // Missing history entry -> HISTORY_MISSING
    {
      const transport = new FakeComfyUiTransport();
      const adapter = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport,
        createClientId: () => "client-1",
        now: () => fixedNow
      });

      transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-hist-missing" });
      const receipt = await (async () => {
        const p = adapter.queueRender(sampleInput);
        transport.createdWebSockets[0]!.message({ type: "status", data: {} });
        return p;
      })();

      // History response has another prompt ID, not target
      transport.fakeFetch.queueJsonResponse({ "other-prompt": { outputs: {} } });

      transport.createdWebSockets[0]!.message({
        type: "executing",
        data: { prompt_id: "prompt-hist-missing", node: null }
      });

      try {
        await adapter.getRenderResult(receipt.executionId);
        expect.unreachable("Should have thrown HISTORY_MISSING");
      } catch (err) {
        expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
        const comfyErr = err as ComfyUiRenderEngineError;
        expect(comfyErr.code).toBe("HISTORY_MISSING");
        expect(comfyErr.context.promptId).toBe("prompt-hist-missing");
      }
    }

    // Incomplete/non-success history status -> HISTORY_NOT_SUCCESSFUL
    {
      const transport = new FakeComfyUiTransport();
      const adapter = new ComfyUiRenderEngineAdapter({
        baseUrl: "http://127.0.0.1:8188",
        transport,
        createClientId: () => "client-2",
        now: () => fixedNow
      });

      transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-hist-failed" });
      const receipt = await (async () => {
        const p = adapter.queueRender(sampleInput);
        transport.createdWebSockets[0]!.message({ type: "status", data: {} });
        return p;
      })();

      transport.fakeFetch.queueJsonResponse({
        "prompt-hist-failed": {
          outputs: {},
          status: { completed: false, status_str: "error" }
        }
      });

      transport.createdWebSockets[0]!.message({
        type: "executing",
        data: { prompt_id: "prompt-hist-failed", node: null }
      });

      try {
        await adapter.getRenderResult(receipt.executionId);
        expect.unreachable("Should have thrown HISTORY_NOT_SUCCESSFUL");
      } catch (err) {
        expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
        const comfyErr = err as ComfyUiRenderEngineError;
        expect(comfyErr.code).toBe("HISTORY_NOT_SUCCESSFUL");
        expect(comfyErr.context.promptId).toBe("prompt-hist-failed");
      }
    }
  });

  it("falls back to durable history when no active execution tracker exists", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      now: () => fixedNow
    });

    transport.fakeFetch.queueJsonResponse({
      "prompt-untracked-recovery": {
        outputs: {
          "9": {
            images: [{ filename: "recovered.png", subfolder: "renders" }]
          }
        },
        status: { completed: true, status_str: "success" }
      }
    });

    // Directly call getRenderResult without prior queueRender
    const result = await adapter.getRenderResult("prompt-untracked-recovery");

    expect(transport.createdWebSockets).toHaveLength(0);
    expect(result).toEqual({
      executionId: "prompt-untracked-recovery",
      status: "succeeded",
      outputObjectKeys: ["renders/recovered.png"],
      completedAt: fixedNow.toISOString()
    });
  });

  it("sends the unload request through unloadModels and surfaces failure", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport
    });

    // Successful unload
    transport.fakeFetch.queueJsonResponse({ success: true });
    await adapter.unloadModels();

    expect(transport.fakeFetch.calls).toHaveLength(1);
    const call = transport.fakeFetch.calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:8188/free");

    // Failing unload surfaces VRAM_UNLOAD_FAILED
    transport.fakeFetch.queueJsonResponse(
      { error: "VRAM free failed" },
      { status: 500, statusText: "Internal Server Error" }
    );

    try {
      await adapter.unloadModels();
      expect.unreachable("Should have thrown VRAM_UNLOAD_FAILED");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("VRAM_UNLOAD_FAILED");
      expect(comfyErr.context.statusCode).toBe(500);
    }
  });

  it("settles only once and cleans listeners timer and socket on every terminal path", async () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport,
      createClientId: () => "client-123",
      now: () => fixedNow
    });

    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-settle-once" });
    const receipt = await (async () => {
      const p = adapter.queueRender(sampleInput);
      transport.createdWebSockets[0]!.message({ type: "status", data: {} });
      return p;
    })();

    const ws = transport.createdWebSockets[0]!;

    // Queue exactly 1 history response
    transport.fakeFetch.queueJsonResponse({
      "prompt-settle-once": {
        outputs: {
          "9": {
            images: [{ filename: "out.png" }]
          }
        },
        status: { completed: true, status_str: "success" }
      }
    });

    // Send first terminal completion
    ws.message({ type: "executing", data: { prompt_id: "prompt-settle-once", node: null } });

    // Send duplicate terminal events before and after settlement
    ws.message({ type: "executing", data: { prompt_id: "prompt-settle-once", node: null } });
    ws.message({
      type: "execution_error",
      data: { prompt_id: "prompt-settle-once", node_id: "1", node_type: "KSampler" }
    });

    // Consume result: removes tracker from active map and awaits settlement
    const result = await adapter.getRenderResult(receipt.executionId);
    expect(result?.status).toBe("succeeded");

    // All listeners must be detached
    expect(ws.getListenerCount("open")).toBe(0);
    expect(ws.getListenerCount("message")).toBe(0);
    expect(ws.getListenerCount("error")).toBe(0);
    expect(ws.getListenerCount("close")).toBe(0);

    // Exactly one close call initiated by client settlement
    expect(ws.closeCalls).toHaveLength(1);

    // Only 1 prompt call + 1 history call
    const historyCalls = transport.fakeFetch.calls.filter((c) =>
      String(c.url).includes("/history/")
    );
    expect(historyCalls).toHaveLength(1);

    // Second call to getRenderResult must not find the tracker in memory and will query durable /history
    transport.fakeFetch.queueJsonResponse({
      "prompt-settle-once": {
        outputs: {
          "9": {
            images: [{ filename: "out.png" }]
          }
        },
        status: { completed: true, status_str: "success" }
      }
    });

    const secondResult = await adapter.getRenderResult(receipt.executionId);
    expect(secondResult?.status).toBe("succeeded");

    const historyCallsAfter = transport.fakeFetch.calls.filter((c) =>
      String(c.url).includes("/history/")
    );
    expect(historyCallsAfter).toHaveLength(2);
  });
});
