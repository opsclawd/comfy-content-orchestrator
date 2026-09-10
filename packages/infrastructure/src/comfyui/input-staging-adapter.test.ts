import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import { ComfyUiClient } from "./comfyui-client.js";
import { ComfyUiRenderEngineError } from "./comfyui-error.js";
import { HttpComfyUiInputStagingAdapter } from "./input-staging-adapter.js";
import { FakeComfyUiTransport } from "./test-support/fake-comfyui.js";

describe("HttpComfyUiInputStagingAdapter", () => {
  it("stage() delegates to client.uploadImage and returns StagedComfyUiInput", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const adapter = new HttpComfyUiInputStagingAdapter({ client, comfyUiDir: "/opt/comfyui" });

    transport.fakeFetch.queueJsonResponse({
      name: "cco-test-image.png",
      subfolder: "clips",
      type: "input"
    });

    const staged = await adapter.stage({
      filename: "cco-test-image.png",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png"
    });

    expect(staged).toEqual({
      name: "cco-test-image.png",
      subfolder: "clips"
    });
  });

  it("stage() normalizes missing subfolder to empty string", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const adapter = new HttpComfyUiInputStagingAdapter({ client });

    transport.fakeFetch.queueJsonResponse({
      name: "cco-test-image.png",
      type: "input"
    });

    const staged = await adapter.stage({
      filename: "cco-test-image.png",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/png"
    });

    expect(staged).toEqual({
      name: "cco-test-image.png",
      subfolder: ""
    });
  });

  it("stage() rejects path traversal in input filename", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const adapter = new HttpComfyUiInputStagingAdapter({ client });

    await expect(
      adapter.stage({
        filename: "../bad.png",
        bytes: new Uint8Array([1]),
        contentType: "image/png"
      })
    ).rejects.toThrow("invalid path traversal");
  });

  it("stage() forwards configured uploadTimeoutMs to client", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const uploadSpy = vi.spyOn(client, "uploadImage").mockResolvedValue({
      name: "file.png",
      subfolder: "",
      type: "input"
    });
    const adapter = new HttpComfyUiInputStagingAdapter({ client, uploadTimeoutMs: 15_000 });

    await adapter.stage({
      filename: "file.png",
      bytes: new Uint8Array([1]),
      contentType: "image/png"
    });

    expect(uploadSpy).toHaveBeenCalledWith(
      "file.png",
      expect.any(Uint8Array),
      "image/png",
      expect.objectContaining({ timeoutMs: 15_000, overwrite: true })
    );
  });

  it("stage() surfaces ComfyUiRenderEngineError when upload fails", async () => {
    const transport = new FakeComfyUiTransport();
    transport.fakeFetch.queueTextResponse("Server Error", { status: 500 });
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const adapter = new HttpComfyUiInputStagingAdapter({ client });

    await expect(
      adapter.stage({
        filename: "fail.png",
        bytes: new Uint8Array([1]),
        contentType: "image/png"
      })
    ).rejects.toThrow(ComfyUiRenderEngineError);
  });

  it("cleanup() no-ops when comfyUiDir is not provided", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const unlinkFn = vi.fn();
    const adapter = new HttpComfyUiInputStagingAdapter({ client, unlinkFn });

    await adapter.cleanup({ name: "img.png", subfolder: "" });
    expect(unlinkFn).not.toHaveBeenCalled();
  });

  it("cleanup() unlinks from input directory when subfolder is empty", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const unlinkFn = vi.fn().mockResolvedValue(undefined);
    const adapter = new HttpComfyUiInputStagingAdapter({
      client,
      comfyUiDir: "/opt/comfyui",
      unlinkFn
    });

    await adapter.cleanup({ name: "image.png", subfolder: "" });
    expect(unlinkFn).toHaveBeenCalledWith(path.join("/opt/comfyui", "input", "image.png"));
  });

  it("cleanup() unlinks from input/subfolder when subfolder is non-empty (fixes Finding 5)", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const unlinkFn = vi.fn().mockResolvedValue(undefined);
    const adapter = new HttpComfyUiInputStagingAdapter({
      client,
      comfyUiDir: "/opt/comfyui",
      unlinkFn
    });

    await adapter.cleanup({ name: "image.png", subfolder: "subfolder_1" });
    expect(unlinkFn).toHaveBeenCalledWith(
      path.join("/opt/comfyui", "input", "subfolder_1", "image.png")
    );
  });

  it("cleanup() swallows filesystem unlink errors", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const unlinkFn = vi.fn().mockRejectedValue(new Error("ENOENT"));
    const adapter = new HttpComfyUiInputStagingAdapter({
      client,
      comfyUiDir: "/opt/comfyui",
      unlinkFn
    });

    await expect(adapter.cleanup({ name: "missing.png", subfolder: "" })).resolves.toBeUndefined();
  });

  it("cleanup() rejects path traversal in name and subfolder", async () => {
    const transport = new FakeComfyUiTransport();
    const client = new ComfyUiClient("http://127.0.0.1:8188", transport);
    const unlinkFn = vi.fn().mockResolvedValue(undefined);
    const adapter = new HttpComfyUiInputStagingAdapter({
      client,
      comfyUiDir: "/opt/comfyui",
      unlinkFn
    });

    // traversal in name
    await adapter.cleanup({ name: "../escaped.png", subfolder: "" });
    await adapter.cleanup({ name: "sub/escaped.png", subfolder: "" });
    await adapter.cleanup({ name: "sub\\escaped.png", subfolder: "" });
    await adapter.cleanup({ name: ".", subfolder: "" });

    // traversal in subfolder
    await adapter.cleanup({ name: "safe.png", subfolder: "../escaped" });
    await adapter.cleanup({ name: "safe.png", subfolder: "sub/nested" });
    await adapter.cleanup({ name: "safe.png", subfolder: "sub\\nested" });
    await adapter.cleanup({ name: "safe.png", subfolder: ".." });

    expect(unlinkFn).not.toHaveBeenCalled();
  });
});
