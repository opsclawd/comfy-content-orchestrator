import { describe, expect, it, vi } from "vitest";
import { createApiClient, getHealth, ApiClientError, ApiValidationError } from "./client.js";

describe("Typed Control API Client", () => {
  it("parses and returns valid health response", async () => {
    const validData = {
      status: "ok",
      timestamp: "2026-08-20T00:00:00.000Z"
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validData
    });

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    const result = await client.getHealth();

    expect(mockFetch).toHaveBeenCalledWith("http://example.com/api/health", {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    expect(result).toEqual(validData);
  });

  it("throws ApiValidationError when response shape is malformed", async () => {
    const malformedData = {
      status: "wrong_status",
      timestamp: 12345
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => malformedData
    });

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    await expect(client.getHealth()).rejects.toThrow(ApiValidationError);
  });

  it("throws ApiClientError when response is HTTP 500", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error"
    });

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    await expect(client.getHealth()).rejects.toThrow(ApiClientError);
  });

  it("throws ApiClientError when network connection fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network connection refused"));

    const client = createApiClient({ baseUrl: "http://example.com", fetchFn: mockFetch });
    await expect(client.getHealth()).rejects.toThrow(ApiClientError);
  });

  it("getHealth convenience function works as expected", async () => {
    const validData = {
      status: "ok",
      timestamp: "2026-08-20T00:00:00.000Z"
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => validData
    });

    const result = await getHealth("http://example.com", mockFetch);
    expect(result).toEqual(validData);
  });
});
