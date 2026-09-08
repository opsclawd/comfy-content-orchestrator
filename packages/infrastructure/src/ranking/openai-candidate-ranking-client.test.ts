import { describe, expect, it, vi } from "vitest";
import type { RankingModelRequest } from "@cco/application";
import { OpenAiCandidateRankingClient } from "./openai-candidate-ranking-client.js";

describe("OpenAiCandidateRankingClient", () => {
  const sampleRequest: RankingModelRequest = {
    shotDescription: "Hero standing on a cliff at sunset",
    images: [
      {
        ordinal: 1,
        image: {
          base64Data: "aGVsbG8x",
          mimeType: "image/png"
        }
      },
      {
        ordinal: 2,
        image: {
          base64Data: "aGVsbG8y",
          mimeType: "image/jpeg"
        }
      },
      {
        ordinal: 3,
        image: {
          base64Data: "aGVsbG8z",
          mimeType: "image/png"
        }
      }
    ]
  };

  it("requires an apiKey in options", () => {
    expect(() => new OpenAiCandidateRankingClient({ apiKey: "" })).toThrowError(/apiKey/);
  });

  it("maps 2xx success with valid ranking JSON array", async () => {
    let capturedBody: string | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            id: "chatcmpl-ranking-1",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: "[2, 3, 1]"
                },
                finish_reason: "stop"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-openai-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.rankedOrdinals).toEqual([2, 3, 1]);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-openai-key",
          "content-type": "application/json"
        })
      })
    );

    // Finding 3 assertion: outgoing payload contains only data: URLs, never http(s):// URLs
    expect(capturedBody).toBeDefined();
    const parsedPayload = JSON.parse(capturedBody!);
    expect(capturedBody).not.toMatch(/https?:\/\/[^/]+\//i); // no remote URLs
    const userMessage = parsedPayload.messages.find((m: { role: string }) => m.role === "user");
    const imageUrlParts = userMessage.content.filter(
      (c: { type: string }) => c.type === "image_url"
    );
    expect(imageUrlParts).toHaveLength(3);
    expect(imageUrlParts[0].image_url.url).toBe("data:image/png;base64,aGVsbG8x");
    expect(imageUrlParts[1].image_url.url).toBe("data:image/jpeg;base64,aGVsbG8y");
    expect(imageUrlParts[2].image_url.url).toBe("data:image/png;base64,aGVsbG8z");
  });

  it("handles markdown-fenced JSON in 2xx response", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "```json\n[3, 2, 1]\n```"
                }
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.rankedOrdinals).toEqual([3, 2, 1]);
    }
  });

  it("maps 2xx with malformed JSON to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Candidate 1 is best"
                }
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("permanent_failure");
    if (outcome.kind === "permanent_failure") {
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.message).toContain("Failed to parse ranking JSON");
    }
  });

  it("maps 2xx with missing ordinal to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "[1, 2]" // missing 3
                }
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("permanent_failure");
    if (outcome.kind === "permanent_failure") {
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.message).toContain("does not match candidate count");
    }
  });

  it("maps 2xx with finish_reason content_filter to safety_refusal", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                finish_reason: "content_filter"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("safety_refusal");
    if (outcome.kind === "safety_refusal") {
      expect(outcome.httpStatus).toBe(200);
    }
  });

  it("maps 2xx with message.refusal to safety_refusal", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  refusal: "I cannot fulfill this request due to safety concerns."
                }
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("safety_refusal");
    if (outcome.kind === "safety_refusal") {
      expect(outcome.message).toContain("safety concerns");
    }
  });

  it("maps HTTP 429 to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 429,
        text: async () =>
          JSON.stringify({
            error: {
              type: "rate_limit_error",
              message: "Rate limit exceeded"
            }
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.message).toContain("Rate limit exceeded");
    }
  });

  it("maps HTTP 500 to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 500,
        text: async () => "Internal Server Error"
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.httpStatus).toBe(500);
    }
  });

  it("maps HTTP 400 to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              message: "Invalid request body"
            }
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("permanent_failure");
    if (outcome.kind === "permanent_failure") {
      expect(outcome.httpStatus).toBe(400);
      expect(outcome.message).toContain("Invalid request body");
    }
  });

  it("maps HTTP 403 content_policy_violation to safety_refusal", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              code: "content_policy_violation",
              message: "Content violates safety policy"
            }
          })
      } as unknown as Response;
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("safety_refusal");
    if (outcome.kind === "safety_refusal") {
      expect(outcome.httpStatus).toBe(403);
    }
  });

  it("maps network failure to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNRESET 127.0.0.1:443");
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.message).toContain("ECONNRESET");
    }
  });

  it("maps timeout to retryable_failure", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("Timeout"));
        });
      });
    });

    const client = new OpenAiCandidateRankingClient({
      apiKey: "test-key",
      timeoutMs: 50,
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.message).toContain("timed out");
    }
  });
});
