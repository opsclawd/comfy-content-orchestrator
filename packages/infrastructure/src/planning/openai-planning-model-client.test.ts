import { describe, it, expect, vi } from "vitest";
import { OpenAiPlanningModelClient } from "./openai-planning-model-client.js";

describe("OpenAiPlanningModelClient", () => {
  const request = {
    systemPrompt: "System instruction",
    userPrompt: "Generate a scene"
  };

  it("maps HTTP 200 to success outcome", async () => {
    const fakeResponse = {
      id: "chatcmpl-123",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: '{"prompt":"A futuristic skyline"}'
          },
          finish_reason: "stop"
        }
      ]
    };

    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () => JSON.stringify(fakeResponse)
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.rawText).toBe('{"prompt":"A futuristic skyline"}');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-openai-key"
        })
      })
    );
  });

  it("maps HTTP 429 to retryable_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 429,
          text: async () =>
            JSON.stringify({ error: { message: "Rate limit reached", type: "requests" } })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBe(429);
      expect(result.message).toContain("Rate limit reached");
    }
  });

  it("maps HTTP 500 to retryable_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 500,
          text: async () =>
            JSON.stringify({ error: { message: "The server had an error", type: "server_error" } })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBe(500);
      expect(result.message).toContain("The server had an error");
    }
  });

  it("maps network throws to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBeUndefined();
      expect(result.message).toContain("ECONNREFUSED");
    }
  });

  it("maps HTTP 400 to permanent_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 400,
          text: async () =>
            JSON.stringify({ error: { message: "Invalid schema", type: "invalid_request_error" } })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(400);
      expect(result.message).toContain("Invalid schema");
    }
  });

  it("maps HTTP 401 to permanent_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 401,
          text: async () =>
            JSON.stringify({
              error: { message: "Incorrect API key provided", type: "invalid_request_error" }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(401);
      expect(result.message).toContain("Incorrect API key provided");
    }
  });

  it("maps HTTP 403-with-refusal-signal to safety_refusal", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 403,
          text: async () =>
            JSON.stringify({
              error: {
                code: "content_policy_violation",
                message: "Request violates safety policy: content policy violation"
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("safety_refusal");
    if (result.kind === "safety_refusal") {
      expect(result.httpStatus).toBe(403);
      expect(result.message).toContain("content policy violation");
    }
  });

  it("maps HTTP 403-without-refusal-signal to permanent_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 403,
          text: async () =>
            JSON.stringify({
              error: {
                message: "Country or region not supported"
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(403);
      expect(result.message).toContain("Country or region not supported");
    }
  });

  it("maps 200 response with finish_reason: content_filter to safety_refusal", async () => {
    const fakeResponse = {
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "" },
          finish_reason: "content_filter"
        }
      ]
    };

    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () => JSON.stringify(fakeResponse)
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("safety_refusal");
    if (result.kind === "safety_refusal") {
      expect(result.httpStatus).toBe(200);
      expect(result.message).toContain("Content filtered");
    }
  });

  it("classifies bounded timeout abort on never-resolving fetch as retryable_failure", async () => {
    // Never-resolving fetch simulating a hung connection
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 30
    });

    const result = await client.complete(request);

    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.message).toContain("timed out after 30ms");
    }
  });

  it("classifies bounded timeout abort on never-resolving response.text() as retryable_failure", async () => {
    // Fetch resolves, but reading response text hangs
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: () => new Promise<string>(() => {})
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 30
    });

    const result = await client.complete(request);

    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.message).toContain("timed out reading response body");
    }
  });

  it("classifies non-timeout response.text() rejection as retryable_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () => {
            throw new TypeError("terminated");
          }
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);

    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.message).toContain("terminated");
    }
  });

  it("classifies caller-supplied abort signal as retryable_failure", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock,
      timeoutMs: 5000
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("Caller deadline exceeded")), 20);

    const result = await client.complete({
      ...request,
      signal: controller.signal
    });

    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.message).toContain("Caller deadline exceeded");
    }
  });

  it("maps HTTP 429 with structured_field refusal discriminator (error.code: content_policy_violation) to safety_refusal", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 429,
          text: async () =>
            JSON.stringify({
              error: {
                code: "content_policy_violation",
                message: "Rate limited and content policy violation detected"
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("safety_refusal");
    if (result.kind === "safety_refusal") {
      expect(result.httpStatus).toBe(429);
      expect(result.message).toContain("content policy violation detected");
    }
  });

  it("maps HTTP 500 with structured_field refusal discriminator (error.type: refusal) to safety_refusal", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 500,
          text: async () =>
            JSON.stringify({
              error: {
                type: "refusal",
                message: "Internal error: prompt refused by safety filter"
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("safety_refusal");
    if (result.kind === "safety_refusal") {
      expect(result.httpStatus).toBe(500);
      expect(result.message).toContain("prompt refused by safety filter");
    }
  });

  it("maps HTTP 401 with refusal-looking prose but no exact discriminator to permanent_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 401,
          text: async () =>
            JSON.stringify({
              error: {
                type: "authentication_error",
                message: "Organization policy does not allow this API key"
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(401);
      expect(result.message).toContain("Organization policy does not allow this API key");
    }
  });

  it("maps HTTP 500 with refusal-looking prose but no exact discriminator to retryable_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 500,
          text: async () =>
            JSON.stringify({
              error: {
                type: "server_error",
                message: "Safety policy enforcement service temporarily unavailable"
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBe(500);
      expect(result.message).toContain("Safety policy enforcement service temporarily unavailable");
    }
  });

  it("maps network error containing refusal keywords to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("request failed: safety policy endpoint unavailable");
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBeUndefined();
      expect(result.message).toContain("safety policy endpoint unavailable");
    }
  });

  it("maps HTTP 403 with heuristic-only keyword match (e.g. harm) to safety_refusal", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 403,
          text: async () =>
            JSON.stringify({
              error: {
                message: "This request was blocked due to potential harm."
              }
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("safety_refusal");
    if (result.kind === "safety_refusal") {
      expect(result.httpStatus).toBe(403);
      expect(result.message).toContain("potential harm");
    }
  });

  it("normalizes baseUrl with trailing /v1 to avoid doubling the path", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { role: "assistant", content: '{"ok":true}' } }]
            })
        }) as unknown as Response
    );

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-key",
      baseUrl: "https://api.minimax.io/v1/",
      fetch: fetchMock
    });

    await client.complete(request);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.minimax.io/v1/chat/completions",
      expect.anything()
    );
  });

  it("never sends raw reference images or binary content in request payload", async () => {
    let capturedBody: { messages?: Array<{ role?: unknown; content?: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as {
        messages?: Array<{ role?: unknown; content?: unknown }>;
      };
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: '{"prompt":"Text only"}' } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System instruction with reference metadata",
      userPrompt: "User prompt describing scene with metadata text"
    });

    expect(capturedBody?.messages).toHaveLength(2);
    expect(capturedBody?.messages?.[0]?.role).toBe("system");
    expect(typeof capturedBody?.messages?.[0]?.content).toBe("string");
    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(typeof capturedBody?.messages?.[1]?.content).toBe("string");
    // Ensure no image/base64 block or binary property
    expect(JSON.stringify(capturedBody)).not.toContain("image_url");
    expect(JSON.stringify(capturedBody)).not.toContain("base64");
  });

  it("encodes a single image as an image_url data URL block in user message", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "A smiling couple" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      fetch: fetchMock
    });

    const result = await client.complete({
      systemPrompt: "Describe image",
      userPrompt: "Describe reference image",
      images: [
        {
          mimeType: "image/png",
          base64Data:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
      ]
    });

    expect(result.kind).toBe("success");
    expect(capturedBody?.messages).toHaveLength(2);
    expect(capturedBody?.messages?.[0]?.role).toBe("system");
    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(Array.isArray(capturedBody?.messages?.[1]?.content)).toBe(true);

    const userContent = capturedBody?.messages?.[1]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(userContent).toHaveLength(2);
    expect(userContent[0]).toEqual({
      type: "text",
      text: "Describe reference image"
    });
    expect(userContent[1]).toEqual({
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      }
    });
  });

  it("encodes multiple ordered images preserving array order", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Description" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "User",
      images: [
        { mimeType: "image/jpeg", base64Data: "FIRST_IMAGE" },
        { mimeType: "image/webp", base64Data: "SECOND_IMAGE" },
        { mimeType: "image/png", base64Data: "THIRD_IMAGE" }
      ]
    });

    const userContent = capturedBody?.messages?.[1]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(userContent).toHaveLength(4);
    expect(userContent[0]).toEqual({ type: "text", text: "User" });
    expect(userContent[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,FIRST_IMAGE" }
    });
    expect(userContent[2]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/webp;base64,SECOND_IMAGE" }
    });
    expect(userContent[3]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,THIRD_IMAGE" }
    });
  });

  it("omits image content blocks when imageCapability is false for non-MiniMax model", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Text only" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "gpt-5.6-sol",
      fetch: fetchMock
    });

    expect(client.imageCapability).toBe(false);

    await client.complete({
      systemPrompt: "System",
      userPrompt: "User prompt",
      images: [{ mimeType: "image/png", base64Data: "BASE64" }]
    });

    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(typeof capturedBody?.messages?.[1]?.content).toBe("string");
    expect(capturedBody?.messages?.[1]?.content).toBe("User prompt");
  });

  it("forces imageCapability to false for non-MiniMax model even if imageCapability: true is provided in options", async () => {
    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "gpt-5.6-sol",
      imageCapability: true,
      fetch: vi.fn()
    });

    expect(client.imageCapability).toBe(false);
    expect(client.supportsImages).toBe(false);
  });

  it("never emits image blocks for non-MiniMax model even if imageCapability: true is set in options", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Text only" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "gpt-5.6-sol",
      imageCapability: true,
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "User prompt",
      images: [{ mimeType: "image/png", base64Data: "BASE64" }]
    });

    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(typeof capturedBody?.messages?.[1]?.content).toBe("string");
    expect(capturedBody?.messages?.[1]?.content).toBe("User prompt");
  });

  it("allows disabling imageCapability for MiniMax-M3 via imageCapability: false", async () => {
    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      imageCapability: false,
      fetch: vi.fn()
    });

    expect(client.imageCapability).toBe(false);
    expect(client.supportsImages).toBe(false);
  });

  it("never emits image blocks for MiniMax-M3 when imageCapability: false is set in options", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Text only" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      imageCapability: false,
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "User prompt",
      images: [{ mimeType: "image/png", base64Data: "BASE64" }]
    });

    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(typeof capturedBody?.messages?.[1]?.content).toBe("string");
    expect(capturedBody?.messages?.[1]?.content).toBe("User prompt");
  });

  it("keeps user message text-only when images array is empty", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Text only" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "User prompt",
      images: []
    });

    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(typeof capturedBody?.messages?.[1]?.content).toBe("string");
    expect(capturedBody?.messages?.[1]?.content).toBe("User prompt");
  });

  it("caps attached images to bindingCount when bindingCount is provided", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Plan result" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "Plan prompt",
      bindingCount: 2,
      images: [
        { mimeType: "image/png", base64Data: "IMG_1" },
        { mimeType: "image/png", base64Data: "IMG_2" },
        { mimeType: "image/png", base64Data: "IMG_3" },
        { mimeType: "image/png", base64Data: "IMG_4" }
      ]
    });

    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    const userContent = capturedBody?.messages?.[1]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(Array.isArray(userContent)).toBe(true);
    // 1 text block + 2 capped image blocks
    expect(userContent).toHaveLength(3);
    expect(userContent[0]).toEqual({ type: "text", text: "Plan prompt" });
    expect(userContent[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,IMG_1" }
    });
    expect(userContent[2]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,IMG_2" }
    });
  });

  it("caps attached images to MAX_PLANNING_IMAGES (9) when more than 9 images are provided without bindingCount", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Plan result" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      fetch: fetchMock
    });

    const twelveImages = Array.from({ length: 12 }, (_, i) => ({
      mimeType: "image/png",
      base64Data: `DATA_${i + 1}`
    }));

    await client.complete({
      systemPrompt: "System",
      userPrompt: "Plan prompt",
      images: twelveImages
    });

    const userContent = capturedBody?.messages?.[1]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(Array.isArray(userContent)).toBe(true);
    // 1 text block + 9 images (capped at MAX_PLANNING_IMAGES = 9)
    expect(userContent).toHaveLength(10);
    expect(userContent[0]).toEqual({ type: "text", text: "Plan prompt" });
    for (let i = 1; i <= 9; i++) {
      expect(userContent[i]).toEqual({
        type: "image_url",
        image_url: { url: `data:image/png;base64,DATA_${i}` }
      });
    }
  });

  it("emits text-only when bindingCount is 0 even if images are provided", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Plan result" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "Plan prompt",
      bindingCount: 0,
      images: [{ mimeType: "image/png", base64Data: "DATA_1" }]
    });

    expect(capturedBody?.messages?.[1]?.role).toBe("user");
    expect(typeof capturedBody?.messages?.[1]?.content).toBe("string");
    expect(capturedBody?.messages?.[1]?.content).toBe("Plan prompt");
  });

  it("caps attached images to maxImages option when configured on client", async () => {
    let capturedBody: { messages?: Array<{ role: string; content: unknown }> } | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        capturedBody = JSON.parse(init.body as string);
      }
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "Plan result" } }]
          })
      } as unknown as Response;
    });

    const client = new OpenAiPlanningModelClient({
      apiKey: "test-openai-key",
      model: "MiniMax-M3",
      maxImages: 3,
      fetch: fetchMock
    });

    await client.complete({
      systemPrompt: "System",
      userPrompt: "Plan prompt",
      images: [
        { mimeType: "image/png", base64Data: "IMG_1" },
        { mimeType: "image/png", base64Data: "IMG_2" },
        { mimeType: "image/png", base64Data: "IMG_3" },
        { mimeType: "image/png", base64Data: "IMG_4" },
        { mimeType: "image/png", base64Data: "IMG_5" }
      ]
    });

    const userContent = capturedBody?.messages?.[1]?.content as Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }>;
    expect(Array.isArray(userContent)).toBe(true);
    expect(userContent).toHaveLength(4); // 1 text + 3 images
  });
});
