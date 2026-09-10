import { describe, expect, it } from "vitest";
import { ComfyUiClient } from "./comfyui-client.js";
import { ComfyUiRenderEngineError } from "./comfyui-error.js";
import { FakeComfyUiTransport, FakeComfyUiWebSocket } from "./test-support/fake-comfyui.js";

describe("ComfyUiClient", () => {
  it("submits the workflow and stable client ID to POST /prompt", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const clientId = "client-stable-uuid-123";
    const workflow = {
      "3": {
        class_type: "KSampler",
        inputs: { seed: 42, steps: 20 }
      }
    };

    transport.fakeFetch.queueJsonResponse({ prompt_id: "prompt-abc-456" });

    const promptId = await client.queuePrompt(clientId, workflow);

    expect(promptId).toBe("prompt-abc-456");
    expect(transport.fakeFetch.calls).toHaveLength(1);

    const call = transport.fakeFetch.calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:8188/prompt");
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("Content-Type")).toBe("application/json");

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody).toEqual({
      prompt: workflow,
      client_id: clientId
    });
  });

  it("creates the per-job WebSocket URL from the HTTP base URL", () => {
    const transport = new FakeComfyUiTransport();
    const httpClient = new ComfyUiClient("http://127.0.0.1:8188/", transport);
    const clientIdWithSpecialChars = "client/id with special?chars&more#123";

    const ws = httpClient.connect(clientIdWithSpecialChars);

    expect(transport.createdWebSockets).toHaveLength(1);
    expect(ws).toBe(transport.createdWebSockets[0]);
    expect((ws as FakeComfyUiWebSocket).url).toBe(
      `ws://127.0.0.1:8188/ws?clientId=${encodeURIComponent(clientIdWithSpecialChars)}`
    );

    // Test https scheme mapping to wss
    const httpsTransport = new FakeComfyUiTransport();
    const httpsClient = new ComfyUiClient(
      "https://render-01.godzspeed-internal.ts.net:8188/custom-path/",
      httpsTransport
    );
    const httpsWs = httpsClient.connect("client-456");

    expect((httpsWs as FakeComfyUiWebSocket).url).toBe(
      "wss://render-01.godzspeed-internal.ts.net:8188/custom-path/ws?clientId=client-456"
    );
  });

  it("classifies a non-success prompt response as QUEUE_SUBMISSION_FAILED", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const clientId = "client-1";
    const workflow = { "1": { class_type: "EmptyLatentImage" } };

    transport.fakeFetch.queueJsonResponse(
      { error: "Internal Server Error: Node missing", node_errors: { "1": "bad" } },
      { status: 500, statusText: "Internal Server Error" }
    );

    await expect(client.queuePrompt(clientId, workflow)).rejects.toThrow(ComfyUiRenderEngineError);

    transport.fakeFetch.queueJsonResponse(
      { error: "Internal Server Error" },
      { status: 500, statusText: "Internal Server Error" }
    );

    try {
      await client.queuePrompt(clientId, workflow);
      expect.unreachable("Should have thrown ComfyUiRenderEngineError");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("QUEUE_SUBMISSION_FAILED");
      expect(comfyErr.context.statusCode).toBe(500);
      // Raw error body must not be exposed in message
      expect(comfyErr.message).not.toContain("node_errors");
    }
  });

  it("returns the matching history entry and reports absent history", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const targetPromptId = "prompt-target-123";
    const otherPromptId = "prompt-other-999";

    const targetEntry = {
      outputs: {
        "9": {
          images: [{ filename: "out_0001.png", subfolder: "renders", type: "output" }]
        }
      },
      status: { status_str: "success", completed: true }
    };

    // First call: prompt history is present
    transport.fakeFetch.queueJsonResponse({
      [targetPromptId]: targetEntry,
      [otherPromptId]: { outputs: {} }
    });

    const result = await client.getHistory(targetPromptId);
    expect(result).toEqual(targetEntry);

    const call1 = transport.fakeFetch.calls[0]!;
    expect(call1.url).toBe(`http://127.0.0.1:8188/history/${targetPromptId}`);
    expect(call1.init?.method).toBe("GET");

    // Second call: prompt history is missing
    transport.fakeFetch.queueJsonResponse({
      [otherPromptId]: { outputs: {} }
    });

    const missingResult = await client.getHistory("prompt-absent-404");
    expect(missingResult).toBeUndefined();

    // Third call: prompt ID with reserved characters is encoded
    const reservedPromptId = "prompt/with special:chars?and=query#hash";
    transport.fakeFetch.queueJsonResponse({
      [reservedPromptId]: targetEntry
    });

    const reservedResult = await client.getHistory(reservedPromptId);
    expect(reservedResult).toEqual(targetEntry);
    const call3 = transport.fakeFetch.calls[2]!;
    expect(call3.url).toBe(`http://127.0.0.1:8188/history/${encodeURIComponent(reservedPromptId)}`);
  });

  it("sends both unload flags to POST /free", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

    transport.fakeFetch.queueJsonResponse({ success: true });

    await client.unloadModels();

    expect(transport.fakeFetch.calls).toHaveLength(1);
    const call = transport.fakeFetch.calls[0]!;
    expect(call.url).toBe("http://127.0.0.1:8188/free");
    expect(call.init?.method).toBe("POST");
    expect(new Headers(call.init?.headers).get("Content-Type")).toBe("application/json");

    const parsedBody = JSON.parse(call.init?.body as string);
    expect(parsedBody).toEqual({
      free_memory: true,
      unload_models: true
    });
  });

  it("classifies a non-success unload response as VRAM_UNLOAD_FAILED", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

    transport.fakeFetch.queueTextResponse("CUDA out of memory in garbage collection", {
      status: 500,
      statusText: "Internal Server Error"
    });

    try {
      await client.unloadModels();
      expect.unreachable("Should have thrown ComfyUiRenderEngineError");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("VRAM_UNLOAD_FAILED");
      expect(comfyErr.context.statusCode).toBe(500);
      expect(comfyErr.message).not.toContain("CUDA out of memory");
    }
  });

  it("classifies non-success history response as HISTORY_REQUEST_FAILED", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const promptId = "prompt-fail";

    transport.fakeFetch.queueTextResponse("Database connection dead", {
      status: 503,
      statusText: "Service Unavailable"
    });

    try {
      await client.getHistory(promptId);
      expect.unreachable("Should have thrown ComfyUiRenderEngineError");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiRenderEngineError);
      const comfyErr = err as ComfyUiRenderEngineError;
      expect(comfyErr.code).toBe("HISTORY_REQUEST_FAILED");
      expect(comfyErr.context.statusCode).toBe(503);
      expect(comfyErr.context.promptId).toBe(promptId);
    }
  });

  it("classifies invalid JSON or missing prompt_id in responses as PROTOCOL_ERROR", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

    // Invalid JSON on queuePrompt
    transport.fakeFetch.queueTextResponse("<html>Not JSON</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" }
    });

    await expect(client.queuePrompt("client-1", {})).rejects.toThrow(
      expect.objectContaining({
        code: "PROTOCOL_ERROR"
      })
    );

    // Missing prompt_id on queuePrompt
    transport.fakeFetch.queueJsonResponse({ other_field: 123 }, { status: 200 });
    await expect(client.queuePrompt("client-1", {})).rejects.toThrow(
      expect.objectContaining({
        code: "PROTOCOL_ERROR"
      })
    );

    // Empty prompt_id on queuePrompt
    transport.fakeFetch.queueJsonResponse({ prompt_id: "   " }, { status: 200 });
    await expect(client.queuePrompt("client-1", {})).rejects.toThrow(
      expect.objectContaining({
        code: "PROTOCOL_ERROR"
      })
    );

    // Invalid JSON on getHistory
    transport.fakeFetch.queueTextResponse("broken json", { status: 200 });
    await expect(client.getHistory("prompt-1")).rejects.toThrow(
      expect.objectContaining({
        code: "PROTOCOL_ERROR"
      })
    );
  });

  it("supports fake websocket lifecycle, listener tracking, and synchronous helpers", () => {
    const ws = new FakeComfyUiWebSocket("ws://127.0.0.1:8188/ws?clientId=123");
    expect(ws.readyState).toBe(FakeComfyUiWebSocket.CONNECTING);
    expect(FakeComfyUiWebSocket.OPEN).toBe(1);
    expect(FakeComfyUiWebSocket.CLOSING).toBe(2);
    expect(FakeComfyUiWebSocket.CLOSED).toBe(3);

    let opened = false;
    const openListener = () => {
      opened = true;
    };
    ws.addEventListener("open", openListener);
    expect(ws.getListenerCount("open")).toBe(1);

    ws.open();
    expect(opened).toBe(true);
    expect(ws.readyState).toBe(FakeComfyUiWebSocket.OPEN);

    ws.removeEventListener("open", openListener);
    expect(ws.getListenerCount("open")).toBe(0);

    const messages: unknown[] = [];
    ws.addEventListener("message", (evt) => {
      messages.push((evt as { data: unknown }).data);
    });
    ws.message({ type: "progress", data: { value: 1, max: 10 } });
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0] as string)).toEqual({
      type: "progress",
      data: { value: 1, max: 10 }
    });

    let caughtError: unknown;
    ws.addEventListener("error", (evt) => {
      caughtError = (evt as { error: unknown }).error;
    });
    const err = new Error("ws failure");
    ws.error(err);
    expect(caughtError).toBe(err);

    let closed = false;
    ws.addEventListener("close", () => {
      closed = true;
    });
    ws.serverClose(1001, "Going Away");
    expect(closed).toBe(true);
    expect(ws.readyState).toBe(FakeComfyUiWebSocket.CLOSED);

    ws.close(1000, "Client closed");
    expect(ws.closeCalls).toEqual([{ code: 1000, reason: "Client closed" }]);
  });

  describe("uploadImage", () => {
    it("submits multipart form data to POST /upload/image and returns response", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
      const bytes = new Uint8Array([1, 2, 3, 4]);

      transport.fakeFetch.queueJsonResponse({
        name: "test-image.png",
        subfolder: "sub_test",
        type: "input"
      });

      const result = await client.uploadImage("test-image.png", bytes, "image/png");

      expect(result).toEqual({
        name: "test-image.png",
        subfolder: "sub_test",
        type: "input"
      });

      expect(transport.fakeFetch.calls).toHaveLength(1);
      const call = transport.fakeFetch.calls[0]!;
      expect(call.url).toBe("http://127.0.0.1:8188/upload/image");
      expect(call.init?.method).toBe("POST");
      expect(call.init?.body).toBeInstanceOf(FormData);

      const body = call.init?.body as FormData;
      expect(body.get("type")).toBe("input");
      expect(body.get("overwrite")).toBe("true");
      expect(body.get("image")).toBeInstanceOf(Blob);
    });

    it("normalizes missing subfolder to empty string", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
      const bytes = new Uint8Array([1, 2, 3, 4]);

      transport.fakeFetch.queueJsonResponse({
        name: "staged_file.png",
        type: "input"
      });

      const result = await client.uploadImage("staged_file.png", bytes, "image/png");

      expect(result).toEqual({
        name: "staged_file.png",
        subfolder: "",
        type: "input"
      });
    });

    it("supports overwrite: false option", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
      const bytes = new Uint8Array([1, 2, 3, 4]);

      transport.fakeFetch.queueJsonResponse({
        name: "staged_file.png",
        subfolder: "",
        type: "input"
      });

      await client.uploadImage("staged_file.png", bytes, "image/png", { overwrite: false });

      const body = transport.fakeFetch.calls[0]!.init?.body as FormData;
      expect(body.get("overwrite")).toBe("false");
    });

    it("classifies transport errors as IMAGE_UPLOAD_FAILED", async () => {
      const transport = new FakeComfyUiTransport();
      transport.fakeFetch.setDefaultResponseHandler(async () => {
        throw new Error("Network unreachable");
      });
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "IMAGE_UPLOAD_FAILED"
      });
    });

    it("classifies non-ok status as IMAGE_UPLOAD_FAILED with statusCode", async () => {
      const transport = new FakeComfyUiTransport();
      transport.fakeFetch.queueTextResponse("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error"
      });
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "IMAGE_UPLOAD_FAILED",
        context: { statusCode: 500 }
      });
    });

    it("classifies invalid JSON as PROTOCOL_ERROR", async () => {
      const transport = new FakeComfyUiTransport();
      transport.fakeFetch.queueTextResponse("<html>not json</html>", { status: 200 });
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "PROTOCOL_ERROR"
      });
    });

    it("classifies missing or empty name as PROTOCOL_ERROR", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      // missing name
      transport.fakeFetch.queueJsonResponse({ subfolder: "sub" }, { status: 200 });
      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "PROTOCOL_ERROR"
      });

      // empty name
      transport.fakeFetch.queueJsonResponse({ name: "   " }, { status: 200 });
      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "PROTOCOL_ERROR"
      });
    });

    it("times out and throws IMAGE_UPLOAD_FAILED on a never-settling transport fetch", async () => {
      const transport = new FakeComfyUiTransport();
      // Handler that returns a promise that never resolves
      transport.fakeFetch.setDefaultResponseHandler(() => new Promise<Response>(() => {}));
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      const promise = client.uploadImage("file.png", new Uint8Array([1]), "image/png", {
        timeoutMs: 50
      });

      await expect(promise).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "IMAGE_UPLOAD_FAILED",
        message: expect.stringContaining("timed out or was aborted")
      });
    });

    it("rejects path traversal in returned filename with PROTOCOL_ERROR", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      for (const unsafeName of ["../file.png", "dir/file.png", "dir\\file.png", "."]) {
        transport.fakeFetch.queueJsonResponse({ name: unsafeName, type: "input" }, { status: 200 });
        await expect(
          client.uploadImage(unsafeName, new Uint8Array([1]), "image/png")
        ).rejects.toMatchObject({
          name: "ComfyUiRenderEngineError",
          code: "PROTOCOL_ERROR"
        });
      }
    });

    it("rejects returned name that does not match requested filename with PROTOCOL_ERROR", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      transport.fakeFetch.queueJsonResponse(
        { name: "different-name.png", type: "input" },
        { status: 200 }
      );
      await expect(
        client.uploadImage("requested-name.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "PROTOCOL_ERROR"
      });
    });

    it("rejects non-input type in response with PROTOCOL_ERROR", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      // type: "output"
      transport.fakeFetch.queueJsonResponse({ name: "file.png", type: "output" }, { status: 200 });
      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "PROTOCOL_ERROR"
      });

      // missing type
      transport.fakeFetch.queueJsonResponse({ name: "file.png" }, { status: 200 });
      await expect(
        client.uploadImage("file.png", new Uint8Array([1]), "image/png")
      ).rejects.toMatchObject({
        name: "ComfyUiRenderEngineError",
        code: "PROTOCOL_ERROR"
      });
    });

    it("rejects path traversal in subfolder with PROTOCOL_ERROR", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      for (const unsafeSubfolder of ["../sub", "sub/..", "sub\\sub2", "/sub", "."]) {
        transport.fakeFetch.queueJsonResponse(
          { name: "file.png", subfolder: unsafeSubfolder, type: "input" },
          { status: 200 }
        );
        await expect(
          client.uploadImage("file.png", new Uint8Array([1]), "image/png")
        ).rejects.toMatchObject({
          name: "ComfyUiRenderEngineError",
          code: "PROTOCOL_ERROR"
        });
      }
    });

    it("accepts valid subfolder and returns input type", async () => {
      const transport = new FakeComfyUiTransport();
      const client = new ComfyUiClient("http://127.0.0.1:8188", transport);

      transport.fakeFetch.queueJsonResponse(
        { name: "file.png", subfolder: "conditioning", type: "input" },
        { status: 200 }
      );
      const res = await client.uploadImage("file.png", new Uint8Array([1]), "image/png");
      expect(res).toEqual({
        name: "file.png",
        subfolder: "conditioning",
        type: "input"
      });
    });
  });
});
