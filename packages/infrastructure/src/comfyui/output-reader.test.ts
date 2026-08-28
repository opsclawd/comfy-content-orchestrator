import { describe, expect, it } from "vitest";
import { HttpComfyUiOutputReader, ComfyUiOutputReaderError } from "./output-reader.js";
import { FakeComfyUiTransport } from "./test-support/fake-comfyui.js";

describe("HttpComfyUiOutputReader", () => {
  it("reads exact ComfyUI output bytes and content type", async () => {
    const transport = new FakeComfyUiTransport();
    const reader = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transport);

    const testBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03
    ]);
    transport.fakeFetch.queueResponse(
      new Response(testBytes, {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    );

    const output = await reader.readOutput("renders/scene-1/output.png");

    expect(output.bytes).toEqual(testBytes);
    expect(output.contentType).toBe("image/png");
    expect(transport.fakeFetch.calls).toHaveLength(1);

    const call = transport.fakeFetch.calls[0]!;
    expect(call.init?.method).toBe("GET");
    const callUrl = new URL(String(call.url));
    expect(callUrl.origin).toBe("http://127.0.0.1:8188");
    expect(callUrl.pathname).toBe("/view");
    expect(callUrl.searchParams.get("filename")).toBe("output.png");
    expect(callUrl.searchParams.get("subfolder")).toBe("renders/scene-1");
    expect(callUrl.searchParams.get("type")).toBe("output");

    // Test a flat key with no subfolder
    const secondBytes = new Uint8Array([0x00, 0xff, 0xaa, 0x55]);
    transport.fakeFetch.queueResponse(
      new Response(secondBytes, {
        status: 200,
        headers: { "Content-Type": "video/mp4" }
      })
    );

    const flatOutput = await reader.readOutput("output.mp4");
    expect(flatOutput.bytes).toEqual(secondBytes);
    expect(flatOutput.contentType).toBe("video/mp4");
    expect(transport.fakeFetch.calls).toHaveLength(2);

    const secondCallUrl = new URL(String(transport.fakeFetch.calls[1]!.url));
    expect(secondCallUrl.searchParams.get("filename")).toBe("output.mp4");
    expect(secondCallUrl.searchParams.get("subfolder")).toBe("");
    expect(secondCallUrl.searchParams.get("type")).toBe("output");
  });

  it("rejects unsafe or malformed ComfyUI output keys before fetching", async () => {
    const transport = new FakeComfyUiTransport();
    const reader = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transport);

    const invalidKeys = [
      "",
      "   ",
      "/absolute/path/file.png",
      "/file.png",
      "../parent.png",
      "sub/../../parent.png",
      "./current.png",
      "sub/./current.png",
      "sub//double-slash.png",
      "sub/",
      "/",
      "file.png?query=value",
      "file.png#fragment",
      "file\0.png",
      "file\n.png",
      "C:/windows/path.png"
    ];

    for (const key of invalidKeys) {
      await expect(reader.readOutput(key), `Expected key "${key}" to be rejected`).rejects.toThrow(
        ComfyUiOutputReaderError
      );
    }

    // Crucial invariant: No fetch calls must be made for invalid keys
    expect(transport.fakeFetch.calls).toHaveLength(0);
  });

  it("reports ComfyUI output transport and HTTP failures without synthetic bytes", async () => {
    const transport = new FakeComfyUiTransport();
    const reader = new HttpComfyUiOutputReader("http://127.0.0.1:8188", transport);

    // 404 Not Found
    transport.fakeFetch.queueResponse(
      new Response("File not found", {
        status: 404,
        statusText: "Not Found"
      })
    );

    try {
      await reader.readOutput("renders/missing.png");
      expect.unreachable("Should have thrown ComfyUiOutputReaderError on 404");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiOutputReaderError);
      const readerErr = err as ComfyUiOutputReaderError;
      expect(readerErr.statusCode).toBe(404);
      expect(readerErr.outputObjectKey).toBe("renders/missing.png");
      expect(readerErr.message).toContain("404");
    }

    // 500 Internal Server Error
    transport.fakeFetch.queueResponse(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error"
      })
    );

    try {
      await reader.readOutput("renders/error.png");
      expect.unreachable("Should have thrown ComfyUiOutputReaderError on 500");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiOutputReaderError);
      const readerErr = err as ComfyUiOutputReaderError;
      expect(readerErr.statusCode).toBe(500);
      expect(readerErr.outputObjectKey).toBe("renders/error.png");
    }

    // Transport network exception
    transport.fakeFetch.setDefaultResponseHandler(() => {
      throw new Error("Network connection reset by peer");
    });

    try {
      await reader.readOutput("renders/network-fail.png");
      expect.unreachable("Should have thrown ComfyUiOutputReaderError on transport failure");
    } catch (err) {
      expect(err).toBeInstanceOf(ComfyUiOutputReaderError);
      const readerErr = err as ComfyUiOutputReaderError;
      expect(readerErr.outputObjectKey).toBe("renders/network-fail.png");
      expect(readerErr.statusCode).toBeUndefined();
    }
  });
});
