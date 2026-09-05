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
});
