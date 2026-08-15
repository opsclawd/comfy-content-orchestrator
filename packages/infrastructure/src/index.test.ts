import { describe, expect, it } from "vitest";
import {
  ComfyUiRenderEngineAdapter,
  ComfyUiRenderEngineError,
  infrastructureName
} from "./index.js";
import { FakeComfyUiTransport } from "./comfyui/test-support/fake-comfyui.js";

describe("infrastructure package exports", () => {
  it("should load skeleton name", () => {
    expect(infrastructureName).toBe("infrastructure");
  });

  it("instantiates ComfyUiRenderEngineAdapter with a fake transport", () => {
    const transport = new FakeComfyUiTransport();
    const adapter = new ComfyUiRenderEngineAdapter({
      baseUrl: "http://127.0.0.1:8188",
      transport
    });
    expect(adapter).toBeInstanceOf(ComfyUiRenderEngineAdapter);
  });

  it("retains stable error code on ComfyUiRenderEngineError", () => {
    const error = new ComfyUiRenderEngineError("WEBSOCKET_CONNECTION_FAILED", "WebSocket failed", {
      promptId: "prompt-test-123"
    });
    expect(error.code).toBe("WEBSOCKET_CONNECTION_FAILED");
    expect(error.context.promptId).toBe("prompt-test-123");
    expect(error.name).toBe("ComfyUiRenderEngineError");
  });
});
