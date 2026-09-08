import { describe, expect, it, vi } from "vitest";
import type { RankingModelRequest } from "@cco/application";
import { GeminiCandidateRankingClient } from "./gemini-candidate-ranking-client.js";

describe("GeminiCandidateRankingClient", () => {
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
    expect(() => new GeminiCandidateRankingClient({ apiKey: "" })).toThrowError(/apiKey/);
  });

  it("maps 2xx success with valid ranking JSON array", async () => {
    let capturedBody: string | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "[3, 1, 2]" }],
                  role: "model"
                },
                finishReason: "STOP"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-gemini-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.rankedOrdinals).toEqual([3, 1, 2]);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": "test-gemini-key",
          "content-type": "application/json"
        })
      })
    );

    // Finding 3 assertion: outgoing payload contains only inlineData base64 bytes, never http(s):// URLs
    expect(capturedBody).toBeDefined();
    const parsedPayload = JSON.parse(capturedBody!);
    expect(capturedBody).not.toMatch(/https?:\/\//i);
    const contents = parsedPayload.contents[0].parts;
    const inlineDataParts = contents.filter(
      (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData !== undefined
    );
    expect(inlineDataParts).toHaveLength(3);
    expect(inlineDataParts[0].inlineData).toEqual({
      mimeType: "image/png",
      data: "aGVsbG8x"
    });
  });

  it("handles markdown-fenced JSON in 2xx response", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "```json\n[2, 3, 1]\n```" }],
                  role: "model"
                },
                finishReason: "STOP"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("success");
    if (outcome.kind === "success") {
      expect(outcome.rankedOrdinals).toEqual([2, 3, 1]);
    }
  });

  it("maps 2xx with malformed JSON to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "I like candidate 1 best, then 2, then 3." }],
                  role: "model"
                },
                finishReason: "STOP"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
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

  it("maps 2xx with non-permutation ordinals to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "[1, 2, 99]" }], // 99 is not in requested ordinals [1, 2, 3]
                  role: "model"
                },
                finishReason: "STOP"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("permanent_failure");
    if (outcome.kind === "permanent_failure") {
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.message).toContain("not in expected candidate ordinals");
    }
  });

  it("maps 2xx with duplicate ordinals to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "[1, 2, 2]" }],
                  role: "model"
                },
                finishReason: "STOP"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("permanent_failure");
    if (outcome.kind === "permanent_failure") {
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.message).toContain("Duplicate ordinal");
    }
  });

  it("maps 2xx safety finishReason to safety_refusal", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                finishReason: "SAFETY"
              }
            ]
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("safety_refusal");
    if (outcome.kind === "safety_refusal") {
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.message).toContain("SAFETY");
    }
  });

  it("maps 2xx promptFeedback blockReason SAFETY to safety_refusal", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            promptFeedback: {
              blockReason: "SAFETY"
            }
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("safety_refusal");
    if (outcome.kind === "safety_refusal") {
      expect(outcome.httpStatus).toBe(200);
      expect(outcome.message).toContain("Prompt blocked");
    }
  });

  it("maps HTTP 429 to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Resource exhausted", code: 429 } })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.httpStatus).toBe(429);
      expect(outcome.message).toContain("Resource exhausted");
    }
  });

  it("maps HTTP 503 to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 503,
        text: async () => "Service Unavailable"
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.httpStatus).toBe(503);
    }
  });

  it("maps HTTP 400 to permanent_failure", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 400,
        text: async () => JSON.stringify({ error: { message: "Bad Request" } })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("permanent_failure");
    if (outcome.kind === "permanent_failure") {
      expect(outcome.httpStatus).toBe(400);
      expect(outcome.message).toContain("Bad Request");
    }
  });

  it("maps HTTP 403 content policy violation to safety_refusal", async () => {
    const fetchMock = vi.fn(async () => {
      return {
        status: 403,
        text: async () =>
          JSON.stringify({
            error: {
              code: "content_policy_violation",
              message: "Safety violation occurred"
            }
          })
      } as unknown as Response;
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("safety_refusal");
    if (outcome.kind === "safety_refusal") {
      expect(outcome.httpStatus).toBe(403);
    }
  });

  it("maps network error to retryable_failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:443");
    });

    const client = new GeminiCandidateRankingClient({
      apiKey: "test-key",
      fetch: fetchMock
    });

    const outcome = await client.rankBatch(sampleRequest);
    expect(outcome.kind).toBe("retryable_failure");
    if (outcome.kind === "retryable_failure") {
      expect(outcome.message).toContain("ECONNREFUSED");
    }
  });

  it("maps timeout to retryable_failure", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted"));
        });
      });
    });

    const client = new GeminiCandidateRankingClient({
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
