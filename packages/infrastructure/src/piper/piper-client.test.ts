import { describe, expect, it, vi } from "vitest";
import { PiperHttpClient } from "./piper-client.js";
import { PiperSynthesisError } from "./piper-error.js";

describe("PiperHttpClient", () => {
  it("sends POST /synthesize with text, omitting voice and length_scale when undefined", async () => {
    let capturedUrl: string | undefined;
    let capturedOptions: RequestInit | undefined;

    const fakeAudio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedOptions = init;
      return new Response(fakeAudio, { status: 200 });
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    const result = await client.synthesize({ text: "Hello world" });
    expect(result).toEqual(fakeAudio);
    expect(capturedUrl).toBe("http://localhost:5000/synthesize");
    expect(capturedOptions?.method).toBe("POST");
    expect(capturedOptions?.headers).toEqual({ "Content-Type": "application/json" });

    const parsedBody = JSON.parse(capturedOptions?.body as string);
    expect(parsedBody).toEqual({ text: "Hello world" });
    expect("voice" in parsedBody).toBe(false);
    expect("length_scale" in parsedBody).toBe(false);
  });

  it("includes voice and length_scale in request body when provided", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fakeAudio = new Uint8Array([1, 2, 3]);
    const mockFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(fakeAudio, { status: 200 });
    });

    const client = new PiperHttpClient("http://localhost:5000/", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await client.synthesize({
      text: "Speed test",
      voice: "en_US-lessac-medium",
      lengthScale: 0.8
    });

    expect(capturedBody).toEqual({
      text: "Speed test",
      voice: "en_US-lessac-medium",
      length_scale: 0.8
    });
  });

  it("maps HTTP 404 response to VOICE_NOT_FOUND error", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response("Not found", { status: 404 });
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await expect(client.synthesize({ text: "Hello", voice: "unknown_voice" })).rejects.toThrowError(
      PiperSynthesisError
    );

    try {
      await client.synthesize({ text: "Hello", voice: "unknown_voice" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("VOICE_NOT_FOUND");
      expect(error.context.statusCode).toBe(404);
      expect(error.context.voiceId).toBe("unknown_voice");
    }
  });

  it("maps other non-2xx HTTP responses to INFERENCE_FAILED error", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response("Internal error", { status: 500 });
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await expect(client.synthesize({ text: "Hello" })).rejects.toThrowError(PiperSynthesisError);

    try {
      await client.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("INFERENCE_FAILED");
      expect(error.context.statusCode).toBe(500);
    }
  });

  it("maps network/fetch rejection to SERVICE_UNAVAILABLE error", async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await expect(client.synthesize({ text: "Hello" })).rejects.toThrowError(PiperSynthesisError);

    try {
      await client.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("SERVICE_UNAVAILABLE");
    }
  });

  it("maps empty response body to DECODE_FAILED error", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(new Uint8Array(0), { status: 200 });
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await expect(client.synthesize({ text: "Hello" })).rejects.toThrowError(PiperSynthesisError);

    try {
      await client.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("DECODE_FAILED");
    }
  });

  it("rejects non-positive or non-finite lengthScale with INVALID_INPUT without calling fetch", async () => {
    const mockFetch = vi.fn();
    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    const invalidScales = [0, -1, NaN, Infinity, -Infinity];
    for (const lengthScale of invalidScales) {
      await expect(client.synthesize({ text: "Hello", lengthScale })).rejects.toThrowError(
        PiperSynthesisError
      );

      try {
        await client.synthesize({ text: "Hello", lengthScale });
      } catch (err: unknown) {
        const error = err as PiperSynthesisError;
        expect(error.code).toBe("INVALID_INPUT");
      }
    }

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cancels response body on HTTP 404 before throwing VOICE_NOT_FOUND", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn(async () => {
      return {
        ok: false,
        status: 404,
        body: { cancel: cancelSpy }
      } as unknown as Response;
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await expect(client.synthesize({ text: "Hello", voice: "missing" })).rejects.toThrowError(
      PiperSynthesisError
    );

    try {
      await client.synthesize({ text: "Hello", voice: "missing" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("VOICE_NOT_FOUND");
      expect(error.context.statusCode).toBe(404);
    }

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("cancels response body on other non-2xx responses before throwing INFERENCE_FAILED", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        body: { cancel: cancelSpy }
      } as unknown as Response;
    });

    const client = new PiperHttpClient("http://localhost:5000", {
      fetch: mockFetch as unknown as typeof fetch
    });

    await expect(client.synthesize({ text: "Hello" })).rejects.toThrowError(PiperSynthesisError);

    try {
      await client.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("INFERENCE_FAILED");
      expect(error.context.statusCode).toBe(500);
    }

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("times out and maps to SERVICE_UNAVAILABLE when fetch never resolves (stalled request)", async () => {
    const mockFetch = vi.fn(() => new Promise<Response>(() => {}));

    const client = new PiperHttpClient(
      "http://localhost:5000",
      { fetch: mockFetch as unknown as typeof fetch },
      { timeoutMs: 30 }
    );

    await expect(client.synthesize({ text: "Hello" })).rejects.toThrowError(PiperSynthesisError);

    try {
      await client.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("SERVICE_UNAVAILABLE");
      expect(error.message).toContain("timed out");
    }
  });

  it("times out and maps to SERVICE_UNAVAILABLE when response body stalls after headers", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    const mockFetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          body: { cancel: cancelSpy },
          arrayBuffer: () => new Promise<ArrayBuffer>(() => {})
        }) as unknown as Response
    );

    const client = new PiperHttpClient(
      "http://localhost:5000",
      { fetch: mockFetch as unknown as typeof fetch },
      30
    );

    await expect(client.synthesize({ text: "Hello" })).rejects.toThrowError(PiperSynthesisError);

    try {
      await client.synthesize({ text: "Hello" });
    } catch (err: unknown) {
      const error = err as PiperSynthesisError;
      expect(error.code).toBe("SERVICE_UNAVAILABLE");
      expect(error.message).toContain("timed out");
    }

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("allows per-request timeout override", async () => {
    const mockFetch = vi.fn(() => new Promise<Response>(() => {}));

    const client = new PiperHttpClient(
      "http://localhost:5000",
      { fetch: mockFetch as unknown as typeof fetch },
      { timeoutMs: 10_000 }
    );

    // Request overrides default 10_000ms with 25ms
    const startTime = Date.now();
    await expect(client.synthesize({ text: "Hello", timeoutMs: 25 })).rejects.toThrowError(
      PiperSynthesisError
    );
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(1000);
  });
});
