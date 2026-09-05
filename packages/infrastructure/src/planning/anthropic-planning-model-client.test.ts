import { describe, it, expect, vi } from "vitest";
import { AnthropicPlanningModelClient } from "./anthropic-planning-model-client.js";

describe("AnthropicPlanningModelClient", () => {
  const request = {
    systemPrompt: "System instruction",
    userPrompt: "Generate a scene"
  };

  it("maps HTTP 200 to success outcome", async () => {
    const fakeResponse = {
      id: "msg_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: '{"prompt":"A scenic vista"}' }],
      stop_reason: "end_turn"
    };

    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () => JSON.stringify(fakeResponse)
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-anthropic-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.rawText).toBe('{"prompt":"A scenic vista"}');
    }
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "test-anthropic-key",
          "anthropic-version": "2023-06-01"
        }),
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 4096,
          system: request.systemPrompt,
          messages: [
            {
              role: "user",
              content: request.userPrompt
            }
          ]
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
            JSON.stringify({ error: { type: "rate_limit_error", message: "Rate limit reached" } })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
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
            JSON.stringify({ error: { type: "api_error", message: "Internal server error" } })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBe(500);
      expect(result.message).toContain("Internal server error");
    }
  });

  it("maps network throws to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNRESET");
    });

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("retryable_failure");
    if (result.kind === "retryable_failure") {
      expect(result.httpStatus).toBeUndefined();
      expect(result.message).toContain("ECONNRESET");
    }
  });

  it("maps HTTP 400 to permanent_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 400,
          text: async () =>
            JSON.stringify({
              error: { type: "invalid_request_error", message: "Invalid parameters" }
            })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(400);
      expect(result.message).toContain("Invalid parameters");
    }
  });

  it("maps HTTP 401 to permanent_failure", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 401,
          text: async () =>
            JSON.stringify({ error: { type: "authentication_error", message: "Invalid API key" } })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(401);
      expect(result.message).toContain("Invalid API key");
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
                type: "policy_error",
                message: "Request blocked due to safety and usage policy restrictions"
              }
            })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("safety_refusal");
    if (result.kind === "safety_refusal") {
      expect(result.httpStatus).toBe(403);
      expect(result.message).toContain("safety and usage policy restrictions");
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
                type: "forbidden",
                message: "Access to resource is forbidden"
              }
            })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const result = await client.complete(request);
    expect(result.kind).toBe("permanent_failure");
    if (result.kind === "permanent_failure") {
      expect(result.httpStatus).toBe(403);
      expect(result.message).toContain("Access to resource is forbidden");
    }
  });

  it("respects explicit model override", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          status: 200,
          text: async () =>
            JSON.stringify({
              id: "msg_custom",
              type: "message",
              role: "assistant",
              content: [{ type: "text", text: "{}" }],
              stop_reason: "end_turn"
            })
        }) as unknown as Response
    );

    const client = new AnthropicPlanningModelClient({
      apiKey: "test-key",
      model: "claude-custom-override",
      fetch: fetchMock
    });

    await client.complete(request);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        body: expect.stringContaining('"model":"claude-custom-override"')
      })
    );
  });
});
