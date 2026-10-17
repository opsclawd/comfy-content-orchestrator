import { describe, expect, it } from "vitest";
import * as os from "node:os";
import * as net from "node:net";
import { appendFile, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { MinimaxH3ExperimentStore } from "./minimax-h3-experiment-store.js";
import { MinimaxH3TargetPreflight } from "./minimax-h3-target-preflight.js";
import { parseDurationMs, parseFrameRate } from "./minimax-h3-output-prober.js";
import { MinimaxH3ComfyUiAdapter } from "./minimax-h3-comfyui-adapter.js";

describe("MinimaxH3ExperimentStore", () => {
  it("verifies containment and rejects forbidden path attempts", () => {
    const store = new MinimaxH3ExperimentStore("/tmp/test-runs");

    expect(store.verifyContainment("/tmp/test-runs/run-1")).toBe(true);
    expect(store.verifyContainment("/tmp/test-runs/run-1/descriptor.json")).toBe(true);

    // Escape root
    expect(store.verifyContainment("/tmp/other-dir/run-1")).toBe(false);

    // Forbidden subdirectories
    expect(store.verifyContainment("/tmp/test-runs/certification/run-1")).toBe(false);
    expect(store.verifyContainment("/tmp/test-runs/baseline/run-1")).toBe(false);
    expect(store.verifyContainment("/tmp/test-runs/config/render-profiles/run-1")).toBe(false);
  });

  it("writes and reads durable files atomically", async () => {
    const tmpDir = await mkdtemp(join(os.tmpdir(), "h3-exp-test-"));
    try {
      const store = new MinimaxH3ExperimentStore(tmpDir);
      const runDir = join(tmpDir, "run-001");

      const intent = {
        runId: "run-001",
        clientId: "client-abc",
        workflowDigest: "a".repeat(64),
        requestFingerprint: "b".repeat(64),
        timestamp: "2026-10-12T10:00:00.000Z"
      };

      await store.writeIntent(runDir, intent);
      const readBack = await store.readIntent(runDir);
      expect(readBack).toEqual(intent);

      const receipt = {
        runId: "run-001",
        promptId: "prompt-123",
        acceptedAt: "2026-10-12T10:00:01.000Z"
      };

      await store.writeReceipt(runDir, receipt);
      const readReceipt = await store.readReceipt(runDir);
      expect(readReceipt).toEqual(receipt);

      // Appending events and telemetry
      await store.appendEvent(runDir, {
        timestamp: "2026-10-12T10:00:02.000Z",
        event: "test_event",
        details: { foo: "bar" }
      });
      const events = await store.readEvents(runDir);
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe("test_event");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips an isolated corrupt JSONL line without discarding valid lines that come after it", async () => {
    const tmpDir = await mkdtemp(join(os.tmpdir(), "h3-exp-jsonl-test-"));
    try {
      const store = new MinimaxH3ExperimentStore(tmpDir);
      const runDir = join(tmpDir, "run-jsonl");

      await store.appendEvent(runDir, {
        timestamp: "2026-10-12T10:00:00.000Z",
        event: "event_before",
        details: {}
      });
      // Directly corrupt the file with a mid-file bad line -- this is
      // NOT the "trailing partial write from a crash" shape the old code
      // assumed; a line after it is still perfectly valid and must not
      // be silently discarded along with the corrupt one.
      await appendFile(`${runDir}/events.jsonl`, "{not valid json\n", "utf8");
      await store.appendEvent(runDir, {
        timestamp: "2026-10-12T10:00:02.000Z",
        event: "event_after",
        details: {}
      });

      const events = await store.readEvents(runDir);
      expect(events.map((e) => e.event)).toEqual(["event_before", "event_after"]);

      expect(store.jsonlParseWarnings).toHaveLength(1);
      expect(store.jsonlParseWarnings[0]?.path).toContain("events.jsonl");
      expect(store.jsonlParseWarnings[0]?.lineNumber).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("ensureRunSubdirectories creates outputs/temp/user/inputs before ComfyUI needs them", async () => {
    // Found via a live run on real hardware: ComfyUI's own argparse
    // requires --output-directory/--temp-directory/--user-directory to
    // already exist, and exits immediately with a usage error
    // otherwise. executeExperiment never created these before
    // spawning, so every real run failed this way.
    const tmpDir = await mkdtemp(join(os.tmpdir(), "h3-exp-subdirs-test-"));
    try {
      const store = new MinimaxH3ExperimentStore(tmpDir);
      const runDir = join(tmpDir, "run-subdirs");

      await store.ensureRunSubdirectories(runDir);

      for (const sub of ["outputs", "temp", "user", "inputs"]) {
        const s = await stat(`${runDir}/${sub}`);
        expect(s.isDirectory()).toBe(true);
      }

      // Idempotent: calling again on existing directories must not throw.
      await expect(store.ensureRunSubdirectories(runDir)).resolves.toBeUndefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an already-written intent.json or receipt.json", async () => {
    // intent.json/receipt.json are a run's claim markers. A second,
    // delayed invocation of executeExperiment for the same run directory
    // only discovers the collision here (its own precondition check
    // happens long before, at the top of the function) -- so this guard
    // is the actual point that must fail closed rather than silently
    // clobber a run that already completed.
    const tmpDir = await mkdtemp(join(os.tmpdir(), "h3-exp-immutable-test-"));
    try {
      const store = new MinimaxH3ExperimentStore(tmpDir);
      const runDir = join(tmpDir, "run-001");

      const intent = {
        runId: "run-001",
        clientId: "client-abc",
        workflowDigest: "a".repeat(64),
        requestFingerprint: "b".repeat(64),
        timestamp: "2026-10-12T10:00:00.000Z"
      };
      await store.writeIntent(runDir, intent);

      await expect(
        store.writeIntent(runDir, { ...intent, timestamp: "2026-10-12T11:00:00.000Z" })
      ).rejects.toThrow(/Cannot overwrite immutable record/);

      const receipt = {
        runId: "run-001",
        promptId: "prompt-123",
        acceptedAt: "2026-10-12T10:00:01.000Z"
      };
      await store.writeReceipt(runDir, receipt);

      await expect(
        store.writeReceipt(runDir, { ...receipt, promptId: "prompt-999" })
      ).rejects.toThrow(/Cannot overwrite immutable record/);

      // The original records must be unchanged after the rejected writes.
      expect(await store.readIntent(runDir)).toEqual(intent);
      expect(await store.readReceipt(runDir)).toEqual(receipt);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("MinimaxH3TargetPreflight", () => {
  it("validates target host matches current machine", async () => {
    const preflight = new MinimaxH3TargetPreflight();

    const currentHost = os.hostname();
    const validTarget = {
      hostname: currentHost,
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      comfyUiDir: "/opt/comfyui",
      pythonPath: "/usr/bin/python3",
      address: "127.0.0.1",
      port: 8199
    };

    const result = await preflight.checkTargetHost(validTarget);
    expect(result.ok).toBe(true);

    const wrongHostResult = await preflight.checkTargetHost({
      ...validTarget,
      hostname: "some-other-machine"
    });
    expect(wrongHostResult.ok).toBe(false);
    expect(wrongHostResult.blocker).toContain("Host mismatch");
  });

  it("checks port availability and detects in-use port", async () => {
    const preflight = new MinimaxH3TargetPreflight();
    const server = net.createServer();

    // Listen on random port
    await new Promise<void>((res) => {
      server.listen(0, "127.0.0.1", () => res());
    });
    const port = (server.address() as net.AddressInfo).port;

    try {
      const checkOccupied = await preflight.checkPortAvailable("127.0.0.1", port);
      expect(checkOccupied.ok).toBe(false);
      expect(checkOccupied.blocker).toContain("already in use");
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }

    const checkFree = await preflight.checkPortAvailable("127.0.0.1", port);
    expect(checkFree.ok).toBe(true);
  });

  it("acquires and releases GPU lock", async () => {
    const tmpDir = await mkdtemp(join(os.tmpdir(), "h3-lock-test-"));
    try {
      const preflight = new MinimaxH3TargetPreflight();
      const gpuUuid = "GPU-99999999-9999-9999-9999-999999999999";

      const lock1 = await preflight.acquireGpuLock(tmpDir, gpuUuid, process.pid);
      expect(lock1.acquired).toBe(true);

      // Attempting to acquire from another fake PID that is alive (e.g. init or current)
      const lock2 = await preflight.acquireGpuLock(tmpDir, gpuUuid, 1);
      // Since process.pid holds it, PID 1 cannot acquire
      expect(lock2.acquired).toBe(false);
      expect(lock2.blocker).toContain("currently locked");

      await lock1.release();

      // Now lock2 can acquire
      const lock3 = await preflight.acquireGpuLock(tmpDir, gpuUuid, process.pid);
      expect(lock3.acquired).toBe(true);
      await lock3.release();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("MinimaxH3OutputProber Helpers", () => {
  it("parses duration correctly without fallbacks", () => {
    expect(parseDurationMs("5.166667")).toBe(5167);
    expect(parseDurationMs("8.000000")).toBe(8000);
    expect(parseDurationMs("N/A")).toBeNull();
    expect(parseDurationMs(undefined)).toBeNull();
    expect(parseDurationMs("-1")).toBeNull();
  });

  it("parses fractional and decimal frame rates", () => {
    expect(parseFrameRate("24/1")).toBe(24);
    expect(parseFrameRate("24")).toBe(24);
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("0/0")).toBeNull();
    expect(parseFrameRate("N/A")).toBeNull();
  });
});

describe("MinimaxH3ComfyUiAdapter", () => {
  it("handles submitPrompt and pollPromptHistory correctly", async () => {
    const mockResponses: Record<string, unknown> = {
      "/prompt": { prompt_id: "test-prompt-123" },
      "/history/test-prompt-123": {
        "test-prompt-123": {
          status: { status_str: "success", completed: true },
          outputs: {
            "92": {
              videos: [{ filename: "video_output_001.mp4" }]
            }
          }
        }
      }
    };

    const mockFetch = async (input: unknown, _init?: unknown): Promise<Response> => {
      const urlStr = String(input);
      for (const [route, data] of Object.entries(mockResponses)) {
        if (urlStr.includes(route)) {
          return new Response(JSON.stringify(data), { status: 200 });
        }
      }
      return new Response("Not found", { status: 404 });
    };

    const adapter = new MinimaxH3ComfyUiAdapter(mockFetch as unknown as typeof fetch);

    const submit = await adapter.submitPrompt(
      "http://127.0.0.1:8199",
      { dummy: true },
      "client-1",
      5000
    );
    expect(submit.ok).toBe(true);
    expect(submit.promptId).toBe("test-prompt-123");

    const history = await adapter.pollPromptHistory(
      "http://127.0.0.1:8199",
      "test-prompt-123",
      5000,
      100
    );
    expect(history.status).toBe("completed");
    expect(history.outputFilename).toBe("video_output_001.mp4");
  });

  it("handles pinned ComfyUI PreviewVideo images output format correctly", async () => {
    const mockResponses: Record<string, unknown> = {
      "/history/test-prompt-pinned": {
        "test-prompt-pinned": {
          status: { status_str: "success", completed: true },
          outputs: {
            "92": {
              images: [
                {
                  filename: "minimax_h3_i2v_run-1_00001_.mp4",
                  subfolder: "",
                  type: "output"
                }
              ]
            }
          }
        }
      }
    };

    const mockFetch = async (input: unknown): Promise<Response> => {
      const urlStr = String(input);
      for (const [route, data] of Object.entries(mockResponses)) {
        if (urlStr.includes(route)) {
          return new Response(JSON.stringify(data), { status: 200 });
        }
      }
      return new Response("Not found", { status: 404 });
    };

    const adapter = new MinimaxH3ComfyUiAdapter(mockFetch as unknown as typeof fetch);
    const history = await adapter.pollPromptHistory(
      "http://127.0.0.1:8199",
      "test-prompt-pinned",
      5000,
      100
    );
    expect(history.status).toBe("completed");
    expect(history.outputFilename).toBe("minimax_h3_i2v_run-1_00001_.mp4");
  });

  it("marks a caller-aborted poll as interrupted, distinct from a genuine engine error", async () => {
    // Our own abort signal firing (operator cancel or a stop-policy
    // threshold trip) and a genuine ComfyUI-reported execution error
    // both surface as status "failed" -- interrupted is what lets the
    // caller tell a deliberate stop apart from an actual failure.
    const mockFetch = async (): Promise<Response> => new Response("{}", { status: 200 });
    const adapter = new MinimaxH3ComfyUiAdapter(mockFetch as unknown as typeof fetch);

    const abortController = new AbortController();
    abortController.abort();

    const result = await adapter.pollPromptHistory(
      "http://127.0.0.1:8199",
      "test-prompt-aborted",
      5000,
      100,
      abortController.signal
    );
    expect(result.status).toBe("failed");
    expect(result.interrupted).toBe(true);
  });

  it("marks a ComfyUI-reported interruption as interrupted, but a genuine execution error as not interrupted", async () => {
    const mockResponses: Record<string, unknown> = {
      "/history/test-prompt-interrupted": {
        "test-prompt-interrupted": {
          status: { status_str: "interrupted", completed: false }
        }
      },
      "/history/test-prompt-oom": {
        "test-prompt-oom": {
          status: { status_str: "error", completed: false, messages: [["execution_error", {}]] }
        }
      }
    };
    const mockFetch = async (input: unknown): Promise<Response> => {
      const urlStr = String(input);
      for (const [route, data] of Object.entries(mockResponses)) {
        if (urlStr.includes(route)) {
          return new Response(JSON.stringify(data), { status: 200 });
        }
      }
      return new Response("Not found", { status: 404 });
    };
    const adapter = new MinimaxH3ComfyUiAdapter(mockFetch as unknown as typeof fetch);

    const interruptedResult = await adapter.pollPromptHistory(
      "http://127.0.0.1:8199",
      "test-prompt-interrupted",
      5000,
      100
    );
    expect(interruptedResult.status).toBe("failed");
    expect(interruptedResult.interrupted).toBe(true);

    const oomResult = await adapter.pollPromptHistory(
      "http://127.0.0.1:8199",
      "test-prompt-oom",
      5000,
      100
    );
    expect(oomResult.status).toBe("failed");
    expect(oomResult.interrupted).toBeFalsy();
  });

  it("rejects an oversized chunked response body without fully materializing it first", async () => {
    // No Content-Length header (chunked), and a body stream that keeps
    // yielding chunks past the 50MB limit. The fast-path Content-Length
    // check can't catch this; only reading-with-a-running-total can.
    const chunkSize = 1024 * 1024; // 1MB
    const chunksToExceedLimit = 60; // 60MB > 50MB limit
    let chunksEmitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksEmitted >= chunksToExceedLimit) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(chunkSize).fill(97)); // 'a'
        chunksEmitted++;
      }
    });

    const mockFetch = async (): Promise<Response> => {
      return new Response(body, { status: 200 });
    };

    const adapter = new MinimaxH3ComfyUiAdapter(mockFetch as unknown as typeof fetch);
    const submit = await adapter.submitPrompt(
      "http://127.0.0.1:8199",
      { dummy: true },
      "client-oversized",
      5000
    );

    expect(submit.ok).toBe(false);
    expect(submit.error).toContain("exceeds maximum allowed size");
    // The stream must have been aborted well before all 60 chunks were
    // pulled — otherwise the "without fully materializing it first" claim
    // in the fix doesn't actually hold.
    expect(chunksEmitted).toBeLessThan(chunksToExceedLimit);
  });

  it("handles getCapabilityHandshake returning pending status followed by ready ok status", async () => {
    let callCount = 0;
    const pendingHandshake = {
      status: "pending",
      protocol: "v2-jsonl",
      protocolVersion: "v2-jsonl",
      runId: "run-test-1",
      attemptToken: "token-1",
      pid: 1234,
      nonce: "nonce-1",
      collectorDigest: "a".repeat(64),
      hookManifestDigest: "b".repeat(64),
      installedHooks: [],
      registeredNodes: {}
    };
    const readyHandshake = {
      ...pendingHandshake,
      status: "ok",
      installedHooks: [
        {
          name: "h1",
          modulePath: "m1",
          callable: "c1",
          phase: "sampling",
          attached: true
        }
      ]
    };

    const mockFetch = async (input: unknown): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes("/experiment/minimax-h3/capability")) {
        callCount++;
        const data = callCount === 1 ? pendingHandshake : readyHandshake;
        return new Response(JSON.stringify(data), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    };

    const adapter = new MinimaxH3ComfyUiAdapter(mockFetch as unknown as typeof fetch);
    const firstProbe = await adapter.getCapabilityHandshake(
      "http://127.0.0.1:8199",
      "nonce-1",
      5000
    );
    expect(firstProbe.ok).toBe(true);
    expect(firstProbe.handshake?.status).toBe("pending");

    const secondProbe = await adapter.getCapabilityHandshake(
      "http://127.0.0.1:8199",
      "nonce-1",
      5000
    );
    expect(secondProbe.ok).toBe(true);
    expect(secondProbe.handshake?.status).toBe("ok");
    expect(secondProbe.handshake?.installedHooks).toHaveLength(1);
  });
});
